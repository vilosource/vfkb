import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// V2-1 session backbone (ADR-0039 ← RFC-014): the hooks read `session_id` from their
// own stdin JSON and use it as the effective session id — KB_SESSION_ID becomes an
// optional OVERRIDE, not the only path. Every entry written with a known session is
// stamped with `session_id`. Exercises the real built CLI like hook.test.ts does.
const CLI = resolve(__dirname, '../dist/cli.js');

// Hook env: KB_SESSION_ID deliberately UNSET (the verified GAP-1 condition — no
// harness sets it), VFKB_DATA_DIR pointing at a temp brain.
function hookEnv(brain: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, VFKB_DATA_DIR: brain };
  delete env.KB_SESSION_ID; // the GAP-1 baseline: no harness sets it
  delete env.VFKB_DIR;
  return { ...env, ...extra }; // extra may deliberately re-set KB_SESSION_ID (override tests)
}

function runHook(brain: string, sub: string, payload: object, extra: Record<string, string> = {}): string {
  return execFileSync('node', [CLI, 'hook', sub], {
    input: JSON.stringify(payload),
    env: hookEnv(brain, extra),
    encoding: 'utf8',
  });
}

function sessionRecord(brain: string, id: string): Record<string, unknown> | undefined {
  const f = join(brain, '.sessions', `${id}.json`);
  if (!existsSync(f)) return undefined;
  return JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
}

function entries(brain: string): Record<string, unknown>[] {
  const f = join(brain, 'entries.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

let brain: string;
beforeEach(() => {
  brain = mkdtempSync(join(tmpdir(), 'vfkb-sb-'));
});

describe('hook stdin session_id → persisted session state (GAP-1 root fix)', () => {
  it('session-start with a stdin session_id persists .sessions/<id>.json (KB_SESSION_ID unset)', () => {
    runHook(brain, 'session-start', { session_id: 'sess-alpha', hook_event_name: 'SessionStart' });
    const rec = sessionRecord(brain, 'sess-alpha');
    expect(rec).toBeTruthy();
    expect(rec!.sessionId).toBe('sess-alpha');
  });

  it('two distinct stdin session_ids produce two isolated records against one brain', () => {
    runHook(brain, 'session-start', { session_id: 'sess-a' });
    runHook(brain, 'session-start', { session_id: 'sess-b' });
    expect(sessionRecord(brain, 'sess-a')).toBeTruthy();
    expect(sessionRecord(brain, 'sess-b')).toBeTruthy();
    expect(readdirSync(join(brain, '.sessions')).filter((f) => f.endsWith('.json'))).toHaveLength(2);
  });

  it('the stop hook accumulates turnCount across invocations of the SAME session id', () => {
    runHook(brain, 'session-start', { session_id: 'sess-turns' });
    runHook(brain, 'stop', { session_id: 'sess-turns', stop_hook_active: false });
    runHook(brain, 'stop', { session_id: 'sess-turns', stop_hook_active: false });
    const rec = sessionRecord(brain, 'sess-turns');
    expect(rec).toBeTruthy();
    expect(rec!.turnCount).toBe(2);
  });

  it('a stop re-entry (stop_hook_active=true) does not double-count the turn', () => {
    runHook(brain, 'session-start', { session_id: 'sess-guard' });
    runHook(brain, 'stop', { session_id: 'sess-guard', stop_hook_active: false });
    runHook(brain, 'stop', { session_id: 'sess-guard', stop_hook_active: true });
    expect(sessionRecord(brain, 'sess-guard')!.turnCount).toBe(1);
  });

  it('KB_SESSION_ID, when set, OVERRIDES the stdin session_id', () => {
    runHook(brain, 'session-start', { session_id: 'from-stdin' }, { KB_SESSION_ID: 'from-env' });
    expect(sessionRecord(brain, 'from-env')).toBeTruthy();
    expect(sessionRecord(brain, 'from-stdin')).toBeUndefined();
  });

  it('no stdin id and no env id stays ephemeral (no session record, no crash)', () => {
    runHook(brain, 'session-start', {});
    expect(existsSync(join(brain, '.sessions'))).toBe(false);
  });

  it('a fresh session record carries the identity surface: pid (and branch when in a git repo)', () => {
    runHook(brain, 'session-start', { session_id: 'sess-ident' });
    const rec = sessionRecord(brain, 'sess-ident');
    expect(typeof rec!.pid).toBe('number');
    // branch is best-effort (undefined outside a git repo) — this repo's cwd IS a git
    // repo when tests run, but the brain dir is in tmp; assert only that the field is
    // either absent or a non-empty string (no crash either way).
    if (rec!.branch !== undefined) expect(String(rec!.branch).length).toBeGreaterThan(0);
  });
});

describe('entry stamping — session_id on the envelope (ADR-0039 §3)', () => {
  it('post-tool-use capture stamps the captured entry with the stdin session_id', () => {
    runHook(brain, 'post-tool-use', {
      session_id: 'sess-cap',
      tool_name: 'Bash',
      tool_input: { command: 'cat /nope' },
      tool_response: { stderr: 'No such file or directory' },
      tool_use_id: 'c1',
    });
    const cap = entries(brain).find((e) => (e.tags as string[])?.includes('captured'));
    expect(cap).toBeTruthy();
    expect(cap!.session_id).toBe('sess-cap');
    // and the capture is recorded into the RIGHT session's record
    expect((sessionRecord(brain, 'sess-cap')!.capturedIds as string[])).toContain(cap!.id);
  });

  it('CLI add stamps session_id from KB_SESSION_ID when set, omits it when not', () => {
    execFileSync('node', [CLI, 'add', 'fact', 'stamped entry'], {
      env: hookEnv(brain, { KB_SESSION_ID: 'sess-cli' }),
    });
    execFileSync('node', [CLI, 'add', 'fact', 'unstamped entry'], { env: hookEnv(brain) });
    const all = entries(brain);
    expect(all.find((e) => e.text === 'stamped entry')!.session_id).toBe('sess-cli');
    expect(all.find((e) => e.text === 'unstamped entry')!.session_id).toBeUndefined();
  });

  it('the SessionEnd B2 fallback handoff is stamped with the stdin session_id', () => {
    // seed enough uncommitted-looking state: B2 writes only when there are new entries
    // and no handoff — a non-git brain dir means git-delta logic is bypassed; drive
    // session-end directly and accept either outcome EXCEPT an unstamped handoff.
    execFileSync('node', [CLI, 'add', 'fact', 'work happened'], { env: hookEnv(brain) });
    runHook(brain, 'session-end', { session_id: 'sess-end', cwd: brain, reason: 'other' });
    const handoff = entries(brain).find((e) => (e.tags as string[])?.includes('auto'));
    if (handoff) expect(handoff.session_id).toBe('sess-end');
  });
});
