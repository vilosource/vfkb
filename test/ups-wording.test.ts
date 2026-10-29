// The deterministic inner gate for the #411 Tier-0 wording probe
// (docs/research/probes/ups-wording-2026-10-29/README.md). Every transform, every VOID path
// and every branch of the pre-registered decision rule is observed firing here (ADR-0070 §2),
// so the probe's verdict never rests on a guard nobody saw go red.
import { describe, it, expect } from 'vitest';
import {
  FIXTURE_E2AC6E9,
  TAIL,
  VARIANTS,
  transformText,
  applyVariant,
  isV0Shape,
  preconditions,
  probeVerdict,
  nextVariant,
} from '../scenarios/lib/ups-wording.mjs';

const json = (ctx: string) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx } });

describe('transformText — one variable per variant', () => {
  it('the fixture is the e2ac6e9 line recorded at 467a4c1', () => {
    expect(FIXTURE_E2AC6E9).toBe(
      'vfkb handoff status: the pinned handoff (b14f4ed4150b, 2026-10-29) predates 1 commit on feat/work: e657c56 docs: release checklist. ' +
        'If this prompt ends the session, a fresh handoff/next entry (kb_add type=fact, tags=handoff,next, role=human) naming what changed ' +
        'and what is next is the one thing worth recording before finishing; otherwise nothing is needed now — the next session sees this same list at start.',
    );
    expect(VARIANTS).toEqual(['V0', 'V1', 'V2']);
  });
  it('V0 is the identity', () => {
    expect(transformText('V0', FIXTURE_E2AC6E9)).toBe(FIXTURE_E2AC6E9);
  });
  it('V1 removes exactly the tail', () => {
    expect(transformText('V1', FIXTURE_E2AC6E9)).toBe(FIXTURE_E2AC6E9.replace(TAIL, ''));
    expect(transformText('V1', FIXTURE_E2AC6E9)!.endsWith('otherwise nothing is needed now.')).toBe(true);
    expect(transformText('V1', FIXTURE_E2AC6E9)).toContain('predates 1 commit on feat/work: e657c56 docs: release checklist.');
  });
  it('V2 removes exactly the inline list, keeping the count and the tail', () => {
    const v2 = transformText('V2', FIXTURE_E2AC6E9)!;
    expect(v2).toBe(FIXTURE_E2AC6E9.replace(': e657c56 docs: release checklist', ''));
    expect(v2).toContain('predates 1 commit on feat/work. If this prompt ends the session');
    expect(v2.endsWith(`${TAIL}.`)).toBe(true);
    expect(v2).not.toMatch(/e657c56|release checklist/);
  });
  it('V2 also strips a multi-commit list with (+k more), and stops at a B1 clause', () => {
    const t =
      'vfkb handoff status: the pinned handoff (p, 2026-10-29) predates 9 commits on feat/x: 1111111 a: b; 2222222 c (+7 more); ' +
      'this session has recorded 4 entries and no handoff/next entry. If this prompt ends the session, x; otherwise nothing is needed now' +
      TAIL + '.';
    expect(transformText('V2', t)).toBe(t.replace(': 1111111 a: b; 2222222 c (+7 more)', ''));
  });
  it('a transform that does not match returns null (a miss, never a silent V0)', () => {
    const noTail = FIXTURE_E2AC6E9.replace(TAIL, '');
    expect(transformText('V1', noTail)).toBeNull();
    const noList = FIXTURE_E2AC6E9.replace(': e657c56 docs: release checklist', '');
    expect(transformText('V2', noList)).toBeNull();
    expect(transformText('V1', FIXTURE_E2AC6E9 + TAIL)).toBeNull(); // twice → miss
    expect(transformText('V9' as never, FIXTURE_E2AC6E9)).toBeNull();
  });
  it('V2 misses when the inline list appears twice (exactly-once, like V1)', () => {
    const twice = FIXTURE_E2AC6E9.replace('docs: release checklist.', 'docs: release checklist; this session has recorded 3 entries and no handoff/next entry; predates 1 commit on feat/work: 1234567 x.');
    expect([...twice.matchAll(/predates 1 commit on feat\/work: /g)].length).toBe(2);
    expect(transformText('V2', twice)).toBeNull();
  });
});

