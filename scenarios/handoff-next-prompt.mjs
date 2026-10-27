#!/usr/bin/env node
// ============================================================================
// vfkb HANDOFF-NEXT-PROMPT L4 purpose scenario (vfkb#385, ADR-0084 DoD item 1)
// ----------------------------------------------------------------------------
// Proves the PURPOSE of ADR-0084 §2: the standing handoff reminder rides the NEXT user
// prompt as one non-blocking UserPromptSubmit `additionalContext` line, and the agent,
// with that prompt in hand, judges it — a wrap-up prompt yields an agent-authored
// handoff, a mid-session prompt does not, and Stop no longer blocks for B1/B3.
//
// SHAPE (decide step Q5): two `claude -p` turns on ONE session id (`--session-id`, then
// `--resume`). Turn 1 is a pure work prompt with no line (Q2: a persisted session's first
// prompt never carries it). Between turns the harness makes the trigger true — a plain
// non-brain commit (stale arms) or uncommitted src/ work plus 3 brain entries (B1 arm) —
// so the only line of the session rides the turn-2 prompt whose behaviour is asserted.
// SessionEnd is wired on turn 2 only (ADR-0084 DoD 1: on turn 1 it would auto-commit the
// brain and write an `auto` pin).
//
// ARMS
//   treatment-stale  stale pin; turn 2 = wrap-up       → agent handoff carrying the sentinel
//   treatment-b1     B1's condition; turn 2 = wrap-up  → agent handoff carrying the sentinel
//   contrast         treatment-stale, NO UserPromptSubmit entry, B2 wired → no agent handoff
//   negative         treatment-stale, turn 2 = mid-session task           → no agent handoff
// In every arm the Stop hook's stdout is tee'd: ≥1 invocation and neither B1 nor B3 text.
//
// VERDICT: scenarios/lib/nudge-verdict.mjs (pure, unit-tested). Diagnostics per trial
// (decide step Q3, never predicates): upsEmitted, upsLine, finalAnswer.
//
// ISOLATION: the user-scope vfkb plugin is disabled per sandbox and asserted off from the
// stream-json init event (brain gotcha fb712c13f39e); modelUsage must show only the pinned
// model (ADR-0050). The engine under test is VFKB_HNP_CLI / VFKB_HNP_MCP (default: this
// repo's dist/), so the same scenario runs against a vendored plugin bundle.
//
// LIVE + metered (Claude Max-subscription OAuth). One run at a time. NOT part of npm test.
//   node scenarios/handoff-next-prompt.mjs                 # GREEN run → records/handoff-next-prompt.json
//   VFKB_HNP_RED=1 node scenarios/handoff-next-prompt.mjs  # RED baseline (pre-build engine)
//   VFKB_HNP_ARMS=negative VFKB_HNP_TRIALS=1 …             # a subset, for debugging (→ .partial)
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ARMS, MAX_ATTEMPTS_PER_ARM, VALID_PER_ARM, RUN_MARKER, PROMPT_LINE_LEADIN, scoreTrial, runVerdict, recordName, hasLine } from './lib/nudge-verdict.mjs';

const REPO = resolve(process.argv[1], '../..');
const CLI = resolve(process.env.VFKB_HNP_CLI || join(REPO, 'dist', 'cli.js'));
const MCP = resolve(process.env.VFKB_HNP_MCP || join(REPO, 'dist', 'mcp-server.js'));
const MODEL = process.env.VFKB_HNP_MODEL || 'claude-haiku-4-5';
const TIMEOUT = parseInt(process.env.VFKB_HNP_TIMEOUT || '300000', 10);
const RED = process.env.VFKB_HNP_RED === '1';
const DEBUG = !!process.env.VFKB_HNP_DEBUG;
const ONLY = (process.env.VFKB_HNP_ARMS || '').split(',').filter(Boolean);
const PER_ARM = Math.max(1, parseInt(process.env.VFKB_HNP_TRIALS || String(VALID_PER_ARM), 10));
const LEAK_FILES = ['src/format-date.ts', 'docs/notes.md']; // + the per-trial src/<sentinel>.ts

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// A hook command whose stdout is tee'd to a log OUTSIDE the sandbox (the agent never sees
// it). The RUN_MARKER line proves the hook ran even when it printed nothing.
function teeHook(sub, log) {
  const inner = `echo ${q(RUN_MARKER)} >> ${q(log)}; VFKB_DATA_DIR=.vfkb VFKB_PROJECT=hnp node ${q(CLI)} hook ${sub} | tee -a ${q(log)}; echo >> ${q(log)}`;
  return `sh -c ${q(inner)}`;
}
const plainHook = (sub) => `VFKB_DATA_DIR=.vfkb VFKB_PROJECT=hnp node ${q(CLI)} hook ${sub}`;

