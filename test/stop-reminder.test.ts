import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  decideStop,
  handoffIsStale,
  handoffNudgeDue,
  STOP_REMINDER,
  HANDOFF_MIN_ENTRIES,
  renderStaleHandoffReminder,
  STALE_HANDOFF_LEADIN,
  STALE_HANDOFF_NEXT_SESSION,
  NUDGE_COOLDOWN_TURNS,
  STALE_HANDOFF_MIN_TURN,
  isPausedStop,
} from '../src/stop-reminder.js';

import { COMMITS_SINCE_SLICE_CHARS, renderCommitsSince, type StaleCommit } from '../src/engine.js';

const CLI = resolve(__dirname, '../dist/cli.js');

// B3's text is built from Part 0's set S since #386 (RFC-043 Part 1, second half).
const PIN = { id: 'p1aa', created: '2026-01-02T00:00:00.000Z' };
const S1: StaleCommit[] = [{ hash: 'a'.repeat(40), short: 'aaaaaaa', subject: 'fix: a thing (#9)' }];
const STALE_HANDOFF_REMINDER = renderStaleHandoffReminder(PIN, S1);

// ── pure core: the deterministic backstop (RFC-008 / ADR-0027) ───────────────
describe('decideStop — conditional end-of-turn reminder', () => {
  it('blocks with the reminder when work happened AND no decision was recorded', () => {
    const d = decideStop({ stop_hook_active: false }, { uncommittedWork: true, newDecisions: 0 });
    expect(d).toEqual({ block: true, reminder: STOP_REMINDER, fired: ['decision'] });
  });

  it('does NOT block when a decision was already recorded this session', () => {
    expect(decideStop({ stop_hook_active: false }, { uncommittedWork: true, newDecisions: 1 })).toEqual({
      block: false,
    });
  });

  it('does NOT block when no substantive work happened', () => {
    expect(decideStop({ stop_hook_active: false }, { uncommittedWork: false, newDecisions: 0 })).toEqual({
      block: false,
    });
  });

  it('native loop guard: never blocks our own re-entry (stop_hook_active=true)', () => {
    // even with the would-block context, the guard wins — or it nags forever.
    expect(decideStop({ stop_hook_active: true }, { uncommittedWork: true, newDecisions: 0 })).toEqual({
      block: false,
    });
  });

  it('fail-open on an empty/malformed input object', () => {
    expect(decideStop({}, { uncommittedWork: false, newDecisions: 0 })).toEqual({ block: false });
  });
});

// ── B1 leaves Stop (ADR-0084 §1.6): its standing reminder rides the next prompt ─
describe('decideStop — B1 never fires on Stop (ADR-0084 §1.6)', () => {
  const b1 = { uncommittedWork: true, newDecisions: 1, newEntries: HANDOFF_MIN_ENTRIES + 5, newHandoffs: 0 };

  it("B1's condition holds and Stop does NOT block (no handoff text)", () => {
    for (const turn of [undefined, 1, 3, 50]) {
      expect(decideStop({ stop_hook_active: false }, { ...b1, turn, lastNudged: {} }), `turn=${turn}`).toEqual({
        block: false,
      });
    }
  });

  it('with the decision nudge also triggered, only the decision text fires', () => {
    const d = decideStop({ stop_hook_active: false }, { ...b1, newDecisions: 0 });
    expect(d).toEqual({ block: true, reminder: STOP_REMINDER, fired: ['decision'] });
    if (d.block) expect(d.reminder).not.toContain('vfkb handoff check');
  });
});

// ── B3: the stale-handoff nudge (pragmatic patch, built NOT yet verified) ────
// ── B1's trigger, re-homed (ADR-0084 §1.6 moved its TEXT to the prompt line; the trigger
// and threshold are unchanged). These are the negative cases the Stop-side B1 tests used to
// carry: each one goes red when its clause is dropped from handoffNudgeDue.
describe('handoffNudgeDue — the B1 trigger (RFC-011 §B, unchanged by ADR-0084 §1.6)', () => {
  const due = { uncommittedWork: true, newEntries: HANDOFF_MIN_ENTRIES, newHandoffs: 0 };

  it('due at exactly the threshold with uncommitted work and no handoff recorded', () => {
    expect(handoffNudgeDue(due)).toBe(true);
  });

  it('NOT due below the entry threshold (weak signal → the SessionEnd floor handles it)', () => {
    expect(handoffNudgeDue({ ...due, newEntries: HANDOFF_MIN_ENTRIES - 1 })).toBe(false);
    expect(handoffNudgeDue({ ...due, newEntries: 0 })).toBe(false);
  });

  it('self-silences once a handoff/next entry exists this session', () => {
    expect(handoffNudgeDue({ ...due, newEntries: HANDOFF_MIN_ENTRIES + 5, newHandoffs: 1 })).toBe(false);
  });

  it('NOT due when no substantive work happened (even with entries)', () => {
    expect(handoffNudgeDue({ ...due, uncommittedWork: false, newEntries: 9 })).toBe(false);
  });
});

describe('decideStop — stale-handoff nudge', () => {
  it('blocks with the stale-handoff reminder when S is non-empty', () => {
    const d = decideStop(
      { stop_hook_active: false },
      { uncommittedWork: false, newDecisions: 1, newEntries: 0, newHandoffs: 0, staleCommits: S1, pin: PIN },
    );
    expect(d).toEqual({ block: true, reminder: STALE_HANDOFF_REMINDER, fired: ['staleHandoff'] });
  });

  it('is NOT gated on uncommittedWork — the defining case is a clean tree', () => {
    // everything already committed/merged, working tree clean, pin still stale
    const d = decideStop(
      { stop_hook_active: false },
      { uncommittedWork: false, newDecisions: 1, staleCommits: S1, pin: PIN },
    );
    expect(d.block).toBe(true);
  });

  it('does NOT block when S is empty/absent', () => {
    expect(
      decideStop({ stop_hook_active: false }, { uncommittedWork: false, newDecisions: 1, staleCommits: [] }),
    ).toEqual({ block: false });
    expect(decideStop({ stop_hook_active: false }, { uncommittedWork: false, newDecisions: 1 })).toEqual({
      block: false,
    });
  });

  it('composes with the decision nudge when B1, B3 and the decision trigger all hold (B1 stays off Stop)', () => {
    const d = decideStop(
      { stop_hook_active: false },
      { uncommittedWork: true, newDecisions: 0, newEntries: HANDOFF_MIN_ENTRIES, newHandoffs: 0, staleCommits: S1, pin: PIN },
    );
    expect(d).toEqual({ block: true, reminder: `${STOP_REMINDER}\n\n${STALE_HANDOFF_REMINDER}`, fired: ['decision', 'staleHandoff'] });
  });

  it('native loop guard still wins over the stale-handoff trigger', () => {
    expect(
      decideStop({ stop_hook_active: true }, { uncommittedWork: false, newDecisions: 1, staleCommits: S1, pin: PIN }),
    ).toEqual({ block: false });
  });
});

