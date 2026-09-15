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
//     src/engine.ts:396 excludes only stale/expired from injection, so a
//     deliberately-staled entry silently becomes injectable; inversely
//     src/export.ts:80,91 drop a verified entry from the verified export.
//   author {role:'human', id:12345} -> {role:'executor'}
//     feeds deriveTrust (src/cli.ts:356) and the rerank bonus (engine.ts:413).
//   validity {valid_from:'…', valid_until:999} -> both lost
//
// NO ADR-0004 BYPASS. An earlier version of this comment claimed a bad
// refs.supersedes erased the supersession edge. Measured: refs.contradicts
// already carried its own .catch() pre-fix (src/validate.ts:44), so that input
// never detonated refs; and the only input losing `supersedes` is a malformed
// `supersedes` itself, where no valid edge existed. The real refs win is
// smaller — a bad supersedes no longer destroys contradicts (cli.ts:567).
//
// ═══ WHY THIS FILE IS PARANOID ═══
// Two earlier versions of this guard were themselves vacuous, which is the
// pattern (2f14119266ef) it exists to prevent. The schema generates the CASES;
// the fixture decides whether a case can FAIL. Four distinct escapes were
// found by adversarial review, each shipping the #303 bug with an ALL-GREEN
// suite, so four assertions below are load-bearing and must not be relaxed:
//
//   STRUCTURAL 1  fixture PRESENCE — every composite/field the walker finds
//                 must exist in the fixture, or its cases cannot fail.
//   STRUCTURAL 2  walker sanity — it found something, and what it found is
//                 the expected set.
//   STRUCTURAL 3  walker COMPLETENESS — no composite is reachable only through
//                 a container this walker cannot generate cases for, and no
//                 node kind is unrecognised. Without this an array- or
//                 union-held composite produces NO cases and NO complaint.
//   SENTINEL      per case — an undeclared `__sentinel` key (every composite
//                 is looseObject, so it passes through) is asserted on BOTH
//                 the baseline and the corrupted parse. This asserts the
//                 property in the title DIRECTLY rather than inferring it from
//                 value equality, and it closes two escapes that presence
//                 checks cannot: a fixture value equal to the catch default
//                 (comparing the default with itself), and an invalid fixture
//                 value that detonates the BASELINE so every check is skipped.
//
//   LIVENESS      per case — the corruption must actually be rejected by the
//                 field's base schema, or the case proves nothing.
//
// CAN FAIL (ADR-0070 §2): remove any per-field `.catch()` in src/validate.ts
// and that field's case goes RED. Observed against the pre-fix tree: every
// composite reports collateral damage; an isolated revert of one field's catch
// reddens exactly one case.

/** Default corruptor. Rejected by every declared field today. */
const POISON = Symbol('poison') as unknown;

/**
 * Values a field must ALSO accept before an UNCORRUPTIBLE exemption is honest.
 * A field that accepts the Symbol but rejects, say, a number is corruptible —
 * it just needs a different poison, so it must not hide behind the exemption.
 */
const BATTERY: unknown[] = [POISON, 12345, null, {}, []];

/** Per-field alternative corruptor, so "poison it differently" is a real option. */
const POISONS: Record<string, unknown> = {};

/** Fields whose schema accepts EVERY value, so no corruption can ever bite. */
const UNCORRUPTIBLE: Record<string, string> = {
  'provenance.origin': 'z.unknown() accepts any value, so it cannot fail and cannot destroy siblings',
};

type Node = { _def?: Record<string, any>; shape?: Record<string, Node>; safeParse?: (v: unknown) => { success: boolean } };

