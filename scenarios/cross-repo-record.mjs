#!/usr/bin/env node
// ============================================================================
// vfkb CROSS-REPO RECORD L4 purpose scenario (ADR-0063 / RFC-033 DoD, §7)
// ----------------------------------------------------------------------------
// Proves the PURPOSE of the cross-repo brain-write convention: after a visitor
// session changes this repo's observable state and leaves ONE `cross-repo`
// record in its brain (ADR-0063 §1/§3 v1 transport), a fresh resident session
// can answer "what operation recently changed this repo, and by whom?" FROM
// THE SESSION-START INJECTION ALONE.
//
// THREE ARMS (ADR-0063 §7 — two capabilities of different strengths, each
// with a DoD it can actually satisfy):
//   - v1 convention arm (unpressured): small brain + the record. Green = the
//     write + best-effort delivery v1 actually claims. Gates the CONVENTION.
//   - delivery arm (pressured): same record buried under enough high-tier
//     entries to overflow the injection budget (the #96 shape, ADR-0049's
//     scenario precedent). Expected RED until the `## Cross-repo operations`
//     second pin ships — that RED is the pin/`broadcast` build's evidence
//     gate (ADR-0023), never a flake to waive. Gates the PIN.
//   - contrast arm (can-fail): the same scripted operation with NO record —
//     the session must fail to produce the sentinel.
//
// CAUSAL DESIGN: predicates key on an UNGUESSABLE SENTINEL (the operation
// codename carried only inside the record) — proof the session read the
// record, not that it inferred "someone did something" from a dirty config.
// Git is kept uninformative by construction: the scripted change sits
// UNCOMMITTED in the arm cwd (mirroring §4 write-never-commit), so no arm can
// answer from git log.
//
// FORM NOTE: host-level `claude -p` sandboxes (decision-capture.mjs pattern;
// session-start-briefing.mjs is the direct model). The artifact under test is
// the ENGINE RENDER STRING — harness-independent — so the single-harness host
// form fits (same argument as the ADR-0049 DoD). LIVE + metered.
//   node scenarios/cross-repo-record.mjs
//   VFKB_XR_TRIALS=1 node scenarios/cross-repo-record.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
const CLI = join(REPO, 'dist', 'cli.js');
const TRIALS = Math.max(1, parseInt(process.env.VFKB_XR_TRIALS || '3', 10));
const MODEL = process.env.VFKB_XR_MODEL || 'claude-haiku-4-5';
const TIMEOUT = parseInt(process.env.VFKB_XR_TIMEOUT || '240000', 10);

// Unguessable sentinel: the operation codename. The ONLY path to it is the
// injected render carrying the cross-repo record.
const SENTINEL = 'peltmarsh-quill-47';
const QUESTION =
  'You are starting a work session on this project. Based ONLY on the session-start ' +
  'context above, answer: a recent cross-repo operation (run from another repo) changed ' +
  "this repo's wiring — what is that operation's codename? Reply with just the codename " +
  'and nothing else. If the context does not say, reply UNKNOWN.';

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });

// Seed a resident brain through the REAL engine, then (per arm) write the
// cross-repo record exactly as ADR-0063 §3 v1 prescribes: env-switched engine
// add, tagged `cross-repo` (NEVER handoff/next), CROSS-REPO marker + origin.
function seedBrain({ withRecord, pressured }) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-xr-brain-'));
  const env = { ...process.env, VFKB_DATA_DIR: join(dir, '.vfkb'), VFKB_PROJECT: 'residentproj' };
  const add = (type, text, tags) =>
    sh('node', [CLI, 'add', type, text, '--role', 'human', '--prov-status', 'verified',
        ...(tags ? ['--tag', tags] : [])], { env, stdio: 'ignore' });
  // A little ordinary resident knowledge so the brain is never empty.
  add('fact', 'The deploy pipeline promotes staging to prod only after the ledger reconciler reports clean.');
  add('decision', 'Config format is TOML; JSON configs were migrated out in Q2.');
  if (pressured) {
    // ~40 verbose gotchas (weight 5 > fact 2) overflow the 10k budget — every
    // unpinned fact drops. Identical shape to session-start-briefing.mjs.
    for (let i = 1; i <= 40; i++) {
      add('gotcha',
        `Subsystem-${i} lesson: the worker pool for shard ${i} must be drained before the ` +
        `schema lock is released, otherwise replays of partition ${i} silently duplicate ` +
        `rows in the ledger table and the nightly reconciler flags spurious drift alarms ` +
        `that page the on-call rotation for cluster segment ${i}.`);
    }
  }
  if (withRecord) {
    // The visitor's record, written LAST (newest — what a real visitor leaves),
    // via the v1 transport against this brain. Verbose and realistic, longer
    // than one gotcha line (RED determinism — see session-start-briefing.mjs).
    sh('node', [CLI, 'add', 'fact',
      `CROSS-REPO WIRING-MIGRATION (2026-07-17, from vfkb): this repo's auto-layer wiring was ` +
      `migrated by a maintenance session running in the vfkb repo — the operation codename is ` +
      `${SENTINEL}. What changed: the old bootstrap hooks were removed from .claude/settings.json, ` +
      `the redundant local MCP server entry was deleted, and the vendored engine copy now comes ` +
      `from the plugin at project scope. Verified by the visitor: doctor reports the plugin ` +
      `installed and the brain untouched. What this repo's next session still needs to do: ` +
      `restart any open harness sessions to load the new wiring, and commit the brain on the ` +
      `next topic branch. The change is deliberately UNCOMMITTED in the working tree per the ` +
      `cross-repo write-never-commit rule.`,
      '--tag', 'cross-repo,plugin,distribution'], { env, stdio: 'ignore' });
  }
  return { dir, env };
}

