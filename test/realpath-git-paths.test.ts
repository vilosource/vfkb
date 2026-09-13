// Brake for the symlink/realpath class (src/realpath.ts).
//
// WHY THIS FILE EXISTS SEPARATELY from the three suites that already cover these
// behaviours: those suites reproduced the bug only on macOS, and only by accident.
// `mkdtempSync(tmpdir())` there yields /var/folders/… while /var is a symlink to
// /private/var, so every temp repo was silently a symlinked path and git's realpath
// answers disagreed with the engine's spelling. On Linux CI /tmp is real, the two
// spellings matched, and all three suites passed GREEN with the defect fully live —
// which is exactly how it survived to be found by hand.
//
// So these tests build the symlink EXPLICITLY (<root>/link -> <root>/real) and address
// every path through it. That reproduces the macOS condition on any platform, making
// this the arm that can actually fail in CI. Deleting src/realpath.ts's fix turns each
// of these red on Linux; the original suites would not notice.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { realPath, relativeReal, samePathReal } from '../src/realpath.js';

let root: string;
let linkedRepo: string;

const g = (args: string[], cwd: string) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * A git repo reachable by two spellings: its real path, and one that traverses a
 * symlink. Returns the SYMLINKED spelling — what a caller would hold — while git,
 * asked from inside, will always answer with the real one.
 */
function symlinkedRepo(): string {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'vfkb-symlink-')));
  const real = join(root, 'real');
  mkdirSync(join(real, 'repo', '.vfkb'), { recursive: true });
  symlinkSync(real, join(root, 'link'), 'dir');
  const repo = join(root, 'link', 'repo');
  g(['init', '-q'], repo);
  g(['config', 'user.email', 't@t'], repo);
  g(['config', 'user.name', 't'], repo);
  return repo;
}

beforeEach(() => {
  linkedRepo = symlinkedRepo();
});
afterEach(() => {
  delete process.env.VFKB_DIR;
  delete process.env.VFKB_NO_JOURNAL;
  rmSync(root, { recursive: true, force: true });
});

describe('the symlinked spelling really is the condition under test', () => {
  it('git answers with the realpath while the caller holds the link — they differ', () => {
    const top = g(['rev-parse', '--show-toplevel'], linkedRepo).trim();
    expect(top).not.toBe(linkedRepo); // if these were equal the tests below would be vacuous
    expect(realPath(top)).toBe(realPath(linkedRepo));
  });
});

describe('src/realpath.ts', () => {
  it('relativeReal resolves both sides; plain relative would escape the repo', () => {
    const top = g(['rev-parse', '--show-toplevel'], linkedRepo).trim();
    const rel = relativeReal(top, join(linkedRepo, '.vfkb', 'entries.jsonl'));
    expect(rel).toBe('.vfkb/entries.jsonl');
    expect(rel.startsWith('..')).toBe(false); // the defect's signature
  });

  it('samePathReal sees through the symlink where resolve() cannot', () => {
    const top = g(['rev-parse', '--show-toplevel'], linkedRepo).trim();
    expect(samePathReal(linkedRepo, top)).toBe(true);
  });

  it('realPath falls back to the resolved spelling for a path that does not exist yet', () => {
    const missing = join(linkedRepo, 'not-created-yet.jsonl');
    expect(() => realPath(missing)).not.toThrow();
    expect(realPath(missing)).toContain('not-created-yet.jsonl');
  });

  it('relativeReal emits POSIX separators for git pathspecs', () => {
    expect(relativeReal(linkedRepo, join(linkedRepo, 'a', 'b'))).toBe('a/b');
  });
});

describe('journal prune through a symlinked brain (ADR-0064)', () => {
  it('drops pairs committed at HEAD instead of growing the wal forever', async () => {
    const { addEntry } = await import('../src/engine.js');
    const { recoverFromJournal } = await import('../src/journal.js');
    const brain = join(linkedRepo, '.vfkb');
    process.env.VFKB_DIR = brain;
    delete process.env.VFKB_NO_JOURNAL;

    const a = addEntry('fact', 'gets committed', { role: 'human' });
    g(['add', '.vfkb/entries.jsonl'], linkedRepo);
    g(['commit', '-qm', 'commit a'], linkedRepo);
    const b = addEntry('fact', 'stays uncommitted', { role: 'human' });

    recoverFromJournal(brain);
    const wal = join(brain, '.journal', 'wal.jsonl');
    const text = execFileSync('cat', [wal], { encoding: 'utf8' });
    // Pre-fix: pairsAtHead() returned 'unknown' (cat-file threw on a pathspec that
    // climbed out of the repo), prune kept everything, and a.id stayed forever.
    expect(text).not.toContain(a.id);
    expect(text).toContain(b.id);
  });
});

