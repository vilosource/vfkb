import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryIndex, queryTermCount } from '../src/index-store.js';

// ADR-0080 step 1: the contracts of the BM25 stage-1 scorer that the recall eval does
// not pin. Each was observed surviving the full suite under its mutation before these
// tests existed (PR #364 review): the tie-break, the floor denominator, and the
// stopword-only query.

function brain(entries: { id: string; text: string; updated: string; tags?: string[] }[]) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-bm25-'));
  const lines = entries.map((e) =>
    JSON.stringify({
      id: e.id, type: 'fact', text: e.text, tags: e.tags ?? [], zone: 'established',
      author: { role: 'human' }, created: e.updated, updated: e.updated,
    }),
  );
  writeFileSync(join(dir, 'entries.jsonl'), lines.join('\n') + '\n');
  process.env.VFKB_DATA_DIR = dir;
  delete process.env.VFKB_DIR;
  return new InMemoryIndex();
}

describe('BM25 stage-1 contracts (ADR-0080)', () => {
  beforeEach(() => delete process.env.VFKB_DATA_DIR);

  it('equal scores keep the existing tie-break: newest `updated` first', () => {
    const idx = brain([
      { id: 'older000000a', text: 'kestrel migration plan', updated: '2026-01-01T00:00:00.000Z' },
      { id: 'newer000000b', text: 'kestrel migration plan', updated: '2026-02-01T00:00:00.000Z' },
    ]);
    const r = idx.searchScored('kestrel migration');
    expect(r.map((x) => x.entry.id)).toEqual(['newer000000b', 'older000000a']);
    expect(r[0].score).toBe(r[1].score);
  });

  it('the floor denominator counts the same pruned terms the scorer matches', () => {
    // "we were going to use jev as well were we not" -> content terms: going, use, jev, well
    expect(queryTermCount('we were going to use JEV as well were we not?')).toBe(4);
    expect(queryTermCount('the and of')).toBe(0);
  });

  it('a query made only of stopwords returns nothing (never every entry)', () => {
    const idx = brain([{ id: 'only00000001', text: 'what is this and how is it here', updated: '2026-01-01T00:00:00.000Z' }]);
    expect(idx.searchScored('what is this')).toEqual([]);
    expect(idx.searchScored('the')).toEqual([]);
  });

  it('IDF: one rare term outranks a common term repeated, at equal length', () => {
    // Equal lengths isolate IDF from length normalisation. Without IDF, two hits of the
    // common "review" beat one hit of the rare "zephyrine".
    const idx = brain([
      { id: 'rare00000001', text: 'zephyrine notes alpha beta', updated: '2026-01-01T00:00:00.000Z' },
      { id: 'comm00000002', text: 'review review alpha beta', updated: '2026-01-01T00:00:00.000Z' },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `pad0000000${i}`, text: 'review gamma delta epsilon', updated: '2026-01-01T00:00:00.000Z' })),
    ]);
    expect(idx.searchScored('zephyrine review')[0].entry.id).toBe('rare00000001');
  });

  it('length normalisation: a short entry outranks a long one with the same term count', () => {
    const idx = brain([
      { id: 'long00000001', text: `kestrel ${'filler words here '.repeat(40)}`, updated: '2026-03-01T00:00:00.000Z' },
      { id: 'shrt00000002', text: 'kestrel decision', updated: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(idx.searchScored('kestrel')[0].entry.id).toBe('shrt00000002');
  });
});
