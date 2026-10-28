#!/usr/bin/env node
// ============================================================================
// vfkb STALE-HANDOFF-ANCHOR L4 purpose scenario (vfkb#386; ADR-0084 DoD item 2;
// RFC-043 Parts 0 and 1)
// ----------------------------------------------------------------------------
// Proves the PURPOSE of RFC-043 Part 0: B3 (the Stop stale-handoff nudge) no longer fires
// because a squash merge carried the pin — the deterministic false positive the review
// measured — while a commit that really landed after the pin still fires it, now with
// Part 1's new text naming that commit.
//
// SHAPE (decide step D7, ruling 54802539cda7): a sandbox repo whose topic branch commits
// a handoff (through the real CLI) together with code, squash-merged to main. The agent then
// runs THREE real `claude -p` turns on ONE session id (`--session-id`, then `--resume`
// twice) on a fresh topic branch off the merged main (so #387's 1c, which quiets B3 on a
// clean default branch, cannot break this record). Turn 3 is the first Stop B3 may speak on
// (ADR-0084 §1.1, 1a). The agent has NO tools (`--tools ""`, no MCP), so the tree stays
// clean, the brain cannot change, and the decision nudge cannot block: every Stop prints
// either `{}` or the B3 block. Wired: SessionStart, and Stop tee'd to a log outside the
// sandbox. NOT wired: UserPromptSubmit (its delivery would cool Stop-B3, ADR-0084 §2.5) and
// SessionEnd (nothing to commit).
//
// ARMS
//   squash    the squash carries the pin, nothing after   → turn-3 Stop prints {} (quiet)
//   can-fail  + one later non-brain commit with a sentinel subject, authored after the pin
//             → turn-3 Stop carries B3's NEW text listing "<sha7> <sentinel subject>"
// In both arms: the Stop hook ran on every turn (marker + parseable JSON) and was quiet on
// turns 1 and 2 (1a's boundary).
//
// VERDICT: scenarios/lib/anchor-verdict.mjs (pure, unit-tested). Hook-output predicates
// only → 3/3 valid trials per arm.
//
// HOSTS (decide D9): the squash arm uses `git merge --squash`, git's default (squash author
// date = merge time), which is what GitHub was observed to do. It proves that path, not
// GitLab/Bitbucket (vfkb#400).
//
// ISOLATION: the user-scope vfkb plugin is disabled per sandbox and asserted off from the
// stream-json init event (brain gotcha fb712c13f39e); modelUsage must show only the pinned
// model (ADR-0050). The engine is VFKB_SHA_CLI (default: this checkout's
// dist/bundles/vfkb.mjs — run `npm run build:bundles`), so the same scenario runs against
// a vendored plugin bundle. RED (VFKB_SHA_RED=1) runs the baseline engine built from the
// merge-base `main` commit (scenarios/lib/baseline-engine.mjs; override VFKB_SHA_BASELINE_REV).
//
// LIVE + metered (Claude Max-subscription OAuth). One run at a time. NOT part of npm test.
//   node scenarios/stale-handoff-anchor.mjs                 # GREEN → records/stale-handoff-anchor.json
//   VFKB_SHA_RED=1 node scenarios/stale-handoff-anchor.mjs  # RED baseline (pre-build engine)
//   VFKB_SHA_ARMS=squash VFKB_SHA_TRIALS=1 …                # a subset, for debugging (→ .partial)
// ============================================================================
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ARMS, MAX_ATTEMPTS_PER_ARM, RUN_MARKER, TURNS, VALID_PER_ARM, recordName, runVerdict, scoreTrial, invocations, B3_LEADIN } from './lib/anchor-verdict.mjs';
import { baselineEngine, defaultBaselineRev, sha256 } from './lib/baseline-engine.mjs';

const REPO = resolve(process.argv[1], '../..');
const RED = process.env.VFKB_SHA_RED === '1';
const MODEL = process.env.VFKB_SHA_MODEL || 'claude-haiku-4-5';
const TIMEOUT = parseInt(process.env.VFKB_SHA_TIMEOUT || '240000', 10);
const DEBUG = !!process.env.VFKB_SHA_DEBUG;
const ONLY = (process.env.VFKB_SHA_ARMS || '').split(',').filter(Boolean);
const PER_ARM = Math.max(1, parseInt(process.env.VFKB_SHA_TRIALS || String(VALID_PER_ARM), 10));

