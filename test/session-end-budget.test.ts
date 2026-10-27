// vfkb#384 (ADR-0084 §4 / RFC-047 §4.2) — the SessionEnd floor under Claude Code's
// 1.5 s SessionEnd budget. Four defects/guards, each with an arm that goes RED when the
// fix is removed:
//
// 1. ENOBUFS (found by the #384 decide step, observed on this repo's own brain): every
//    `git show HEAD:<brain>` ran through execFileSync's default 1 MiB maxBuffer. Once a
//    committed brain passes 1 MiB the read throws, the catch reads it as "nothing at
//    HEAD", and EVERY entry counts as new. Effects: the auto-commit message claims
//    hundreds of new entries, B2 is skipped whenever any old entry is a handoff (so the
//    floor silently vanishes), the Stop decision/B1 counts go wrong, and the journal
//    never prunes (HEAD 'unknown').
// 2. An absolute dataDir (the plugin passes VFKB_DATA_DIR=${CLAUDE_PROJECT_DIR}/.vfkb)
//    produced `git show HEAD:/abs/path`, which git rejects — same symptom as 1.
// 3. The curation deadline (decide step, ruling 54802539cda7): ADR-0083 Tier-1 curation
//    is fail-open and is the one SessionEnd step that can run long; it starts only
//    before SESSION_END_CURATION_DEADLINE_MS on the process clock and stops between
//    archives once the deadline passes. The B2 fallback and the single commit are
//    never shed.
// 4. The end marker (decide step): the hook opens `sessionEnd` on its session record
//    before touching git and closes it after, so `vfkb doctor` can tell a SessionEnd
//    that was cut off from one that finished (the record's pid cannot).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Real git over a >1 MiB brain and a spawned CLI: slow on a loaded machine, so a
// generous per-test timeout keeps a timing flake from reading as a regression.
vi.setConfig({ testTimeout: 30_000 });
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  runSessionEnd,
  SESSION_END_COMMIT_PREFIX,
  SESSION_END_CURATION_DEADLINE_MS,
} from '../src/session-end.js';
import { newBrainEntriesSinceHead } from '../src/stop-reminder.js';
import { addEntry } from '../src/engine.js';
import { recoverFromJournal } from '../src/journal.js';
import { AUTO_ARCHIVED } from '../src/curator.js';

let repo: string;
const ENTRIES = '.vfkb/entries.jsonl';
const git = (args: string[], cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function line(o: Record<string, unknown>): string {
  return JSON.stringify(o) + '\n';
}
// A committed-brain line that looks like a real entry, padded so the file crosses 1 MiB.
function filler(i: number): string {
  return line({
    id: `old${String(i).padStart(5, '0')}`,
    type: 'fact',
    text: `filler ${i} ` + 'x'.repeat(1000),
    tags: [],
    zone: 'established',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
  });
}
const OLD_HANDOFF = line({
  id: 'oldhandoff',
  type: 'fact',
  text: 'next: an older handoff already committed',
  tags: ['handoff', 'next'],
  zone: 'established',
  created: '2026-01-02T00:00:00.000Z',
  updated: '2026-01-02T00:00:00.000Z',
});
const NEW_FACT = line({
  id: 'newfact1',
  type: 'fact',
  text: 'the one entry this session added',
  tags: [],
  zone: 'established',
  created: '2026-01-03T00:00:00.000Z',
  updated: '2026-01-03T00:00:00.000Z',
});

function initRepo(): void {
  repo = mkdtempSync(join(tmpdir(), 'vfkb-se384-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(repo, '.vfkb'), { recursive: true });
}
function commitBrain(text: string): void {
  writeFileSync(join(repo, ENTRIES), text);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'brain']);
  git(['checkout', '-q', '-b', 'feat/work']);
}
const BIG = (): string => {
  let s = OLD_HANDOFF;
  for (let i = 0; i < 1200; i++) s += filler(i);
  return s;
};
const autoHandoffs = () =>
  readFileSync(join(repo, ENTRIES), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => (e.tags ?? []).includes('auto'));

let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  savedEnv = { VFKB_DATA_DIR: process.env.VFKB_DATA_DIR, VFKB_DIR: process.env.VFKB_DIR, KB_SESSION_ID: process.env.KB_SESSION_ID };
  delete process.env.KB_SESSION_ID;
  initRepo();
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('#384 — a committed brain over 1 MiB (ENOBUFS)', () => {
  it('the fixture really is over the 1 MiB default buffer', () => {
    expect(Buffer.byteLength(BIG())).toBeGreaterThan(1024 * 1024);
  });

  it('session-end counts ONE new entry and still writes the B2 fallback', () => {
    commitBrain(BIG());
    appendFileSync(join(repo, ENTRIES), NEW_FACT);
    const r = runSessionEnd({ cwd: repo, dataDir: '.vfkb' });
    expect(r.committed).toBe(true);
    expect(r.autoHandoff).toBe(true);
    // 1 session entry + the B2 fallback written in the same commit.
    expect(r.added).toBe(2);
    expect(git(['log', '-1', '--pretty=%s'])).toContain('(2 new entries');
    const auto = autoHandoffs();
    expect(auto).toHaveLength(1);
    expect(auto[0].text).toContain('added 1 brain entry');
    expect(auto[0].text).toContain('newfact1');
  });

  it('stop-reminder sees exactly the one appended line, not the whole brain', () => {
    commitBrain(BIG());
    appendFileSync(join(repo, ENTRIES), NEW_FACT);
    expect(newBrainEntriesSinceHead(join(repo, '.vfkb'), repo)).toHaveLength(1);
  });

  it('the journal can read HEAD and prunes a committed pair', () => {
    writeFileSync(join(repo, ENTRIES), BIG());
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'big brain']);
    process.env.VFKB_DIR = join(repo, '.vfkb');
    delete process.env.VFKB_DATA_DIR;
    addEntry('fact', 'journaled then committed', { role: 'human' });
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'commit the new entry']);
    expect(recoverFromJournal(join(repo, '.vfkb')).pruned).toBeGreaterThanOrEqual(1);
  });
});

