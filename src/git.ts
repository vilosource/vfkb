// Brain git lifecycle (Phase 6). The per-project brain is its own git history;
// the engine commits it (attributed to the writing role). Pure Node stdlib + the
// git binary (no library dep).

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { brainDir } from './storage.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Is this brain dir nested inside a SURROUNDING git worktree (i.e. the ADR-0019
 * committed-brain shape, `<repo>/.vfkb`) rather than standing alone?
 *
 * This is the discriminator that keeps `git init` out of a consumer's repo. Running it
 * there turns `<repo>/.vfkb` into an EMBEDDED repo, after which
 * `git add .vfkb/entries.jsonl` — the exact pathspec ADR-0033's SessionEnd auto-commit
 * uses — exits 0, prints nothing, and tracks nothing. One pi session and the brain
 * silently leaves version control while `/exit` still reports success (brain gotcha
 * 80683290b4a8, reproduced).
 *
 * Asked from the PARENT, so an already-standalone brain (which owns its own `.git`)
 * answers for itself and keeps working exactly as before.
 */
function insideSurroundingRepo(brain: string): boolean {
  try {
    // REALPATH FIRST. Asking `dirname()` of the symlink asks about the LINK's parent,
    // not the brain's actual location — so a brain reached through a symlink from
    // outside the repo answered "standalone" and the guard was bypassed completely,
    // reproducing the full gitlink defect (verified: mode 160000 recorded). This is the
    // documented shape for a brain kept outside its project, so it is not exotic.
    return git(['rev-parse', '--is-inside-work-tree'], dirname(realpathSync(brain))).trim() === 'true';
  } catch {
    return false; // not a git dir, or no git binary → treat as standalone
  }
}

/** `true` when this brain is (or may become) its own standalone git repo. */
function isStandaloneBrain(brain: string): boolean {
  // An existing `.git` means a standalone brain already exists here — never disturb it.
  if (existsSync(join(brain, '.git'))) return true;
  return !insideSurroundingRepo(brain);
}

function ensureRepo(brain: string): void {
  if (!existsSync(join(brain, '.git'))) {
    git(['init', '-q'], brain);
  }
}

export interface SaveResult {
  committed: boolean;
  message: string;
  /**
   * Set when this brain is deliberately NOT ours to commit (it lives inside a project
   * repo). Distinct from `committed:false` meaning "nothing changed" — a caller that
   * conflates the two cannot tell a refusal from a successful no-op, which is how a
   * script ends up believing the brain was saved.
   */
  refused?: boolean;
}

// Commit all brain changes. `role` attributes the commit (author.role, D4a).
// Returns committed:false when there is nothing to commit (idempotent).
export function save(message = 'vfkb: update', role = 'engine', brain = brainDir()): SaveResult {
  // REFUSE on an in-repo brain, and say so. Two things would go wrong otherwise, and
  // both are silent:
  //   1. `ensureRepo` would `git init` here, gitlinking the brain out of the consumer's
  //      repo (see insideSurroundingRepo above).
  //   2. Even without that, `git add -A` in `<repo>/.vfkb` stages into the SURROUNDING
  //      repo — sweeping in whatever else the operator had staged. session-end.ts:1-8
  //      exists precisely because that is unacceptable, and commits ONE pathspec with
  //      `--only` instead.
  // So an in-repo brain is committed by the surrounding project's own flow (the ADR-0033
  // SessionEnd hook, or the operator), never by this function.
  if (!isStandaloneBrain(brain)) {
    return {
      committed: false,
      refused: true,
      message:
        `brain at ${brain} is inside a git worktree — not committing here ` +
        '(an in-repo brain is committed by the project, via the session-end pathspec commit)',
    };
  }
  ensureRepo(brain);
  git(['add', '-A'], brain);
  const status = git(['status', '--porcelain'], brain).trim();
  if (status.length === 0) return { committed: false, message: 'nothing to commit' };
  git(
    [
      '-c',
      `user.name=vfkb (${role})`,
      '-c',
      'user.email=vfkb@vilosource.local',
      'commit',
      '-q',
      '-m',
      message,
    ],
    brain,
  );
  return { committed: true, message };
}

export function saveAndPush(
  message = 'vfkb: update',
  role = 'engine',
  brain = brainDir(),
): SaveResult {
  const r = save(message, role, brain);
  // MUST bail on the same condition as save(), and this is not merely tidiness.
  // `git remote` WALKS UP: with cwd=<repo>/.vfkb and no repo of its own, it resolves the
  // SURROUNDING PROJECT's remotes, so this would `git push` the operator's project
  // unattended. Before the in-repo guard existed, `ensureRepo` had just initialised an
  // empty repo here and `git remote` returned nothing — the old code was safe only by
  // accident of the very behaviour the guard removes.
  if (!r.committed && !isStandaloneBrain(brain)) return r;
  // Push only if a remote is configured (otherwise a local-only brain).
  const remotes = git(['remote'], brain).trim();
  if (remotes.length > 0) git(['push', '-q'], brain);
  return r;
}
