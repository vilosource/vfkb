import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setStorageBackend } from '../src/backend.js';
import type { StorageBackend, RawMalformed } from '../src/backend.js';
import { autoCurate } from '../src/curator.js';
import { readAll } from '../src/engine.js';
import { withBrainLock } from '../src/lock.js';

// vfkb#396: SessionEnd's floor must not grow with brain size × curation work, and the
// lock wait inside it must be bounded by the curation deadline.
//  1. autoCurate archives from the snapshot it read under the lock and writes the index
//     meta once: whole-brain reads stay constant however many entries it archives (it
//     was two whole-brain materializations PER archive: updateEntry's readAll, then
//     appendRecord's writeMeta).
//  2. With a deadline, a lock held by another live writer skips curation once the
//     deadline passes, instead of waiting the ADR-0040 5 s and then running unlocked.

const day = (d: number) => new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString();
const TODAY = '2026-03-01';
const handoff = (id: string, created: string) => ({
  id,
  type: 'fact',
  text: `HANDOFF ${id}: what happened, what is next`,
  tags: ['handoff', 'next'],
  zone: 'established',
  author: { role: 'human' },
  provenance: { status: 'verified', date: created },
  validity: { valid_from: created },
  created,
  updated: created,
});
// K old handoffs, each with >= 3 newer shaped handoffs (n1, n2, pin): all K qualify.
const seed = (k: number) => [
  ...Array.from({ length: k }, (_, i) => handoff(`old${i}`, day(i))),
  handoff('n1', day(60)),
  handoff('n2', day(65)),
  handoff('pin', day(70)),
];

class CountingBackend implements StorageBackend {
  readonly name = 'count-test';
  records: unknown[] = [];
  meta: string | null = null;
  reads = 0;
  metaWrites = 0;
  location() {
    return 'memory://count';
  }
  append(rec: unknown) {
    this.records.push(rec);
  }
  readAllRaw(): { records: unknown[]; malformed: RawMalformed[] } {
    this.reads++;
    return { records: [...this.records], malformed: [] };
  }
  readMetaRaw() {
    return this.meta;
  }
  writeMetaRaw(json: string) {
    this.metaWrites++;
    this.meta = json;
  }
  readSpine() {
    return null;
  }
  writeSpine() {}
  spinePath() {
    return 'memory://count/context.md';
  }
  listSessionIds() {
    return [];
  }
  readSessionRecord() {
    return null;
  }
  writeSessionRecord() {}
  withExclusive<T>(fn: () => T): T {
    return fn();
  }
}