const baseline = RED ? baselineEngine(REPO, process.env.VFKB_SHA_BASELINE_REV || defaultBaselineRev(REPO)) : null;
const CLI = resolve(RED ? baseline.cli : process.env.VFKB_SHA_CLI || join(REPO, 'dist', 'bundles', 'vfkb.mjs'));
if (!existsSync(CLI)) {
  console.error(`no engine at ${CLI} — run npm run build:bundles (or set VFKB_SHA_CLI)`);
  process.exit(2);
}

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const iso = (offsetS) => new Date(Date.now() + offsetS * 1000).toISOString();

function teeHook(sub, log) {
  const inner = `echo ${q(RUN_MARKER)} >> ${q(log)}; VFKB_DATA_DIR=.vfkb VFKB_PROJECT=sha node ${q(CLI)} hook ${sub} | tee -a ${q(log)}; echo >> ${q(log)}`;
  return `sh -c ${q(inner)}`;
}
const plainHook = (sub) => `VFKB_DATA_DIR=.vfkb VFKB_PROJECT=sha node ${q(CLI)} hook ${sub}`;
const settings = (stopLog) =>
  JSON.stringify(
    {
      enabledPlugins: { 'vfkb@vfkb': false },
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: plainHook('session-start') }] }],
        Stop: [{ hooks: [{ type: 'command', command: teeHook('stop', stopLog) }] }],
      },
    },
    null,
    2,
  );

function makeSandbox(arm) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-sha-'));
  const logDir = mkdtempSync(join(tmpdir(), 'vfkb-sha-logs-'));
  for (const d of ['src', '.vfkb', '.claude']) mkdirSync(join(dir, d));
  const env = { ...process.env, VFKB_DATA_DIR: '.vfkb', VFKB_PROJECT: 'sha' };
  delete env.KB_SESSION_ID;
  const cli = (...a) => sh('node', [CLI, ...a], { cwd: dir, env, stdio: ['ignore', 'pipe', 'ignore'] });
  const git = (a, when) =>
    sh('git', a, {
      cwd: dir,
      env: { ...process.env, ...(when ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}) },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  writeFileSync(join(dir, 'src/app.ts'), 'export const app = () => "hello";\n');
  writeFileSync(join(dir, '.gitignore'), '.claude/\n.vfkb/.sessions/\n.vfkb/.signals/\n.vfkb/.journal/\n.vfkb/.lock\n.vfkb/index-meta.json\n');
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  git(['add', '.']);
  git(['commit', '-qm', 'seed'], iso(-120)); // strictly before the pin at git's 1 s resolution
  // The topic branch: a handoff written through the real CLI, committed WITH code.
  git(['checkout', '-q', '-b', 'feat/topic']);
  cli('add', 'fact', 'handoff: the greeter landed on feat/topic. next: wire it into app.ts.', '--tag', 'handoff,next', '--role', 'human');
  writeFileSync(join(dir, 'src/greeter.ts'), 'export const greet = (n: string) => `Hello, ${n}!`;\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'feat: greeter, with the handoff'], iso(30));
  // Squash-merge to main: the squash commit CARRIES the pin (cause 1).
  git(['checkout', '-q', 'main']);
  git(['merge', '-q', '--squash', 'feat/topic']);
  git(['commit', '-qm', 'feat: greeter (#1)'], iso(60));
  let sentinelSubject = null;
  let sentinelSha7 = null;
  if (arm === 'can-fail') {
    sentinelSubject = `fix: harden ${'sentinel-' + randomBytes(3).toString('hex')} parsing`;
    writeFileSync(join(dir, 'src/later.ts'), `export const later = ${JSON.stringify(sentinelSubject)};\n`);
    git(['add', '-A']);
    git(['commit', '-qm', sentinelSubject], iso(120)); // authored strictly after the pin
    sentinelSha7 = git(['rev-parse', 'HEAD']).trim().slice(0, 7);
  }
  // A new session branches from the merged main (decide D7).
  git(['checkout', '-q', '-b', 'feat/after-merge']);
  const stopLog = join(logDir, 'stop.log');
  writeFileSync(join(dir, '.claude/settings.json'), settings(stopLog));
  return { dir, logDir, stopLog, sentinelSubject, sentinelSha7, git };
}

function inspectStream(stdout) {
  let init = null;
  let result = null;
  for (const line of String(stdout).split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'system' && e.subtype === 'init') init = e;
    if (e.type === 'result') result = e;
  }
  const reasons = [];
  if (!init) reasons.push('no init event');
  else {
    const p = (init.plugins || []).filter((x) => x && (x.source === 'vfkb@vfkb' || x.name === 'vfkb'));
    if (p.length) reasons.push(`plugin loaded: ${p.map((x) => `${x.source}@${x.version}`).join(',')}`);
    const tools = (init.tools || []).map(String);
    if (tools.length) reasons.push(`agent had tools: ${tools.slice(0, 5).join(',')}${tools.length > 5 ? '…' : ''}`);
  }
  const models = Object.keys(result?.modelUsage || {});
  if (!result) reasons.push('no result event');
  else if (models.length !== 1 || models[0] !== MODEL) reasons.push(`modelUsage=${JSON.stringify(models)} ≠ ${MODEL}`);
  return { reasons, result, cliVersion: init?.claude_code_version || null };
}

