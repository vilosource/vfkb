#!/usr/bin/env node
// ============================================================================
// vfkb STALE-PIN-FLOOR L4 purpose scenario (vfkb#386; ADR-0084 DoD item 3; RFC-043 Part A)
// ----------------------------------------------------------------------------
// Proves the PURPOSE of RFC-043 Part A: a session that starts behind a stale pin LEARNS
// what moved — the commits since the handoff are rendered under `## Last handoff` — with
// no shell and no git, so the render is its only channel.
//
// ARMS
//   treatment        pinned handoff, then a later non-brain commit whose subject carries a
//                    random sentinel. Built engine. → the SessionStart render lists it, and
//                    the agent names it (≥2/3).
//   contrast         the same sandbox, the BASELINE engine (pre-build, merge-base `main`) on
//                    every face — the SessionStart hook AND the vfkb MCP server (decide D6:
//                    kb_resume would otherwise leak the annotation; no production flag).
//                    → the agent cannot name it (≤1/3, strictly below treatment).
//   squash-negative  the pin rides a squash merge, nothing after. Built engine. → the render
//                    shows `## Last handoff` and the pin's own sentinel, and NO "Commits
//                    since this handoff" (hook output, 3/3).
//   mcp-resume       DIAGNOSTIC only (decide D10): treatment's sandbox with SessionStart NOT
//                    wired; the agent is told to call kb_resume. Shows whether the MCP face,
//                    started by the harness, resolves the repo and carries the annotation.
//
// The agent has NO built-in tools (`--tools ""`) and only the vfkb MCP server
// (`--strict-mcp-config`). UserPromptSubmit is NOT wired, so the sentinel has no second
// channel. Claude Code's own git-status snapshot (recent commit subjects in the system
// prompt) IS a second channel — the first RED run's contrast arm named the sentinel 3/3
// from it ("Based on the git context provided") — so it is turned off with
// CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1 plus `includeGitInstructions: false` (CLI 2.1.292
// gates the snapshot on both). The contrast arm is what keeps this honest: any remaining
// channel shows up as a contrast leak. VERDICT: scenarios/lib/floor-verdict.mjs (pure, unit-tested).
//
// ISOLATION: the user-scope vfkb plugin is disabled per sandbox and asserted off from the
// stream-json init event (brain gotcha fb712c13f39e); the init tool list must be vfkb MCP
// tools only; modelUsage must show only the pinned model (ADR-0050). The engine is
// VFKB_SPF_CLI / VFKB_SPF_MCP (default: this checkout's dist/bundles/ — run
// `npm run build:bundles`), so the scenario re-runs against a vendored plugin bundle. The
// contrast engine is built from VFKB_SPF_BASELINE_REV (default: merge-base with
// origin/main) unless VFKB_SPF_CONTRAST_CLI / VFKB_SPF_CONTRAST_MCP are set.
//
// LIVE + metered (Claude Max-subscription OAuth). One run at a time. NOT part of npm test.
//   node scenarios/stale-pin-floor.mjs                 # GREEN → records/stale-pin-floor.json
//   VFKB_SPF_RED=1 node scenarios/stale-pin-floor.mjs  # RED: every arm on the baseline engine
//   VFKB_SPF_ARMS=treatment VFKB_SPF_TRIALS=1 …        # a subset (→ .partial)
// ============================================================================
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ARMS, DIAGNOSTIC_ARMS, MAX_ATTEMPTS_PER_ARM, RUN_MARKER, VALID_PER_ARM, BLOCK_LEAD, recordName, runVerdict, scoreTrial } from './lib/floor-verdict.mjs';
import { baselineEngine, defaultBaselineRev, sha256 } from './lib/baseline-engine.mjs';

const REPO = resolve(process.argv[1], '../..');
const RED = process.env.VFKB_SPF_RED === '1';
const MODEL = process.env.VFKB_SPF_MODEL || 'claude-haiku-4-5';
const TIMEOUT = parseInt(process.env.VFKB_SPF_TIMEOUT || '240000', 10);
const DEBUG = !!process.env.VFKB_SPF_DEBUG;
const ONLY = (process.env.VFKB_SPF_ARMS || '').split(',').filter(Boolean);
const PER_ARM = Math.max(1, parseInt(process.env.VFKB_SPF_TRIALS || String(VALID_PER_ARM), 10));