describe('applyVariant — the hook rewrite contract', () => {
  it('empty engine stdout prints nothing and is not a miss', () => {
    expect(applyVariant('V1', '')).toEqual({ out: '', miss: false });
    expect(applyVariant('V1', '  \n')).toEqual({ out: '', miss: false });
  });
  it('JSON without additionalContext passes through unchanged', () => {
    const s = JSON.stringify({ continue: true });
    expect(applyVariant('V2', s)).toEqual({ out: s, miss: false });
  });
  it('rewrites only additionalContext', () => {
    const r = applyVariant('V1', json(FIXTURE_E2AC6E9));
    expect(r.miss).toBe(false);
    const o = JSON.parse(r.out);
    expect(o.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(o.hookSpecificOutput.additionalContext).toBe(transformText('V1', FIXTURE_E2AC6E9));
  });
  it('V0 is a byte-identical pass-through', () => {
    const s = json(FIXTURE_E2AC6E9);
    expect(applyVariant('V0', s)).toEqual({ out: s, miss: false });
  });
  it('a miss prints nothing and reports the miss', () => {
    expect(applyVariant('V1', json('vfkb handoff status: other text.'))).toEqual({ out: '', miss: true });
  });
  it('non-JSON stdout carrying the line is a miss for V1/V2', () => {
    expect(applyVariant('V2', FIXTURE_E2AC6E9)).toEqual({ out: '', miss: true });
  });
});

describe('isV0Shape and the run-level precondition', () => {
  it('accepts the fixture and other real pin ids / shas', () => {
    expect(isV0Shape(FIXTURE_E2AC6E9)).toBe(true);
    expect(isV0Shape(FIXTURE_E2AC6E9.replace('b14f4ed4150b', '1ac1b2a7c6c8').replace('e657c56', '2cb69a8'))).toBe(true);
  });
  it('is anchored at both ends: leading or trailing extra text is not V0', () => {
    expect(isV0Shape(FIXTURE_E2AC6E9 + ' extra')).toBe(false);
    expect(isV0Shape('x ' + FIXTURE_E2AC6E9)).toBe(false);
  });
  it('rejects a variant, the b5f0fef shape and a B1 line', () => {
    expect(isV0Shape(transformText('V1', FIXTURE_E2AC6E9)!)).toBe(false);
    expect(isV0Shape(transformText('V2', FIXTURE_E2AC6E9)!)).toBe(false);
    expect(isV0Shape(FIXTURE_E2AC6E9.replace('1 commit on feat/work: e657c56 docs: release checklist', 'a later commit on feat/work'))).toBe(false);
    expect(isV0Shape('vfkb handoff status: this session has recorded 3 entries and no handoff/next entry.')).toBe(false);
  });
  it('passes on the fixture: pairwise distinct, tail and list each once', () => {
    expect(preconditions(FIXTURE_E2AC6E9)).toEqual([]);
  });
  it('fails when the tail or the list is absent or doubled', () => {
    expect(preconditions(FIXTURE_E2AC6E9.replace(TAIL, '')).length).toBeGreaterThan(0);
    expect(preconditions(FIXTURE_E2AC6E9.replace(': e657c56 docs: release checklist', '')).length).toBeGreaterThan(0);
    expect(preconditions(FIXTURE_E2AC6E9 + TAIL).length).toBeGreaterThan(0);
  });
  it('fails on a doubled list alone (tail still once)', () => {
    const twice = FIXTURE_E2AC6E9.replace('docs: release checklist.', 'docs: release checklist; this session has recorded 3 entries and no handoff/next entry; predates 1 commit on feat/work: 1234567 x.');
    expect(preconditions(twice)).toContain('inline list found 2× (want 1)');
  });
  it('fails when two variants coincide (pairwise-distinct check)', () => {
    // A line whose tail and list removals are no-ops cannot be built from transformText, so the
    // check is driven through its injectable transform: an identity transform makes V1 == V0.
    expect(preconditions(FIXTURE_E2AC6E9, (v: string, t: string) => t)).toContain('variants are not pairwise distinct');
  });
});

describe('probeVerdict — every branch of the pre-registered rule', () => {
  const c = (v0: number, v1: number, v2: number, valid = [5, 5, 5]) => ({
    V0: { valid: valid[0], pass: v0 },
    V1: { valid: valid[1], pass: v1 },
    V2: { valid: valid[2], pass: v2 },
  });
  it('VOID when a variant has fewer than 5 valid (rule not evaluated)', () => {
    expect(probeVerdict(c(0, 5, 5, [5, 4, 5])).outcome).toBe('VOID');
    expect(probeVerdict(c(0, 0, 0, [3, 5, 5])).outcome).toBe('VOID');
  });
  it('ADOPT-V1 when V1 separates', () => {
    expect(probeVerdict(c(1, 4, 2)).outcome).toBe('ADOPT-V1');
    expect(probeVerdict(c(3, 4, 0)).outcome).toBe('ADOPT-V1');
  });
  it('ADOPT-V1 when both separate', () => {
    expect(probeVerdict(c(1, 4, 5)).outcome).toBe('ADOPT-V1');
  });
  it('ADOPT-V2 when only V2 separates', () => {
    expect(probeVerdict(c(2, 3, 4)).outcome).toBe('ADOPT-V2');
  });
  it('no separation when V0 is above 3/5, whatever the variants score', () => {
    expect(probeVerdict(c(4, 5, 5)).outcome).toBe('NEITHER');
  });
  it('NEITHER when no variant separates and none beats V0 by 2+', () => {
    expect(probeVerdict(c(2, 3, 3)).outcome).toBe('NEITHER');
    expect(probeVerdict(c(3, 3, 2)).outcome).toBe('NEITHER');
    expect(probeVerdict(c(3, 0, 0)).outcome).toBe('NEITHER'); // variants worse: not a signal
  });
  it('SIGNAL-WITHOUT-CLEARANCE when a variant beats V0 by 2+ but none reaches 4/5', () => {
    expect(probeVerdict(c(0, 3, 0)).outcome).toBe('SIGNAL-WITHOUT-CLEARANCE');
    expect(probeVerdict(c(1, 1, 3)).outcome).toBe('SIGNAL-WITHOUT-CLEARANCE');
  });
  it('carries a reason line', () => {
    expect(probeVerdict(c(0, 3, 0)).reasons.join(' ')).toMatch(/V1 3\/5/);
  });
});

describe('nextVariant — fixed round-robin with the 10-attempt cap', () => {
  const st = (a: number[], v: number[]) => ({
    V0: { attempts: a[0], valid: v[0] },
    V1: { attempts: a[1], valid: v[1] },
    V2: { attempts: a[2], valid: v[2] },
  });
  it('starts at V0 and walks V0, V1, V2', () => {
    expect(nextVariant(st([0, 0, 0], [0, 0, 0]), null)).toBe('V0');
    expect(nextVariant(st([1, 0, 0], [1, 0, 0]), 'V0')).toBe('V1');
    expect(nextVariant(st([1, 1, 0], [1, 1, 0]), 'V1')).toBe('V2');
    expect(nextVariant(st([1, 1, 1], [1, 1, 1]), 'V2')).toBe('V0');
  });
  it('skips a variant that already has 5 valid', () => {
    expect(nextVariant(st([5, 6, 5], [5, 4, 5]), 'V2')).toBe('V1');
  });
  it('stops when all have 5 valid', () => {
    expect(nextVariant(st([5, 5, 5], [5, 5, 5]), 'V2')).toBeNull();
  });
  it('stops as soon as any variant hits 10 attempts short of 5 valid', () => {
    expect(nextVariant(st([10, 6, 6], [4, 5, 5]), 'V2')).toBeNull();
  });
});
