#!/usr/bin/env node
// ============================================================================
// vfkb SESSION-START BRIEFING L4 purpose scenario (ADR-0049 / RFC-023 DoD)
// ----------------------------------------------------------------------------
// Proves the PURPOSE of deterministic handoff pinning: a fresh session answers
// "what was the last thing we did and what's next?" FROM THE SESSION-START
// INJECTION ALONE — because the newest handoff-tagged fact is pinned into the
// render instead of being budget-dropped below the gotcha/pattern tier.
//
// CAUSAL DESIGN (the only variable is whether the handoff survives the render):
//   - a seeded brain holds ONE handoff fact naming an unguessable sentinel
//     next-step, buried under enough high-tier (gotcha/pattern) entries to
//     overflow the 10k injection budget — the exact live failure shape observed
//     2026-07-09 (issue #96);
//   - wired arm: the agent's prompt carries the REAL `vfkb resume` render of
//     that brain (what the SessionStart hook injects) + the operator question;
//   - contrast arm: the identical setup rendered from the SAME brain minus the
//     handoff fact. The sentinel is unguessable, so contrast ≈ 0.
//
// VERDICT: DEMONSTRATED iff wired ≥ 2/3 AND wired > contrast (ADR-0022/0029).
// RED-FIRST: against the pre-ADR-0049 engine the render budget-drops the
// handoff, so the wired arm itself misses — the recorded RED baseline.
//
// FORM NOTE: host-level `claude -p` sandboxes (decision-capture.mjs pattern,
// ADR-0029's canonical example). The artifact under test is the ENGINE RENDER
// STRING — harness-independent — so the single-harness host form fits the
// capability (ADR-0049 DoD). Runs on claude-haiku-4-5 by default: the same run
// doubles as the Layer 1 (/vfkb:brief) model-adequacy proof. LIVE + metered.
//   node scenarios/session-start-briefing.mjs
//   VFKB_SB_TRIALS=1 node scenarios/session-start-briefing.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
const CLI = join(REPO, 'dist', 'cli.js');
const TRIALS = Math.max(1, parseInt(process.env.VFKB_SB_TRIALS || '3', 10));
const MODEL = process.env.VFKB_SB_MODEL || 'claude-haiku-4-5';
const TIMEOUT = parseInt(process.env.VFKB_SB_TIMEOUT || '240000', 10);

// Unguessable sentinel: the handoff's named next-step. The ONLY path to it is
// the injected render carrying the handoff fact.
const SENTINEL = 'marlgrove-echo-12';
const QUESTION =
  'You are starting a work session on this project. Based ONLY on the session-start ' +
  'context above, answer: what is the next step the previous session left for you? ' +
  'Reply with just the codename of that step and nothing else. If the context does ' +
  'not say, reply UNKNOWN.';

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });

// Seed a brain through the REAL engine: one handoff fact + enough high-tier
// entries (gotchas/patterns, weight 5 > fact 2) to overflow the 10k budget so
// an unpinned fact can never render — the observed failure shape.
function seedBrain(withHandoff) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-sb-brain-'));
  const env = { ...process.env, VFKB_DATA_DIR: join(dir, '.vfkb'), VFKB_PROJECT: 'brieftest' };
  const add = (type, text, tags) =>
    sh('node', [CLI, 'add', type, text, '--role', 'human', '--prov-status', 'verified',
        ...(tags ? ['--tag', tags] : [])], { env, stdio: 'ignore' });
  if (withHandoff) {
    // Realistically verbose (the live handoff that missed on 2026-07-09 was ~1.5KB) and,
    // load-bearing for RED determinism: LONGER than one gotcha line. The budget loop
    // drops per-line and continues, so a line shorter than the residual slack can still
    // squeeze in — a fact longer than the line that exhausted the budget cannot.
    add('fact',
      `HANDOFF: the previous session completed the ingest refactor end-to-end — the parser ` +
      `now streams batches through the new normalizer, the legacy shim was deleted, and the ` +
      `full suite plus both integration gates were green at day end. Review notes: the ` +
      `retry queue was left on the conservative profile deliberately; do not retune it ` +
      `before the migration lands. The SINGLE next step left for the next session is the ` +
      `migration codenamed ${SENTINEL} — start there before touching anything else, and ` +
      `keep the feature flag off until the backfill verifier reports clean on the staging ` +
      `ledger. Everything else in the queue is blocked behind that migration.`,
      'handoff,next,status');
  }
  // ~40 verbose gotchas ≈ 40 × ~300 chars > 10k budget — every unpinned fact drops.
  for (let i = 1; i <= 40; i++) {
    add('gotcha',
      `Subsystem-${i} lesson: the worker pool for shard ${i} must be drained before the ` +
      `schema lock is released, otherwise replays of partition ${i} silently duplicate ` +
      `rows in the ledger table and the nightly reconciler flags spurious drift alarms ` +
      `that page the on-call rotation for cluster segment ${i}.`);
  }
  return { dir, env };
}

