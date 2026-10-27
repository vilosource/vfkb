#!/usr/bin/env node
// ============================================================================
// vfkb DECISION-CAPTURE L4 purpose scenario (the proof ADR-0027 waived)
// ----------------------------------------------------------------------------
// Proves the PURPOSE of the Stop-hook reminder (ADR-0027): a real agent that makes
// a load-bearing decision during a task — WITHOUT being told to record it — ends up
// CAPTURING that decision into the brain BECAUSE OF the end-of-turn reminder.
//
// The Tier-0 probe only proved the injected text *reaches* the agent (a toy sentinel);
// it did NOT prove the agent *completes the capture*. This closes that gap.
//
// CAUSAL DESIGN (the only variable is the Stop hook):
//   - no CLAUDE.md, empty brain, NO "record it" instruction in the prompt;
//   - identical sandbox in both arms EXCEPT: vfkb arm has the Stop hook, baseline doesn't.
//   So any capture in the vfkb arm is reminder-driven by elimination; baseline ≈ 0.
//
// FAITHFUL SURFACE: wires the real vfkb MCP server (mcp__vfkb__kb_add) + the PreToolUse
// gating hook (the agent CANNOT write .vfkb directly — capture must go through the engine),
// exactly like the live repo's .mcp.json + .claude/settings.json.
//
// OBSERVABLE: a `decision` entry reflecting the choice lands in the sandbox .vfkb AND is
// retrievable via `vfkb search` (capture is only worth anything if recallable).
//
// VERDICT: DEMONSTRATED iff vfkb-arm capture-rate ≥ 2/3 AND vfkb > baseline (honest — if
// baseline also captures, the hook added nothing).
//
// ISOLATION (hardened 2026-10-27, ADR-0084 DoD item 5; brain gotcha fb712c13f39e): the
// vfkb plugin is enabled at USER scope on the operator's machine, and a user-scope plugin
// loads into a /tmp sandbox — its own SessionStart/Stop/SessionEnd hooks and its
// `mcp__plugin_vfkb_vfkb__*` tools (observed: plugin 0.18.0 in the init event). That would
// give the BASELINE arm a Stop nudge and a capture tool, and the vfkb arm two Stop hooks.
// Both arms' settings therefore disable `vfkb@vfkb`, every run streams its init event, and
// a trial whose init shows the plugin anyway is scored INVALID (content assertion over the
// init event, never exit status — ADR-0051 clause 3). So is a trial whose `modelUsage`
// shows any model other than the pinned one (ADR-0050). Any INVALID trial → exit 3, no
// verdict. VFKB_DC_SELFTEST_LEAK=1 drops the disable to watch the INVALID predicate fire.
//
// LIVE + metered (uses the Claude Max-subscription OAuth, no per-token bill). One agent
// at a time. NOT part of `npm test`.
//   node scenarios/decision-capture.mjs
//   VFKB_DC_TRIALS=1 VFKB_DC_TASK=config-format VFKB_DC_MODEL=claude-haiku-4-5 node scenarios/decision-capture.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
// ABSOLUTE paths into the repo's built artifacts — the sandbox holds NO symlink/breadcrumb
// back to the repo (a sandbox `dist` symlink let the agent infer the real project root and
// write src/ files into it). node resolves node_modules from the script location.
const CLI = join(REPO, 'dist', 'cli.js');
const MCP = join(REPO, 'dist', 'mcp-server.js');
const TRIALS = Math.max(1, parseInt(process.env.VFKB_DC_TRIALS || '3', 10));
const MODEL = process.env.VFKB_DC_MODEL || 'claude-haiku-4-5';
const TIMEOUT = parseInt(process.env.VFKB_DC_TIMEOUT || '240000', 10);
// Harness self-test only: omit the plugin disable so the INVALID predicate can be seen firing.
const SELFTEST_LEAK = process.env.VFKB_DC_SELFTEST_LEAK === '1';

