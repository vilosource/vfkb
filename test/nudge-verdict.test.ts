// The deterministic inner gate for scenarios/handoff-next-prompt.mjs (vfkb#385). ADR-0070
// §2: every harness predicate is observed firing here, so a record's verdict is not
// resting on a guard that was never seen go red. Thresholds: the #385 decide step's Q4.
import { describe, it, expect } from 'vitest';
import { scoreTrial, runVerdict, recordName, RUN_MARKER, PROMPT_LINE_LEADIN } from '../scenarios/lib/nudge-verdict.mjs';

const LINE = `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"${PROMPT_LINE_LEADIN} x"}}`;
const ran = (out = '') => `${RUN_MARKER}\n${out}\n`;
const handoff = (text: string, tags = ['handoff', 'next']) => ({ type: 'fact', text, tags });

const good = (arm: string, over: Record<string, unknown> = {}) => ({
  arm,
  sentinel: 'KESTREL-ABC',
  isolationReasons: [],
  leak: [],
  engaged: true,
  ups1: arm === 'contrast' ? null : ran(''),
  ups2: arm === 'contrast' ? null : ran(LINE),
  stopLog: ran('{}') + ran('{}'),
  turn2Entries: arm === 'negative' || arm === 'contrast' ? [] : [handoff('handoff: KESTREL-ABC done. next: x')],
  ...over,
});

describe('scoreTrial — per-trial predicates', () => {
  it('a clean treatment trial passes', () => {
    expect(scoreTrial(good('treatment-stale'))).toEqual({ invalid: [], deterministicFail: [], pass: true });
  });
  it('treatment: the handoff must carry the sentinel', () => {
    expect(scoreTrial(good('treatment-b1', { turn2Entries: [handoff('handoff: other. next: y')] })).pass).toBe(false);
  });
  it("treatment: B2's auto floor does not count as an agent handoff", () => {
    expect(scoreTrial(good('treatment-stale', { turn2Entries: [handoff('KESTREL-ABC', ['handoff', 'next', 'auto'])] })).pass).toBe(false);
  });
  it('treatment: no line at turn 2 → cannot pass (RED shape, not INVALID)', () => {
    const r = scoreTrial(good('treatment-stale', { ups2: ran('') }));
    expect(r.invalid).toEqual([]);
    expect(r.pass).toBe(false);
  });
  it('the UserPromptSubmit hook not running → INVALID', () => {
    expect(scoreTrial(good('treatment-stale', { ups2: '' })).invalid.length).toBe(1);
  });
  it('a line at turn 1 is a deterministic failure (Q2)', () => {
    const r = scoreTrial(good('treatment-stale', { ups1: ran(LINE) }));
    expect(r.deterministicFail.length).toBe(1);
    expect(r.pass).toBe(false);
  });
  it('Stop emitting B1 or B3 text is a deterministic failure; so is no Stop invocation', () => {
    expect(scoreTrial(good('treatment-b1', { stopLog: ran('{"x":"vfkb handoff check: …"}') })).deterministicFail.length).toBe(1);
    expect(scoreTrial(good('negative', { stopLog: ran('vfkb stale-handoff check: …') })).deterministicFail.length).toBe(1);
    expect(scoreTrial(good('negative', { stopLog: '' })).deterministicFail.length).toBe(1);
  });
  it('negative: no line at turn 2 → INVALID (a vacuous clean)', () => {
    expect(scoreTrial(good('negative', { ups2: ran('') })).invalid.length).toBe(1);
  });
  it('negative: a handoff written → not clean', () => {
    expect(scoreTrial(good('negative', { turn2Entries: [handoff('wrap')] })).pass).toBe(false);
    expect(scoreTrial(good('negative')).pass).toBe(true);
  });
  it('contrast: a line observed → INVALID; a spontaneous handoff counts as a leak', () => {
    expect(scoreTrial(good('contrast', { ups2: ran(LINE) })).invalid.length).toBe(1);
    expect(scoreTrial(good('contrast', { turn2Entries: [handoff('x')] })).pass).toBe(true);
    expect(scoreTrial(good('contrast')).pass).toBe(false);
  });
  it('isolation, leak and engagement failures are INVALID', () => {
    expect(scoreTrial(good('treatment-stale', { isolationReasons: ['plugin loaded'] })).invalid.length).toBe(1);
    expect(scoreTrial(good('treatment-stale', { leak: ['src/greeter.ts'] })).invalid.length).toBe(1);
    expect(scoreTrial(good('treatment-stale', { engaged: false })).invalid.length).toBe(1);
  });
});