// ── nudge cooldown (operator ruling 2026-07-31): rate-limit every nudge type ──
describe('decideStop — per-nudge cooldown', () => {
  // The decision-nudge trigger held: uncommitted work, no decision recorded.
  const trigger = { uncommittedWork: true, newDecisions: 0 };

  it('fires when the nudge has never fired this session (lastNudged empty)', () => {
    const d = decideStop({ stop_hook_active: false }, { ...trigger, turn: 5, lastNudged: {} });
    expect(d).toEqual({ block: true, reminder: STOP_REMINDER, fired: ['decision'] });
  });

  it('stays quiet while inside the cooldown window, even though the trigger still holds', () => {
    const d = decideStop(
      { stop_hook_active: false },
      { ...trigger, turn: NUDGE_COOLDOWN_TURNS, lastNudged: { decision: 1 } }, // turn-last = N-1 < N
    );
    expect(d).toEqual({ block: false });
  });

  it('fires again once the cooldown window has elapsed', () => {
    const d = decideStop(
      { stop_hook_active: false },
      { ...trigger, turn: 1 + NUDGE_COOLDOWN_TURNS, lastNudged: { decision: 1 } }, // turn-last = N
    );
    expect(d).toEqual({ block: true, reminder: STOP_REMINDER, fired: ['decision'] });
  });

  it('cooldowns are independent per nudge type: a cooling decision nudge does not mute B3', () => {
    const d = decideStop(
      { stop_hook_active: false },
      {
        uncommittedWork: true,
        newDecisions: 0, // decision trigger holds, but cooling
        newEntries: HANDOFF_MIN_ENTRIES,
        newHandoffs: 0, // B1 trigger holds, never fired
        staleCommits: S1, pin: PIN, // B3 trigger holds, never fired
        turn: 3,
        lastNudged: { decision: 2 },
      },
    );
    expect(d.block).toBe(true);
    if (d.block) {
      expect(d.fired).toEqual(['staleHandoff']);
      expect(d.reminder).toBe(STALE_HANDOFF_REMINDER);
    }
  });

  it('falls back to firing when session turn info is unavailable (fail-open toward reminding)', () => {
    // no `turn` → the window cannot be computed, even with a recorded last-fired turn
    const d = decideStop({ stop_hook_active: false }, { ...trigger, lastNudged: { decision: 1 } });
    expect(d).toEqual({ block: true, reminder: STOP_REMINDER, fired: ['decision'] });
  });

  it('pins the ruling: the cooldown window is 10 turns', () => {
    // The operator ruling names 10 (brain decision ba74ec9a44e5). Deriving test inputs
    // from the constant means no other test notices the constant itself changing.
    expect(NUDGE_COOLDOWN_TURNS).toBe(10);
  });

  // Codex review (PR #272): each nudge KEY must be rate-limited — a mutation that drops
  // the check for only one key must go red, not hide behind the decision-key tests. Since
  // ADR-0084 §1.5 (1e, vfkb#387) the stale key's window is the rest of the session.
  it('the stale-handoff nudge itself stays quiet once fired (1e: for the session, not 10 turns)', () => {
    const ctx = { uncommittedWork: false, newDecisions: 1, staleCommits: S1, pin: PIN };
    for (const turn of [5, 4 + NUDGE_COOLDOWN_TURNS, 50]) {
      expect(
        decideStop({ stop_hook_active: false }, { ...ctx, turn, lastNudged: { staleHandoff: 4 } }),
        `turn=${turn}`,
      ).toEqual({ block: false });
    }
  });

  // Codex review (PR #272): the session record is parsed JSON with no upstream runtime
  // validation — a malformed-but-parseable last-fired value must fail OPEN (fire), never
  // read as "cooling". Coercive subtraction would otherwise silence the nudge for e.g.
  // ~a million turns on {decision: 999999}.
  it('malformed last-fired values fail open (fire), never cool', () => {
    const bad = [
      999999, // a "future" turn far beyond the current one
      -5, // negative
      Infinity,
      NaN,
      '1000' as unknown as number, // string — would coerce in a bare subtraction
      null as unknown as number,
      true as unknown as number,
    ];
    for (const value of bad) {
      const d = decideStop({ stop_hook_active: false }, { ...trigger, turn: 2, lastNudged: { decision: value } });
      expect(d, `lastNudged.decision=${String(value)}`).toEqual({
        block: true,
        reminder: STOP_REMINDER,
        fired: ['decision'],
      });
    }
  });

  it('a malformed turn also fails open rather than cooling', () => {
    const d = decideStop(
      { stop_hook_active: false },
      { ...trigger, turn: NaN as unknown as number, lastNudged: { decision: 1 } },
    );
    expect(d).toEqual({ block: true, reminder: STOP_REMINDER, fired: ['decision'] });
  });
});

