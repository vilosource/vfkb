import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setStorageBackend, storageBackend } from '../src/backend.js';
import type { StorageBackend } from '../src/backend.js';
import { newEntriesSinceHead, realGit, runSessionEnd } from '../src/session-end.js';
import type { GitRunner } from '../src/session-end.js';

// vfkb#448: SessionEnd's floor. Driven through runSessionEnd in a real git repo, with the real
// JSONL backend wrapped so whole-brain reads and index-meta writes can be counted.
//  - Index meta (a whole-brain materialize) is written ONCE per run, AFTER the commit, and
//    only if the run wrote to the brain, including when curation or the commit throws.
//  - `git add` (a second hash of the whole brain) runs only for a brain git does not track.
//  - newEntriesSinceHead parses only lines whose id is not already in HEAD.

const day = (d: number) => new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString();
const line = (id: string, created: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    id, type: 'fact', text: `HANDOFF ${id}: what happened, what is next`, tags: ['handoff', 'next'],
    zone: 'established', author: { role: 'human' }, provenance: { status: 'verified', date: created },
    validity: { valid_from: created }, created, updated: created, ...extra,
  }) + '\n';
// K curable old handoffs, then the pin and its chain.
const seedLines = (k: number) =>
  Array.from({ length: k }, (_, i) => line(`old${i}`, day(i))).join('') +
  line('n1', day(60)) + line('n2', day(65)) + line('pin', day(70));
const fact = (id: string) => line(id, day(80), { text: `a topical fact ${id}`, tags: ['topic'] });

let dir = '';
const entries = () => join(dir, '.vfkb', 'entries.jsonl');
const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function repo(seed: string) {
  dir = mkdtempSync(join(tmpdir(), 'vfkb-448-'));
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'p@example.invalid');
  g('config', 'user.name', 'p');
  g('config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, '.vfkb'));
  writeFileSync(join(dir, '.gitignore'), '.vfkb/.sessions/\n.vfkb/.journal/\n.vfkb/.lock\n.vfkb/index-meta.json\n');
  writeFileSync(entries(), seed);
  g('add', '-A');
  g('commit', '-qm', 'seed');
  g('branch', 'work');
  g('symbolic-ref', 'HEAD', 'refs/heads/work');
}

