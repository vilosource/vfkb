// Stop-hook decision-capture reminder (RFC-008 / ADR-0027). A conditional,
// once-per-turn end-of-turn nudge: when a turn plausibly made a decision but recorded
// none, inject a reminder so the agent captures it before handing back to the user.
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

export interface StopHookInput {
  stop_hook_active?: boolean;
}

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
}

export type StopDecision = { block: false } | { block: true; reminder: string };

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
export const STALE_HANDOFF_REMINDER =
  'vfkb stale-handoff check: the currently pinned handoff/next entry predates a commit that ' +
  'landed since it was written (e.g. a merged PR) — a fresh session would start from an ' +
  'out-of-date "what happened" pointer. Before wrapping up, record a fresh handoff — ' +
  '`mcp__vfkb__kb_add` (type=fact, tags=handoff,next, role=human), or /vfkb:handoff if ' +
  'available — naming what actually changed and what is next now.';

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
  const reminders: string[] = [];
  // Decision-capture nudge (ADR-0027): work happened AND no decision recorded this session.
  if (ctx.uncommittedWork && ctx.newDecisions === 0) reminders.push(STOP_REMINDER);
  // Handoff nudge (B1, RFC-011): work happened AND a strong-signal amount of knowledge
  // accumulated AND no handoff/next entry yet. Self-silences once a handoff is recorded.
  if (ctx.uncommittedWork && (ctx.newEntries ?? 0) >= HANDOFF_MIN_ENTRIES && (ctx.newHandoffs ?? 0) === 0)
    reminders.push(HANDOFF_REMINDER);
  // Stale-handoff nudge (B3): NOT gated on uncommittedWork — the defining case is a clean
  // working tree with everything already merged, and the pinned handoff behind it anyway.
  if (ctx.handoffStale) reminders.push(STALE_HANDOFF_REMINDER);
  if (reminders.length === 0) return { block: false };
  return { block: true, reminder: reminders.join('\n\n') };
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
 * ISO timestamp of the most recently updated `handoff`/`next`-tagged entry in the WHOLE
 * brain (committed + uncommitted) — not just entries since HEAD. Deliberately simpler than
 * engine.ts's `latestHandoff()`: it does not replicate `isInjectable`'s supersession/expiry
 * filtering. The newest-by-timestamp entry is the pinned one in the overwhelming common
 * case; a future RFC can tighten this if that assumption ever breaks in practice.
 */
function newestHandoffTimestamp(brain: string): string | undefined {
  const file = join(brain, 'entries.jsonl');
  let lines: string[];
  try {
    lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return undefined; // no brain file yet
  }
  let newest: string | undefined;
  for (const l of lines) {
    let e: BrainLine;
    try {
      e = JSON.parse(l);
    } catch {
      continue;
    }
    if (!isHandoff(e)) continue;
    const ts = e.updated ?? e.created;
    if (!ts) continue;
    if (!newest || ts.localeCompare(newest) > 0) newest = ts;
  }
  return newest;
}

/**
 * True when a commit landed (commit date after the pinned handoff's timestamp) that
 * touches something other than the brain file itself — the signal that the currently
 * pinned handoff no longer reflects the branch's real state (e.g. a PR merged after the
 * handoff was written). General across projects: unlike `hasUncommittedWork`, this makes
 * no `src/`/`docs/` assumption, since a consumer repo may use neither layout.
 */
export function handoffIsStale(cwd: string = process.cwd(), brain: string = brainDir()): boolean {
  const since = newestHandoffTimestamp(brain);
  if (!since) return false; // no handoff pinned yet — B1/B2 own that gap, not this trigger
  const brainRel = relative(cwd, join(brain, 'entries.jsonl')).replace(/\\/g, '/');
  let out: string;
  try {
    out = execFileSync('git', ['log', `--since=${since}`, '--name-only', '--pretty=format:'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return false; // not a repo / git missing → fail-open (don't nag)
  }
  return out.split('\n').some((line) => {
    const f = line.trim();
    return f !== '' && f !== brainRel;
  });
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