// ── ADR-0084 §1.5 (1e, vfkb#387): B3 fires at most once per session ─────────
describe('decideStop — 1e: B3 at most once per session (ADR-0084 §1.5)', () => {
  const stale = { uncommittedWork: false, newDecisions: 1, staleCommits: S1, pin: PIN };
  const fires = { block: true, reminder: STALE_HANDOFF_REMINDER, fired: ['staleHandoff'] };

  it('RED on main: quiet at turn 50 after a Stop fire at turn 4 (the 10-turn cooldown would re-fire)', () => {
    expect(decideStop({ stop_hook_active: false }, { ...stale, turn: 50, lastNudged: { staleHandoff: 4 } })).toEqual({
      block: false,
    });
  });

  it('RED on main: quiet for the session when the key came from the folded prompt-line turn', () => {
    // cli.ts folds the UserPromptSubmit signal's staleAtTurn into lastNudged.staleHandoff
    // (ADR-0084 §2.5); decideStop cannot tell the two sources apart, by design.
    for (const turn of [7, 17, 120]) {
      expect(
        decideStop({ stop_hook_active: false }, { ...stale, turn, lastNudged: { staleHandoff: 6 } }),
        `turn=${turn}`,
      ).toEqual({ block: false });
    }
  });

  it('a same-turn mark is "set" (inclusive upper bound): staleHandoff 6 at turn 6 is quiet', () => {
    expect(decideStop({ stop_hook_active: false }, { ...stale, turn: 6, lastNudged: { staleHandoff: 6 } })).toEqual({
      block: false,
    });
  });

  it('a future-dated key is not a fire record: staleHandoff 7 at turn 6 fires', () => {
    expect(decideStop({ stop_hook_active: false }, { ...stale, turn: 6, lastNudged: { staleHandoff: 7 } })).toEqual(
      fires,
    );
  });

  it('malformed staleHandoff values fail open (fire), never silence', () => {
    const bad = [999999, -5, Infinity, NaN, '1000' as unknown as number, null as unknown as number, true as unknown as number];
    for (const value of bad) {
      expect(
        decideStop({ stop_hook_active: false }, { ...stale, turn: 5, lastNudged: { staleHandoff: value } }),
        `lastNudged.staleHandoff=${String(value)}`,
      ).toEqual(fires);
    }
  });

  it('no turn (an ephemeral session) with the key set still fires (brain b4b3cf62f119)', () => {
    for (const turn of [undefined, NaN]) {
      expect(
        decideStop({ stop_hook_active: false }, { ...stale, turn, lastNudged: { staleHandoff: 3 } }),
        `turn=${String(turn)}`,
      ).toEqual(fires);
    }
  });

  it('1e touches only B3: the decision nudge keeps its 10-turn cooldown', () => {
    const d = decideStop(
      { stop_hook_active: false },
      { uncommittedWork: true, newDecisions: 0, turn: 11, lastNudged: { decision: 1, staleHandoff: 1 } },
    );
    expect(d).toEqual({ block: true, reminder: STOP_REMINDER, fired: ['decision'] });
  });
});

// ── ADR-0084 §1.4 (1c, vfkb#387): no B3 on the default branch with nothing to commit ─
describe('decideStop — 1c: B3 quiet on the default branch, clean tree, no new entries (ADR-0084 §1.4)', () => {
  const base = {
    uncommittedWork: false,
    newDecisions: 0,
    newEntries: 0,
    staleCommits: S1,
    pin: PIN,
    turn: 5,
    lastNudged: {},
  };
  const fires = { block: true, reminder: STALE_HANDOFF_REMINDER, fired: ['staleHandoff'] };

  it('RED on main: default branch + clean tree + no new entries → quiet', () => {
    expect(decideStop({ stop_hook_active: false }, { ...base, onDefaultBranch: () => true })).toEqual({ block: false });
  });

  it('can-fail rows: each broken precondition leaves B3 firing', () => {
    const rows: Array<[string, Record<string, unknown>]> = [
      ['newEntries: 1', { newEntries: 1, newDecisions: 1, onDefaultBranch: () => true }],
      ['newEntries undefined', { newEntries: undefined, onDefaultBranch: () => true }],
      ['probe returns false (topic branch)', { onDefaultBranch: () => false }],
      [
        'probe throws',
        {
          onDefaultBranch: () => {
            throw new Error('git wedged');
          },
        },
      ],
      ['probe absent', {}],
    ];
    for (const [label, over] of rows) {
      expect(decideStop({ stop_hook_active: false }, { ...base, ...over }), label).toEqual(fires);
    }
  });

  it('can-fail row: uncommitted work on the default branch → B3 fires (alongside the decision nudge)', () => {
    const d = decideStop({ stop_hook_active: false }, { ...base, uncommittedWork: true, onDefaultBranch: () => true });
    expect(d.block).toBe(true);
    if (d.block) expect(d.fired).toEqual(['decision', 'staleHandoff']);
  });

  it('the decision nudge ignores the branch probe: it still fires on the default branch', () => {
    // The decision nudge needs uncommittedWork, which itself breaks 1c's clean-tree clause, so
    // the two can never both apply; this row pins only that a true probe does not reach the
    // decision key (with S empty, B3 is out of the picture).
    const d = decideStop(
      { stop_hook_active: false },
      { ...base, uncommittedWork: true, staleCommits: [], onDefaultBranch: () => true },
    );
    expect(d).toEqual({ block: true, reminder: STOP_REMINDER, fired: ['decision'] });
  });

  it('lazy: the probe is NOT called when 1a, 1e, an empty S or a paused stop already silence B3', () => {
    const spy = () => {
      throw new Error('probe must not run');
    };
    let calls = 0;
    const counting = () => {
      calls++;
      return spy();
    };
    const cases: Array<[string, object, object]> = [
      ['1a (turn 2)', {}, { turn: 2 }],
      ['1e (already fired)', {}, { lastNudged: { staleHandoff: 4 } }],
      ['empty S', {}, { staleCommits: [] }],
      ['paused stop', { background_tasks: [{ id: 't' }] }, {}],
    ];
    for (const [label, input, over] of cases) {
      expect(
        decideStop({ stop_hook_active: false, ...input }, { ...base, ...over, onDefaultBranch: counting }),
        label,
      ).toEqual({ block: false });
    }
    expect(calls).toBe(0);
  });
});

// ── ADR-0084 §1.1 (1a): B3 is quiet before turn 3 ────────────────────────────
describe('decideStop — B3 not before turn 3 (ADR-0084 §1.1)', () => {
  const stale = { uncommittedWork: false, newDecisions: 1, staleCommits: S1, pin: PIN };
  const all = {
    uncommittedWork: true,
    newDecisions: 0,
    newEntries: HANDOFF_MIN_ENTRIES,
    newHandoffs: 0,
    staleCommits: S1, pin: PIN,
  };

  it('pins the threshold: B3 first eligible at turn 3', () => {
    expect(STALE_HANDOFF_MIN_TURN).toBe(3);
  });

  it('B3 is quiet at turn 1 and turn 2 even though its trigger holds', () => {
    for (const turn of [1, 2]) {
      expect(decideStop({ stop_hook_active: false }, { ...stale, turn, lastNudged: {} }), `turn=${turn}`).toEqual({
        block: false,
      });
    }
  });

  it('B3 fires at turn 3 (over-silencing guard)', () => {
    expect(decideStop({ stop_hook_active: false }, { ...stale, turn: 3, lastNudged: {} })).toEqual({
      block: true,
      reminder: STALE_HANDOFF_REMINDER,
      fired: ['staleHandoff'],
    });
  });

  it('1a touches only B3: the decision nudge still fires at turn 1', () => {
    const d = decideStop({ stop_hook_active: false }, { ...all, turn: 1, lastNudged: {} });
    expect(d.block).toBe(true);
    if (d.block) {
      expect(d.fired).toEqual(['decision']);
      expect(d.reminder).not.toContain(STALE_HANDOFF_REMINDER);
    }
  });

  it("an invalid turn fails open: B3 fires (today's behaviour)", () => {
    const bad = [undefined, NaN, Infinity, '1' as unknown as number, null as unknown as number];
    for (const turn of bad) {
      expect(decideStop({ stop_hook_active: false }, { ...stale, turn }), `turn=${String(turn)}`).toEqual({
        block: true,
        reminder: STALE_HANDOFF_REMINDER,
        fired: ['staleHandoff'],
      });
    }
  });
});

