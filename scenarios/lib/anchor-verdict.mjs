// Pure verdict predicates for scenarios/stale-handoff-anchor.mjs (vfkb#386; ADR-0084 DoD
// item 2; RFC-043 Parts 0 and 1). Kept pure so every predicate is observed firing in a
// deterministic unit test (test/anchor-verdict.test.ts) — ADR-0070 §2.
//
// Shape (decide step D7, ruling 54802539cda7): three real `claude -p` turns on one session
// id, so turn 3 is the first Stop B3 may speak on (ADR-0084 §1.1, 1a). Every predicate here
// is a HOOK-OUTPUT predicate, which is deterministic: 3/3 valid trials per arm, and any
// failure in a valid trial blocks DEMONSTRATED (the #385 Q4 rule). INVALID trials
// (isolation, leak, no result event) are re-run, up to 6 attempts per arm.
//
// Every predicate is a CONTENT assertion over the Stop hook's tee'd stdout, never an exit
// status (ADR-0051 §3). "The hook ran" means the run marker FOLLOWED BY a JSON-parseable
// stdout line: a crashed hook leaves the marker and nothing, which must not score as a
// quiet pass (review finding F3's crash path).

export const RUN_MARKER = '--- hook-run';
export const ARMS = ['squash', 'can-fail'];
export const VALID_PER_ARM = 3;
export const MAX_ATTEMPTS_PER_ARM = 6;
export const TURNS = 3;

/** B3's lead-in (src/stop-reminder.ts STALE_HANDOFF_LEADIN, pinned by the unit test). */
export const B3_LEADIN = 'vfkb stale-handoff check';
/** RFC-043 Part 1's second half / RFC-047 §4.4 — only the NEW text carries it. */
export const B3_NEXT_SESSION =
  "The next session's resume lists these same commits under `## Last handoff`, so a handoff written now is optional unless you are wrapping up.";
export const B3_CLOSING = 'If you are still mid-session, ignore this and finish normally.';
export const COMMITS_LEAD = 'Commits since this handoff was recorded (';

/**
 * Split a tee log into hook invocations. Each starts at a RUN_MARKER line; its output is
 * the text up to the next marker. → [{ raw, json|null }]
 */
export function invocations(log) {
  if (typeof log !== 'string' || !log) return [];
  const parts = log.split(`${RUN_MARKER}\n`).slice(1);
  return parts.map((raw) => {
    const line = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
    let json = null;
    try {
      json = JSON.parse(line);
    } catch {
      json = null;
    }
    return { raw, json };
  });
}

/** The additionalContext a Stop invocation emitted, or '' for `{}`. */
export const contextOf = (inv) => String(inv?.json?.hookSpecificOutput?.additionalContext ?? '');

/**
 * Score one trial.
 * obs = {
 *   arm, isolationReasons: string[], leak: string[], engaged: boolean,
 *   turnLogs: string[]   // the Stop tee log's segment for each turn (length TURNS)
 *   sentinelSubject: string|null, sentinelSha7: string|null   // can-fail arm only
 * }
 * → { invalid: string[], deterministicFail: string[], pass: boolean }
 */
export function scoreTrial(obs) {
  const invalid = [...(obs.isolationReasons ?? [])];
  if (obs.leak?.length) invalid.push(`leak into the real repo: ${obs.leak.join(', ')}`);
  if (!obs.engaged) invalid.push('agent did not reach a final message on every turn');
  const det = [];
  const turns = obs.turnLogs ?? [];
  if (turns.length !== TURNS) det.push(`expected ${TURNS} turn segments, got ${turns.length}`);
  turns.forEach((seg, i) => {
    const inv = invocations(seg);
    if (inv.length < 1) det.push(`turn ${i + 1}: Stop hook did not run`);
    else if (inv.some((x) => x.json === null)) det.push(`turn ${i + 1}: a Stop invocation printed no parseable JSON (crash?)`);
    // 1a boundary: quiet at turns 1 and 2 in BOTH arms.
    if (i < TURNS - 1 && seg.includes(B3_LEADIN)) det.push(`turn ${i + 1}: B3 fired before turn ${TURNS} (1a)`);
  });
  const t3 = invocations(turns[TURNS - 1] ?? '');
  if (obs.arm === 'squash') {
    // Part 0: the squash carries the pin, so nothing is stale — the first turn-3 Stop is `{}`.
    const first = t3[0];
    if (first && first.json !== null && first.json.hookSpecificOutput !== undefined)
      det.push('squash: the turn-3 Stop emitted output (expected {})');
    if (turns.some((s) => String(s).includes(B3_LEADIN))) det.push('squash: B3 text appears in the Stop log');
  } else {
    // Part 0 + Part 1: B3 fires at turn 3 with the NEW text, naming the sentinel commit.
    const ctx = t3.map(contextOf).find((c) => c.includes(B3_LEADIN)) ?? '';
    if (!ctx) det.push('can-fail: no turn-3 Stop invocation carried B3');
    else {
      if (!ctx.includes(B3_NEXT_SESSION)) det.push('can-fail: B3 lacks the RFC-047 §4.4 sentence (old text)');
      if (!ctx.includes(B3_CLOSING)) det.push('can-fail: B3 lacks the closing sentence');
      if (!ctx.includes(`${COMMITS_LEAD}1):`)) det.push('can-fail: B3 lacks "Commits since this handoff was recorded (1):"');
      if (!obs.sentinelSubject || !ctx.includes(`${obs.sentinelSha7} ${obs.sentinelSubject}`))
        det.push('can-fail: B3 does not list the sentinel commit as "<sha7> <subject>"');
    }
  }
  return { invalid, deterministicFail: det, pass: det.length === 0 };
}

/** Aggregate per-arm scored trials. trials: { [arm]: scored[] } */
export function runVerdict(trials) {
  const counts = {};
  let invalidTrials = 0;
  for (const arm of ARMS) {
    const all = trials[arm] ?? [];
    const valid = all.filter((t) => t.invalid.length === 0);
    invalidTrials += all.length - valid.length;
    counts[arm] = { valid: valid.length, attempts: all.length, pass: valid.filter((t) => t.pass).length };
  }
  const reasons = [];
  const complete = ARMS.every((a) => counts[a].valid >= VALID_PER_ARM);
  if (!complete) reasons.push('fewer than 3 valid trials in some arm — no verdict');
  for (const a of ARMS) if (counts[a].pass < counts[a].valid) reasons.push(`${a}: ${counts[a].valid - counts[a].pass} valid trial(s) failed a deterministic predicate`);
  return { counts, invalidTrials, complete, demonstrated: complete && reasons.length === 0, reasons };
}

export function recordName(base, { complete, red }) {
  if (red) return `${base}.red-baseline.json`;
  return complete ? `${base}.json` : `${base}.partial.json`;
}
