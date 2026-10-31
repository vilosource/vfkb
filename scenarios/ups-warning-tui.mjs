#!/usr/bin/env node
// ============================================================================
// L4: ADR-0033's default-branch warning reaches the USER in the interactive TUI
// (vfkb#395, ADR-0085 §8 DoD). LIVE + metered (haiku). ONE claude at a time.
// ----------------------------------------------------------------------------
// The claim: with the vfkb PLUGIN installed through the real resolution path
// (`claude plugin marketplace add <plugin checkout>` + `claude plugin install`,
// never --plugin-dir, ADR-0051 clause 1), a session on `main` with an uncommitted
// brain shows the line `<label> vfkb will not auto-commit ...` on screen; on a
// topic branch, or on main with a committed brain, it does not.
//
// Surface: the INTERACTIVE TUI inside GNU screen (tmux is not installed here),
// driven as the #408 probe did (docs/research/probes/ups-systemmessage-2026-10-30):
// 200x50, defscrollback 20000, wait for "for shortcuts", type with `stuff`, wait
// for the turn in the sandbox transcript, snapshot with `hardcopy -h`. `claude -p`
// text does NOT render a UserPromptSubmit systemMessage (#408, 0/6), so it is not a
// surface for this claim.
//
// Arms (scenarios/lib/ups-warning-verdict.mjs ARMS), three prompts per trial:
//   treatment-main   main, brain with one uncommitted entry   → warning present
//   contrast-topic   feat/work, same uncommitted entry        → absent (nag check)
//   contrast-clean   main, brain committed                    → absent
// RED baseline: VFKB_UPSW_MODE=red runs treatment-main against the pre-#395 plugin
// (v0.22.0) and expects ABSENT ≥2/3, i.e. the arm can fail.
//
// Per-trial control (VOID when missing): every arm seeds a STALE pinned handoff, so
// the plugin's UPS hook emits the ADR-0084 line on prompt 2; its
// `hook_additional_context` record in the sandbox transcript shows the plugin hook
// ran in that session. Plus: the plugin is in the sandbox installed_plugins.json,
// the TUI reached its prompt, and every prompt got a reply.
// Diagnostics (never predicates): the observed label, screen occurrence count,
// the prompt-nudge signal smKey, whether the model relayed the text, main's tip,
// the topic arm's SessionEnd commit, and the operator-profile isolation check.
//
// Keychain safety: every claude child goes through scenarios/lib/claude-auth.mjs
// (env token, no-op `security` shim first on PATH, non-Aqua guard). This file never
// spawns claude itself (test/claude-spawn-audit.test.ts).
//
// Usage:
//   VFKB_UPSW_PLUGIN=<plugin checkout root> node scenarios/ups-warning-tui.mjs
//   VFKB_UPSW_MODE=red VFKB_UPSW_PLUGIN=<v0.22.0 checkout> \
//     VFKB_UPSW_OUT=ups-warning-tui.red-baseline.json node scenarios/ups-warning-tui.mjs
//   env: VFKB_UPSW_TRIALS (3), VFKB_UPSW_MODEL, VFKB_UPSW_ARMS (comma list)
// ============================================================================
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertClaudeAuthReady,
  claudeInScreen,
  claudeSync,
  claudeVersion,
  formatShimReport,
  keychainShimReport,
  redactSecrets,
} from './lib/claude-auth.mjs';
import {
  ARMS,
  LINE_LEADIN,
  WARNING_LEADIN,
  armVerdict,
  observedLabel,
  rawBeforeExit,
  runVerdict,
  screenCount,
  stripAnsi,
  trialPass,
  voidReason,
  warningChannels,
} from './lib/ups-warning-verdict.mjs';
import { observedModels } from './lib/observed-models.mjs';

assertClaudeAuthReady(); // before anything metered

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ROOT = process.env.VFKB_UPSW_PLUGIN ? resolve(process.env.VFKB_UPSW_PLUGIN) : null;
if (!PLUGIN_ROOT || !existsSync(join(PLUGIN_ROOT, 'plugin', 'dist', 'bundles', 'vfkb.mjs'))) {
  throw new Error('VFKB_UPSW_PLUGIN must name a vfkb-claude-plugin checkout root (with plugin/dist/bundles/vfkb.mjs)');
}
const BUNDLE = join(PLUGIN_ROOT, 'plugin', 'dist', 'bundles', 'vfkb.mjs');
const MODE = process.env.VFKB_UPSW_MODE === 'red' ? 'red' : 'capability';
const TRIALS = Math.max(1, parseInt(process.env.VFKB_UPSW_TRIALS || '3', 10));
const MAX_ATTEMPTS = TRIALS + 2; // VOID trials are re-run, at most twice per arm
const MODEL = process.env.VFKB_UPSW_MODEL || 'claude-haiku-4-5-20251001';
const OUT = join(REPO, 'scenarios', 'records', process.env.VFKB_UPSW_OUT || (MODE === 'red' ? 'ups-warning-tui.red-baseline.json' : 'ups-warning-tui.json'));
const PROMPTS = ['pineapple', 'mango', 'kiwi'].map((w) => `Reply with exactly one word: ${w}`);
const ONLY = (process.env.VFKB_UPSW_ARMS || '').split(',').filter(Boolean);
const ARM_PLAN = MODE === 'red'
  ? { 'treatment-main': { ...ARMS['treatment-main'], expect: 'absent' } }
  : Object.fromEntries(Object.entries(ARMS).filter(([k]) => !ONLY.length || ONLY.includes(k)));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o });

