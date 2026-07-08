#!/usr/bin/env node
// ============================================================================
// vfkb OKF-BUNDLE COLD-AGENT L4 purpose scenario (ADR-0047 / RFC-022 DoD)
// ----------------------------------------------------------------------------
// Proves the PURPOSE of `vfkb export okf`: a COLD agent — no vfkb MCP, no hooks,
// no CLAUDE.md, no brain — answers a seeded project question from the exported
// `.okf/` bundle alone, navigating it the way OKF intends: progressive disclosure
// (root index.md → per-type index.md → the one concept doc), not bulk reading.
//
// CAUSAL DESIGN mirrors agents-md-cold-agent (the only variable is the bundle):
// wired arm gets the sandbox WITH .okf/, contrast arm the identical sandbox
// without it; same neutral prompt; the sentinel is unguessable. The bundle is
// seeded with enough entries that grepping is not the shape of the task and the
// index path matters.
//
// VERDICT: DEMONSTRATED iff wired ≥ 2/3 AND wired > contrast (ADR-0022/0029).
// Host-level `claude -p` sandboxes (the decision-capture.mjs pattern). LIVE +
// metered. One at a time.
//   node scenarios/okf-bundle-cold-agent.mjs
//   VFKB_XO_TRIALS=1 node scenarios/okf-bundle-cold-agent.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
const CLI = join(REPO, 'dist', 'cli.js');
const TRIALS = Math.max(1, parseInt(process.env.VFKB_XO_TRIALS || '3', 10));
const MODEL = process.env.VFKB_XO_MODEL || 'claude-haiku-4-5';
const TIMEOUT = parseInt(process.env.VFKB_XO_TIMEOUT || '240000', 10);

const SENTINEL = 'umbermarsh-42';
const QUESTION =
  'This workspace may contain project documentation. Answer: which internal cluster name must ' +
  'staging deployments target? Reply with just the name and nothing else. If the project does ' +
  'not say, reply UNKNOWN.';

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });

function buildBundle() {
  const brainRepo = mkdtempSync(join(tmpdir(), 'vfkb-xo-brain-'));
  mkdirSync(join(brainRepo, '.vfkb'));
  const env = { ...process.env, VFKB_DATA_DIR: join(brainRepo, '.vfkb'), VFKB_PROJECT: 'coldokf' };
  const add = (type, text) =>
    sh('node', [CLI, 'add', type, text, '--role', 'human', '--prov-status', 'verified'], { env, stdio: 'ignore' });
  add('fact', `Staging deployments must target the internal cluster named ${SENTINEL}; production uses a separate rollout ring.`);
  // enough sibling knowledge that the index path is the sane route, not a single-file grep
  add('fact', 'The billing reconciler runs nightly at 02:15 UTC and is idempotent.');
  add('fact', 'API keys rotate every 30 days via the keysmith job.');
  add('gotcha', 'The load balancer health check follows redirects — a 302 on /healthz reads as healthy.');
  add('gotcha', 'Retries on the payment webhook must be capped at 3; the provider bans IPs that hammer it.');
  add('pattern', 'All background jobs take a --dry-run flag and log what they WOULD do.');
  add('pattern', 'Config lookups go through the typed accessor, never raw env reads.');
  add('link', 'Deploy runbook https://wiki.example.internal/deploy-runbook for the full promotion checklist.');
  const out = join(brainRepo, '.okf');
  sh('node', [CLI, 'export', 'okf', '--out', out], { env, stdio: 'ignore' });
  return { brainRepo, bundle: out };
}

function runArm(bundle) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-xo-arm-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'main.ts'), 'export const main = () => 0;\n');
  if (bundle) cpSync(bundle, join(dir, '.okf'), { recursive: true });
  let out = '';
  let err = '';
  try {
    out = sh('claude', ['-p', QUESTION, '--strict-mcp-config', '--dangerously-skip-permissions', '--model', MODEL], {
      cwd: dir,
      timeout: TIMEOUT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    err = String(e.stderr || e.message || '').replace(/\s+/g, ' ').slice(0, 160);
    out = String(e.stdout || '');
  }
  rmSync(dir, { recursive: true, force: true });
  return { hit: out.toLowerCase().includes(SENTINEL), out: out.replace(/\s+/g, ' ').slice(0, 120), err };
}

console.log(`vfkb okf-bundle-cold-agent L4  (model=${MODEL}, trials=${TRIALS})`);
console.log('only variable = the exported .okf/ bundle; the agent is COLD (no MCP, no hooks, no brain)\n');
const { brainRepo, bundle } = buildBundle();
const arms = { wired: [], contrast: [] };
for (let t = 1; t <= TRIALS; t++) {
  for (const [arm, b] of [['wired', bundle], ['contrast', null]]) {
    process.stdout.write(`  trial ${t}  ${arm.padEnd(9)} … `);
    const r = runArm(b);
    arms[arm].push(r);
    console.log(`${r.hit ? 'ANSWERED' : 'miss'}  — "${r.out}"${r.err ? '  ERR:' + r.err : ''}`);
  }
}
rmSync(brainRepo, { recursive: true, force: true });

const hits = (a) => a.filter((r) => r.hit).length;
const wiredN = hits(arms.wired);
const contrastN = hits(arms.contrast);
const need = Math.ceil((2 * TRIALS) / 3);
const demonstrated = wiredN >= need && wiredN > contrastN;
console.log(`\nwired: ${wiredN}/${TRIALS} answered   |   contrast (no .okf/): ${contrastN}/${TRIALS}`);
console.log(demonstrated
  ? `DEMONSTRATED — the exported .okf/ bundle grounds a cold agent (≥${need}/${TRIALS} and > contrast)`
  : `NOT demonstrated (need wired ≥${need}/${TRIALS} AND > contrast)`);

mkdirSync(join(REPO, 'scenarios/records'), { recursive: true });
writeFileSync(
  join(REPO, 'scenarios/records/okf-bundle-cold-agent.json'),
  JSON.stringify({ scenario: 'okf-bundle-cold-agent', model: MODEL, trials: TRIALS,
    generated: new Date().toISOString(), wired: wiredN, contrast: contrastN, demonstrated, arms }, null, 2),
);
console.log('record → scenarios/records/okf-bundle-cold-agent.json');
process.exit(demonstrated ? 0 : 1);