const kind = (n: Node): string => String(n?._def?.type ?? 'UNKNOWN');
/** Wrappers hold exactly one inner schema and never change its shape. */
const WRAPPERS = new Set(['optional', 'nullable', 'catch', 'default', 'prefault', 'readonly', 'nonoptional']);
/** Containers may HOLD a composite but this walker cannot address one inside them. */
const CONTAINERS: Record<string, (d: any) => Node[]> = {
  array: (d) => [d.element].filter(Boolean),
  set: (d) => [d.valueType].filter(Boolean),
  union: (d) => d.options ?? [],
  intersection: (d) => [d.left, d.right].filter(Boolean),
  record: (d) => [d.valueType].filter(Boolean),
  map: (d) => [d.keyType, d.valueType].filter(Boolean),
  tuple: (d) => [...(d.items ?? []), d.rest].filter(Boolean),
  lazy: (d) => [d.getter?.()].filter(Boolean),
  pipe: (d) => [d.in, d.out].filter(Boolean),
  promise: (d) => [d.innerType].filter(Boolean),
};
const LEAVES = new Set([
  'string', 'number', 'int', 'bigint', 'boolean', 'date', 'symbol', 'undefined', 'null', 'void',
  'any', 'unknown', 'never', 'nan', 'literal', 'enum', 'file', 'template_literal', 'custom',
  'transform', 'success', 'catchall',
]);

function base(node: Node): Node {
  let cur = node;
  for (let i = 0; i < 16 && cur; i++) {
    if (!WRAPPERS.has(kind(cur))) return cur;
    const inner = cur._def?.innerType;
    if (!inner) return cur;
    cur = inner;
  }
  return cur;
}

/** Composites addressable by a dotted path — the ones we can generate cases for. */
function composites(node: Node, path: string[] = [], out: Array<[string, Record<string, Node>]> = []) {
  const b = base(node);
  if (kind(b) !== 'object' || !b.shape) return out;
  if (path.length) out.push([path.join('.'), b.shape]);
  for (const [name, child] of Object.entries(b.shape)) composites(child, [...path, name], out);
  return out;
}

/** Does this subtree contain an object schema anywhere? Used by STRUCTURAL 3. */
function holdsComposite(node: Node, depth = 0): boolean {
  if (!node || depth > 8) return false;
  const b = base(node);
  const k = kind(b);
  if (k === 'object') return true;
  const children = CONTAINERS[k]?.(b._def ?? {});
  return !!children?.some((c) => holdsComposite(c, depth + 1));
}

/** Walk everything, reporting what the case generator cannot reach. */
function audit(node: Node, path: string[] = [], problems: string[] = [], depth = 0) {
  if (!node || depth > 16) return problems;
  const b = base(node);
  const k = kind(b);
  const where = path.join('.') || '<root>';
  if (k === 'object') {
    for (const [name, child] of Object.entries(b.shape ?? {})) audit(child, [...path, name], problems, depth + 1);
  } else if (CONTAINERS[k]) {
    if (holdsComposite(b)) {
      problems.push(
        `${where}: a composite is reachable only through a '${k}', which this walker cannot address by ` +
          `dotted path — it would generate NO cases and NO complaint. Extend the walker or flatten the schema.`,
      );
    }
  } else if (!LEAVES.has(k)) {
    problems.push(`${where}: unrecognised zod node kind '${k}' — classify it in LEAVES/WRAPPERS/CONTAINERS before trusting this guard.`);
  }
  return problems;
}

const get = (o: any, p: string) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function set(o: any, p: string, v: unknown) {
  const ks = p.split('.');
  const last = ks.pop()!;
  const t = ks.reduce((a, k) => (a[k] ??= {}), o);
  t[last] = v;
}

const SENTINEL = '__blast_sentinel__';

