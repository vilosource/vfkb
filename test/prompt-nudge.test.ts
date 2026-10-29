// ADR-0084 §2 / vfkb#385: the non-blocking UserPromptSubmit handoff line — the pure core.
// The wording is pinned here (§2.4), the cadence key (§2.5), the harness-turn skip (§2.6)
// and the decide step's Q2 (no line on a persisted session's first prompt) and Q9
// (placeholder fallbacks). Each `it` was observed RED before src/prompt-nudge.ts existed.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideStop } from '../src/stop-reminder.js';
import {
  decidePromptNudge,
  renderPromptNudge,
  promptNudgeKey,
  PROMPT_NUDGE_LEADIN,
  clearPromptNudgeKey,
  readPromptNudgeSignal,
  writePromptNudgeSignal,
  type PromptNudgeContext,
} from '../src/prompt-nudge.js';
import { isHarnessPrompt, HARNESS_PROMPT_LEADINS } from '../src/harness-prompt.js';
import { PROMPT_LINE_LEADIN, STOP_HANDOFF_LEADINS } from '../scenarios/lib/nudge-verdict.mjs';

const pin = { id: 'c708f71279b6', created: '2026-10-27T07:36:12.345Z' };
const ctx = (over: Partial<PromptNudgeContext> = {}): PromptNudgeContext => ({
  key: promptNudgeKey(pin, 'abc123'),
  stale: true,
  b1: false,
  pin,
  branch: 'feat/x',
  newEntries: 0,
  persisted: true,
  turn: 2,
  ...over,
});
const typed = { prompt: 'that is all for today' };

const STALE_TEXT =
  'vfkb handoff status: the pinned handoff (c708f71279b6, 2026-10-27) predates a later commit on feat/x.';
const B1_TEXT = 'vfkb handoff status: this session has recorded 4 entries and no handoff/next entry.';
const COND =
  ' If this prompt ends the session, a fresh handoff/next entry (kb_add type=fact, tags=handoff,next, ' +
  'role=human) naming what changed and what is next is the one thing worth recording before finishing; ' +
  'otherwise nothing is needed now.';

describe('renderPromptNudge — the pinned wording (ADR-0084 §2.4)', () => {
  it('stale only', () => {
    expect(renderPromptNudge(['stale'], { pin, branch: 'feat/x', newEntries: 0 })).toBe(STALE_TEXT + COND);
  });
  it('B1 only', () => {
    expect(renderPromptNudge(['b1'], { branch: 'feat/x', newEntries: 4 })).toBe(B1_TEXT + COND);
  });
  it('both: two fact clauses, one conditional', () => {
    const t = renderPromptNudge(['stale', 'b1'], { pin, branch: 'feat/x', newEntries: 4 });
    expect(t).toBe(
      'vfkb handoff status: the pinned handoff (c708f71279b6, 2026-10-27) predates a later commit on feat/x; ' +
        'this session has recorded 4 entries and no handoff/next entry.' +
        COND,
    );
    expect(t.split('If ').length - 1).toBe(1);
  });
  it('starts with the shared lead-in, which the L4 asserts on and which overlaps no Stop lead-in (Q11)', () => {
    expect(PROMPT_NUDGE_LEADIN).toBe('vfkb handoff status:');
    expect(PROMPT_LINE_LEADIN).toBe(PROMPT_NUDGE_LEADIN);
    for (const l of [...STOP_HANDOFF_LEADINS, 'vfkb decision-capture check']) {
      expect(PROMPT_NUDGE_LEADIN.includes(l) || l.includes(PROMPT_NUDGE_LEADIN)).toBe(false);
    }
    for (const r of [['stale'], ['b1'], ['stale', 'b1']] as const) {
      expect(renderPromptNudge([...r], { pin, branch: 'b', newEntries: 3 }).startsWith(PROMPT_NUDGE_LEADIN)).toBe(true);
    }
  });
  it('never carries the forbidden phrases', () => {
    const t = renderPromptNudge(['stale', 'b1'], { pin, branch: 'feat/x', newEntries: 4 });
    for (const bad of ['must', 'before the session ends', 'plan to record one', 'next session sees']) {
      expect(t.toLowerCase()).not.toContain(bad);
    }
  });
  it('Q9: a detached HEAD reads "a detached HEAD", never the literal HEAD', () => {
    expect(renderPromptNudge(['stale'], { pin, branch: null, newEntries: 0 })).toContain(
      'predates a later commit on a detached HEAD.',
    );
  });
  it('Q9: a malformed created date is omitted, never printed as a token', () => {
    const t = renderPromptNudge(['stale'], { pin: { id: 'c708f71279b6', created: 'garbage' }, branch: 'b', newEntries: 0 });
    expect(t).toContain('the pinned handoff (c708f71279b6) predates');
    expect(t).not.toMatch(/undefined|unknown|garbage/);
  });
});