const BUILT = {
  cli: resolve(process.env.VFKB_SPF_CLI || join(REPO, 'dist', 'bundles', 'vfkb.mjs')),
  mcp: resolve(process.env.VFKB_SPF_MCP || join(REPO, 'dist', 'bundles', 'vfkb-mcp.mjs')),
};
const needBaseline = RED || !(process.env.VFKB_SPF_CONTRAST_CLI && process.env.VFKB_SPF_CONTRAST_MCP);
const baseline = needBaseline ? baselineEngine(REPO, process.env.VFKB_SPF_BASELINE_REV || defaultBaselineRev(REPO)) : null;
const CONTRAST = {
  cli: resolve(process.env.VFKB_SPF_CONTRAST_CLI || baseline.cli),
  mcp: resolve(process.env.VFKB_SPF_CONTRAST_MCP || baseline.mcp),
};
const engineFor = (arm) => (RED || arm === 'contrast' ? CONTRAST : BUILT);
for (const f of [BUILT.cli, BUILT.mcp, CONTRAST.cli, CONTRAST.mcp])
  if (!existsSync(f)) {
    console.error(`no engine at ${f} — run npm run build:bundles (or set VFKB_SPF_*)`);
    process.exit(2);
  }

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const iso = (offsetS) => new Date(Date.now() + offsetS * 1000).toISOString();

function settings(engine, log, wireSessionStart) {
  const inner = `echo ${q(RUN_MARKER)} >> ${q(log)}; VFKB_DATA_DIR=.vfkb VFKB_PROJECT=spf node ${q(engine.cli)} hook session-start | tee -a ${q(log)}; echo >> ${q(log)}`;
  const hooks = wireSessionStart ? { SessionStart: [{ hooks: [{ type: 'command', command: `sh -c ${q(inner)}` }] }] } : {};
  return JSON.stringify({ enabledPlugins: { 'vfkb@vfkb': false }, includeGitInstructions: false, hooks }, null, 2);
}

function makeSandbox(arm) {
  const engine = engineFor(arm);
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-spf-'));
  const logDir = mkdtempSync(join(tmpdir(), 'vfkb-spf-logs-'));
  for (const d of ['src', '.vfkb', '.claude']) mkdirSync(join(dir, d));
  const env = { ...process.env, VFKB_DATA_DIR: '.vfkb', VFKB_PROJECT: 'spf' };
  delete env.KB_SESSION_ID;
  const cli = (...a) => sh('node', [engine.cli, ...a], { cwd: dir, env, stdio: ['ignore', 'pipe', 'ignore'] });
  const git = (a, when) =>
    sh('git', a, {
      cwd: dir,
      env: { ...process.env, ...(when ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}) },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  const pinSentinel = `heron-${randomBytes(3).toString('hex')}`;
  const commitSentinel = `kestrel-${randomBytes(3).toString('hex')}`;
  writeFileSync(join(dir, 'src/app.ts'), 'export const app = () => "hello";\n');
  writeFileSync(join(dir, '.gitignore'), 'mcp.json\n.claude/\n.vfkb/.sessions/\n.vfkb/.signals/\n.vfkb/.journal/\n.vfkb/.lock\n.vfkb/index-meta.json\n');
  // The MCP server is the arm's engine too (decide D6). Absolute brain path: the plugin's
  // expanded ${CLAUDE_PROJECT_DIR}/.vfkb shape (decide D10).
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { vfkb: { command: 'node', args: [engine.mcp], env: { VFKB_DATA_DIR: join(dir, '.vfkb'), VFKB_PROJECT: 'spf' } } } }));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  git(['add', '.']);
  git(['commit', '-qm', 'seed'], iso(-120));
  const pinText = `handoff: the app scaffold is in place. next: review the ${pinSentinel} checklist.`;
  if (arm === 'squash-negative') {
    git(['checkout', '-q', '-b', 'feat/topic']);
    cli('add', 'fact', pinText, '--tag', 'handoff,next', '--role', 'human');
    writeFileSync(join(dir, 'src/greeter.ts'), 'export const greet = (n: string) => `Hello, ${n}!`;\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'feat: greeter, with the handoff'], iso(30));
    git(['checkout', '-q', 'main']);
    git(['merge', '-q', '--squash', 'feat/topic']);
    git(['commit', '-qm', 'feat: greeter (#1)'], iso(60));
    git(['checkout', '-q', '-b', 'feat/after-merge']);
  } else {
    git(['checkout', '-q', '-b', 'feat/work']);
    cli('add', 'fact', pinText, '--tag', 'handoff,next', '--role', 'human');
    git(['add', '.vfkb/entries.jsonl']);
    git(['commit', '-qm', 'vfkb: handoff'], iso(30));
    writeFileSync(join(dir, `src/${commitSentinel}.ts`), 'export const x = 1;\n');
    git(['add', '-A']);
    git(['commit', '-qm', `feat: add the ${commitSentinel} module`], iso(90)); // authored after the pin
  }
  const log = join(logDir, 'session-start.log');
  writeFileSync(join(dir, '.claude/settings.json'), settings(engine, log, arm !== 'mcp-resume'));
  return { dir, logDir, log, pinSentinel, commitSentinel: arm === 'squash-negative' ? null : commitSentinel, engine };
}

