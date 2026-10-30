// Session-end continuity — GAP 2 (RFC-011 / ADR-0033): auto-commit the brain so
// `/exit` is safe by default. The committed brain (`.vfkb/entries.jsonl`, ADR-0019)
// ships INSIDE the surrounding project repo, so this is NOT git.ts:save() (which
// runs a standalone brain repo with `git add -A`). Here we commit ONE pathspec into
// the project repo, on the CURRENT branch, NEVER on the default branch (decision
// 34f2f2da: branch + PR-first), and we must never sweep in the operator's other
// staged files (so a pathspec-`--only` commit, not a bare `git commit`).
//
// Fail-open throughout: a SessionEnd hook cannot block exit and must never throw.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { addEntry } from './engine.js';
import { autoCurate } from './curator.js';
import { GIT_READ_MAX_BUFFER } from './git-buffer.js';
import { relativeReal } from './realpath.js';

export type GitRunner = (args: string[], cwd: string) => string;

// maxBuffer: `git show HEAD:<brain>` returns the whole committed brain; past 1 MiB the
// default threw ENOBUFS and every entry read as new (vfkb#384).
export const realGit: GitRunner = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: GIT_READ_MAX_BUFFER });

/**
 * A GitRunner bounded by `timeout` (ms), stderr discarded, with SessionEnd's buffer: the
 * shape the UserPromptSubmit budget (decide Q12) and Stop's reads need (ADR-0085).
 */
export function boundedGit(timeout?: number): GitRunner {
  return (args, cwd) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: GIT_READ_MAX_BUFFER,
      timeout: timeout === undefined ? undefined : Math.max(1, Math.floor(timeout)),
    });
}

/**
 * The auto-commit subject's fixed prefix — ONE definition, shared with `vfkb doctor`'s
 * session-end check so the two cannot drift (vfkb#384).
 */
export const SESSION_END_COMMIT_PREFIX = 'chore(brain): session-end auto-commit';

/**
 * vfkb#384 (ADR-0084 §4, decided by the #384 Fable brainstorm under ruling
 * 54802539cda7): Claude Code gives SessionEnd hooks 1.5 s by default and a plugin's
 * per-hook `timeout` cannot raise it. ADR-0083 Tier-1 curation is the one optional step
 * that can run long (a backlog run, or a contended lock), so it starts only while the
 * process clock reads below this, and stops between archives once it passes. The B2
 * fallback and the single commit are never shed — they are the floor (ADR-0033).
 * Measured from process start (performance.now()), because the harness budget starts at
 * spawn, so node boot and stdin count too.
 */
export const SESSION_END_CURATION_DEADLINE_MS = 1000;

export interface SessionEndOpts {
  cwd?: string; // project root (from the hook stdin `cwd`); defaults to process.cwd()
  dataDir?: string; // brain dir relative to cwd; defaults to $VFKB_DATA_DIR or ".vfkb"
  sessionId?: string; // for the commit message tag; defaults to $KB_SESSION_ID
  git?: GitRunner; // injectable for tests
  /** monotonic ms since process start; injectable for tests (vfkb#384 deadline) */
  now?: () => number;
}

export interface SessionEndResult {
  committed: boolean;
  reason:
    | 'committed'
    | 'not-a-repo'
    | 'brain-clean'
    | 'detached-head'
    | 'on-default-branch'
    | 'error';
  branch?: string;
  added?: number; // new entry lines this commit covers
  message?: string; // the commit message used (when committed)
  // ADR-0033's warning text (renderNoAutocommitMessage). Emitted by the hook, but Claude Code
  // discards a SessionEnd systemMessage on `claude -p` (probe #384 arm F, 3/3; TUI
  // unobserved). The user-facing surface is the UserPromptSubmit systemMessage (ADR-0085).
  systemMessage?: string;
  autoHandoff?: boolean; // GAP 1 (B2): a fallback handoff entry was written this run
  curated?: number; // ADR-0083 §3: entries the Tier-1 rule archived or repaired this run
  curationSkipped?: 'deadline'; // vfkb#384: curation not run, or stopped early, at the deadline
}

export interface BrainEntry {
  id?: string;
  created?: string;
  updated?: string;
  type?: string;
  text?: string;
  tags?: string[];
}

