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
    expect(parseClaudeJson(out)).toEqual({ text: 'PONG', models: ['claude-haiku-4-5-20251001'], isError: false });
  });
  it('passes non-JSON output through as text with no model observed', () => {
    expect(parseClaudeJson('Invalid API key · Please run /login\n')).toEqual({ text: 'Invalid API key · Please run /login', models: [], isError: false });
    expect(parseClaudeJson('')).toEqual({ text: '', models: [], isError: false });
  });
  it('a JSON object with no modelUsage observes no model', () => {
    expect(parseClaudeJson(JSON.stringify({ result: 'x', is_error: true })).models).toEqual([]);
  });
  it('finds the result object after a warning line', () => {
    const out = 'Warning: something odd\n' + JSON.stringify({ result: 'PONG', modelUsage: { 'claude-haiku-4-5': {} } });
    expect(parseClaudeJson(out)).toEqual({ text: 'PONG', models: ['claude-haiku-4-5'], isError: false });
  });
  it('an error result with no result field scores as empty text, not the raw JSON', () => {
    const out = JSON.stringify({ subtype: 'error_during_execution', is_error: true, permission_denials: [{ tool_input: 'x' }], modelUsage: { m: {} } });
    expect(parseClaudeJson(out)).toEqual({ text: '', models: ['m'], isError: true });
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
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: a, envToken: process.env.CLAUDE_CODE_OAUTH_TOKEN || null, path0: (process.env.PATH || '').split(':')[0] }) + '\\n');
if (a[0] === 'image') { console.log('sha256:fake'); process.exit(0); }
const cat = a.indexOf('cat');
if (cat > 0) {
  if (process.env.FAKE_DOCKER_PROBE === 'noimage') { console.error("Unable to find image 'x' locally"); process.exit(125); }
  if (process.env.FAKE_DOCKER_MOUNT === 'empty') { console.error('cat: /brain/mount-probe: No such file or directory'); process.exit(1); }
  const [host, cont] = a[a.indexOf('-v') + 1].split(':');
  process.stdout.write(fs.readFileSync(a[cat + 1].replace(cont, host), 'utf8'));
  process.exit(0);
}
if (process.env.FAKE_DOCKER_MODE === 'hang') setTimeout(() => {}, 600000);
else if (process.env.FAKE_DOCKER_MODE === '401-after-turn') {
  console.log(JSON.stringify({ type: 'result', is_error: true, result: 'Failed to authenticate. API Error: 401', modelUsage: { 'claude-haiku-4-5-20251001': {} } }));
  process.exit(1);
} else if (process.env.FAKE_DOCKER_MODE === '401') {
  console.log(JSON.stringify({ type: 'result', is_error: true, result: 'Failed to authenticate. API Error: 401 OAuth token has expired' }));
  process.exit(1);
}
else console.log(JSON.stringify({ type: 'result', result: 'db-prod-9c814.internal.example', modelUsage: { 'claude-haiku-4-5-20251001': {} } }));
`);
    chmodSync(join(dir, 'docker'), 0o755);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const runL4 = (extra: Record<string, string> = {}, id = 'stale-supersession', record = false) =>
    spawnSync(process.execPath, [join(REPO, 'scenarios/l4-purpose.mjs'), id, ...(record ? [] : ['--no-record'])], {
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
  const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

  it('refuses before any claude run when the docker VM shows the brain mount empty', () => {
    writeFileSync(log, '');
    const r = runL4({ FAKE_DOCKER_MOUNT: 'empty' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('cannot see brains under');
    expect(calls().filter((c) => c.argv.includes('claude'))).toEqual([]);
  });

  it('probes with the same image and --user as the real claude runs (vfkb#442)', () => {
    writeFileSync(log, '');
    const r = runL4();
    const probe = calls().find((c) => c.argv.includes('cat'));
    expect(probe, r.stdout + r.stderr).toBeTruthy();
    expect(probe.argv).toContain('vfkb-l4-claude:dev');
    expect(probe.argv[probe.argv.indexOf('--user') + 1]).toBe(`${process.getuid!()}:${process.getgid!()}`);
  });

  it('a probe docker cannot run (missing image) names docker, not the brain root (vfkb#442)', () => {
    writeFileSync(log, '');
    const r = runL4({ FAKE_DOCKER_PROBE: 'noimage' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('could not run the mount probe (exit 125)');
    expect(r.stderr).toContain('Unable to find image');
    expect(r.stderr).not.toContain('cannot see brains under');
  });

  it('no probe when every selected scenario is skipped on this harness (vfkb#442)', () => {
    writeFileSync(log, '');
    const r = runL4({ FAKE_DOCKER_MOUNT: 'empty' }, 'live-capture-result');
    expect(r.stdout + r.stderr).toContain('SKIPPED on claude');
    expect(calls()).toEqual([]);
  });

  it('a timed-out run is a scored miss, not a refusal, and ends its trial (vfkb#442)', () => {
    writeFileSync(log, '');
    const r = runL4({ FAKE_DOCKER_MODE: 'hang', VFKB_L4_DOCKER_TIMEOUT: '1500' });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stderr).not.toContain('REFUSING');
    expect(r.stdout).toContain('TIMEOUT');
    expect(r.stdout).toContain('ETIMEDOUT');
    expect(r.stdout).toContain('INCONCLUSIVE');
    // stale-supersession has two runs per trial; the second is skipped after the timeout.
    expect(calls().filter((c) => c.argv[0] === 'run' && c.argv.includes('claude')).length).toBe(1);
  });

  it('a timeout cannot pass a single-arm "nothing stored" scenario (vfkb#442)', () => {
    writeFileSync(log, '');
    const r = runL4({ FAKE_DOCKER_MODE: 'hang', VFKB_L4_DOCKER_TIMEOUT: '1500' }, 'no-secrets');
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain('INCONCLUSIVE');
    expect(r.stdout).not.toMatch(/-> DEMONSTRATED/);
  });

  it('an auth error after a turn that carried a model still refuses (vfkb#442)', () => {
    writeFileSync(log, '');
    const r = runL4({ FAKE_DOCKER_MODE: '401-after-turn' }, 'no-secrets');
    expect(r.status, r.stdout + r.stderr).toBe(3);
    expect(r.stderr).toContain('had no model answer');
  });

  it('records provenance per scenario, and a refusal voids the refused scenario\'s old verdict (vfkb#442)', () => {
    const recDir = mkdtempSync(join(tmpdir(), 'vfkb-442-rec-'));
    try {
      const slug = 'p442__m442__docker';
      const path = join(recDir, `${slug}.json`);
      const old = (trials: string) => ({ dim: 'd', demonstrated: true, trials, passRate: 1, rows: [] });
      // A record from before per-scenario stamps: provenance only on the header.
      writeFileSync(path, JSON.stringify({
        harness: 'claude', model: 'm442', provider: 'p442', slug, generated: '2026-07-01T00:00:00Z',
        vfkb_sha: 'oldsha1', trials_n: 3, image_digest: 'sha256:old',
        scenarios: { 'stale-expiry': old('3/3'), 'no-secrets': old('3/3') },
      }));
      const env = { VFKB_L4_RECORD_DIR: recDir, VFKB_L4_PROVIDER: 'p442', VFKB_L4_MODEL: 'm442' };
      // Exit 1: the fake answers both arms alike, so the contrast fails. Scored, not refused.
      expect(runL4(env, 'stale-supersession', true).status).toBe(1);
      let rec = JSON.parse(readFileSync(path, 'utf8'));
      const fresh = rec.scenarios['stale-supersession'];
      expect(fresh.trials_n).toBe(1);
      expect(fresh.image_digest).toBe('sha256:fake');
      expect(fresh.vfkb_sha).not.toBe('oldsha1');
      expect(fresh.provenance_inferred).toBeUndefined();
      expect(rec.scenarios['stale-expiry']).toMatchObject({ vfkb_sha: 'oldsha1', trials_n: 3, provenance_inferred: true });
      // The header states only what every scenario shares.
      expect(rec.vfkb_sha).toBe('mixed');
      expect(rec.trials_n).toBe('mixed');
      expect(rec.image_digest).toBe('mixed');
      expect(readFileSync(join(recDir, `${slug}.md`), 'utf8')).toContain('provenance differs between scenarios');

      expect(runL4({ ...env, FAKE_DOCKER_MODE: '401' }, 'no-secrets', true).status).toBe(3);
      rec = JSON.parse(readFileSync(path, 'utf8'));
      expect(rec.scenarios['no-secrets']).toMatchObject({
        demonstrated: false, trials: 'refused', previous: { demonstrated: true, trials: '3/3', vfkb_sha: 'oldsha1' },
      });
      expect(rec.scenarios['no-secrets'].refused).toContain('401');
      expect(readFileSync(join(recDir, `${slug}.md`), 'utf8')).toMatch(/\| no-secrets \|.*\| no \| refused \|.*REFUSED: /);
    } finally {
      rmSync(recDir, { recursive: true, force: true });
    }
  });

  it('sends the token through env, not argv, mounts no creds, and records the observed model', () => {
    writeFileSync(log, '');
    const r = runL4();
    const runs = calls().filter((c) => c.argv[0] === 'run' && c.argv.includes('claude'));
    expect(runs.length, r.stdout + r.stderr).toBeGreaterThan(0);
    for (const c of runs) {
      expect(c.envToken).toBe(FAKE);
      // The docker child env is the seam's claudeEnv(), not a bare process.env copy.
      expect(c.path0).toContain('vfkb-l4-nokeychain-');
      expect(c.argv.join(' ')).not.toContain(FAKE);
      expect(c.argv).toContain('CLAUDE_CODE_OAUTH_TOKEN');
      expect(c.argv.some((a: string) => a.includes('/work/.claude') || a.includes('.credentials'))).toBe(false);
    }
    expect(r.stdout + r.stderr).not.toContain(FAKE);
    expect(r.stdout).toContain('observed models: claude-haiku-4-5-20251001');
  });

  it('a run with no model answer (401) refuses instead of scoring, even a single-arm "nothing stored" scenario', () => {
    writeFileSync(log, '');
    const r = runL4({ FAKE_DOCKER_MODE: '401' }, 'no-secrets');
    expect(r.status, r.stdout + r.stderr).toBe(3);
    expect(r.stderr).toContain('had no model answer');
    expect(r.stderr).toContain('401 OAuth token has expired');
    expect(r.stdout).not.toMatch(/DEMONSTRATED/);
  });
});
