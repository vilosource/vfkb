// ADR-0064 (RFC-034) — durable capture: an untracked write-ahead journal
// closes the brain-loss window between an engine append and the next brain
// commit. `<brain>/.journal/` is gitignored BY DESIGN: `git checkout --`,
// `reset --hard`, and stash operate on tracked state and leave it alive.
//
// Key discipline (review-hardened, RFC-034 §2/§3): everything is keyed on the
// `(id, updated)` PAIR, never the bare id — entries.jsonl is an append-only
// LWW log (a retag appends a new revision line for an existing id), and a
// bare-id key would prune exactly the uncommitted revision lines the journal
// exists to protect.
//
// This module deliberately imports nothing from storage.ts (storage imports
// journalAppend, so an import back would cycle); callers pass the brain dir
// and hold the ADR-0040 lock around recovery themselves.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { realPath, relativeReal } from './realpath.js';

const walPath = (brain: string): string => join(brain, '.journal', 'wal.jsonl');
const suppressedPath = (brain: string): string => join(brain, '.journal', 'suppressed');

// Wal rewrites (prune/purge) are temp-file + rename so a crash mid-rewrite
// cannot truncate the journal. Residual race, documented (review m5): plain
// `journalAppend`s are deliberately lock-free, so a mirror line landing
// between a rewrite's read and its rename is dropped from the wal — the
// primary append is unaffected; that one entry merely loses journal
// protection until its next revision or commit. Compound-rare and fails
// toward the pre-journal status quo, never toward corruption.
function rewriteWal(wal: string, keep: WalLine[]): void {
  const tmp = `${wal}.tmp`;
  writeFileSync(tmp, keep.length > 0 ? keep.map((l) => l.raw).join('\n') + '\n' : '', 'utf8');
  renameSync(tmp, wal);
}

interface PairSource {
  id?: unknown;
  updated?: unknown;
}
const pairOf = (r: PairSource): string => `${String(r.id)}\u0000${String(r.updated ?? '')}`;

interface WalLine {
  raw: string;
  pair: string;
  id: string;
}

function parseLines(text: string): WalLine[] {
  const out: WalLine[] = [];
  for (const raw of text.split('\n')) {
    if (raw.trim().length === 0) continue;
    try {
      const rec = JSON.parse(raw) as PairSource;
      if (typeof rec.id !== 'string') continue;
      out.push({ raw, pair: pairOf(rec), id: rec.id });
    } catch {
      /* a torn/corrupt journal line protects nothing — skip it */
    }
  }
  return out;
}

function pairsOfFile(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  return new Set(parseLines(readFileSync(path, 'utf8')).map((l) => l.pair));
}

function suppressedPairs(brain: string): Set<string> {
  const p = suppressedPath(brain);
  if (!existsSync(p)) return new Set();
  return new Set(
    readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l.includes('\t'))
      .map((l) => l.replace('\t', '\u0000')),
  );
}

/**
 * Mirror one engine append into the journal — called JOURNAL-FIRST (before the
 * primary append; a crash between the two leaves an extra journal line that
 * idempotent recovery treats as lost-and-restorable, which is benign; the
 * reverse order would leave a crash window with the primary unprotected).
 * Fail-open with a loud edge: the safety net must never make capture itself
 * less reliable. `VFKB_NO_JOURNAL=1` is the kill switch (contrast arms,
 * emergencies).
 */
export function journalAppend(brain: string, rec: unknown): void {
  if (process.env.VFKB_NO_JOURNAL) return;
  try {
    mkdirSync(join(brain, '.journal'), { recursive: true });
    appendFileSync(walPath(brain), JSON.stringify(rec) + '\n', 'utf8');
  } catch (err) {
    process.stderr.write(
      `vfkb: journal mirror failed (primary append proceeds unprotected): ${(err as Error).message}\n`,
    );
  }
}

export interface RecoveryReport {
  restored: number;
  pruned: number;
}

