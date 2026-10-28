// Stop-hook decision-capture reminder (RFC-008 / ADR-0027). A conditional end-of-turn
// nudge: when a turn plausibly made a decision but recorded none, inject a reminder so
// the agent captures it before handing back to the user. Each nudge type is rate-limited
// to once per NUDGE_COOLDOWN_TURNS turns per session (operator ruling 2026-07-31) — a
// standing trigger no longer nags on every Stop.
//
// Contract is EMPIRICALLY VERIFIED at Claude Code CLI v2.1.195 (brain gotcha
// d70c0299e144): a Stop hook may emit
//   {"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","additionalContext":"…"}}
// to continue the turn with that text as context; the harness passes `stop_hook_active`
// (true on our own re-entry) as the NATIVE loop guard — no marker file needed.
//
// `decideStop` is the PURE core (deterministically unit-tested, the backstop). The git /
// brain gathering is the impure shell, used by `cli.ts hook stop`.
//
// ADR-0084 §1 (amends ADR-0027) adds deterministic WHEN-rules: a paused stop (non-empty
// `background_tasks` / `session_crons`) defers every nudge (1b), B3 is quiet before turn
// STALE_HANDOFF_MIN_TURN (1a), and B3's text no longer demands a write (1d).
//
// ADR-0084 §1.6 (vfkb#385): B1 no longer fires on Stop. Its standing reminder is one
// non-blocking UserPromptSubmit line (src/prompt-nudge.ts, ADR-0084 §2), so Stop now does
// three things: the loop guard, the decision nudge, and B3. When that line was delivered
// with the stale-pin reason, the CLI folds the delivery turn into B3's cooldown (§2.5).

import { execFileSync } from 'node:child_process';
import { GIT_READ_MAX_BUFFER } from './git-buffer.js';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { brainDir, materialize, type StoredRecord } from './storage.js';
import { latestHandoff, renderCommitsSince, supersededIds, type StaleCommit } from './engine.js';
import { cachedPinStaleness, type PinStalenessOpts } from './pin-staleness.js';
import type { KnowledgeEntry } from './types.js';

export interface StopHookInput {
  stop_hook_active?: boolean;
  /** Claude Code: background work still live — the session is paused, not done (ADR-0084 §1.2). */
  background_tasks?: unknown;
  /** Claude Code: session crons still scheduled — likewise a paused stop (ADR-0084 §1.2). */
  session_crons?: unknown;
}

/**
 * ADR-0084 §1.2 (1b): a Stop whose payload reports a non-empty `background_tasks` or
 * `session_crons` array is a PAUSED stop, not an end of turn. Absent, null, non-array or
 * empty → not paused (today's behaviour). The one predicate both layers use: the CLI
 * short-circuits on it before any turn bookkeeping or git work, and `decideStop` re-checks
 * it as the pure backstop.
 */
export function isPausedStop(input: StopHookInput | undefined | null): boolean {
  if (!input || typeof input !== 'object') return false;
  const live = (v: unknown): boolean => Array.isArray(v) && v.length > 0;
  return live(input.background_tasks) || live(input.session_crons);
}

/** The Stop-hook nudge types, each with its own independent cooldown window. `handoff` (B1)
 *  retired from Stop in ADR-0084 §1.6; an old record's `nudgedAtTurn.handoff` is harmless. */
export type NudgeKey = 'decision' | 'staleHandoff';

export interface StopContext {
  /** working tree has uncommitted src/ or docs/ changes (substantive work happened) */
  uncommittedWork: boolean;
  /** count of `decision` entries appended to the brain but not yet committed */
  newDecisions: number;
  /** total entries appended to the brain since HEAD this session (git-delta) */
  newEntries?: number;
  /** count of `handoff`/`next`-tagged entries appended to the brain since HEAD */
  newHandoffs?: number;
  /** RFC-043 Part 0's set S for the pinned handoff (newest first); non-empty = stale (B3) */
  staleCommits?: StaleCommit[];
  /** the pinned handoff B3 names (its id and created) */
  pin?: { id: string; created: string };
  /** this session's turn count AFTER the current turn was bumped (from SessionState) */
  turn?: number;
  /** turn at which each nudge last fired this session (from SessionState) */
  lastNudged?: Partial<Record<NudgeKey, number>>;
}