const T = (pass: boolean, extra: Record<string, unknown> = {}) => ({ invalid: [], deterministicFail: [], pass, ...extra });
const arms = (ts: boolean[], tb: boolean[], c: boolean[], n: boolean[]) => ({
  'treatment-stale': ts.map((p) => T(p)),
  'treatment-b1': tb.map((p) => T(p)),
  contrast: c.map((p) => T(p)),
  negative: n.map((p) => T(p)),
});

describe('runVerdict — thresholds (Q4)', () => {
  it('3/3 treatments, 0 leaks, 3/3 clean → DEMONSTRATED', () => {
    expect(runVerdict(arms([true, true, true], [true, true, true], [false, false, false], [true, true, true])).demonstrated).toBe(true);
  });
  it('2/3 vs 1/3 leak passes (house precedent), 2/3 negative passes', () => {
    expect(runVerdict(arms([true, true, false], [true, true, false], [true, false, false], [true, true, false])).demonstrated).toBe(true);
  });
  it('a treatment arm at 1/3 fails', () => {
    expect(runVerdict(arms([true, false, false], [true, true, true], [false, false, false], [true, true, true])).demonstrated).toBe(false);
  });
  it('contrast 2/3 leaks fails; contrast not strictly below a treatment fails', () => {
    expect(runVerdict(arms([true, true, true], [true, true, true], [true, true, false], [true, true, true])).demonstrated).toBe(false);
    // At N=3 the strict-below rule is implied by "treatment ≥2, leaks ≤1"; it is asserted
    // directly on the reasons so a mutation that drops it still goes red.
    const v = runVerdict(arms([true, false, false], [true, true, true], [true, false, false], [true, true, true]));
    expect(v.reasons.some((r: string) => r.startsWith('contrast 1 not strictly below treatment-stale 1'))).toBe(true);
  });
  it('negative clean 1/3 fails', () => {
    expect(runVerdict(arms([true, true, true], [true, true, true], [false, false, false], [true, false, false])).demonstrated).toBe(false);
  });
  it('any deterministic failure in a valid trial blocks DEMONSTRATED', () => {
    const a = arms([true, true, true], [true, true, true], [false, false, false], [true, true, true]);
    a.negative[0] = T(true, { deterministicFail: ['Stop emitted "vfkb handoff check"'] });
    expect(runVerdict(a).demonstrated).toBe(false);
  });
  it('fewer than 3 valid trials in an arm → no verdict (invalid trials do not count)', () => {
    const a = arms([true, true, true], [true, true, true], [false, false, false], [true, true]);
    (a.negative as unknown[]).push(T(true, { invalid: ['no init event'] }));
    const v = runVerdict(a);
    expect(v.complete).toBe(false);
    expect(v.demonstrated).toBe(false);
    expect(v.invalidTrials).toBe(1);
  });
  it('recordName never writes a partial over the DEMONSTRATED record', () => {
    expect(recordName('hnp', { complete: true, red: false })).toBe('hnp.json');
    expect(recordName('hnp', { complete: false, red: false })).toBe('hnp.partial.json');
    expect(recordName('hnp', { complete: true, red: true })).toBe('hnp.red-baseline.json');
  });
});
