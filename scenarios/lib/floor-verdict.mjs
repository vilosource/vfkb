// Pure verdict predicates for scenarios/stale-pin-floor.mjs (vfkb#386; ADR-0084 DoD item 3;
// RFC-043 Part A). Kept pure so every predicate is observed firing in a deterministic unit
// test (test/floor-verdict.test.ts) — ADR-0070 §2.
//
// Thresholds follow what each predicate observes (the #385 Q4 rule, carried by #386 D6/D7):
//   - treatment: the AGENT names the sentinel commit in ≥2/3 valid trials, AND (hook output,
//     deterministic) its SessionStart render carried the sentinel in every valid trial;
//   - contrast (the baseline engine on every face, decide D6): the agent names it in ≤1/3
//     and strictly fewer than treatment; its render (deterministic) shows the pin and no block;
//   - squash-negative: hook output only, 3/3 — the render shows `## Last handoff` and the
//     pin's own sentinel, and no "Commits since this handoff".
//   - mcp-resume (decide D10) is a DIAGNOSTIC arm: SessionStart not wired, the agent calls
//     kb_resume. Reported, never part of the verdict.
// INVALID (isolation, leak, no result, hook did not run) → re-run, up to 6 attempts per arm.
// Every predicate is a CONTENT assertion (ADR-0051 §3).

export const RUN_MARKER = '--- hook-run';
export const ARMS = ['treatment', 'contrast', 'squash-negative'];
export const DIAGNOSTIC_ARMS = ['mcp-resume'];
export const VALID_PER_ARM = 3;
export const MAX_ATTEMPTS_PER_ARM = 6;
export const BLOCK_LEAD = 'Commits since this handoff';
export const SECTION = '## Last handoff';

const has = (s, x) => typeof s === 'string' && x && s.toLowerCase().includes(String(x).toLowerCase());
export const runCount = (log) => (typeof log === 'string' ? log.split('\n').filter((l) => l.startsWith(RUN_MARKER)).length : 0);

/**
 * obs = { arm, isolationReasons, leak, engaged, sessionStartLog: string|null (null = not
 *         wired), answer: string, commitSentinel, pinSentinel }
 * → { invalid, deterministicFail, pass }   pass = treatment/mcp-resume: named it;
 *   contrast: a LEAK (named it); squash-negative: render facts hold.
 */
export function scoreTrial(obs) {
  const invalid = [...(obs.isolationReasons ?? [])];
  if (obs.leak?.length) invalid.push(`leak into the real repo: ${obs.leak.join(', ')}`);
  if (!obs.engaged) invalid.push('agent did not reach a final message');
  const det = [];
  const log = obs.sessionStartLog;
  if (obs.arm !== 'mcp-resume') {
    if (runCount(log) < 1) invalid.push('SessionStart hook did not run');
    const pinShown = has(log, SECTION) && has(log, obs.pinSentinel);
    if (!pinShown) det.push('SessionStart render lacks `## Last handoff` with the pin sentinel');
    if (obs.arm === 'treatment') {
      if (!has(log, BLOCK_LEAD) || !has(log, obs.commitSentinel)) det.push('treatment: the render did not list the sentinel commit');
    } else if (has(log, BLOCK_LEAD)) {
      det.push(`${obs.arm}: the render carried "${BLOCK_LEAD}"`);
    }
  } else if (log !== null && log !== undefined && runCount(log) > 0) {
    invalid.push('mcp-resume: SessionStart was supposed to be unwired');
  }
  const named = has(obs.answer, obs.commitSentinel);
  let pass;
  if (obs.arm === 'squash-negative') pass = det.length === 0;
  else if (obs.arm === 'contrast') pass = named; // a leak
  else pass = named && det.length === 0;
  return { invalid, deterministicFail: det, pass, named };
}

/** trials: { [arm]: scored[] } → verdict over ARMS (diagnostic arms are counted, not gated). */
export function runVerdict(trials) {
  const counts = {};
  let invalidTrials = 0;
  for (const arm of [...ARMS, ...DIAGNOSTIC_ARMS]) {
    const all = trials[arm] ?? [];
    const valid = all.filter((t) => t.invalid.length === 0);
    invalidTrials += all.length - valid.length;
    counts[arm] = {
      valid: valid.length,
      attempts: all.length,
      pass: valid.filter((t) => t.pass).length,
      deterministicFailures: valid.filter((t) => t.deterministicFail.length > 0).length,
    };
  }
  const reasons = [];
  const complete = ARMS.every((a) => counts[a].valid >= VALID_PER_ARM);
  if (!complete) reasons.push('fewer than 3 valid trials in some arm — no verdict');
  for (const a of ARMS) if (counts[a].deterministicFailures > 0) reasons.push(`${a}: ${counts[a].deterministicFailures} valid trial(s) failed a render predicate`);
  const need = Math.ceil((2 * VALID_PER_ARM) / 3);
  if (counts.treatment.pass < need) reasons.push(`treatment ${counts.treatment.pass}/${counts.treatment.valid} < ${need}`);
  if (counts.contrast.pass > Math.floor(VALID_PER_ARM / 3)) reasons.push(`contrast named it ${counts.contrast.pass}/${counts.contrast.valid} > 1`);
  if (!(counts.contrast.pass < counts.treatment.pass)) reasons.push(`contrast ${counts.contrast.pass} not strictly below treatment ${counts.treatment.pass}`);
  if (counts['squash-negative'].pass < counts['squash-negative'].valid) reasons.push('squash-negative: a render predicate failed');
  return { counts, invalidTrials, complete, demonstrated: complete && reasons.length === 0, reasons };
}

export function recordName(base, { complete, red }) {
  if (red) return `${base}.red-baseline.json`;
  return complete ? `${base}.json` : `${base}.partial.json`;
}
