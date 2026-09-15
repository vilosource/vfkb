import { describe, it, expect } from 'vitest';
import { entrySchema, normalizeEntry } from '../src/validate.js';

// BLAST-RADIUS BRAKE (issue #303).
//
// `.catch(default)` on an OBJECT schema converts a one-field problem into a
// whole-object problem: when a declared field fails, zod discards the entire
// object — including siblings that parsed perfectly — and substitutes the
// default. Measured in this repo before the fix:
//
//   provenance {status:'stale', date:12345} -> {status:'unverified'}
//     `stale` is reset, and src/engine.ts:396 excludes only stale/expired from
//     injection, so a deliberately-staled entry silently becomes injectable.
//     Inversely src/export.ts:80,91 gate the verified export on
//     status === 'verified', so a verified entry silently drops out of it.
//   author {role:'human', id:12345} -> {role:'executor'}
//     feeds deriveTrust (src/cli.ts:356) and the rerank bonus (engine.ts:413).
//   validity {valid_from:'…', valid_until:999} -> both lost
//
// CORRECTION, recorded because an earlier version of this comment and of the
// commit body claimed otherwise: there is NO reachable ADR-0004 lifecycle bypass
// here. `refs.contradicts` already carried its own `.catch()` before the fix, so
// a bad `contradicts` never detonated `refs`; and the only input that loses
// `refs.supersedes` is a malformed `supersedes` itself, where no valid edge ever
// existed and whose behaviour is unchanged by the fix. The real `refs` win is
// smaller — a bad `supersedes` no longer destroys `contradicts` (cli.ts:567).
//
// WHY THIS GUARD IS SCHEMA-DRIVEN, AND WHY THAT IS NOT ENOUGH ON ITS OWN:
// the schema's `.shape` generates the cases, but a generated case can only FAIL
// if the fixture actually supplies the data it corrupts. An earlier version of
// this file relied on that implicitly and was therefore vacuous for any
// composite the fixture did not mention — a fifth composite carrying the #303
// bug went GREEN. That is the same "guard shaped to miss its own bug" pattern
// (2f14119266ef) this file exists to prevent, so the two structural assertions
// below are load-bearing and must not be relaxed:
//
//   1. FIXTURE COVERAGE — every composite and every declared field the walker
//      discovers must be present in `wellFormed()`. A new composite fails here
//      LOUDLY, naming what to add, instead of silently generating dead cases.
//   2. CASE LIVENESS — each corruption must actually be rejected by the field's
//      underlying schema. A field that accepts anything (z.unknown()) can never
//      fail and is declared in UNCORRUPTIBLE with a reason, never left to pass
//      quietly and inflate the case count.
//
// CAN FAIL (ADR-0070 §2): remove any per-field `.catch()` in src/validate.ts and
// that field's case goes RED. Observed against the pre-fix tree: 7 failures
// across all four composites; isolated revert of provenance.date's catch reddens
// exactly one case.

const POISON = Symbol('poison') as unknown;

/**
 * Fields whose schema accepts EVERY value, so no corruption can trigger the
 * object-level catch. Declared explicitly: a silent pass here would be a dead
 * case masquerading as coverage (review finding M1).
 */
const UNCORRUPTIBLE: Record<string, string> = {
  'provenance.origin': 'z.unknown() accepts any value, so it cannot fail and cannot destroy siblings',
};

type Node = { shape?: Record<string, Node>; _def?: { innerType?: Node } };

/** Unwrap .optional()/.catch()/etc until the base schema. */
function base(node: Node): Node {
  let cur: Node = node;
  for (let i = 0; i < 8 && cur; i++) {
    if (cur.shape) return cur;
    const inner = cur._def?.innerType;
    if (!inner) return cur;
    cur = inner;
  }
  return cur;
}

/** Recursively collect every composite, by dotted path (review finding m1). */
function composites(node: Node, path: string[] = [], out: Array<[string, Record<string, Node>]> = []) {
  const b = base(node);
  if (!b?.shape) return out;
  if (path.length) out.push([path.join('.'), b.shape]);
  for (const [name, child] of Object.entries(b.shape)) composites(child, [...path, name], out);
  return out;
}

