#!/usr/bin/env node
// ============================================================================
// vfkb#408 Tier-0 probe: does a UserPromptSubmit hook's JSON `systemMessage` render
// to the USER, on `claude -p` (arm P) and in the interactive TUI (arm T)?
// ----------------------------------------------------------------------------
// Tier-0 = an external-contract probe on the host CLI (ADR-0029 §5). Not an L4,
// not part of `npm test`. Shape follows arm F of ../sessionend-budget-2026-10-27/.
//
// Hook modes (ups-hook.mjs), each with fresh per-trial markers:
//   sm     systemMessage only                       (the question)
//   sm+ac  systemMessage + additionalContext         (the question, as #395 would ship it)
//   ac     additionalContext only                    (CONTRAST: should not render)
// Surfaces:
//   p-text  `claude -p` --output-format text         stdout + stderr
//   p-json  `claude -p` --output-format stream-json  stdout + stderr (no --include-hook-events)
//   t       interactive TUI inside GNU screen        rendered buffer WITH scrollback
//                                                    (`hardcopy -h`) + the raw pty log
// CONTROL: the hook writes a side file before it prints. No side file = VOID.
// Every predicate is a CONTENT assertion over captured output (ADR-0051 clause 3);
// exit codes are never read. The model's own reply is read from the sandbox
// transcript so a marker the MODEL relays is not mistaken for a harness render.
//
// No Keychain (vfkb-claude-plugin#71, scenarios/auth.mjs): this process reads the
// access token ONCE with the real /usr/bin/security (reads do not prompt); every
// spawned claude gets it as CLAUDE_CODE_OAUTH_TOKEN, a sandbox HOME/CLAUDE_CONFIG_DIR,
// and a `security` shim first on PATH that logs subcommand|service and exits 44.
// The token is never printed or written; every captured text is redacted anyway.
//
// Usage (one claude at a time): [PROBE_TRIALS=3] [PROBE_ARMS=t:sm,p-json:ac] node probe.mjs
// Writes out/results.json, out/shim-attempts.txt and out/t-*.screen.txt next to this file.
// ============================================================================
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const HOOK = join(HERE, 'ups-hook.mjs');
const TRIALS = Math.max(1, parseInt(process.env.PROBE_TRIALS || '3', 10));
const MODEL = process.env.PROBE_MODEL || 'claude-haiku-4-5-20251001';
const ONLY = (process.env.PROBE_ARMS || '').split(',').filter(Boolean);
const PROMPT = 'Reply with exactly one word: pineapple';
const MIN_TOKEN_MIN = 60;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ------------------------------------------------------------------ credentials
function keychainService() {
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  if (!cfg) throw new Error('CLAUDE_CONFIG_DIR unset: refusing to guess which profile token to read');
  return `Claude Code-credentials-${createHash('sha256').update(cfg).digest('hex').slice(0, 8)}`;
}
function readToken() {
  const raw = execFileSync('/usr/bin/security', ['find-generic-password', '-s', keychainService(), '-w'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  const o = JSON.parse(raw.trim()).claudeAiOauth;
  if (!o?.accessToken) throw new Error('Keychain item has no claudeAiOauth.accessToken');
  const mins = (o.expiresAt - Date.now()) / 60000;
  if (!(mins >= MIN_TOKEN_MIN)) throw new Error(`access token expires in ${Math.round(mins)} min (< ${MIN_TOKEN_MIN}): refusing`);
  return { token: o.accessToken, minsLeft: Math.round(mins) };
}
const { token: TOKEN, minsLeft } = readToken();
const redact = (s) => String(s ?? '').split(TOKEN).join('***REDACTED***').replace(/\bsk-ant-[A-Za-z0-9_-]{8,}/g, '***REDACTED***');

// ------------------------------------------------------------------ no-Keychain shim
const RUN_ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'vfkb-ups-probe-')));
const SHIM_DIR = join(RUN_ROOT, 'shim');
const SHIM_LOG = join(SHIM_DIR, 'attempts.log');
mkdirSync(SHIM_DIR);
writeFileSync(join(SHIM_DIR, 'security'), [
  '#!/bin/sh',
  '# vfkb#408 probe: no Keychain access from spawned claude (vfkb-claude-plugin#71)',
  'sub="$1"; svc=""',
  'while [ $# -gt 0 ]; do [ "$1" = "-s" ] && svc="$2"; shift; done',
  `printf '%s|%s\\n' "$sub" "$svc" >> '${SHIM_LOG}'`,
  'exit 44', '',
].join('\n'));
chmodSync(join(SHIM_DIR, 'security'), 0o755);
const shimLines = () => (existsSync(SHIM_LOG) ? readFileSync(SHIM_LOG, 'utf8').split('\n').filter(Boolean) : []);
const isWrite = (l) => /^(-i|add-generic-password|delete-generic-password|add-internet-password)\|/.test(l);

