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
import { addEntry } from './engine.js';
import { autoCurate } from './curator.js';

export type GitRunner = (args: string[], cwd: string) => string;

const realGit: GitRunner = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export interface SessionEndOpts {
  cwd?: string; // project root (from the hook stdin `cwd`); defaults to process.cwd()
  dataDir?: string; // brain dir relative to cwd; defaults to $VFKB_DATA_DIR or ".vfkb"
  sessionId?: string; // for the commit message tag; defaults to $KB_SESSION_ID
  git?: GitRunner; // injectable for tests
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
  systemMessage?: string; // surfaced to the user at exit (the main-branch warning)
  autoHandoff?: boolean; // GAP 1 (B2): a fallback handoff entry was written this run
  curated?: number; // ADR-0083 §3: entries the Tier-1 rule archived or repaired this run
}

interface BrainEntry {
  id?: string;
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

function tryGit(git: GitRunner, args: string[], cwd: string): string | null {
  try {
    return git(args, cwd).trim();
  } catch {
    return null;
  }
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

function newEntriesSinceHead(
  git: GitRunner,
  cwd: string,
  repoRelEntries: string,
  absEntries: string,
): BrainEntry[] {
  let current: BrainEntry[];
  try {
    current = parseLines(readFileSync(absEntries, 'utf8'));
  } catch {
    return [];
  }
  const head = tryGit(git, ['show', `HEAD:${repoRelEntries}`], cwd);
  const known = new Set(parseLines(head ?? '').map((e) => e.id));
  const fresh: BrainEntry[] = [];
  for (const e of current) {
    if (!e.id || known.has(e.id)) continue;
    known.add(e.id);
    fresh.push(e);
  }
  return fresh;
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

// The repo's default branch (e.g. "main"/"master"), best-effort; falls back to "main".
function defaultBranch(git: GitRunner, cwd: string): string {
  const ref = tryGit(git, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
  if (ref && ref.startsWith('origin/')) return ref.slice('origin/'.length);
  return 'main';
}

export function runSessionEnd(opts: SessionEndOpts = {}): SessionEndResult {
  const git = opts.git ?? realGit;
  const cwd = opts.cwd || process.cwd();
  const dataDir = opts.dataDir || process.env.VFKB_DATA_DIR || process.env.VFKB_DIR || '.vfkb';
  const sessionId = opts.sessionId ?? process.env.KB_SESSION_ID;
  const entries = brainEntriesRelPath(dataDir);

  try {
    // 1) Must be inside a git work tree (committed-brain model). Otherwise no-op.
    if (tryGit(git, ['rev-parse', '--is-inside-work-tree'], cwd) !== 'true') {
      return { committed: false, reason: 'not-a-repo' };
    }
    // 2) Nothing staged or unstaged for the brain file → nothing to do (silent).
    const status = tryGit(git, ['status', '--porcelain', '--', entries], cwd);
    if (!status) return { committed: false, reason: 'brain-clean' };

    const tag = sessionId ? `, session ${sessionId.slice(0, 8)}` : '';
    const absBrain = isAbsolute(dataDir) ? dataDir : join(cwd, dataDir);
    const newSinceHead = () => newEntriesSinceHead(git, cwd, entries, join(absBrain, 'entries.jsonl'));

    // 3) Branch guard — never commit on a detached HEAD or the default branch.
    const branch = tryGit(git, ['symbolic-ref', '--short', '-q', 'HEAD'], cwd) || '';
    const def = defaultBranch(git, cwd);
    if (!branch) {
      const added = newSinceHead().length;
      return {
        committed: false,
        reason: 'detached-head',
        added,
        systemMessage: `vfkb: ${added} new brain entr${added === 1 ? 'y' : 'ies'} uncommitted (detached HEAD) — check out a branch and commit to preserve continuity.`,
      };
    }
    if (branch === def || branch === 'main' || branch === 'master') {
      const added = newSinceHead().length;
      return {
        committed: false,
        reason: 'on-default-branch',
        branch,
        added,
        systemMessage: `vfkb: ${added} new brain entr${added === 1 ? 'y' : 'ies'} on \`${branch}\` left uncommitted — branch + commit to preserve continuity (vfkb never auto-commits the default branch).`,
      };
    }

    // 4) GAP 1 (B2 floor): guarantee a committed handoff exists. If the session left no
    //    handoff/next entry among its new-since-HEAD entries, write a fallback that
    //    enumerates them — BEFORE the commit, so it ships in the same commit.
    const fresh = newSinceHead();
    let autoHandoff = false;
    if (fresh.length > 0 && !fresh.some(isHandoff)) {
      try {
        writeAutoHandoff(absBrain, fresh, sessionId);
        autoHandoff = true;
      } catch {
        /* handoff is best-effort; never let it block the commit */
      }
    }

    // 5) ADR-0083 §3: Tier-1 background curation. Only when the session added a new id
    //    (option A, brain ca519225196e) — so curation never makes a commit of its own —
    //    and only AFTER the B2 decision above, so its archive lines cannot read as "the
    //    session left a handoff". Fail-open: curation must never block the commit.
    let curated = 0;
    if (fresh.length > 0) {
      const prev = process.env.VFKB_DATA_DIR;
      process.env.VFKB_DATA_DIR = absBrain;
      try {
        const c = autoCurate();
        curated = c.archived.length + c.repaired.length;
      } catch {
        /* best-effort */
      } finally {
        if (prev === undefined) delete process.env.VFKB_DATA_DIR;
        else process.env.VFKB_DATA_DIR = prev;
      }
    }

    // 6) Pathspec-scoped commit. Stage ONLY the brain file (leaves any other staged
    //    files alone), then commit with `--only` so even pre-staged files are NOT
    //    swept into this auto-commit.
    const added = newSinceHead().length;
    const extra = curated ? `, ${curated} curated` : '';
    const message = `chore(brain): session-end auto-commit (${added} new entr${added === 1 ? 'y' : 'ies'}${extra}${tag})`;
    git(['add', '--', entries], cwd);
    // `-m` MUST precede `--`; everything after `--` is treated as a pathspec.
    git(['commit', '-o', '-m', message, '--', entries], cwd);
    return { committed: true, reason: 'committed', branch, added, message, autoHandoff, curated };
  } catch {
    // Any git failure (no identity, hook rejection, …) → fail-open, never block exit.
    return { committed: false, reason: 'error' };
  }
}
