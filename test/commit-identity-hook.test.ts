// The commit identity guard (.githooks/pre-commit): a commit in vfkb must be authored AND
// committed as vilosource. Driven through real `git commit` in a throwaway repo whose
// core.hooksPath points at the committed hook, the same way scripts/install-git-hooks.mjs
// wires a clone.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HOOKS = resolve(__dirname, '..', '.githooks');
const VILO = '126692+vilosource@users.noreply.github.com';
const ONEIO = 'jason.viloria@oneio.cloud';

let dir = '';
const git = (args: string[], env: Record<string, string> = {}) =>
  spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    // A clean identity: no inherited GIT_* overrides, no global/system config.
    env: { PATH: process.env.PATH!, HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...env },
  });
const commit = (env: Record<string, string> = {}) => {
  writeFileSync(join(dir, 'f.txt'), String(Math.random()));
  git(['add', 'f.txt']);
  return git(['commit', '-q', '-m', 'x'], env);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vfkb-ident-'));
  git(['init', '-q', '-b', 'topic']);
  git(['config', 'core.hooksPath', HOOKS]);
  git(['config', 'commit.gpgsign', 'false']);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('commit identity guard (.githooks/pre-commit)', () => {
  it('allows a commit authored and committed as vilosource', () => {
    git(['config', 'user.name', 'Jason Viloria']);
    git(['config', 'user.email', VILO]);
    const r = commit();
    expect(r.status, r.stderr).toBe(0);
    expect(git(['log', '-1', '--format=%ae %ce']).stdout.trim()).toBe(`${VILO} ${VILO}`);
  });

  it('refuses a commit under the OneIO identity, naming the fix', () => {
    git(['config', 'user.name', 'Jason Viloria']);
    git(['config', 'user.email', ONEIO]);
    const r = commit();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`refusing to commit as author <${ONEIO}>`);
    expect(r.stderr).toContain(`git config user.email ${VILO}`);
    expect(git(['rev-parse', '--verify', '-q', 'HEAD']).status).not.toBe(0); // nothing committed
  });

  it('refuses when only the AUTHOR is overridden to another identity', () => {
    git(['config', 'user.name', 'Jason Viloria']);
    git(['config', 'user.email', VILO]);
    const r = commit({ GIT_AUTHOR_EMAIL: ONEIO });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`author <${ONEIO}>`);
  });

  it('refuses when only the COMMITTER is overridden to another identity', () => {
    git(['config', 'user.name', 'Jason Viloria']);
    git(['config', 'user.email', VILO]);
    const r = commit({ GIT_COMMITTER_EMAIL: ONEIO });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`committer <${ONEIO}>`);
  });
});
