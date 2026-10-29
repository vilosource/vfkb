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
//     into its `staleHandoff` last-fired mark — the effect of ADR-0084 §2.5's markNudged
//     without a second writer of the shared record. Since 1e (vfkb#387) that mark keeps B3
//     quiet on Stop for the rest of the session, compaction included (decide Q8).
//   - Q12: an in-process budget. Every git child gets a timeout bounded by the deadline;
//     past it the handler emits nothing.
//
// ADR-0085 (vfkb#395; the #395 decide step, ruling 54802539cda7) adds the third reason,
// `no-autocommit`: ADR-0033's default-branch / detached-HEAD warning, whose SessionEnd
// systemMessage is never displayed, decided by SessionEnd's own `brainCommitOutcome` and
// counted in new ids. The cadence key gains the delivered reason set, and the stage-1 fast
// path is gone (a reason that becomes true under an unchanged HEAD must still be seen).
// Built, NOT yet verified until the on-main arms of the record are DEMONSTRATED.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isHarnessPrompt } from './harness-prompt.js';
import { storageBackend } from './backend.js';
import { boundedCommits, truncateSubject, type StaleCommit } from './engine.js';
import { cachedPinStaleness } from './pin-staleness.js';
import { boundedGit, brainCommitOutcome, classifyBranch, newEntriesSinceHead, type BrainCommitOutcomeKind, type GitRunner } from './session-end.js';
import {
  handoffNudgeDue,
  hasUncommittedWork,
  isHandoff,
  pinnedHandoff,
} from './stop-reminder.js';

/** The line's label. Shared with the L4's content assertion; overlaps no Stop lead-in (Q11). */
export const PROMPT_NUDGE_LEADIN = 'vfkb handoff status:';

/** Whole-handler wall budget, node boot included (Q12; same figure as the stdin watchdog). */
export const PROMPT_NUDGE_BUDGET_MS = 2000;

export type PromptNudgeReason = 'stale' | 'b1' | 'no-autocommit';

/** Render and key order (ADR-0085 §3): stale, then b1, then no-autocommit. */
const REASON_ORDER: readonly PromptNudgeReason[] = ['stale', 'b1', 'no-autocommit'];

export interface PinFacts {
  id: string;
  created: string;
}

export interface PromptNudgeContext {
  /** the cadence BASE, `promptNudgeKey(pin, HEAD)`; the emitted key appends the reason set */
  key: string;
  /** the pinned handoff predates a later non-brain commit (RFC-043 Part 0: S non-empty) */
  stale: boolean;
  /** RFC-043 Part 0's set S (newest first) — the list the line names (vfkb#386) */
  staleCommits?: StaleCommit[];
  /** B1: uncommitted src/docs work AND ≥ HANDOFF_MIN_ENTRIES new entries AND no handoff entry */
  b1: boolean;
  pin?: PinFacts;
  /** current branch, or null on a detached HEAD */
  branch: string | null;
  /** the session's new brain ids since HEAD (ADR-0085 §2: one id-based count) */
  newEntries: number;
  /** SessionEnd's verdict on the brain right now (`brainCommitOutcome`); undefined = unknown */
  commitOutcome?: BrainCommitOutcomeKind;
  /** the SessionState is backed by a session record (a session id was known) */
  persisted: boolean;
  /** the session's turnCount (completed turns) when this prompt arrived */
  turn?: number;
}

export type PromptNudgeDecision =
  | { emit: false; why: 'harness-turn' | 'first-prompt' | 'same-key' | 'no-reason' }
  | { emit: true; text: string; reasons: PromptNudgeReason[]; key: string };

/**
 * The cadence key (ADR-0084 §2.5 as amended by ADR-0085 §4). Without `reasons`, the BASE
 * `(pin id, created, HEAD)`; with them, the base plus the sorted reason set as a fourth part.
 */
export function promptNudgeKey(pin: PinFacts | undefined, head: string, reasons?: readonly PromptNudgeReason[]): string {
  const base = `${pin?.id ?? '-'}|${pin?.created ?? '-'}|${head}`;
  return reasons === undefined ? base : `${base}|${[...reasons].sort().join('+')}`;
}

