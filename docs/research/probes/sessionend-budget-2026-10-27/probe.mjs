#!/usr/bin/env node
// ============================================================================
// vfkb#384 Tier-0 probe — does vfkb's SessionEnd hook fit Claude Code's SessionEnd
// time budget (1.5 s by default; RFC-047 §4.2 / ADR-0084 §4)?
// ----------------------------------------------------------------------------
// Tier-0 = an external-contract probe on the host CLI, NOT an agent-driven L4 and NOT
// part of `npm test`. Each arm runs `claude -p` (haiku, one trivial turn, stdin from
// /dev/null) in a throwaway git sandbox whose own .claude/settings.json wires the
// SessionEnd hook under test and disables the user-scope vfkb plugin (gotcha
// fb712c13f39e). The session ends when -p completes; every predicate is a CONTENT
// assertion over files, git and stderr — never an exit code (ADR-0051 clause 3).
//
// Exit path: `-p` only (decided by the #384 Fable brainstorm, ruling 54802539cda7).
// That is admissible only because the calibration and can-fail arms must SEE the
// budget cut a hook on this path; if they do not, every verdict is INADMISSIBLE.
//
// Usage (one run at a time; ~40 short haiku turns):
//   PROBE_BUNDLE_V021=<plugin v0.21.0 dist/bundles/vfkb.mjs> \
//   PROBE_BUNDLE_MAIN=<origin/main dist/bundles/vfkb.mjs> \
//   PROBE_BUNDLE_FIX=<#384 branch dist/bundles/vfkb.mjs> \
//   PROBE_BRAIN=<an entries.jsonl to seed, e.g. vfkb's own> \
//   [PROBE_TRIALS=3] [PROBE_ARMS=a0-settings,...] [PROBE_TAG=name] node probe.mjs
// Writes out/results.json and out/results.md next to this file.
// ============================================================================
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const MARKER_HOOK = join(HERE, 'marker-hook.mjs');
const MARKER_PLUGIN = join(HERE, 'marker-plugin');
const TRIALS = Math.max(1, parseInt(process.env.PROBE_TRIALS || '3', 10));
const MODEL = process.env.PROBE_MODEL || 'claude-haiku-4-5';
const ONLY = (process.env.PROBE_ARMS || '').split(',').filter(Boolean);
const BUNDLES = {
  v021: process.env.PROBE_BUNDLE_V021,
  main: process.env.PROBE_BUNDLE_MAIN,
  fix: process.env.PROBE_BUNDLE_FIX,
};
const BRAIN = process.env.PROBE_BRAIN;
const SETTLE_MS = 6000; // after -p exits, wait for any orphaned hook to finish (a finding if it does)

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o });

// A child env without this session's harness variables, so the nested CLI is a fresh
// top-level session (the profile's CLAUDE_CONFIG_DIR stays: it carries the OAuth login).
function childEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT' || (k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS')) delete env[k];
  }
  delete env.CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS;
  delete env.VFKB_DATA_DIR;
  delete env.VFKB_DIR;
  delete env.KB_SESSION_ID;
  return { ...env, ...extra };
}

const realGit = sh('sh', ['-c', 'command -v git']).trim();

