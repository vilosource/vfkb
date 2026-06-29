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
    expect: ['id', 'uuid', 'nanoid', 'sequential', 'identifier'],
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
  return JSON.stringify({ hooks }, null, 2);
}
const MCP_JSON = JSON.stringify({
  mcpServers: { vfkb: { command: 'node', args: [MCP], env: { VFKB_DIR: '.vfkb', VFKB_PROJECT: 'dc' } } },
});
const LEAK_FILES = ['src/config.ts', 'src/validate.ts', 'src/ids.ts']; // belt-and-suspenders

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });

// Defense-in-depth: if an agent ever wrote a task file into the real repo, remove it
// and shout — the sandbox should be fully self-contained (no symlink breadcrumb).
function cleanLeaks() {
  for (const f of LEAK_FILES) {
    const p = join(REPO, f);
    if (existsSync(p)) { rmSync(p); console.log(`  [!] LEAK GUARD removed ${f} from the repo — sandbox isolation breached`); }
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
const srcChanged = (dir) => {
  try { return sh('git', ['status', '--porcelain'], { cwd: dir }).split('\n').some((l) => l.slice(3).trim().startsWith('src/')); }
  catch { return false; }
};

function runArm(stop) {
  const dir = makeSandbox(stop);
  const args = ['-p', TASK.prompt, '--strict-mcp-config', '--mcp-config', join(dir, 'mcp.json'),
    '--settings', join(dir, '.claude/settings.json'), '--dangerously-skip-permissions', '--model', MODEL];
  let err = '', stdout = '';
  try { stdout = sh('claude', args, { cwd: dir, timeout: TIMEOUT, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { err = String(e.stderr || e.message || '').replace(/\s+/g, ' ').slice(0, 160); stdout = String(e.stdout || ''); }
  if (process.env.VFKB_DC_DEBUG) {
    writeFileSync(join(REPO, `scenarios/records/decision-capture.debug.${stop ? 'vfkb' : 'baseline'}.txt`), stdout + '\n--- ERR ---\n' + err);
  }
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
  return { captured, didWork, recalled, text, role, err };
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
      `${r.captured ? 'CAPTURED' : 'no-capture'}` +
      `${r.didWork ? '' : ' [WARN: no src change — task not done]'}` +
      `${r.recalled ? ' +recall' : ''}${r.err ? '  ERR:' + r.err : ''}`,
    );
    if (r.captured) console.log(`        → "${r.text.replace(/\s+/g, ' ').slice(0, 150)}"`);
  }
}

const cap = (a) => a.filter((r) => r.captured).length;
const vfkbN = cap(arms.vfkb), baseN = cap(arms.baseline);
const need = Math.ceil((2 * TRIALS) / 3);
const demonstrated = vfkbN >= need && vfkbN > baseN;
console.log(`\nvfkb (Stop ON): ${vfkbN}/${TRIALS} captured   |   baseline (Stop OFF): ${baseN}/${TRIALS} captured`);
console.log(demonstrated
  ? `DEMONSTRATED — the Stop-hook reminder drives decision capture (≥${need}/${TRIALS} and > baseline)`
  : `NOT demonstrated (need vfkb ≥${need}/${TRIALS} AND > baseline)`);

mkdirSync(join(REPO, 'scenarios/records'), { recursive: true });
const rec = { scenario: 'decision-capture', task: TASK_ID, model: MODEL, trials: TRIALS,
  generated: new Date().toISOString(), vfkbCaptured: vfkbN, baselineCaptured: baseN, demonstrated, arms };
writeFileSync(join(REPO, 'scenarios/records/decision-capture.json'), JSON.stringify(rec, null, 2));
console.log(`\nrecord → scenarios/records/decision-capture.json`);
process.exit(demonstrated ? 0 : 1);