function settings({ ups, sessionEnd, logs }) {
  const hooks = {
    SessionStart: [{ hooks: [{ type: 'command', command: plainHook('session-start') }] }],
    PreToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: plainHook('pre-tool-use') }] }],
    Stop: [{ hooks: [{ type: 'command', command: teeHook('stop', logs.stop) }] }],
  };
  if (ups) hooks.UserPromptSubmit = [{ hooks: [{ type: 'command', command: teeHook('user-prompt-submit', logs.ups) }] }];
  if (sessionEnd) hooks.SessionEnd = [{ hooks: [{ type: 'command', command: plainHook('session-end') }] }];
  return JSON.stringify({ enabledPlugins: { 'vfkb@vfkb': false }, hooks }, null, 2);
}

function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-hnp-'));
  const logDir = mkdtempSync(join(tmpdir(), 'vfkb-hnp-logs-'));
  for (const d of ['src', 'docs', '.vfkb', '.claude']) mkdirSync(join(dir, d));
  writeFileSync(join(dir, 'src/app.ts'), 'export const app = () => "hello";\n');
  writeFileSync(join(dir, 'docs/README.md'), '# app\n');
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({
    mcpServers: { vfkb: { command: 'node', args: [MCP], env: { VFKB_DATA_DIR: '.vfkb', VFKB_PROJECT: 'hnp' } } },
  }));
  const env = { ...process.env, VFKB_DATA_DIR: '.vfkb', VFKB_PROJECT: 'hnp' };
  delete env.KB_SESSION_ID;
  const cli = (...a) => sh('node', [CLI, ...a], { cwd: dir, env, stdio: ['ignore', 'pipe', 'ignore'] });
  const git = (a, extraEnv = {}) => sh('git', a, { cwd: dir, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'ignore'] });
  cli('add', 'fact', 'sandbox baseline: a tiny TypeScript app', '--role', 'human');
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  writeFileSync(join(dir, '.gitignore'), 'mcp.json\n.claude/\n.vfkb/.sessions/\n.vfkb/.signals/\n.vfkb/.journal/\n.vfkb/.lock\n.vfkb/index-meta.json\n');
  git(['add', '.']);
  // Backdated ~60 s so the pin (written now) is strictly after it at git's 1 s resolution.
  const past = new Date(Date.now() - 60_000).toISOString();
  git(['commit', '-qm', 'seed'], { GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past });
  git(['checkout', '-q', '-b', 'feat/work']); // B2 commits only on a topic branch
  // The pin: an operator handoff written after the seed, committed brain-only (not stale).
  cli('add', 'fact', 'handoff: the app scaffold is in place. next: add a greeter module.', '--tag', 'handoff,next', '--role', 'human');
  git(['add', '.vfkb/entries.jsonl']);
  git(['commit', '-qm', 'vfkb: handoff']);
  return { dir, logDir, cli, git, logs: { stop: join(logDir, 'stop.log'), ups: join(logDir, 'ups.log') } };
}

function inspectStream(stdout) {
  let init = null, result = null;
  for (const line of String(stdout).split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'system' && e.subtype === 'init') init = e;
    if (e.type === 'result') result = e;
  }
  const reasons = [];
  if (!init) reasons.push('no init event');
  else {
    const p = (init.plugins || []).filter((x) => x && (x.source === 'vfkb@vfkb' || x.name === 'vfkb'));
    const t = (init.tools || []).filter((x) => String(x).startsWith('mcp__plugin_vfkb_'));
    if (p.length) reasons.push(`plugin loaded: ${p.map((x) => `${x.source}@${x.version}`).join(',')}`);
    if (t.length) reasons.push(`plugin tools: ${t.length}`);
  }
  const models = Object.keys(result?.modelUsage || {});
  if (!result) reasons.push('no result event');
  else if (models.length !== 1 || models[0] !== MODEL) reasons.push(`modelUsage=${JSON.stringify(models)} ≠ ${MODEL}`);
  return { reasons, result, cliVersion: init?.claude_code_version || null };
}

function runTurn(sb, prompt, sessionArgs) {
  const args = ['-p', prompt, ...sessionArgs, '--strict-mcp-config', '--mcp-config', join(sb.dir, 'mcp.json'),
    '--settings', join(sb.dir, '.claude/settings.json'), '--dangerously-skip-permissions', '--model', MODEL,
    '--output-format', 'stream-json', '--verbose'];
  let stdout = '', err = '';
  try { stdout = sh('claude', args, { cwd: sb.dir, timeout: TIMEOUT, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { err = String(e.stderr || e.message || '').replace(/\s+/g, ' ').slice(0, 200); stdout = String(e.stdout || ''); }
  return { stdout, err, ...inspectStream(stdout) };
}

const readText = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const entries = (dir) => readText(join(dir, '.vfkb/entries.jsonl')).split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return {}; } });