const events: string[] = [];
let reads = 0;
let metaWrites = 0;
let lastMeta: string | null = null;
let failAppend: number | null = null;
let restore: StorageBackend;
const countingBackend = (real: StorageBackend): StorageBackend =>
  new Proxy(real, {
    get(t, p, r) {
      if (p === 'readAllRaw') return () => { reads++; return t.readAllRaw(); };
      if (p === 'writeMetaRaw') return (j: string) => { metaWrites++; lastMeta = j; events.push('meta'); return t.writeMetaRaw(j); };
      if (p === 'append') return (rec: unknown) => {
        if (failAppend !== null && --failAppend === 0) throw new Error('disk full');
        return t.append(rec);
      };
      const v = Reflect.get(t, p, r);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
const gitLog: GitRunner = (args, cwd) => {
  events.push(args[0]);
  return realGit(args, cwd);
};
const end = (git: GitRunner = gitLog) =>
  runSessionEnd({ cwd: dir, dataDir: '.vfkb', sessionId: 'sess-448', git, now: () => 0 });

beforeEach(() => {
  events.length = 0; reads = 0; metaWrites = 0; lastMeta = null; failAppend = null;
  delete process.env.VFKB_DIR; delete process.env.KB_SESSION_ID;
  restore = setStorageBackend(countingBackend(storageBackend()));
});
afterEach(() => {
  setStorageBackend(restore);
  rmSync(dir, { recursive: true, force: true });
});

describe('vfkb#448 — index meta is written once, after the commit', () => {
  it('curation plus the B2 fallback: two whole-brain reads, one meta write, after the commit', () => {
    repo(seedLines(12));
    appendFileSync(entries(), fact('newfact'));
    const r = end();
    expect(r).toMatchObject({ committed: true, curated: 12, autoHandoff: true });
    expect(reads).toBe(2); // curation's snapshot + the one meta write (was 3)
    expect(metaWrites).toBe(1);
    expect(events.indexOf('meta')).toBeGreaterThan(events.indexOf('commit'));
    // The one write saw every line: the seed, the new fact and the fallback.
    expect(JSON.parse(lastMeta!).entry_count).toBe(12 + 3 + 1 + 1);
  });

  it('a run that writes nothing to the brain writes no meta', () => {
    repo(line('pin', day(70))); // nothing curable
    appendFileSync(entries(), line('newpin', day(80)));
    const r = end();
    expect(r).toMatchObject({ committed: true, curated: 0, autoHandoff: false });
    expect(metaWrites).toBe(0);
    expect(reads).toBe(1); // curation's snapshot only
  });

  it('a commit that fails still refreshes meta for what was written', () => {
    repo(seedLines(0));
    appendFileSync(entries(), fact('newfact'));
    const failing: GitRunner = (args, cwd) => {
      if (args[0] === 'commit') throw new Error('hook rejected');
      return realGit(args, cwd);
    };
    expect(end(failing)).toMatchObject({ committed: false, reason: 'error' });
    expect(metaWrites).toBe(1);
    expect(JSON.parse(lastMeta!).entry_count).toBe(3 + 1 + 1); // seed, new fact, fallback
  });

  it('curation that throws after writing still refreshes meta, and the commit still lands', () => {
    repo(seedLines(4));
    appendFileSync(entries(), line('newpin', day(80)));
    failAppend = 2; // the first archive lands, the second throws
    const r = end();
    expect(r.committed).toBe(true);
    expect(metaWrites).toBe(1);
    expect(g('log', '-1', '--format=%s')).toContain('session-end auto-commit');
  });
});

describe('vfkb#448 — git add only for a brain git does not track', () => {
  it('a tracked brain commits without git add, and pre-staged files stay out', () => {
    repo(seedLines(0));
    writeFileSync(join(dir, 'other.txt'), 'staged by the operator');
    g('add', 'other.txt');
    appendFileSync(entries(), line('newpin', day(80)));
    expect(end()).toMatchObject({ committed: true });
    expect(events).not.toContain('add');
    expect(g('show', '--name-only', '--format=', 'HEAD')).toBe('.vfkb/entries.jsonl');
    expect(g('show', 'HEAD:.vfkb/entries.jsonl')).toContain('newpin');
    expect(g('diff', '--cached', '--name-only')).toBe('other.txt');
    expect(g('status', '--porcelain', '--', '.vfkb/entries.jsonl')).toBe('');
  });

  it('an untracked brain is added and committed', () => {
    repo(seedLines(0));
    g('rm', '-q', '--cached', '.vfkb/entries.jsonl');
    g('commit', '-qm', 'untrack');
    expect(g('status', '--porcelain', '--', '.vfkb/entries.jsonl')).toContain('??');
    expect(end()).toMatchObject({ committed: true });
    expect(events).toContain('add');
    expect(g('show', 'HEAD:.vfkb/entries.jsonl')).toContain('"pin"');
  });
});

describe('vfkb#448 — newEntriesSinceHead parses only what it must', () => {
  it('known lines are not parsed: 2 new among 300 costs a handful of JSON.parse calls', () => {
    repo(Array.from({ length: 300 }, (_, i) => fact(`k${i}`)).join(''));
    appendFileSync(entries(), fact('new1') + fact('new2'));
    const parse = vi.spyOn(JSON, 'parse');
    const fresh = newEntriesSinceHead(realGit, dir, entries());
    const calls = parse.mock.calls.length;
    parse.mockRestore();
    expect(fresh.map((e) => e.id).sort()).toEqual(['new1', 'new2']);
    expect(calls).toBe(2);
  });

  it('agrees with a full parse on every line shape the fast path does not cover', () => {
    const notFirst = (id: string) => JSON.stringify({ type: 'fact', id, text: 't', tags: [] }) + '\n';
    repo(notFirst('oldodd') + fact('edited') + fact('gone'));
    appendFileSync(
      entries(),
      notFirst('oldodd') + // an id-not-first line already in HEAD: not new
      line('edited', day(81), { text: 'edited' }) + // an edit of a known id: not new
      notFirst('newodd') + // an id-not-first line not in HEAD: new
      '{"id":"torn","type":"fact"\n' + // a torn line: ignored
      line('added', day(82)) +
      JSON.stringify({ id: 'added2', deleted: true }) + '\n', // added then deleted: not new
    );
    expect(newEntriesSinceHead(realGit, dir, entries()).map((e) => e.id).sort()).toEqual(['added', 'newodd']);
  });

  it('a torn line in HEAD does not hide the same id written properly', () => {
    repo('{"id":"torn","type":"fact"\n' + fact('k1'));
    appendFileSync(entries(), fact('torn'));
    expect(newEntriesSinceHead(realGit, dir, entries()).map((e) => e.id)).toEqual(['torn']);
  });
});