function inspectStream(stdout) {
  let init = null;
  let result = null;
  const toolCalls = [];
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
    if (e.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'tool_use') toolCalls.push(c.name);
  }
  const reasons = [];
  if (!init) reasons.push('no init event');
  else {
    const p = (init.plugins || []).filter((x) => x && (x.source === 'vfkb@vfkb' || x.name === 'vfkb'));
    if (p.length) reasons.push(`plugin loaded: ${p.map((x) => `${x.source}@${x.version}`).join(',')}`);
    const other = (init.tools || []).map(String).filter((t) => !t.startsWith('mcp__vfkb__'));
    if (other.length) reasons.push(`agent had non-vfkb tools: ${other.slice(0, 5).join(',')}`);
  }
  const models = Object.keys(result?.modelUsage || {});
  if (!result) reasons.push('no result event');
  else if (models.length !== 1 || models[0] !== MODEL) reasons.push(`modelUsage=${JSON.stringify(models)} ≠ ${MODEL}`);
  return { reasons, result, toolCalls, cliVersion: init?.claude_code_version || null, initTools: init?.tools ?? null };
}

const ASK =
  'Which git commits landed in this repository after the last recorded handoff? Answer only from what is ' +
  'already in your context or from the vfkb tools. Quote each commit subject exactly. If you cannot tell, ' +
  'reply exactly: UNKNOWN.';
const ASK_MCP = `Call the kb_resume tool first. ${ASK}`;