// ── ADR-0084 §1.2 (1b): a paused stop defers every nudge ─────────────────────
describe('decideStop — paused stop defers all nudges (ADR-0084 §1.2)', () => {
  const all = {
    uncommittedWork: true,
    newDecisions: 0,
    newEntries: HANDOFF_MIN_ENTRIES,
    newHandoffs: 0,
    staleCommits: S1, pin: PIN,
    turn: 5,
    lastNudged: {},
  };
  const firesAll = (d: ReturnType<typeof decideStop>, label: string) => {
    expect(d.block, label).toBe(true);
    if (d.block) expect(d.fired, label).toEqual(['decision', 'staleHandoff']);
  };

  it('non-empty background_tasks → {block:false}', () => {
    expect(decideStop({ stop_hook_active: false, background_tasks: [{}] }, all)).toEqual({ block: false });
  });

  it('non-empty session_crons → {block:false}', () => {
    expect(decideStop({ stop_hook_active: false, session_crons: [{}] }, all)).toEqual({ block: false });
  });

  it('absent / null / non-array / empty → today (fires decision + B3)', () => {
    const values: unknown[] = [[], undefined, null, 'x', {}, 0];
    for (const v of values) {
      firesAll(decideStop({ stop_hook_active: false, background_tasks: v }, all), `background_tasks=${JSON.stringify(v)}`);
      firesAll(decideStop({ stop_hook_active: false, session_crons: v }, all), `session_crons=${JSON.stringify(v)}`);
    }
    firesAll(decideStop({ stop_hook_active: false, background_tasks: [], session_crons: [] }, all), 'both empty');
  });

  it('stop_hook_active still wins over a paused payload', () => {
    expect(decideStop({ stop_hook_active: true, background_tasks: [{}] }, all)).toEqual({ block: false });
  });

  it('isPausedStop is the single predicate', () => {
    expect(isPausedStop({ background_tasks: [{ id: 't' }] })).toBe(true);
    expect(isPausedStop({ session_crons: [{ id: 'c' }] })).toBe(true);
    expect(isPausedStop({ background_tasks: [], session_crons: [] })).toBe(false);
    expect(isPausedStop({ background_tasks: 'x', session_crons: { length: 1 } })).toBe(false);
    expect(isPausedStop({})).toBe(false);
    expect(isPausedStop(undefined as unknown as object)).toBe(false);
  });
});

// ── ADR-0084 §1.3 (1d) + RFC-043 Part 1 second half (#386; decide D4) ─────────
describe('the B3 Stop text', () => {
  const many: StaleCommit[] = Array.from({ length: 9 }, (_, i) => ({
    hash: `${i}`.repeat(40),
    short: `${i}`.repeat(7),
    subject: `feat: change number ${i} ` + 'x'.repeat(300),
  }));

  it('keeps the lead-in byte-identical (nudge-fires.py counts by it)', () => {
    expect(STALE_HANDOFF_LEADIN).toBe('vfkb stale-handoff check: ');
    expect(STALE_HANDOFF_REMINDER.startsWith('vfkb stale-handoff check: ')).toBe(true);
  });

  it('is pinned to the D4 template: fact, the shared block, RFC-047 §4.4, the conditional', () => {
    expect(STALE_HANDOFF_REMINDER).toBe(
      'vfkb stale-handoff check: the pinned handoff/next entry (p1aa, 2026-01-02) predates commits that landed after it was written.\n' +
        'Commits since this handoff was recorded (1):\n' +
        '  aaaaaaa fix: a thing (#9)\n' +
        "The next session's resume lists these same commits under `## Last handoff`, so a handoff written now is optional unless you are wrapping up. " +
        'If you are WRAPPING UP, record a fresh handoff now — kb_add (type=fact, tags=handoff,next, role=human), ' +
        'or /vfkb:handoff if available — naming what actually changed and what is next now. ' +
        'If you are still mid-session, ignore this and finish normally.',
    );
    expect(STALE_HANDOFF_REMINDER.endsWith('If you are still mid-session, ignore this and finish normally.')).toBe(true);
  });

  it("contains RFC-047 §4.4's sentence verbatim", () => {
    expect(STALE_HANDOFF_NEXT_SESSION).toBe(
      "The next session's resume lists these same commits under `## Last handoff`, so a handoff written now is optional unless you are wrapping up.",
    );
    expect(STALE_HANDOFF_REMINDER).toContain(STALE_HANDOFF_NEXT_SESSION);
  });

  it('embeds the SAME bytes Part A renders (one renderer), bounded', () => {
    const t = renderStaleHandoffReminder(PIN, many);
    const block = renderCommitsSince(many);
    expect(t).toContain(block);
    expect(block.length).toBeLessThanOrEqual(COMMITS_SINCE_SLICE_CHARS);
    expect(block).toContain('Commits since this handoff was recorded (9):');
    expect(block).toMatch(/ {2}\(\+\d+ more\)\n$/);
  });

  it('carries no write demand', () => {
    for (const t of [STALE_HANDOFF_REMINDER, renderStaleHandoffReminder(PIN, many)])
      for (const phrase of ['must', 'before the session ends', 'plan to record one', 'no SessionEnd fallback', 'mcp__vfkb__kb_add'])
        expect(t, phrase).not.toContain(phrase);
  });

  it('a malformed pin created drops the date, never the id', () => {
    expect(renderStaleHandoffReminder({ id: 'zz', created: 'junk' }, S1)).toContain('entry (zz) predates');
  });
});

