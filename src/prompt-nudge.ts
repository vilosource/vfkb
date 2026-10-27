// ADR-0084 §2 (accepts RFC-047 §4.3; vfkb#385): the standing handoff reminder rides the
// NEXT user prompt as one non-blocking UserPromptSubmit `additionalContext` line, instead
// of blocking Stop. Built, NOT yet verified until scenarios/records/handoff-next-prompt.json
// is DEMONSTRATED (ADR-0050/0051).
//
// `decidePromptNudge` is the PURE core (unit-tested in test/prompt-nudge.test.ts). The git /
// brain gathering is the impure shell below, used by `cli.ts hook user-prompt-submit`.
//
// Decide-step outcomes this file implements (ruling 54802539cda7; brain decisions on the
// #385 branch):
//   - Q2: never emit on a PERSISTED session's first prompt (turnCount 0). One-shot headless
//     runs (review gates, workflow subagents) would otherwise be invited to write a handoff
//     that displaces the operator's pin. Skips before any bookkeeping or git work.
//   - Q9: `{branch}` is read with `git symbolic-ref --short -q HEAD`; empty → "a detached
//     HEAD". `{created-date}` is `created.slice(0, 10)`; malformed → omitted.
//   - Q10: the handler is READ-ONLY against the session record. The emitted key (and the
//     turn a stale-reason line was delivered) live in a per-session signal file under
//     `<brain>/.signals/prompt-nudge/`, written tmp + rename. The Stop hook folds that turn
//     into its `staleHandoff` cooldown — the effect of ADR-0084 §2.5's markNudged without a
//     second writer of the shared record.
//   - Q12: an in-process budget. Every git child gets a timeout bounded by the deadline;
//     past it the handler emits nothing.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isHarnessPrompt } from './harness-prompt.js';
import { storageBackend } from './backend.js';
import {
  HANDOFF_MIN_ENTRIES,
  handoffIsStale,
  hasUncommittedWork,
  isHandoff,
  newBrainEntriesSinceHead,
  pinnedHandoff,
} from './stop-reminder.js';

/** The line's label. Shared with the L4's content assertion; overlaps no Stop lead-in (Q11). */
export const PROMPT_NUDGE_LEADIN = 'vfkb handoff status:';

/** Whole-handler wall budget, node boot included (Q12; same figure as the stdin watchdog). */
export const PROMPT_NUDGE_BUDGET_MS = 2000;

export type PromptNudgeReason = 'stale' | 'b1';

export interface PinFacts {
  id: string;
  created: string;
}

export interface PromptNudgeContext {
  /** `promptNudgeKey(pin, HEAD)` */
  key: string;
  /** the pinned handoff predates a later non-brain commit (today's `handoffIsStale`) */
  stale: boolean;
  /** B1: uncommitted src/docs work AND ≥ HANDOFF_MIN_ENTRIES new entries AND no handoff entry */
  b1: boolean;
  pin?: PinFacts;
  /** current branch, or null on a detached HEAD */
  branch: string | null;
  /** entries appended to the brain since HEAD */
  newEntries: number;
  /** the SessionState is backed by a session record (a session id was known) */
  persisted: boolean;
  /** the session's turnCount (completed turns) when this prompt arrived */
  turn?: number;
}

export type PromptNudgeDecision =
  | { emit: false; why: 'harness-turn' | 'first-prompt' | 'same-key' | 'no-reason' }
  | { emit: true; text: string; reasons: PromptNudgeReason[]; key: string };

export function promptNudgeKey(pin: PinFacts | undefined, head: string): string {
  return `${pin?.id ?? '-'}|${pin?.created ?? '-'}|${head}`;
}

const validTurn = (t: unknown): t is number => typeof t === 'number' && Number.isFinite(t) && t >= 0;

/**
 * The checks that need no git: harness turn (§2.6) and a persisted session's first prompt
 * (Q2). Returned separately so the shell can stop before spawning anything.
 */
export function promptNudgeSkip(
  input: { prompt?: unknown },
  s: { persisted: boolean; turn?: number },
): 'harness-turn' | 'first-prompt' | null {
  if (isHarnessPrompt(input?.prompt)) return 'harness-turn';
  if (s.persisted && validTurn(s.turn) && s.turn === 0) return 'first-prompt';
  return null;
}

/** The pure decision (ADR-0084 §2.2, §2.5, §2.6; Q2). */
export function decidePromptNudge(
  input: { prompt?: unknown },
  ctx: PromptNudgeContext,
  storedKey: string | undefined,
): PromptNudgeDecision {
  const skip = promptNudgeSkip(input, ctx);
  if (skip) return { emit: false, why: skip };
  if (storedKey !== undefined && storedKey === ctx.key) return { emit: false, why: 'same-key' };
  const reasons: PromptNudgeReason[] = [];
  if (ctx.stale && ctx.pin) reasons.push('stale');
  if (ctx.b1) reasons.push('b1');
  if (reasons.length === 0) return { emit: false, why: 'no-reason' };
  return { emit: true, text: renderPromptNudge(reasons, ctx), reasons, key: ctx.key };
}

/**
 * The one engine-side text function (ADR-0084 §2.4, RFC-047 §4.3). Before RFC-043 Part A
 * ships (#386) there is no commit list and no "the next session sees this same list"
 * clause (RFC-047 §8 K).
 */