// ------------------------------------------------------------------ provenance
function hashTree(dir) {
  // Same framing as vfkb-claude-plugin scenarios/release-gate.mjs hashTree().
  const root = resolve(dir);
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(root);
  const h = createHash('sha256');
  for (const f of files.sort()) {
    h.update(f.slice(root.length + 1));
    h.update('\0');
    h.update(createHash('sha256').update(readFileSync(f)).digest());
  }
  return h.digest('hex');
}
const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const gitOr = (cwd, args) => { try { return sh('git', args, { cwd }).trim(); } catch { return null; } };

// The operator's own installed_plugins.json must not change (isolation diagnostic).
const OPERATOR_CFG = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || '', '.claude');
const operatorPluginsFile = join(OPERATOR_CFG, 'plugins', 'installed_plugins.json');
const operatorDigest = () => (existsSync(operatorPluginsFile) ? sha256(operatorPluginsFile) : 'absent');

// ------------------------------------------------------------------ sandbox
function sandboxEnv(home) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC|VFKB_|KB_)/.test(k) && k !== 'CLAUDE_CODE_OAUTH_TOKEN') continue;
    env[k] = v;
  }
  return { ...env, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), DISABLE_AUTOUPDATER: '1', TERM: 'xterm-256color' };
}

function addEntry(proj, text, tags) {
  const args = [BUNDLE, 'add', 'fact', text, '--role', 'human', '--prov-status', 'verified'];
  if (tags) args.push('--tag', tags);
  sh('node', args, { cwd: proj, env: { ...process.env, VFKB_DATA_DIR: join(proj, '.vfkb'), VFKB_DIR: '', KB_SESSION_ID: '' } });
}

function buildSandbox(arm) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'vfkb-upsw-')));
  const home = join(root, 'home');
  const cfg = join(home, '.claude');
  const proj = join(root, 'proj');
  mkdirSync(cfg, { recursive: true });
  mkdirSync(proj, { recursive: true });
  const env = sandboxEnv(home);

  // The real resolution path (ADR-0051 clause 1), through the seam.
  let installErr = null;
  try {
    claudeSync(['plugin', 'marketplace', 'add', PLUGIN_ROOT], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 });
    claudeSync(['plugin', 'install', 'vfkb@vfkb', '--scope', 'user'], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000 });
  } catch (e) {
    installErr = redactSecrets(String(e?.stderr || e?.message || e)).slice(0, 300);
  }
  const ip = join(cfg, 'plugins', 'installed_plugins.json');
  const installed = existsSync(ip) ? readFileSync(ip, 'utf8') : '';
  const pluginInstalled = /"vfkb@vfkb"/.test(installed);

  // Pre-seed the sandbox profile so the TUI skips onboarding, theme and trust dialogs.
  const seed = existsSync(join(cfg, '.claude.json')) ? JSON.parse(readFileSync(join(cfg, '.claude.json'), 'utf8')) : {};
  writeFileSync(join(cfg, '.claude.json'), JSON.stringify({
    ...seed,
    hasCompletedOnboarding: true,
    lastOnboardingVersion: '2.1.292',
    theme: 'dark',
    numStartups: 5,
    bypassPermissionsModeAccepted: false,
    projects: { ...(seed.projects || {}), [proj]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true, projectOnboardingSeenCount: 5 } },
  }, null, 2));

  // Project: main, a committed pinned handoff, then a later non-brain commit (stale pin
  // → the ADR-0084 line on prompt 2, the per-session hook control).
  sh('git', ['init', '-q', '-b', 'main'], { cwd: proj });
  sh('git', ['config', 'user.name', 'ups-warning-tui'], { cwd: proj });
  sh('git', ['config', 'user.email', 'ups-warning-tui@sandbox.local'], { cwd: proj });
  mkdirSync(join(proj, '.vfkb'));
  writeFileSync(join(proj, 'README.md'), 'ups-warning-tui sandbox\n');
  addEntry(proj, 'HANDOFF: scaffold landed. Next: wire the importer.', 'handoff,next,status');
  sh('git', ['add', '-A'], { cwd: proj });
  sh('git', ['commit', '-qm', 'chore: scaffold + handoff'], { cwd: proj });
  sleep(1500);
  writeFileSync(join(proj, 'NOTES.md'), 'later work\n');
  sh('git', ['add', 'NOTES.md'], { cwd: proj });
  sh('git', ['commit', '-qm', 'docs: later note'], { cwd: proj });
  if (arm.branch !== 'main') sh('git', ['checkout', '-qb', arm.branch], { cwd: proj });
  if (arm.dirty) addEntry(proj, `scratch observation ${randomUUID().slice(0, 8)}`);
  const mainTip = gitOr(proj, ['rev-parse', 'main']);
  return { root, home, cfg, proj, env, pluginInstalled, installErr, mainTip };
}