export type StopDecision = { block: false } | { block: true; reminder: string; fired: NudgeKey[] };

// Per-nudge cooldown (operator ruling 2026-07-31, replacing per-turn repetition): while a
// trigger holds, its nudge repeats at most once every N turns instead of on every Stop.
// The live incident: B3 armed the moment a PR merged mid-session and then fired on EVERY
// stop for the rest of the session, forcing the agent to spend a turn declining each time.
// Cooldown state lives on the SessionState record (keyed by harness session_id); when no
// session state is available the cooldown cannot be computed and the nudge falls back to
// the pre-cooldown behavior (fire) — fail-open toward reminding, never toward silence.
export const NUDGE_COOLDOWN_TURNS = 10;

// ADR-0084 §1.1 (1a): B3 stays quiet while the (valid) session turn is below this. The
// review's single-turn headless sessions (review gate, workflow steps) were a fifth of all
// B3 fires and could never act on one. An invalid or absent turn → today (fire): the CLI
// passes no turn for an ephemeral session, so B3 fails open there rather than going silent.
export const STALE_HANDOFF_MIN_TURN = 3;

export const STOP_REMINDER =
  'vfkb decision-capture check: this turn changed code/docs but no `decision` was recorded ' +
  'to the brain. If a load-bearing decision was made, capture it now via ' +
  '`mcp__vfkb__kb_add` (type=decision, why=<rationale>, role=human) — or ' +
  '`vfkb add decision "…" --why "…" --role human` — and add an ADR under docs/adr/ for ' +
  'anything architectural. If NO decision was made this turn, just finish normally.';

// The strong-signal threshold: only nudge for a handoff once the session has
// accumulated enough knowledge that a "what's next" pointer is worth writing. Below
// this, the SessionEnd B2 floor (ADR-0033) still guarantees a committed handoff.
export const HANDOFF_MIN_ENTRIES = 3;

// B1's text (GAP-1, RFC-011 §B / ADR-0034) left Stop in ADR-0084 §1.6: the condition above
// is now one clause of the UserPromptSubmit line (src/prompt-nudge.ts renderPromptNudge).

/**
 * B1's trigger (RFC-011 §B; trigger and threshold unchanged by ADR-0084 §1.6): substantive
 * uncommitted work, at least HANDOFF_MIN_ENTRIES entries appended since HEAD, and none of
 * them a handoff/next entry (self-silence). Pure, so its negative cases stay deterministic
 * guards (test/stop-reminder.test.ts); `gatherPromptContext` is its one caller.
 */
export function handoffNudgeDue(ctx: { uncommittedWork: boolean; newEntries: number; newHandoffs: number }): boolean {
  return ctx.uncommittedWork && ctx.newEntries >= HANDOFF_MIN_ENTRIES && ctx.newHandoffs === 0;
}

// B3 (first decided by ADR-0084, which accepts RFC-043 Parts 0/1/A and RFC-047; capability
// DEMONSTRATED by scenarios/records/stale-handoff-anchor.json, vfkb#386 — delivery through the
// plugin unproven until its install-path re-pin, ADR-0051): unlike
// B1/B2, this is not about whether THIS session recorded a handoff — it fires when commits
// already landed after the currently pinned handoff, so the pin itself is behind regardless
// of what this session did. Deliberately NOT gated on `uncommittedWork`: the defining case is
// everything already merged and the working tree clean. Since #386 "landed after" is RFC-043
// Part 0's set S (src/pin-staleness.ts), so a squash merge no longer flags the very commit
// that carries the pin.
//
// Nag history: per-turn firing (operator report 2026-07-31) → the NUDGE_COOLDOWN_TURNS rate
// limit; ADR-0084 §1.3 (1d) dropped the closing write demand; RFC-043 Part 1's second half
// (#386) now says what moved — the same bounded list Part A renders under `## Last handoff`
// — and that the next session sees it, so a handoff written now is optional unless wrapping
// up. The lead-in stays byte-identical so the fire count (`nudge-fires.py`) stays comparable.
export const STALE_HANDOFF_LEADIN = 'vfkb stale-handoff check: ';