// RFC-047 §4.3 / §4.4 (vfkb#386): with Part A, the stale clause names the commits — the same
// bounded subset Part A renders (decide D4) — and gains the "next session sees" clause.
describe('renderPromptNudge — with the Part 0 list (#386)', () => {
  const c = (n: number, subject = `fix: change ${n}`) => ({ hash: `${n}`.repeat(40), short: `${n}`.repeat(7), subject });
  const LISTED_COND = COND.replace(/\.$/, ' — the next session sees this same list at start.');

  it('pins the RFC-047 §4.3 template for two commits', () => {
    expect(renderPromptNudge(['stale'], { pin, branch: 'feat/x', newEntries: 0, staleCommits: [c(2), c(1)] })).toBe(
      'vfkb handoff status: the pinned handoff (c708f71279b6, 2026-10-27) predates 2 commits on feat/x: ' +
        '2222222 fix: change 2; 1111111 fix: change 1.' +
        LISTED_COND,
    );
  });
  it('one commit is singular', () => {
    expect(renderPromptNudge(['stale'], { pin, branch: 'b', newEntries: 0, staleCommits: [c(1)] })).toContain(
      'predates 1 commit on b: 1111111 fix: change 1.',
    );
  });
  it('the list is the bounded subset, then (+k more); about 400 characters at most', () => {
    const many = Array.from({ length: 12 }, (_, i) => c(i % 10, `feat: subject ${i} ` + 'y'.repeat(200)));
    const t = renderPromptNudge(['stale'], { pin, branch: 'b', newEntries: 0, staleCommits: many });
    const list = t.slice(t.indexOf(': ', t.indexOf('predates')) + 2, t.indexOf(' If this prompt'));
    expect(list.length).toBeLessThanOrEqual(400);
    expect(list).toMatch(/\(\+\d+ more\)\.$/);
    expect(list).toContain('…'); // subjects cut at 100 characters
  });
  it('with B1 too: both fact clauses, one conditional, the listed ending', () => {
    const t = renderPromptNudge(['stale', 'b1'], { pin, branch: 'feat/x', newEntries: 4, staleCommits: [c(1)] });
    expect(t.split('If ').length - 1).toBe(1);
    expect(t).toContain('; this session has recorded 4 entries and no handoff/next entry.');
    expect(t.endsWith('— the next session sees this same list at start.')).toBe(true);
  });
  it('still never says must / before the session ends', () => {
    const t = renderPromptNudge(['stale', 'b1'], { pin, branch: 'feat/x', newEntries: 4, staleCommits: [c(1), c(2)] });
    for (const bad of ['must', 'before the session ends', 'plan to record one']) expect(t.toLowerCase()).not.toContain(bad);
  });
  it('B1 alone never claims a list', () => {
    expect(renderPromptNudge(['b1'], { branch: 'b', newEntries: 4, staleCommits: [c(1)] })).not.toContain('next session sees');
  });
});