function sandbox({ brain = false, branch = 'work', bundle, preCommitSleep } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-se-probe-'));
  const g = (...x) => sh('git', x, { cwd: dir });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'probe@example.invalid');
  g('config', 'user.name', 'probe');
  g('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), '# probe sandbox\n');
  mkdirSync(join(dir, '.claude'));
  if (brain) {
    mkdirSync(join(dir, '.vfkb'));
    cpSync(BRAIN, join(dir, '.vfkb', 'entries.jsonl'));
    writeFileSync(join(dir, '.gitignore'), '.vfkb/.sessions/\n.vfkb/.journal/\n.vfkb/.signals/\n.vfkb/.lock\n.vfkb/index-meta.json\n.claude/\n');
  }
  g('add', '-A');
  g('commit', '-qm', 'seed');
  if (branch !== 'main') g('checkout', '-q', '-b', branch);
  if (brain) {
    // "The session added one entry": written through the engine under test, like kb_add.
    sh('node', [bundle, 'add', 'fact', 'probe: the one entry this session added', '--role', 'human'], {
      cwd: dir,
      env: childEnv({ VFKB_DATA_DIR: join(dir, '.vfkb') }),
    });
  }
  if (preCommitSleep) {
    writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\nsleep ${preCommitSleep}\n`, { mode: 0o755 });
  }
  return dir;
}

function writeSettings(dir, { hooks, env }) {
  const s = { enabledPlugins: { 'vfkb@vfkb': false }, hooks: { SessionEnd: [{ hooks }] } };
  if (env) s.env = env;
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(s, null, 2));
}

function runClaude(dir, { env = {}, pluginDir } = {}) {
  const args = ['-p', 'Reply with exactly the word: ok', '--model', MODEL, '--strict-mcp-config',
    '--output-format', 'stream-json', '--verbose'];
  if (pluginDir) args.push('--plugin-dir', pluginDir);
  const t0 = Date.now();
  const r = spawnSync('claude', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], // stdin = /dev/null: no 3 s "no stdin" wait
    env: childEnv(env),
    timeout: 180_000,
  });
  const wallMs = Date.now() - t0;
  let init = {};
  for (const l of (r.stdout || '').split('\n')) {
    try {
      const j = JSON.parse(l);
      if (j.type === 'system' && j.subtype === 'init') init = j;
    } catch {}
  }
  const plugins = (init.plugins || []).map((p) => `${p.name}${p.source ? '@' + p.source : ''}`);
  return { stdout: r.stdout || '', stderr: r.stderr || '', wallMs, plugins, cliVersion: init.claude_code_version };
}

const marks = (dir, label) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.startsWith(label + '@') && f !== `${label}@start`)
        .map((f) => Number(f.slice(label.length + 1)))
        .sort((a, b) => a - b)
    : [];
const cancelled = (stderr) => /SessionEnd hook .*(cancelled|canceled|timed out)/i.test(stderr) || /Hook cancelled/i.test(stderr);
const vfkbLeak = (plugins) => plugins.some((p) => /^vfkb(@|$)/.test(p));

function brainFacts(dir) {
  const log = sh('git', ['log', '-1', '--format=%s'], { cwd: dir }).trim();
  const dirty = sh('git', ['status', '--porcelain', '--', '.vfkb/entries.jsonl'], { cwd: dir }).trim() !== '';
  const lines = readFileSync(join(dir, '.vfkb', 'entries.jsonl'), 'utf8').split('\n').filter(Boolean);
  const auto = lines.filter((l) => {
    try { return (JSON.parse(l).tags || []).includes('auto'); } catch { return false; }
  }).length;
  const indexLock = existsSync(join(dir, '.git', 'index.lock'));
  let marker;
  const sdir = join(dir, '.vfkb', '.sessions');
  if (existsSync(sdir)) {
    for (const f of readdirSync(sdir)) {
      try { const j = JSON.parse(readFileSync(join(sdir, f), 'utf8')); if (j.sessionEnd) marker = j.sessionEnd; } catch {}
    }
  }
  const autoCommit = /^chore\(brain\): session-end auto-commit/.test(log);
  const count = (log.match(/\((\d+) new entr/) || [])[1];
  const curated = (log.match(/, (\d+) curated/) || [])[1];
  return { subject: log, autoCommit, newCount: count ? Number(count) : undefined, curated: curated ? Number(curated) : 0, dirty, autoLines: auto, indexLock, marker };
}

// --------------------------------------------------------------------------- arms
const vfkbCmd = (bundle, { pre = '' } = {}) =>
  `${pre}VFKB_DATA_DIR=\${CLAUDE_PROJECT_DIR:-.}/.vfkb node "${bundle}" hook session-end > "$PROBE_MARK_DIR/vfkb-stdout.json"; touch "$PROBE_MARK_DIR/vfkb@done"`;

const ARMS = {
  // Calibration (can-fail): where does the budget cut a settings hook with no timeout?
  'a0-settings': () => {
    const dir = sandbox();
    const md = join(dir, '.marks');
    writeSettings(dir, { hooks: [{ type: 'command', command: `node "${MARKER_HOOK}" settings` }] });
    const r = runClaude(dir, { env: { PROBE_MARK_DIR: md } });
    sleep(SETTLE_MS);
    return { dir, r, last: marks(md, 'settings').at(-1) ?? null, cancelled: cancelled(r.stderr) };
  },
  // Same, as a PLUGIN-provided hook declaring "timeout": 10 (docs: does not raise the budget).
  'a0-plugin-timeout10': () => {
    const dir = sandbox();
    const md = join(dir, '.marks');
    writeSettings(dir, { hooks: [] });
    const r = runClaude(dir, { env: { PROBE_MARK_DIR: md }, pluginDir: MARKER_PLUGIN });
    sleep(SETTLE_MS);
    return { dir, r, last: marks(md, 'plugin').at(-1) ?? null, cancelled: cancelled(r.stderr) };
  },
  // A settings hook declaring "timeout": 10 (a non-plugin per-hook timeout).
  'a0-settings-timeout10': () => {
    const dir = sandbox();
    const md = join(dir, '.marks');
    writeSettings(dir, { hooks: [{ type: 'command', command: `node "${MARKER_HOOK}" settings`, timeout: 10 }] });
    const r = runClaude(dir, { env: { PROBE_MARK_DIR: md } });
    sleep(SETTLE_MS);
    return { dir, r, last: marks(md, 'settings').at(-1) ?? null, cancelled: cancelled(r.stderr) };
  },
  // Env override in the CLI's process env.
  'c-env-process': () => {
    const dir = sandbox();
    const md = join(dir, '.marks');
    writeSettings(dir, { hooks: [{ type: 'command', command: `node "${MARKER_HOOK}" settings` }] });
    const r = runClaude(dir, { env: { PROBE_MARK_DIR: md, CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS: '5000' } });
    sleep(SETTLE_MS);
    return { dir, r, last: marks(md, 'settings').at(-1) ?? null, cancelled: cancelled(r.stderr) };
  },
  // Env override in the PROJECT .claude/settings.json `env` block (the per-project layer).
  'c-env-project-settings': () => {
    const dir = sandbox();
    const md = join(dir, '.marks');
    writeSettings(dir, {
      hooks: [{ type: 'command', command: `node "${MARKER_HOOK}" settings` }],
      env: { CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS: '5000' },
    });
    const r = runClaude(dir, { env: { PROBE_MARK_DIR: md } });
    sleep(SETTLE_MS);
    return { dir, r, last: marks(md, 'settings').at(-1) ?? null, cancelled: cancelled(r.stderr) };
  },
  // Project-settings override applied to a PLUGIN-provided hook.
  'c-env-project-plugin': () => {
    const dir = sandbox();
    const md = join(dir, '.marks');
    writeSettings(dir, { hooks: [], env: { CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS: '5000' } });
    const r = runClaude(dir, { env: { PROBE_MARK_DIR: md }, pluginDir: MARKER_PLUGIN });
    sleep(SETTLE_MS);
    return { dir, r, last: marks(md, 'plugin').at(-1) ?? null, cancelled: cancelled(r.stderr) };
  },
  // The real hook, per engine, on a topic branch with the seeded brain + one new entry.
  ...Object.fromEntries(
    ['v021', 'main', 'fix'].map((eng) => [
      `real-${eng}`,
      () => {
        const dir = sandbox({ brain: true, bundle: BUNDLES[eng] });
        const md = join(dir, '.marks');
        mkdirSync(md, { recursive: true });
        writeSettings(dir, { hooks: [{ type: 'command', command: vfkbCmd(BUNDLES[eng]) }] });
        const r = runClaude(dir, { env: { PROBE_MARK_DIR: md } });
        sleep(SETTLE_MS);
        return { dir, r, done: existsSync(join(md, 'vfkb@done')), cancelled: cancelled(r.stderr), brain: brainFacts(dir) };
      },
    ]),
  ),
  // Can-fail: the real hook delayed 2 s must NOT commit.
  'b-real-sleep2': () => {
    const dir = sandbox({ brain: true, bundle: BUNDLES.fix });
    const md = join(dir, '.marks');
    mkdirSync(md, { recursive: true });
    writeSettings(dir, { hooks: [{ type: 'command', command: vfkbCmd(BUNDLES.fix, { pre: 'sleep 2; ' }) }] });
    const r = runClaude(dir, { env: { PROBE_MARK_DIR: md } });
    sleep(SETTLE_MS);
    return { dir, r, done: existsSync(join(md, 'vfkb@done')), cancelled: cancelled(r.stderr), brain: brainFacts(dir) };
  },
  // The same, with the project-settings override: must commit.
  'c-real-sleep2-project-env': () => {
    const dir = sandbox({ brain: true, bundle: BUNDLES.fix });
    const md = join(dir, '.marks');
    mkdirSync(md, { recursive: true });
    writeSettings(dir, {
      hooks: [{ type: 'command', command: vfkbCmd(BUNDLES.fix, { pre: 'sleep 2; ' }) }],
      env: { CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS: '5000' },
    });
    const r = runClaude(dir, { env: { PROBE_MARK_DIR: md } });
    sleep(SETTLE_MS);
    return { dir, r, done: existsSync(join(md, 'vfkb@done')), cancelled: cancelled(r.stderr), brain: brainFacts(dir) };
  },
  // Safety: the cut lands while git holds index.lock (a 3 s pre-commit hook). What is left?
  'e-kill-mid-commit': () => {
    const dir = sandbox({ brain: true, bundle: BUNDLES.fix, preCommitSleep: 3 });
    const md = join(dir, '.marks');
    mkdirSync(md, { recursive: true });
    writeSettings(dir, { hooks: [{ type: 'command', command: vfkbCmd(BUNDLES.fix) }] });
    const r = runClaude(dir, { env: { PROBE_MARK_DIR: md } });
    const lockRightAfter = existsSync(join(dir, '.git', 'index.lock'));
    sleep(SETTLE_MS);
    let fsck = '';
    try { sh('git', ['status', '--porcelain'], { cwd: dir }); fsck = 'git status ok'; } catch (e) { fsck = 'git status FAILED: ' + String(e.stderr || e.message).slice(0, 160); }
    return { dir, r, done: existsSync(join(md, 'vfkb@done')), cancelled: cancelled(r.stderr), lockRightAfter, brain: brainFacts(dir), gitAfter: fsck };
  },
  // Does a SessionEnd systemMessage reach any -p output? (dirty brain on main)
  'f-systemmessage-main': () => {
    const dir = sandbox({ brain: true, branch: 'main', bundle: BUNDLES.fix });
    const md = join(dir, '.marks');
    mkdirSync(md, { recursive: true });
    writeSettings(dir, { hooks: [{ type: 'command', command: vfkbCmd(BUNDLES.fix) }] });
    const r = runClaude(dir, { env: { PROBE_MARK_DIR: md } });
    sleep(SETTLE_MS);
    const hookOut = existsSync(join(md, 'vfkb-stdout.json')) ? readFileSync(join(md, 'vfkb-stdout.json'), 'utf8') : '';
    const needle = 'left uncommitted';
    return {
      dir, r, done: existsSync(join(md, 'vfkb@done')),
      hookEmitted: hookOut.includes(needle),
      shownInStdout: r.stdout.includes(needle),
      shownInStderr: r.stderr.includes(needle),
      brain: brainFacts(dir),
    };
  },
};

// ------------------------------------------------------------------------- main
for (const [k, v] of Object.entries(BUNDLES)) if (!v || !existsSync(v)) throw new Error(`PROBE_BUNDLE_${k.toUpperCase()} missing`);
if (!BRAIN || !existsSync(BRAIN)) throw new Error('PROBE_BRAIN missing');
mkdirSync(OUT, { recursive: true });
const meta = {
  probe: 'sessionend-budget-2026-10-27',
  date: new Date().toISOString(),
  cli: sh('claude', ['--version'], { env: childEnv() }).trim(),
  model: MODEL,
  trials: TRIALS,
  bundles: Object.fromEntries(Object.entries(BUNDLES).map(([k, p]) => [k, { path: p, sha256_16: sha(p) }])),
  brain: { path: BRAIN, bytes: readFileSync(BRAIN).length, lines: readFileSync(BRAIN, 'utf8').split('\n').filter(Boolean).length },
  platform: `${process.platform} ${process.arch} node ${process.version}`,
};
console.log(JSON.stringify(meta, null, 2));
const results = {};
for (const [name, fn] of Object.entries(ARMS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  results[name] = [];
  for (let t = 1; t <= TRIALS; t++) {
    const x = fn();
    const row = { ...x, plugins: x.r.plugins, vfkbPluginLeaked: vfkbLeak(x.r.plugins), wallMs: x.r.wallMs, cliVersion: x.r.cliVersion,
      stderrTail: x.r.stderr.split('\n').filter((l) => /hook|SessionEnd/i.test(l)).slice(-4) };
    delete row.r;
    rmSync(x.dir, { recursive: true, force: true });
    delete row.dir;
    results[name].push(row);
    console.log(`${name} #${t}: ${JSON.stringify(row)}`);
  }
}
writeFileSync(join(OUT, process.env.PROBE_TAG ? `results-${process.env.PROBE_TAG}.json` : ONLY.length ? `results-${ONLY.join('+')}.json` : 'results.json'), JSON.stringify({ meta, results }, null, 2) + '\n');
console.log('wrote', OUT);
