#!/usr/bin/env node
// L4 PURPOSE harness — proves vtfkb fulfils its PURPOSE, not just that its modules
// work. It drives a REAL agent through tasks whose correct outcome depends on vtfkb's
// knowledge, asserts on OBSERVABLE EFFECTS (what the agent outputs — never
// self-report), and CONTRASTS against a baseline so the improvement is shown to be
// *caused* by vtfkb:
//   - baseline 'naive' = a mykb-v1-style flat, unfiltered, load-order memory
//     (injected via --append-system-prompt) — surfaces stale/superseded/expired.
//   - baseline 'none'  = no memory at all — the agent simply lacks the knowledge.
//
// Default agent = DeepSeek-V4 via pi (pi --provider deepseek --model deepseek-v4-pro).
// Override with VTFKB_L4_MODEL / VTFKB_L4_PROVIDER. Requires DEEPSEEK_TOKEN + a built
// dist/. LIVE + token-cost + nondeterministic → NOT part of `npm test`.
//
// Run:  node scenarios/l4-purpose.mjs                 (all scenarios)
//       node scenarios/l4-purpose.mjs stale-host      (subset by id)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
const CLI = join(REPO, 'dist', 'cli.js');
const EXT = join(REPO, 'dist', 'pi-extension.js');
const PROVIDER = process.env.VTFKB_L4_PROVIDER || 'deepseek';
const MODEL = process.env.VTFKB_L4_MODEL || 'deepseek-v4-pro';
const TIMEOUT = 175_000;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}
// Seed the brain via the REAL engine write path. Returns the new entry id.
function kb(brain, args) {
  return sh('node', [CLI, ...args], { env: { ...process.env, VTFKB_DIR: brain } }).trim();
}
const idOf = (line) => line.split('\t')[0];

function naiveDump(brain, limit) {
  const args = [CLI, 'context-block-naive', 'l4'];
  if (limit) args.push('--limit', String(limit));
  return sh('node', args, { env: { ...process.env, VTFKB_DIR: brain } });
}

