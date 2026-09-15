import { describe, it, expect } from 'vitest';
import { entrySchema, normalizeEntry } from '../src/validate.js';

// BLAST-RADIUS BRAKE (issue #303).
//
// `.catch(default)` on an OBJECT schema converts a one-field problem into a
// whole-object problem: when any declared field fails, zod discards the entire
// object — including the siblings that parsed perfectly — and substitutes the
// default. Two consequences observed in this repo before the fix:
//
//   provenance: {status:'stale', date:12345} -> {status:'unverified'}
//     `stale` is reset, and src/engine.ts:396 excludes only stale/expired from
//     injection, so a deliberately-staled entry silently becomes injectable.
//   refs: {supersedes:'abc', contradicts:999} -> undefined
//     src/engine.ts:333 builds the superseded set from refs.supersedes, so the
//     edge vanishes and the superseded decision goes live again (ADR-0004).
//
// This guard is deliberately NOT written per-instance. The two guards added for
// recorded_invalid_at were hand-written, which is why a fifth composite added
// later would get no coverage — the same "guard shaped to miss its own bug"
// shape (pattern 2f14119266ef) that kept this class invisible. Here the schema's
// own `.shape` is the test's input, so a composite field added in future is
// covered the day it is declared.
//
// CAN FAIL (ADR-0070 §2): restore any object-level `.catch()` in src/validate.ts
// WITHOUT per-field catches inside it and this goes RED for that composite.
// Observed red against the pre-fix tree for all four composites: author, refs,
// provenance, validity.

/** A value guaranteed to violate anything except `z.unknown()`. */
const POISON = Symbol('poison') as unknown;

/** Walk the top-level shape and return [name, innerShape] for each composite. */
function composites(): Array<[string, Record<string, unknown>]> {
  const top = (entrySchema as unknown as { shape?: Record<string, unknown> }).shape;
  if (!top) throw new Error('entrySchema exposes no .shape — zod internals changed, fix this walker');
  const out: Array<[string, Record<string, unknown>]> = [];
  for (const [name, node] of Object.entries(top)) {
    // unwrap .optional()/.catch() wrappers until a .shape appears or we bottom out
    let cur: unknown = node;
    for (let i = 0; i < 8 && cur; i++) {
      const shape = (cur as { shape?: Record<string, unknown> }).shape;
      if (shape) { out.push([name, shape]); break; }
      const def = (cur as { _def?: { innerType?: unknown } })._def;
      cur = def?.innerType;
    }
  }
  return out;
}

const wellFormed = () => ({
  id: 'blast1', type: 'fact', text: 'sibling survival probe', tags: [],
  zone: 'established',
  author: { role: 'human', id: 'jason' },
  provenance: { status: 'stale', date: '2024-01-01', source: 'adr-42', detail: 'd' },
  refs: { supersedes: 'older01', contradicts: ['other1'] },
  validity: { valid_from: '2020-03-03', valid_until: '2099-01-01' },
  created: '2015-01-01', updated: '2015-01-01',
});

describe('object-level .catch() must not destroy valid siblings (#303)', () => {
  const found = composites();

  it('the schema walker actually finds the composites it claims to (guard the guard)', () => {
    const names = found.map(([n]) => n).sort();
    // If zod internals change and the walker silently finds nothing, every test
    // below would vacuously pass. Assert the walker works before trusting it.
    expect(names).toEqual(['author', 'provenance', 'refs', 'validity']);
  });

  for (const [composite, shape] of found) {
    for (const field of Object.keys(shape)) {
      it(`${composite}.${field}: corrupting it leaves its siblings intact`, () => {
        const good = wellFormed() as Record<string, any>;
        const baseline = normalizeEntry(wellFormed());
        expect(baseline.ok).toBe(true);
        const before = (baseline as any).entry[composite] as Record<string, unknown>;

        good[composite] = { ...good[composite], [field]: POISON };
        const r = normalizeEntry(good);
        expect(r.ok).toBe(true);
        const after = ((r as any).entry[composite] ?? {}) as Record<string, unknown>;

        // Every OTHER declared field that was present must be unchanged. The
        // corrupted field itself may be dropped or defaulted — that is the
        // point of .catch(). Its neighbours may not be.
        for (const sibling of Object.keys(shape)) {
          if (sibling === field) continue;
          if (before[sibling] === undefined) continue;
          expect(
            after[sibling],
            `${composite}.${sibling} was destroyed as collateral damage from a bad ${composite}.${field}`,
          ).toEqual(before[sibling]);
        }
      });
    }
  }
});