function leaks(extra) {
  const out = [];
  for (const f of [...LEAK_FILES, ...extra]) {
    if (!existsSync(join(REPO, f))) continue;
    let st = '';
    try { st = sh('git', ['status', '--porcelain', '--', f], { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { st = '?? '; }
    if (st.startsWith('??')) { rmSync(join(REPO, f)); out.push(f); }
  }
  return out;
}

function runTrial(arm) {
  // The session sentinel is the module the agent creates on turn 1, so a handoff that names
  // "what changed" carries it naturally (the RED run's handoffs all named the file).
  const sentinel = `greeter-${randomBytes(3).toString('hex')}`;
  const file = `src/${sentinel}.ts`;
  const sb = makeSandbox();
  const sid = randomUUID();
  const wired = arm !== 'contrast';
  const setTurn = (turn) => writeFileSync(join(sb.dir, '.claude/settings.json'),
    settings({ ups: wired, sessionEnd: turn === 2, logs: sb.logs }));

  // Turn 1 — a pure work prompt. No line expected (Q2), no handoff asked for.
  setTurn(1);
  const t1 = runTurn(sb, `Create the file ${file} ON DISK ` +
    '(use your file-writing tool) exporting a function greet(name: string) that returns "Hello, <name>!". ' +
    'Do not commit anything. Reply "done" when the file exists.', ['--session-id', sid]);
  const ups1 = wired ? readText(sb.logs.ups) : null;
  const upsOffset = ups1?.length ?? 0;

  // Between turns: make the trigger true.
  if (arm === 'treatment-b1') {
    if (!existsSync(join(sb.dir, file))) writeFileSync(join(sb.dir, file), 'export const greet = (n: string) => `Hello, ${n}!`;\n');
    const have = entries(sb.dir).length;
    const headCount = sh('git', ['show', 'HEAD:.vfkb/entries.jsonl'], { cwd: sb.dir }).split('\n').filter(Boolean).length;
    for (let i = have - headCount; i < 3; i++) sb.cli('add', 'fact', `work note ${i + 1}: ${file} drafted`, '--role', 'executor');
  } else {
    writeFileSync(join(sb.dir, 'docs/notes.md'), `# notes\n\nrelease checklist drafted (${Date.now()})\n`);
    sb.git(['add', 'docs/notes.md']);
    sb.git(['commit', '-qm', 'docs: release checklist']);
  }
  const before = entries(sb.dir).length;

  // Turn 2 — the asserted prompt.
  setTurn(2);
  const prompt2 = arm === 'negative'
    ? 'Next: create the file src/format-date.ts ON DISK exporting formatDate(d: Date) that returns YYYY-MM-DD. Reply "done" when it exists; we will keep going after this.'
    : "That's everything for today — we're done for this session, thanks.";
  const t2 = runTurn(sb, prompt2, ['--resume', sid]);
  const upsAll = wired ? readText(sb.logs.ups) : null;
  const ups2 = wired ? upsAll.slice(upsOffset) : null;
  const all = entries(sb.dir);
  const turn2Entries = all.slice(before);
  const leak = leaks([file]);

  const upsLineMatch = ups2 && /"additionalContext":"((?:[^"\\]|\\.)*)"/.exec(ups2);
  const obs = {
    arm, sentinel, leak,
    isolationReasons: [...t1.reasons.map((r) => `t1: ${r}`), ...t2.reasons.map((r) => `t2: ${r}`)],
    engaged: !!t1.result && !!t2.result,
    ups1, ups2, stopLog: readText(sb.logs.stop), turn2Entries,
  };
  const scored = scoreTrial(obs);
  const finalAnswer = String(t2.result?.result ?? '').slice(0, 2000);
  if (DEBUG) {
    mkdirSync(join(REPO, 'scenarios/records/debug'), { recursive: true });
    writeFileSync(join(REPO, `scenarios/records/debug/hnp.${arm}.${sentinel}.txt`),
      `${t1.stdout}\n--- T1 ERR ${t1.err}\n=== TURN 2 ===\n${t2.stdout}\n--- T2 ERR ${t2.err}\n=== UPS ===\n${upsAll}\n=== STOP ===\n${obs.stopLog}`);
  }
  rmSync(sb.dir, { recursive: true, force: true });
  rmSync(sb.logDir, { recursive: true, force: true });
  return {
    ...scored, sentinel,
    // Diagnostics (Q3) — never predicates.
    upsEmitted: hasLine(ups2), upsLine: upsLineMatch ? JSON.parse(`"${upsLineMatch[1]}"`) : null,
    turn1Line: hasLine(ups1),
    stopRuns: obs.stopLog.split('\n').filter((l) => l.startsWith(RUN_MARKER)).length,
    stopBlocked: obs.stopLog.includes('"decision":"block"'),
    turn2Handoffs: turn2Entries.filter((e) => (e.tags || []).some((t) => t === 'handoff' || t === 'next'))
      .map((e) => ({ tags: e.tags, text: String(e.text).slice(0, 300) })),
    finalAnswer, errors: [t1.err, t2.err].filter(Boolean),
    cliVersion: t2.cliVersion || t1.cliVersion,
  };
}