// ── handoffIsStale: the impure git-comparison function ───────────────────────
describe('handoffIsStale', () => {
  // Commit dates are set EXPLICITLY via GIT_AUTHOR_DATE/GIT_COMMITTER_DATE rather than
  // relying on wall-clock ordering — real `git commit` calls in quick succession can land
  // within the same second, and git's commit-date precision is seconds, not milliseconds,
  // which makes wall-clock-timed tests flaky/order-dependent.
  function repoWithHandoff(): {
    dir: string;
    brain: string;
    commit: (files: Record<string, string>, when: string) => void;
  } {
    const dir = mkdtempSync(join(tmpdir(), 'vfkb-stale-'));
    const brain = join(dir, '.vfkb');
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    mkdirSync(brain);
    const commit = (files: Record<string, string>, when: string) => {
      for (const [rel, content] of Object.entries(files)) {
        mkdirSync(join(dir, rel, '..'), { recursive: true });
        writeFileSync(join(dir, rel), content);
      }
      execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-qm', 'c'], {
        cwd: dir,
        stdio: 'ignore',
        env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
      });
    };
    return { dir, brain, commit };
  }

  // A full, realistic KnowledgeEntry — not the minimal shape a hand-rolled test fixture
  // might use. newestHandoffTimestamp() now reuses engine.ts's real isInjectable(), which
  // reads e.provenance.status and e.validity.valid_until unconditionally; a fixture missing
  // those would crash classification (caught defensively in production, but must not mask
  // what these tests are actually checking).
  let handoffIdCounter = 0;
  const handoffLine = (ts: string, opts: { archived?: boolean } = {}) => {
    handoffIdCounter++;
    return (
      JSON.stringify({
        id: `h${handoffIdCounter}`,
        type: 'fact',
        text: 'h',
        tags: ['handoff', 'next'],
        zone: opts.archived ? 'archive' : 'established',
        author: { role: 'human' },
        provenance: { status: 'verified' },
        validity: { valid_from: ts },
        created: ts,
        updated: ts,
      }) + '\n'
    );
  };

  it('false when no handoff entry exists at all', () => {
    const { dir, brain, commit } = repoWithHandoff();
    commit({ 'src/foo.ts': 'x' }, '2025-01-01T00:00:00Z');
    expect(handoffIsStale(dir, brain)).toBe(false);
  });

  it('false when nothing landed since the pinned handoff', () => {
    const { dir, brain, commit } = repoWithHandoff();
    const ts = '2025-06-01T00:00:00Z';
    commit({ '.vfkb/entries.jsonl': handoffLine(ts) }, ts); // the handoff's own landing commit
    expect(handoffIsStale(dir, brain)).toBe(false);
  });

  it('true when a non-brain commit landed after the pinned handoff', () => {
    const { dir, brain, commit } = repoWithHandoff();
    const handoffTs = '2025-01-01T00:00:00Z';
    commit({ '.vfkb/entries.jsonl': handoffLine(handoffTs), 'src/foo.ts': 'x' }, handoffTs);
    commit({ 'src/bar.ts': 'y' }, '2025-06-01T00:00:00Z'); // a real, later commit — the "merged PR"
    expect(handoffIsStale(dir, brain)).toBe(true);
  });

  it('false when the only commit since is brain-only (e.g. the handoff-landing commit itself)', () => {
    const { dir, brain, commit } = repoWithHandoff();
    commit({ 'src/foo.ts': 'x' }, '2025-01-01T00:00:00Z'); // baseline, BEFORE the handoff
    const handoffTs = '2025-06-01T00:00:00Z';
    commit({ '.vfkb/entries.jsonl': handoffLine(handoffTs) }, handoffTs); // lands after baseline
    expect(handoffIsStale(dir, brain)).toBe(false);
  });

  it('fails open (false) when not a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vfkb-stale-nogit-'));
    const brain = join(dir, '.vfkb');
    mkdirSync(brain);
    writeFileSync(join(brain, 'entries.jsonl'), handoffLine('2020-01-01T00:00:00.000Z'));
    expect(handoffIsStale(dir, brain)).toBe(false);
  });

  // Regression: a `git log --since --name-only` walk prints no paths for an ordinary
  // merge commit, so a long-lived branch whose own commits predate the handoff but whose
  // merge lands after would be silently missed. The tree-diff-against-an-anchor approach
  // must catch this.
  it('true when a long-lived branch merges in after the handoff (merge-commit case)', () => {
    const { dir, brain, commit } = repoWithHandoff();
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    commit({ 'src/base.ts': 'x' }, '2025-01-01T00:00:00Z');
    git('checkout', '-qb', 'feature');
    commit({ 'src/feature.ts': 'y' }, '2025-01-15T00:00:00Z'); // feature work, BEFORE the handoff
    git('checkout', '-q', '-'); // back to the branch repoWithHandoff started on
    const handoffTs = '2025-03-01T00:00:00Z';
    commit({ '.vfkb/entries.jsonl': handoffLine(handoffTs) }, handoffTs); // handoff pinned
    execFileSync('git', ['merge', '-q', '--no-ff', 'feature', '-m', 'merge feature'], {
      cwd: dir,
      stdio: 'ignore',
      env: { ...process.env, GIT_AUTHOR_DATE: '2025-06-01T00:00:00Z', GIT_COMMITTER_DATE: '2025-06-01T00:00:00Z' },
    });
    expect(handoffIsStale(dir, brain)).toBe(true);
  });

  // Regression: pathspecs are resolved relative to the invocation cwd, not the repo root
  // — without resolving the root explicitly, this would silently exclude the wrong path
  // and misreport a genuinely stale handoff as fresh.
  // Review finding F1: the earlier version of this test (a real-work-after-handoff
  // scenario) passed regardless of whether the repo root was resolved, because a
  // non-brain change exists either way — it didn't isolate anything. This version uses a
  // BRAIN-ONLY commit invoked from a subdirectory instead, which is the shape that
  // actually broke under the original `git log --name-only` implementation (that command
  // always prints paths relative to the repo root, so comparing against a cwd-relative
  // brainRel mismatched from a subdirectory). Mutation-tested against the CURRENT
  // (tree-diff) implementation specifically: removing the `git rev-parse
  // --show-toplevel` resolution and using `cwd` directly does NOT turn this test red —
  // `path.relative` and git's own cwd-relative pathspec resolution compose correctly
  // either way for this shape. Root resolution is kept anyway as explicit, defensive
  // practice (it is what makes `brainRel` unambiguous to a reader, and guards against
  // pathspec-magic differences across git versions), not because this specific test
  // proves it load-bearing — this is a real correctness property (subdirectory
  // invocation must not false-positive) that's still worth locking in either way.
  // Round-3 review found the real mechanism: `git diff ... -- . exclude` uses `.` as the
  // FIRST pathspec, which SCOPES the diff to the invocation cwd — when cwd is a
  // subdirectory and root isn't resolved, the diff only ever looks WITHIN that
  // subdirectory, silently missing a real change landed elsewhere in the repo entirely
  // (verified directly: with root resolution, exit=1/stale on this exact scenario;
  // without it, exit=0/missed — see commit message for the raw comparison). Two earlier
  // attempts at this test (a real-work-in-the-same-subdirectory scenario, then a
  // brain-only-commit scenario) both turned out non-discriminating for different reasons
  // (round 1: non-brain work exists either way; round 2: only two commits made `anchor
  // === HEAD`, a trivial self-diff) — this version lands the post-handoff change OUTSIDE
  // the invocation subdirectory specifically, which is what actually depends on resolving
  // the repo root rather than trusting cwd.
  it('does not miss a real change landed OUTSIDE the invocation subdirectory', () => {
    const { dir, brain, commit } = repoWithHandoff();
    commit({ 'sub/base.ts': 'x' }, '2025-01-01T00:00:00Z'); // baseline, inside sub/, BEFORE handoff
    const handoffTs = '2025-06-01T00:00:00Z';
    commit({ '.vfkb/entries.jsonl': handoffLine(handoffTs) }, handoffTs); // the handoff itself
    commit({ 'other/external.ts': 'x' }, '2025-09-01T00:00:00Z'); // real work, OUTSIDE sub/
    expect(handoffIsStale(join(dir, 'sub'), brain)).toBe(true);
  });

  // Regression: CLAUDE.md defines BOTH entries.jsonl and manifest.json as committed brain
  // state — excluding only the former would misreport a manifest-only commit as stale.
  it('false when the only commit since touches another committed brain file (manifest.json)', () => {
    const { dir, brain, commit } = repoWithHandoff();
    commit({ 'src/foo.ts': 'x' }, '2025-01-01T00:00:00Z');
    const handoffTs = '2025-06-01T00:00:00Z';
    commit({ '.vfkb/entries.jsonl': handoffLine(handoffTs) }, handoffTs);
    commit({ '.vfkb/manifest.json': '{}' }, '2025-09-01T00:00:00Z');
    expect(handoffIsStale(dir, brain)).toBe(false);
  });

  // Review finding F2: a bare newest-by-timestamp selection (no isInjectable filtering)
  // lets a LATER archived/superseded handoff entry mask an EARLIER real pin — the actual
  // entry `resume`/`/vfkb:brief` would show. Real work landing between the two timestamps
  // must still register as stale relative to the true (earlier) pin.
  it('a later archived handoff entry does not mask an earlier real pin', () => {
    const { dir, brain, commit } = repoWithHandoff();
    const h1ts = '2025-01-01T00:00:00Z'; // the REAL pin (established, injectable)
    const h2ts = '2025-06-01T00:00:00Z'; // newer by timestamp, but archived — must be ignored
    const entries = handoffLine(h1ts) + handoffLine(h2ts, { archived: true });
    commit({ '.vfkb/entries.jsonl': entries }, h1ts);
    commit({ 'src/real-work.ts': 'x' }, '2025-03-01T00:00:00Z'); // after h1, before h2
    expect(handoffIsStale(dir, brain)).toBe(true);
  });
});