// Repo-relative path to the brain file, POSIX-normalized. git's `HEAD:<path>` tree
// lookup needs forward slashes even on Windows (path.join yields `\` there) — without
// this, the lookup fails, headCount→0, and every existing entry is treated as "new".
// Matches the convention in stop-reminder.ts (relative(...).replace(/\\/g,'/')).
export function brainEntriesRelPath(dataDir: string): string {
  return join(dataDir, 'entries.jsonl').replace(/\\/g, '/');
}

// The `HEAD:<path>` spelling for the brain file. git reads `HEAD:<path>` from the repo
// ROOT, but `HEAD:./<path>` from the cwd, so a cwd-relative `./` path is right whether
// the hook runs at the root or below it. An ABSOLUTE dataDir (the plugin passes
// VFKB_DATA_DIR=${CLAUDE_PROJECT_DIR}/.vfkb) used to produce `HEAD:/abs/path`, which
// git rejects — every entry then read as new (vfkb#384). relativeReal, because the
// hook's cwd and the dataDir may name the same directory through different symlinks.
export function brainHeadSpec(cwd: string, absEntries: string): string {
  return `HEAD:./${relativeReal(cwd, absEntries).replace(/\\/g, '/')}`;
}

/**
 * A git read whose answer was NOT observed: the child timed out, was killed, or never
 * started (ADR-0085 §5, decide D7). tryGit maps an ordinary non-zero exit to null (a git
 * "no"), but lets this through, so a caller with a deadline can tell "detached HEAD" or
 * "brain not in HEAD" apart from "ran out of time". realGit never throws it, so
 * SessionEnd's behaviour is unchanged.
 */
export class GitUnobserved extends Error {}

function tryGit(git: GitRunner, args: string[], cwd: string): string | null {
  try {
    return git(args, cwd).trim();
  } catch (e) {
    if (e instanceof GitUnobserved) throw e;
    return null;
  }
}

/**
 * A GitRunner bounded by an absolute `deadline` on the performance.now() clock: each child
 * gets what is left of it, and a child that is killed (timeout/signal) or cannot spawn
 * throws GitUnobserved instead of an ordinary failure. Past the deadline nothing spawns.
 */
export function deadlineGit(deadline: number): GitRunner {
  return (args, cwd) => {
    const left = Math.floor(deadline - performance.now());
    if (left < 1) throw new GitUnobserved('deadline');
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: GIT_READ_MAX_BUFFER,
        timeout: left,
      });
    } catch (e) {
      const err = e as { signal?: unknown; status?: unknown };
      if (err && (err.signal || typeof err.status !== 'number')) throw new GitUnobserved(String(err.signal ?? 'spawn'));
      throw e;
    }
  };
}

/** The warning's stable lead-in: shared by the unit pins and the L4's content assertion. */
export const NO_AUTOCOMMIT_LEADIN = 'vfkb will not auto-commit';

/**
 * ADR-0033's default-branch / detached-HEAD warning — ONE text, used by the UserPromptSubmit
 * `systemMessage` (the surface the user sees, ADR-0085 §3) and by SessionEnd's own
 * `systemMessage` (decide D5). Tense-neutral, so it is true at the prompt and at exit;
 * printable ASCII with no markdown, because the TUI renders it literally. `added` is the
 * id count since HEAD; an edit-only diff (0 new ids) still warns and says so (decide D2).
 */
export function renderNoAutocommitMessage(kind: 'default' | 'detached', branch: string | null, added: number): string {
  const what = added >= 1 ? `the ${added} new brain entr${added === 1 ? 'y' : 'ies'}` : 'the edits to existing brain entries';
  const where = kind === 'detached' || !branch ? 'a detached HEAD' : `${branch} (the default branch)`;
  return `${NO_AUTOCOMMIT_LEADIN} ${what} on ${where}. Fix: git switch -c <name>; vfkb then commits the brain on exit.`;
}

// Entries NEW since HEAD (ADR-0083 §3): records whose id is absent from the committed
// brain, one per id. Counting ids, not added lines, keeps an edit of an existing entry —
// including a curation archive, which appends a full copy with its `handoff` tag — from
// reading as a new entry. Uses the same git-HEAD signal stop-reminder.ts uses, so it
// needs NO session state (KB_SESSION_ID is unset in the live wiring — gotcha e8f324dc).
function parseLines(text: string): BrainEntry[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as BrainEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is BrainEntry => e !== null);
}

