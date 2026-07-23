// git.ts must never `git init` inside an ADR-0019 in-repo brain (gotcha 80683290b4a8).
//
// THE FAILURE THIS GUARDS IS SILENT, which is why the assertions are about git's own
// tracking state rather than about return values or exit codes. Running `git init` in
// `<repo>/.vfkb` turns it into an embedded repo; afterwards
// `git add .vfkb/entries.jsonl` — the exact pathspec ADR-0033's SessionEnd auto-commit
// uses — exits 0, prints nothing, and tracks nothing. The consumer's brain leaves
// version control and `/exit` keeps reporting success.
//
// It was unreachable until pi was wired into `vfkb init`: the only pi load path was
// `pi -e`, and the L4 image bind-mounts a STANDALONE brain. So the standalone case must
// keep working exactly as before — that is what the second describe block pins.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { save } from './git.js';

let root: string;
const g = (args: string[], cwd: string) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function repoWithBrain(): { repo: string; brain: string } {
  const repo = mkdtempSync(join(tmpdir(), 'vfkb-inrepo-'));
  g(['init', '-q'], repo);
  g(['config', 'user.email', 't@t'], repo);
  g(['config', 'user.name', 't'], repo);
  const brain = join(repo, '.vfkb');
  mkdirSync(brain, { recursive: true });
  writeFileSync(join(brain, 'entries.jsonl'), '{"id":"a"}\n');
  return { repo, brain };
}

beforeEach(() => {
  root = '';
});
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('in-repo brain (ADR-0019) — git.ts must not gitlink it', () => {
  it('does NOT create .vfkb/.git', () => {
    const { repo, brain } = repoWithBrain();
    root = repo;
    save('m', 'agent', brain);
    expect(existsSync(join(brain, '.git'))).toBe(false);
  });

  it('leaves entries.jsonl TRACKABLE by the ADR-0033 pathspec — the silent failure', () => {
    const { repo, brain } = repoWithBrain();
    root = repo;
    save('m', 'agent', brain);

    // The exact command session-end.ts runs. Before the fix this exited 0 and tracked
    // nothing, so asserting on the exit code would have passed against the bug.
    g(['add', '--', '.vfkb/entries.jsonl'], repo);
    expect(g(['ls-files', '.vfkb/entries.jsonl'], repo).trim()).toBe('.vfkb/entries.jsonl');
  });

  it('never records a gitlink (mode 160000) for the brain', () => {
    const { repo, brain } = repoWithBrain();
    root = repo;
    save('m', 'agent', brain);
    g(['add', '-A'], repo);
    expect(g(['ls-files', '-s'], repo)).not.toMatch(/^160000/m);
  });

  it('reports refusal honestly instead of claiming a commit it did not make', () => {
    const { repo, brain } = repoWithBrain();
    root = repo;
    const r = save('m', 'agent', brain);
    expect(r.committed).toBe(false);
    expect(r.message).toMatch(/inside a git worktree/);
  });

  it('does not stage the operator\'s other files (the `git add -A` hazard)', () => {
    const { repo, brain } = repoWithBrain();
    root = repo;
    writeFileSync(join(repo, 'unrelated.txt'), 'do not stage me');
    save('m', 'agent', brain);
    expect(g(['diff', '--cached', '--name-only'], repo).trim()).toBe('');
  });
});

describe('standalone brain — unchanged behaviour (the L4 image and `vfkb save`)', () => {
  it('still initialises and commits a brain that is NOT inside a repo', () => {
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-standalone-'));
    root = brain;
    writeFileSync(join(brain, 'entries.jsonl'), '{"id":"a"}\n');
    const r = save('m', 'agent', brain);
    expect(r.committed).toBe(true);
    expect(existsSync(join(brain, '.git'))).toBe(true);
    expect(g(['ls-files'], brain)).toContain('entries.jsonl');
  });

  it('is idempotent — a second save with no changes commits nothing', () => {
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-standalone2-'));
    root = brain;
    writeFileSync(join(brain, 'entries.jsonl'), '{"id":"a"}\n');
    save('m', 'agent', brain);
    expect(save('m', 'agent', brain).committed).toBe(false);
  });

  it('keeps working for a brain that ALREADY owns a .git, even inside a repo', () => {
    // Legacy standalone brains created by earlier versions must not suddenly refuse.
    const { repo, brain } = repoWithBrain();
    root = repo;
    g(['init', '-q'], brain);
    g(['config', 'user.email', 't@t'], brain);
    g(['config', 'user.name', 't'], brain);
    expect(save('m', 'agent', brain).committed).toBe(true);
  });
});
