// vfkb#384 (ADR-0084 §4 / RFC-047 §4.2) — `vfkb doctor`'s session-end check. The
// predicate is the SessionEnd marker the hook writes on its own session record: opened
// and never closed = the hook was cut off. Every case below must be able to fail.

import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkSessionEnd, runDoctor, SESSION_END_BUDGET_ENV } from '../src/doctor.js';

const HEAD_T = Date.parse('2026-10-27T10:00:00.000Z');
const LATER = '2026-10-27T11:00:00.000Z';
const EARLIER = '2026-10-27T09:00:00.000Z';
const open = (sessionId: string, startedAt = LATER, turns = 4) => ({
  sessionId,
  turnCount: turns,
  sessionEnd: { startedAt, reason: 'prompt_input_exit', turnAtEnd: turns },
});
const closed = (sessionId: string, outcome = 'committed', startedAt = LATER, elapsedMs = 400) => ({
  sessionId,
  turnCount: 4,
  sessionEnd: { startedAt, turnAtEnd: 4, outcome, elapsedMs },
});

describe('checkSessionEnd — the pure predicate', () => {
  it('WARNs on an opened, never-closed marker with no commit since and a dirty brain', () => {
    const c = checkSessionEnd({ records: [open('aaaaaaaa-1')], brainDirty: true, headTimeMs: HEAD_T });
    expect(c.status).toBe('warn');
    expect(c.detail).toContain('never finished');
    expect(c.detail).toContain('aaaaaaaa');
    expect(c.detail).toContain('likely cut off'); // names the cause as likely, never asserts it
    expect(c.detail).toContain('git commit -o');
    expect(c.detail).toContain(SESSION_END_BUDGET_ENV);
  });

  it('is OK when the marker was closed (the hook finished)', () => {
    const c = checkSessionEnd({ records: [closed('bbbbbbbb-1')], brainDirty: false, headTimeMs: HEAD_T });
    expect(c.status).toBe('ok');
    expect(c.detail).toContain('"committed"');
  });

  it('SKIPs when no record carries a marker (pre-#384 plugin, or no SessionEnd yet)', () => {
    const c = checkSessionEnd({ records: [{ sessionId: 'x', turnCount: 3 }], brainDirty: true, headTimeMs: HEAD_T });
    expect(c.status).toBe('skip');
  });

  it('a resumed session (more turns after the marker) is not a cut-off one', () => {
    const r = { ...open('cccccccc-1'), turnCount: 9 };
    expect(checkSessionEnd({ records: [r], brainDirty: true, headTimeMs: HEAD_T }).status).not.toBe('warn');
  });

  it('an open marker followed by a later commit is resolved, not a warning', () => {
    const c = checkSessionEnd({ records: [open('dddddddd-1', EARLIER)], brainDirty: true, headTimeMs: HEAD_T });
    expect(c.status).toBe('ok');
    expect(c.detail).toContain('followed by a commit');
  });

  it('an open marker with a clean brain is resolved, not a warning', () => {
    expect(checkSessionEnd({ records: [open('eeeeeeee-1')], brainDirty: false, headTimeMs: HEAD_T }).status).toBe('ok');
  });

  it('WARNs when the last SessionEnd finished on the default branch and the brain is still dirty', () => {
    const c = checkSessionEnd({ records: [closed('ffffffff-1', 'on-default-branch')], brainDirty: true, headTimeMs: HEAD_T });
    expect(c.status).toBe('warn');
    expect(c.detail).toContain('default branch');
    expect(c.detail).toContain('does not display SessionEnd messages');
  });

  it('a default-branch outcome with a clean brain is fine', () => {
    expect(
      checkSessionEnd({ records: [closed('ffffffff-2', 'on-default-branch')], brainDirty: false, headTimeMs: HEAD_T }).status,
    ).toBe('ok');
  });

  it('names an override that is already set instead of prescribing it', () => {
    const c = checkSessionEnd({ records: [open('gggggggg-1')], brainDirty: true, headTimeMs: HEAD_T, budgetOverride: '5000' });
    expect(c.status).toBe('warn');
    expect(c.detail).toContain('already set');
  });

  it('reports slow-but-finished SessionEnds in the OK line', () => {
    const c = checkSessionEnd({ records: [closed('hhhhhhhh-1', 'committed', LATER, 1300)], brainDirty: false, headTimeMs: HEAD_T });
    expect(c.status).toBe('ok');
    expect(c.detail).toContain('over 1000 ms');
  });
});

describe('runDoctor — session-end line on a real repo', () => {
  let repo: string;
  const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'vfkb-doc384-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'T');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(join(repo, '.vfkb', '.sessions'), { recursive: true });
    writeFileSync(join(repo, '.vfkb', 'entries.jsonl'), '{"id":"a","type":"fact","text":"t"}\n');
    git('add', '.vfkb/entries.jsonl');
    git('commit', '-q', '-m', 'init');
    git('checkout', '-q', '-b', 'feat/x');
  });
  const line = () =>
    runDoctor({ root: repo, brainDir: join(repo, '.vfkb'), env: {}, pluginsFile: join(repo, 'none.json') }).checks.find(
      (c) => c.name === 'session-end',
    )!;
  const writeRecord = (id: string, rec: object) =>
    writeFileSync(join(repo, '.vfkb', '.sessions', `${id}.json`), JSON.stringify(rec));

  it('WARN: a cut-off SessionEnd after the last commit, brain dirty', () => {
    appendFileSync(join(repo, '.vfkb', 'entries.jsonl'), '{"id":"b","type":"fact","text":"new"}\n');
    writeRecord('sess-cut', open('sess-cut', new Date(Date.now() + 60_000).toISOString()));
    expect(line().status).toBe('warn');
  });

  it('SKIP: no session records (the doctor-staleness contrast arm shape)', () => {
    expect(line().status).toBe('skip');
  });

  it('reads an override from the project .claude/settings.json env', () => {
    appendFileSync(join(repo, '.vfkb', 'entries.jsonl'), '{"id":"b","type":"fact","text":"new"}\n');
    writeRecord('sess-cut', open('sess-cut', new Date(Date.now() + 60_000).toISOString()));
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'settings.json'), JSON.stringify({ env: { [SESSION_END_BUDGET_ENV]: '6000' } }));
    expect(line().detail).toContain('=6000 is already set');
  });
});