// ── CLI e2e: the verified Stop JSON contract shape (CLI v2.1.195) ─────────────
function gitRepo(): string {
  // realpath: an absolute /var/… brain path against a /private/var/… cwd (macOS tmpdir)
  // defeats the `git show HEAD:<rel>` line count, so every brain line would read as new and
  // rule 1c's `newEntries === 0` could never hold (a pre-existing helper limit; it errs
  // toward firing).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'vfkb-stop-')));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  // Explicit `-b main` (vfkb#387): rule 1c reads the branch, so the fixture must not
  // depend on the machine's init.defaultBranch.
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, '.vfkb'));
  writeFileSync(join(dir, 'entries.seed'), 'x'); // commit a baseline so HEAD exists
  git('add', '.');
  git('commit', '-qm', 'init');
  return dir;
}

function runStop(dir: string, payload: object): string {
  return execFileSync('node', [CLI, 'hook', 'stop'], {
    input: JSON.stringify(payload),
    cwd: dir,
    // KB_SESSION_ID would OVERRIDE the payload session_id (effectiveSessionId, session.ts)
    // — a developer machine exporting it would collapse the per-session cooldown tests
    // onto one record and falsely redden them. Clear it: the payload is the fixture.
    env: { ...process.env, VFKB_DIR: join(dir, '.vfkb'), KB_SESSION_ID: '' },
    encoding: 'utf8',
  }).trim();
}

/**
 * A repo whose pinned handoff predates a later non-brain commit; working tree clean. Left on
 * the topic branch `feat/x` by default, so ADR-0084 §1.4's rule 1c (quiet on the default
 * branch with nothing to commit) does not mask the B3 cases; `onMain` keeps it on `main`.
 */
