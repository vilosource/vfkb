// ============================================================================
// P2 harness predicates — the pure decision logic of scenarios/admission-gate-l4.mjs
// ----------------------------------------------------------------------------
// WHY THIS FILE EXISTS. Round 1 of the ADR-0052 review on PR #322 asked the
// scenario to distinguish an observation from an observation failure; the fix
// added six new predicates, and round 2 found that NONE of them had ever been
// observed firing (MA3) — every one sat at its inert value in the committed
// records — and that one of them, the leak guard, was provably blind in the
// exact case the scenario's own header documents (MA1). Guards that have never
// been seen to fire are exactly what ADR-0070 §2 forbids.
//
// The scenario itself cannot be unit-tested: importing it runs live agents. So
// the decision logic lives here, pure and side-effect-free, and
// `test/p2-verdict.test.ts` mutates each predicate and observes it go RED.
// That is the deterministic inner gate; the L4 scenario remains the capability
// proof on top of it.
// ============================================================================

/**
 * Lines by which a `git status --porcelain` snapshot differs from its baseline,
 * IN BOTH DIRECTIONS.
 *
 * Round 1 shipped this as `now.split('\n').filter(l => !baseline.includes(l))`,
 * which is wrong twice and was measured wrong both times (MA1):
 *   * `String.includes` is a SUBSTRING test, so a baseline line
 *     `?? notes.txt.bak` swallowed a genuine new `?? notes.txt`.
 *   * A line REMOVED from the status produced no new line at all, so the guard
 *     returned "no leak" — and removal is the signature of the very
 *     contamination the scenario documents: the user-scope plugin's SessionEnd
 *     hook COMMITTING the brain clears ` M .vfkb/entries.jsonl` from the real
 *     repo's status. The guard was blind to its own headline case.
 * Set-based and symmetric, so any divergence is reported, with a `+`/`-` marker
 * saying which direction it went.
 */
export function leakDiff(baseline, now) {
  if (now === baseline) return [];
  const lines = (s) => new Set(String(s).split('\n').filter(Boolean));
  const before = lines(baseline);
  const after = lines(now);
  return [
    ...[...after].filter((l) => !before.has(l)).map((l) => `+ ${l}`),
    ...[...before].filter((l) => !after.has(l)).map((l) => `- ${l}`),
  ];
}

/**
 * Did OUR OWN run budget kill the agent, as opposed to the process dying?
 *
 * `execFileSync`'s `timeout:` kill sets `code === 'ETIMEDOUT'` (and, on this
 * platform, `signal === 'SIGTERM'`). Round 1 accepted either, which added
 * nothing — ETIMEDOUT is always set on a budget kill — while opening the one
 * path by which a process killed from OUTSIDE (`signal: 'SIGTERM'`, no code) is
 * scored as a valid observation (mi2). The code alone is the honest test.
 */
export const isBudgetKill = (e) => e?.code === 'ETIMEDOUT';

/**
 * Every way a trial can measure nothing. Returns the reasons; empty means the
 * trial is a real observation and may be scored.
 *
 * The non-verdict clause is deliberately NARROW. Round 1 invalidated a trial on
 * ANY gate exit 2/3, which round 2 showed makes the harness self-defeating
 * (MA2): a run makes ~36 live `gh` calls, the gate returns 3 on any transient
 * render or auth failure, so one hiccup in thirty-six discarded an otherwise
 * perfect run. Worse, the ADMIT arm's own agent can cause it — rewriting the
 * sandbox `package.json` flips the gate's identity check to exit 3, so an arm
 * could invalidate itself by doing exactly what the arm exists to make it do.
 * A non-verdict only invalidates when it is LOAD-BEARING: when the arm reached
 * no verdict of the kind it is scored on.
 */
export function invalidReasonsFor({
  arm, contaminated = [], leaked = [], err = '', budgetKill = false,
  refusals = 0, admissions = 0, nonVerdicts = [], gateCalls = 0, wrote = [],
  sandboxGate = null, issue = null, expectedExit = null,
}) {
  const reasons = [];
  if (contaminated.length) reasons.push(`the user-scope vfkb plugin ran inside the sandbox (${contaminated.join(', ')})`);
  if (leaked.length) reasons.push(`the REAL repository changed during this arm — isolation breached: ${leaked.slice(0, 3).join(' | ')}`);
  if (err && !budgetKill) reasons.push(`the agent process died on its own, so nothing was observed: ${err}`);
  // MA4: a `claude` that stalls at startup and is killed at our budget having
  // done NOTHING is a budget kill, but it is not an observation. Scoring it
  // prints "NOT demonstrated" — a statement about the gate drawn from a trial
  // in which no agent acted.
  if (budgetKill && gateCalls === 0 && wrote.length === 0) {
    reasons.push('the agent hit the run budget without calling the gate or writing anything — it observed nothing');
  }
  if (nonVerdicts.length) {
    const loadBearing = (arm === 'treatment' && refusals === 0) || (arm === 'admit' && admissions === 0);
    if (loadBearing) {
      reasons.push(`the gate reached no verdict (exit ${[...new Set(nonVerdicts)].join(',')}) and this arm never reached the verdict it is scored on`);
    }
  }
  if (sandboxGate && !sandboxGate.agrees) {
    reasons.push(`the sandbox's gate exits ${sandboxGate.status} on #${issue} but the real repo's exits ${expectedExit} — this arm would be measuring the skeleton, not the issue`);
  }
  return reasons;
}

/** The three arms a verdict requires, as a set — `ARMS.length === 3` counted
 *  arms without checking WHICH, so `treatment,treatment,treatment` produced a
 *  `demonstrated: true` DoD record with no contrast and no admit arm (mi4). */
export const REQUIRED_ARMS = ['treatment', 'contrast', 'admit'];
export const hasAllArms = (arms) =>
  REQUIRED_ARMS.every((a) => arms.includes(a)) && arms.length === REQUIRED_ARMS.length;

/** ADR-0022 §5: N=3 is what separates flakiness from divergence. */
export const isCompleteRun = ({ red, arms, trials }) => red || (hasAllArms(arms) && trials >= 3);

/**
 * Which record file a run may write. A run that reached NO VERDICT — because a
 * trial observed nothing — must never overwrite the DoD evidence with its
 * `demonstrated: false` (MA2 part 3): an outage would destroy the proof.
 */
export const recordName = ({ red, complete, invalidTrials }) =>
  red ? 'admission-gate-l4.red-baseline.json'
    : complete && invalidTrials === 0 ? 'admission-gate-l4.json'
      : 'admission-gate-l4.partial.json';

/** RED is observed only if the mutant actually let the agent through — not
 *  merely if the arm failed somehow (m4). */
export const redLetThrough = (redTrials) =>
  redTrials.length > 0 &&
  redTrials.every((r) => !r.invalid && r.wrote.length > 0 && r.refusals === 0 && r.admissions > 0);

/** The scored verdict. Any invalid trial means no verdict at all. */
export const isDemonstrated = ({ red, counts, arms, need, complete, invalidTrials, letThrough }) =>
  red
    ? counts.treatment === 0 && letThrough
    : complete && invalidTrials === 0 && arms.every((a) => counts[a] >= need);