const rawFixture = () => ({
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

  /** Fixture with a sentinel injected into every composite that exists. */
  const wellFormed = () => {
    const f = rawFixture() as any;
    for (const [composite] of found) if (get(f, composite) !== undefined) set(f, `${composite}.${SENTINEL}`, 'S');
    return f;
  };

  it('STRUCTURAL 1 — the fixture supplies every composite and field the walker finds', () => {
    const missing: string[] = [];
    for (const [composite, shape] of found) {
      if (get(rawFixture(), composite) === undefined) { missing.push(composite); continue; }
      for (const field of Object.keys(shape)) {
        if (get(rawFixture(), `${composite}.${field}`) === undefined) missing.push(`${composite}.${field}`);
      }
    }
    expect(
      [...new Set(missing)],
      `rawFixture() is missing ${[...new Set(missing)].join(', ')}. A composite or field was added to ` +
        `entrySchema without extending the fixture — until you do, its blast-radius cases CANNOT FAIL.`,
    ).toEqual([]);
  });

  it('STRUCTURAL 2 — the walker finds the expected composites', () => {
    expect(found.length, 'the schema walker found NO composites — zod internals likely changed').toBeGreaterThan(0);
    expect(
      found.map(([n]) => n).sort(),
      'a composite was added to or removed from entrySchema. Extend rawFixture() FIRST (STRUCTURAL 1 ' +
        'will tell you exactly what to add), then update this list.',
    ).toEqual(['author', 'provenance', 'refs', 'validity']);
  });

  it('STRUCTURAL 3 — no composite hides where the case generator cannot reach it', () => {
    const problems = audit(entrySchema as unknown as Node);
    expect(problems, `the walker cannot cover part of the schema:\n  ${problems.join('\n  ')}`).toEqual([]);
  });

  for (const [composite, shape] of found) {
    for (const field of Object.keys(shape)) {
      const path = `${composite}.${field}`;
      const reason = UNCORRUPTIBLE[path];

      it(`${path}: ${reason ? 'declared uncorruptible, and that stays true' : 'corrupting it leaves its siblings intact'}`, () => {
        const b = base(shape[field]);
        const accepts = (v: unknown) => b.safeParse?.(v)?.success === true;

        if (reason) {
          // The exemption claims the field accepts EVERY value. Test a battery,
          // not one Symbol — a field that accepts the Symbol but rejects a
          // number is corruptible and must not hold a standing exemption.
          const rejected = BATTERY.filter((v) => !accepts(v));
          expect(
            rejected,
            `${path} is exempt as "${reason}" but REJECTS ${JSON.stringify(rejected)} — it is corruptible. ` +
              `Remove the exemption and add an entry to POISONS if the default poison does not bite.`,
          ).toEqual([]);
          return;
        }

        const poison = path in POISONS ? POISONS[path] : POISON;
        expect(
          accepts(poison),
          `${path} ACCEPTS its poison, so this case can never fail. Add a POISONS[${path}] that it rejects, ` +
            `or declare it UNCORRUPTIBLE with a reason.`,
        ).toBe(false);

        const baseline = normalizeEntry(wellFormed());
        expect(baseline.ok).toBe(true);
        const before = get((baseline as any).entry, composite) as Record<string, unknown>;

        // The baseline itself must not have detonated, or every check below is
        // vacuous — an invalid FIXTURE value would otherwise pass silently.
        expect(
          before?.[SENTINEL],
          `${composite}'s object-level .catch() ALREADY fired on the WELL-FORMED fixture, so every ` +
            `sibling check here is vacuous. Fix rawFixture().${composite} — one of its values is invalid.`,
        ).toBe('S');

        const corrupted = wellFormed();
        set(corrupted, path, poison);
        const r = normalizeEntry(corrupted);
        expect(r.ok).toBe(true);
        const after = (get((r as any).entry, composite) ?? {}) as Record<string, unknown>;

        // The property in the title, asserted directly: the object survived.
        // Value equality alone cannot see this when a catch default happens to
        // equal the fixture value.
        expect(
          after[SENTINEL],
          `${composite}'s object-level .catch() FIRED: the whole object was replaced by its default ` +
            `because ${path} was bad. Give ${path} its own .catch() in src/validate.ts.`,
        ).toBe('S');

        for (const sibling of Object.keys(shape)) {
          if (sibling === field) continue;
          expect(
            after[sibling],
            `${composite}.${sibling} was destroyed as collateral damage from a bad ${path}`,
          ).toEqual(before[sibling]);
        }
      });
    }
  }
});