const arms = ONLY.length ? ARMS.filter((a) => ONLY.includes(a)) : ARMS;
console.log(`vfkb handoff-next-prompt L4  (model=${MODEL}, ${RED ? 'RED baseline' : 'build'}; engine=${CLI})`);
const trials = Object.fromEntries(ARMS.map((a) => [a, []]));
for (const arm of arms) {
  let valid = 0;
  // A RED run only needs to show the arms fail; it does not retry INVALID trials.
  const cap = RED ? PER_ARM : MAX_ATTEMPTS_PER_ARM;
  for (let attempt = 1; attempt <= cap && valid < PER_ARM; attempt++) {
    process.stdout.write(`  ${arm.padEnd(16)} attempt ${attempt} … `);
    const r = runTrial(arm);
    trials[arm].push(r);
    if (r.invalid.length === 0) valid++;
    console.log(`${r.invalid.length ? 'INVALID ' : ''}${r.pass ? 'PASS' : 'no'}  line@t2=${r.upsEmitted} line@t1=${r.turn1Line} stopRuns=${r.stopRuns}` +
      `${r.deterministicFail.length ? '  DET-FAIL: ' + r.deterministicFail.join('; ') : ''}` +
      `${r.invalid.length ? '  ✗ ' + r.invalid.join('; ') : ''}`);
    if (r.turn2Handoffs.length) console.log(`        handoffs@t2: ${r.turn2Handoffs.map((h) => `[${h.tags}] ${h.text.slice(0, 120)}`).join(' | ')}`);
  }
}
// Score only the first VALID_PER_ARM valid trials per arm.
const scoredTrials = Object.fromEntries(ARMS.map((a) => {
  const v = trials[a].filter((t) => t.invalid.length === 0).slice(0, VALID_PER_ARM);
  return [a, [...v, ...trials[a].filter((t) => t.invalid.length > 0)]];
}));
const verdict = runVerdict(scoredTrials);
const complete = verdict.complete && arms.length === ARMS.length && PER_ARM === VALID_PER_ARM;
console.log(`\ncounts: ${JSON.stringify(verdict.counts)}`);
console.log(verdict.demonstrated && complete ? 'DEMONSTRATED' : `NOT demonstrated — ${verdict.reasons.join('; ') || 'subset run'}`);

const git = (...a) => { try { return sh('git', a, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
let distSha = null;
try { distSha = sh('shasum', ['-a', '256', CLI]).split(' ')[0]; } catch { /* informational */ }
const rec = {
  scenario: 'handoff-next-prompt', recordVersion: 1, model: MODEL, generated: new Date().toISOString(),
  red: RED, engineCli: CLI, engineRev: process.env.VFKB_HNP_ENGINE_REV || null, engineCliSha256: distSha, vfkbSha: git('rev-parse', 'HEAD'),
  engineSrcDirty: (git('status', '--porcelain', '--', 'src') || '') !== '',
  cliVersions: [...new Set(Object.values(trials).flat().map((t) => t.cliVersion).filter(Boolean))],
  isolation: "enabledPlugins {'vfkb@vfkb': false}; init event asserted",
  promptLineLeadin: PROMPT_LINE_LEADIN, thresholds: 'decide-step Q4 (scenarios/lib/nudge-verdict.mjs)',
  verdict: { ...verdict, demonstrated: verdict.demonstrated && complete }, trials,
};
const file = recordName('handoff-next-prompt', { complete, red: RED });
mkdirSync(join(REPO, 'scenarios/records'), { recursive: true });
writeFileSync(join(REPO, 'scenarios/records', file), JSON.stringify(rec, null, 2) + '\n');
console.log(`record → scenarios/records/${file}`);
process.exit(verdict.demonstrated && complete ? 0 : 1);
