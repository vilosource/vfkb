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
}

export type StopDecision = { block: false } | { block: true; reminder: string };

export const STOP_REMINDER =
  'vfkb decision-capture check: this turn changed code/docs but no `decision` was recorded ' +
  'to the brain. If a load-bearing decision was made, capture it now via ' +
  '`mcp__vfkb__kb_add` (type=decision, why=<rationale>, role=human) — or ' +
  '`vfkb add decision "…" --why "…" --role human` — and add an ADR under docs/adr/ for ' +
  'anything architectural. If NO decision was made this turn, just finish normally.';

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
  if (ctx.uncommittedWork && ctx.newDecisions === 0) return { block: true, reminder: STOP_REMINDER };
  return { block: false };
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

/**
 * Count `decision` entries appended to the brain since HEAD. The brain is append-only
 * (ADR-0019), so fresh entries are exactly the lines beyond the committed line count —
 * no per-session state (KB_SESSION_ID) needed, and it aligns with the "record then commit"
 * workflow: an uncommitted decision means one WAS captured this session.
 */
export function uncommittedDecisionCount(brain: string = brainDir(), cwd: string = process.cwd()): number {
  const file = join(brain, 'entries.jsonl');
  let current: string[];
  try {
    current = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return 0; // no brain file yet
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
    .filter((l) => {
      try {
        return (JSON.parse(l) as { type?: string }).type === 'decision';
      } catch {
        return false;
      }
    }).length;
}

/** Impure shell: gather the real context for `decideStop` from git + the brain. */
export function gatherStopContext(cwd: string = process.cwd(), brain: string = brainDir()): StopContext {
  return {
    uncommittedWork: hasUncommittedWork(cwd, brain),
    newDecisions: uncommittedDecisionCount(brain, cwd),
  };
}