// The REAL injection surface: what the SessionStart hook hands the session.
function renderInjection(env) {
  return sh('node', [CLI, 'resume'], { env });
}

// Arm cwd: a stub repo whose wiring visibly changed, UNCOMMITTED, with git
// history kept uninformative — so no arm can recover the codename from git.
function runArm(injection) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-xr-arm-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'settings.json'), '{\n  "enabledPlugins": { "vfkb@vfkb": true }\n}\n');
  writeFileSync(join(dir, 'main.toml'), 'service = "resident"\n');
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

console.log(`vfkb cross-repo-record L4  (model=${MODEL}, trials=${TRIALS})`);
console.log('only variable = the cross-repo record behind the real `vfkb resume` render\n');

const brains = {
  v1: seedBrain({ withRecord: true, pressured: false }),
  delivery: seedBrain({ withRecord: true, pressured: true }),
  contrast: seedBrain({ withRecord: false, pressured: false }),
};
const injections = Object.fromEntries(
  Object.entries(brains).map(([k, b]) => [k, renderInjection(b.env)]),
);
for (const [k, inj] of Object.entries(injections)) {
  console.log(`  ${k.padEnd(9)} render ${String(inj.length).padStart(5)} chars, carries sentinel: ${inj.includes(SENTINEL) ? 'YES' : 'no'}`);
}
console.log(`  (delivery arm without sentinel = the pre-pin budget drop — expected RED until the '## Cross-repo operations' pin ships)\n`);

const arms = { v1: [], delivery: [], contrast: [] };
for (let t = 1; t <= TRIALS; t++) {
  for (const arm of Object.keys(arms)) {
    process.stdout.write(`  trial ${t}  ${arm.padEnd(9)} … `);
    const r = runArm(injections[arm]);
    arms[arm].push(r);
    console.log(`${r.hit ? 'ANSWERED' : 'miss'}  — "${r.out}"${r.err ? '  ERR:' + r.err : ''}`);
  }
}
for (const b of Object.values(brains)) rmSync(b.dir, { recursive: true, force: true });

const hits = (a) => a.filter((r) => r.hit).length;
const v1N = hits(arms.v1);
const deliveryN = hits(arms.delivery);
const contrastN = hits(arms.contrast);
const need = Math.ceil((2 * TRIALS) / 3);
// Per ADR-0063 §7 the arms gate DIFFERENT capabilities:
const conventionDemonstrated = v1N >= need && v1N > contrastN;
const pinDemonstrated = deliveryN >= need && deliveryN > contrastN;

console.log(`\nv1 convention: ${v1N}/${TRIALS}   delivery(pressured): ${deliveryN}/${TRIALS}   contrast(no record): ${contrastN}/${TRIALS}`);
console.log(conventionDemonstrated
  ? `CONVENTION DEMONSTRATED — the v1 record briefs a fresh resident session (≥${need}/${TRIALS} and > contrast)`
  : `convention NOT demonstrated (need v1 ≥${need}/${TRIALS} AND > contrast)`);
console.log(pinDemonstrated
  ? `PIN DEMONSTRATED — the record survives budget pressure (≥${need}/${TRIALS} and > contrast)`
  : `pin NOT demonstrated — expected RED until the '## Cross-repo operations' pin ships (ADR-0063 §2)`);

mkdirSync(join(REPO, 'scenarios/records'), { recursive: true });
writeFileSync(
  join(REPO, 'scenarios/records/cross-repo-record.json'),
  JSON.stringify({ scenario: 'cross-repo-record', model: MODEL, trials: TRIALS,
    generated: new Date().toISOString(), v1: v1N, delivery: deliveryN, contrast: contrastN,
    conventionDemonstrated, pinDemonstrated,
    renderCarriesSentinel: Object.fromEntries(Object.entries(injections).map(([k, i]) => [k, i.includes(SENTINEL)])),
    arms }, null, 2),
);
console.log('record → scenarios/records/cross-repo-record.json');
// Exit 0 iff the CONVENTION arm holds — the pin arm's RED is expected pre-build
// and must not mask a convention regression; the pin build flips its own gate.
process.exit(conventionDemonstrated ? 0 : 1);
