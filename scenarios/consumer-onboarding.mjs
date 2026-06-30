#!/usr/bin/env node
// ============================================================================
// vfkb CONSUMER-ONBOARDING capability DoD (ADR-0030 / ADR-0029)
// ----------------------------------------------------------------------------
// Proves the Track-7 capability END-TO-END, with a real agent, in a THROWAWAY
// consumer repo — the way a non-self repo (vfwb, the fleet) will actually adopt
// vfkb: `vfkb init` scaffolds the portable $VFKB_BUNDLE_DIR wiring (FR-1), the
// single-file bundles resolve with NO node_modules (FR-2), and a real `claude`
// turn in that repo GROUNDS on the repo's vfkb knowledge.
//
// Exercised together: FR-1 (init) + FR-2 ($VFKB_BUNDLE_DIR bundle) + the SessionStart
// auto-layer — i.e. the whole onboarding path, observed not asserted.
//
//   PASS arm   — onboard a fresh repo (`vfkb init` + record a sentinel fact),
//                ask a real claude turn for the sentinel -> it answers it
//                (the SessionStart injection delivered the repo's knowledge).
//   CONTRAST   — a NOT-onboarded repo (no wiring, no knowledge): the same turn
//                CANNOT produce the sentinel. (The must-fail arm — ADR-0029 #3.)
//
// Isolated from the live repo: the engine is resolved by ABSOLUTE $VFKB_BUNDLE_DIR to
// the repo's dist/bundles (self-contained, zero-dep) — the sandbox holds NO
// symlink/breadcrumb back into the repo (avoids the known sandbox-leak gotcha).
//
// LIVE + metered (2 small `claude -p` turns) -> a scenarios/-style gate, NOT
// npm test. Needs an authed `claude` CLI. A deterministic pre-check runs first
// so a broken bundle/hook fails CHEAP, before any model call.
//
//   node scenarios/consumer-onboarding.mjs        # exit 0 = DEMONSTRATED
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildBundles } from '../scripts/build-bundles.mjs';

const REPO = resolve(process.argv[1], '../..');
const TIMEOUT = 180_000;
const SENTINEL = 'ZEBRA-7731';
const QUESTION =
  'What is the onboarding sentinel token for this repo? Reply with ONLY the token and nothing else. ' +
  'If you do not know it, reply exactly: UNKNOWN.';

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', input: '', ...opts });
}

async function ensureBundles() {
  const dir = join(REPO, 'dist', 'bundles');
  if (!existsSync(join(dir, 'vfkb.mjs')) || !existsSync(join(dir, 'vfkb-mcp.mjs'))) await buildBundles(dir);
  return dir;
}

function vfkb(dir, BUNDLES, args, extraEnv = {}) {
  return sh('node', [join(BUNDLES, 'vfkb.mjs'), ...args], {
    cwd: dir,
    env: { ...process.env, VFKB_BUNDLE_DIR: BUNDLES, ...extraEnv },
  });
}

// A fresh repo, onboarded the real way: `vfkb init` + one recorded fact.
function onboard(BUNDLES) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-onboard-'));
  vfkb(dir, BUNDLES, ['init', 'onboard-demo']);
  vfkb(dir, BUNDLES, ['add', 'fact', `the onboarding sentinel token is ${SENTINEL}`, '--role', 'human'], {
    VFKB_DATA_DIR: '.vfkb',
    VFKB_PROJECT: 'onboard-demo',
  });
  return dir;
}

// Drive a real claude turn; capture its reply (whatever the exit code).
function ask(dir, BUNDLES, { wired }) {
  const args = ['-p', QUESTION, '--dangerously-skip-permissions'];
  if (wired) args.push('--settings', join(dir, '.claude/settings.json'));
  try {
    return sh('claude', args, { cwd: dir, timeout: TIMEOUT, env: { ...process.env, VFKB_BUNDLE_DIR: BUNDLES } });
  } catch (e) {
    return String(e.stdout || '') + String(e.stderr || '');
  }
}

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('vfkb consumer-onboarding capability gate (ADR-0030)\n');
let onboarded, bare;
try {
  const BUNDLES = await ensureBundles();

  // ── Deterministic pre-check: the onboarded wiring must surface the seed in the
  //    SessionStart injection. If not, fail cheap before spending a claude turn. ──
  onboarded = onboard(BUNDLES);
  const injection = vfkb(onboarded, BUNDLES, ['hook', 'session-start'], { VFKB_DATA_DIR: '.vfkb', VFKB_PROJECT: 'onboard-demo' });
  if (!injection.includes(SENTINEL)) {
    console.error('PRE-CHECK FAILED: SessionStart injection did not surface the seeded fact.');
    rmSync(onboarded, { recursive: true, force: true });
    process.exit(2);
  }
  console.log(`pre-check: SessionStart injection surfaces the seed (${SENTINEL}) ✓\n`);

  // ── PASS arm: a real agent in the onboarded repo grounds on its vfkb knowledge ──
  const wiredReply = ask(onboarded, BUNDLES, { wired: true });
  const recalled = wiredReply.includes(SENTINEL);
  check('onboarded repo: real claude turn grounds on the repo vfkb knowledge', recalled,
    `reply: ${wiredReply.replace(/\s+/g, ' ').trim().slice(0, 60) || '(empty)'}`);
  rmSync(onboarded, { recursive: true, force: true });
  onboarded = undefined;

  // ── CONTRAST (must-fail): a NOT-onboarded repo cannot produce the sentinel ──
  bare = mkdtempSync(join(tmpdir(), 'vfkb-bare-'));
  const bareReply = ask(bare, BUNDLES, { wired: false });
  const contrastSilent = !bareReply.includes(SENTINEL);
  check('not-onboarded repo: same turn CANNOT produce the sentinel (contrast)', contrastSilent,
    `reply: ${bareReply.replace(/\s+/g, ' ').trim().slice(0, 60) || '(empty)'}`);
  rmSync(bare, { recursive: true, force: true });
  bare = undefined;
} catch (e) {
  console.error('\nGATE ERROR:', e.message);
  for (const d of [onboarded, bare]) if (d) try { rmSync(d, { recursive: true, force: true }); } catch {}
  process.exit(2);
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${failed === 0
  ? 'GATE PASS — consumer-onboarding DEMONSTRATED (onboarded grounds; not-onboarded cannot)'
  : `GATE FAIL — ${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