describe('decidePromptNudge — trigger and cadence (ADR-0084 §2.2, §2.5)', () => {
  it('emits the stale line when the pin is stale and nothing is stored', () => {
    const d = decidePromptNudge(typed, ctx(), undefined);
    expect(d).toEqual({ emit: true, text: STALE_TEXT + COND, reasons: ['stale'], key: `${ctx().key}|stale` });
  });
  it('the four-way reason table', () => {
    expect(decidePromptNudge(typed, ctx({ stale: false, b1: false }), undefined).emit).toBe(false);
    const s = decidePromptNudge(typed, ctx({ stale: true, b1: false }), undefined);
    const b = decidePromptNudge(typed, ctx({ stale: false, b1: true, newEntries: 4 }), undefined);
    const both = decidePromptNudge(typed, ctx({ stale: true, b1: true, newEntries: 4 }), undefined);
    expect(s.emit && s.reasons).toEqual(['stale']);
    expect(b.emit && b.reasons).toEqual(['b1']);
    expect(both.emit && both.reasons).toEqual(['stale', 'b1']);
  });
  it('stale without a pin cannot be stated, so it is not a reason', () => {
    expect(decidePromptNudge(typed, ctx({ pin: undefined }), undefined).emit).toBe(false);
  });
  it('the same key does not re-emit (ADR-0085: base plus the delivered reason set)', () => {
    expect(decidePromptNudge(typed, ctx(), `${ctx().key}|stale`)).toEqual({ emit: false, why: 'same-key' });
  });
  it('a moved HEAD re-emits', () => {
    expect(decidePromptNudge(typed, ctx({ key: promptNudgeKey(pin, 'def456') }), ctx().key).emit).toBe(true);
  });
  it('a changed pin id or created re-emits', () => {
    const k1 = promptNudgeKey({ ...pin, id: 'other' }, 'abc123');
    const k2 = promptNudgeKey({ ...pin, created: '2026-10-28T00:00:00.000Z' }, 'abc123');
    expect(decidePromptNudge(typed, ctx({ key: k1 }), ctx().key).emit).toBe(true);
    expect(decidePromptNudge(typed, ctx({ key: k2 }), ctx().key).emit).toBe(true);
  });
  it('ADR-0085 §4: a reason that DISAPPEARS under the same base does not re-emit', () => {
    expect(decidePromptNudge(typed, ctx({ stale: true, b1: false }), `${ctx().key}|b1+stale`)).toEqual({
      emit: false,
      why: 'same-key',
    });
  });
  it('ADR-0085 §4: a NEWLY TRUE reason under the same base re-emits, and the key carries the union', () => {
    const d = decidePromptNudge(typed, ctx({ stale: true, b1: true, newEntries: 5 }), `${ctx().key}|stale`);
    expect(d.emit && d.reasons).toEqual(['stale', 'b1']);
    expect(d.emit && d.key).toBe(`${ctx().key}|b1+stale`);
    // a reason swap (stale → b1) is a new reason too
    const swap = decidePromptNudge(typed, ctx({ stale: false, b1: true, newEntries: 5 }), `${ctx().key}|stale`);
    expect(swap.emit && swap.key).toBe(`${ctx().key}|b1+stale`);
  });
  it('ADR-0085 §4: a changed base re-emits with only the current reasons in the key', () => {
    const d = decidePromptNudge(typed, ctx({ key: promptNudgeKey(pin, 'def456') }), `${ctx().key}|b1+stale`);
    expect(d.emit && d.key).toBe(`${promptNudgeKey(pin, 'def456')}|stale`);
  });
  it('ADR-0085 §4: an old three-part stored key re-emits once (then the four-part key holds)', () => {
    const d = decidePromptNudge(typed, ctx(), ctx().key);
    expect(d.emit).toBe(true);
    expect(decidePromptNudge(typed, ctx(), d.emit ? d.key : undefined)).toEqual({ emit: false, why: 'same-key' });
  });
  it('no stored key (ephemeral / failed save) emits every time the trigger holds', () => {
    for (let i = 0; i < 3; i++) expect(decidePromptNudge(typed, ctx({ persisted: false }), undefined).emit).toBe(true);
  });
  it('promptNudgeKey is (pin id, created, HEAD) with placeholders for absent parts', () => {
    expect(promptNudgeKey(pin, 'abc')).toBe('c708f71279b6|2026-10-27T07:36:12.345Z|abc');
    expect(promptNudgeKey(undefined, 'abc')).toBe('-|-|abc');
  });
  it('ADR-0085 §4: with reasons, the key gains the sorted reason set as a fourth part', () => {
    expect(promptNudgeKey(pin, 'abc', ['stale', 'no-autocommit', 'b1'])).toBe(
      'c708f71279b6|2026-10-27T07:36:12.345Z|abc|b1+no-autocommit+stale',
    );
  });
});

