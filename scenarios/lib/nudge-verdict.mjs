// Pure verdict predicates for scenarios/handoff-next-prompt.mjs (vfkb#385, ADR-0084 DoD 1).
//
// Kept pure and separate from the live harness so every predicate can be observed firing
// in a deterministic unit test (test/nudge-verdict.test.ts) — ADR-0070 §2: a guard never
// seen firing does not count. Thresholds are the #385 decide step's Q4 (brain decision
// recorded on the topic branch, ruling 54802539cda7):
//
//   - The threshold follows what the predicate observes. AGENT-BEHAVIOUR predicates are
//     scored ≥2/3 (ADR-0022). HOOK-OUTPUT predicates (the turn-1 line is absent; the Stop
//     tee log ran and carries no B1/B3 text) are deterministic, so any failure in any
//     valid trial blocks DEMONSTRATED.
//   - Treatment arms: each ≥2/3 independently.
//   - Contrast: leaks ≤1/3 AND strictly fewer than EVERY treatment arm's passes.
//   - Negative: clean in ≥2/3.
//   - Any INVALID trial → no verdict (the harness re-runs to 3 valid per arm, capped at 6).
//
// Every predicate is a CONTENT assertion over a file or a hook's captured stdout, never an
// exit status (ADR-0051 §3).

/** The UserPromptSubmit line's lead-in. Must equal src/prompt-nudge.ts PROMPT_NUDGE_LEADIN
 *  (pinned by test/nudge-verdict.test.ts) and must not contain any Stop lead-in (Q11). */
export const PROMPT_LINE_LEADIN = 'vfkb handoff status:';
/** The Stop lead-ins that must NOT appear on Stop in this scenario (ADR-0084 DoD 1). */
export const STOP_HANDOFF_LEADINS = ['vfkb handoff check', 'vfkb stale-handoff check'];
/** Marker the scenario's hook wrapper writes before every hook invocation. */
export const RUN_MARKER = '--- hook-run';

export const ARMS = ['treatment-stale', 'treatment-b1', 'contrast', 'negative'];
export const TREATMENT_ARMS = ['treatment-stale', 'treatment-b1'];
export const VALID_PER_ARM = 3;
export const MAX_ATTEMPTS_PER_ARM = 6;

const tagsOf = (e) => (Array.isArray(e?.tags) ? e.tags : []);
/** A handoff/next entry the AGENT wrote: tagged handoff or next, and not B2's `auto` floor. */
export function isAgentHandoff(e) {
  const tags = tagsOf(e);
  return (tags.includes('handoff') || tags.includes('next')) && !tags.includes('auto');
}
export const mentions = (e, sentinel) =>
  String(e?.text ?? '').toLowerCase().includes(String(sentinel).toLowerCase());

/** Hook invocations recorded in a tee log (one RUN_MARKER line per invocation). */
export const runCount = (log) => (typeof log === 'string' ? log.split('\n').filter((l) => l.startsWith(RUN_MARKER)).length : 0);
export const hasLine = (log) => typeof log === 'string' && log.includes(PROMPT_LINE_LEADIN);

/**
 * Score one trial.
 * obs = {
 *   arm, isolationReasons: string[], leak: string[], engaged: boolean,
 *   ups1: string|null, ups2: string|null   // UserPromptSubmit tee log per turn (null = not wired)
 *   stopLog: string                        // Stop tee log over both turns
 *   turn2Entries: object[]                 // entries appended to the brain during turn 2
 *   sentinel: string
 * }
 * → { invalid: string[], deterministicFail: string[], pass: boolean }
 *   `pass` means the arm's success condition: a sentinel handoff (treatment), a handoff
 *   leak (contrast — counted as a leak), or NO handoff (negative — clean).
 */
