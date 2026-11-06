import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// vfkb#448: autoCurate validates a line a second time only for ids with a curation-kept tag on
// some line, not the whole brain.
const counts = vi.hoisted(() => ({ normalize: 0 }));
vi.mock('../src/validate.js', async (orig) => {
  const m = await orig<typeof import('../src/validate.js')>();
  return { ...m, normalizeEntry: (r: unknown) => { counts.normalize++; return m.normalizeEntry(r); } };
});
import { autoCurate, AUTO_ARCHIVED, CURATION_KEPT } from '../src/curator.js';

const day = (d: number) => new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString();
const rec = (id: string, created: string, tags: string[], text = `HANDOFF ${id}: what happened, what is next`) =>
  JSON.stringify({ id, type: 'fact', text, tags, zone: 'established', author: { role: 'human' }, provenance: { status: 'verified', date: created }, validity: { valid_from: created }, created, updated: created }) + '\n';

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vfkb-448n-'));
  process.env.VFKB_DIR = dir;
  delete process.env.VFKB_DATA_DIR;
  counts.normalize = 0;
});

describe('vfkb#448 — curation normalization', () => {
  it('a brain with no rule or kept tags is validated once per line, not twice', () => {
    let s = '';
    for (let i = 0; i < 200; i++) s += rec(`t${i}`, day(1), ['topic'], `topical fact ${i}`);
    appendFileSync(join(dir, 'entries.jsonl'), s);
    autoCurate('2026-03-01', { dryRun: true });
    expect(counts.normalize).toBe(200);
  });

  it('still honours curation-kept on an OLDER line of an id, the one line that needs it', () => {
    let s = rec('old', day(0), ['handoff', 'next', CURATION_KEPT]) + rec('old', day(1), ['handoff', 'next']);
    for (const [id, d] of [['n1', 60], ['n2', 65], ['pin', 70]] as const) s += rec(id, day(d), ['handoff', 'next']);
    appendFileSync(join(dir, 'entries.jsonl'), s);
    expect(autoCurate('2026-03-01', { dryRun: true }).archived).toEqual([]);
  });

  it('still repairs a cross-branch re-archive of a kept entry', () => {
    let s = rec('e', day(0), ['handoff', 'next', CURATION_KEPT]);
    s += JSON.stringify({ ...JSON.parse(rec('e', day(0), ['handoff', 'next', `${AUTO_ARCHIVED}old-handoff@2026-02-01`])), zone: 'archive', updated: day(1) }) + '\n';
    appendFileSync(join(dir, 'entries.jsonl'), s);
    expect(autoCurate('2026-03-01', { dryRun: true }).repaired).toEqual(['e']);
  });
});
