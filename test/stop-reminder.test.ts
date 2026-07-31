import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  decideStop,
  handoffIsStale,
  STOP_REMINDER,
  HANDOFF_REMINDER,
  HANDOFF_MIN_ENTRIES,
  STALE_HANDOFF_REMINDER,
  NUDGE_COOLDOWN_TURNS,
} from '../src/stop-reminder.js';

const CLI = resolve(__dirname, '../dist/cli.js');

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

// ── GAP-1 B1: the handoff nudge (RFC-011 §B) ─────────────────────────────────
describe('decideStop — handoff nudge', () => {
  const base = { uncommittedWork: true, newDecisions: 1 }; // decision already recorded → isolate the handoff branch

  it('blocks with the handoff reminder when ≥threshold entries and NO handoff recorded', () => {
    const d = decideStop({ stop_hook_active: false }, { ...base, newEntries: HANDOFF_MIN_ENTRIES, newHandoffs: 0 });
    expect(d).toEqual({ block: true, reminder: HANDOFF_REMINDER, fired: ['handoff'] });
  });

  it('does NOT nudge below the entry threshold (weak signal → floor handles it)', () => {
    expect(
      decideStop({ stop_hook_active: false }, { ...base, newEntries: HANDOFF_MIN_ENTRIES - 1, newHandoffs: 0 }),
    ).toEqual({ block: false });
  });

  it('self-silences once a handoff/next entry exists this session', () => {
    expect(
      decideStop({ stop_hook_active: false }, { ...base, newEntries: HANDOFF_MIN_ENTRIES + 5, newHandoffs: 1 }),
    ).toEqual({ block: false });
  });

  it('does NOT nudge when no substantive work happened (even with entries)', () => {
    expect(
      decideStop({ stop_hook_active: false }, { uncommittedWork: false, newDecisions: 1, newEntries: 9, newHandoffs: 0 }),
    ).toEqual({ block: false });
  });

  it('composes with the decision nudge: both reminders when both trigger', () => {
    const d = decideStop(
      { stop_hook_active: false },
      { uncommittedWork: true, newDecisions: 0, newEntries: HANDOFF_MIN_ENTRIES, newHandoffs: 0 },
    );
    expect(d.block).toBe(true);
    if (d.block) {
      expect(d.reminder).toContain(STOP_REMINDER);
      expect(d.reminder).toContain(HANDOFF_REMINDER);
    }
  });

  it('native loop guard still wins over the handoff trigger', () => {
    expect(
      decideStop({ stop_hook_active: true }, { ...base, newEntries: HANDOFF_MIN_ENTRIES + 2, newHandoffs: 0 }),
    ).toEqual({ block: false });
  });
});