function staleRepo(onMain = false): string {
  const dir = gitRepo();
  const commitDated = (files: string[], when: string, msg: string) => {
    execFileSync('git', ['add', ...files], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-qm', msg], {
      cwd: dir,
      stdio: 'ignore',
      env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
    });
  };
  const handoffTs = '2030-01-01T00:00:00Z';
  writeFileSync(
    join(dir, '.vfkb', 'entries.jsonl'),
    JSON.stringify({
      id: 'h1',
      type: 'fact',
      text: 'h',
      tags: ['handoff', 'next'],
      zone: 'established',
      author: { role: 'human' },
      provenance: { status: 'verified' },
      validity: { valid_from: handoffTs },
      created: handoffTs,
      updated: handoffTs,
    }) + '\n',
  );
  commitDated(['.vfkb/entries.jsonl'], handoffTs, 'handoff');
  writeFileSync(join(dir, 'src', 'bar.ts'), 'export const y = 1;\n');
  commitDated(['src/bar.ts'], '2030-06-01T00:00:00Z', 'merged PR');
  if (!onMain) execFileSync('git', ['checkout', '-q', '-b', 'feat/x'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('cli hook stop — emits the verified Stop contract', () => {
  it('blocks with hookSpecificOutput when src/ changed and no decision recorded', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n'); // uncommitted work
    const out = JSON.parse(runStop(dir, { stop_hook_active: false }));
    expect(out.hookSpecificOutput.hookEventName).toBe('Stop');
    expect(out.hookSpecificOutput.decision).toBe('block');
    expect(out.hookSpecificOutput.additionalContext).toContain('decision-capture');
  });

  it('does NOT block when an uncommitted decision entry exists', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n');
    writeFileSync(join(dir, '.vfkb', 'entries.jsonl'), JSON.stringify({ id: 'd1', type: 'decision', text: 'd' }) + '\n');
    expect(runStop(dir, { stop_hook_active: false })).toBe('{}');
  });

  it('native loop guard: stop_hook_active=true returns {} even with pending work', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n');
    expect(runStop(dir, { stop_hook_active: true })).toBe('{}');
  });

  const jsonl = (...os: object[]) => os.map((o) => JSON.stringify(o)).join('\n') + '\n';

  it('B1 is off Stop (ADR-0084 §1.6): ≥3 new entries and none a handoff → Stop allows', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n'); // uncommitted work
    // 3 new-since-HEAD entries (entries.jsonl is not in HEAD), incl. a decision so the
    // decision nudge stays silent — isolating the handoff nudge.
    writeFileSync(
      join(dir, '.vfkb', 'entries.jsonl'),
      jsonl({ id: 'a1', type: 'fact', text: 'a' }, { id: 'b1', type: 'fact', text: 'b' }, { id: 'c1', type: 'decision', text: 'c' }),
    );
    expect(runStop(dir, { stop_hook_active: false })).toBe('{}');
  });

  it('self-silences: no nudge once a handoff/next entry is present', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n');
    writeFileSync(
      join(dir, '.vfkb', 'entries.jsonl'),
      jsonl(
        { id: 'c1', type: 'decision', text: 'c' }, // silences the decision nudge
        { id: 'a1', type: 'fact', text: 'a' },
        { id: 'h1', type: 'fact', text: 'h', tags: ['handoff', 'next'] }, // silences the handoff nudge
      ),
    );
    expect(runStop(dir, { stop_hook_active: false })).toBe('{}');
  });

  it('B3: nudges for a stale pinned handoff even with a CLEAN working tree', () => {
    const dir = gitRepo(); // baseline "init" commit lands at real wall-clock "now"
    const commitDated = (files: string[], when: string, msg: string) => {
      execFileSync('git', ['add', ...files], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-qm', msg], {
        cwd: dir,
        stdio: 'ignore',
        env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
      });
    };
    const handoffTs = '2030-01-01T00:00:00Z';
    writeFileSync(
      join(dir, '.vfkb', 'entries.jsonl'),
      JSON.stringify({
        id: 'h1',
        type: 'fact',
        text: 'h',
        tags: ['handoff', 'next'],
        zone: 'established',
        author: { role: 'human' },
        provenance: { status: 'verified' },
        validity: { valid_from: handoffTs },
        created: handoffTs,
        updated: handoffTs,
      }) + '\n',
    );
    commitDated(['.vfkb/entries.jsonl'], handoffTs, 'handoff'); // the pinned handoff, committed
    writeFileSync(join(dir, 'src', 'bar.ts'), 'export const y = 1;\n');
    commitDated(['src/bar.ts'], '2030-06-01T00:00:00Z', 'merged PR'); // lands after the handoff
    // off the default branch, so rule 1c (ADR-0084 §1.4) cannot be what this case observes
    execFileSync('git', ['checkout', '-q', '-b', 'feat/x'], { cwd: dir, stdio: 'ignore' });
    // working tree is now clean — every other trigger (decision/B1) requires uncommittedWork
    const out = JSON.parse(runStop(dir, { stop_hook_active: false }));
    expect(out.hookSpecificOutput.additionalContext).toContain('stale-handoff check');
  });

  it('cooldown: the same session is NOT re-nudged on the very next stop while the trigger holds', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n'); // uncommitted work, no decision
    const payload = { stop_hook_active: false, session_id: 'cooldown-e2e' };
    const first = JSON.parse(runStop(dir, payload));
    expect(first.hookSpecificOutput.decision).toBe('block'); // turn 1: nudge fires…
    expect(runStop(dir, payload)).toBe('{}'); // …turn 2: same trigger still holds, but cooling
  });

  it('cooldown state is per-session: a different session_id still gets the nudge', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n');
    const a = JSON.parse(runStop(dir, { stop_hook_active: false, session_id: 'session-a' }));
    expect(a.hookSpecificOutput.decision).toBe('block');
    const b = JSON.parse(runStop(dir, { stop_hook_active: false, session_id: 'session-b' }));
    expect(b.hookSpecificOutput.decision).toBe('block');
  });

  // Codex review (PR #272): a record whose turn can no longer ADVANCE on disk must not
  // silence the nudge forever. The bump is persisted before the cooldown is trusted, so
  // broken persistence degrades to per-turn reminding — never permanent silence.
  it('fail-open: a session record that can no longer be saved does not silence the nudge', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return; // chmod is a no-op as root
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n');
    const payload = { stop_hook_active: false, session_id: 'save-fail' };
    const first = JSON.parse(runStop(dir, payload));
    expect(first.hookSpecificOutput.decision).toBe('block'); // fired + recorded at turn 1
    // Chmod the record's DIRECTORY: the save is a tmp-file write plus a rename (#385,
    // decide step Q10), and both need directory write permission, so a read-only dir is
    // the scenario: reads keep working, every save throws.
    const sessions = join(dir, '.vfkb', '.sessions');
    chmodSync(sessions, 0o555);
    try {
      const second = JSON.parse(runStop(dir, payload));
      expect(second.hookSpecificOutput?.decision).toBe('block'); // '{}' here = silenced forever
    } finally {
      chmodSync(sessions, 0o755); // let the tmpdir be cleaned up
    }
  });

  // Codex review (PR #272): malformed-but-parseable cooldown state (vs the syntactically
  // invalid JSON the loader already discards) must fail open through the real CLI too.
  it('fail-open: a parseable-but-corrupt cooldown record does not silence the nudge', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n');
    const sessions = join(dir, '.vfkb', '.sessions');
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, 'corrupt.json'),
      JSON.stringify({
        startedAt: 'x',
        lastAt: 'x',
        turnCount: 1,
        injectedIds: [],
        capturedIds: [],
        nudgedAtTurn: { decision: 999999 }, // "cooling" for ~a million turns if coerced
      }),
    );
    const out = JSON.parse(runStop(dir, { stop_hook_active: false, session_id: 'corrupt' }));
    expect(out.hookSpecificOutput.decision).toBe('block');
  });
  // ── ADR-0084 §1.2 (1b) through the real CLI ────────────────────────────────
  it('1b: a paused stop (background_tasks non-empty) emits {} despite pending work', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n'); // arms the decision nudge
    const payload = { stop_hook_active: false, session_id: 'paused', background_tasks: [{ id: 't1' }] };
    expect(runStop(dir, payload)).toBe('{}');
  });

  it('1b: a paused stop (session_crons non-empty) emits {} despite pending work', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n');
    const payload = { stop_hook_active: false, session_id: 'paused-c', session_crons: [{ id: 'c1' }] };
    expect(runStop(dir, payload)).toBe('{}');
  });

  it('1b contrast: an EMPTY background_tasks array is not a paused stop (still blocks)', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n');
    const out = JSON.parse(runStop(dir, { stop_hook_active: false, session_id: 'unpaused', background_tasks: [] }));
    expect(out.hookSpecificOutput.decision).toBe('block');
    expect(out.hookSpecificOutput.additionalContext).toContain('vfkb decision-capture check:');
  });

  it('1b: a paused stop leaves the cooldown slot untouched — the next real stop still nudges', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n');
    expect(runStop(dir, { stop_hook_active: false, session_id: 'p2', background_tasks: [{ id: 't1' }] })).toBe('{}');
    const rec = join(dir, '.vfkb', '.sessions', 'p2.json');
    if (existsSync(rec)) {
      const data = JSON.parse(readFileSync(rec, 'utf8')) as { nudgedAtTurn?: Record<string, number> };
      expect(data.nudgedAtTurn?.decision).toBeUndefined();
    }
    const out = JSON.parse(runStop(dir, { stop_hook_active: false, session_id: 'p2' }));
    expect(out.hookSpecificOutput.decision).toBe('block');
    expect(out.hookSpecificOutput.additionalContext).toContain('vfkb decision-capture check:');
  });

  // ── ADR-0084 §1.1 (1a) through the real CLI ────────────────────────────────
  it('1a: a persisted session gets no B3 on stops 1 and 2, then B3 on stop 3', () => {
    const dir = staleRepo();
    const payload = { stop_hook_active: false, session_id: 'sess-b3' };
    expect(runStop(dir, payload)).toBe('{}'); // turn 1
    expect(runStop(dir, payload)).toBe('{}'); // turn 2
    expect(runStop(dir, payload)).toContain('vfkb stale-handoff check:'); // turn 3
  });

  it('1a contrast: an ephemeral session (no session_id) fails open — B3 on stop 1', () => {
    const dir = staleRepo();
    expect(runStop(dir, { stop_hook_active: false })).toContain('vfkb stale-handoff check:');
  });

  // ── ADR-0084 §1.5 (1e) and §1.4 (1c) through the real CLI (vfkb#387) ───────
  it('1e: a persisted session on a topic branch gets B3 once (stop 3), then {} through stop 14', () => {
    const dir = staleRepo();
    const payload = { stop_hook_active: false, session_id: 'sess-1e' };
    expect(runStop(dir, payload)).toBe('{}'); // turn 1 (1a)
    expect(runStop(dir, payload)).toBe('{}'); // turn 2 (1a)
    expect(runStop(dir, payload)).toContain('vfkb stale-handoff check:'); // turn 3: the one fire
    for (let turn = 4; turn <= 14; turn++) {
      // the 10-turn cooldown re-fired at turn 13; 1e keeps it quiet for the session
      expect(runStop(dir, payload), `turn ${turn}`).toBe('{}');
    }
  }, 60_000);

  it('1e contrast: an ephemeral session (no session_id) on a topic branch fires B3 on every stop', () => {
    const dir = staleRepo();
    for (let i = 1; i <= 3; i++) {
      expect(runStop(dir, { stop_hook_active: false }), `stop ${i}`).toContain('vfkb stale-handoff check:');
    }
  });

  it('1c: on main, clean tree, no new entries → {} through turn 4 (B3 eligible by 1a from turn 3)', () => {
    const dir = staleRepo(true);
    const payload = { stop_hook_active: false, session_id: 'sess-1c' };
    for (let turn = 1; turn <= 4; turn++) expect(runStop(dir, payload), `turn ${turn}`).toBe('{}');
  });

  it('1c can-fail arm: the same repo on main with an uncommitted src/ file fires B3', () => {
    const dir = staleRepo(true);
    writeFileSync(join(dir, 'src', 'wip.ts'), 'export const z = 1;\n');
    // the decision nudge fires too; assert on B3's own lead-in
    expect(runStop(dir, { stop_hook_active: false })).toContain('vfkb stale-handoff check:');
  });

  it('1c can-fail arm: the same repo on main with a new brain entry fires B3', () => {
    const dir = staleRepo(true);
    const brain = join(dir, '.vfkb', 'entries.jsonl');
    writeFileSync(brain, readFileSync(brain, 'utf8') + JSON.stringify({ id: 'n1', type: 'fact', text: 'n' }) + '\n');
    expect(runStop(dir, { stop_hook_active: false })).toContain('vfkb stale-handoff check:');
  });

  it('1c accepted gap (decide Q4): on main a test/-only edit is not "uncommitted work" → {}', () => {
    const dir = staleRepo(true);
    mkdirSync(join(dir, 'test'));
    writeFileSync(join(dir, 'test', 'x.test.ts'), 'export {};\n');
    expect(runStop(dir, { stop_hook_active: false })).toBe('{}');
  });

  it('1c reads the default branch from origin/HEAD: `trunk` with origin/HEAD → origin/trunk is quiet', () => {
    const dir = staleRepo(true);
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('branch', '-m', 'main', 'trunk');
    git('update-ref', 'refs/remotes/origin/trunk', 'HEAD');
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    expect(runStop(dir, { stop_hook_active: false })).toBe('{}');
  });
});

