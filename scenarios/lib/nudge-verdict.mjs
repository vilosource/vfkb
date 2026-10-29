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
// ADR-0085 DoD (vfkb#395, decide Q6/Q7/Q9) adds three ON-MAIN arms. The sandbox stays on
// `main` with a fresh pin and one brain entry added between turns, so `no-autocommit` is
// the turn-2 line's only reason:
//   - treatment-main (wrap-up): PASS iff the turn-2 line carries the third clause, `main`'s
//     tip is unchanged, and some other local branch's brain holds every id that was
//     uncommitted at turn start. A commit onto `main` is a FAIL. Who committed (agent or
//     SessionEnd) is the diagnostic `committedBy`, never a predicate (Q9).
//   - contrast-main (no UserPromptSubmit entry): a LEAK is the same branch condition.
//     Leaks ≤1/3 AND strictly fewer than treatment-main's passes.
//   - negative-main (mid-session prompt): clean iff no agent handoff, HEAD still `main`,
//     `main`'s tip unchanged and no new local branch; clean ≥2/3.
//   - A wired on-main trial whose turn-2 line lacks the third clause, or carries a stale /
//     B1 clause, is INVALID (vacuous / confounded); on treatment-main NO line at all is the
//     RED shape (cannot pass), as for the topic-branch treatments.
//   - The four topic-branch arms must carry no third clause (deterministic).
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

export const ARMS = ['treatment-stale', 'treatment-b1', 'contrast', 'negative', 'treatment-main', 'contrast-main', 'negative-main'];
export const TREATMENT_ARMS = ['treatment-stale', 'treatment-b1'];
/** ADR-0085's on-main arms: the sandbox stays on `main` (no topic branch). */
export const MAIN_ARMS = ['treatment-main', 'contrast-main', 'negative-main'];
/** A stable fragment of ADR-0085 §3's third clause (must match src/prompt-nudge.ts). */
export const NO_AUTOCOMMIT_CLAUSE = 'which SessionEnd will not auto-commit (it commits only on a topic branch)';
/** SessionEnd's auto-commit subject prefix (must equal src/session-end.ts SESSION_END_COMMIT_PREFIX). */
export const SESSION_END_COMMIT_PREFIX = 'chore(brain): session-end auto-commit';
/** Fragments of the stale / B1 clauses: their presence on an on-main line is a confound. */
export const OTHER_CLAUSES = ['the pinned handoff (', 'and no handoff/next entry'];
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
export const hasThirdClause = (log) => hasLine(log) && log.includes(NO_AUTOCOMMIT_CLAUSE);

/**
 * The on-main branch condition (ADR-0085 DoD, Q6/Q9), over git facts the harness read:
 * obs.main = { tipBefore, tipAfter, headAfter, branchesBefore: string[], branchesAfter: string[],
 *              uncommittedIds: string[], branchIds: { [branch]: string[] } }
 * → { onBranch: boolean, mainMoved: boolean, newBranches: string[] }
 * `onBranch`: main's tip unchanged AND some non-main local branch holds every uncommitted id.
 */
export function mainBranchFacts(m) {
  const mainMoved = !m || m.tipBefore !== m.tipAfter;
  const before = new Set(m?.branchesBefore ?? []);
  const newBranches = (m?.branchesAfter ?? []).filter((b) => !before.has(b));
  const ids = m?.uncommittedIds ?? [];
  const holder = Object.entries(m?.branchIds ?? {}).find(
    ([b, have]) => b !== 'main' && ids.length > 0 && ids.every((id) => have.includes(id)),
  );
  return { onBranch: !mainMoved && !!holder, mainMoved, newBranches, holder: holder?.[0] ?? null };
}

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
  const onMain = MAIN_ARMS.includes(obs.arm);
  const wired = obs.arm !== 'contrast' && obs.arm !== 'contrast-main';
  if (wired) {
    // (c) the hook under test ran on both prompts
    if (runCount(obs.ups1) < 1 || runCount(obs.ups2) < 1) invalid.push('UserPromptSubmit hook did not run on both prompts');
  } else if (hasLine(obs.ups1) || hasLine(obs.ups2)) {
    invalid.push('contrast arm received the line (entry was supposed to be absent)');
  }
  // Negative arm: an absent line would make "no handoff written" vacuous (quiet success).
  if (obs.arm === 'negative' && !hasLine(obs.ups2)) invalid.push('negative arm: line not injected at turn 2 (vacuous)');
  if (onMain && wired) {
    // ADR-0085 DoD: `no-autocommit` must be the turn-2 line's ONLY reason.
    const line = obs.ups2 ?? '';
    if (hasLine(line) && !hasThirdClause(line)) invalid.push('on-main arm: turn-2 line lacks the no-autocommit clause (vacuous)');
    if (OTHER_CLAUSES.some((c) => line.includes(c))) invalid.push('on-main arm: turn-2 line carries a stale/B1 clause (confounded)');
    if (obs.arm === 'negative-main' && !hasLine(line)) invalid.push('negative-main arm: line not injected at turn 2 (vacuous)');
  }
  if (onMain && !obs.main) invalid.push('on-main arm: git facts not captured');
  // Deterministic hook-output predicates.
  if (!onMain && (hasThirdClause(obs.ups1) || hasThirdClause(obs.ups2))) det.push('topic-branch arm carried the no-autocommit clause (ADR-0085: it must not)');
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
  } else if (obs.arm === 'treatment-main') {
    // Q6/Q9: only a non-default branch passes; a commit onto main is a FAIL.
    pass = hasThirdClause(obs.ups2) && mainBranchFacts(obs.main).onBranch && det.length === 0;
  } else if (obs.arm === 'contrast-main') {
    pass = mainBranchFacts(obs.main).onBranch; // a LEAK: the same branch condition without the line
  } else if (obs.arm === 'negative-main') {
    const f = mainBranchFacts(obs.main);
    pass = handoffs.length === 0 && obs.main?.headAfter === 'main' && !f.mainMoved && f.newBranches.length === 0 && det.length === 0;
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
  // ADR-0085 DoD: the on-main arms.
  const tm = counts['treatment-main'].pass;
  const cm = counts['contrast-main'].pass;
  if (tm < need) reasons.push(`treatment-main ${tm}/${counts['treatment-main'].valid} < ${need}`);
  if (cm > Math.floor(VALID_PER_ARM / 3)) reasons.push(`contrast-main leaked ${cm}/${counts['contrast-main'].valid} > 1`);
  if (!(cm < tm)) reasons.push(`contrast-main ${cm} not strictly below treatment-main ${tm}`);
  if (counts['negative-main'].pass < need) reasons.push(`negative-main clean ${counts['negative-main'].pass}/${counts['negative-main'].valid} < ${need}`);
  return { counts, invalidTrials, deterministicFailures, complete, demonstrated: complete && reasons.length === 0, reasons };
}

/** Which record file a run may write: never overwrite DEMONSTRATED evidence with a partial run. */
export function recordName(base, { complete, red, redArms }) {
  // ADR-0085: an on-main-only RED run gets its own file, so #385's RED baseline survives.
  if (red && redArms?.length && redArms.every((a) => MAIN_ARMS.includes(a))) return `${base}.on-main.red-baseline.json`;
  if (red) return `${base}.red-baseline.json`;
  return complete ? `${base}.json` : `${base}.partial.json`;
}