/** RFC-047 §4.4's sentence, verbatim. */
export const STALE_HANDOFF_NEXT_SESSION =
  "The next session's resume lists these same commits under `## Last handoff`, so a handoff " +
  'written now is optional unless you are wrapping up.';

/**
 * The B3 Stop text (decide D4). The commit block is byte-identical to Part A's, from the
 * one engine renderer, so "these same commits" is literally true. Never rendered without a
 * list: an empty S means B3 does not fire.
 */
export function renderStaleHandoffReminder(pin: { id: string; created: string } | undefined, commits: StaleCommit[]): string {
  const date = pin && /^\d{4}-\d{2}-\d{2}/.test(pin.created) ? `, ${pin.created.slice(0, 10)}` : '';
  const which = pin ? ` (${pin.id}${date})` : '';
  return (
    `${STALE_HANDOFF_LEADIN}the pinned handoff/next entry${which} predates commits that landed after it was written.\n` +
    renderCommitsSince(commits) +
    `${STALE_HANDOFF_NEXT_SESSION} If you are WRAPPING UP, record a fresh handoff now — kb_add ` +
    '(type=fact, tags=handoff,next, role=human), or /vfkb:handoff if available — naming what ' +
    'actually changed and what is next now. If you are still mid-session, ignore this and finish normally.'
  );
}

/**
 * The pure decision. Block (inject the reminder, continuing the turn) only when a
 * decision *plausibly* went unrecorded; otherwise allow the stop.
 *  1. Native loop guard: never block our own re-entry (`stop_hook_active`), or it nags forever.
 *  2. Paused stop (ADR-0084 §1.2, 1b): live `background_tasks` / `session_crons` → allow the
 *     stop before any trigger or cooldown work; every nudge defers to the next unpaused Stop.
 *  3. Conditional trigger: substantive work happened AND no decision was recorded this session.
 *     (B1 is not composed on Stop — ADR-0084 §1.6.)
 *  4. B3 not before turn STALE_HANDOFF_MIN_TURN (ADR-0084 §1.1, 1a); invalid turn → fire.
 *  (Not a true Brake — working-tree-changed ≠ decision-made; the committed ADR stays the
 *  deterministic backstop for *significant* decisions. This just fires the nudge at the right
 *  moment, only when plausibly needed.)
 */
export function decideStop(input: StopHookInput, ctx: StopContext): StopDecision {
  if (input?.stop_hook_active) return { block: false };
  if (isPausedStop(input)) return { block: false }; // 1b: not an end of turn
  // Cooldown (operator ruling 2026-07-31): a nudge whose trigger holds still stays quiet
  // for NUDGE_COOLDOWN_TURNS turns after it last fired. Without session turn info the
  // window cannot be computed → fall back to firing (the pre-cooldown behavior).
  // Only a real turn number in [0, turn] can cool (codex review, PR #272): the session
  // record is parsed JSON with no runtime validation upstream, and coercive subtraction
  // would let a malformed-but-parseable value — null, "1000", or an absurdly large
  // number — read as "cooling" and fail CLOSED (silence) instead of open (fire).
  const turnValid = typeof ctx.turn === 'number' && Number.isFinite(ctx.turn);
  const cooling = (key: NudgeKey): boolean => {
    if (!turnValid) return false;
    const last = ctx.lastNudged?.[key];
    if (typeof last !== 'number' || !Number.isFinite(last) || last < 0 || last > ctx.turn!) return false;
    return ctx.turn! - last < NUDGE_COOLDOWN_TURNS;
  };
  const reminders: string[] = [];
  const fired: NudgeKey[] = [];
  const nudge = (key: NudgeKey, text: string): void => {
    if (cooling(key)) return;
    reminders.push(text);
    fired.push(key);
  };
  // Decision-capture nudge (ADR-0027): work happened AND no decision recorded this session.
  if (ctx.uncommittedWork && ctx.newDecisions === 0) nudge('decision', STOP_REMINDER);
  // B1 (handoff, RFC-011) is NOT composed here any more (ADR-0084 §1.6): it rides the next
  // prompt as a non-blocking line. `newEntries`/`newHandoffs` stay in the context for it.
  // Stale-handoff nudge (B3): NOT gated on uncommittedWork — the defining case is a clean
  // working tree with everything already merged, and the pinned handoff behind it anyway.
  // 1a (ADR-0084 §1.1): quiet while a VALID turn is below STALE_HANDOFF_MIN_TURN.
  const stale = ctx.staleCommits ?? [];
  if (stale.length > 0 && !(turnValid && ctx.turn! < STALE_HANDOFF_MIN_TURN))
    nudge('staleHandoff', renderStaleHandoffReminder(ctx.pin, stale));
  if (reminders.length === 0) return { block: false };
  return { block: true, reminder: reminders.join('\n\n'), fired };
}

