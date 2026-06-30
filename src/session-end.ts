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
import { join } from 'node:path';

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
}

function tryGit(git: GitRunner, args: string[], cwd: string): string | null {
  try {
    return git(args, cwd).trim();
  } catch {
    return null;
  }
}

// Count added lines (≈ new JSONL entries) for the brain file, working tree + index.
function countAdded(git: GitRunner, cwd: string, path: string): number {
  let added = 0;
  for (const base of [['diff'], ['diff', '--cached']]) {
    const out = tryGit(git, [...base, '--numstat', '--', path], cwd);
    if (!out) continue;
    for (const line of out.split('\n')) {
      const n = Number(line.split('\t')[0]);
      if (Number.isFinite(n)) added += n;
    }
  }
  return added;
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
  const entries = join(dataDir, 'entries.jsonl');

  try {
    // 1) Must be inside a git work tree (committed-brain model). Otherwise no-op.
    if (tryGit(git, ['rev-parse', '--is-inside-work-tree'], cwd) !== 'true') {
      return { committed: false, reason: 'not-a-repo' };
    }
    // 2) Nothing staged or unstaged for the brain file → nothing to do (silent).
    const status = tryGit(git, ['status', '--porcelain', '--', entries], cwd);
    if (!status) return { committed: false, reason: 'brain-clean' };

    const added = countAdded(git, cwd, entries);
    const tag = sessionId ? `, session ${sessionId.slice(0, 8)}` : '';

    // 3) Branch guard — never commit on a detached HEAD or the default branch.
    const branch = tryGit(git, ['symbolic-ref', '--short', '-q', 'HEAD'], cwd) || '';
    const def = defaultBranch(git, cwd);
    if (!branch) {
      return {
        committed: false,
        reason: 'detached-head',
        added,
        systemMessage: `vfkb: ${added} new brain entr${added === 1 ? 'y' : 'ies'} uncommitted (detached HEAD) — check out a branch and commit to preserve continuity.`,
      };
    }
    if (branch === def || branch === 'main' || branch === 'master') {
      return {
        committed: false,
        reason: 'on-default-branch',
        branch,
        added,
        systemMessage: `vfkb: ${added} new brain entr${added === 1 ? 'y' : 'ies'} on \`${branch}\` left uncommitted — branch + commit to preserve continuity (vfkb never auto-commits the default branch).`,
      };
    }

    // 4) Pathspec-scoped commit. Stage ONLY the brain file (leaves any other staged
    //    files alone), then commit with `--only` so even pre-staged files are NOT
    //    swept into this auto-commit.
    const message = `chore(brain): session-end auto-commit (${added} new entr${added === 1 ? 'y' : 'ies'}${tag})`;
    git(['add', '--', entries], cwd);
    // `-m` MUST precede `--`; everything after `--` is treated as a pathspec.
    git(['commit', '-o', '-m', message, '--', entries], cwd);
    return { committed: true, reason: 'committed', branch, added, message };
  } catch {
    // Any git failure (no identity, hook rejection, …) → fail-open, never block exit.
    return { committed: false, reason: 'error' };
  }
}
