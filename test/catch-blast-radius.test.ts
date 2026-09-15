import { describe, it, expect } from 'vitest';
import { normalizeEntry } from '../src/validate.js';
import { isInjectable } from '../src/engine.js';

// #303 — `.catch(default)` on an OBJECT schema converts a one-field problem into
// a whole-object problem: when a declared field fails, zod discards the ENTIRE
// object, including the siblings that parsed perfectly, and substitutes the
// default. src/validate.ts did this in four places; the fix is a per-field
// `.catch()` on every declared field, leaving the object-level catch as a last
// resort for a non-object value.
//
// The asymmetry that hid this: an UNDECLARED bad key is harmless, because every
// composite is `looseObject` and passes it through. Only a malformed DECLARED
// field detonates — so the fields the schema takes most seriously are the ones
// that destroy their neighbours.
//
// NO ADR-0004 BYPASS. An earlier version of this file claimed a bad
// `refs.supersedes` erased the supersession edge. Measured: `refs.contradicts`
// already carried its own `.catch()` before the fix (src/validate.ts:44), so
// that input never detonated `refs`; and the only input that loses `supersedes`
// is a malformed `supersedes` itself, where no valid edge existed. The real
// `refs` win is the one asserted below — `contradicts` survives (cli.ts:567).
//
// WHY THESE ARE HAND-WRITTEN. A schema-walking version was attempted and
// abandoned after three adversarial review rounds found it vacuous in five
// distinct ways, and its own fix introduced a false positive that blocked
// correct `z.object` composites with a false message and no available remedy
// (ADR-0070 §4 escalation, operator ruling 2026-09-15). These four cases anchor
// on OBSERVED behaviour at the call sites that consume each field. The
// structural property — "every declared field inside a composite carries its
// own `.catch()`" — is a separate, simpler guard tracked in its own issue; it
// needs no fixture and covers ROOT fields too, where a malformed value drops
// the whole entry (a larger blast radius than #303 itself).
//
// CAN FAIL (ADR-0070 §2): remove the named field's `.catch(undefined)` in
// src/validate.ts and that test alone goes RED. Each was observed red under its
// own isolated revert, anchors verified applied.

const entry = (over: Record<string, unknown>) => ({
  id: 'blast1', type: 'fact', text: 'sibling survival probe', tags: [],
  zone: 'established', created: '2015-01-01', updated: '2015-01-01',
  author: { role: 'human', id: 'jason' },
  provenance: { status: 'verified' },
  validity: { valid_from: '2020-03-03' },
  ...over,
});
const ok = (raw: unknown) => {
  const r = normalizeEntry(raw);
  expect(r.ok, 'the entry should still normalize — the catch is meant to rescue it').toBe(true);
  return (r as { ok: true; entry: any }).entry;
};

describe('one malformed field must not destroy its valid siblings (#303)', () => {
  // Revert: src/validate.ts provenance `date: z.string().optional().catch(undefined)`
  it('provenance: a bad `date` must not reset `status`, which gates injection', () => {
    const e = ok(entry({ provenance: { status: 'stale', date: 12345, source: 'adr-42' } }));
    expect(e.provenance.status, 'a `stale` entry silently became `unverified`').toBe('stale');
    expect(e.provenance.source).toBe('adr-42');
    // The consequence, asserted at the call site rather than inferred:
    // engine.ts:396 excludes only stale/expired, so a reset makes it injectable.
    expect(isInjectable(e, '2026-09-15'), 'a staled entry became injectable again').toBe(false);
  });

  // Revert: src/validate.ts provenance `source`/`detail` catches
  it('provenance: a bad `source` must not drop a `verified` entry out of the verified export', () => {
    const e = ok(entry({ provenance: { status: 'verified', source: { bad: true } } }));
    // export.ts:80,91 gate the verified export on status === 'verified'.
    expect(e.provenance.status, 'a `verified` entry silently became `unverified`').toBe('verified');
  });

  // Revert: src/validate.ts refs `supersedes: …catch(undefined)`
  it('refs: a bad `supersedes` must not destroy `contradicts`', () => {
    const e = ok(entry({ refs: { supersedes: 999, contradicts: ['other1'] } }));
    expect(e.refs?.contradicts, 'contradicts was destroyed as collateral damage').toEqual(['other1']);
  });

  // Revert: src/validate.ts author `id: …catch(undefined)`
  it('author: a bad `id` must not downgrade `role`, which derives trust', () => {
    const e = ok(entry({ author: { role: 'human', id: 12345 } }));
    // cli.ts:356 derives trust from role; engine.ts:413 gives it a rerank bonus.
    expect(e.author.role, 'a human-authored entry silently became executor-authored').toBe('human');
  });

  // Revert: src/validate.ts validity `valid_until`/`valid_from` catches
  it('validity: a bad `valid_until` must not silently RESET `valid_from`', () => {
    // `created` is deliberately DIFFERENT from `valid_from`: when the object
    // detonates, the backfill at validate.ts:87-89 resurrects valid_from FROM
    // created, so it reappears WRONG rather than absent. With the two equal the
    // assertion cannot fail — that exact vacuity shipped once and was caught in
    // review.
    const e = ok(entry({ validity: { valid_from: '2020-03-03', valid_until: 999 }, created: '2015-01-01' }));
    expect(e.validity.valid_from, 'valid_from was silently reset to the created stamp').toBe('2020-03-03');
  });

  it('an UNDECLARED bad key is harmless — it is the declared ones that detonate', () => {
    const e = ok(entry({ validity: { valid_from: '2020-03-03', whatever: 12345 } }));
    expect(e.validity.valid_from).toBe('2020-03-03');
    expect((e.validity as Record<string, unknown>).whatever).toBe(12345);
  });
});
