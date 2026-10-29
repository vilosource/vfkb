#!/usr/bin/env node
// ============================================================================
// vfkb#411 Tier-0 UserPromptSubmit WORDING probe. Pre-registered rule: README.md in this
// directory (committed and pushed at 0af204f before any trial). Pure core:
// scenarios/lib/ups-wording.mjs (unit-tested in test/ups-wording.test.ts).
//
// One trial = the handoff-next-prompt treatment-stale shape (sandbox, turn 1 creates the
// greeter, a `docs: release checklist` commit, a wrap-up turn 2 on --resume). The only
// difference between variants is the UserPromptSubmit hook: the REAL vendored engine piped
// through ups-variant.mjs, which rewrites only additionalContext.
//
// The sandbox / turn / isolation helpers are copied from scenarios/handoff-next-prompt.mjs
// unchanged (that scenario is the gate; it is not refactored for the probe).
//
// LIVE + metered. One run at a time. NOT part of npm test.
//   VFKB_UPS_CLI=<vfkb.mjs @ plugin 479fad1> VFKB_UPS_MCP=<vfkb-mcp.mjs @ 479fad1> \
//     node docs/research/probes/ups-wording-2026-10-29/probe.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUN_MARKER, scoreTrial, hasLine } from '../../../../scenarios/lib/nudge-verdict.mjs';
import {
  VARIANTS, VALID_PER_VARIANT, MAX_ATTEMPTS_PER_VARIANT, FIXTURE_E2AC6E9,
  transformText, isV0Shape, preconditions, probeVerdict, nextVariant,
} from '../../../../scenarios/lib/ups-wording.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const VARIANT_STEP = join(HERE, 'ups-variant.mjs');
const OUT = join(HERE, 'observed.json');
const EXPECT = {
  cli: '9d938a399fc9684d3fbd315655e495283934cc2cc4bf5696901b813a7c00f363',
  mcp: 'e1948509ecc274d3e4b04263a45c4b0a72a59024dc41f7ac82e7bc8a8a5369f7',
};
const MODEL = 'claude-haiku-4-5';
const TIMEOUT = 300000;
const LEAK_FILES = ['src/format-date.ts', 'docs/notes.md'];

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

if (!process.env.VFKB_UPS_CLI || !process.env.VFKB_UPS_MCP) { console.error('set VFKB_UPS_CLI and VFKB_UPS_MCP'); process.exit(2); }
const CLI = resolve(process.env.VFKB_UPS_CLI);
const MCP = resolve(process.env.VFKB_UPS_MCP);
const got = { cli: sha256(CLI), mcp: sha256(MCP) };
if (got.cli !== EXPECT.cli || got.mcp !== EXPECT.mcp) {
  console.error(`engine hash mismatch: ${JSON.stringify(got)} ≠ ${JSON.stringify(EXPECT)} — aborting, no record`);
  process.exit(2);
}
const pre = preconditions(FIXTURE_E2AC6E9);
if (pre.length) { console.error(`precondition failed: ${pre.join('; ')} — aborting, no record`); process.exit(2); }

// ── copied from scenarios/handoff-next-prompt.mjs (unchanged except the UPS command) ──
function teeHook(sub, log) {
  const inner = `echo ${q(RUN_MARKER)} >> ${q(log)}; VFKB_DATA_DIR=.vfkb VFKB_PROJECT=hnp node ${q(CLI)} hook ${sub} | tee -a ${q(log)}; echo >> ${q(log)}`;
  return `sh -c ${q(inner)}`;
}
// The probe's UPS hook: the real engine, tee'd raw, then the variant rewrite, tee'd.
function upsHook(variant, logs) {
  const inner = `echo ${q(RUN_MARKER)} >> ${q(logs.ups)}; echo ${q(RUN_MARKER)} >> ${q(logs.raw)}; ` +
    `VFKB_DATA_DIR=.vfkb VFKB_PROJECT=hnp node ${q(CLI)} hook user-prompt-submit | tee -a ${q(logs.raw)} | ` +
    `node ${q(VARIANT_STEP)} ${variant} ${q(logs.void)} | tee -a ${q(logs.ups)}; echo >> ${q(logs.ups)}; echo >> ${q(logs.raw)}`;
  return `sh -c ${q(inner)}`;
}
const plainHook = (sub) => `VFKB_DATA_DIR=.vfkb VFKB_PROJECT=hnp node ${q(CLI)} hook ${sub}`;