// Conservative git classification (RFC-034 §3): a brain is a git brain iff
// rev-parse succeeds; if the subsequent HEAD read fails for ANY reason
// (unborn branch, detached/corrupt state, entries not tracked), prune nothing
// this pass — never prune on uncertainty.
function pairsAtHead(brain: string): Set<string> | 'not-git' | 'unknown' {
  // realPath first, for the same reason git.ts insideSurroundingRepo does it:
  // dirname() of a SYMLINKED brain names the LINK's parent, not the brain's real
  // home, so the repo we ask and the path we ask about described DIFFERENT repos —
  // realpathing only `rel` and not `repoDir` half-applies the fix.
  //
  // Be precise about what this buys, because it is not "prune now works against
  // HEAD": for a brain living OUTSIDE any worktree, the real parent is not a work
  // tree either, so pairsAtHead returns 'not-git' and prune falls to the
  // file-presence rule. That is the POINT — a non-symlinked standalone brain
  // already classified 'not-git', so this makes the symlinked one consistent with
  // it rather than stranding it on 'unknown' (= never prune, wal grows forever).
  const repoDir = dirname(realPath(brain));
  const git = (...a: string[]): string =>
    execFileSync('git', ['-C', repoDir, ...a], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  try {
    if (git('rev-parse', '--is-inside-work-tree') !== 'true') return 'not-git';
  } catch {
    return 'not-git';
  }
  try {
    const top = git('rev-parse', '--show-toplevel');
    // relativeReal, not relative: `top` is git's realpath answer while `brain`
    // is whatever the caller spelled. A symlink anywhere in either made this
    // climb out of the repo, so `cat-file` threw, so prune returned 'unknown'
    // and the wal grew without bound. See src/realpath.ts.
    const rel = relativeReal(top, join(brain, 'entries.jsonl'));
    const head = execFileSync('git', ['-C', repoDir, 'cat-file', '-p', `HEAD:${rel}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return new Set(parseLines(head).map((l) => l.pair));
  } catch {
    return 'unknown';
  }
}

/**
 * Deterministic recovery + prune (RFC-034 §2/§3). Caller holds the ADR-0040
 * lock (recovery is a read-decide-append op). Idempotent: a second run
 * restores nothing.
 *
 * - restore: every journaled `(id, updated)` line absent from entries.jsonl
 *   (and not suppressed) is re-appended VERBATIM — byte-identical, same ids.
 * - prune: git brains drop wal lines whose pair is committed at HEAD
 *   (committed is durable); non-git brains drop pairs present in
 *   entries.jsonl itself; suppressed pairs are dropped as deliberately dead.
 */
export function recoverFromJournal(brain: string): RecoveryReport {
  // Kill-switch symmetry (review m7): an operator who disabled the journal in
  // an emergency must not keep getting session-start restores from a stale wal.
  if (process.env.VFKB_NO_JOURNAL) return { restored: 0, pruned: 0 };
  const wal = walPath(brain);
  if (!existsSync(wal)) return { restored: 0, pruned: 0 };
  const walLines = parseLines(readFileSync(wal, 'utf8'));
  if (walLines.length === 0) return { restored: 0, pruned: 0 };
  const entriesPath = join(brain, 'entries.jsonl');
  const present = pairsOfFile(entriesPath);
  const suppressed = suppressedPairs(brain);

  const toRestore = walLines.filter((l) => !present.has(l.pair) && !suppressed.has(l.pair));
  if (toRestore.length > 0) {
    // Torn-tail guard (review M1): a crash mid-append or a hand-redaction saved
    // without a final newline leaves entries.jsonl ending in a partial line —
    // appending blind would GLUE the restored line onto it, corrupting the very
    // entry recovery exists to save (and the same-pass prune would then drop
    // the journal copy: permanent loss in the non-git tier).
    let prefix = '';
    if (existsSync(entriesPath)) {
      const cur = readFileSync(entriesPath, 'utf8');
      if (cur.length > 0 && !cur.endsWith('\n')) prefix = '\n';
    }
    appendFileSync(entriesPath, prefix + toRestore.map((l) => l.raw).join('\n') + '\n', 'utf8');
  }

  // Prune. After restore, every wal pair is in entries.jsonl; durability of
  // the FILE is git's job for git brains, the file itself otherwise.
  const head = pairsAtHead(brain);
  let keep: WalLine[];
  if (head === 'unknown') {
    // HEAD unreadable — prune NOTHING this pass (RFC-034 §3, literally: never
    // prune on uncertainty; even suppressed lines wait for a readable pass).
    keep = walLines;
  } else if (head === 'not-git') {
    keep = walLines.filter((l) => !suppressed.has(l.pair) && !present.has(l.pair) && !toRestore.includes(l));
  } else {
    keep = walLines.filter((l) => !suppressed.has(l.pair) && !head.has(l.pair));
  }
  const pruned = walLines.length - keep.length;
  if (pruned > 0) {
    rewriteWal(wal, keep);
  }
  return { restored: toRestore.length, pruned };
}

export interface PurgeReport {
  purged: number;
}

/**
 * Redaction escape hatch (RFC-034 §4): remove matching lines from the journal
 * and record their pairs in `.journal/suppressed` — a suppressed pair is never
 * recovered again, so a deliberate redaction of entries.jsonl stays redacted.
 * A FUTURE clean revision of the same id journals and recovers normally (its
 * new `updated` stamp makes a new pair).
 */
export function purgeJournal(brain: string, opts: { id?: string; all?: boolean }): PurgeReport {
  const wal = walPath(brain);
  if (!existsSync(wal)) return { purged: 0 };
  const walLines = parseLines(readFileSync(wal, 'utf8'));
  const gone = walLines.filter((l) => (opts.all ? true : l.id === opts.id));
  if (gone.length === 0) return { purged: 0 };
  const keep = walLines.filter((l) => !gone.includes(l));
  mkdirSync(join(brain, '.journal'), { recursive: true });
  appendFileSync(suppressedPath(brain), gone.map((l) => l.pair.replace('\u0000', '\t')).join('\n') + '\n', 'utf8');
  rewriteWal(wal, keep);
  return { purged: gone.length };
}

/** Doctor's read-only view: what would recovery do, and is a redaction half-done? */
export function journalStatus(brain: string): {
  walLines: number;
  restorable: number;
  suppressedInEntries: number;
} {
  const wal = walPath(brain);
  const walLines = existsSync(wal) ? parseLines(readFileSync(wal, 'utf8')) : [];
  const present = pairsOfFile(join(brain, 'entries.jsonl'));
  const suppressed = suppressedPairs(brain);
  return {
    walLines: walLines.length,
    restorable: walLines.filter((l) => !present.has(l.pair) && !suppressed.has(l.pair)).length,
    suppressedInEntries: [...suppressed].filter((p) => present.has(p)).length,
  };
}