describe('decidePromptNudge — Q2: never on a persisted session\'s first prompt', () => {
  it('persisted + turn 0 → no line (one-shot headless runs are not invited to displace the pin)', () => {
    expect(decidePromptNudge(typed, ctx({ turn: 0 }), undefined)).toEqual({ emit: false, why: 'first-prompt' });
  });
  it('persisted + turn 1 with the same trigger → emits (the skip consumed nothing)', () => {
    expect(decidePromptNudge(typed, ctx({ turn: 1 }), undefined).emit).toBe(true);
  });
  it('ephemeral (no session id) at turn 0 → emits (no turn info, fail open)', () => {
    expect(decidePromptNudge(typed, ctx({ persisted: false, turn: 0 }), undefined).emit).toBe(true);
  });
  it('an invalid turn on a persisted session → emits (no turn info)', () => {
    for (const turn of [undefined, NaN, -1, '0' as unknown as number]) {
      expect(decidePromptNudge(typed, ctx({ turn }), undefined).emit, `turn=${String(turn)}`).toBe(true);
    }
  });
});

describe('decidePromptNudge — harness-generated turns never emit (ADR-0084 §2.6)', () => {
  it('each allowlisted lead-in at column 0 is skipped', () => {
    for (const l of HARNESS_PROMPT_LEADINS) {
      expect(decidePromptNudge({ prompt: `${l} rest of it` }, ctx(), undefined)).toEqual({ emit: false, why: 'harness-turn' });
    }
  });
});

describe('isHarnessPrompt (shared with v3 R1)', () => {
  it('pins the allowlist', () => {
    expect([...HARNESS_PROMPT_LEADINS]).toEqual([
      '<task-notification>',
      'Another Claude session sent a message:',
      'Your claude.ai usage limit has reset',
    ]);
  });
  it('matches each lead-in at column 0', () => {
    expect(isHarnessPrompt('<task-notification>\n<task-id>x</task-id>')).toBe(true);
    expect(isHarnessPrompt('Another Claude session sent a message: hi')).toBe(true);
    expect(isHarnessPrompt('Your claude.ai usage limit has reset. Continue.')).toBe(true);
  });
  it('typed shapes are not skipped', () => {
    for (const p of ['<pasted_content id="1">x</pasted_content>', '/review 12', '[Image #1] what is this', 'plain text', '', undefined, null, 42, {}]) {
      expect(isHarnessPrompt(p), JSON.stringify(p)).toBe(false);
    }
  });
  it('leading whitespace is NOT skipped (documented: column 0 only)', () => {
    expect(isHarnessPrompt(' <task-notification>')).toBe(false);
    expect(isHarnessPrompt('\n<task-notification>')).toBe(false);
  });
});

// ── vfkb#387 decide Q8: 1e's once-per-session quiet survives compaction ──────────────
// The compact reset (ADR-0084 §2.5) clears only the prompt line's key; the delivery turn
// it folds into Stop's B3 mark survives, so B3 stays quiet for the session while the
// cheap surface (the prompt line) re-arms. Can fail both ways.

