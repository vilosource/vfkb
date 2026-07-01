#!/usr/bin/env node
// ============================================================================
// vfkb SESSION-END HANDOFF L4 purpose scenario — GAP-1 B1 (RFC-011 §B)
// ----------------------------------------------------------------------------
// Proves the PURPOSE of the B1 Stop-hook handoff nudge: a real agent that
// accumulates knowledge during a session — WITHOUT being told to write a handoff —
// ends up AUTHORING a durable `handoff`/`next` entry BECAUSE OF the end-of-turn nudge.
//
// This is the higher-quality sibling of the already-shipped B2 floor (ADR-0033,
// src/session-end.ts writeAutoHandoff), which deterministically leaves a MACHINE-
// enumerated fallback tagged `auto`. B1's value is QUALITY: an agent-authored "next:".
//
// CAUSAL DESIGN — the only variable is the Stop hook (B1). SessionEnd (the B2 floor)
// is wired in BOTH arms, faithful to the live .claude/settings.json, so the contrast
// is the real B1+B2 vs B2-only:
//   - vfkb arm  (Stop ON):  the nudge fires → the agent writes a NON-`auto` handoff;
//                           B2 then stays out (a handoff already exists).
//   - baseline  (Stop OFF): nothing prompts a handoff → B2 writes the `auto` fallback.
// METRIC = an AGENT-authored handoff (tagged handoff/next but NOT `auto`). By
// elimination that only appears when the nudge drove it: baseline ≈ 0, vfkb ≥ 2/3.
//
// FAITHFUL SURFACE: real vfkb MCP (mcp__vfkb__kb_add) + PreToolUse gating (no direct
// .vfkb writes) + SessionEnd auto-commit, on a TOPIC branch (B2 never commits main).
//
// OBSERVABLE: a `fact` tagged handoff/next, NOT tagged auto, present in the sandbox
// .vfkb AND recallable via `vfkb search`.
//
// VERDICT: DEMONSTRATED iff vfkb agent-handoff-rate ≥ 2/3 AND vfkb > baseline.
//
// LIVE + metered (Claude Max-subscription OAuth, no per-token bill). One agent at a
// time. NOT part of `npm test`.
//   node scenarios/session-end-handoff.mjs
//   VFKB_SH_TRIALS=1 VFKB_SH_MODEL=claude-haiku-4-5 node scenarios/session-end-handoff.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
// ABSOLUTE paths into the repo's built artifacts — the sandbox holds NO breadcrumb
// back to the repo (a sandbox dist symlink let an agent infer the real root and write
// into it — brain gotcha). node resolves node_modules from the script location.
const CLI = join(REPO, 'dist', 'cli.js');
const MCP = join(REPO, 'dist', 'mcp-server.js');
const TRIALS = Math.max(1, parseInt(process.env.VFKB_SH_TRIALS || '3', 10));
const MODEL = process.env.VFKB_SH_MODEL || 'claude-haiku-4-5';
const TIMEOUT = parseInt(process.env.VFKB_SH_TIMEOUT || '300000', 10);

// A task that FORCES ≥3 knowledge entries + a src/ change but NEVER mentions a handoff.
// The ≥3 entries meet the B1 strong-signal threshold (HANDOFF_MIN_ENTRIES); the src/
// change satisfies the nudge's "substantive work" gate. The handoff is NOT requested —
// it is the observable, driven purely by the Stop nudge.
const TASK = {
  prompt:
    'You are starting a work session on a small TypeScript service. This project tracks its ' +
    'design knowledge with the vfkb knowledge base — record as you go using the ' +
    'mcp__vfkb__kb_add tool (do NOT write to .vfkb directly). Do ALL of the following now, ' +
    'yourself, without asking me:\n' +
    '1. Decide the log format (structured JSON lines vs plain text). Record that DECISION ' +
    '(type=decision, with your rationale), then CREATE THE FILE src/log.ts ON DISK (use your ' +
    'file-writing tool — do NOT just print code) implementing a minimal logger for it.\n' +
    '2. Record a FACT (type=fact) stating where runtime config should live and why.\n' +
    '3. Record a GOTCHA (type=gotcha) about one edge case future work must watch for.\n' +
    'That is the whole task — implement and record all three now.',
};
const LEAK_FILES = ['src/log.ts']; // belt-and-suspenders sandbox-isolation guard

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });

// SessionEnd (B2) is wired in BOTH arms (faithful); Stop (B1) only when `stop`.
const hookCmd = (sub) => `VFKB_DIR=.vfkb VFKB_PROJECT=sh node ${CLI} hook ${sub}`;
function settingsJson(stop) {
  const hooks = {
    SessionStart: [{ hooks: [{ type: 'command', command: hookCmd('session-start') }] }],
    PreToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: hookCmd('pre-tool-use') }] }],
    SessionEnd: [{ hooks: [{ type: 'command', command: hookCmd('session-end') }] }],
  };
  if (stop) hooks.Stop = [{ hooks: [{ type: 'command', command: hookCmd('stop') }] }];
  return JSON.stringify({ hooks }, null, 2);
}
const MCP_JSON = JSON.stringify({
  mcpServers: { vfkb: { command: 'node', args: [MCP], env: { VFKB_DIR: '.vfkb', VFKB_PROJECT: 'sh' } } },
});

function cleanLeaks() {
  for (const f of LEAK_FILES) {
    const p = join(REPO, f);
    if (existsSync(p)) { rmSync(p); console.log(`  [!] LEAK GUARD removed ${f} from the repo — sandbox isolation breached`); }
  }
}