/** Working tree has uncommitted src/ or docs/ changes (brain-only changes don't count as "work"). */
/** Optional bound on every git child (the UserPromptSubmit budget, decide step Q12). A
 *  timed-out child throws, and each caller already fails open on a throw. */
export interface GitOpts {
  timeout?: number;
}

export function hasUncommittedWork(
  cwd: string = process.cwd(),
  brain: string = brainDir(),
  opts: GitOpts = {},
): boolean {
  let out: string;
  try {
    out = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: opts.timeout,
    });
  } catch {
    return false; // not a repo / git missing → fail-open (don't nag)
  }
  const brainRel = relative(cwd, brain).replace(/\\/g, '/');
  return out.split('\n').some((line) => {
    const p = line.slice(3).trim(); // strip the 2-char status + space
    if (!p) return false;
    if (brainRel && (p === brainRel || p.startsWith(brainRel + '/'))) return false;
    return p.startsWith('src/') || p.startsWith('docs/');
  });
}

interface BrainLine {
  type?: string;
  tags?: string[];
  updated?: string;
  created?: string;
}

/**
 * Entries appended to the brain since HEAD, parsed. The brain is append-only
 * (ADR-0019), so fresh entries are exactly the lines beyond the committed line count —
 * no per-session state (KB_SESSION_ID) needed, and it aligns with the "record then commit"
 * workflow: uncommitted entries are exactly this session's captures.
 */