function runTrial(arm) {
  const sb = makeSandbox(arm);
  const args = ['-p', arm === 'mcp-resume' ? ASK_MCP : ASK, '--session-id', randomUUID(), '--tools', '', '--strict-mcp-config',
    '--mcp-config', join(sb.dir, 'mcp.json'), '--settings', join(sb.dir, '.claude/settings.json'),
    '--dangerously-skip-permissions', '--model', MODEL, '--output-format', 'stream-json', '--verbose'];
  let stdout = '';
  let err = '';
  try {
    stdout = sh('claude', args, {
      cwd: sb.dir,
      timeout: TIMEOUT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: '1' },
    });
  } catch (e) {
    err = String(e.stderr || e.message || '').replace(/\s+/g, ' ').slice(0, 200);
    stdout = String(e.stdout || '');
  }
  const t = inspectStream(stdout);
  const log = existsSync(sb.log) ? readFileSync(sb.log, 'utf8') : arm === 'mcp-resume' ? null : '';
  const answer = String(t.result?.result ?? '');
  const leak = [];
  if (sb.commitSentinel && existsSync(join(REPO, `src/${sb.commitSentinel}.ts`))) {
    rmSync(join(REPO, `src/${sb.commitSentinel}.ts`));
    leak.push(`src/${sb.commitSentinel}.ts`);
  }
  const scored = scoreTrial({
    arm,
    isolationReasons: t.reasons,
    leak,
    engaged: !!t.result,
    sessionStartLog: log,
    answer,
    commitSentinel: sb.commitSentinel ?? `absent-${randomBytes(4).toString('hex')}`,
    pinSentinel: sb.pinSentinel,
  });
  if (DEBUG) {
    mkdirSync(join(REPO, 'scenarios/records/debug'), { recursive: true });
    writeFileSync(join(REPO, `scenarios/records/debug/spf.${arm}.${sb.pinSentinel}.txt`), `${stdout}\n--- ERR ${err}\n=== SESSIONSTART ===\n${log}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
  rmSync(sb.logDir, { recursive: true, force: true });
  // The render's Last-handoff section, unescaped, for the record (diagnostic).
  let section = null;
  try {
    const ctx = JSON.parse((log ?? '').split('\n').find((l) => l.startsWith('{')) ?? 'null')?.hookSpecificOutput?.additionalContext ?? '';
    const i = ctx.indexOf('## Last handoff');
    section = i < 0 ? null : ctx.slice(i, ctx.indexOf('<vfkb-map>', i));
  } catch {
    section = null;
  }
  return {
    ...scored,
    pinSentinel: sb.pinSentinel,
    commitSentinel: sb.commitSentinel,
    engineCli: sb.engine.cli,
    // Diagnostics, never predicates.
    renderSection: section,
    renderHasBlock: typeof log === 'string' && log.includes(BLOCK_LEAD),
    toolCalls: t.toolCalls,
    answer: answer.slice(0, 1500),
    errors: err ? [err] : [],
    cliVersion: t.cliVersion,
    initTools: t.initTools,
  };
}

const allArms = [...ARMS, ...DIAGNOSTIC_ARMS];
const arms = ONLY.length ? allArms.filter((a) => ONLY.includes(a)) : allArms;
console.log(
  `vfkb stale-pin-floor L4  (model=${MODEL}, ${RED ? 'RED: baseline on every arm' : 'build'}; built=${BUILT.cli}; contrast=${CONTRAST.cli}${baseline ? ` @ ${baseline.rev.slice(0, 7)}` : ''})`,
);
const trials = Object.fromEntries(allArms.map((a) => [a, []]));
for (const arm of arms) {
  let valid = 0;
  const cap = RED ? PER_ARM : MAX_ATTEMPTS_PER_ARM;
  for (let attempt = 1; attempt <= cap && valid < PER_ARM; attempt++) {
    process.stdout.write(`  ${arm.padEnd(15)} attempt ${attempt} … `);
    const r = runTrial(arm);
    trials[arm].push(r);
    if (r.invalid.length === 0) valid++;
    console.log(
      `${r.invalid.length ? 'INVALID ' : ''}${r.pass ? 'PASS' : 'no'}  named=${r.named} block=${r.renderHasBlock} tools=${r.toolCalls.join(',') || '-'}` +
        `${r.deterministicFail.length ? '  DET-FAIL: ' + r.deterministicFail.join('; ') : ''}${r.invalid.length ? '  ✗ ' + r.invalid.join('; ') : ''}`,
    );
  }
}
const scoredTrials = Object.fromEntries(
  allArms.map((a) => {
    const v = trials[a].filter((t) => t.invalid.length === 0).slice(0, VALID_PER_ARM);
    return [a, [...v, ...trials[a].filter((t) => t.invalid.length > 0)]];
  }),
);
const verdict = runVerdict(scoredTrials);
const complete = verdict.complete && ARMS.every((a) => arms.includes(a)) && PER_ARM === VALID_PER_ARM;
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
  scenario: 'stale-pin-floor',
  recordVersion: 1,
  model: MODEL,
  generated: new Date().toISOString(),
  red: RED,
  engineCli: RED ? CONTRAST.cli : BUILT.cli,
  engineMcp: RED ? CONTRAST.mcp : BUILT.mcp,
  engineRev: RED ? baseline.rev : process.env.VFKB_SPF_ENGINE_REV || gitR('rev-parse', 'HEAD'),
  engineCliSha256: sha256(RED ? CONTRAST.cli : BUILT.cli),
  engineMcpSha256: sha256(RED ? CONTRAST.mcp : BUILT.mcp),
  engineSrcDirty: RED ? false : process.env.VFKB_SPF_CLI ? null : (gitR('status', '--porcelain', '--', 'src') || '') !== '',
  contrastEngineRev: baseline?.rev ?? null,
  contrastEngineCliSha256: sha256(CONTRAST.cli),
  contrastEngineMcpSha256: sha256(CONTRAST.mcp),
  contrastNote:
    'decide D6: the contrast engine is the whole pre-#386 engine on every face (SessionStart hook + MCP server). ' +
    'Parts 0 and 1 cannot put a commit subject into the render, so the predicate is insensitive to them.',
  vfkbSha: gitR('rev-parse', 'HEAD'),
  cliVersions: [...new Set(Object.values(trials).flat().map((t) => t.cliVersion).filter(Boolean))],
  isolation:
    "enabledPlugins {'vfkb@vfkb': false}; init event asserted; --tools '' + vfkb MCP only; UserPromptSubmit not wired; " +
    'git-status snapshot off (CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1, includeGitInstructions:false)',
  thresholds: 'scenarios/lib/floor-verdict.mjs (treatment ≥2/3; contrast ≤1/3 and below treatment; render predicates 3/3; mcp-resume diagnostic)',
  verdict: { ...verdict, demonstrated: verdict.demonstrated && complete },
  trials,
};
const file = recordName('stale-pin-floor', { complete, red: RED });
mkdirSync(join(REPO, 'scenarios/records'), { recursive: true });
writeFileSync(join(REPO, 'scenarios/records', file), JSON.stringify(rec, null, 2) + '\n');
console.log(`record → scenarios/records/${file}`);
process.exit(verdict.demonstrated && complete ? 0 : 1);