// ------------------------------------------------------------------ sandbox
function childEnv(home) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC|VFKB_|KB_)/.test(k)) continue; // nothing from this session leaks in
    env[k] = v;
  }
  return {
    ...env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
    PATH: `${SHIM_DIR}:${process.env.PATH}`,
    DISABLE_AUTOUPDATER: '1',
    TERM: 'xterm-256color',
  };
}

function sandbox(mode) {
  const root = mkdtempSync(join(RUN_ROOT, 'trial-'));
  const home = join(root, 'home');
  const cfg = join(home, '.claude');
  const proj = join(root, 'proj');
  const marks = join(root, 'marks');
  mkdirSync(cfg, { recursive: true });
  mkdirSync(join(proj, '.claude'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: proj });
  writeFileSync(join(proj, 'README.md'), '# probe sandbox\n');
  const sm = `VFKBSM${randomBytes(4).toString('hex').toUpperCase()}`;
  const ac = `VFKBAC${randomBytes(4).toString('hex').toUpperCase()}`;
  const cmd = `node "${HOOK}" "${mode}" "${marks}" "${sm}" "${ac}"`;
  writeFileSync(join(proj, '.claude', 'settings.json'), JSON.stringify({
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd }] }] },
  }, null, 2));
  // Pre-seed the sandbox profile so the TUI skips onboarding, theme and trust dialogs.
  writeFileSync(join(cfg, '.claude.json'), JSON.stringify({
    hasCompletedOnboarding: true,
    lastOnboardingVersion: '2.1.292',
    theme: 'dark',
    numStartups: 5,
    bypassPermissionsModeAccepted: false,
    projects: { [proj]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true, projectOnboardingSeenCount: 5 } },
  }, null, 2));
  return { root, home, cfg, proj, marks, sm, ac };
}

const fired = (sb) => (existsSync(sb.marks) ? readdirSync(sb.marks).filter((f) => f.startsWith('fired-')).length : 0);

// Assistant text and transcript-stored hook output, from the sandbox profile's transcript.
function transcript(sb) {
  const pdir = join(sb.cfg, 'projects');
  const lines = [];
  if (existsSync(pdir)) {
    for (const d of readdirSync(pdir)) for (const f of readdirSync(join(pdir, d))) {
      if (f.endsWith('.jsonl')) lines.push(...readFileSync(join(pdir, d, f), 'utf8').split('\n').filter(Boolean));
    }
  }
  let assistantText = '';
  let done = false;
  for (const l of lines) {
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.type === 'assistant') {
      for (const c of j.message?.content || []) if (c.type === 'text') assistantText += c.text + '\n';
      if (j.message?.stop_reason === 'end_turn') done = true;
    }
    if (j.type === 'system' && j.subtype === 'turn_duration') done = true;
  }
  const raw = lines.join('\n');
  return { assistantText, done, smInTranscript: raw.includes(sb.sm), acInTranscript: raw.includes(sb.ac), lines: lines.length };
}

