// `vfkb doctor` must detect a brain ALREADY corrupted by a pre-fix build (gotcha
// 80683290b4a8). git.ts no longer creates an embedded repo (#238), but a brain damaged
// before that fix never heals itself — and the damage is invisible: `git add
// .vfkb/entries.jsonl` exits 0 and tracks nothing, while every other doctor check
// reports OK straight through it.
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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


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

describe('vfkb doctor — detects a brain already corrupted by an older build', () => {
  it('FAILS only when the PROJECT tracked the brain and an embedded repo now hides it', async () => {
    const { runDoctor } = await import('./doctor.js');
    const { repo, brain } = repoWithBrain();
    root = repo;
    // The project owns this brain: it is tracked and committed...
    g(['add', '--', '.vfkb/entries.jsonl'], repo);
    g(['commit', '-qm', 'brain'], repo);
    // ...and then an older build gitlinks it out of the project.
    g(['init', '-q'], brain);
    const c = runDoctor({ root: repo, brainDir: brain, env: {} }).checks.find(
      (x) => x.name === 'brain gitlink',
    );
    expect(c?.status).toBe('fail');
    expect(c?.detail).toMatch(/silently tracks NOTHING/);
  });

  it('does NOT fail a standalone brain the project has gitignored', async () => {
    // The dotfiles shape: $HOME is a git repo and ~/.vfkb deliberately has its own
    // history. The first version called this corruption and told the user to `rm` it.
    // Gitignoring the brain is the project saying "not mine" — the check must respect it.
    const { runDoctor } = await import('./doctor.js');
    const { repo, brain } = repoWithBrain();
    root = repo;
    writeFileSync(join(repo, '.gitignore'), '.vfkb/\n');
    g(['init', '-q'], brain);
    const r = runDoctor({ root: repo, brainDir: brain, env: {} });
    expect(r.checks.find((x) => x.name === 'brain gitlink')).toBeUndefined();
    expect(r.checks.some((c) => c.status === 'fail')).toBe(false);
  });

  it('WARNS on the canonical shape — gitlinked before the operator ever committed it', async () => {
    // This is what the defect actually produced: `vfkb init` made the brain, a pi
    // session gitlinked it, and nothing had been committed yet. Gating the check on
    // "did the project track it" made doctor permanently MUTE in exactly this case —
    // the one it was written for.
    const { runDoctor } = await import('./doctor.js');
    const { repo, brain } = repoWithBrain();
    root = repo;
    g(['init', '-q'], brain); // never committed by the outer repo
    const c = runDoctor({ root: repo, brainDir: brain, env: {} }).checks.find(
      (x) => x.name === 'brain gitlink',
    );
    expect(c?.status).toBe('warn');
    expect(c?.detail).toMatch(/exits 0 and tracks nothing/);
  });

  it('detects a STAGED-but-uncommitted brain as owned by the project', async () => {
    // `git log` throws in a repo with no commits; chaining it with `||` inside one try
    // meant `ls-files` never ran, so a staged brain — an unambiguous ownership claim —
    // was missed.
    const { runDoctor } = await import('./doctor.js');
    const { repo, brain } = repoWithBrain();
    root = repo;
    g(['add', '--', '.vfkb/entries.jsonl'], repo); // staged, never committed
    g(['init', '-q'], brain);
    const c = runDoctor({ root: repo, brainDir: brain, env: {} }).checks.find(
      (x) => x.name === 'brain gitlink',
    );
    expect(c?.status).toBe('fail');
  });

  it('says nothing when the brain is clean (no embedded repo at all)', async () => {
    const { runDoctor } = await import('./doctor.js');
    const { repo, brain } = repoWithBrain();
    root = repo;
    const r = runDoctor({ root: repo, brainDir: brain, env: {} });
    expect(r.checks.find((x) => x.name === 'brain gitlink')).toBeUndefined();
  });
});
