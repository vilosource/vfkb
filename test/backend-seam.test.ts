import { describe, it, expect } from 'vitest';
import { setStorageBackend, storageBackend } from '../src/backend.js';
import type { StorageBackend, RawMalformed } from '../src/backend.js';
import { addEntry, readAll } from '../src/engine.js';
import { SessionState } from '../src/session.js';

// V2-6 (ADR-0044): the seam is LOAD-BEARING — engine reads/writes and session
// records flow through storageBackend(), not through direct fs calls. Proven by
// injecting an in-memory backend and observing the traffic. (The refactor-safety
// DoD itself is the rest of the suite passing unchanged against the JSONL default.)

class MemBackend implements StorageBackend {
  readonly name = 'mem-test';
  records: unknown[] = [];
  meta: string | null = null;
  spine: string | null = null;
  sessions = new Map<string, string>();
  location() {
    return 'memory://test';
  }
  append(rec: unknown) {
    this.records.push(rec);
  }
  readAllRaw(): { records: unknown[]; malformed: RawMalformed[] } {
    return { records: [...this.records], malformed: [] };
  }
  readMetaRaw() {
    return this.meta;
  }
  writeMetaRaw(json: string) {
    this.meta = json;
  }
  readSpine() {
    return this.spine;
  }
  writeSpine(c: string) {
    this.spine = c;
  }
  spinePath() {
    return 'memory://test/context.md';
  }
  listSessionIds() {
    return [...this.sessions.keys()];
  }
  readSessionRecord(id: string) {
    return this.sessions.get(id) ?? null;
  }
  writeSessionRecord(id: string, json: string) {
    this.sessions.set(id, json);
  }
  withExclusive<T>(fn: () => T): T {
    return fn();
  }
}

describe('ADR-0044 — the storage seam is load-bearing', () => {
  it('an injected backend receives engine writes and serves engine reads', () => {
    const mem = new MemBackend();
    const prev = setStorageBackend(mem);
    try {
      const e = addEntry('fact', 'lives only in memory', { role: 'human' });
      expect(mem.records.some((r) => (r as { id?: string }).id === e.id)).toBe(true); // write went through the seam
      expect(mem.meta).toBeTruthy(); // ADR-0014 meta side-effect rode the seam too
      const read = readAll().find((r) => r.id === e.id);
      expect(read?.text).toBe('lives only in memory'); // read came back through the seam
    } finally {
      setStorageBackend(prev);
    }
  });

  it('session records flow through the seam (ADR-0039 registry included)', () => {
    const mem = new MemBackend();
    const prev = setStorageBackend(mem);
    try {
      const s = SessionState.load('seam-sess');
      s.bumpTurn();
      s.save();
      expect(mem.sessions.has('seam-sess')).toBe(true);
      expect(SessionState.records().some((r) => r.sessionId === 'seam-sess')).toBe(true);
    } finally {
      setStorageBackend(prev);
    }
  });

  it('the default backend is JSONL-on-disk (ADR-0019 unchanged)', () => {
    expect(storageBackend().name).toBe('jsonl-fs');
  });
});