export function newBrainEntriesSinceHead(
  brain: string = brainDir(),
  cwd: string = process.cwd(),
  opts: GitOpts = {},
): BrainLine[] {
  const file = join(brain, 'entries.jsonl');
  let current: string[];
  try {
    current = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return []; // no brain file yet
  }
  const rel = relative(cwd, file).replace(/\\/g, '/');
  let headCount = 0;
  try {
    const head = execFileSync('git', ['show', `HEAD:${rel}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: GIT_READ_MAX_BUFFER, // vfkb#384: a >1 MiB brain threw ENOBUFS here
      timeout: opts.timeout,
    });
    headCount = head.split('\n').filter(Boolean).length;
  } catch {
    headCount = 0; // file not in HEAD / no repo → treat all current as fresh
  }
  return current
    .slice(headCount)
    .map((l) => {
      try {
        return JSON.parse(l) as BrainLine;
      } catch {
        return null;
      }
    })
    .filter((e): e is BrainLine => e !== null);
}

/** Count `decision` entries appended to the brain since HEAD (ADR-0027 nudge trigger). */
export function uncommittedDecisionCount(brain: string = brainDir(), cwd: string = process.cwd()): number {
  return newBrainEntriesSinceHead(brain, cwd).filter((e) => e.type === 'decision').length;
}

export const isHandoff = (e: { tags?: string[] }): boolean => (e.tags ?? []).some((t) => t === 'handoff' || t === 'next');

/**
 * The currently PINNED handoff (ADR-0082 §2): the brain MATERIALIZED, then the engine's
 * own `latestHandoff()` — the one pin selector, so the rendered pin and B3's anchor can
 * never disagree. An earlier version scanned raw lines, so an archived entry's
 * pre-archive line still passed `isInjectable` and could mask the real pin, and it kept
 * its own copy of the ordering rule.
 *
 * Reads the brain file at an explicit `brain` path (testability, rather than env-based
 * `brainDir()` resolution). `materialize` normalizes every record at the read boundary
 * (ADR-0042 §2), so a malformed line is excluded rather than crashing classification.
 */
export function pinnedHandoff(brain: string): KnowledgeEntry | undefined {
  let lines: string[];
  try {
    lines = readFileSync(join(brain, 'entries.jsonl'), 'utf8').split('\n').filter(Boolean);
  } catch {
    return undefined; // no brain file yet
  }
  const records: StoredRecord[] = [];
  for (const l of lines) {
    try {
      records.push(JSON.parse(l) as StoredRecord);
    } catch {
      continue;
    }
  }
  const all = materialize(records);
  return latestHandoff(all, new Date().toISOString().slice(0, 10), supersededIds(all)) ?? undefined;
}

/**
 * RFC-043 Part 0 for the currently pinned handoff: its set S (newest first), `[]` when not
 * stale, `null` when unknown (no pin, not a repo, a git step failed, or the budget ran out —
 * every one of those is silence). The pin is `pinnedHandoff` — the engine's one selector
 * (rule 1, ADR-0082 §2) — and u is its `created`, not its `updated`: a zone edit to the pin
 * does not change what it says.
 *
 * Every git child is bounded by one shared deadline (decide D8, PIN_STALENESS_BUDGET_MS
 * from entry unless the caller passes its own), and the answer is cached per
 * (pin id, created, HEAD, toplevel, brainRel) in `<brain>/.signals/pin-staleness.json`
 * (decide D1). See src/pin-staleness.ts for the rule and its disclosed misses.
 */
export function pinStaleCommits(
  cwd: string = process.cwd(),
  brain: string = brainDir(),
  opts: PinStalenessOpts = {},
): { pin: KnowledgeEntry; commits: StaleCommit[] } | null {
  try {
    const pin = pinnedHandoff(brain);
    if (!pin) return null; // no handoff pinned yet — B1/B2 own that gap, not this trigger
    const r = cachedPinStaleness(cwd, brain, { id: pin.id, created: pin.created }, opts);
    return r ? { pin, commits: r.commits } : null;
  } catch {
    return null; // an uncaught throw would crash `hook stop` with zero stdout (review F3)
  }
}

/**
 * True when RFC-043 Part 0's set S is non-empty: a first-parent commit after the pin's
 * timestamp anchor touches non-brain paths, the commit carrying the pin and rebased pre-pin
 * work excluded. Fails toward silence (false). Kept as the boolean face of
 * `pinStaleCommits`; `timeout` is honoured as the whole computation's budget.
 */
export function handoffIsStale(
  cwd: string = process.cwd(),
  brain: string = brainDir(),
  opts: GitOpts = {},
): boolean {
  const o: PinStalenessOpts = opts.timeout !== undefined ? { deadline: performance.now() + opts.timeout } : {};
  return (pinStaleCommits(cwd, brain, o)?.commits.length ?? 0) > 0;
}

/** Impure shell: gather the real context for `decideStop` from git + the brain. */
export function gatherStopContext(cwd: string = process.cwd(), brain: string = brainDir()): StopContext {
  const fresh = newBrainEntriesSinceHead(brain, cwd);
  const stale = pinStaleCommits(cwd, brain);
  return {
    uncommittedWork: hasUncommittedWork(cwd, brain),
    newDecisions: fresh.filter((e) => e.type === 'decision').length,
    newEntries: fresh.length,
    newHandoffs: fresh.filter(isHandoff).length,
    staleCommits: stale?.commits ?? [],
    pin: stale ? { id: stale.pin.id, created: stale.pin.created } : undefined,
  };
}