/** A stored key split into its base and its delivered reasons. An old three-part key has none. */
function parseStoredKey(k: string): { base: string; reasons: string[] } {
  const parts = k.split('|');
  if (parts.length < 4) return { base: k, reasons: [] };
  return { base: parts.slice(0, 3).join('|'), reasons: parts.slice(3).join('|').split('+').filter(Boolean) };
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

/**
 * The pure decision (ADR-0084 §2.2, §2.5, §2.6; Q2; ADR-0085 §1, §4). Emit iff a reason
 * holds AND (the base differs from the stored base OR a current reason is not among those
 * already delivered under it). A reason that disappears never re-emits. The emitted key is
 * the base plus the union of reasons delivered under it.
 */
export function decidePromptNudge(
  input: { prompt?: unknown },
  ctx: PromptNudgeContext,
  storedKey: string | undefined,
): PromptNudgeDecision {
  const skip = promptNudgeSkip(input, ctx);
  if (skip) return { emit: false, why: skip };
  const reasons: PromptNudgeReason[] = [];
  if (ctx.stale && ctx.pin) reasons.push('stale');
  if (ctx.b1) reasons.push('b1');
  // ADR-0085 §1: SessionEnd's own branch guard would refuse entries this session added.
  const refused = ctx.commitOutcome === 'on-default-branch' || ctx.commitOutcome === 'detached-head';
  if (refused && ctx.newEntries >= 1) reasons.push('no-autocommit');
  if (reasons.length === 0) return { emit: false, why: 'no-reason' };
  const stored = storedKey !== undefined ? parseStoredKey(storedKey) : undefined;
  const sameBase = stored !== undefined && stored.base === ctx.key;
  if (sameBase && reasons.every((r) => stored.reasons.includes(r))) return { emit: false, why: 'same-key' };
  const delivered = sameBase ? REASON_ORDER.filter((r) => reasons.includes(r) || stored.reasons.includes(r)) : reasons;
  const key = `${ctx.key}|${[...delivered].sort().join('+')}`;
  return { emit: true, text: renderPromptNudge(reasons, ctx), reasons, key };
}

/**
 * The one engine-side text function (ADR-0084 §2.4, RFC-047 §4.3). Since RFC-043 Part A
 * (#386) the stale clause names the commits — the same bounded subset Part A renders and the
 * B3 Stop text lists (decide D4: same membership, same 7-char hashes, same truncated
 * subjects) — and the "otherwise" branch says the next session sees this same list.
 */
export function renderPromptNudge(
  reasons: PromptNudgeReason[],
  facts: { pin?: PinFacts; branch: string | null; newEntries: number; staleCommits?: StaleCommit[] },
): string {
  const clauses: string[] = [];
  const commits = facts.staleCommits ?? [];
  const listed = reasons.includes('stale') && !!facts.pin && commits.length > 0;
  if (reasons.includes('stale') && facts.pin) {
    const date = /^\d{4}-\d{2}-\d{2}/.test(facts.pin.created) ? `, ${facts.pin.created.slice(0, 10)}` : '';
    const where = facts.branch ? facts.branch : 'a detached HEAD';
    if (listed) {
      const { shown, more } = boundedCommits(commits);
      const items = shown.map((c) => `${c.short} ${truncateSubject(c.subject)}`).join('; ');
      const n = commits.length;
      clauses.push(
        `the pinned handoff (${facts.pin.id}${date}) predates ${n} commit${n === 1 ? '' : 's'} on ${where}: ` +
          `${items}${more > 0 ? ` (+${more} more)` : ''}`,
      );
    } else {
      clauses.push(`the pinned handoff (${facts.pin.id}${date}) predates a later commit on ${where}`);
    }
  }
  if (reasons.includes('b1')) {
    clauses.push(`this session has recorded ${facts.newEntries} entries and no handoff/next entry`);
  }
  const third = reasons.includes('no-autocommit');
  if (third) {
    // ADR-0085 §3 (decide Q3, recipe revision): the REASON is a fact, so it lives in the fact clause;
    // the conditional names the recipe (git switch -c), in parity with the stale clause's kb_add.
    const n = facts.newEntries;
    const where = facts.branch ? facts.branch : 'a detached HEAD';
    clauses.push(
      `the brain has ${n} uncommitted entr${n === 1 ? 'y' : 'ies'} on ${where}, ` +
        'which SessionEnd will not auto-commit (it commits only on a topic branch)',
    );
  }
  const tail = `otherwise nothing is needed now${listed ? ' — the next session sees this same list at start' : ''}.`;
  const handoff = reasons.includes('stale') || reasons.includes('b1');
  if (third && !handoff) {
    return (
      `${PROMPT_NUDGE_LEADIN} ${clauses.join('; ')}.` +
      ' If this prompt ends the session, switching to a topic branch (git switch -c <name>) and committing ' +
      `.vfkb/entries.jsonl there is worth doing before finishing; ${tail}`
    );
  }
  if (third) {
    return (
      `${PROMPT_NUDGE_LEADIN} ${clauses.join('; ')}.` +
      ' If this prompt ends the session, two things are worth doing before finishing: a fresh handoff/next entry ' +
      '(kb_add type=fact, tags=handoff,next, role=human) naming what changed and what is next, then switching to a ' +
      `topic branch (git switch -c <name>) and committing .vfkb/entries.jsonl there; ${tail}`
    );
  }
  // Without the third reason: ADR-0084 §2.4's text, byte-identical.
  return (
    `${PROMPT_NUDGE_LEADIN} ${clauses.join('; ')}.` +
    ' If this prompt ends the session, a fresh handoff/next entry (kb_add type=fact, tags=handoff,next, ' +
    'role=human) naming what changed and what is next is the one thing worth recording before finishing; ' +
    tail
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
 * Gather the whole context on every non-skipped prompt (ADR-0085 §4, decide Q4: no stage-1
 * fast path — a reason can become true under an unchanged HEAD). `deadline` is a
 * `performance.now()` instant; every git child is bounded by it, and a timed-out child
 * fails open (the shell then emits nothing once past the deadline).
 */
export function gatherPromptContext(
  cwd: string,
  brain: string,
  s: { persisted: boolean; turn?: number },
  deadline: number,
): PromptNudgeContext {
  const left = () => deadline - performance.now();
  const bg: GitRunner = (args, dir) => boundedGit(left())(args, dir);
  const head = git(['rev-parse', 'HEAD'], cwd, left()) ?? '-';
  const p = pinnedHandoff(brain);
  const pin = p ? { id: p.id, created: p.created } : undefined;
  // RFC-043 Part 0 for the pin already selected above, inside this handler's deadline (Q12)
  // and through the shared per-brain cache (decide D1), so Stop and Part A agree with it.
  const staleCommits = p ? (cachedPinStaleness(cwd, brain, pin!, { deadline })?.commits ?? []) : [];
  const stale = staleCommits.length > 0;
  // ADR-0085 §1: SessionEnd's own predicate. It reads HEAD's brain once (new ids) and the
  // branch; for `not-a-repo` / `brain-clean` it stops early, so read the count separately.
  const oc = brainCommitOutcome(bg, cwd, brain);
  const fresh = oc.fresh ?? newEntriesSinceHead(bg, cwd, join(brain, 'entries.jsonl'));
  const work = hasUncommittedWork(cwd, brain, { timeout: ms(left()) });
  const b1 = handoffNudgeDue({ uncommittedWork: work, newEntries: fresh.length, newHandoffs: fresh.filter(isHandoff).length });
  const branch = oc.branch !== undefined ? oc.branch : stale ? classifyBranch(bg, cwd).branch : null;
  return {
    key: promptNudgeKey(pin, head),
    stale,
    staleCommits,
    b1,
    pin,
    branch,
    newEntries: fresh.length,
    commitOutcome: oc.outcome,
    persisted: s.persisted,
    turn: s.turn,
  };
}
