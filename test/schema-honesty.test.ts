import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addEntry, readAll, supersede, buildContextMap } from '../src/engine.js';
import { lastMalformed } from '../src/storage.js';
import { queryExplained } from '../src/read.js';

// V2-4 schema honesty (ADR-0042 ← RFC-017 as corrected):
//  1. `why` gets a REAL structural field, additive to the working foldWhy text convention;
//  2. the READ boundary validates the whole envelope — malformed/missing fields get safe
//     defaults, entirely-invalid records surface as a distinct tagged state, and a corrupt
//     JSONL line can no longer crash every read;
//  3. structural `contradicts` references (refs.contradicts), surfaced on read.

let brain: string;
const OLD = process.env.VFKB_DATA_DIR;
beforeEach(() => {
  brain = mkdtempSync(join(tmpdir(), 'vfkb-schema-'));
  process.env.VFKB_DATA_DIR = brain;
});
afterEach(() => {
  if (OLD === undefined) delete process.env.VFKB_DATA_DIR;
  else process.env.VFKB_DATA_DIR = OLD;
});

const file = () => join(brain, 'entries.jsonl');

describe('structural why (ADR-0042 §1) — additive to foldWhy', () => {
  it('a why value lands in the structural field AND the folded text line (no regression)', () => {
    const e = addEntry('decision', 'use X', { role: 'human', why: 'Y is slower' });
    expect(e.why).toBe('Y is slower');
    expect(e.text).toMatch(/Why: Y is slower/);
    const read = readAll().find((r) => r.id === e.id)!;
    expect(read.why).toBe('Y is slower');
  });

  it('supersede threads why structurally too', () => {
    const old = addEntry('decision', 'v1', { role: 'human', status: 'accepted' });
    const neu = supersede(old.id, 'v2', { role: 'human', why: 'v1 proved wrong' });
    expect(neu.why).toBe('v1 proved wrong');
  });

  it('no why → no field (not an empty string)', () => {
    const e = addEntry('fact', 'plain');
    expect(e.why).toBeUndefined();
  });
});

describe('read-boundary envelope validation (ADR-0042 §2)', () => {
  it('an entry missing tags/validity/provenance/author gets safe defaults on read — no crash anywhere', () => {
    mkdirSync(brain, { recursive: true });
    writeFileSync(
      file(),
      JSON.stringify({ id: 'bare01', type: 'fact', text: 'externally projected', created: '2026-01-01', updated: '2026-01-01' }) + '\n',
    );
    const all = readAll();
    const e = all.find((r) => r.id === 'bare01')!;
    expect(e.tags).toEqual([]);
    expect(e.provenance.status).toBe('unverified');
    expect(e.author.role).toBe('executor');
    expect(e.validity.valid_from).toBeTruthy();
    // and the read paths that crashed on the tagless entry historically stay standing
    expect(() => queryExplained({ text: 'projected' })).not.toThrow();
    expect(() => buildContextMap()).not.toThrow();
  });

  it('a corrupt JSONL line no longer crashes every read — it is skipped and surfaced', () => {
    addEntry('fact', 'good entry');
    appendFileSync(file(), 'this is not json at all\n');
    appendFileSync(file(), '{"truncated": tru\n');
    const all = readAll(); // must not throw
    expect(all.some((e) => e.text === 'good entry')).toBe(true);
    const bad = lastMalformed();
    expect(bad.length).toBe(2);
  });

  it('an entirely-invalid record (no usable id) is excluded from the live set but visibly counted', () => {
    addEntry('fact', 'good entry');
    appendFileSync(file(), JSON.stringify({ type: 'fact', text: 'no id at all' }) + '\n');
    const all = readAll();
    expect(all.some((e) => e.text === 'no id at all')).toBe(false);
    expect(lastMalformed().length).toBe(1);
    // visible, not silent: the context map carries the malformed count
    expect(buildContextMap().malformed).toBe(1);
  });

  it('unknown future fields survive the read boundary (forward compatibility)', () => {
    mkdirSync(brain, { recursive: true });
    writeFileSync(
      file(),
      JSON.stringify({
        id: 'fut001', type: 'fact', text: 'from the future', tags: [],
        zone: 'established', author: { role: 'human' },
        provenance: { status: 'verified' }, validity: { valid_from: '2026-01-01' },
        created: '2026-01-01', updated: '2026-01-01',
        some_v3_field: { nested: true },
      }) + '\n',
    );
    const e = readAll().find((r) => r.id === 'fut001')! as Record<string, unknown>;
    expect(e.some_v3_field).toEqual({ nested: true });
  });
});

describe('structural contradicts (ADR-0042 §3)', () => {
  it('an entry can carry contradicts references and they survive the round trip', () => {
    const a = addEntry('fact', 'port is 8080', { role: 'human' });
    const b = addEntry('fact', 'port moved to 9090', { role: 'human', contradicts: [a.id] });
    const read = readAll().find((r) => r.id === b.id)!;
    expect(read.refs?.contradicts).toEqual([a.id]);
  });

  it('search surfaces the contradicts reference', () => {
    const a = addEntry('fact', 'port is 8080', { role: 'human' });
    addEntry('fact', 'port moved to 9090', { role: 'human', contradicts: [a.id] });
    const { results } = queryExplained({ text: 'port moved' });
    const hit = results.find((e) => e.refs?.contradicts?.includes(a.id));
    expect(hit).toBeTruthy();
  });
});
