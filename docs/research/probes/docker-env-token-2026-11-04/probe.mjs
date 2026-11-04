#!/usr/bin/env node
// vfkb#423 Tier-0 probe: does the docker claude arm authenticate from the access
// token passed BY NAME (`-e CLAUDE_CODE_OAUTH_TOKEN`), with no credentials mounted?
//
// Two arms, N each, the exact argv the scenario builds (dockerClaudeArgv):
//   token    : docker child env carries the seam's token (claudeEnv)  -> expect PONG + a haiku modelUsage key
//   no-token : the same argv, the token deleted from the docker child env -> expect no PONG, no model
// Content assertion over the output (ADR-0051 clause 3), never the exit status.
//   CLAUDE_CODE_OAUTH_TOKEN=… node docs/research/probes/docker-env-token-2026-11-04/probe.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertClaudeAuthReady, claudeEnv, redactSecrets } from '../../../../scenarios/lib/claude-auth.mjs';
import { dockerClaudeArgv, parseClaudeJson, TOKEN_ENV } from '../../../../scenarios/lib/docker-claude.mjs';

assertClaudeAuthReady();
const HERE = resolve(process.argv[1], '..');
const N = Math.max(1, parseInt(process.env.PROBE_N || '3', 10));
const IMAGE = process.env.VFKB_L4_CLAUDE_IMAGE || 'vfkb-l4-claude:dev';
const MODEL = 'claude-haiku-4-5';
const digest = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', IMAGE], { encoding: 'utf8' }).trim();
const version = execFileSync('docker', ['run', '--rm', IMAGE, 'claude', '--version'], { encoding: 'utf8' }).trim();

function once(withToken) {
  const brain = mkdtempSync(join(tmpdir(), 'vfkb-423-probe-'));
  const env = claudeEnv(process.env);
  if (!withToken) delete env[TOKEN_ENV];
  const argv = dockerClaudeArgv({
    uid: process.getuid(), gid: process.getgid(), home: '/work', brainHost: brain, brainC: '/brain', image: IMAGE,
    claudeArgs: ['-p', 'Reply with exactly one word: PONG', '--model', MODEL, '--strict-mcp-config'],
  });
  let out = '';
  try { out = execFileSync('docker', argv, { encoding: 'utf8', env, timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  rmSync(brain, { recursive: true, force: true });
  const { text, models } = parseClaudeJson(out);
  return { pong: /\bPONG\b/.test(text), models, text: redactSecrets(text).replace(/\s+/g, ' ').slice(0, 120) };
}

const arms = { token: [], 'no-token': [] };
for (let t = 1; t <= N; t++) {
  for (const arm of Object.keys(arms)) {
    const r = once(arm === 'token');
    arms[arm].push(r);
    console.log(`trial ${t} ${arm.padEnd(8)} pong=${r.pong} models=${r.models.join(',') || '-'} :: ${r.text}`);
  }
}
const pongs = (a) => arms[a].filter((r) => r.pong).length;
const haiku = arms.token.filter((r) => r.models.some((m) => m.startsWith('claude-haiku-4-5'))).length;
const need = Math.ceil((2 * N) / 3);
const demonstrated = pongs('token') >= need && haiku >= need && pongs('no-token') === 0;
console.log(`token PONG ${pongs('token')}/${N} (haiku in modelUsage ${haiku}/${N}); no-token PONG ${pongs('no-token')}/${N} -> ${demonstrated ? 'DEMONSTRATED' : 'NOT demonstrated'}`);
mkdirSync(join(HERE, 'out'), { recursive: true });
writeFileSync(join(HERE, 'out', 'result.json'), JSON.stringify({
  probe: 'docker-env-token', issue: 'vilosource/vfkb#423', date: new Date().toISOString(),
  image: IMAGE, imageDigest: digest, cli: version, model: MODEL, trials: N, demonstrated, arms,
}, null, 2) + '\n');