/**
 * The ONE "new entries since HEAD" count (ADR-0085 §2, decide D9): shared by SessionEnd,
 * the UserPromptSubmit line and Stop (stop-reminder.ts `newBrainEntriesSinceHead`), so the
 * three surfaces print one N for one brain state. `git` must carry GIT_READ_MAX_BUFFER (the
 * HEAD brain can exceed 1 MiB, vfkb#384); a bounded caller passes a runner with a timeout.
 * When `git show` fails (no repo, brain not in HEAD) every id reads as new — callers that
 * must stay quiet outside the committed-brain model gate on `brainCommitOutcome`.
 */
export function newEntriesSinceHead(git: GitRunner, cwd: string, absEntries: string): BrainEntry[] {
  let current: BrainEntry[];
  try {
    current = parseLines(readFileSync(absEntries, 'utf8'));
  } catch {
    return [];
  }
  const head = tryGit(git, ['show', brainHeadSpec(cwd, absEntries)], cwd);
  const known = new Set(parseLines(head ?? '').map((e) => e.id));
  // Each new id judged by its NEWEST line (by `updated`, a tie to the later line), as the
  // engine materializes it: an entry written then retagged `handoff` is a handoff.
  const fresh = new Map<string, BrainEntry>();
  for (const e of current) {
    if (!e.id || known.has(e.id)) continue;
    const prev = fresh.get(e.id);
    if (!prev || String(e.updated ?? '') >= String(prev.updated ?? '')) fresh.set(e.id, e);
  }
  // An id the session added and then deleted ends on a tombstone: not a new entry.
  return [...fresh.values()].filter((e) => (e as { deleted?: boolean }).deleted !== true);
}

const isHandoff = (e: BrainEntry): boolean =>
  (e.tags ?? []).some((t) => t === 'handoff' || t === 'next');

const oneLine = (s: string): string => (s || '').replace(/\s+/g, ' ').trim();

// GAP 1 (B2 floor, ADR-0033 follow-on): when a session recorded knowledge but left no
// explicit handoff, write a minimal, honest fallback that ENUMERATES the session's new
// entries — deterministic (no transcript NLP), so a fresh clone always gets a committed
// pointer to the session's contribution. Surfaces via the knowledge bundle (it is a
// committed `fact`, independent of session records). Tagged `auto` to distinguish it
// from an agent-authored handoff. Writes through the engine (correct envelope); the
// engine resolves the brain via VFKB_DATA_DIR, so point it at the resolved dir for the call.
function writeAutoHandoff(absBrain: string, fresh: BrainEntry[], sessionId?: string): void {
  const CAP = 12;
  const list = fresh
    .slice(0, CAP)
    .map((e) => `${e.id ?? '?'} [${e.type ?? '?'}] ${oneLine(e.text ?? '').slice(0, 70)}`)
    .join('; ');
  const more = fresh.length > CAP ? ` (+${fresh.length - CAP} more)` : '';
  const n = fresh.length;
  const text =
    `Auto-handoff (session-end): no explicit handoff was recorded, but this session added ` +
    `${n} brain entr${n === 1 ? 'y' : 'ies'} since the last commit — ${list}${more}. ` +
    'Next session: review these and record an explicit `next:` if continuing.';
  const prev = process.env.VFKB_DATA_DIR;
  process.env.VFKB_DATA_DIR = absBrain;
  try {
    addEntry('fact', text, {
      role: 'executor',
      zone: 'established',
      tags: ['handoff', 'next', 'auto'],
      sessionId, // ADR-0039: attribute the fallback handoff to the ending session
    });
  } finally {
    if (prev === undefined) delete process.env.VFKB_DATA_DIR;
    else process.env.VFKB_DATA_DIR = prev;
  }
}

export type BranchKind = 'default' | 'detached' | 'topic';