describe('#384 — an absolute dataDir (the plugin wiring)', () => {
  it('reads HEAD through the absolute path and counts only the new entry', () => {
    commitBrain(OLD_HANDOFF);
    appendFileSync(join(repo, ENTRIES), NEW_FACT);
    const r = runSessionEnd({ cwd: repo, dataDir: join(repo, '.vfkb') });
    expect(r.committed).toBe(true);
    expect(r.autoHandoff).toBe(true);
    expect(r.added).toBe(2);
    // Commit is still pathspec-scoped to the brain file.
    expect(git(['show', '--name-only', '--pretty=format:', 'HEAD']).split('\n').filter(Boolean)).toEqual([ENTRIES]);
  });
});

// ADR-0083 fixture: an old shaped handoff the Tier-1 rule archives once three newer
// shaped handoffs (pin included) exist. Committed at HEAD; the session adds one fact.
function curationFixture(): void {
  const h = (id: string, d: number) =>
    line({
      id,
      type: 'fact',
      text: `HANDOFF ${id}: what happened, what is next`,
      tags: ['handoff', 'next'],
      zone: 'established',
      author: { role: 'human' },
      provenance: { status: 'verified' },
      created: new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString(),
      updated: new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString(),
    });
  commitBrain(h('veryold', 0) + h('old', 1) + h('n1', 30) + h('n2', 35) + h('pin', 40));
  appendFileSync(join(repo, ENTRIES), NEW_FACT);
}
const archivedLines = () =>
  readFileSync(join(repo, ENTRIES), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => (e.tags ?? []).some((t: string) => t.startsWith(AUTO_ARCHIVED)));
const commitCount = () => Number(git(['rev-list', '--count', 'HEAD']));

describe('#384 — the curation deadline (ADR-0083 §3 fail-open, made bounded)', () => {
  it('deadline is 1000 ms on the process clock', () => {
    expect(SESSION_END_CURATION_DEADLINE_MS).toBe(1000);
  });

  it('before the deadline: curation runs and rides the one commit', () => {
    curationFixture();
    const before = commitCount();
    const r = runSessionEnd({ cwd: repo, dataDir: '.vfkb', now: () => 0 });
    expect(r.committed).toBe(true);
    expect(r.curated).toBe(2);
    expect(r.curationSkipped).toBeUndefined();
    expect(commitCount()).toBe(before + 1);
    expect(git(['log', '-1', '--pretty=%s'])).toContain('2 curated');
  });

  it('past the deadline: curation is skipped, B2 still written, exactly ONE commit', () => {
    curationFixture();
    const before = commitCount();
    const r = runSessionEnd({ cwd: repo, dataDir: '.vfkb', now: () => 2000 });
    expect(r.committed).toBe(true);
    expect(r.curationSkipped).toBe('deadline');
    expect(r.curated ?? 0).toBe(0);
    expect(r.autoHandoff).toBe(true);
    expect(archivedLines()).toHaveLength(0);
    expect(commitCount()).toBe(before + 1);
    expect(git(['log', '-1', '--pretty=%s'])).not.toContain('curated');
    expect(git(['status', '--porcelain', '--', ENTRIES])).toBe('');
  });

  it('the deadline passing mid-loop stops after the archive in flight', () => {
    curationFixture();
    // The clock reads 0 until the first archive line lands in the brain, then jumps
    // past the deadline — no test-only seam inside the engine.
    const r = runSessionEnd({
      cwd: repo,
      dataDir: '.vfkb',
      now: () => (archivedLines().length > 0 ? 5000 : 0),
    });
    expect(r.committed).toBe(true);
    expect(archivedLines()).toHaveLength(1);
    expect(r.curated).toBe(1);
    expect(r.curationSkipped).toBe('deadline');
  });
});