describe('stale-handoff nudge through a symlinked brain (ADR-0034)', () => {
  it('sees a non-brain commit landed after the pinned handoff', async () => {
    const { handoffIsStale } = await import('../src/stop-reminder.js');
    const brain = join(linkedRepo, '.vfkb');
    const handoffTs = '2030-01-01T00:00:00Z';
    writeFileSync(
      join(brain, 'entries.jsonl'),
      JSON.stringify({
        id: 'h1',
        type: 'fact',
        text: 'h',
        tags: ['handoff', 'next'],
        zone: 'established',
        author: { role: 'human' },
        provenance: { status: 'verified' },
        validity: { valid_from: handoffTs },
        created: handoffTs,
        updated: handoffTs,
      }) + '\n',
    );
    const dated = (files: string[], when: string, msg: string) => {
      execFileSync('git', ['-C', linkedRepo, 'add', ...files], { stdio: 'ignore' });
      execFileSync('git', ['-C', linkedRepo, 'commit', '-qm', msg], {
        stdio: 'ignore',
        env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
      });
    };
    dated(['.vfkb/entries.jsonl'], handoffTs, 'handoff');
    mkdirSync(join(linkedRepo, 'src'), { recursive: true });
    writeFileSync(join(linkedRepo, 'src', 'bar.ts'), 'export const y = 1;\n');
    dated(['src/bar.ts'], '2030-06-01T00:00:00Z', 'merged PR');

    // Pre-fix: the :(exclude) pathspec pointed outside the repo, so the non-brain
    // commit was invisible and a stale handoff never nudged.
    expect(handoffIsStale(linkedRepo, brain)).toBe(true);
  });
});

describe('a brain that lives OUTSIDE the repo (the documented standalone shape)', () => {
  // src/git.ts insideSurroundingRepo calls this shape "documented … not exotic".
  // Realpathing the brain is what makes it reachable here: the exclude pathspec
  // then points outside the worktree, `git diff` exits 128 rather than 1, and the
  // handler — which counts only exit 1 as "a real diff" — fails open. The nudge
  // dies silently, which is precisely the defect class this module removes.
  // Caught by the ADR-0052 review of PR #281 as a regression this fix introduced.
  it('still nudges when the brain is symlinked outside the worktree', async () => {
    const { handoffIsStale } = await import('../src/stop-reminder.js');
    const outside = join(root, 'brain-outside');
    mkdirSync(outside, { recursive: true });
    rmSync(join(linkedRepo, '.vfkb'), { recursive: true, force: true }); // fixture made a real dir
    symlinkSync(outside, join(linkedRepo, '.vfkb'), 'dir');

    const handoffTs = '2030-01-01T00:00:00Z';
    writeFileSync(
      join(outside, 'entries.jsonl'),
      JSON.stringify({
        id: 'h1',
        type: 'fact',
        text: 'h',
        tags: ['handoff', 'next'],
        zone: 'established',
        author: { role: 'human' },
        provenance: { status: 'verified' },
        validity: { valid_from: handoffTs },
        created: handoffTs,
        updated: handoffTs,
      }) + '\n',
    );
    const dated = (files: string[], when: string, msg: string) => {
      execFileSync('git', ['-C', linkedRepo, 'add', ...files], { stdio: 'ignore' });
      execFileSync('git', ['-C', linkedRepo, 'commit', '-qm', msg], {
        stdio: 'ignore',
        env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
      });
    };
    mkdirSync(join(linkedRepo, 'src'), { recursive: true });
    writeFileSync(join(linkedRepo, 'src', 'seed.ts'), 'export const s = 0;\n');
    dated(['src/seed.ts'], handoffTs, 'seed');
    writeFileSync(join(linkedRepo, 'src', 'bar.ts'), 'export const y = 1;\n');
    dated(['src/bar.ts'], '2030-06-01T00:00:00Z', 'merged PR');

    expect(handoffIsStale(linkedRepo, join(linkedRepo, '.vfkb'))).toBe(true);
  });
});

describe('doctor brain-gitlink through a symlinked root brain', () => {
  it('stays SILENT when the brain dir IS the repo root — never says `rm <root>/.git`', async () => {
    const { runDoctor } = await import('../src/doctor.js');
    // VFKB_DATA_DIR=. shape: entries.jsonl at the root, tracked by the project's own git.
    writeFileSync(join(linkedRepo, 'entries.jsonl'), '{"id":"a"}\n');
    g(['add', '-A'], linkedRepo);
    g(['commit', '-qm', 'root brain'], linkedRepo);

    const c = runDoctor({ root: linkedRepo, brainDir: linkedRepo, env: {} }).checks.find(
      (x) => x.name === 'brain gitlink',
    );
    // Pre-fix: resolve() compared the link against git's realpath, brainIsRoot was
    // false, and this fired FAIL with the remedy "remove <root>/.git" — the project's
    // entire history — on a perfectly healthy repo.
    expect(c).toBeUndefined();
  });
});