function settings({ variant, sessionEnd, logs }) {
  const hooks = {
    SessionStart: [{ hooks: [{ type: 'command', command: plainHook('session-start') }] }],
    PreToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: plainHook('pre-tool-use') }] }],
    Stop: [{ hooks: [{ type: 'command', command: teeHook('stop', logs.stop) }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: upsHook(variant, logs) }] }],
  };
  if (sessionEnd) hooks.SessionEnd = [{ hooks: [{ type: 'command', command: plainHook('session-end') }] }];
  return JSON.stringify({ enabledPlugins: { 'vfkb@vfkb': false }, hooks }, null, 2);
}

function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-ups-'));
  const logDir = mkdtempSync(join(tmpdir(), 'vfkb-ups-logs-'));
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
  const past = new Date(Date.now() - 60_000).toISOString();
  git(['commit', '-qm', 'seed'], { GIT_AUTHOR_DATE: past, GIT_COMMITTER_DATE: past });
  git(['checkout', '-q', '-b', 'feat/work']);
  cli('add', 'fact', 'handoff: the app scaffold is in place. next: add a greeter module.', '--tag', 'handoff,next', '--role', 'human');
  git(['add', '.vfkb/entries.jsonl']);
  git(['commit', '-qm', 'vfkb: handoff']);
  return {
    dir, logDir, cli, git,
    logs: { stop: join(logDir, 'stop.log'), ups: join(logDir, 'ups.log'), raw: join(logDir, 'raw.log'), void: join(logDir, 'void.log') },
  };
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
  return { reasons, result, cliVersion: init?.claude_code_version || null, models };
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
const ctxOf = (log) => {
  const m = log && /"additionalContext":"((?:[^"\\]|\\.)*)"/.exec(log);
  return m ? JSON.parse(`"${m[1]}"`) : null;
};

function runTrial(variant) {
  const sentinel = `greeter-${randomBytes(3).toString('hex')}`;
  const file = `src/${sentinel}.ts`;
  const sb = makeSandbox();
  const sid = randomUUID();
  const setTurn = (turn) => writeFileSync(join(sb.dir, '.claude/settings.json'), settings({ variant, sessionEnd: turn === 2, logs: sb.logs }));
  const started = new Date().toISOString();

  setTurn(1);
  const t1 = runTurn(sb, `Create the file ${file} ON DISK ` +
    '(use your file-writing tool) exporting a function greet(name: string) that returns "Hello, <name>!". ' +
    'Do not commit anything. Reply "done" when the file exists.', ['--session-id', sid]);
  const ups1 = readText(sb.logs.ups);
  const raw1 = readText(sb.logs.raw);

  writeFileSync(join(sb.dir, 'docs/notes.md'), `# notes\n\nrelease checklist drafted (${Date.now()})\n`);
  sb.git(['add', 'docs/notes.md']);
  sb.git(['commit', '-qm', 'docs: release checklist']);
  const before = entries(sb.dir).length;

  setTurn(2);
  const t2 = runTurn(sb, "That's everything for today — we're done for this session, thanks.", ['--resume', sid]);
  const ups2 = readText(sb.logs.ups).slice(ups1.length);
  const raw2 = readText(sb.logs.raw).slice(raw1.length);
  const voidLog = readText(sb.logs.void);
  const turn2Entries = entries(sb.dir).slice(before);
  const leak = leaks([file]);
  const stopLog = readText(sb.logs.stop);

  const scored = scoreTrial({
    arm: 'treatment-stale', sentinel, leak,
    isolationReasons: [...t1.reasons.map((r) => `t1: ${r}`), ...t2.reasons.map((r) => `t2: ${r}`)],
    engaged: !!t1.result && !!t2.result, ups1, ups2, stopLog, turn2Entries,
  });
  // Probe-specific INVALID rules 5–7 (README).
  const invalid = [...scored.invalid];
  const rawLine = ctxOf(raw2);
  const upsLine = ctxOf(ups2);
  const expected = rawLine === null ? null : transformText(variant, rawLine);
  if (voidLog.includes('void: transform-miss')) invalid.push('transform miss');
  if (!hasLine(ups2) || upsLine === null) invalid.push('turn-2 line not emitted');
  else if (upsLine !== expected) invalid.push('emitted line is not the variant text');
  if (!isV0Shape(rawLine)) invalid.push('raw engine line is not V0-shaped');

  rmSync(sb.dir, { recursive: true, force: true });
  rmSync(sb.logDir, { recursive: true, force: true });
  return {
    variant, sentinel, started, invalid, deterministicFail: scored.deterministicFail,
    pass: invalid.length === 0 && scored.pass,
    // diagnostics, never predicates
    upsLine, rawLine,
    turn2Handoffs: turn2Entries.filter((e) => (e.tags || []).some((t) => t === 'handoff' || t === 'next'))
      .map((e) => ({ tags: e.tags, text: String(e.text).slice(0, 300) })),
    finalAnswer: String(t2.result?.result ?? '').slice(0, 2000),
    errors: [t1.err, t2.err].filter(Boolean),
    cliVersion: t2.cliVersion || t1.cliVersion, modelUsage: [...new Set([...t1.models, ...t2.models])],
  };
}