function makeSandbox(stop) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-sh-'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, '.vfkb'));
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude/settings.json'), settingsJson(stop));
  writeFileSync(join(dir, 'mcp.json'), MCP_JSON);
  // seed a committed baseline entry via the engine so HEAD has a real brain (the
  // git-HEAD delta = this session's new entries; baseline must NOT count as "new").
  sh('node', [CLI, 'add', 'fact', 'sandbox baseline'],
    { cwd: dir, env: { ...process.env, VFKB_DIR: '.vfkb', VFKB_PROJECT: 'sh' }, stdio: 'ignore' });
  const git = (...x) => sh('git', x, { cwd: dir, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('checkout', '-q', '-b', 'work'); // TOPIC branch — B2 refuses to auto-commit main
  git('add', '.'); git('commit', '-qm', 'baseline');
  return dir;
}

function entriesIn(dir) {
  const f = join(dir, '.vfkb/entries.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return {}; } });
}
const tagged = (e, t) => (e.tags || []).includes(t);
const isHandoff = (e) => tagged(e, 'handoff') || tagged(e, 'next');
const srcChanged = (dir) => {
  // src/ shows as committed (B2 only stages entries.jsonl) or uncommitted — check both.
  try {
    const st = sh('git', ['status', '--porcelain'], { cwd: dir }).split('\n').some((l) => l.slice(3).trim().startsWith('src/'));
    const tracked = sh('git', ['ls-files', 'src/'], { cwd: dir }).trim().length > 0;
    return st || tracked;
  } catch { return false; }
};

function runArm(stop) {
  const dir = makeSandbox(stop);
  const args = ['-p', TASK.prompt, '--strict-mcp-config', '--mcp-config', join(dir, 'mcp.json'),
    '--settings', join(dir, '.claude/settings.json'), '--dangerously-skip-permissions', '--model', MODEL];
  let err = '', stdout = '';
  try { stdout = sh('claude', args, { cwd: dir, timeout: TIMEOUT, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { err = String(e.stderr || e.message || '').replace(/\s+/g, ' ').slice(0, 160); stdout = String(e.stdout || ''); }
  if (process.env.VFKB_SH_DEBUG) {
    writeFileSync(join(REPO, `scenarios/records/session-end-handoff.debug.${stop ? 'vfkb' : 'baseline'}.txt`), stdout + '\n--- ERR ---\n' + err);
  }
  const entries = entriesIn(dir);
  const newEntries = entries.filter((e) => String(e.text || '') !== 'sandbox baseline');
  const handoffs = entries.filter(isHandoff);
  const agentHandoffs = handoffs.filter((e) => !tagged(e, 'auto')); // NON-auto = agent-authored
  const autoHandoffs = handoffs.filter((e) => tagged(e, 'auto'));
  const captured = agentHandoffs.length > 0; // the metric
  const didWork = srcChanged(dir);
  let recalled = false;
  if (captured) {
    try {
      const out = sh('node', [CLI, 'search', 'handoff next'], { cwd: dir, env: { ...process.env, VFKB_DIR: '.vfkb' } });
      recalled = /handoff|next/i.test(out);
    } catch { /* recall is a bonus */ }
  }
  const text = String((agentHandoffs[0] || autoHandoffs[0] || {}).text || '');
  rmSync(dir, { recursive: true, force: true });
  return { captured, didWork, recalled, entries: newEntries.length, autoFloor: autoHandoffs.length > 0, text, err };
}

console.log(`vfkb session-end-handoff L4  (B1 nudge; model=${MODEL}, trials=${TRIALS})`);
console.log(`only variable = the Stop hook (B1); B2 floor + MCP + gating wired in both arms\n`);
const arms = { vfkb: [], baseline: [] };
for (let t = 1; t <= TRIALS; t++) {
  for (const [arm, stop] of [['vfkb', true], ['baseline', false]]) {
    process.stdout.write(`  trial ${t}  ${arm.padEnd(8)} … `);
    const r = runArm(stop);
    cleanLeaks();
    arms[arm].push(r);
    console.log(
      `${r.captured ? 'AGENT-HANDOFF' : 'no-agent-handoff'}` +
      ` [${r.entries} entries${r.autoFloor ? ', +B2-auto-floor' : ''}]` +
      `${r.didWork ? '' : ' [WARN: no src change]'}` +
      `${r.captured && r.entries < 3 ? ' [WARN: <3 entries — nudge threshold not met]' : ''}` +
      `${r.recalled ? ' +recall' : ''}${r.err ? '  ERR:' + r.err : ''}`,
    );
    if (r.captured) console.log(`        → "${r.text.replace(/\s+/g, ' ').slice(0, 150)}"`);
  }
}

const cap = (a) => a.filter((r) => r.captured).length;
const vfkbN = cap(arms.vfkb), baseN = cap(arms.baseline);
const need = Math.ceil((2 * TRIALS) / 3);
const demonstrated = vfkbN >= need && vfkbN > baseN;
console.log(`\nvfkb (B1 ON): ${vfkbN}/${TRIALS} agent-handoff   |   baseline (B1 OFF): ${baseN}/${TRIALS} agent-handoff`);
console.log(demonstrated
  ? `DEMONSTRATED — the B1 Stop-hook nudge drives an agent-authored handoff (≥${need}/${TRIALS} and > baseline)`
  : `NOT demonstrated (need vfkb ≥${need}/${TRIALS} AND > baseline)`);

mkdirSync(join(REPO, 'scenarios/records'), { recursive: true });
const rec = { scenario: 'session-end-handoff', model: MODEL, trials: TRIALS,
  generated: new Date().toISOString(), vfkbAgentHandoff: vfkbN, baselineAgentHandoff: baseN, demonstrated, arms };
writeFileSync(join(REPO, 'scenarios/records/session-end-handoff.json'), JSON.stringify(rec, null, 2));
console.log(`\nrecord → scenarios/records/session-end-handoff.json`);
process.exit(demonstrated ? 0 : 1);