// ------------------------------------------------------------------ surfaces
function runP(sb, format) {
  const args = ['-p', PROMPT, '--model', MODEL, '--strict-mcp-config', '--output-format', format];
  if (format === 'stream-json') args.push('--verbose');
  const r = spawnSync('claude', args, {
    cwd: sb.proj, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: childEnv(sb.home), timeout: 180_000,
  });
  const stdout = redact(r.stdout);
  const stderr = redact(r.stderr);
  // Where in stream-json did a marker land (event type/subtype), if anywhere?
  const where = (m) => {
    if (format !== 'stream-json') return [];
    const hits = [];
    for (const l of stdout.split('\n')) if (l.includes(m)) {
      try { const j = JSON.parse(l); hits.push(`${j.type}${j.subtype ? '/' + j.subtype : ''}`); } catch { hits.push('non-json'); }
    }
    return hits;
  };
  let cli;
  for (const l of stdout.split('\n')) { try { const j = JSON.parse(l); if (j.type === 'system' && j.subtype === 'init') cli = j.claude_code_version; } catch {} }
  return {
    channels: { stdout, stderr },
    detail: { smEvents: where(sb.sm), acEvents: where(sb.ac), stdoutBytes: stdout.length, stderrTail: stderr.split('\n').filter(Boolean).slice(-3), cliFromInit: cli },
    reachedPrompt: true,
  };
}

const ANSI = /\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78DEHMc]/g;
const stripAnsi = (s) => s.replace(ANSI, '');
const compact = (s) => s.replace(/\0/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean).join('\n') + '\n';

function screenCmd(sb, ...a) {
  return spawnSync('screen', ['-S', 'probe', '-p', '0', '-X', ...a], { env: { ...childEnv(sb.home), SCREENDIR: join(sb.root, 'screens') }, encoding: 'utf8' });
}

function runT(sb, tag) {
  const sdir = join(sb.root, 'screens');
  mkdirSync(sdir, { mode: 0o700 });
  const rawLog = join(sb.root, 'raw.log');
  const rc = join(sb.root, 'screenrc');
  writeFileSync(rc, [
    'startup_message off', 'defutf8 on', 'defscrollback 20000', 'term xterm-256color',
    `logfile ${rawLog}`, 'logfile flush 0', 'deflog on', '',
  ].join('\n'));
  const env = { ...childEnv(sb.home), SCREENDIR: sdir };
  // Detached session, 200x50, cwd = the sandbox project.
  const launch = `stty cols 200 rows 50; exec claude --model ${MODEL} --strict-mcp-config`;
  spawnSync('screen', ['-U', '-c', rc, '-dmS', 'probe', '-L', 'sh', '-c', launch], { cwd: sb.proj, env, encoding: 'utf8' });
  screenCmd(sb, 'width', '-w', '200', '50');
  const hard = join(sb.root, 'hard.txt');
  const snap = () => {
    rmSync(hard, { force: true });
    screenCmd(sb, 'hardcopy', '-h', hard);
    sleep(400);
    return existsSync(hard) ? readFileSync(hard, 'utf8') : '';
  };
  // 1. Wait for the input prompt to be live (the footer hint), not merely for output.
  let reachedPrompt = false;
  let pre = '';
  for (let i = 0; i < 60 && !reachedPrompt; i++) {
    sleep(1000);
    pre = snap();
    if (/for shortcuts/.test(pre)) reachedPrompt = true;
  }
  let turnDone = false;
  let screenText = pre;
  if (reachedPrompt) {
    sleep(1500);
    screenCmd(sb, 'stuff', PROMPT);
    sleep(1200);
    screenCmd(sb, 'stuff', '\r');
    // 2. Wait for the turn to finish (transcript), then let the TUI settle.
    for (let i = 0; i < 120 && !turnDone; i++) { sleep(1000); turnDone = transcript(sb).done; }
    sleep(6000);
    screenText = snap(); // rendered buffer incl. scrollback, BEFORE /exit
  }
  screenCmd(sb, 'stuff', '/exit');
  sleep(800);
  screenCmd(sb, 'stuff', '\r');
  sleep(5000);
  screenCmd(sb, 'quit');
  sleep(500);
  const raw = existsSync(rawLog) ? readFileSync(rawLog, 'utf8') : '';
  const rawText = stripAnsi(raw);
  // Saved compacted (trailing blanks trimmed, empty lines dropped: hardcopy -h pads ~20k empty
  // scrollback lines). The assertions below run on the FULL buffer, not this copy.
  writeFileSync(join(OUT, `${tag}.screen.txt`), compact(redact(screenText)));
  return {
    channels: { screen: redact(screenText), screenJoined: redact(screenText.replace(/\s*\n/g, '')), raw: redact(rawText) },
    detail: { screenBytes: screenText.length, rawBytes: raw.length, turnDone },
    reachedPrompt,
  };
}

