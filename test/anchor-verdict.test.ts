// scenarios/lib/anchor-verdict.mjs (vfkb#386, ADR-0084 DoD 2): every predicate observed
// firing (ADR-0070 §2), and the lead-ins pinned to the production strings.
import { describe, it, expect } from 'vitest';
import {
  B3_CLOSING,
  B3_LEADIN,
  B3_NEXT_SESSION,
  COMMITS_LEAD,
  RUN_MARKER,
  invocations,
  runVerdict,
  scoreTrial,
} from '../scenarios/lib/anchor-verdict.mjs';
import { renderStaleHandoffReminder, STALE_HANDOFF_LEADIN, STALE_HANDOFF_NEXT_SESSION } from '../src/stop-reminder.js';
import { COMMITS_SINCE_LEADIN } from '../src/engine.js';

const run = (out: string) => `${RUN_MARKER}\n${out}\n`;
const quiet = run('{}');
const b3 = (sha7: string, subject: string) =>
  run(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        decision: 'block',
        additionalContext: renderStaleHandoffReminder({ id: 'p', created: '2026-10-28T00:00:00.000Z' }, [
          { hash: sha7.padEnd(40, '0'), short: sha7, subject },
        ]),
      },
    }),
  );
const base = { isolationReasons: [], leak: [], engaged: true };
const canFail = (t3: string, over = {}) =>
  scoreTrial({ ...base, arm: 'can-fail', turnLogs: [quiet, quiet, t3], sentinelSubject: 'fix: s-1', sentinelSha7: 'abc1234', ...over });

describe('anchor-verdict', () => {
  it('pins its strings to production', () => {
    expect(STALE_HANDOFF_LEADIN.startsWith(B3_LEADIN)).toBe(true);
    expect(B3_NEXT_SESSION).toBe(STALE_HANDOFF_NEXT_SESSION);
    expect(COMMITS_LEAD).toBe(COMMITS_SINCE_LEADIN);
    expect(renderStaleHandoffReminder({ id: 'p', created: 'x' }, [{ hash: 'a', short: 'a', subject: 's' }]).endsWith(B3_CLOSING)).toBe(true);
  });

  it('squash: quiet on all turns passes', () => {
    expect(scoreTrial({ ...base, arm: 'squash', turnLogs: [quiet, quiet, quiet] })).toEqual({ invalid: [], deterministicFail: [], pass: true });
  });
  it('squash: B3 at turn 3 fails (the RED shape)', () => {
    const r = scoreTrial({ ...base, arm: 'squash', turnLogs: [quiet, quiet, b3('abc1234', 'x') + quiet] });
    expect(r.pass).toBe(false);
    expect(r.deterministicFail.join()).toMatch(/turn-3 Stop emitted output/);
  });
  it('a marker with no parseable JSON (a crashed hook) fails, never scores quiet', () => {
    const r = scoreTrial({ ...base, arm: 'squash', turnLogs: [quiet, quiet, `${RUN_MARKER}\n\n`] });
    expect(r.deterministicFail.join()).toMatch(/no parseable JSON/);
  });
  it('a turn where the hook never ran fails', () => {
    expect(scoreTrial({ ...base, arm: 'squash', turnLogs: [quiet, '', quiet] }).deterministicFail.join()).toMatch(/turn 2: Stop hook did not run/);
  });
  it('B3 before turn 3 fails in either arm (1a)', () => {
    expect(canFail(b3('abc1234', 'fix: s-1'), { turnLogs: [quiet, b3('abc1234', 'fix: s-1'), b3('abc1234', 'fix: s-1')] }).deterministicFail.join()).toMatch(
      /turn 2: B3 fired before turn 3/,
    );
  });
  it('can-fail: the new text listing the sentinel commit passes', () => {
    expect(canFail(b3('abc1234', 'fix: s-1') + quiet).pass).toBe(true);
  });
  it('can-fail: quiet at turn 3 fails', () => {
    expect(canFail(quiet).deterministicFail.join()).toMatch(/no turn-3 Stop invocation carried B3/);
  });
  it('can-fail: the OLD text (no list, no §4.4 sentence) fails', () => {
    const old = run(
      JSON.stringify({
        hookSpecificOutput: {
          additionalContext:
            'vfkb stale-handoff check: the currently pinned handoff/next entry predates a commit that landed since it was written. ' +
            'If you are still mid-session, ignore this and finish normally.',
        },
      }),
    );
    const r = canFail(old);
    expect(r.deterministicFail.join()).toMatch(/RFC-047 §4.4/);
    expect(r.deterministicFail.join()).toMatch(/Commits since/);
  });
  it('can-fail: a list naming another commit fails', () => {
    expect(canFail(b3('def5678', 'fix: other')).deterministicFail.join()).toMatch(/sentinel commit/);
  });
  it('isolation / leak / disengaged → INVALID', () => {
    expect(scoreTrial({ ...base, arm: 'squash', turnLogs: [quiet, quiet, quiet], isolationReasons: ['t1: plugin loaded'] }).invalid).toHaveLength(1);
    expect(scoreTrial({ ...base, arm: 'squash', turnLogs: [quiet, quiet, quiet], leak: ['src/x.ts'] }).invalid).toHaveLength(1);
    expect(scoreTrial({ ...base, arm: 'squash', turnLogs: [quiet, quiet, quiet], engaged: false }).invalid).toHaveLength(1);
  });
  it('invocations() splits on the marker', () => {
    expect(invocations(quiet + quiet).map((x) => x.json)).toEqual([{}, {}]);
  });
  it('runVerdict: 3/3 per arm demonstrates; one failure or a missing trial does not', () => {
    const ok = { invalid: [], deterministicFail: [], pass: true };
    const bad = { invalid: [], deterministicFail: ['x'], pass: false };
    expect(runVerdict({ squash: [ok, ok, ok], 'can-fail': [ok, ok, ok] }).demonstrated).toBe(true);
    expect(runVerdict({ squash: [ok, ok, bad], 'can-fail': [ok, ok, ok] }).demonstrated).toBe(false);
    expect(runVerdict({ squash: [ok, ok], 'can-fail': [ok, ok, ok] }).demonstrated).toBe(false);
  });
});
