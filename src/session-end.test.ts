// GAP-2 deterministic gate (RFC-011 / ADR-0033, ADR-0029 proof for the auto-commit
// mechanism): the SessionEnd hook auto-commits the brain into the SURROUNDING repo,
// on a topic branch, scoped to entries.jsonl, NEVER on the default branch, and never
// sweeping in the operator's pre-staged files. Runs against a real throwaway git repo
// (the mechanism is git behaviour, so we exercise real git — not a mock).

import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessionEnd, brainEntriesRelPath } from './session-end.js';

let repo: string;
const git = (args: string[], cwd = repo) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const ENTRIES = '.vfkb/entries.jsonl';

function addEntry(line = '{"id":"x","type":"fact","text":"t"}') {
  appendFileSync(join(repo, ENTRIES), line + '\n');
}
// A handoff-tagged entry suppresses the B2 auto-handoff — use it to keep the
// GAP-2 commit-mechanics tests isolated from the GAP-1 (B2) behaviour.
const HANDOFF_ENTRY = '{"id":"h","type":"fact","text":"next: do the thing","tags":["handoff"]}';
const readEntries = (): Array<{ id?: string; type?: string; text?: string; tags?: string[] }> =>
  readFileSync(join(repo, ENTRIES), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'vfkb-se-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(repo, '.vfkb'), { recursive: true });
  writeFileSync(join(repo, ENTRIES), '');
  writeFileSync(join(repo, 'README.md'), '# repo\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'init']);
});

describe('brainEntriesRelPath — POSIX normalization for git HEAD: lookup', () => {
  it('passes posix paths through unchanged', () => {
    expect(brainEntriesRelPath('.vfkb')).toBe('.vfkb/entries.jsonl');
  });
  it('normalizes backslashes to forward slashes (the Windows git HEAD: bug)', () => {
    // simulates a win32 path.join result / a backslash-containing dataDir
    expect(brainEntriesRelPath('sub\\.vfkb')).toBe('sub/.vfkb/entries.jsonl');
  });
});