const get = (o: any, p: string) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function set(o: any, p: string, v: unknown) {
  const ks = p.split('.');
  const last = ks.pop()!;
  const t = ks.reduce((a, k) => (a[k] ??= {}), o);
  t[last] = v;
}

const wellFormed = () => ({
  id: 'blast1', type: 'fact' as const, text: 'sibling survival probe', tags: [],
  zone: 'established' as const,
  author: { role: 'human', id: 'jason' },
  provenance: {
    status: 'stale', date: '2024-01-01', source: 'adr-42', detail: 'd',
    origin: { kind: 'tool_call' },
  },
  refs: { supersedes: 'older01', contradicts: ['other1'] },
  validity: { valid_from: '2020-03-03', valid_until: '2099-01-01' },
  created: '2015-01-01', updated: '2015-01-01',
});

describe('object-level .catch() must not destroy valid siblings (#303)', () => {
  const found = composites(entrySchema as unknown as Node);

  it('STRUCTURAL 1 — the fixture covers every composite and field the walker finds', () => {
    // Without this, a composite absent from the fixture generates cases that
    // cannot fail: baseline and corrupted runs both collapse to the catch
    // default, so `before === after` trivially. Review finding B1.
    const missing: string[] = [];
    for (const [composite, shape] of found) {
      if (get(wellFormed(), composite) === undefined) { missing.push(composite); continue; }
      for (const field of Object.keys(shape)) {
        if (get(wellFormed(), `${composite}.${field}`) === undefined) missing.push(`${composite}.${field}`);
      }
    }
    expect(
      [...new Set(missing)],
      `wellFormed() is missing ${[...new Set(missing)].join(', ')}. A composite or field was added to entrySchema ` +
        `without extending the fixture — until you do, its blast-radius cases CANNOT FAIL. Add it here.`,
    ).toEqual([]);
  });

  it('STRUCTURAL 2 — the walker finds something, and every walker result is accounted for', () => {
    expect(found.length, 'the schema walker found NO composites — zod internals likely changed').toBeGreaterThan(0);
    expect(found.map(([n]) => n).sort()).toEqual(['author', 'provenance', 'refs', 'validity']);
  });

  for (const [composite, shape] of found) {
    for (const field of Object.keys(shape)) {
      const path = `${composite}.${field}`;
      const reason = UNCORRUPTIBLE[path];

      it(`${path}: ${reason ? 'declared uncorruptible, and that is true' : 'corrupting it leaves its siblings intact'}`, () => {
        const rejects = !(base(shape[field]) as any).safeParse?.(POISON)?.success;

        if (reason) {
          // The exclusion must stay honest: if the field ever becomes
          // corruptible, it needs a real case, not a standing exemption.
          expect(rejects, `${path} is listed in UNCORRUPTIBLE ("${reason}") but now REJECTS the poison value — remove the exemption and let the real case run`).toBe(false);
          return;
        }

        // LIVENESS — a corruption the schema accepts proves nothing (finding M1).
        expect(rejects, `${path} ACCEPTS the poison value, so this case can never fail. Either poison it differently or declare it in UNCORRUPTIBLE with a reason.`).toBe(true);

        const baseline = normalizeEntry(wellFormed());
        expect(baseline.ok).toBe(true);
        const before = get((baseline as any).entry, composite) as Record<string, unknown>;

        const corrupted = wellFormed() as any;
        set(corrupted, path, POISON);
        const r = normalizeEntry(corrupted);
        expect(r.ok).toBe(true);
        const after = (get((r as any).entry, composite) ?? {}) as Record<string, unknown>;

        for (const sibling of Object.keys(shape)) {
          if (sibling === field) continue;
          if (before[sibling] === undefined) continue;
          expect(
            after[sibling],
            `${composite}.${sibling} was destroyed as collateral damage from a bad ${path}`,
          ).toEqual(before[sibling]);
        }
      });
    }
  }
});
