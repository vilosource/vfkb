// ADR-0084 §2 / vfkb#385: the non-blocking UserPromptSubmit handoff line — the pure core.
// The wording is pinned here (§2.4), the cadence key (§2.5), the harness-turn skip (§2.6)
// and the decide step's Q2 (no line on a persisted session's first prompt) and Q9
// (placeholder fallbacks). Each `it` was observed RED before src/prompt-nudge.ts existed.
import { describe, it, expect } from 'vitest';
import {
  decidePromptNudge,
  renderPromptNudge,
  promptNudgeKey,
  PROMPT_NUDGE_LEADIN,
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
    expect(d).toEqual({ emit: true, text: STALE_TEXT + COND, reasons: ['stale'], key: ctx().key });
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
  it('the same key does not re-emit', () => {
    expect(decidePromptNudge(typed, ctx(), ctx().key)).toEqual({ emit: false, why: 'same-key' });
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
  it('a reason-only change does not re-emit', () => {
    expect(decidePromptNudge(typed, ctx({ stale: false, b1: true, newEntries: 5 }), ctx().key).emit).toBe(false);
  });
  it('no stored key (ephemeral / failed save) emits every time the trigger holds', () => {
    for (let i = 0; i < 3; i++) expect(decidePromptNudge(typed, ctx({ persisted: false }), undefined).emit).toBe(true);
  });
  it('promptNudgeKey is (pin id, created, HEAD) with placeholders for absent parts', () => {
    expect(promptNudgeKey(pin, 'abc')).toBe('c708f71279b6|2026-10-27T07:36:12.345Z|abc');
    expect(promptNudgeKey(undefined, 'abc')).toBe('-|-|abc');
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
