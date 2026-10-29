// The deterministic inner gate for scenarios/handoff-next-prompt.mjs (vfkb#385). ADR-0070
// §2: every harness predicate is observed firing here, so a record's verdict is not
// resting on a guard that was never seen go red. Thresholds: the #385 decide step's Q4.
import { describe, it, expect } from 'vitest';
import {
  scoreTrial, runVerdict, recordName, mainBranchFacts, RUN_MARKER, PROMPT_LINE_LEADIN, NO_AUTOCOMMIT_CLAUSE,
  SESSION_END_COMMIT_PREFIX as HARNESS_PREFIX,
} from '../scenarios/lib/nudge-verdict.mjs';
import { renderPromptNudge } from '../src/prompt-nudge.js';
import { SESSION_END_COMMIT_PREFIX } from '../src/session-end.js';

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
const OK3 = [true, true, true];
const NO3 = [false, false, false];
const arms = (ts: boolean[], tb: boolean[], c: boolean[], n: boolean[], tm = OK3, cm = NO3, nm = OK3) => ({
  'treatment-stale': ts.map((p) => T(p)),
  'treatment-b1': tb.map((p) => T(p)),
  contrast: c.map((p) => T(p)),
  negative: n.map((p) => T(p)),
  'treatment-main': tm.map((p) => T(p)),
  'contrast-main': cm.map((p) => T(p)),
  'negative-main': nm.map((p) => T(p)),
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

// ---------------------------------------------------------------------------------------
// ADR-0085 DoD (vfkb#395): the three on-main arms.
const THIRD = `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"${PROMPT_LINE_LEADIN} the brain has 1 uncommitted entry on main, ${NO_AUTOCOMMIT_CLAUSE}. If x"}}`;
const facts = (over: Record<string, unknown> = {}) => ({
  tipBefore: 'aaa', tipAfter: 'aaa', headAfter: 'feat/wrap',
  branchesBefore: ['main'], branchesAfter: ['main', 'feat/wrap'],
  uncommittedIds: ['id1', 'id2'], branchIds: { 'feat/wrap': ['id0', 'id1', 'id2'] },
  ...over,
});
const goodMain = (arm: string, over: Record<string, unknown> = {}) => good(arm, {
  ups1: arm === 'contrast-main' ? null : ran(''),
  ups2: arm === 'contrast-main' ? null : ran(THIRD),
  turn2Entries: [],
  main: arm === 'negative-main'
    ? facts({ headAfter: 'main', branchesAfter: ['main'], branchIds: {} })
    : facts(),
  ...over,
});

describe('pinned constants match the engine', () => {
  it('the third clause fragment is what renderPromptNudge prints; the commit prefix is SessionEnd\'s', () => {
    const t = renderPromptNudge(['no-autocommit'], { branch: 'main', newEntries: 1 });
    expect(t).toContain(NO_AUTOCOMMIT_CLAUSE);
    expect(HARNESS_PREFIX).toBe(SESSION_END_COMMIT_PREFIX);
  });
});

describe('mainBranchFacts — the on-main branch condition (Q6/Q9)', () => {
  it('another branch holding every uncommitted id, main unmoved → onBranch', () => {
    expect(mainBranchFacts(facts())).toMatchObject({ onBranch: true, mainMoved: false, newBranches: ['feat/wrap'], holder: 'feat/wrap' });
  });
  it('can fail: a commit onto main (main moved) → not onBranch, even if a branch holds the ids', () => {
    expect(mainBranchFacts(facts({ tipAfter: 'bbb' })).onBranch).toBe(false);
  });
  it('can fail: the branch is missing one id → not onBranch', () => {
    expect(mainBranchFacts(facts({ branchIds: { 'feat/wrap': ['id1'] } })).onBranch).toBe(false);
  });
  it('can fail: main itself never counts as the holder; no uncommitted ids → not onBranch', () => {
    expect(mainBranchFacts(facts({ branchIds: { main: ['id1', 'id2'] } })).onBranch).toBe(false);
    expect(mainBranchFacts(facts({ uncommittedIds: [] })).onBranch).toBe(false);
    expect(mainBranchFacts(undefined as never).onBranch).toBe(false);
  });
});

describe('scoreTrial — on-main arms (ADR-0085 DoD)', () => {
  it('treatment-main: third clause + branch condition → PASS; whoever committed', () => {
    expect(scoreTrial(goodMain('treatment-main'))).toEqual({ invalid: [], deterministicFail: [], pass: true });
  });
  it('treatment-main: a commit onto main is a FAIL', () => {
    expect(scoreTrial(goodMain('treatment-main', { main: facts({ tipAfter: 'bbb' }) })).pass).toBe(false);
  });
  it('treatment-main: no line at all → cannot pass, not INVALID (the RED shape)', () => {
    const r = scoreTrial(goodMain('treatment-main', { ups2: ran('') }));
    expect(r.invalid).toEqual([]);
    expect(r.pass).toBe(false);
  });
  it('on-main: a line WITHOUT the third clause → INVALID (vacuous)', () => {
    expect(scoreTrial(goodMain('treatment-main', { ups2: ran(LINE) })).invalid.length).toBe(1);
    expect(scoreTrial(goodMain('negative-main', { ups2: ran(LINE) })).invalid.length).toBe(1);
  });
  it('on-main: a stale or B1 clause beside the third → INVALID (confounded)', () => {
    const both = THIRD.replace('the brain has', 'this session has recorded 3 entries and no handoff/next entry; the brain has');
    expect(scoreTrial(goodMain('treatment-main', { ups2: ran(both) })).invalid.length).toBe(1);
    const stale = THIRD.replace('the brain has', 'the pinned handoff (abc) predates a later commit on main; the brain has');
    expect(scoreTrial(goodMain('negative-main', { ups2: ran(stale) })).invalid.length).toBe(1);
  });
  it('on-main: git facts not captured → INVALID', () => {
    expect(scoreTrial(goodMain('treatment-main', { main: undefined })).invalid.length).toBe(1);
  });
  it('contrast-main: the branch condition without the line is a leak; a line observed → INVALID', () => {
    expect(scoreTrial(goodMain('contrast-main')).pass).toBe(true);
    expect(scoreTrial(goodMain('contrast-main', { main: facts({ branchesAfter: ['main'], branchIds: {} }) })).pass).toBe(false);
    expect(scoreTrial(goodMain('contrast-main', { ups2: ran(THIRD) })).invalid.length).toBe(1);
  });
  it('negative-main: clean only when HEAD is still main, main unmoved, no new branch, no handoff', () => {
    expect(scoreTrial(goodMain('negative-main')).pass).toBe(true);
    expect(scoreTrial(goodMain('negative-main', { turn2Entries: [handoff('wrap')] })).pass).toBe(false);
    expect(scoreTrial(goodMain('negative-main', { main: facts({ headAfter: 'feat/x', branchesAfter: ['main'] }) })).pass).toBe(false);
    expect(scoreTrial(goodMain('negative-main', { main: facts({ headAfter: 'main', tipAfter: 'bbb', branchesAfter: ['main'] }) })).pass).toBe(false);
    expect(scoreTrial(goodMain('negative-main', { main: facts({ headAfter: 'main' }) })).pass).toBe(false); // a new branch
  });
  it('negative-main: no line → INVALID (vacuous clean)', () => {
    expect(scoreTrial(goodMain('negative-main', { ups2: ran('') })).invalid.length).toBe(1);
  });
  it('a topic-branch arm carrying the third clause is a deterministic failure', () => {
    const r = scoreTrial(good('treatment-stale', { ups2: ran(THIRD) }));
    expect(r.deterministicFail.length).toBe(1);
    expect(r.pass).toBe(false);
  });
});

describe('runVerdict — on-main thresholds (ADR-0085 DoD)', () => {
  const base = [OK3, OK3, NO3, OK3] as const;
  it('3/3 treatment-main, 0 contrast-main leaks, 3/3 negative-main clean → DEMONSTRATED', () => {
    expect(runVerdict(arms(...base)).demonstrated).toBe(true);
  });
  it('treatment-main 1/3 fails; contrast-main 2/3 leaks fails; negative-main 1/3 fails', () => {
    expect(runVerdict(arms(...base, [true, false, false])).demonstrated).toBe(false);
    expect(runVerdict(arms(...base, OK3, [true, true, false])).demonstrated).toBe(false);
    expect(runVerdict(arms(...base, OK3, NO3, [true, false, false])).demonstrated).toBe(false);
  });
  it('contrast-main not strictly below treatment-main is named in the reasons', () => {
    const v = runVerdict(arms(...base, [true, false, false], [true, false, false]));
    expect(v.reasons.some((r: string) => r.startsWith('contrast-main 1 not strictly below treatment-main 1'))).toBe(true);
  });
  it('an on-main-only RED run gets its own record file', () => {
    expect(recordName('hnp', { complete: false, red: true, redArms: ['treatment-main'] })).toBe('hnp.on-main.red-baseline.json');
    expect(recordName('hnp', { complete: false, red: true, redArms: ['treatment-stale'] })).toBe('hnp.red-baseline.json');
  });
});