function runTurn(sb, prompt, sessionArgs) {
  const args = ['-p', prompt, ...sessionArgs, '--tools', '', '--strict-mcp-config', '--settings', join(sb.dir, '.claude/settings.json'),
    '--dangerously-skip-permissions', '--model', MODEL, '--output-format', 'stream-json', '--verbose'];
  let stdout = '';
  let err = '';
  try {
    stdout = sh('claude', args, { cwd: sb.dir, timeout: TIMEOUT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    err = String(e.stderr || e.message || '').replace(/\s+/g, ' ').slice(0, 200);
    stdout = String(e.stdout || '');
  }
  return { stdout, err, ...inspectStream(stdout) };
}

const readText = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');

function leaks() {
  // The agent has no tools; a stray file in the real repo would mean the sandbox leaked.
  const out = [];
  for (const f of ['src/greeter.ts', 'src/later.ts']) {
    if (!existsSync(join(REPO, f))) continue;
    let st = '';
    try {
      st = sh('git', ['status', '--porcelain', '--', f], { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      st = '?? ';
    }
    if (st.startsWith('??')) {
      rmSync(join(REPO, f));
      out.push(f);
    }
  }
  return out;
}

const PROMPTS = [
  'Reply with the single word ready.',
  'Reply with the single word steady.',
  'Reply with the single word done.',
];

function runTrial(arm) {
  const sb = makeSandbox(arm);
  const sid = randomUUID();
  const turns = [];
  const segs = [];
  let offset = 0;
  for (let i = 0; i < TURNS; i++) {
    turns.push(runTurn(sb, PROMPTS[i], i === 0 ? ['--session-id', sid] : ['--resume', sid]));
    const all = readText(sb.stopLog);
    segs.push(all.slice(offset));
    offset = all.length;
  }
  const obs = {
    arm,
    isolationReasons: turns.flatMap((t, i) => t.reasons.map((r) => `t${i + 1}: ${r}`)),
    leak: leaks(),
    engaged: turns.every((t) => !!t.result),
    turnLogs: segs,
    sentinelSubject: sb.sentinelSubject,
    sentinelSha7: sb.sentinelSha7,
  };
  const scored = scoreTrial(obs);
  if (DEBUG) {
    mkdirSync(join(REPO, 'scenarios/records/debug'), { recursive: true });
    writeFileSync(
      join(REPO, `scenarios/records/debug/sha.${arm}.${sid.slice(0, 8)}.txt`),
      turns.map((t, i) => `=== TURN ${i + 1} ===\n${t.stdout}\n--- ERR ${t.err}`).join('\n') + `\n=== STOP ===\n${readText(sb.stopLog)}`,
    );
  }
  const gitLog = sb.git(['log', '--all', '--format=%h %ai %s']).trim().split('\n');
  rmSync(sb.dir, { recursive: true, force: true });
  rmSync(sb.logDir, { recursive: true, force: true });
  return {
    ...scored,
    sessionId: sid,
    sentinelSubject: sb.sentinelSubject,
    sentinelSha7: sb.sentinelSha7,
    // Diagnostics, never predicates.
    stopRunsPerTurn: segs.map((s) => invocations(s).length),
    b3PerTurn: segs.map((s) => s.includes(B3_LEADIN)),
    turn3Stop: segs[TURNS - 1].slice(0, 2500),
    gitLog,
    errors: turns.map((t) => t.err).filter(Boolean),
    cliVersion: turns.find((t) => t.cliVersion)?.cliVersion ?? null,
  };
}

const arms = ONLY.length ? ARMS.filter((a) => ONLY.includes(a)) : ARMS;
console.log(`vfkb stale-handoff-anchor L4  (model=${MODEL}, ${RED ? `RED baseline @ ${baseline.rev.slice(0, 7)}` : 'build'}; engine=${CLI})`);
const trials = Object.fromEntries(ARMS.map((a) => [a, []]));
for (const arm of arms) {
  let valid = 0;
  const cap = RED ? PER_ARM : MAX_ATTEMPTS_PER_ARM;
  for (let attempt = 1; attempt <= cap && valid < PER_ARM; attempt++) {
    process.stdout.write(`  ${arm.padEnd(9)} attempt ${attempt} … `);
    const r = runTrial(arm);
    trials[arm].push(r);
    if (r.invalid.length === 0) valid++;
    console.log(
      `${r.invalid.length ? 'INVALID ' : ''}${r.pass ? 'PASS' : 'FAIL'}  runs/turn=${r.stopRunsPerTurn.join(',')} b3/turn=${r.b3PerTurn.join(',')}` +
        `${r.deterministicFail.length ? '  DET-FAIL: ' + r.deterministicFail.join('; ') : ''}${r.invalid.length ? '  ✗ ' + r.invalid.join('; ') : ''}`,
    );
  }
}
const scoredTrials = Object.fromEntries(
  ARMS.map((a) => {
    const v = trials[a].filter((t) => t.invalid.length === 0).slice(0, VALID_PER_ARM);
    return [a, [...v, ...trials[a].filter((t) => t.invalid.length > 0)]];
  }),
);
const verdict = runVerdict(scoredTrials);
const complete = verdict.complete && arms.length === ARMS.length && PER_ARM === VALID_PER_ARM;
console.log(`\ncounts: ${JSON.stringify(verdict.counts)}`);
console.log(verdict.demonstrated && complete ? 'DEMONSTRATED' : `NOT demonstrated — ${verdict.reasons.join('; ') || 'subset run'}`);

const gitR = (...a) => {
  try {
    return sh('git', a, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const rec = {
  scenario: 'stale-handoff-anchor',
  recordVersion: 1,
  model: MODEL,
  generated: new Date().toISOString(),
  red: RED,
  engineCli: CLI,
  engineRev: RED ? baseline.rev : process.env.VFKB_SHA_ENGINE_REV || gitR('rev-parse', 'HEAD'),
  engineCliSha256: sha256(CLI),
  // The engine's own source state: a baseline is built from a clean sha-pinned worktree.
  engineSrcDirty: RED ? false : process.env.VFKB_SHA_CLI ? null : (gitR('status', '--porcelain', '--', 'src') || '') !== '',
  vfkbSha: gitR('rev-parse', 'HEAD'),
  gitVersion: sh('git', ['--version']).trim(),
  cliVersions: [...new Set(Object.values(trials).flat().map((t) => t.cliVersion).filter(Boolean))],
  isolation: "enabledPlugins {'vfkb@vfkb': false}; init event asserted; --tools '' and no MCP",
  shape: 'decide D7: 3 turns, one session id, topic branch off the merged main; SessionStart + tee\'d Stop wired; UserPromptSubmit and SessionEnd not wired',
  hosts: 'squash arm = git merge --squash (git default; observed GitHub behaviour). GitLab/Bitbucket UNVERIFIED (vfkb#400).',
  thresholds: 'hook-output predicates: 3/3 valid trials per arm (scenarios/lib/anchor-verdict.mjs)',
  verdict: { ...verdict, demonstrated: verdict.demonstrated && complete },
  trials,
};
const file = recordName('stale-handoff-anchor', { complete, red: RED });
mkdirSync(join(REPO, 'scenarios/records'), { recursive: true });
writeFileSync(join(REPO, 'scenarios/records', file), JSON.stringify(rec, null, 2) + '\n');
console.log(`record → scenarios/records/${file}`);
process.exit(verdict.demonstrated && complete ? 0 : 1);
