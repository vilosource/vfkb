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

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { brainDir } from './storage.js';
import { isInjectable, supersededIds } from './engine.js';
import type { KnowledgeEntry } from './types.js';

export interface StopHookInput {
  stop_hook_active?: boolean;
}

/** The three Stop-hook nudge types, each with its own independent cooldown window. */
export type NudgeKey = 'decision' | 'handoff' | 'staleHandoff';

export interface StopContext {
  /** working tree has uncommitted src/ or docs/ changes (substantive work happened) */
  uncommittedWork: boolean;
  /** count of `decision` entries appended to the brain but not yet committed */
  newDecisions: number;
  /** total entries appended to the brain since HEAD this session (git-delta) */
  newEntries?: number;
  /** count of `handoff`/`next`-tagged entries appended to the brain since HEAD */
  newHandoffs?: number;
  /** the currently pinned handoff/next entry predates a non-brain commit (B3) */
  handoffStale?: boolean;
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

// GAP-1 B1 (RFC-011 §B): the higher-quality, agent-authored handoff nudge. The Stop
// hook is the ONLY surface that can prompt the agent, but it fires per-turn while a
// handoff is an end-of-session artifact — so the framing is deliberately conditional
// ("if you're wrapping up"), letting the agent decline mid-session. It self-silences:
// the moment ANY handoff/next entry is recorded, the trigger goes quiet (no
// KB_SESSION_ID / per-session state needed — the side-effect it asks for is the guard).
export const HANDOFF_REMINDER =
  'vfkb handoff check: this session has recorded knowledge but no `handoff`/`next` entry. ' +
  'If you are WRAPPING UP, record a durable handoff now — `mcp__vfkb__kb_add` ' +
  '(type=fact, tags=handoff,next, role=human) naming what the NEXT session should pick up ' +
  '(a real "next:", not just a summary). If you are still mid-session, ignore this and ' +
  'finish normally — the SessionEnd floor will leave a fallback if you never do.';

// B3 (pragmatic patch, built NOT yet verified — no RFC/ADR/L4 yet): unlike B1/B2, this
// is not about whether THIS session recorded a handoff — it fires when a commit already
// landed (e.g. a merged PR, possibly from another session or an autonomous merge) *after*
// the currently pinned handoff's timestamp, so the pin itself is now stale regardless of
// what this session did. Deliberately NOT gated on `uncommittedWork`: the defining case is
// everything already committed/merged and the working tree clean.
//
// Nag risk (review round 3): unlike B1, this has no entry-count threshold and no
// SessionEnd-floor equivalent for a STALE (vs missing) pin — RFC-011 §B's per-turn-nag
// concern applies here too. Originally mitigated only by an "if mid-session, this is fine
// to defer" escape clause in the reminder text; that proved insufficient in live use
// (operator report 2026-07-31: firing on every stop mid-session distracted the work), so
// all three nudges now share the NUDGE_COOLDOWN_TURNS rate limit above.
export const STALE_HANDOFF_REMINDER =
  'vfkb stale-handoff check: the currently pinned handoff/next entry predates a commit that ' +
  'landed since it was written (e.g. a merged PR, possibly from another session or an ' +
  'autonomous merge) — a fresh session would start from an out-of-date "what happened" ' +
  'pointer. If you are WRAPPING UP, record a fresh handoff now — `mcp__vfkb__kb_add` ' +
  '(type=fact, tags=handoff,next, role=human), or /vfkb:handoff if available — naming what ' +
  'actually changed and what is next now. If you are still mid-session and plan to record ' +
  'one before you finish, it is fine to ignore this for now — but note that unlike the ' +
  'other nudges, this one has no SessionEnd fallback for a STALE (as opposed to missing) ' +
  'pin, so a fresh handoff/next entry must be recorded before the session ends.';

/**
 * The pure decision. Block (inject the reminder, continuing the turn) only when a
 * decision *plausibly* went unrecorded; otherwise allow the stop.
 *  1. Native loop guard: never block our own re-entry (`stop_hook_active`), or it nags forever.
 *  2. Conditional trigger: substantive work happened AND no decision was recorded this session.
 *  (Not a true Brake — working-tree-changed ≠ decision-made; the committed ADR stays the
 *  deterministic backstop for *significant* decisions. This just fires the nudge at the right
 *  moment, only when plausibly needed.)
 */
export function decideStop(input: StopHookInput, ctx: StopContext): StopDecision {
  if (input?.stop_hook_active) return { block: false };
  // Cooldown (operator ruling 2026-07-31): a nudge whose trigger holds still stays quiet
  // for NUDGE_COOLDOWN_TURNS turns after it last fired. Without session turn info the
  // window cannot be computed → fall back to firing (the pre-cooldown behavior).
  const cooling = (key: NudgeKey): boolean => {
    const last = ctx.lastNudged?.[key];
    return last !== undefined && ctx.turn !== undefined && ctx.turn - last < NUDGE_COOLDOWN_TURNS;
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
  // Handoff nudge (B1, RFC-011): work happened AND a strong-signal amount of knowledge
  // accumulated AND no handoff/next entry yet. Self-silences once a handoff is recorded.
  if (ctx.uncommittedWork && (ctx.newEntries ?? 0) >= HANDOFF_MIN_ENTRIES && (ctx.newHandoffs ?? 0) === 0)
    nudge('handoff', HANDOFF_REMINDER);
  // Stale-handoff nudge (B3): NOT gated on uncommittedWork — the defining case is a clean
  // working tree with everything already merged, and the pinned handoff behind it anyway.
  if (ctx.handoffStale) nudge('staleHandoff', STALE_HANDOFF_REMINDER);
  if (reminders.length === 0) return { block: false };
  return { block: true, reminder: reminders.join('\n\n'), fired };
}

/** Working tree has uncommitted src/ or docs/ changes (brain-only changes don't count as "work"). */
export function hasUncommittedWork(cwd: string = process.cwd(), brain: string = brainDir()): boolean {
  let out: string;
  try {
    out = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
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
export function newBrainEntriesSinceHead(brain: string = brainDir(), cwd: string = process.cwd()): BrainLine[] {
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
    const head = execFileSync('git', ['show', `HEAD:${rel}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
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

const isHandoff = (e: BrainLine): boolean => (e.tags ?? []).some((t) => t === 'handoff' || t === 'next');

/**
 * ISO timestamp of the currently PINNED handoff/next entry — the same selection engine.ts's
 * `latestHandoff()` uses for `resume`/`/vfkb:brief` (newest-by-`updated`-then-`created` among
 * INJECTABLE entries: not archived, not superseded, not deprecated, provenance not
 * stale/expired, not past `valid_until`). Reuses the engine's own `isInjectable`/
 * `supersededIds` rather than re-simplifying that logic — an earlier version of this function
 * used bare newest-by-timestamp with no injectability filtering, which review found produces
 * a real false negative: a later archived/superseded handoff entry can mask an earlier,
 * actually-pinned one, making a genuinely stale handoff read as fresh.
 *
 * Reads the WHOLE brain (committed + uncommitted) directly from the file rather than via
 * `readAll()`/`materialize()`, so it works with an explicit `brain` path for testability
 * instead of env-var-based `brainDir()` resolution.
 */
function newestHandoffTimestamp(brain: string): string | undefined {
  const file = join(brain, 'entries.jsonl');
  let lines: string[];
  try {
    lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return undefined; // no brain file yet
  }
  const all: KnowledgeEntry[] = [];
  for (const l of lines) {
    try {
      all.push(JSON.parse(l) as KnowledgeEntry);
    } catch {
      continue;
    }
  }
  const superseded = supersededIds(all);
  const today = new Date().toISOString().slice(0, 10);
  let newest: KnowledgeEntry | undefined;
  for (const e of all) {
    if (!isHandoff(e)) continue;
    // Defensive: a malformed/partial entry (missing provenance/validity — should not exist
    // in a real engine-written brain, but this reads the raw file directly, not through
    // addEntry's guarantees) must not crash classification of every OTHER entry. Treat it
    // as non-injectable — the safe default this file already uses elsewhere (skip, don't
    // nag) when something is unexpected.
    let injectable: boolean;
    try {
      injectable = isInjectable(e, today, superseded);
    } catch {
      continue;
    }
    if (!injectable) continue;
    if (!newest) {
      newest = e;
      continue;
    }
    // Same total order as latestHandoff (engine.ts): updated, then created, `>=` keeps the
    // later entry on a full-timestamp tie (the newest write in an append-only log).
    const cmp = e.updated.localeCompare(newest.updated) || e.created.localeCompare(newest.created);
    if (cmp >= 0) newest = e;
  }
  return newest?.updated;
}

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // git's well-known empty-tree object

/**
 * True when the tree at HEAD differs — outside the brain directory — from the tree as of
 * the commit nearest the pinned handoff's timestamp. The signal that the currently
 * pinned handoff no longer reflects the branch's real state (e.g. a PR merged after the
 * handoff was written).
 *
 * Deliberately a TREE diff between an anchor commit and HEAD, not a `git log --since`
 * walk: `--name-only` prints no paths for an ordinary merge commit by default (verified
 * empirically), so a long-lived branch whose own commits predate the handoff but whose
 * merge lands after it would be silently missed by a log-walk. Diffing two trees
 * sidesteps merge-commit display/simplification entirely, and `--quiet` (exit-code only,
 * no captured output) avoids buffering a large file list for a repo with a lot of history
 * since an old handoff.
 *
 * Resolves the repo root via `git rev-parse --show-toplevel` and runs there — pathspecs
 * are resolved relative to the invocation cwd, so running from a subdirectory (a
 * supported hook condition) without this would silently exclude the wrong path.
 *
 * General across projects: unlike `hasUncommittedWork`, this makes no `src/`/`docs/`
 * assumption, since a consumer repo may use neither layout — and excludes the WHOLE
 * brain directory (entries.jsonl, manifest.json, any future committed brain file), not
 * one hardcoded filename.
 */
export function handoffIsStale(cwd: string = process.cwd(), brain: string = brainDir()): boolean {
  // One outer backstop around the whole function, on top of the targeted inner handling
  // below — defense in depth (review finding F3): every individual git call already fails
  // open, but an uncaught exception ANYWHERE in this chain (this hook's own `main()` has no
  // top-level catch) would otherwise crash `cli.ts hook stop` entirely — zero stdout, not
  // fail-open — instead of just skipping this one nudge.
  try {
    const since = newestHandoffTimestamp(brain);
    if (!since) return false; // no handoff pinned yet — B1/B2 own that gap, not this trigger
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const brainRel = relative(root, brain).replace(/\\/g, '/');
    const exclude = `:(exclude)${brainRel}`;
    const anchor = execFileSync('git', ['rev-list', '-1', `--before=${since}`, 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const base = anchor || EMPTY_TREE_SHA; // handoff predates all history → diff against nothing
    try {
      execFileSync('git', ['diff', '--quiet', base, 'HEAD', '--', '.', exclude], { cwd: root, stdio: 'ignore' });
      return false; // exit 0: no non-brain difference
    } catch (e) {
      return (e as { status?: number }).status === 1; // exit 1: a real diff; anything else → fail-open
    }
  } catch {
    return false; // not a repo / git missing / anything unexpected → fail-open (don't nag)
  }
}

/** Impure shell: gather the real context for `decideStop` from git + the brain. */
export function gatherStopContext(cwd: string = process.cwd(), brain: string = brainDir()): StopContext {
  const fresh = newBrainEntriesSinceHead(brain, cwd);
  return {
    uncommittedWork: hasUncommittedWork(cwd, brain),
    newDecisions: fresh.filter((e) => e.type === 'decision').length,
    newEntries: fresh.length,
    newHandoffs: fresh.filter(isHandoff).length,
    handoffStale: handoffIsStale(cwd, brain),
  };
}