// Run the agent (DeepSeek via pi). mode: 'vtfkb' (real extension injection) |
// 'naive' (flat dump via --append-system-prompt) | 'none' (no memory).
// naiveLimit truncates the naive memory load-order (reproduces budget-drops-newest).
function ask(brain, mode, prompt, naiveLimit) {
  const base = ['-p', '--provider', PROVIDER, '--model', MODEL, '--no-tools'];
  let args;
  if (mode === 'vtfkb') args = [...base, '-e', EXT, prompt];
  else if (mode === 'naive') args = [...base, '--append-system-prompt', naiveDump(brain, naiveLimit), prompt];
  else args = [...base, prompt];
  const sid = `l4-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  try {
    return sh('pi', args, {
      cwd: tmpdir(),
      timeout: TIMEOUT,
      env: { ...process.env, VTFKB_DIR: brain, VTFKB_PROJECT: 'l4', KB_SESSION_ID: sid },
    }).trim();
  } catch (e) {
    return `__ERROR__ ${(e && e.message) || e}`;
  }
}

const has = (s, ...ts) => ts.every((t) => new RegExp(`\\b${t}\\b`, 'i').test(s));
const lacks = (s, ...ts) => ts.every((t) => !new RegExp(`\\b${t}\\b`, 'i').test(s));

// ---- Scenarios (broad: 3 stale-exclusion mechanisms + 4 knowledge/constraint kinds) ----
const scenarios = [
  {
    id: 'stale-supersession',
    purpose: 'Supersession excludes the stale decision; the corrected value is delivered.',
    baseline: 'naive',
    naiveLimit: 1, // load-order memory keeps the older (superseded) host, drops the fix
    seed(b) {
      const old = kb(b, ['add', 'decision', 'The prod database host is db-prod-7f3a2.internal.example', '--role', 'human', '--status', 'accepted']);
      kb(b, ['supersede', idOf(old), 'The prod database host is db-prod-9c814.internal.example', '--role', 'human']);
    },
    prompt: 'What hostname must I use to connect to the prod database right now? Reply with ONLY the hostname.',
    assert: (o) => ({ pass: has(o, '9c814') && lacks(o, '7f3a2'), detail: has(o, '9c814') ? (has(o, '7f3a2') ? 'BOTH' : 'corrected') : has(o, '7f3a2') ? 'STALE!' : 'neither' }),
  },
  {
    id: 'stale-expiry',
    purpose: 'An expired (valid_until) fact is excluded; the current one is delivered.',
    baseline: 'naive',
    naiveLimit: 1, // load-order memory keeps the older (expired) host, drops the current
    seed(b) {
      kb(b, ['add', 'fact', 'The API base host is api-a1k4.example', '--role', 'human', '--valid-until', '2025-01-01']);
      kb(b, ['add', 'fact', 'The API base host is api-b2x9.example', '--role', 'human']);
    },
    prompt: 'What is the CURRENT API base host? Reply with ONLY the host.',
    assert: (o) => ({ pass: has(o, 'api-b2x9') && lacks(o, 'api-a1k4'), detail: has(o, 'api-b2x9') ? (has(o, 'api-a1k4') ? 'BOTH' : 'current') : 'wrong/none' }),
  },
  {
    id: 'deprecated-excluded',
    purpose: 'A deprecated decision is excluded; the active choice is delivered.',
    baseline: 'naive',
    naiveLimit: 1, // load-order memory keeps the older (deprecated) entry
    seed(b) {
      // non-semantic library names so the agent cannot guess "active" from the label
      kb(b, ['add', 'decision', 'Use auth library libZapff for new modules', '--role', 'human', '--status', 'deprecated']);
      kb(b, ['add', 'decision', 'Use auth library libQwline for new modules', '--role', 'human', '--status', 'accepted']);
    },
    prompt: 'Which auth library should a new module use? Reply with ONLY the library name.',
    assert: (o) => ({ pass: has(o, 'libQwline') && lacks(o, 'libZapff'), detail: has(o, 'libQwline') ? (has(o, 'libZapff') ? 'BOTH' : 'active') : has(o, 'libZapff') ? 'DEPRECATED!' : 'none' }),
  },
  {
    id: 'constitution-port',
    purpose: 'A constitutional rule binds behavior even against the model\'s default.',
    baseline: 'none',
    seed(b) {
      kb(b, ['add', 'decision', 'House policy: every new internal HTTP service MUST listen on port 8472 — never a conventional default such as 8080/3000/80.', '--role', 'human', '--status', 'accepted', '--constitutional']);
    },
    prompt: 'We are scaffolding a new internal HTTP service. Which TCP port should it listen on? Reply with ONLY the port number.',
    assert: (o) => ({ pass: has(o, '8472') && lacks(o, '8080', '3000', '8000', '5000'), detail: has(o, '8472') ? 'policy' : 'default/other' }),
  },
  {
    id: 'knowledge-delivery',
    purpose: 'Project knowledge the model cannot know is delivered and used.',
    baseline: 'none',
    seed(b) {
      kb(b, ['add', 'fact', 'Our internal deploy command is: vfship --wave canary', '--role', 'human']);
    },
    prompt: 'What is the exact command to deploy our app? Reply with ONLY the command.',
    assert: (o) => ({ pass: has(o, 'vfship'), detail: has(o, 'vfship') ? 'used project cmd' : 'guessed/none' }),
  },
  {
    id: 'gotcha-guidance',
    purpose: 'An operational gotcha changes how the agent solves a task.',
    baseline: 'none',
    seed(b) {
      kb(b, ['add', 'gotcha', 'Our /healthz endpoint returns HTTP 200 even when the database is down; the only reliable signal is the JSON body field db_ok being true.', '--role', 'human']);
    },
    prompt: 'How do I reliably tell whether our service\'s database is up, using the health endpoint? Be specific about exactly what to check.',
    assert: (o) => ({ pass: has(o, 'db_ok'), detail: has(o, 'db_ok') ? 'checks db_ok body' : 'relies on status only' }),
  },
  {
    id: 'vision-format',
    purpose: 'A vision/taste pattern dictates an arbitrary house style.',
    baseline: 'none',
    seed(b) {
      kb(b, ['add', 'pattern', 'House style: every CLI error line MUST be formatted exactly as ERR:<code> (e.g. ERR:42) — never a prose sentence.', '--role', 'human', '--tag', 'vision']);
    },
    prompt: 'Print the single line our CLI should output for error code 42. Output only that line.',
    assert: (o) => ({ pass: /ERR:\s?42/i.test(o), detail: /ERR:\s?42/i.test(o) ? 'house format' : 'other format' }),
  },
];

// ---- Run ----
console.log(`=== vtfkb L4 PURPOSE harness — agent: pi/${PROVIDER}/${MODEL} ===`);
console.log('(live; external-effect assertions; vtfkb vs baseline contrast)\n');
const only = process.argv.slice(2);
const toRun = only.length ? scenarios.filter((s) => only.includes(s.id)) : scenarios;
const summary = [];
for (const s of toRun) {
  console.log(`# ${s.id} — ${s.purpose}`);
  for (const mode of ['vtfkb', s.baseline]) {
    const brain = mkdtempSync(join(tmpdir(), `vtfkb-l4-${s.id}-${mode}-`));
    s.seed(brain);
    const out = ask(brain, mode, s.prompt, s.naiveLimit);
    const r = s.assert(out);
    const expectPass = mode === 'vtfkb';
    const verdict = r.pass === expectPass ? 'as-expected' : 'UNEXPECTED';
    console.log(`  [${mode.padEnd(6)}] ${r.pass ? 'PASS' : 'fail'} (${r.detail}) [${verdict}]  ::  ${out.replace(/\s+/g, ' ').slice(0, 110)}`);
    summary.push({ id: s.id, mode, pass: r.pass });
    rmSync(brain, { recursive: true, force: true });
  }
  console.log('');
}

console.log('=== SUMMARY (purpose demonstrated = vtfkb PASS and baseline fail) ===');
let demonstrated = 0;
for (const s of toRun) {
  const v = summary.find((x) => x.id === s.id && x.mode === 'vtfkb');
  const base = summary.find((x) => x.id === s.id && x.mode === s.baseline);
  const ok = v?.pass && base && !base.pass;
  if (ok) demonstrated++;
  console.log(`${ok ? 'DEMONSTRATED' : 'inconclusive'}  ${s.id}: vtfkb=${v?.pass ? 'PASS' : 'fail'}  baseline(${s.baseline})=${base?.pass ? 'PASS' : 'fail'}`);
}
console.log(`\nOVERALL: ${demonstrated}/${toRun.length} scenarios demonstrate vtfkb's purpose.`);
process.exit(demonstrated === toRun.length ? 0 : 1);
