#!/usr/bin/env node
// L4 PURPOSE harness — proves vtfkb fulfils its PURPOSE, not just that its modules
// work. It drives a REAL agent (claude -p) through tasks whose correct outcome
// depends on vtfkb's knowledge, asserts on OBSERVABLE EFFECTS (what the agent
// outputs/does — never self-report), and CONTRASTS against a baseline (a naive
// mykb-v1-style flat memory, or no memory) to show vtfkb *causes* the better result.
//
// This is LIVE + COSTS TOKENS + is nondeterministic — NOT part of `npm test`.
// Run:  node scenarios/l4-purpose.mjs   (requires a built dist/ and an authed claude CLI)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
const CLI = join(REPO, 'dist', 'cli.js');
const TIMEOUT = 175_000;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}
// Seed the brain via the REAL engine write path. Returns the new entry id.
function kb(brain, args) {
  return sh('node', [CLI, ...args], { env: { ...process.env, VTFKB_DIR: brain } }).trim();
}
function idOf(line) {
  return line.split('\t')[0];
}

// Write a session settings file whose SessionStart hook injects `mode`:
//   'vtfkb' -> real filtered bundle ; 'naive' -> flat unfiltered dump ; 'none' -> nothing
function settingsFor(brain, mode) {
  const base = `VTFKB_DIR=${brain} VTFKB_PROJECT=l4 node ${CLI} hook session-start`;
  const hooks =
    mode === 'none'
      ? {}
      : {
          SessionStart: [
            { hooks: [{ type: 'command', command: mode === 'naive' ? base + ' --naive' : base }] },
          ],
        };
  const f = join(brain, `settings.${mode}.json`);
  writeFileSync(f, JSON.stringify({ hooks }));
  return f;
}

function ask(brain, mode, prompt) {
  const settings = settingsFor(brain, mode);
  try {
    return sh('claude', ['-p', prompt, '--settings', settings], {
      cwd: tmpdir(), // avoid loading this repo's CLAUDE.md
      timeout: TIMEOUT,
      env: { ...process.env },
    }).trim();
  } catch (e) {
    return `__ERROR__ ${e.message || e}`;
  }
}

// ---- Scenarios ----
const scenarios = [
  {
    id: 'stale-host',
    purpose: 'Stale-exclusion delivers the CORRECT (corrected) value, not the decommissioned one.',
    // Non-semantic hostnames: the agent cannot guess which is current — only the
    // brain structure (supersession) tells it.
    seed(brain) {
      const old = kb(brain, [
        'add',
        'decision',
        'The prod database host is db-prod-7f3a2.internal.example',
        '--role',
        'human',
        '--status',
        'accepted',
      ]);
      kb(brain, [
        'supersede',
        idOf(old),
        'The prod database host is db-prod-9c814.internal.example',
        '--role',
        'human',
      ]);
    },
    prompt:
      'What hostname must I use to connect to the prod database right now? Reply with ONLY the hostname.',
    variants: ['vtfkb', 'naive'],
    assert(out) {
      const usesNew = out.includes('9c814');
      const usesOld = out.includes('7f3a2');
      return { pass: usesNew && !usesOld, detail: usesNew ? (usesOld ? 'BOTH' : 'NEW') : usesOld ? 'OLD(stale!)' : 'neither' };
    },
  },
  {
    id: 'constitution-port',
    purpose:
      'A constitutional rule BINDS behavior even when it CONTRADICTS the model\'s default (arbitrary, unguessable policy).',
    seed(brain) {
      kb(brain, [
        'add',
        'decision',
        'House policy: every new internal HTTP service MUST listen on port 8472 — never a conventional default such as 8080/3000/80.',
        '--role',
        'human',
        '--status',
        'accepted',
        '--constitutional',
      ]);
    },
    prompt:
      'We are scaffolding a new internal HTTP service for our platform. Which TCP port should it listen on? Reply with ONLY the port number.',
    variants: ['vtfkb', 'none'],
    assert(out) {
      const followsPolicy = /\b8472\b/.test(out);
      const usedDefault = /\b(8080|3000|80|8000|5000)\b/.test(out);
      return {
        pass: followsPolicy && !usedDefault,
        detail: followsPolicy ? '8472 (policy)' : usedDefault ? 'default port (policy ignored)' : 'other',
      };
    },
  },
];

// ---- Run ----
console.log('=== vtfkb L4 PURPOSE harness (live claude -p; external-effect assertions) ===\n');
const only = process.argv.slice(2); // optional scenario-id filter(s)
const toRun = only.length ? scenarios.filter((s) => only.includes(s.id)) : scenarios;
const summary = [];
for (const s of toRun) {
  console.log(`# ${s.id} — ${s.purpose}`);
  for (const mode of s.variants) {
    const brain = mkdtempSync(join(tmpdir(), `vtfkb-l4-${s.id}-${mode}-`));
    s.seed(brain);
    const out = ask(brain, mode, s.prompt);
    const oneLine = out.replace(/\s+/g, ' ').slice(0, 120);
    const r = s.assert(out);
    // For the contrast baseline we EXPECT failure; for vtfkb we expect pass.
    const expectPass = mode === 'vtfkb';
    const verdict = r.pass === expectPass ? 'as-expected' : 'UNEXPECTED';
    const mark = r.pass ? 'PASS' : 'fail';
    console.log(`  [${mode}] ${mark} (${r.detail}) [${verdict}]  ::  ${oneLine}`);
    summary.push({ scenario: s.id, mode, pass: r.pass, expectPass, verdict, detail: r.detail });
    rmSync(brain, { recursive: true, force: true });
  }
  console.log('');
}

console.log('=== SUMMARY ===');
let purposeProven = true;
for (const s of toRun) {
  const v = summary.find((x) => x.scenario === s.id && x.mode === 'vtfkb');
  const base = summary.find((x) => x.scenario === s.id && x.mode !== 'vtfkb');
  // Purpose is demonstrated when vtfkb PASSES and the baseline does NOT.
  const demonstrated = v?.pass && base && !base.pass;
  if (!demonstrated) purposeProven = false;
  console.log(
    `${s.id}: vtfkb=${v?.pass ? 'PASS' : 'fail'} baseline(${base?.mode})=${base?.pass ? 'PASS' : 'fail'} ` +
      `-> ${demonstrated ? 'PURPOSE DEMONSTRATED (vtfkb passes, baseline fails)' : 'inconclusive'}`,
  );
}
console.log(`\nOVERALL: ${purposeProven ? 'vtfkb purpose demonstrated across scenarios' : 'INCONCLUSIVE — review above'}`);
process.exit(purposeProven ? 0 : 1);
