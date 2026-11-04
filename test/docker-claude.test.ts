// The deterministic inner gate for the docker claude arm's credential path (vfkb#423):
// the container gets the access token by NAME only (`-e CLAUDE_CODE_OAUTH_TOKEN`, value
// in the docker child's env), nothing is mounted at <home>/.claude, and the run reports
// the model it observed from `--output-format json`'s modelUsage.
//
// No real docker, no network, no real token: the integration case puts a fake `docker`
// first on PATH and drives scenarios/l4-purpose.mjs through its real entry point.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error -- plain .mjs scenario helper, no type declarations
import { dockerClaudeArgv, parseClaudeJson, TOKEN_ENV } from '../scenarios/lib/docker-claude.mjs';

const FAKE = 'sk-ant-oat01-FAKEfakeFAKEfake0123456789';
const REPO = resolve(__dirname, '..');

const base = {
  uid: 501, gid: 20, home: '/work', brainHost: '/tmp/b', brainC: '/brain',
  image: 'vfkb-l4-claude:dev', claudeArgs: ['-p', 'hi', '--model', 'claude-haiku-4-5'],
};

describe('dockerClaudeArgv (vfkb#423)', () => {
  it('passes the token by name only, never a value', () => {
    const argv: string[] = dockerClaudeArgv(base);
    const i = argv.indexOf(TOKEN_ENV);
    expect(TOKEN_ENV).toBe('CLAUDE_CODE_OAUTH_TOKEN');
    expect(i).toBeGreaterThan(0);
    expect(argv[i - 1]).toBe('-e');
    expect(argv.some((a) => a.startsWith(`${TOKEN_ENV}=`))).toBe(false);
  });
  it('mounts only the brain: no <home>/.claude, no credentials file', () => {
    const argv: string[] = dockerClaudeArgv(base);
    const mounts = argv.filter((_, k) => argv[k - 1] === '-v');
    expect(mounts).toEqual(['/tmp/b:/brain']);
    expect(argv.some((a) => a.includes('.credentials') || a.includes('/work/.claude'))).toBe(false);
  });
  it('runs claude with the caller args and asks for json output', () => {
    const argv: string[] = dockerClaudeArgv({ ...base, sessionId: 's1' });
    const img = argv.indexOf('vfkb-l4-claude:dev');
    expect(argv.slice(img)).toEqual(['vfkb-l4-claude:dev', 'claude', '-p', 'hi', '--model', 'claude-haiku-4-5', '--output-format', 'json']);
    expect(argv).toContain('KB_SESSION_ID=s1');
  });
});

describe('parseClaudeJson (vfkb#423)', () => {
  it('returns the result text and the modelUsage keys', () => {
    const out = JSON.stringify({ type: 'result', result: 'PONG', modelUsage: { 'claude-haiku-4-5-20251001': { inputTokens: 3 } } });
    expect(parseClaudeJson(out)).toEqual({ text: 'PONG', models: ['claude-haiku-4-5-20251001'] });
  });
  it('passes non-JSON output through as text with no model observed', () => {
    expect(parseClaudeJson('Invalid API key · Please run /login\n')).toEqual({ text: 'Invalid API key · Please run /login', models: [] });
    expect(parseClaudeJson('')).toEqual({ text: '', models: [] });
  });
  it('a JSON object with no modelUsage observes no model', () => {
    expect(parseClaudeJson(JSON.stringify({ result: 'x', is_error: true })).models).toEqual([]);
  });
});

// Integration: the real l4-purpose.mjs docker claude arm, a fake docker on PATH.
describe('l4-purpose docker claude arm, fake docker on PATH (vfkb#423)', () => {
  let dir: string;
  let log: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vfkb-423-'));
    log = join(dir, 'docker.log');
    // Logs argv and whether the token reached its env; answers like `claude -p --output-format json`.
    // `cat /brain/<f>` (the mount check) reads through the -v mapping, or sees an empty
    // mount when FAKE_DOCKER_MOUNT=empty (what Colima does to a /var/folders brain).
    writeFileSync(join(dir, 'docker'), `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: a, envToken: process.env.CLAUDE_CODE_OAUTH_TOKEN || null }) + '\\n');
if (a[0] === 'image') { console.log('sha256:fake'); process.exit(0); }
const cat = a.indexOf('cat');
if (cat > 0) {
  if (process.env.FAKE_DOCKER_MOUNT === 'empty') process.exit(1);
  const [host, cont] = a[a.indexOf('-v') + 1].split(':');
  process.stdout.write(fs.readFileSync(a[cat + 1].replace(cont, host), 'utf8'));
  process.exit(0);
}
console.log(JSON.stringify({ type: 'result', result: 'db-prod-9c814.internal.example', modelUsage: { 'claude-haiku-4-5-20251001': {} } }));
`);
    chmodSync(join(dir, 'docker'), 0o755);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const runL4 = (extra: Record<string, string> = {}) =>
    spawnSync(process.execPath, [join(REPO, 'scenarios/l4-purpose.mjs'), 'stale-supersession', '--no-record'], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        CLAUDE_CODE_OAUTH_TOKEN: FAKE,
        VFKB_L4_HARNESS: 'claude',
        VFKB_L4_CLAUDE_MODE: 'docker',
        VFKB_L4_TRIALS: '1',
        ...extra,
      },
    });
  const calls = () => readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

  it('refuses before any claude run when the docker VM shows the brain mount empty', () => {
    writeFileSync(log, '');
    const r = runL4({ FAKE_DOCKER_MOUNT: 'empty' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cannot see brains under');
    expect(calls().filter((c) => c.argv.includes('claude'))).toEqual([]);
  });

  it('sends the token through env, not argv, mounts no creds, and records the observed model', () => {
    writeFileSync(log, '');
    const r = runL4();
    const runs = calls().filter((c) => c.argv[0] === 'run' && c.argv.includes('claude'));
    expect(runs.length, r.stdout + r.stderr).toBeGreaterThan(0);
    for (const c of runs) {
      expect(c.envToken).toBe(FAKE);
      expect(c.argv.join(' ')).not.toContain(FAKE);
      expect(c.argv).toContain('CLAUDE_CODE_OAUTH_TOKEN');
      expect(c.argv.some((a: string) => a.includes('/work/.claude') || a.includes('.credentials'))).toBe(false);
    }
    expect(r.stdout + r.stderr).not.toContain(FAKE);
    expect(r.stdout).toContain('observed models: claude-haiku-4-5-20251001');
  });
});