// ------------------------------------------------------------------ transcript
function transcript(sb) {
  const pdir = join(sb.cfg, 'projects');
  const lines = [];
  if (existsSync(pdir)) {
    for (const d of readdirSync(pdir)) for (const f of readdirSync(join(pdir, d))) {
      if (f.endsWith('.jsonl')) lines.push(...readFileSync(join(pdir, d, f), 'utf8').split('\n').filter(Boolean));
    }
  }
  let assistantText = '';
  let endTurns = 0;
  let turnDurations = 0;
  let hookControl = false;
  let warningRecords = 0;
  let cliSeen = null;
  for (const l of lines) {
    let j;
    try { j = JSON.parse(l); } catch { continue; }
    if (!cliSeen && typeof j.version === 'string') cliSeen = j.version;
    if (j.type === 'assistant') {
      for (const c of j.message?.content || []) if (c.type === 'text') assistantText += c.text + '\n';
      if (j.message?.stop_reason === 'end_turn') endTurns++;
    }
    if (j.type === 'system' && j.subtype === 'turn_duration') turnDurations++;
    if (l.includes('hook_additional_context') && l.includes('UserPromptSubmit') && l.includes(LINE_LEADIN)) hookControl = true;
    if (j.type !== 'assistant' && l.includes(WARNING_LEADIN)) warningRecords++;
  }
  const om = observedModels(lines, MODEL);
  return { assistantText, replies: Math.max(endTurns, turnDurations), hookControl, warningRecords, om, cliSeen };
}

// ------------------------------------------------------------------ the TUI
function runTui(sb) {
  const sdir = join(sb.root, 'screens');
  mkdirSync(sdir, { mode: 0o700 });
  const rawLog = join(sb.root, 'raw.log');
  const rc = join(sb.root, 'screenrc');
  writeFileSync(rc, ['startup_message off', 'defutf8 on', 'defscrollback 20000', 'term xterm-256color',
    `logfile ${rawLog}`, 'logfile flush 0', 'deflog on', ''].join('\n'));
  const hard = join(sb.root, 'hard.txt');
  let h;
  let reachedPrompt = false;
  let screen = '';
  let preExitBytes = 0; // the raw log's length at /exit: SessionEnd's message lands after it
  try {
    h = claudeInScreen({
      cwd: sb.proj,
      args: ['--model', MODEL, '--strict-mcp-config'],
      env: sb.env,
      screenDir: sdir,
      screenrc: rc,
      name: `upsw${process.pid}`,
    });
    const snap = () => {
      rmSync(hard, { force: true });
      h.hardcopy(hard);
      sleep(400);
      return existsSync(hard) ? readFileSync(hard, 'utf8') : '';
    };
    for (let i = 0; i < 60 && !reachedPrompt; i++) {
      sleep(1000);
      if (/for shortcuts/.test(snap())) reachedPrompt = true;
    }
    if (reachedPrompt) {
      for (const [k, p] of PROMPTS.entries()) {
        sleep(1500);
        h.stuff(p);
        sleep(1200);
        h.stuff('\r');
        for (let i = 0; i < 150 && transcript(sb).replies < k + 1; i++) sleep(1000);
      }
      sleep(6000);
      screen = snap(); // rendered buffer incl. scrollback, BEFORE /exit
      preExitBytes = existsSync(rawLog) ? statSync(rawLog).size : 0;
    }
    h.stuff('/exit');
    sleep(800);
    h.stuff('\r');
    sleep(6000); // SessionEnd runs
  } finally {
    h?.quit();
    sleep(500);
  }
  const raw = existsSync(rawLog) ? rawBeforeExit(readFileSync(rawLog), preExitBytes) : '';
  return { reachedPrompt, screen: redactSecrets(screen), raw: redactSecrets(stripAnsi(raw)) };
}