// The REAL injection surface: what the SessionStart hook hands the session.
function renderInjection(env) {
  return sh('node', [CLI, 'resume'], { env });
}

function runArm(injection) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-sb-arm-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'main.ts'), 'export const main = () => 0;\n');
  const prompt = `${injection}\n\n${QUESTION}`;
  let out = '';
  let err = '';
  try {
    out = sh('claude', ['-p', prompt, '--strict-mcp-config', '--dangerously-skip-permissions', '--model', MODEL], {
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

console.log(`vfkb session-start-briefing L4  (model=${MODEL}, trials=${TRIALS})`);
console.log('only variable = the handoff fact behind the real `vfkb resume` render\n');

const wiredBrain = seedBrain(true);
const contrastBrain = seedBrain(false);
const injections = { wired: renderInjection(wiredBrain.env), contrast: renderInjection(contrastBrain.env) };
console.log(`  render sizes: wired ${injections.wired.length} chars, contrast ${injections.contrast.length} chars`);
console.log(`  wired render carries sentinel: ${injections.wired.includes(SENTINEL) ? 'YES' : 'NO (pre-ADR-0049 budget drop — expect RED)'}\n`);

const arms = { wired: [], contrast: [] };
for (let t = 1; t <= TRIALS; t++) {
  for (const arm of ['wired', 'contrast']) {
    process.stdout.write(`  trial ${t}  ${arm.padEnd(9)} … `);
    const r = runArm(injections[arm]);
    arms[arm].push(r);
    console.log(`${r.hit ? 'ANSWERED' : 'miss'}  — "${r.out}"${r.err ? '  ERR:' + r.err : ''}`);
  }
}
rmSync(wiredBrain.dir, { recursive: true, force: true });
rmSync(contrastBrain.dir, { recursive: true, force: true });

const hits = (a) => a.filter((r) => r.hit).length;
const wiredN = hits(arms.wired);
const contrastN = hits(arms.contrast);
const need = Math.ceil((2 * TRIALS) / 3);
const demonstrated = wiredN >= need && wiredN > contrastN;
console.log(`\nwired: ${wiredN}/${TRIALS} answered   |   contrast (no handoff): ${contrastN}/${TRIALS}`);
console.log(demonstrated
  ? `DEMONSTRATED — the pinned handoff briefs a fresh session (≥${need}/${TRIALS} and > contrast)`
  : `NOT demonstrated (need wired ≥${need}/${TRIALS} AND > contrast)`);

mkdirSync(join(REPO, 'scenarios/records'), { recursive: true });
writeFileSync(
  join(REPO, 'scenarios/records/session-start-briefing.json'),
  JSON.stringify({ scenario: 'session-start-briefing', model: MODEL, trials: TRIALS,
    generated: new Date().toISOString(), wired: wiredN, contrast: contrastN, demonstrated,
    wiredRenderCarriesSentinel: injections.wired.includes(SENTINEL), arms }, null, 2),
);
console.log('record → scenarios/records/session-start-briefing.json');
process.exit(demonstrated ? 0 : 1);