// ── B3: the stale-handoff nudge (pragmatic patch, built NOT yet verified) ────
describe('decideStop — stale-handoff nudge', () => {
  it('blocks with the stale-handoff reminder when handoffStale=true', () => {
    const d = decideStop(
      { stop_hook_active: false },
      { uncommittedWork: false, newDecisions: 1, newEntries: 0, newHandoffs: 0, handoffStale: true },
    );
    expect(d).toEqual({ block: true, reminder: STALE_HANDOFF_REMINDER, fired: ['staleHandoff'] });
  });

  it('is NOT gated on uncommittedWork — the defining case is a clean tree', () => {
    // everything already committed/merged, working tree clean, pin still stale
    const d = decideStop(
      { stop_hook_active: false },
      { uncommittedWork: false, newDecisions: 1, handoffStale: true },
    );
    expect(d.block).toBe(true);
  });

  it('does NOT block when handoffStale is false/absent', () => {
    expect(
      decideStop({ stop_hook_active: false }, { uncommittedWork: false, newDecisions: 1, handoffStale: false }),
    ).toEqual({ block: false });
    expect(decideStop({ stop_hook_active: false }, { uncommittedWork: false, newDecisions: 1 })).toEqual({
      block: false,
    });
  });

  it('composes with the decision + handoff nudges when all three trigger', () => {
    const d = decideStop(
      { stop_hook_active: false },
      { uncommittedWork: true, newDecisions: 0, newEntries: HANDOFF_MIN_ENTRIES, newHandoffs: 0, handoffStale: true },
    );
    expect(d.block).toBe(true);
    if (d.block) {
      expect(d.reminder).toContain(STOP_REMINDER);
      expect(d.reminder).toContain(HANDOFF_REMINDER);
      expect(d.reminder).toContain(STALE_HANDOFF_REMINDER);
    }
  });

  it('native loop guard still wins over the stale-handoff trigger', () => {
    expect(
      decideStop({ stop_hook_active: true }, { uncommittedWork: false, newDecisions: 1, handoffStale: true }),
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

  it('cooldowns are independent per nudge type: a cooling decision nudge does not mute B1/B3', () => {
    const d = decideStop(
      { stop_hook_active: false },
      {
        uncommittedWork: true,
        newDecisions: 0, // decision trigger holds, but cooling
        newEntries: HANDOFF_MIN_ENTRIES,
        newHandoffs: 0, // B1 trigger holds, never fired
        handoffStale: true, // B3 trigger holds, never fired
        turn: 3,
        lastNudged: { decision: 2 },
      },
    );
    expect(d.block).toBe(true);
    if (d.block) {
      expect(d.fired).toEqual(['handoff', 'staleHandoff']);
      expect(d.reminder).not.toContain(STOP_REMINDER);
      expect(d.reminder).toContain(HANDOFF_REMINDER);
      expect(d.reminder).toContain(STALE_HANDOFF_REMINDER);
    }
  });

  it('falls back to firing when session turn info is unavailable (fail-open toward reminding)', () => {
    // no `turn` → the window cannot be computed, even with a recorded last-fired turn
    const d = decideStop({ stop_hook_active: false }, { ...trigger, lastNudged: { decision: 1 } });
    expect(d).toEqual({ block: true, reminder: STOP_REMINDER, fired: ['decision'] });
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
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-stop-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
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
    env: { ...process.env, VFKB_DIR: join(dir, '.vfkb') },
    encoding: 'utf8',
  }).trim();
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
    writeFileSync(join(dir, '.vfkb', 'entries.jsonl'), JSON.stringify({ type: 'decision', text: 'd' }) + '\n');
    expect(runStop(dir, { stop_hook_active: false })).toBe('{}');
  });

  it('native loop guard: stop_hook_active=true returns {} even with pending work', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n');
    expect(runStop(dir, { stop_hook_active: true })).toBe('{}');
  });

  const jsonl = (...os: object[]) => os.map((o) => JSON.stringify(o)).join('\n') + '\n';

  it('injects the handoff nudge when ≥3 new entries exist and none is a handoff', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n'); // uncommitted work
    // 3 new-since-HEAD entries (entries.jsonl is not in HEAD), incl. a decision so the
    // decision nudge stays silent — isolating the handoff nudge.
    writeFileSync(
      join(dir, '.vfkb', 'entries.jsonl'),
      jsonl({ type: 'fact', text: 'a' }, { type: 'fact', text: 'b' }, { type: 'decision', text: 'c' }),
    );
    const out = JSON.parse(runStop(dir, { stop_hook_active: false }));
    expect(out.hookSpecificOutput.additionalContext).toContain('handoff check');
  });

  it('self-silences: no nudge once a handoff/next entry is present', () => {
    const dir = gitRepo();
    writeFileSync(join(dir, 'src', 'foo.ts'), 'export const x = 1;\n');
    writeFileSync(
      join(dir, '.vfkb', 'entries.jsonl'),
      jsonl(
        { type: 'decision', text: 'c' }, // silences the decision nudge
        { type: 'fact', text: 'a' },
        { type: 'fact', text: 'h', tags: ['handoff', 'next'] }, // silences the handoff nudge
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
});