// Tasks that FORCE a load-bearing A/B decision AND a src/ change (no "record it" hint).
const TASKS = {
  'config-format': {
    expect: ['json', 'yaml', 'config'],
    prompt:
      'This small TypeScript CLI needs configuration support. Decide whether its config files ' +
      'should use JSON or YAML, then CREATE THE FILE src/config.ts ON DISK (use your file-writing ' +
      'tool — do NOT just print code in your reply) with a minimal loader for the format you chose. ' +
      'Make the decision yourself — do not ask me — and implement it now.',
  },
  'error-strategy': {
    expect: ['error', 'exception', 'result', 'throw'],
    prompt:
      'Add input validation to this project. Decide the error-handling strategy: throw exceptions, ' +
      'or return a Result/{ok,error} object. Choose one approach, then CREATE THE FILE src/validate.ts ' +
      'ON DISK (use your file-writing tool — do NOT just print code) with a small validateInput() that ' +
      'uses it. Make the call yourself and implement it now.',
  },
  'id-scheme': {
    // 'identifier' is FIRST because the recall probe searches expect[0]; the prompt frames the
    // task as "record identifiers" so that term is present whichever scheme is chosen. 'id' was
    // first but is a 2-char token the stemmer filters out → clean 3/3 capture recalled nothing.
    expect: ['identifier', 'uuid', 'nanoid', 'sequential', 'id'],
    prompt:
      'This project needs record identifiers. Decide the scheme: UUID, nanoid, or sequential integers. ' +
      'Pick one, then CREATE THE FILE src/ids.ts ON DISK (use your file-writing tool — do NOT just print ' +
      'code) with a function that mints ids that way, noting why in a brief comment. Make the call yourself.',
  },
};
const TASK_ID = process.env.VFKB_DC_TASK || 'config-format';
const TASK = TASKS[TASK_ID];
if (!TASK) { console.error(`unknown task '${TASK_ID}'; choices: ${Object.keys(TASKS).join(', ')}`); process.exit(2); }

const hookCmd = (sub) => `VFKB_DIR=.vfkb VFKB_PROJECT=dc node ${CLI} hook ${sub}`;
function settingsJson(stop) {
  const hooks = {
    SessionStart: [{ hooks: [{ type: 'command', command: hookCmd('session-start') }] }],
    PreToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: hookCmd('pre-tool-use') }] }],
  };
  if (stop) hooks.Stop = [{ hooks: [{ type: 'command', command: hookCmd('stop') }] }];
  // BASE settings, identical in both arms: the user-scope vfkb plugin stays out of the sandbox.
  const base = SELFTEST_LEAK ? {} : { enabledPlugins: { 'vfkb@vfkb': false } };
  return JSON.stringify({ ...base, hooks }, null, 2);
}
const MCP_JSON = JSON.stringify({
  mcpServers: { vfkb: { command: 'node', args: [MCP], env: { VFKB_DIR: '.vfkb', VFKB_PROJECT: 'dc' } } },
});
const LEAK_FILES = ['src/config.ts', 'src/validate.ts', 'src/ids.ts']; // belt-and-suspenders

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });

// Defense-in-depth: if an agent ever wrote a task file into the real repo, remove it
// and shout — the sandbox should be fully self-contained (no symlink breadcrumb).
// Only an UNTRACKED file is a leak: `src/validate.ts` became a real tracked engine file in
// #303, and the unconditional existsSync→rmSync deleted it from the working copy on every
// run (observed 2026-10-27). A tracked file the agent MODIFIED is reported, never deleted.
function cleanLeaks() {
  for (const f of LEAK_FILES) {
    const p = join(REPO, f);
    if (!existsSync(p)) continue;
    let st = '';
    try { st = sh('git', ['status', '--porcelain', '--', f], { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { st = '?? '; } // cannot ask git → treat as untracked (the original guard's behaviour)
    if (st.startsWith('??')) { rmSync(p); console.log(`  [!] LEAK GUARD removed ${f} from the repo — sandbox isolation breached`); }
    else if (st.trim()) console.log(`  [!] LEAK GUARD: tracked ${f} was MODIFIED in the repo — sandbox isolation breached (left for inspection)`);
  }
}

function makeSandbox(stop) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-dc-'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, '.vfkb'));
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude/settings.json'), settingsJson(stop));
  writeFileSync(join(dir, 'mcp.json'), MCP_JSON);
  // seed a well-formed baseline entry via the engine (NOT a hand-written JSONL line),
  // so HEAD has a committed brain and the entry has the real shape (tags, provenance, …).
  sh('node', [CLI, 'add', 'fact', 'sandbox baseline'],
    { cwd: dir, env: { ...process.env, VFKB_DIR: '.vfkb', VFKB_PROJECT: 'dc' }, stdio: 'ignore' });
  const git = (...x) => sh('git', x, { cwd: dir, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '.'); git('commit', '-qm', 'baseline');
  return dir;
}

function decisionsIn(dir) {
  const f = join(dir, '.vfkb/entries.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return {}; } })
    .filter((e) => e.type === 'decision');
}
/**
 * Read the stream-json transcript: the `system/init` event (what the session loaded) and
 * the final `result` event (which models actually ran). Returns the isolation verdict.
 */
function inspectStream(stdout) {
  let init = null, result = null;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'system' && e.subtype === 'init') init = e;
    if (e.type === 'result') result = e;
  }
  const reasons = [];
  if (!init) reasons.push('no init event (cannot observe isolation)');
  else {
    const leakPlugins = (init.plugins || []).filter((p) => p && (p.source === 'vfkb@vfkb' || p.name === 'vfkb'));
    const leakTools = (init.tools || []).filter((t) => String(t).startsWith('mcp__plugin_vfkb_'));
    const leakMcp = (init.mcp_servers || []).filter((m) => String(m?.name || '').startsWith('plugin:vfkb:'));
    if (leakPlugins.length) reasons.push(`plugin loaded: ${leakPlugins.map((p) => `${p.source}@${p.version}`).join(',')}`);
    if (leakTools.length) reasons.push(`plugin tools: ${leakTools.length}`);
    if (leakMcp.length) reasons.push(`plugin MCP: ${leakMcp.map((m) => m.name).join(',')}`);
  }
  const models = Object.keys(result?.modelUsage || {});
  if (!result) reasons.push('no result event (cannot observe modelUsage)');
  else if (models.length !== 1 || models[0] !== MODEL) reasons.push(`modelUsage=${JSON.stringify(models)} ≠ pinned ${MODEL}`);
  return { invalid: reasons.length > 0, reasons, models, cliVersion: init?.claude_code_version || null };
}

const srcChanged = (dir) => {
  try { return sh('git', ['status', '--porcelain'], { cwd: dir }).split('\n').some((l) => l.slice(3).trim().startsWith('src/')); }
  catch { return false; }
};

function runArm(stop) {
  const dir = makeSandbox(stop);
  const args = ['-p', TASK.prompt, '--strict-mcp-config', '--mcp-config', join(dir, 'mcp.json'),
    '--settings', join(dir, '.claude/settings.json'), '--dangerously-skip-permissions', '--model', MODEL,
    '--output-format', 'stream-json', '--verbose'];
  let err = '', stdout = '';
  try { stdout = sh('claude', args, { cwd: dir, timeout: TIMEOUT, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { err = String(e.stderr || e.message || '').replace(/\s+/g, ' ').slice(0, 160); stdout = String(e.stdout || ''); }
  if (process.env.VFKB_DC_DEBUG) {
    writeFileSync(join(REPO, `scenarios/records/decision-capture.debug.${stop ? 'vfkb' : 'baseline'}.txt`), stdout + '\n--- ERR ---\n' + err);
  }
  const iso = inspectStream(stdout);
  const decs = decisionsIn(dir);
  const relevant = decs.filter((d) => TASK.expect.some((k) => String(d.text || '').toLowerCase().includes(k)));
  const captured = relevant.length > 0;
  const didWork = srcChanged(dir);
  let recalled = false;
  if (captured) {
    try {
      const out = sh('node', [CLI, 'search', TASK.expect[0]], { cwd: dir, env: { ...process.env, VFKB_DIR: '.vfkb' } });
      recalled = TASK.expect.some((k) => out.toLowerCase().includes(k));
    } catch { /* recall is a bonus */ }
  }
  const text = String((relevant[0] || decs[0] || {}).text || '');
  const role = (relevant[0] || decs[0] || {})?.provenance?.author || (relevant[0] || decs[0] || {})?.author || '';
  rmSync(dir, { recursive: true, force: true });
  return { captured, didWork, recalled, text, role, err,
    invalid: iso.invalid, invalidReasons: iso.reasons, modelUsage: iso.models, cliVersion: iso.cliVersion };
}

console.log(`vfkb decision-capture L4  (task=${TASK_ID}, model=${MODEL}, trials=${TRIALS})`);
console.log(`only variable = the Stop hook; capture surface = real vfkb MCP + gating\n`);
const arms = { vfkb: [], baseline: [] };
for (let t = 1; t <= TRIALS; t++) {
  for (const [arm, stop] of [['vfkb', true], ['baseline', false]]) {
    process.stdout.write(`  trial ${t}  ${arm.padEnd(8)} … `);
    const r = runArm(stop);
    cleanLeaks();
    arms[arm].push(r);
    console.log(
      `${r.invalid ? 'INVALID ' : ''}` +
      `${r.captured ? 'CAPTURED' : 'no-capture'}` +
      `${r.didWork ? '' : ' [WARN: no src change — task not done]'}` +
      `${r.recalled ? ' +recall' : ''}${r.err ? '  ERR:' + r.err : ''}`,
    );
    if (r.invalid) console.log(`        ✗ ${r.invalidReasons.join('; ')}`);
    if (r.captured) console.log(`        → "${r.text.replace(/\s+/g, ' ').slice(0, 150)}"`);
  }
}

const cap = (a) => a.filter((r) => r.captured).length;
const vfkbN = cap(arms.vfkb), baseN = cap(arms.baseline);
const need = Math.ceil((2 * TRIALS) / 3);
const invalidN = [...arms.vfkb, ...arms.baseline].filter((r) => r.invalid).length;
const demonstrated = invalidN === 0 && vfkbN >= need && vfkbN > baseN;
console.log(`\nvfkb (Stop ON): ${vfkbN}/${TRIALS} captured   |   baseline (Stop OFF): ${baseN}/${TRIALS} captured`);
console.log(invalidN > 0
  ? `INVALID — ${invalidN} trial(s) failed the isolation/model check; no verdict`
  : demonstrated
    ? `DEMONSTRATED — the Stop-hook reminder drives decision capture (≥${need}/${TRIALS} and > baseline)`
    : `NOT demonstrated (need vfkb ≥${need}/${TRIALS} AND > baseline)`);

mkdirSync(join(REPO, 'scenarios/records'), { recursive: true });
const git = (...a) => { try { return sh('git', a, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const distRev = git('rev-parse', 'HEAD');
const distDirty = (git('status', '--porcelain', '--', 'src') || '') !== '';
const cliVersions = [...new Set([...arms.vfkb, ...arms.baseline].map((r) => r.cliVersion).filter(Boolean))];
const rec = { scenario: 'decision-capture', task: TASK_ID, model: MODEL, trials: TRIALS,
  generated: new Date().toISOString(), engineRev: distRev, engineSrcDirty: distDirty, cliVersions,
  isolation: SELFTEST_LEAK ? 'SELFTEST_LEAK (plugin NOT disabled)' : "enabledPlugins {'vfkb@vfkb': false}",
  invalidTrials: invalidN, vfkbCaptured: vfkbN, baselineCaptured: baseN, demonstrated, arms };
// A self-test run proves the INVALID predicate fires; it must never overwrite the record.
const recFile = SELFTEST_LEAK ? 'decision-capture.selftest-leak.json' : 'decision-capture.json';
writeFileSync(join(REPO, 'scenarios/records', recFile), JSON.stringify(rec, null, 2));
console.log(`\nrecord → scenarios/records/${recFile}`);
process.exit(invalidN > 0 ? 3 : demonstrated ? 0 : 1);