describe('compaction (decide Q8): the prompt line re-arms, B3 stays quiet for the session', () => {
  const S = [{ hash: 'a'.repeat(40), short: 'aaaaaaa', subject: 'fix: x' }];
  const N = 4;
  const setup = () => {
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-q8-'));
    const key = promptNudgeKey(pin, 'abc123');
    writePromptNudgeSignal(brain, 'sess', { key, staleAtTurn: N });
    clearPromptNudgeKey(brain, 'sess'); // SessionStart source=compact
    return { brain, key };
  };

  it('the key is cleared and staleAtTurn kept', () => {
    const { brain } = setup();
    const sig = readPromptNudgeSignal(brain, 'sess');
    expect(sig.key).toBeUndefined();
    expect(sig.staleAtTurn).toBe(N);
  });

  it('Stop B3 stays quiet at N+1, N+11 and N+50 on the kept delivery turn', () => {
    const { brain } = setup();
    const staleHandoff = readPromptNudgeSignal(brain, 'sess').staleAtTurn;
    for (const turn of [N + 1, N + 11, N + 50]) {
      expect(
        decideStop(
          { stop_hook_active: false },
          { uncommittedWork: false, newDecisions: 1, staleCommits: S, pin, turn, lastNudged: { staleHandoff } },
        ),
        `turn=${turn}`,
      ).toEqual({ block: false });
    }
  });

  it('the negative: after the clear, the same key re-emits the prompt line', () => {
    const { brain, key } = setup();
    const d = decidePromptNudge(typed, ctx({ key }), readPromptNudgeSignal(brain, 'sess').key);
    expect(d.emit).toBe(true);
  });
});

// ── ADR-0085 (vfkb#395): the third reason, no-autocommit ─────────────────────────────
// ADR-0033's default-branch / detached-HEAD warning, rerouted from SessionEnd's discarded
// systemMessage. Decide Q1 (one reason), Q2 (SessionEnd's outcome), Q3 (wording).

const THIRD_MAIN = 'the brain has 2 uncommitted entries on main, which SessionEnd will not auto-commit (it commits only on a topic branch)';
const COND_UNCOMMITTED =
  ' If this prompt ends the session, committing .vfkb/entries.jsonl on a topic branch is worth doing before finishing; ' +
  'otherwise nothing is needed now.';
const COND_BOTH =
  ' If this prompt ends the session, two things are worth doing before finishing: a fresh handoff/next entry ' +
  '(kb_add type=fact, tags=handoff,next, role=human) naming what changed and what is next, then committing ' +
  '.vfkb/entries.jsonl on a topic branch; otherwise nothing is needed now.';

describe('renderPromptNudge — the no-autocommit clause (ADR-0085 §3)', () => {
  it('alone, on the default branch', () => {
    expect(renderPromptNudge(['no-autocommit'], { branch: 'main', newEntries: 2 })).toBe(
      `vfkb handoff status: ${THIRD_MAIN}.${COND_UNCOMMITTED}`,
    );
  });
  it('alone, singular, on a detached HEAD (decide Q1: one reason, two renderings)', () => {
    expect(renderPromptNudge(['no-autocommit'], { branch: null, newEntries: 1 })).toBe(
      'vfkb handoff status: the brain has 1 uncommitted entry on a detached HEAD, which SessionEnd will not auto-commit ' +
        `(it commits only on a topic branch).${COND_UNCOMMITTED}`,
    );
  });
  it('with stale: stale clause first, then the third; the two-things conditional', () => {
    expect(renderPromptNudge(['stale', 'no-autocommit'], { pin, branch: 'main', newEntries: 2 })).toBe(
      'vfkb handoff status: the pinned handoff (c708f71279b6, 2026-10-27) predates a later commit on main; ' +
        `${THIRD_MAIN}.${COND_BOTH}`,
    );
  });
  it('with b1: b1 clause, then the third', () => {
    expect(renderPromptNudge(['b1', 'no-autocommit'], { branch: 'main', newEntries: 2 })).toBe(
      'vfkb handoff status: this session has recorded 2 entries and no handoff/next entry; ' + `${THIRD_MAIN}.${COND_BOTH}`,
    );
  });
  it('with a listed stale clause: the listed suffix closes the two-things conditional', () => {
    const c1 = { hash: '1'.repeat(40), short: '1111111', subject: 'fix: one' };
    const t = renderPromptNudge(['stale', 'no-autocommit'], { pin, branch: 'main', newEntries: 2, staleCommits: [c1] });
    expect(t.endsWith(`${COND_BOTH.replace(/\.$/, '')} — the next session sees this same list at start.`)).toBe(true);
  });
  it('every shape: exactly one "If ", none of the forbidden phrases', () => {
    for (const r of [['no-autocommit'], ['stale', 'no-autocommit'], ['b1', 'no-autocommit'], ['stale', 'b1', 'no-autocommit']] as const) {
      const t = renderPromptNudge([...r], { pin, branch: 'main', newEntries: 3 });
      expect(t.split('If ').length - 1, r.join('+')).toBe(1);
      expect(t.startsWith(PROMPT_NUDGE_LEADIN)).toBe(true);
      for (const bad of ['must', 'before the session ends', 'plan to record one']) expect(t.toLowerCase()).not.toContain(bad);
    }
  });
  it('regression: stale / b1 without the third reason stay byte-identical to ADR-0084', () => {
    expect(renderPromptNudge(['stale'], { pin, branch: 'feat/x', newEntries: 0 })).toBe(STALE_TEXT + COND);
    expect(renderPromptNudge(['b1'], { branch: 'feat/x', newEntries: 4 })).toBe(B1_TEXT + COND);
  });
});