// ------------------------------------------------------------------ trial
function trial(surface, mode, t) {
  const sb = sandbox(mode);
  const tag = `${surface}-${mode.replace('+', '_')}-${t}`;
  const r = surface === 't' ? runT(sb, tag) : runP(sb, surface === 'p-text' ? 'text' : 'stream-json');
  const tr = transcript(sb);
  const hookRuns = fired(sb);
  const hit = (m) => Object.entries(r.channels).filter(([, v]) => v.includes(m)).map(([k]) => k);
  const smChannels = hit(sb.sm);
  const acChannels = hit(sb.ac);
  const smRelayed = tr.assistantText.includes(sb.sm);
  const acRelayed = tr.assistantText.includes(sb.ac);
  const replied = /pineapple/i.test(tr.assistantText);
  let voidReason = null;
  if (hookRuns === 0) voidReason = 'control: hook side file missing';
  else if (!r.reachedPrompt) voidReason = 'TUI never reached the input prompt';
  else if (!replied) voidReason = 'turn did not complete (no model reply in transcript)';
  const expectSm = mode !== 'ac';
  const shown = (chs, relayed) => (chs.length > 0 && !relayed ? 'RENDERS' : chs.length > 0 ? 'relayed-by-model' : 'absent');
  const row = {
    surface, mode, trial: t, hookRuns, void: voidReason,
    sm: expectSm ? shown(smChannels, smRelayed) : null, smChannels,
    ac: mode !== 'sm' ? shown(acChannels, acRelayed) : null, acChannels,
    modelReplied: replied, smInTranscript: tr.smInTranscript, acInTranscript: tr.acInTranscript,
    ...r.detail,
  };
  rmSync(sb.root, { recursive: true, force: true });
  return row;
}

// ------------------------------------------------------------------ main
mkdirSync(OUT, { recursive: true });
const cli = execFileSync('claude', ['--version'], { env: childEnv(join(RUN_ROOT, 'v')), encoding: 'utf8' }).trim();
const meta = {
  probe: 'ups-systemmessage-2026-10-30', issue: 'vilosource/vfkb#408', date: new Date().toISOString(), cli, model: MODEL,
  trials: TRIALS, prompt: PROMPT, tokenMinutesLeftAtStart: minsLeft,
  platform: `${process.platform} ${process.arch} node ${process.version}`,
  launchctlManager: execFileSync('launchctl', ['managername'], { encoding: 'utf8' }).trim(),
};
console.log(JSON.stringify(meta, null, 2));
const results = [];
for (const surface of ['p-text', 'p-json', 't']) for (const mode of ['sm', 'sm+ac', 'ac']) {
  if (ONLY.length && !ONLY.includes(`${surface}:${mode}`) && !ONLY.includes(surface)) continue;
  for (let t = 1; t <= TRIALS; t++) {
    const row = trial(surface, mode, t);
    results.push(row);
    console.log(redact(JSON.stringify(row)));
  }
}
const shim = shimLines();
meta.shim = { attempts: shim.length, refusedWrites: shim.filter(isWrite).length, lines: shim };
const name = process.env.PROBE_TAG ? `results-${process.env.PROBE_TAG}.json` : 'results.json';
writeFileSync(join(OUT, name), redact(JSON.stringify({ meta, results }, null, 2)) + '\n');
writeFileSync(join(OUT, process.env.PROBE_TAG ? `shim-attempts-${process.env.PROBE_TAG}.txt` : 'shim-attempts.txt'), shim.join('\n') + (shim.length ? '\n' : ''));
console.log(`shim: ${shim.length} attempt(s), ${meta.shim.refusedWrites} refused write(s)`);
rmSync(RUN_ROOT, { recursive: true, force: true });
console.log('wrote', join(OUT, name));