export function scoreTrial(obs) {
  const invalid = [...(obs.isolationReasons ?? [])];
  const det = [];
  if (obs.leak?.length) invalid.push(`leak into the real repo: ${obs.leak.join(', ')}`);
  if (!obs.engaged) invalid.push('agent did not reach a final message on both turns');
  const wired = obs.arm !== 'contrast';
  if (wired) {
    // (c) the hook under test ran on both prompts
    if (runCount(obs.ups1) < 1 || runCount(obs.ups2) < 1) invalid.push('UserPromptSubmit hook did not run on both prompts');
  } else if (hasLine(obs.ups1) || hasLine(obs.ups2)) {
    invalid.push('contrast arm received the line (entry was supposed to be absent)');
  }
  // Negative arm: an absent line would make "no handoff written" vacuous (quiet success).
  if (obs.arm === 'negative' && !hasLine(obs.ups2)) invalid.push('negative arm: line not injected at turn 2 (vacuous)');
  // Deterministic hook-output predicates.
  if (hasLine(obs.ups1)) det.push('turn-1 prompt carried the line (Q2: never on a persisted session\'s first prompt)');
  if (runCount(obs.stopLog) < 1) det.push('Stop hook tee log shows no invocation');
  for (const l of STOP_HANDOFF_LEADINS) if ((obs.stopLog ?? '').includes(l)) det.push(`Stop emitted "${l}"`);

  const handoffs = (obs.turn2Entries ?? []).filter(isAgentHandoff);
  let pass;
  if (obs.arm === 'treatment-stale' || obs.arm === 'treatment-b1') {
    // A treatment trial without the line cannot pass: the capability was not delivered.
    pass = hasLine(obs.ups2) && handoffs.some((e) => mentions(e, obs.sentinel)) && det.length === 0;
  } else if (obs.arm === 'contrast') {
    pass = handoffs.length > 0; // a LEAK: spontaneous agent handoff without the line
  } else {
    pass = handoffs.length === 0 && det.length === 0; // clean
  }
  return { invalid, deterministicFail: det, pass };
}

/** Aggregate per-arm scored trials → the run verdict. trials: { [arm]: scored[] } */
export function runVerdict(trials) {
  const counts = {};
  let invalidTrials = 0;
  let deterministicFailures = 0;
  for (const arm of ARMS) {
    const all = trials[arm] ?? [];
    const valid = all.filter((t) => t.invalid.length === 0);
    invalidTrials += all.length - valid.length;
    deterministicFailures += valid.filter((t) => t.deterministicFail.length > 0).length;
    counts[arm] = { valid: valid.length, attempts: all.length, pass: valid.filter((t) => t.pass).length };
  }
  const reasons = [];
  const complete = ARMS.every((a) => counts[a].valid >= VALID_PER_ARM);
  if (!complete) reasons.push('fewer than 3 valid trials in some arm — no verdict');
  if (deterministicFailures > 0) reasons.push(`${deterministicFailures} valid trial(s) failed a deterministic hook-output predicate`);
  const need = Math.ceil((2 * VALID_PER_ARM) / 3);
  for (const a of TREATMENT_ARMS) if (counts[a].pass < need) reasons.push(`${a} ${counts[a].pass}/${counts[a].valid} < ${need}`);
  const leaks = counts.contrast.pass;
  if (leaks > Math.floor(VALID_PER_ARM / 3)) reasons.push(`contrast leaked ${leaks}/${counts.contrast.valid} > 1`);
  for (const a of TREATMENT_ARMS) if (!(leaks < counts[a].pass)) reasons.push(`contrast ${leaks} not strictly below ${a} ${counts[a].pass}`);
  if (counts.negative.pass < need) reasons.push(`negative clean ${counts.negative.pass}/${counts.negative.valid} < ${need}`);
  return { counts, invalidTrials, deterministicFailures, complete, demonstrated: complete && reasons.length === 0, reasons };
}

/** Which record file a run may write: never overwrite DEMONSTRATED evidence with a partial run. */
export function recordName(base, { complete, red }) {
  if (red) return `${base}.red-baseline.json`;
  return complete ? `${base}.json` : `${base}.partial.json`;
}
