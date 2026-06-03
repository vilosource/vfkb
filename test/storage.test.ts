import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshBrain() {
  process.env.VTFKB_DIR = mkdtempSync(join(tmpdir(), 'vtfkb-storage-'));
}
function brainFile() {
  return join(process.env.VTFKB_DIR!, 'entries.jsonl');
}

import { addEntry, deleteEntry, readAll, updateEntry, rebuild, getIndex } from '../src/engine.js';
import { contentHash, materialize, readRecords } from '../src/storage.js';

beforeEach(freshBrain);

describe('append-only + tombstones', () => {
  it('delete appends a tombstone and removes the id from the live set', () => {
    const e = addEntry('fact', 'doomed fact', { role: 'human' });
    expect(readAll()).toHaveLength(1);
    deleteEntry(e.id);
    expect(readAll()).toHaveLength(0);
    // the log is append-only: both the entry and the tombstone are still on disk
    expect(readRecords().length).toBe(2);
  });
});

describe('fluid last-write-wins vs decision-family immutability (ADR-0004)', () => {
  it('updates a fluid entry in place (LWW), id stable, count stable', () => {
    const e = addEntry('fact', 'v1 text', { role: 'human', tags: ['a'] });
    const u = updateEntry(e.id, { text: 'v2 text', tags: ['a', 'b'] });
    expect(u.id).toBe(e.id);
    const live = readAll();
    expect(live).toHaveLength(1);
    expect(live[0].text).toBe('v2 text');
    expect(live[0].tags).toEqual(['a', 'b']);
  });
  it('refuses to edit a decision (must supersede)', () => {
    const d = addEntry('decision', 'a decision', { role: 'human', status: 'accepted' });
    expect(() => updateEntry(d.id, { text: 'sneaky edit' })).toThrow(/immutable|supersede/i);
  });
});

describe('merge=union safety (materialize is order-independent in `updated`)', () => {
  it('two branches appended in either order yield the same live set', () => {
    // Simulate branch A and branch B each appending one version of the same id,
    // plus distinct entries. Concatenation order must not change the outcome.
    const recA = { id: 'shared', type: 'fact', text: 'older', tags: [], zone: 'established',
      author: { role: 'human' }, provenance: { status: 'verified' },
      validity: { valid_from: '2026-01-01' }, created: '2026-01-01', updated: '2026-01-01T00:00:00Z' };
    const recB = { ...recA, text: 'newer', updated: '2026-02-01T00:00:00Z' };
    const recC = { ...recA, id: 'onlyB', text: 'b-only', updated: '2026-01-15T00:00:00Z' };

    const order1 = [recA, recB, recC];
    const order2 = [recC, recB, recA];
    const m1 = materialize(order1 as never).sort((a, b) => a.id.localeCompare(b.id));
    const m2 = materialize(order2 as never).sort((a, b) => a.id.localeCompare(b.id));
    expect(m1).toEqual(m2);
    // newest version of the shared id wins regardless of order
    expect(m1.find((e) => e.id === 'shared')!.text).toBe('newer');
  });
});

describe('content-hash freshness (ADR-0014, never mtime)', () => {
  it('is deterministic for the same live set and changes when it changes', () => {
    addEntry('fact', 'one', { role: 'human' });
    const h1 = contentHash();
    const h1again = contentHash();
    expect(h1).toBe(h1again);
    addEntry('fact', 'two', { role: 'human' });
    expect(contentHash()).not.toBe(h1);
  });
});

describe('index rebuild + freshness + search', () => {
  it('reflects an external append after re-checking freshness (rebuild-on-doubt)', () => {
    addEntry('fact', 'alpha keyword', { role: 'human' });
    const ix = getIndex();
    expect(ix.all()).toHaveLength(1);

    // External writer appends directly to JSONL (e.g. another process / git pull),
    // and updates the meta sidecar — the index must notice and rebuild.
    const rec = { id: 'ext1', type: 'fact', text: 'beta keyword', tags: [], zone: 'established',
      author: { role: 'human' }, provenance: { status: 'verified' },
      validity: { valid_from: '2026-01-01' }, created: '2026-01-01', updated: '2026-09-01T00:00:00Z' };
    appendFileSync(brainFile(), JSON.stringify(rec) + '\n', 'utf8');
    // recompute the sidecar the way a writer would
    writeFileSync(join(process.env.VTFKB_DIR!, 'index-meta.json'),
      JSON.stringify({ content_hash: contentHash(), entry_count: 2, last_write: 'x' }), 'utf8');

    expect(ix.all()).toHaveLength(2); // ensureFresh() rebuilt
    expect(ix.search('beta')).toHaveLength(1);
    expect(ix.search('keyword').length).toBe(2);
  });

  it('rebuild() is deterministic and matches materialize()', () => {
    addEntry('pattern', 'p', { role: 'architect' });
    addEntry('fact', 'f', { role: 'human' });
    const ix = rebuild();
    expect(ix.all().map((e) => e.id).sort()).toEqual(materialize().map((e) => e.id).sort());
    expect(ix.freshnessToken()).toBe(contentHash());
  });
});

// guard against accidental JSONL corruption: every line must be valid JSON
describe('append-only durability', () => {
  it('every persisted line round-trips as JSON', () => {
    addEntry('fact', 'line one', { role: 'human' });
    addEntry('gotcha', 'line two', { role: 'executor' });
    const lines = readFileSync(brainFile(), 'utf8').trim().split('\n');
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });
});
