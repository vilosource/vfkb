#!/usr/bin/env node
// ============================================================================
// vfkb AGENTS-MD COLD-AGENT L4 purpose scenario (ADR-0047 / RFC-022 DoD)
// ----------------------------------------------------------------------------
// Proves the PURPOSE of `vfkb export agents-md`: a COLD agent — no vfkb MCP, no
// hooks, no CLAUDE.md, no brain — answers a seeded project question BECAUSE the
// exported AGENTS.md carries the brain's published knowledge into its workspace.
//
// CAUSAL DESIGN (the only variable is the exported file):
//   - a seeded brain (verified, operator-role entries incl. a sentinel fact no
//     model can guess) is exported with the real `vfkb export agents-md`;
//   - wired arm: a bare sandbox containing ONLY the exported AGENTS.md;
//   - contrast arm: the identical sandbox WITHOUT it.
//   Both arms get the same neutral prompt (no "read AGENTS.md" hint). Any correct
//   answer in the wired arm is artifact-driven by elimination; contrast ≈ 0.
//
// VERDICT: DEMONSTRATED iff wired ≥ 2/3 AND wired > contrast (ADR-0022/0029 —
// a proof that can't fail proves nothing; the contrast arm is the can-fail half).
//
// FORM NOTE: host-level `claude -p` sandboxes (the decision-capture.mjs pattern —
// ADR-0029's canonical example), not the dockerized l4-purpose runner: the cold
// arm needs NO vfkb wiring at all, so the temp-dir sandbox is the faithful,
// breadcrumb-free surface. LIVE + metered (Max-subscription OAuth). One at a time.
//   node scenarios/agents-md-cold-agent.mjs
//   VFKB_XA_TRIALS=1 VFKB_XA_MODEL=claude-haiku-4-5 node scenarios/agents-md-cold-agent.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
const CLI = join(REPO, 'dist', 'cli.js');
const TRIALS = Math.max(1, parseInt(process.env.VFKB_XA_TRIALS || '3', 10));
const MODEL = process.env.VFKB_XA_MODEL || 'claude-haiku-4-5';
const TIMEOUT = parseInt(process.env.VFKB_XA_TIMEOUT || '240000', 10);

// The sentinel is ungoogleable and unguessable — the ONLY path to it is the artifact.
const SENTINEL = 'quartzfern-9';
const QUESTION =
  'Look at this project and answer: what prefix must all release tags use? ' +
  'Reply with just the prefix and nothing else. If the project does not say, reply UNKNOWN.';

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });

// Seed a brain through the REAL engine (verified + operator role = publish-grade
// under the ADR-0046 ratchet) and export it with the REAL CLI verb.
function buildArtifact() {
  const brainRepo = mkdtempSync(join(tmpdir(), 'vfkb-xa-brain-'));
  mkdirSync(join(brainRepo, '.vfkb'));
  const env = { ...process.env, VFKB_DATA_DIR: join(brainRepo, '.vfkb'), VFKB_PROJECT: 'coldtest' };
  const add = (type, text) =>
    sh('node', [CLI, 'add', type, text, '--role', 'human', '--prov-status', 'verified'], { env, stdio: 'ignore' });
  add('fact', `All release tags in this project must be prefixed with the internal build codename ${SENTINEL}.`);
  add('fact', 'The service exposes a gRPC API on port 7443 and a debug HTTP endpoint on 7080.');
  add('gotcha', 'The migration runner silently skips files whose names contain uppercase letters.');
  add('pattern', 'Feature flags are read once at boot — never poll them per-request.');
  const out = join(brainRepo, 'AGENTS.md');
  sh('node', [CLI, 'export', 'agents-md', '--out', out], { env, stdio: 'ignore' });
  return { brainRepo, artifact: out };
}

function runArm(artifact) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-xa-arm-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'main.ts'), 'export const main = () => 0;\n');
  if (artifact) copyFileSync(artifact, join(dir, 'AGENTS.md'));
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

console.log(`vfkb agents-md-cold-agent L4  (model=${MODEL}, trials=${TRIALS})`);
console.log('only variable = the exported AGENTS.md; the agent is COLD (no MCP, no hooks, no brain)\n');
const { brainRepo, artifact } = buildArtifact();
const arms = { wired: [], contrast: [] };
for (let t = 1; t <= TRIALS; t++) {
  for (const [arm, file] of [['wired', artifact], ['contrast', null]]) {
    process.stdout.write(`  trial ${t}  ${arm.padEnd(9)} … `);
    const r = runArm(file);
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
console.log(`\nwired: ${wiredN}/${TRIALS} answered   |   contrast (no AGENTS.md): ${contrastN}/${TRIALS}`);
console.log(demonstrated
  ? `DEMONSTRATED — the exported AGENTS.md grounds a cold agent (≥${need}/${TRIALS} and > contrast)`
  : `NOT demonstrated (need wired ≥${need}/${TRIALS} AND > contrast)`);

mkdirSync(join(REPO, 'scenarios/records'), { recursive: true });
writeFileSync(
  join(REPO, 'scenarios/records/agents-md-cold-agent.json'),
  JSON.stringify({ scenario: 'agents-md-cold-agent', model: MODEL, trials: TRIALS,
    generated: new Date().toISOString(), wired: wiredN, contrast: contrastN, demonstrated, arms }, null, 2),
);
console.log('record → scenarios/records/agents-md-cold-agent.json');
process.exit(demonstrated ? 0 : 1);