// ------------------------------------------------------------------ trial
function trial(armName, arm, n) {
  const sb = buildSandbox(arm);
  let row;
  try {
    const tui = sb.pluginInstalled ? runTui(sb) : { reachedPrompt: false, screen: '', raw: '' };
    const tr = transcript(sb);
    const obs = {
      pluginInstalled: sb.pluginInstalled,
      reachedPrompt: tui.reachedPrompt,
      replies: tr.replies,
      prompts: PROMPTS.length,
      hookControl: tr.hookControl,
      modelInvalid: tr.om.invalidReasons,
      relayedByModel: tr.assistantText.includes(WARNING_LEADIN),
      screen: tui.screen,
      raw: tui.raw,
    };
    const sigDir = join(sb.proj, '.vfkb', '.signals', 'prompt-nudge');
    const smKeys = existsSync(sigDir)
      ? readdirSync(sigDir).map((f) => { try { return JSON.parse(readFileSync(join(sigDir, f), 'utf8')).smKey ?? null; } catch { return null; } })
      : [];
    const evidence = tui.screen.split('\n').filter((l) => l.includes(WARNING_LEADIN) || / says:/.test(l)).map((l) => l.trimEnd()).slice(0, 6);
    row = {
      arm: armName, trial: n, expect: arm.expect,
      void: voidReason(obs),
      pass: trialPass(arm.expect, obs),
      channels: warningChannels(obs),
      diagnostics: {
        label: observedLabel(tui.screen),
        screenCount: screenCount(tui.screen),
        transcriptWarningRecords: tr.warningRecords,
        smKeyStored: smKeys.filter(Boolean),
        relayedByModel: obs.relayedByModel,
        replies: tr.replies,
        hookControl: tr.hookControl,
        observedModels: tr.om.models,
        syntheticLines: tr.om.synthetic,
        transcriptCli: tr.cliSeen,
        mainTipUnchanged: gitOr(sb.proj, ['rev-parse', 'main']) === sb.mainTip,
        sessionEndCommitted: (gitOr(sb.proj, ['log', '--oneline', '-1']) || '').includes('session-end auto-commit'),
        installErr: sb.installErr,
        screenEvidence: evidence,
      },
    };
  } finally {
    rmSync(sb.root, { recursive: true, force: true });
  }
  return row;
}

// ------------------------------------------------------------------ main
const isolationBefore = operatorDigest();
const pluginJson = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
const meta = {
  scenario: 'ups-warning-tui', issue: 'vilosource/vfkb#395', adr: 'ADR-0085', mode: MODE,
  date: new Date().toISOString(), cli: claudeVersion(), pinnedModel: MODEL, trials: TRIALS,
  vfkbSha: gitOr(REPO, ['rev-parse', 'HEAD']),
  plugin: {
    version: pluginJson.version,
    gitSha: gitOr(PLUGIN_ROOT, ['rev-parse', 'HEAD']),
    treeHash: hashTree(join(PLUGIN_ROOT, 'plugin')),
    bundleSha256: sha256(BUNDLE),
    bundleHasWarning: readFileSync(BUNDLE, 'utf8').includes(WARNING_LEADIN),
  },
  // decide Q4: the install source is a recorded fact, quoted by the release note.
  installSource: 'directory-marketplace (claude plugin marketplace add <checkout> + plugin install --scope user)',
  prompts: PROMPTS,
  platform: `${process.platform} ${process.arch} node ${process.version}`,
};
console.log(JSON.stringify(meta, null, 2));

const rows = [];
const arms = {};
for (const [name, arm] of Object.entries(ARM_PLAN)) {
  const results = [];
  for (let n = 1; n <= MAX_ATTEMPTS && results.filter((r) => r !== null).length < TRIALS; n++) {
    const row = trial(name, arm, n);
    rows.push(row);
    results.push(row.pass);
    console.log(JSON.stringify({ arm: name, trial: n, void: row.void, pass: row.pass, channels: row.channels, label: row.diagnostics.label }));
  }
  arms[name] = { expect: arm.expect, ...armVerdict(results, TRIALS) };
}
const shim = keychainShimReport();
const record = {
  ...meta,
  verdict: runVerdict(arms),
  arms,
  isolation: { operatorInstalledPluginsUnchanged: operatorDigest() === isolationBefore },
  keychain: { ...shim, line: formatShimReport(shim) },
  rows,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, redactSecrets(JSON.stringify(record, null, 2)) + '\n');
console.log(`verdict: ${record.verdict}`, JSON.stringify(arms));
console.log('wrote', OUT);