describe('#384 — the commit-subject prefix is one shared definition', () => {
  it('runSessionEnd writes a subject starting with SESSION_END_COMMIT_PREFIX', () => {
    commitBrain(OLD_HANDOFF);
    appendFileSync(join(repo, ENTRIES), NEW_FACT);
    runSessionEnd({ cwd: repo, dataDir: '.vfkb' });
    expect(git(['log', '-1', '--pretty=%s']).startsWith(SESSION_END_COMMIT_PREFIX)).toBe(true);
  });
});

// The marker is written by the CLI hook (cli.ts), so this drives the built CLI.
const CLI = resolve(__dirname, '..', 'dist', 'cli.js');
function runHook(sub: string, payload: object, env: Record<string, string> = {}) {
  return spawnSync('node', [CLI, 'hook', sub], {
    cwd: repo,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, VFKB_DATA_DIR: join(repo, '.vfkb'), KB_SESSION_ID: '', ...env },
  });
}
const record = (id: string) => JSON.parse(readFileSync(join(repo, '.vfkb', '.sessions', `${id}.json`), 'utf8'));

describe('#384 — the SessionEnd marker on the session record', () => {
  it('a finished SessionEnd leaves the marker opened AND closed', () => {
    commitBrain(OLD_HANDOFF);
    appendFileSync(join(repo, ENTRIES), NEW_FACT);
    runHook('session-end', { session_id: 'sess-done-1', cwd: repo, reason: 'prompt_input_exit' });
    const m = record('sess-done-1').sessionEnd;
    expect(m.startedAt).toBeTruthy();
    expect(m.reason).toBe('prompt_input_exit');
    expect(m.outcome).toBe('committed');
    expect(typeof m.elapsedMs).toBe('number');
  });

  it('a SessionEnd killed mid-git leaves the marker open (no outcome)', () => {
    commitBrain(OLD_HANDOFF);
    appendFileSync(join(repo, ENTRIES), NEW_FACT);
    // A git shim that hangs on `status`, so the hook is killed after the opening write.
    const shim = join(repo, '..', `shim-${Date.now()}`);
    mkdirSync(shim, { recursive: true });
    const realGitPath = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    writeFileSync(
      join(shim, 'git'),
      `#!/bin/sh\nif [ "$1" = "status" ]; then sleep 30; fi\nexec "${realGitPath}" "$@"\n`,
      { mode: 0o755 },
    );
    const r = spawnSync('node', [CLI, 'hook', 'session-end'], {
      cwd: repo,
      input: JSON.stringify({ session_id: 'sess-cut-1', cwd: repo, reason: 'other' }),
      encoding: 'utf8',
      timeout: 1500,
      killSignal: 'SIGKILL',
      env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, VFKB_DATA_DIR: join(repo, '.vfkb'), KB_SESSION_ID: '' },
    });
    expect(r.signal).toBe('SIGKILL');
    const m = record('sess-cut-1').sessionEnd;
    expect(m.startedAt).toBeTruthy();
    expect(m.outcome).toBeUndefined();
  });

  it('SessionStart clears a marker (a resumed session is alive again)', () => {
    commitBrain(OLD_HANDOFF);
    mkdirSync(join(repo, '.vfkb', '.sessions'), { recursive: true });
    writeFileSync(
      join(repo, '.vfkb', '.sessions', 'sess-resume-1.json'),
      JSON.stringify({
        sessionId: 'sess-resume-1',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastAt: '2026-01-01T00:00:00.000Z',
        turnCount: 3,
        injectedIds: [],
        capturedIds: [],
        sessionEnd: { startedAt: '2026-01-01T00:00:01.000Z' },
      }),
    );
    runHook('session-start', { session_id: 'sess-resume-1', source: 'resume' });
    expect(record('sess-resume-1').sessionEnd).toBeUndefined();
  });

  it('no session id → no record is written', () => {
    commitBrain(OLD_HANDOFF);
    appendFileSync(join(repo, ENTRIES), NEW_FACT);
    runHook('session-end', { cwd: repo });
    const dir = join(repo, '.vfkb', '.sessions');
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });
});
