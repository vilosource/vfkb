import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { decideStop, STOP_REMINDER, HANDOFF_REMINDER, HANDOFF_MIN_ENTRIES } from '../src/stop-reminder.js';

const CLI = resolve(__dirname, '../dist/cli.js');

// ── pure core: the deterministic backstop (RFC-008 / ADR-0027) ───────────────
describe('decideStop — conditional end-of-turn reminder', () => {
  it('blocks with the reminder when work happened AND no decision was recorded', () => {
    const d = decideStop({ stop_hook_active: false }, { uncommittedWork: true, newDecisions: 0 });
    expect(d).toEqual({ block: true, reminder: STOP_REMINDER });
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
    expect(d).toEqual({ block: true, reminder: HANDOFF_REMINDER });
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
});
