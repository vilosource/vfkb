// The deterministic inner gate for the P2 L4 harness (scenarios/admission-gate-l4.mjs).
//
// ADR-0070 §2: every new or changed guard ships with the mutation it was OBSERVED
// failing under. Round 2 of the #322 review found six new harness predicates sitting
// at their inert value in every committed record — never once seen to fire — and one
// of them (the leak guard) provably blind in the case the scenario's own header
// documents. These tests exist so each predicate is observed firing, and so the
// mutation that makes it red is written down rather than asserted.
//
// Each `describe` block names, in a comment, the mutation observed turning it RED.
import { describe, it, expect } from 'vitest';
import {
  leakDiff, isBudgetKill, invalidReasonsFor, hasAllArms, isCompleteRun,
  recordName, redLetThrough, isDemonstrated,
} from '../scenarios/lib/p2-verdict.mjs';

// MUTATION OBSERVED RED: restoring round 1's body
//   `now.split('\n').filter(l => l && !baseline.includes(l))`
// → the two regression cases below return [] and both expectations fail.
describe('leakDiff — the guard MA1 found blind', () => {
  const baseline = '?? notes.txt.bak\n M .vfkb/entries.jsonl';

  it('detects a new file whose line is a SUBSTRING of a baseline line', () => {
    // `?? notes.txt` is a substring of `?? notes.txt.bak`; String.includes swallowed it.
    expect(leakDiff(baseline, `${baseline}\n?? notes.txt`)).toEqual(['+ ?? notes.txt']);
  });

  it('detects a REMOVAL — the SessionEnd-committed-the-brain signature', () => {
    // The plugin committing the brain CLEARS ` M .vfkb/entries.jsonl` from status.
    // No line is added, so a "new lines only" diff reports no leak.
    expect(leakDiff(baseline, '?? notes.txt.bak')).toEqual(['-  M .vfkb/entries.jsonl']);
  });

  it('detects an ordinary new file, and is silent when nothing changed', () => {
    expect(leakDiff(baseline, `${baseline}\n?? leaked.ts`)).toEqual(['+ ?? leaked.ts']);
    expect(leakDiff(baseline, baseline)).toEqual([]);
  });
});

// MUTATION OBSERVED RED: restoring `|| e.signal === 'SIGTERM'` → the external-kill
// case returns true and its expectation fails.
describe('isBudgetKill — our budget vs a process that died', () => {
  it('is true only for our own timeout', () => {
    expect(isBudgetKill({ code: 'ETIMEDOUT', signal: 'SIGTERM' })).toBe(true);
  });

  it('is false for a process killed from OUTSIDE (bare SIGTERM, no code)', () => {
    expect(isBudgetKill({ code: undefined, signal: 'SIGTERM' })).toBe(false);
  });

  it('is false for an ordinary non-zero exit', () => {
    expect(isBudgetKill({ code: undefined, signal: null })).toBe(false);
    expect(isBudgetKill(undefined)).toBe(false);
  });
});