describe('decidePromptNudge — the no-autocommit reason (ADR-0085 §1)', () => {
  const quiet = { stale: false, b1: false, branch: 'main', newEntries: 2 };
  it('on-default-branch with ≥ 1 new id → [no-autocommit]', () => {
    const d = decidePromptNudge(typed, ctx({ ...quiet, commitOutcome: 'on-default-branch' }), undefined);
    expect(d.emit && d.reasons).toEqual(['no-autocommit']);
    expect(d.emit && d.text).toBe(`vfkb handoff status: ${THIRD_MAIN}.${COND_UNCOMMITTED}`);
  });
  it('detached-head with ≥ 1 new id → [no-autocommit], detached wording', () => {
    const d = decidePromptNudge(typed, ctx({ ...quiet, branch: null, commitOutcome: 'detached-head' }), undefined);
    expect(d.emit && d.reasons).toEqual(['no-autocommit']);
    expect(d.emit && d.text).toContain('uncommitted entries on a detached HEAD');
  });
  it('can fail: a topic branch, not-a-repo, a clean brain, an unknown outcome or 0 new ids → no reason', () => {
    for (const commitOutcome of ['topic', 'not-a-repo', 'brain-clean', undefined] as const) {
      expect(decidePromptNudge(typed, ctx({ ...quiet, commitOutcome }), undefined).emit, String(commitOutcome)).toBe(false);
    }
    expect(decidePromptNudge(typed, ctx({ ...quiet, newEntries: 0, commitOutcome: 'on-default-branch' }), undefined).emit).toBe(false);
  });
  it('reason order is stale, b1, no-autocommit', () => {
    const d = decidePromptNudge(typed, ctx({ stale: true, b1: true, branch: 'main', newEntries: 3, commitOutcome: 'on-default-branch' }), undefined);
    expect(d.emit && d.reasons).toEqual(['stale', 'b1', 'no-autocommit']);
  });
  it('cadence: {stale} delivered, then no-autocommit becomes true under the same base → re-emits once', () => {
    const k = `${ctx().key}|stale`;
    const c = ctx({ stale: true, branch: 'main', newEntries: 1, commitOutcome: 'on-default-branch' });
    const d = decidePromptNudge(typed, c, k);
    expect(d.emit && d.reasons).toEqual(['stale', 'no-autocommit']);
    expect(d.emit && d.key).toBe(`${ctx().key}|no-autocommit+stale`);
    expect(decidePromptNudge(typed, c, d.emit ? d.key : undefined)).toEqual({ emit: false, why: 'same-key' });
  });
});