export function renderPromptNudge(
  reasons: PromptNudgeReason[],
  facts: { pin?: PinFacts; branch: string | null; newEntries: number },
): string {
  const clauses: string[] = [];
  if (reasons.includes('stale') && facts.pin) {
    const date = /^\d{4}-\d{2}-\d{2}/.test(facts.pin.created) ? `, ${facts.pin.created.slice(0, 10)}` : '';
    const where = facts.branch ? facts.branch : 'a detached HEAD';
    clauses.push(`the pinned handoff (${facts.pin.id}${date}) predates a later commit on ${where}`);
  }
  if (reasons.includes('b1')) {
    clauses.push(`this session has recorded ${facts.newEntries} entries and no handoff/next entry`);
  }
  return (
    `${PROMPT_NUDGE_LEADIN} ${clauses.join('; ')}.` +
    ' If this prompt ends the session, a fresh handoff/next entry (kb_add type=fact, tags=handoff,next, ' +
    'role=human) naming what changed and what is next is the one thing worth recording before finishing; ' +
    'otherwise nothing is needed now.'
  );
}

// ── the per-session signal (Q10): never the shared session record ───────────────────────

export interface PromptNudgeSignal {
  /** the last emitted key */
  key?: string;
  /** the session turnCount at which a line carrying the stale reason was delivered */
  staleAtTurn?: number;
}

const safeKey = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_');
const signalPath = (brain: string, sessionId: string): string =>
  join(brain, '.signals', 'prompt-nudge', `${safeKey(sessionId)}.json`);

export function readPromptNudgeSignal(brain: string, sessionId: string | undefined): PromptNudgeSignal {
  if (!sessionId) return {};
  try {
    const raw = JSON.parse(readFileSync(signalPath(brain, sessionId), 'utf8')) as Record<string, unknown>;
    const out: PromptNudgeSignal = {};
    if (typeof raw.key === 'string' && raw.key) out.key = raw.key;
    if (validTurn(raw.staleAtTurn)) out.staleAtTurn = raw.staleAtTurn;
    return out;
  } catch {
    return {}; // absent or malformed → unset (emit while the trigger holds)
  }
}

export function writePromptNudgeSignal(brain: string, sessionId: string, sig: PromptNudgeSignal): void {
  const f = signalPath(brain, sessionId);
  mkdirSync(join(brain, '.signals', 'prompt-nudge'), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(sig), 'utf8');
  renameSync(tmp, f);
}

/** SessionStart `source: "compact"` evicts the line, so the key resets (ADR-0084 §2.5). */
export function clearPromptNudgeKey(brain: string, sessionId: string | undefined): void {
  if (!sessionId) return;
  const sig = readPromptNudgeSignal(brain, sessionId);
  if (sig.key === undefined) return;
  delete sig.key;
  try {
    if (sig.staleAtTurn === undefined) rmSync(signalPath(brain, sessionId), { force: true });
    else writePromptNudgeSignal(brain, sessionId, sig);
  } catch {
    /* fail-open: a stale key only suppresses one line */
  }
}

/**
 * The session facts this hook needs, read straight from the record and NEVER written back
 * (Q10). Not `SessionState.load`, whose constructor also spawns git to stamp a branch —
 * a git child outside the budget (Q12). No id → ephemeral (no turn info). An id with no
 * record → turn 0, as SessionState would read it. A corrupt record → no turn info.
 */
export function readSessionTurn(sessionId: string | undefined): { persisted: boolean; turn?: number } {
  if (!sessionId) return { persisted: false };
  try {
    const raw = storageBackend().readSessionRecord(sessionId);
    if (raw === null) return { persisted: true, turn: 0 };
    const t = (JSON.parse(raw) as { turnCount?: unknown }).turnCount;
    return { persisted: true, turn: validTurn(t) ? t : undefined };
  } catch {
    return { persisted: true };
  }
}

// ── the impure shell ────────────────────────────────────────────────────────────────────

// child_process rejects a fractional timeout (ERR_OUT_OF_RANGE) — and every caller fails
// open on a throw, so a raw `performance.now()` difference silently disabled every git read.
const ms = (t: number): number => Math.max(1, Math.floor(t));

function git(args: string[], cwd: string, timeout: number): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: ms(timeout),
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Gather the context in two stages (RFC-047 §4.3): the key first (one `git rev-parse` plus
 * the pin lookup); when it equals `storedKey`, return without the staleness or B1 work.
 * `deadline` is a `performance.now()` instant; every git child is bounded by it.
 */
export function gatherPromptContext(
  cwd: string,
  brain: string,
  s: { persisted: boolean; turn?: number },
  storedKey: string | undefined,
  deadline: number,
): PromptNudgeContext {
  const left = () => deadline - performance.now();
  const head = git(['rev-parse', 'HEAD'], cwd, left()) ?? '-';
  const p = pinnedHandoff(brain);
  const pin = p ? { id: p.id, created: p.created } : undefined;
  const key = promptNudgeKey(pin, head);
  const base: PromptNudgeContext = {
    key,
    stale: false,
    b1: false,
    pin,
    branch: null,
    newEntries: 0,
    persisted: s.persisted,
    turn: s.turn,
  };
  if (storedKey !== undefined && storedKey === key) return base;
  const opts = { timeout: ms(left()) };
  const stale = handoffIsStale(cwd, brain, opts);
  const fresh = newBrainEntriesSinceHead(brain, cwd, { timeout: ms(left()) });
  const work = hasUncommittedWork(cwd, brain, { timeout: ms(left()) });
  const b1 = work && fresh.length >= HANDOFF_MIN_ENTRIES && fresh.filter(isHandoff).length === 0;
  const branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], cwd, left()) || null;
  return { ...base, stale, b1, branch, newEntries: fresh.length };
}