describe('SessionEnd auto-commit (GAP 2)', () => {
  it('commits ONLY entries.jsonl on a topic branch, attribution-free message', () => {
    git(['checkout', '-q', '-b', 'feat/work']);
    addEntry(HANDOFF_ENTRY); // handoff present → no B2 auto-handoff, keeps added=1
    const r = runSessionEnd({ cwd: repo, dataDir: '.vfkb', sessionId: 'abcd1234efgh' });

    expect(r.committed).toBe(true);
    expect(r.reason).toBe('committed');
    expect(r.branch).toBe('feat/work');
    expect(r.added).toBe(1);

    // The HEAD commit touches only the brain file.
    const files = git(['show', '--name-only', '--pretty=format:', 'HEAD']).split('\n').filter(Boolean);
    expect(files).toEqual([ENTRIES]);

    const msg = git(['log', '-1', '--pretty=%B']);
    expect(msg).toContain('chore(brain): session-end auto-commit');
    expect(msg).toContain('session abcd1234'); // short id
    // No AI attribution anywhere in the message.
    expect(msg.toLowerCase()).not.toContain('claude');
    expect(msg).not.toContain('Co-Authored-By');
    expect(msg).not.toContain('🤖');
  });

  it('NEVER commits on the default branch (main) — warns instead', () => {
    addEntry(); // still on main
    const head = git(['rev-parse', 'HEAD']);
    const r = runSessionEnd({ cwd: repo, dataDir: '.vfkb' });

    expect(r.committed).toBe(false);
    expect(r.reason).toBe('on-default-branch');
    expect(r.systemMessage).toContain('main');
    expect(r.systemMessage).toContain('branch + commit');
    expect(git(['rev-parse', 'HEAD'])).toBe(head); // no new commit
    expect(git(['status', '--porcelain', '--', ENTRIES])).not.toBe(''); // still dirty
  });

  it('does NOT sweep in the operator\'s pre-staged files (pathspec --only)', () => {
    git(['checkout', '-q', '-b', 'feat/work']);
    // Operator has staged their own file for a separate commit.
    writeFileSync(join(repo, 'src.txt'), 'operator work\n');
    git(['add', 'src.txt']);
    addEntry(HANDOFF_ENTRY); // isolate from B2

    const r = runSessionEnd({ cwd: repo, dataDir: '.vfkb' });
    expect(r.committed).toBe(true);

    // The auto-commit must contain ONLY entries.jsonl, not src.txt.
    const files = git(['show', '--name-only', '--pretty=format:', 'HEAD']).split('\n').filter(Boolean);
    expect(files).toEqual([ENTRIES]);
    // src.txt is still staged (untouched), not committed.
    expect(git(['diff', '--cached', '--name-only'])).toBe('src.txt');
  });

  it('is a no-op when the brain is clean', () => {
    git(['checkout', '-q', '-b', 'feat/work']);
    const head = git(['rev-parse', 'HEAD']);
    const r = runSessionEnd({ cwd: repo, dataDir: '.vfkb' });
    expect(r.committed).toBe(false);
    expect(r.reason).toBe('brain-clean');
    expect(git(['rev-parse', 'HEAD'])).toBe(head);
  });

  it('warns and does not commit on a detached HEAD', () => {
    git(['checkout', '-q', '-b', 'feat/work']);
    addEntry();
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'pin']);
    git(['checkout', '-q', '--detach']);
    addEntry();
    const r = runSessionEnd({ cwd: repo, dataDir: '.vfkb' });
    expect(r.committed).toBe(false);
    expect(r.reason).toBe('detached-head');
    expect(r.systemMessage).toContain('detached HEAD');
  });

  it('is a no-op (not-a-repo) outside a git work tree', () => {
    const bare = mkdtempSync(join(tmpdir(), 'vfkb-nogit-'));
    mkdirSync(join(bare, '.vfkb'), { recursive: true });
    writeFileSync(join(bare, ENTRIES), '{"id":"x"}\n');
    const r = runSessionEnd({ cwd: bare, dataDir: '.vfkb' });
    expect(r.committed).toBe(false);
    expect(r.reason).toBe('not-a-repo');
  });

  // GAP 1 (B2 deterministic floor): when a session records knowledge but no handoff,
  // SessionEnd writes a fallback handoff enumerating the new entries, then commits it.
  it('writes & commits an auto-handoff when the session left none (B2)', () => {
    git(['checkout', '-q', '-b', 'feat/work']);
    addEntry('{"id":"k1","type":"decision","text":"chose approach X over Y"}');
    addEntry('{"id":"k2","type":"gotcha","text":"watch out for Z"}');

    const r = runSessionEnd({ cwd: repo, dataDir: '.vfkb' });
    expect(r.committed).toBe(true);
    expect(r.autoHandoff).toBe(true);

    const entries = readEntries();
    const auto = entries.find((e) => (e.tags ?? []).includes('auto'));
    expect(auto).toBeDefined();
    expect(auto!.tags).toEqual(expect.arrayContaining(['handoff', 'next', 'auto']));
    // It enumerates the session's real entries (so a fresh clone has a pointer).
    expect(auto!.text).toContain('k1');
    expect(auto!.text).toContain('k2');

    // It is COMMITTED (survives a fresh clone), in a commit touching only the brain.
    const files = git(['show', '--name-only', '--pretty=format:', 'HEAD']).split('\n').filter(Boolean);
    expect(files).toEqual([ENTRIES]);
    expect(git(['status', '--porcelain', '--', ENTRIES])).toBe(''); // fully committed
  });

  it('does NOT write an auto-handoff when the session already recorded one (B2)', () => {
    git(['checkout', '-q', '-b', 'feat/work']);
    addEntry('{"id":"k1","type":"fact","text":"some work"}');
    addEntry(HANDOFF_ENTRY); // agent authored a real handoff this session

    const r = runSessionEnd({ cwd: repo, dataDir: '.vfkb' });
    expect(r.committed).toBe(true);
    expect(r.autoHandoff).toBe(false);
    expect(readEntries().some((e) => (e.tags ?? []).includes('auto'))).toBe(false);
  });
});
