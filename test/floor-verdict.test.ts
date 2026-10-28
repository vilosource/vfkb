// scenarios/lib/floor-verdict.mjs (vfkb#386, ADR-0084 DoD 3): every predicate observed firing.
import { describe, it, expect } from 'vitest';
import { BLOCK_LEAD, RUN_MARKER, runVerdict, scoreTrial } from '../scenarios/lib/floor-verdict.mjs';
import { COMMITS_SINCE_LEADIN } from '../src/engine.js';

const log = (body: string) => `${RUN_MARKER}\n${JSON.stringify({ hookSpecificOutput: { additionalContext: body } })}\n`;
const pinOnly = log('## Last handoff\n- [fact] next: heron-1 checklist\n\n<vfkb-map>');
const withBlock = log('## Last handoff\n- [fact] next: heron-1 checklist\nCommits since this handoff was recorded (1):\n  abc1234 feat: add the kestrel-9 module\n\n');
const base = { isolationReasons: [], leak: [], engaged: true, pinSentinel: 'heron-1', commitSentinel: 'kestrel-9' };

describe('floor-verdict', () => {
  it('pins the block lead-in to production', () => {
    expect(COMMITS_SINCE_LEADIN.startsWith(BLOCK_LEAD)).toBe(true);
  });
  it('treatment: render lists it and the agent names it → pass', () => {
    expect(scoreTrial({ ...base, arm: 'treatment', sessionStartLog: withBlock, answer: 'feat: add the kestrel-9 module' }).pass).toBe(true);
  });
  it('treatment: the agent cannot name it → not a pass, no deterministic failure', () => {
    const r = scoreTrial({ ...base, arm: 'treatment', sessionStartLog: withBlock, answer: 'UNKNOWN' });
    expect(r.pass).toBe(false);
    expect(r.deterministicFail).toEqual([]);
  });
  it('treatment: a render without the block is a deterministic failure (the RED shape)', () => {
    expect(scoreTrial({ ...base, arm: 'treatment', sessionStartLog: pinOnly, answer: 'UNKNOWN' }).deterministicFail.join()).toMatch(/did not list/);
  });
  it('contrast: naming it is a leak; a render carrying the block is a deterministic failure', () => {
    expect(scoreTrial({ ...base, arm: 'contrast', sessionStartLog: pinOnly, answer: 'kestrel-9' }).pass).toBe(true);
    expect(scoreTrial({ ...base, arm: 'contrast', sessionStartLog: withBlock, answer: 'x' }).deterministicFail.join()).toMatch(/carried/);
  });
  it('squash-negative: pin shown and no block → pass; a block or a missing pin → fail', () => {
    expect(scoreTrial({ ...base, arm: 'squash-negative', sessionStartLog: pinOnly, answer: '' }).pass).toBe(true);
    expect(scoreTrial({ ...base, arm: 'squash-negative', sessionStartLog: withBlock, answer: '' }).pass).toBe(false);
    expect(scoreTrial({ ...base, arm: 'squash-negative', sessionStartLog: log('nothing'), answer: '' }).pass).toBe(false);
  });
  it('a SessionStart that never ran is INVALID; isolation / leak / no result too', () => {
    expect(scoreTrial({ ...base, arm: 'treatment', sessionStartLog: '', answer: '' }).invalid.join()).toMatch(/did not run/);
    expect(scoreTrial({ ...base, arm: 'treatment', sessionStartLog: withBlock, answer: '', isolationReasons: ['x'] }).invalid).toHaveLength(1);
    expect(scoreTrial({ ...base, arm: 'treatment', sessionStartLog: withBlock, answer: '', leak: ['f'] }).invalid).toHaveLength(1);
    expect(scoreTrial({ ...base, arm: 'treatment', sessionStartLog: withBlock, answer: '', engaged: false }).invalid).toHaveLength(1);
  });
  it('mcp-resume: SessionStart must be unwired; named → pass', () => {
    expect(scoreTrial({ ...base, arm: 'mcp-resume', sessionStartLog: null, answer: 'kestrel-9' }).pass).toBe(true);
    expect(scoreTrial({ ...base, arm: 'mcp-resume', sessionStartLog: withBlock, answer: 'kestrel-9' }).invalid.join()).toMatch(/unwired/);
  });
  it('runVerdict: the thresholds', () => {
    const t = (pass: boolean, det: string[] = []) => ({ invalid: [], deterministicFail: det, pass });
    const good = { treatment: [t(true), t(true), t(false)], contrast: [t(false), t(false), t(true)], 'squash-negative': [t(true), t(true), t(true)] };
    expect(runVerdict(good).demonstrated).toBe(true);
    expect(runVerdict({ ...good, treatment: [t(true), t(false), t(false)] }).demonstrated).toBe(false);
    expect(runVerdict({ ...good, contrast: [t(true), t(true), t(false)] }).demonstrated).toBe(false);
    expect(runVerdict({ ...good, 'squash-negative': [t(true), t(true), t(false, ['x'])] }).demonstrated).toBe(false);
    expect(runVerdict({ ...good, treatment: [t(true), t(true), t(false, ['render'])] }).demonstrated).toBe(false);
    expect(runVerdict({ ...good, contrast: [t(false), t(false)] }).demonstrated).toBe(false);
    // diagnostic arm never gates
    expect(runVerdict({ ...good, 'mcp-resume': [t(false)] }).demonstrated).toBe(true);
  });
});
