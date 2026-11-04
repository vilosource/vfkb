// The commit identity guard (.githooks/: pre-commit, pre-merge-commit, pre-push): a commit
// in vfkb must be authored AND committed as vilosource. Driven through real `git commit` in a throwaway repo whose
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
const commit = (env: Record<string, string> = {}, file = 'f.txt') => {
  writeFileSync(join(dir, file), String(Math.random()));
  git(['add', file]);
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

describe('commit identity guard: the paths pre-commit cannot see', () => {
  const asVilo = () => {
    git(['config', 'user.name', 'Jason Viloria']);
    git(['config', 'user.email', VILO]);
  };
  const remote = () => {
    const bare = join(dir, 'remote.git');
    spawnSync('git', ['init', '-q', '--bare', bare]);
    git(['remote', 'add', 'origin', bare]);
    return bare;
  };

  it('pre-merge-commit refuses a merge commit made as OneIO', () => {
    asVilo();
    expect(commit().status).toBe(0);
    git(['switch', '-q', '-c', 'side']);
    expect(commit({}, 'side.txt').status).toBe(0); // a different file: the merge must not conflict
    git(['switch', '-q', 'topic']);
    expect(commit().status).toBe(0);
    const r = git(['-c', `user.email=${ONEIO}`, 'merge', '--no-ff', '-q', '-m', 'm', 'side']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('refusing to commit');
    expect(git(['log', '-1', '--format=%s']).stdout.trim()).toBe('x'); // no merge commit was made
  });

  it('pre-push refuses a OneIO commit that skipped pre-commit (--no-verify), naming it', () => {
    asVilo();
    remote();
    expect(commit().status).toBe(0);
    writeFileSync(join(dir, 'g.txt'), 'x');
    git(['add', 'g.txt']);
    expect(git(['-c', `user.email=${ONEIO}`, 'commit', '-q', '--no-verify', '-m', 'sneaky']).status).toBe(0);
    const bad = git(['log', '-1', '--format=%h']).stdout.trim();
    const r = git(['push', '-q', 'origin', 'topic']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('refusing to push');
    expect(r.stderr).toContain(`${bad} author <${ONEIO}>`);
    expect(git(['ls-remote', 'origin', 'topic']).stdout).toBe(''); // nothing reached the remote
  });

  it('pre-push checks only the new commits past the remote tip, even pushing to a URL', () => {
    // Pushing to a URL (as this repo's gh-credential pushes do) leaves no remote-tracking
    // ref, so only the remote tip from stdin can bound the range. An old OneIO commit
    // already on the remote must not block a new, good push.
    asVilo();
    const url = join(dir, 'remote.git');
    spawnSync('git', ['init', '-q', '--bare', url]);
    expect(commit().status).toBe(0);
    writeFileSync(join(dir, 'old.txt'), 'x');
    git(['add', 'old.txt']);
    expect(git(['-c', `user.email=${ONEIO}`, 'commit', '-q', '--no-verify', '-m', 'old']).status).toBe(0);
    expect(git(['push', '-q', '--no-verify', url, 'HEAD:refs/heads/topic']).status).toBe(0);
    expect(commit().status).toBe(0);
    const r = git(['push', '-q', url, 'HEAD:refs/heads/topic']);
    expect(r.status, r.stderr).toBe(0);
  });

  it('accepts the email in any case, and GitHub as the committer of a squash merge', () => {
    git(['config', 'user.name', 'Jason Viloria']);
    git(['config', 'user.email', VILO.toUpperCase()]);
    expect(commit().status).toBe(0);
    remote();
    writeFileSync(join(dir, 'h.txt'), 'x');
    git(['add', 'h.txt']);
    git(['commit', '-q', '--no-verify', '-m', 'squash-shaped'], { GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com' });
    const r = git(['push', '-q', 'origin', 'topic']);
    expect(r.status, r.stderr).toBe(0);
  });

  it('git config vfkb.identityGuard off opts out of every hook', () => {
    git(['config', 'user.name', 'Someone Else']);
    git(['config', 'user.email', 'someone@example.com']);
    git(['config', 'vfkb.identityGuard', 'off']);
    remote();
    expect(commit().status).toBe(0);
    expect(git(['push', '-q', 'origin', 'topic']).status).toBe(0);
  });
});