// ── B1 end to end through the hook that now carries it (ADR-0084 §2) ──────────
describe('cli hook user-prompt-submit — B1 self-silence', () => {
  it('uncommitted work + ≥3 new entries, one a handoff/next entry → no B1 clause (empty stdout)', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n'); // uncommitted work
    writeFileSync(
      join(dir, '.vfkb', 'entries.jsonl'),
      [
        { type: 'fact', text: 'a' },
        { type: 'fact', text: 'b' },
        { type: 'fact', text: 'h', tags: ['handoff', 'next'] },
      ]
        .map((o) => JSON.stringify(o))
        .join('\n') + '\n',
    );
    // A persisted session past its first prompt (decide step Q2 silences turnCount 0).
    mkdirSync(join(dir, '.vfkb', '.sessions'));
    writeFileSync(
      join(dir, '.vfkb', '.sessions', 'b1.json'),
      JSON.stringify({ sessionId: 'b1', startedAt: 'x', lastAt: 'x', turnCount: 1, injectedIds: [], capturedIds: [] }),
    );
    const out = execFileSync('node', [CLI, 'hook', 'user-prompt-submit'], {
      input: JSON.stringify({ prompt: 'thanks', session_id: 'b1' }),
      cwd: dir,
      // Relative brain path, as the plugin's cwd-anchored hooks resolve it (see
      // test/user-prompt-submit.test.ts env()).
      env: { ...process.env, VFKB_DATA_DIR: '.vfkb', VFKB_DIR: '', KB_SESSION_ID: '' },
      encoding: 'utf8',
    });
    expect(out).toBe('');
  });
});
