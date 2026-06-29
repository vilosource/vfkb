#!/usr/bin/env node
// ============================================================================
// vfkb AUTO-LAYER WIRING smoke gate (ADR-0028)
// ----------------------------------------------------------------------------
// Closes the process gap: the engine has unit tests, the platform contract has
// Tier-0 probes, agent-purpose has the L4 harness — but the *.claude/settings.json
// wiring* that ties them together was only ever validated in production (the live,
// dogfooded repo session). This gate validates the CANDIDATE wiring in a throwaway
// sandbox by driving REAL `claude` turns, so the live edit is a copy of something
// already proven — never a first run.
//
// What it proves for the Stop-hook wiring (ADR-0027):
//   1. claude, given the candidate settings.json, actually fires `vfkb hook stop`
//      at end of turn (the real command, relative `node dist/cli.js`, not a toy);
//   2. heuristic BLOCKS when src/ changed and no decision was recorded since HEAD;
//   3. heuristic SUPPRESSES when a decision IS recorded;
//   4. the loop TERMINATES (the native stop_hook_active guard) — no timeout.
//
// Observation seam: the sandbox Stop command tees the REAL hook's stdout to
// `.vfkb-stop-last.json` (`tee -a`), so we read the exact decision JSON it emitted
// without instrumenting prod code. The promoted-live command is the un-teed form.
//
// LIVE + metered (2 small `claude -p` turns) -> a scenarios/-style gate, NOT npm test.
// Needs an authed `claude` CLI + a built dist/. Exit 0 = PASS (safe to promote).
//
//   node scenarios/wiring-smoke.mjs            # run the gate
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
const TIMEOUT = 150_000;

// The REAL command we intend to promote into .claude/settings.json (un-teed).
const STOP_CMD_REAL = 'VFKB_DIR=.vfkb VFKB_PROJECT=vfkb node dist/cli.js hook stop';
// The OBSERVED form used only inside the gate: identical command, stdout teed for assertion.
const STOP_CMD_OBSERVED = `${STOP_CMD_REAL} | tee -a .vfkb-stop-last.json`;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}

// The candidate full settings.json = the repo's live file + the Stop block (observed form).
function candidateSettings() {
  const live = JSON.parse(readFileSync(join(REPO, '.claude/settings.json'), 'utf8'));
  live.hooks = live.hooks || {};
  live.hooks.Stop = [{ hooks: [{ type: 'command', command: STOP_CMD_OBSERVED }] }];
  return live;
}

function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-wiring-'));
  // faithfully resolve the relative `node dist/cli.js` + its runtime deps
  symlinkSync(join(REPO, 'dist'), join(dir, 'dist'));
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, '.vfkb'));
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude/settings.json'), JSON.stringify(candidateSettings(), null, 2));
  // committed baseline so HEAD exists and the brain delta has a reference point
  writeFileSync(join(dir, '.vfkb/entries.jsonl'), JSON.stringify({ type: 'fact', text: 'baseline' }) + '\n');
  const git = (...a) => sh('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('add', '.');
  git('commit', '-qm', 'baseline');
  return dir;
}

function driveTurn(dir) {
  // fresh observation file each turn; tee -a accumulates this turn's fire(s)
  const obs = join(dir, '.vfkb-stop-last.json');
  if (existsSync(obs)) rmSync(obs);
  sh('claude', ['-p', 'Reply with the single word OK and nothing else.',
    '--settings', join(dir, '.claude/settings.json'), '--dangerously-skip-permissions'],
    { cwd: dir, timeout: TIMEOUT, stdio: ['ignore', 'ignore', 'ignore'] });
  return existsSync(obs) ? readFileSync(obs, 'utf8') : '';
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

console.log('vfkb auto-layer wiring smoke gate (Stop hook / ADR-0027)\n');
let dir;
try {
  // ── CASE 1: BLOCK — uncommitted src change, no decision recorded since HEAD ──
  dir = makeSandbox();
  writeFileSync(join(dir, 'src/foo.ts'), 'export const x = 1;\n');
  const blockOut = driveTurn(dir);
  check('hook FIRES + BLOCKS on undocumented work', /"decision":\s*"block"/.test(blockOut),
    `observed: ${blockOut.replace(/\s+/g, ' ').slice(0, 80) || '(empty — hook did not fire!)'}`);
  check('loop TERMINATES (native stop_hook_active guard, no timeout)', true, 'turn completed');
  rmSync(dir, { recursive: true, force: true });

  // ── CASE 2: SUPPRESS — a decision IS recorded (uncommitted since HEAD) ──
  dir = makeSandbox();
  writeFileSync(join(dir, 'src/foo.ts'), 'export const x = 1;\n');
  appendFileSync(join(dir, '.vfkb/entries.jsonl'), JSON.stringify({ type: 'decision', text: 'recorded this turn' }) + '\n');
  const suppressOut = driveTurn(dir);
  check('hook SUPPRESSES when a decision was recorded', !/"decision":\s*"block"/.test(suppressOut),
    `observed: ${suppressOut.replace(/\s+/g, ' ').slice(0, 80) || '{}'}`);
  rmSync(dir, { recursive: true, force: true });
} catch (e) {
  console.error('\nGATE ERROR:', e.message);
  if (dir) try { rmSync(dir, { recursive: true, force: true }); } catch {}
  process.exit(2);
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${failed === 0 ? 'GATE PASS — safe to promote the Stop wiring to live .claude/settings.json' : `GATE FAIL — ${failed} check(s) failed; do NOT promote`}`);
process.exit(failed === 0 ? 0 : 1);