describe('vfkb#396 — autoCurate cost does not scale with archives × brain', () => {
  it('archiving 12 entries reads the brain a constant number of times and writes meta once', () => {
    const be = new CountingBackend();
    be.records = seed(12);
    const prev = setStorageBackend(be);
    try {
      const r = autoCurate(TODAY);
      expect(r.archived).toHaveLength(12);
      // One read for the snapshot, one for the single writeMeta (was 1 + 2 per archive = 25).
      expect(be.reads).toBe(2);
      expect(be.metaWrites).toBe(1);
      // Same outcome as before: every old handoff is archived, the pin and its chain are not.
      const all = readAll();
      for (let i = 0; i < 12; i++) expect(all.find((e) => e.id === `old${i}`)!.zone).toBe('archive');
      for (const id of ['n1', 'n2', 'pin']) expect(all.find((e) => e.id === id)!.zone).toBe('established');
    } finally {
      setStorageBackend(prev);
    }
  });

  it('a write that throws mid-run still leaves meta written for what was appended', () => {
    const be = new CountingBackend();
    be.records = seed(4);
    let appends = 0;
    const append = be.append.bind(be);
    be.append = (rec: unknown) => {
      if (++appends === 2) throw new Error('disk full');
      append(rec);
    };
    const prev = setStorageBackend(be);
    try {
      expect(() => autoCurate(TODAY)).toThrow('disk full');
      expect(be.metaWrites).toBe(1); // the finally, after the one archive that landed
      expect(JSON.parse(be.meta!).entry_count).toBe(7);
    } finally {
      setStorageBackend(prev);
    }
  });

  it('a lock acquired after the deadline passed does nothing (the in-lock re-check)', () => {
    const be = new CountingBackend();
    be.records = seed(3);
    const prev = setStorageBackend(be);
    // The first clock read (the lock wait budget) is before the deadline; every later one is past it.
    let reads = 0;
    const now = () => (reads++ === 0 ? 0 : 1000);
    try {
      expect(autoCurate(TODAY, { now, deadlineMs: 500 })).toEqual({ archived: [], repaired: [], stopped: 'deadline' });
      expect(be.records).toHaveLength(6);
      expect(be.metaWrites).toBe(0);
      // What the re-check saves: the whole-brain read (the archive loop's own check would
      // also archive nothing, but only after reading and materializing the brain).
      expect(be.reads).toBe(0);
    } finally {
      setStorageBackend(prev);
    }
  });

  it('a run that archives nothing writes no meta', () => {
    const be = new CountingBackend();
    be.records = seed(0);
    const prev = setStorageBackend(be);
    try {
      expect(autoCurate(TODAY).archived).toEqual([]);
      expect(be.metaWrites).toBe(0);
    } finally {
      setStorageBackend(prev);
    }
  });
});

describe('vfkb#396 — the lock wait is bounded by the curation deadline', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vfkb-396-'));
    process.env.VFKB_DIR = dir;
    delete process.env.VFKB_DATA_DIR;
    delete process.env.KB_SESSION_ID;
    for (const r of seed(3)) appendFileSync(join(dir, 'entries.jsonl'), JSON.stringify(r) + '\n');
  });
  afterEach(() => {
    delete process.env.VFKB_DIR;
  });

  // Another LIVE writer holds the lock: this process's pid (alive), a fresh `at`, a foreign token.
  const holdLock = () =>
    writeFileSync(join(dir, '.lock'), JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token: 'other-writer' }));

  it('a busy lock past the deadline skips curation: nothing written, the holder untouched', () => {
    holdLock();
    const before = readFileSync(join(dir, 'entries.jsonl'), 'utf8');
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const t0 = performance.now();
    const r = autoCurate(TODAY, { now: () => performance.now(), deadlineMs: t0 + 300 });
    const waited = performance.now() - t0;
    const said = err.mock.calls.map((c) => String(c[0])).join('');
    err.mockRestore();
    expect(said).toContain('brain lock busy at the curation deadline; curation skipped');
    expect(r).toEqual({ archived: [], repaired: [], stopped: 'deadline' });
    expect(waited).toBeLessThan(2000); // not ADR-0040's 5 s wait
    expect(readFileSync(join(dir, 'entries.jsonl'), 'utf8')).toBe(before); // never ran unlocked
    expect(readFileSync(join(dir, '.lock'), 'utf8')).toContain('other-writer');
  }, 15_000);

  it('withBrainLock: a busy lock runs onTimeout INSTEAD of fn once the shortened wait expires', () => {
    holdLock();
    let ran = false;
    const t0 = performance.now();
    const out = withBrainLock(
      () => {
        ran = true;
        return 'fn';
      },
      { acquireTimeoutMs: 100, onTimeout: () => 'skipped' },
    );
    expect(out).toBe('skipped');
    expect(ran).toBe(false);
    expect(performance.now() - t0).toBeLessThan(2000);
  }, 15_000);

  it('a free lock still curates under the same deadline', () => {
    const t0 = performance.now();
    const r = autoCurate(TODAY, { now: () => performance.now(), deadlineMs: t0 + 5_000 });
    expect(r.archived.sort()).toEqual(['old0', 'old1', 'old2']);
    expect(existsSync(join(dir, '.lock'))).toBe(false); // released
  });
});