const git = (...a) => { try { return sh('git', a, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const trials = [];
const st = Object.fromEntries(VARIANTS.map((v) => [v, { attempts: 0, valid: 0 }]));
function write(done) {
  const counts = Object.fromEntries(VARIANTS.map((v) => {
    const scored = trials.filter((t) => t.variant === v && t.invalid.length === 0).slice(0, VALID_PER_VARIANT);
    return [v, { attempts: st[v].attempts, valid: scored.length, pass: scored.filter((t) => t.pass).length }];
  }));
  const verdict = done ? probeVerdict(counts) : { outcome: 'IN-PROGRESS', reasons: [] };
  writeFileSync(OUT, JSON.stringify({
    probe: 'ups-wording-2026-10-29', preRegistered: '0af204fc4f1e565c088796041b50647dae51217b', model: MODEL,
    generated: new Date().toISOString(), complete: done, engineCli: CLI, engineCliSha256: got.cli, engineMcpSha256: got.mcp,
    engineSource: 'vilosource/vfkb-claude-plugin@479fad1 plugin/dist/bundles (vfkb main@e2ac6e9)', vfkbSha: git('rev-parse', 'HEAD'),
    cliVersions: [...new Set(trials.map((t) => t.cliVersion).filter(Boolean))],
    rule: 'separates = p(V) >= 4/5 and p(V0) <= 3/5; README PRE-REGISTRATION', counts, verdict, trials,
  }, null, 2) + '\n');
  return { counts, verdict };
}

console.log(`vfkb#411 UPS wording probe (model=${MODEL}; engine=${CLI})`);
let last = null, i = 0;
for (let v = nextVariant(st, last); v; v = nextVariant(st, last)) {
  i++;
  process.stdout.write(`  #${String(i).padStart(2)} ${v} attempt ${st[v].attempts + 1} … `);
  const r = runTrial(v);
  trials.push(r);
  st[v].attempts++;
  if (r.invalid.length === 0) st[v].valid++;
  console.log(`${r.invalid.length ? 'INVALID ' + r.invalid.join('; ') : r.pass ? 'PASS' : 'fail'}` +
    `${r.deterministicFail.length ? '  DET: ' + r.deterministicFail.join('; ') : ''}  :: ${r.finalAnswer.replace(/\s+/g, ' ').slice(0, 110)}`);
  last = v;
  write(false);
}
const { counts, verdict } = write(true);
console.log(`\ncounts: ${JSON.stringify(counts)}\nverdict: ${verdict.outcome} — ${verdict.reasons.join('; ')}\nrecord → ${OUT}`);
