#!/usr/bin/env node
// vfkb#448 Tier-0 probe: does `hook session-end` finish inside Claude Code's real SessionEnd
// budget, and does its commit land? The #384 probe (../sessionend-budget-2026-10-27/) spawns
// `claude` on the profile's login; this one goes through the claude-auth seam (env token, no
// Keychain), in a sandbox config dir, so it is safe from a non-Aqua pane.
//
// Each trial: a throwaway git repo on a topic branch, a seeded brain with one uncommitted new
// entry, a project .claude/settings.json wiring only the SessionEnd hook, then one
// `claude -p` haiku turn. Every verdict is a CONTENT assertion over files and git, never an
// exit code (ADR-0051 cl. 3): the model answered (PONG), the hook's own end marker exists,
// and HEAD's subject is the auto-commit.
//
// Can-fail: the `slow` arm prepends `sleep 4` to the same hook. If the budget does not cut it
// off, the probe cannot tell a fit from no limit at all, and every verdict is INADMISSIBLE.
//
//   export CLAUDE_CODE_OAUTH_TOKEN=...; PROBE_BUNDLE_BEFORE=<abs> PROBE_BUNDLE_AFTER=<abs> \
//   PROBE_BRAIN=<abs entries.jsonl> [PROBE_TRIALS=3] [PROBE_ORDER=after,before] [PROBE_TAG=x] node harness.mjs
// Writes out/harness[-TAG].json next to this file.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertClaudeAuthReady, claudeSync, claudeVersion, sandboxEnv } from '../../../../scenarios/lib/claude-auth.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRIALS = Math.max(1, parseInt(process.env.PROBE_TRIALS || '3', 10));
const BUNDLES = { before: process.env.PROBE_BUNDLE_BEFORE, after: process.env.PROBE_BUNDLE_AFTER };
const BRAIN = process.env.PROBE_BRAIN;
const SETTLE_MS = 6000; // a hook orphaned past the budget gets this long to show itself
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o });

assertClaudeAuthReady();
const operatorPlugins = join(process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME, '.claude'), 'plugins', 'installed_plugins.json');
const digest = () => (existsSync(operatorPlugins) ? createHash('sha256').update(readFileSync(operatorPlugins)).digest('hex') : 'absent');
const before = digest();

function bigBrain(extra) {
  const p = join(mkdtempSync(join(tmpdir(), 'vfkb-448h-brain-')), 'entries.jsonl');
  cpSync(BRAIN, p);
  let s = '';
  for (let i = 0; i < extra; i++) {
    s += JSON.stringify({ id: `syn${String(i).padStart(6, '0')}`, type: 'fact', text: `filler ${i} ` + 'y'.repeat(400), tags: ['filler'], zone: 'established', author: { role: 'human' }, provenance: { status: 'verified' }, created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z' }) + '\n';
  }
  appendFileSync(p, s);
  return p;
}

function trial(bundle, brain, pre = '') {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-448h-'));
  const home = mkdtempSync(join(tmpdir(), 'vfkb-448h-home-'));
  mkdirSync(join(home, '.claude'));
  const g = (...x) => sh('git', x, { cwd: dir });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'p@example.invalid'); g('config', 'user.name', 'p'); g('config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, '.vfkb'));
  cpSync(brain, join(dir, '.vfkb', 'entries.jsonl'));
  writeFileSync(join(dir, '.gitignore'), '.vfkb/.sessions/\n.vfkb/.journal/\n.vfkb/.lock\n.vfkb/index-meta.json\n.claude/\nmark\nmark.err\n');
  g('add', '-A'); g('commit', '-qm', 'seed'); g('branch', 'work'); g('symbolic-ref', 'HEAD', 'refs/heads/work');
  // Curation runs too, as in real use: its deadline is part of what must fit.
  sh('node', [bundle, 'add', 'fact', 'probe: one new entry', '--role', 'human'], { cwd: dir, env: { PATH: process.env.PATH, HOME: home, VFKB_DATA_DIR: join(dir, '.vfkb') } });
  mkdirSync(join(dir, '.claude'));
  const command = `${pre}VFKB_DATA_DIR="$CLAUDE_PROJECT_DIR/.vfkb" node "${bundle}" hook session-end > /dev/null 2> "$CLAUDE_PROJECT_DIR/mark.err"; touch "$CLAUDE_PROJECT_DIR/mark"`;
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: 'command', command }] }] } }));
  let answer = '';
  try {
    answer = claudeSync(['-p', 'Reply with exactly: PONG', '--model', 'claude-haiku-4-5', '--strict-mcp-config'], {
      cwd: dir, timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'], env: sandboxEnv(process.env, home),
    });
  } catch (e) {
    answer = String(e.stdout || e.message || e);
  }
  const atExit = { marker: existsSync(join(dir, 'mark')), subject: g('log', '-1', '--format=%s').trim() };
  sleep(SETTLE_MS);
  const settled = { marker: existsSync(join(dir, 'mark')), subject: g('log', '-1', '--format=%s').trim() };
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  return {
    pong: /PONG/.test(answer),
    finishedInBudget: atExit.marker,
    commitAtExit: atExit.subject.includes('session-end auto-commit'),
    commitSettled: settled.subject.includes('session-end auto-commit'),
    subject: settled.subject,
  };
}

const out = { date: new Date().toISOString(), claude: claudeVersion(), trials: TRIALS, cells: {} };
const brains = { 'real': BRAIN, 'plus10k': bigBrain(10000), 'plus30k': bigBrain(30000) };
const cell = (name, bundle, brain, pre) => {
  const runs = Array.from({ length: TRIALS }, () => trial(bundle, brain, pre));
  const n = (k) => runs.filter((r) => r[k]).length;
  out.cells[name] = { pong: n('pong'), finishedInBudget: n('finishedInBudget'), commitAtExit: n('commitAtExit'), commitSettled: n('commitSettled'), subject: runs[0].subject };
  console.log(name.padEnd(24), JSON.stringify(out.cells[name]));
};

cell('calibration/slow', BUNDLES.after, BRAIN, 'sleep 4; ');
// PROBE_ORDER=after,before swaps which engine runs first, to rule out an order effect.
for (const eng of (process.env.PROBE_ORDER || 'before,after').split(',')) {
  for (const [b, p] of Object.entries(brains)) cell(`${eng}/${b}`, BUNDLES[eng], p);
}
const cal = out.cells['calibration/slow'];
out.admissible = cal.pong === TRIALS && cal.finishedInBudget === 0;
out.operatorRegistryUnchanged = digest() === before;
mkdirSync(join(HERE, 'out'), { recursive: true });
writeFileSync(join(HERE, 'out', `harness${process.env.PROBE_TAG ? `-${process.env.PROBE_TAG}` : ''}.json`), JSON.stringify(out, null, 2) + '\n');
console.log(`calibration cut the slow hook off: ${out.admissible} · operator registry unchanged: ${out.operatorRegistryUnchanged}`);
if (!out.admissible) console.log('INADMISSIBLE: the budget was not seen cutting a hook off.');