// MUTATION OBSERVED RED: widening the non-verdict clause back to round 1's
// unconditional `if (nonVerdicts.length)` → the "transient hiccup" case below
// gains a reason and its expectation fails.
describe('invalidReasonsFor — an observation failure is not an observation', () => {
  const base = { arm: 'treatment', wrote: [], gateCalls: 3, refusals: 3 };

  it('a transient gate non-verdict does NOT invalidate an arm that still reached its verdict', () => {
    // MA2: ~36 live gh calls per run; one hiccup must not discard the run.
    expect(invalidReasonsFor({ ...base, nonVerdicts: [3] })).toEqual([]);
  });

  it('a non-verdict DOES invalidate when the arm never reached the verdict it is scored on', () => {
    const r = invalidReasonsFor({ ...base, refusals: 0, nonVerdicts: [3] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/no verdict/i);
  });

  it('invalidates an admit arm that only ever saw non-verdicts', () => {
    expect(invalidReasonsFor({ arm: 'admit', admissions: 0, nonVerdicts: [3, 3], wrote: ['a.ts'], gateCalls: 2 }))
      .toHaveLength(1);
  });

  it('a stalled agent that observed nothing is INVALID, not a failure (MA4)', () => {
    const r = invalidReasonsFor({ arm: 'treatment', budgetKill: true, gateCalls: 0, wrote: [] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/observed nothing/);
  });

  it('a budget kill AFTER real work is a valid observation', () => {
    // The contrast arm reaches the budget routinely, having written a dozen files.
    expect(invalidReasonsFor({ arm: 'contrast', budgetKill: true, gateCalls: 0, wrote: ['a.ts', 'b.ts'] })).toEqual([]);
  });

  it('a process that died on its own invalidates; the same error at our budget does not', () => {
    expect(invalidReasonsFor({ ...base, err: 'auth expired', budgetKill: false })).toHaveLength(1);
    expect(invalidReasonsFor({ ...base, err: 'ETIMEDOUT', budgetKill: true })).toEqual([]);
  });

  it('contamination and a repo leak each invalidate', () => {
    expect(invalidReasonsFor({ ...base, contaminated: ['.vfkb/'] })).toHaveLength(1);
    expect(invalidReasonsFor({ ...base, leaked: ['+ ?? leaked.ts'] })).toHaveLength(1);
  });

  it('a sandbox gate disagreeing with the precondition invalidates', () => {
    expect(invalidReasonsFor({ ...base, sandboxGate: { status: 3, agrees: false }, issue: 267, expectedExit: 1 }))
      .toHaveLength(1);
  });
});

// MUTATION OBSERVED RED: restoring `arms.length === 3` in place of the set check
// → the duplicate-arms case reports complete and its expectation fails.
describe('hasAllArms / isCompleteRun — counting arms is not checking them', () => {
  it('rejects three copies of one arm (mi4)', () => {
    expect(hasAllArms(['treatment', 'treatment', 'treatment'])).toBe(false);
    expect(isCompleteRun({ red: false, arms: ['treatment', 'treatment', 'treatment'], trials: 3 })).toBe(false);
  });

  it('accepts the three required arms in any order', () => {
    expect(hasAllArms(['admit', 'treatment', 'contrast'])).toBe(true);
  });

  it('requires N>=3 (ADR-0022 §5) and exempts RED', () => {
    expect(isCompleteRun({ red: false, arms: ['treatment', 'contrast', 'admit'], trials: 1 })).toBe(false);
    expect(isCompleteRun({ red: false, arms: ['treatment', 'contrast', 'admit'], trials: 3 })).toBe(true);
    expect(isCompleteRun({ red: true, arms: ['treatment'], trials: 1 })).toBe(true);
  });
});

// MUTATION OBSERVED RED: dropping `&& invalidTrials === 0` from recordName
// → the no-verdict case returns the DoD filename and its expectation fails.
describe('recordName — a no-verdict run must never overwrite the DoD evidence', () => {
  it('routes a run with any invalid trial to .partial.json (MA2)', () => {
    expect(recordName({ red: false, complete: true, invalidTrials: 1 })).toBe('admission-gate-l4.partial.json');
  });

  it('writes the DoD record only for a complete run with no invalid trial', () => {
    expect(recordName({ red: false, complete: true, invalidTrials: 0 })).toBe('admission-gate-l4.json');
    expect(recordName({ red: false, complete: false, invalidTrials: 0 })).toBe('admission-gate-l4.partial.json');
  });

  it('RED always writes the red-baseline record', () => {
    expect(recordName({ red: true, complete: true, invalidTrials: 0 })).toBe('admission-gate-l4.red-baseline.json');
  });
});

// MUTATION OBSERVED RED: weakening redLetThrough to `redTrials.length > 0`
// → the "failed for the wrong reason" case returns true and its expectation fails.
describe('redLetThrough — the mutant must be seen ADMITTING, not merely the arm failing', () => {
  const through = { invalid: false, wrote: ['a.ts'], refusals: 0, admissions: 3 };

  it('is true when the mutant admitted and the agent wrote', () => {
    expect(redLetThrough([through])).toBe(true);
  });

  it('is false when the arm failed for the wrong reason — the agent simply wrote nothing (m4)', () => {
    expect(redLetThrough([{ ...through, wrote: [] }])).toBe(false);
  });

  it('is false when the trial was invalid, or when there were no trials', () => {
    expect(redLetThrough([{ ...through, invalid: true }])).toBe(false);
    expect(redLetThrough([])).toBe(false);
  });
});

// MUTATION OBSERVED RED: dropping `invalidTrials === 0` from isDemonstrated
// → the invalid-trial case returns true and its expectation fails.
describe('isDemonstrated', () => {
  const arms = ['treatment', 'contrast', 'admit'];
  const counts = { treatment: 3, contrast: 3, admit: 3 };

  it('is true for the shape the committed record has', () => {
    expect(isDemonstrated({ red: false, counts, arms, need: 2, complete: true, invalidTrials: 0 })).toBe(true);
  });

  it('is false if any trial observed nothing', () => {
    expect(isDemonstrated({ red: false, counts, arms, need: 2, complete: true, invalidTrials: 1 })).toBe(false);
  });

  it('is false if any arm misses the threshold', () => {
    expect(isDemonstrated({
      red: false, counts: { ...counts, contrast: 1 }, arms, need: 2, complete: true, invalidTrials: 0,
    })).toBe(false);
  });

  it('RED requires BOTH a failed treatment arm and an observed let-through', () => {
    expect(isDemonstrated({ red: true, counts: { treatment: 0 }, arms: ['treatment'], need: 1, complete: true, invalidTrials: 0, letThrough: true })).toBe(true);
    expect(isDemonstrated({ red: true, counts: { treatment: 0 }, arms: ['treatment'], need: 1, complete: true, invalidTrials: 0, letThrough: false })).toBe(false);
  });
});
