import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addEntry, readAll, supersede, buildContextMap, isInjectable } from '../src/engine.js';
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

  // RFC-038 §delete-branch proof obligation, for ADR-0076 §2's deletion of
  // `recorded_invalid_at`. The guard above covers only a TOP-LEVEL unknown field
  // (the looseObject at validate.ts:34). The NESTED `validity` sub-schema is a
  // separate looseObject, and it is the sole mechanism keeping legacy data intact
  // now that the field is no longer declared — so it needs its own guard.
  //
  // CAN FAIL (ADR-0070 §2): change `z.looseObject` -> `z.object` in the `validity`
  // block of src/validate.ts and this goes RED. Observed: the key is silently
  // stripped on read and every read-modify-write path then persists the stripped
  // entry — permanent loss on an append-only store — while the rest of the suite
  // stays green. That blindness is exactly what this test exists to remove.
  it('a legacy entry whose validity carries an UNDECLARED key still materializes and still injects', () => {
    mkdirSync(brain, { recursive: true });
    writeFileSync(
      file(),
      JSON.stringify({
        id: 'leg001', type: 'fact', text: 'written before the field was deleted', tags: [],
        zone: 'established', author: { role: 'human' },
        provenance: { status: 'verified' },
        validity: { valid_from: '2020-03-03', valid_until: '2099-01-01', recorded_invalid_at: '2021-04-04' },
        created: '2020-03-03', updated: '2020-03-03',
      }) + '\n',
    );
    const e = readAll().find((r) => r.id === 'leg001')!;
    // 1. the undeclared key survives the read boundary
    expect((e.validity as Record<string, unknown>).recorded_invalid_at).toBe('2021-04-04');
    // 2. its declared siblings are untouched
    expect(e.validity.valid_from).toBe('2020-03-03');
    expect(e.validity.valid_until).toBe('2099-01-01');
    // 3. and it still passes the ADR-0005 injection gate
    expect(isInjectable(e, '2026-09-14')).toBe(true);
  });

  // Why DELETING the z.string() declaration was safer than RFC-038:222's advice to
  // keep it: the declaration was the CORRUPTING element. With a malformed value the
  // z.string() fails, `.catch({})` fires on the WHOLE validity object, and both
  // declared siblings are destroyed with it. Undeclared, the bad value is simply
  // carried. Guards against someone "restoring" validate.ts:61 from the RFC text.
  it('a malformed undeclared validity value does not destroy its declared siblings', () => {
    mkdirSync(brain, { recursive: true });
    writeFileSync(
      file(),
      JSON.stringify({
        id: 'mal001', type: 'fact', text: 'bad value in an undeclared validity key', tags: [],
        zone: 'established', author: { role: 'human' },
        provenance: { status: 'verified' },
        validity: { valid_from: '2020-03-03', valid_until: '2099-01-01', recorded_invalid_at: 12345 },
        created: '2020-03-03', updated: '2020-03-03',
      }) + '\n',
    );
    const e = readAll().find((r) => r.id === 'mal001')!;
    expect(e.validity.valid_from).toBe('2020-03-03');
    expect(e.validity.valid_until).toBe('2099-01-01');
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
