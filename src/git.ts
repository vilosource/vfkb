// Brain git lifecycle (Phase 6). The per-project brain is its own git history;
// the engine commits it (attributed to the writing role). Pure Node stdlib + the
// git binary (no library dep).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { brainDir } from './storage.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function ensureRepo(brain: string): void {
  if (!existsSync(join(brain, '.git'))) {
    git(['init', '-q'], brain);
  }
}

export interface SaveResult {
  committed: boolean;
  message: string;
}

// Commit all brain changes. `role` attributes the commit (author.role, D4a).
// Returns committed:false when there is nothing to commit (idempotent).
export function save(message = 'vfkb: update', role = 'engine', brain = brainDir()): SaveResult {
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
  // Push only if a remote is configured (otherwise a local-only brain).
  const remotes = git(['remote'], brain).trim();
  if (remotes.length > 0) git(['push', '-q'], brain);
  return r;
}