/**
 * The one branch classifier (ADR-0084 §1.4 rule 1c; RFC-047 §7.6; brain cc69faa15edd),
 * shared by SessionEnd's guard and Stop's rule 1c so the two cannot disagree about what
 * "on the default branch" means. Tri-state (decide step Q3, vfkb#387) so vfkb#395's third
 * trigger, which fires on default OR detached, reuses it without a second HEAD read.
 *  - `detached`: `symbolic-ref --short -q HEAD` is empty or throws (branch is null).
 *  - `default`:  the branch equals the short name of `refs/remotes/origin/HEAD` (when that
 *                resolves under `origin/`), or is literally `main` or `master`.
 *  - `topic`:    anything else — including a repo with no origin/HEAD and a branch that is
 *                neither main nor master (unknown → not default, cc69faa15edd).
 * Both git reads run in the same order SessionEnd always ran them, so its git sequence is
 * unchanged. Never throws.
 */
export function classifyBranch(git: GitRunner, cwd: string): { kind: BranchKind; branch: string | null } {
  const branch = tryGit(git, ['symbolic-ref', '--short', '-q', 'HEAD'], cwd) || '';
  const ref = tryGit(git, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
  const def = ref && ref.startsWith('origin/') ? ref.slice('origin/'.length) : null;
  if (!branch) return { kind: 'detached', branch: null };
  if (branch === def || branch === 'main' || branch === 'master') return { kind: 'default', branch };
  return { kind: 'topic', branch };
}

/**
 * ADR-0084 §1.4's `isOnDefaultBranch(git, cwd)`: the boolean face of `classifyBranch`.
 * A detached HEAD is NOT the default branch, and any failure reads false — rule 1c is a
 * suppression, so an unknown branch leaves B3 eligible (fail toward firing).
 */
export function isOnDefaultBranch(git: GitRunner, cwd: string): boolean {
  try {
    return classifyBranch(git, cwd).kind === 'default';
  } catch {
    return false;
  }
}

export type BrainCommitOutcomeKind = 'not-a-repo' | 'brain-clean' | 'detached-head' | 'on-default-branch' | 'topic';

export interface BrainCommitOutcome {
  outcome: BrainCommitOutcomeKind;
  /** the branch name (null on a detached HEAD); undefined when the classifier did not run */
  branch?: string | null;
  /** the session's new ids since HEAD; undefined for `not-a-repo` / `brain-clean` */
  fresh?: BrainEntry[];
}

/**
 * ADR-0033 §1–§3's preconditions as ONE predicate (ADR-0085 §1, decide D2): what SessionEnd
 * would do with the brain right now. `runSessionEnd` consumes it, and the UserPromptSubmit
 * line's `no-autocommit` reason reads it, so the two cannot disagree. The git sequence is
 * SessionEnd's own, unchanged: work-tree check, pathspec status, ONE read of HEAD's brain,
 * then the branch classifier. Never throws (every git read fails open through tryGit).
 */
export function brainCommitOutcome(git: GitRunner, cwd: string, dataDir: string): BrainCommitOutcome {
  // 1) Must be inside a git work tree (committed-brain model). Otherwise no-op.
  if (tryGit(git, ['rev-parse', '--is-inside-work-tree'], cwd) !== 'true') return { outcome: 'not-a-repo' };
  // 2) Nothing staged or unstaged for the brain file (or it is ignored / outside the tree).
  if (!tryGit(git, ['status', '--porcelain', '--', brainEntriesRelPath(dataDir)], cwd)) return { outcome: 'brain-clean' };
  const absBrain = isAbsolute(dataDir) ? dataDir : join(cwd, dataDir);
  // ONE read of HEAD's brain per run (vfkb#384): each `git show` of a >1 MiB blob costs
  // tens of ms against the 1.5 s SessionEnd budget, and nothing below changes HEAD.
  const fresh = newEntriesSinceHead(git, cwd, join(absBrain, 'entries.jsonl'));
  // 3) Branch guard — never commit on a detached HEAD or the default branch.
  const cls = classifyBranch(git, cwd);
  const outcome = cls.kind === 'detached' ? 'detached-head' : cls.kind === 'default' ? 'on-default-branch' : 'topic';
  return { outcome, branch: cls.branch, fresh };
}

export function runSessionEnd(opts: SessionEndOpts = {}): SessionEndResult {
  const git = opts.git ?? realGit;
  const now = opts.now ?? (() => performance.now());
  const cwd = opts.cwd || process.cwd();
  const dataDir = opts.dataDir || process.env.VFKB_DATA_DIR || process.env.VFKB_DIR || '.vfkb';
  const sessionId = opts.sessionId ?? process.env.KB_SESSION_ID;
  const entries = brainEntriesRelPath(dataDir);

  try {
    // 1)–3) ADR-0033's preconditions, through the predicate the prompt line shares (ADR-0085).
    const oc = brainCommitOutcome(git, cwd, dataDir);
    if (oc.outcome === 'not-a-repo' || oc.outcome === 'brain-clean') return { committed: false, reason: oc.outcome };

    const tag = sessionId ? `, session ${sessionId.slice(0, 8)}` : '';
    const absBrain = isAbsolute(dataDir) ? dataDir : join(cwd, dataDir);
    const fresh = oc.fresh ?? [];
    if (oc.outcome === 'detached-head') {
      const added = fresh.length;
      return { committed: false, reason: 'detached-head', added, systemMessage: renderNoAutocommitMessage('detached', null, added) };
    }
    const branch = oc.branch ?? '';
    if (oc.outcome === 'on-default-branch') {
      const added = fresh.length;
      return {
        committed: false,
        reason: 'on-default-branch',
        branch,
        added,
        systemMessage: renderNoAutocommitMessage('default', branch, added),
      };
    }

    // 4) GAP 1 (B2 floor): guarantee a committed handoff exists. DECIDE here, from the
    //    session's new-since-HEAD entries, whether a fallback is needed; WRITE it in 6),
    //    after curation and before the commit, so it ships in the same commit.
    const needFallback = fresh.length > 0 && !fresh.some(isHandoff);

    // 5) ADR-0083 §3: Tier-1 background curation. Only when the session added a new id
    //    (option A, brain ca519225196e), so curation never makes a commit of its own. It
    //    runs AFTER the fallback decision, so its archive lines cannot read as "the
    //    session left a handoff", and BEFORE the fallback is written, so the rule measures
    //    from the last real handoff, not from an auto-handoff stamped "now". Fail-open.
    //    vfkb#384: bounded by SESSION_END_CURATION_DEADLINE_MS on the process clock —
    //    curation is the optional step, so it is the one the deadline sheds.
    let curated = 0;
    let curationSkipped: 'deadline' | undefined;
    if (fresh.length > 0) {
      if (now() >= SESSION_END_CURATION_DEADLINE_MS) {
        curationSkipped = 'deadline';
      } else {
        const prev = process.env.VFKB_DATA_DIR;
        process.env.VFKB_DATA_DIR = absBrain;
        try {
          const c = autoCurate(undefined, { now, deadlineMs: SESSION_END_CURATION_DEADLINE_MS });
          curated = c.archived.length + c.repaired.length;
          if (c.stopped) curationSkipped = c.stopped;
        } catch {
          /* best-effort */
        } finally {
          if (prev === undefined) delete process.env.VFKB_DATA_DIR;
          else process.env.VFKB_DATA_DIR = prev;
        }
      }
    }

    let autoHandoff = false;
    if (needFallback) {
      try {
        writeAutoHandoff(absBrain, fresh, sessionId);
        autoHandoff = true;
      } catch {
        /* handoff is best-effort; never let it block the commit */
      }
    }

    // 7) Pathspec-scoped commit. Stage ONLY the brain file (leaves any other staged
    //    files alone), then commit with `--only` so even pre-staged files are NOT
    //    swept into this auto-commit. `added` = the session's new ids plus the fallback
    //    (a new id of its own); curation only re-writes ids that already exist.
    const added = fresh.length + (autoHandoff ? 1 : 0);
    const extra = curated ? `, ${curated} curated` : '';
    const message = `${SESSION_END_COMMIT_PREFIX} (${added} new entr${added === 1 ? 'y' : 'ies'}${extra}${tag})`;
    git(['add', '--', entries], cwd);
    // `-m` MUST precede `--`; everything after `--` is treated as a pathspec.
    git(['commit', '-o', '-m', message, '--', entries], cwd);
    return { committed: true, reason: 'committed', branch, added, message, autoHandoff, curated, curationSkipped };
  } catch {
    // Any git failure (no identity, hook rejection, …) → fail-open, never block exit.
    return { committed: false, reason: 'error' };
  }
}
