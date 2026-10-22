#!/usr/bin/env node
// Jev re-spike (RFC-043 Part B gate 2, second attempt). THROWAWAY — pre-registration: README.md.
// Usage:
//   node respike.mjs dev  <corpusDir>    # Jev variants V0-V4 on the dev split -> results-dev.json
//   node respike.mjs test <corpusDir>    # locked variant + baselines + Claude arm on test -> results.json
// `test` refuses to run unless locked.json is committed and unmodified.
// Raw responses are cached under <corpusDir>/cache/ (never committed). Outputs are aggregates only.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const [phase, dir] = process.argv.slice(2);
if (!['dev', 'test'].includes(phase) || !dir) { console.error('usage: respike.mjs dev|test <corpusDir>'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const cache = join(dir, 'cache');
mkdirSync(cache, { recursive: true });

// --- corpus (pre-registered) ---
const LABELLERS = ['claude-opus-5-5', 'claude-sonnet-5-5'];
const labels = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8'));
const natural = (sid) => LABELLERS.every((m) => labels[sid]?.[m] === 'natural_close');
const all = readFileSync(join(dir, 'rows.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const rows = all.filter((r) => r.split === phase && (r.label === 0 || natural(r.sid)));
const secondary = all.filter((r) => r.split === phase); // every structural positive (spike-1 definition)
for (const r of all) r.hard = r.b1 !== r.label || r.b2 !== r.label;

// --- Jev ---
const Q4 = {
  close: 'In the most recent user message, the user indicates the work is finished or asks to finish up.',
  more: 'The recent user messages ask for further work or name work to do next in this session.',
  ask: "The assistant's final message ends by asking the user a question or waiting for a decision.",
  done: "The assistant's final message reports that the requested work is complete.",
};
const QEND = { end: 'No more substantive work happens in this session after this turn.' };
const qs = (Q) => Object.fromEntries(Object.entries(Q).map(([k, v]) => [k, { type: 'noul', instructions: v }]));
let key = null;
const getKey = () => (key ??= execFileSync('op', ['read', 'op://Private/JEV_VFKB/credential'], { encoding: 'utf8' }).trim());
let inputTokens = 0;
let modelSeen = new Set();
async function jev(state, Q, rep = 0) {
  const body = { model: 'jev-latest', state, questions: qs(Q) };
  const h = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 20);
  const f = join(cache, `jev-${h}-${rep}.json`);
  if (existsSync(f)) { const j = JSON.parse(readFileSync(f, 'utf8')); j.model && modelSeen.add(j.model); return j; }
  for (let a = 0; a < 6; a++) {
    const t0 = Date.now();
    const r = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', headers: { Authorization: `Bearer ${getKey()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ e: String(e) }) }));
    if (r.status === 429 || r.status >= 500 || r.status === 0) { await new Promise((ok) => setTimeout(ok, 500 * 2 ** a)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    j._ms = Date.now() - t0;
    inputTokens += j.usage?.input_tokens ?? 0;
    j.model && modelSeen.add(j.model);
    writeFileSync(f, JSON.stringify(j));
    return j;
  }
  throw new Error('jev retries exhausted');
}
const p = (j, k) => j.answers?.[k]?.noul;
const s4 = (j) => Math.max(p(j, 'close'), p(j, 'done') * (1 - p(j, 'ask')) * (1 - p(j, 'more')));
const VARIANTS = {
  V0: async (r) => s4(await jev(r.state, Q4)),
  V1: async (r) => p(await jev(r.state, Q4), 'done'),
  V2: async (r) => { let t = 0; for (let k = 0; k < 3; k++) t += s4(await jev(r.state, Q4, k)); return t / 3; },
  V3: async (r) => p(await jev(r.state, QEND), 'end'),
  V4: async (r) => s4(await jev(r.stateLong, Q4)),
};

// --- Claude comparator arm (fixed, never tuned) ---
const ARM_MODEL = 'claude-haiku-4-5';
const ARM_SYSTEM = 'You read the end of one turn of a Claude Code session: the last few user prompts (newest last) and the tail of the assistant\'s final message. Estimate the probability, from 0 to 100, that no more substantive work happens in this session after this turn. Return only that number.';
const ARM_SCHEMA = JSON.stringify({ type: 'object', properties: { p: { type: 'integer', minimum: 0, maximum: 100 } }, required: ['p'] });
function arm(r) {
  const input = `RECENT USER PROMPTS (newest last):\n${r.state.recent_user_messages.map((m, i) => `[${i + 1}] ${m}`).join('\n')}\n\nASSISTANT FINAL MESSAGE TAIL:\n${r.state.assistant_final_message_tail}`;
  const h = createHash('sha256').update(ARM_MODEL + ARM_SYSTEM + input).digest('hex').slice(0, 20);
  const f = join(cache, `arm-${h}.json`);
  if (existsSync(f)) return Promise.resolve(JSON.parse(readFileSync(f, 'utf8')));
  return new Promise((ok, fail) => {
    const t0 = Date.now();
    const c = execFile('claude', ['-p', '--model', ARM_MODEL, '--tools', '', '--strict-mcp-config', '--setting-sources', '',
      '--no-session-persistence', '--output-format', 'json', '--system-prompt', ARM_SYSTEM, '--json-schema', ARM_SCHEMA],
    { cwd: tmpdir(), maxBuffer: 1 << 24, timeout: 300e3 }, (err, out) => {
      if (err) return fail(err);
      const d = JSON.parse(out);
      const used = Object.keys(d.modelUsage || {});
      if (d.is_error || d.structured_output?.p == null || !used.some((m) => m.startsWith(ARM_MODEL))) return fail(new Error(`arm bad result (models ${used})`));
      const res = { p: d.structured_output.p / 100, ms: Date.now() - t0, models: used };
      writeFileSync(f, JSON.stringify(res));
      ok(res);
    });
    c.stdin.end(input);
  });
}

async function pool(items, n, fn) {
  let i = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      for (let a = 0; ; a++) { try { out[k] = await fn(items[k]); break; } catch (e) { if (a >= 2) throw e; } }
    }
  }));
  return out;
}

// --- metrics ---
function auroc(ys, ss) {
  // rank-based Mann-Whitney, ties averaged; null if a class is missing
  const idx = ss.map((s, i) => i).sort((a, b) => ss[a] - ss[b]);
  const rank = new Array(ss.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && ss[idx[j + 1]] === ss[idx[i]]) j++;
    for (let k = i; k <= j; k++) rank[idx[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  const n1 = ys.filter((y) => y === 1).length, n0 = ys.length - n1;
  if (!n1 || !n0) return null;
  const r1 = ys.reduce((a, y, i) => a + (y === 1 ? rank[i] : 0), 0);
  return (r1 - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}
const A = (xs, f) => auroc(xs.map((r) => r.label), xs.map(f));
function ece(xs, f, bins = 10) {
  let e = 0;
  for (let b = 0; b < bins; b++) {
    const inb = xs.filter((x) => Math.min(bins - 1, Math.floor(f(x) * bins)) === b);
    if (!inb.length) continue;
    e += (inb.length / xs.length) * Math.abs(inb.reduce((a, x) => a + f(x), 0) / inb.length - inb.reduce((a, x) => a + x.label, 0) / inb.length);
  }
  return e;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
function clusterBoot(xs, stat, B = 5000) {
  // resample sessions with replacement; stat(rows) -> number|null
  const bySid = new Map();
  for (const r of xs) (bySid.get(r.sid) ?? bySid.set(r.sid, []).get(r.sid)).push(r);
  const groups = [...bySid.values()];
  const rand = rng(20261022);
  const v = [];
  for (let b = 0; b < B; b++) {
    const sample = [];
    for (let g = 0; g < groups.length; g++) sample.push(...groups[Math.floor(rand() * groups.length)]);
    const x = stat(sample);
    if (x != null) v.push(x);
  }
  v.sort((a, b) => a - b);
  return { lo: v[Math.floor(0.025 * v.length)], hi: v[Math.floor(0.975 * v.length) - 1], n: v.length };
}
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const counts = (xs) => ({ turns: xs.length, sessions: new Set(xs.map((r) => r.sid)).size, pos: xs.filter((r) => r.label).length, hardPos: xs.filter((r) => r.hard && r.label).length, hardNeg: xs.filter((r) => r.hard && !r.label).length });

if (phase === 'dev') {
  const res = { phase, date: new Date().toISOString().slice(0, 10), counts: counts(rows), variants: {} };
  for (const [v, fn] of Object.entries(VARIANTS)) {
    const sc = await pool(rows, 8, fn);
    rows.forEach((r, i) => (r[v] = sc[i]));
    const hard = rows.filter((r) => r.hard);
    res.variants[v] = { all: r4(A(rows, (r) => r[v])), hard: r4(A(hard, (r) => r[v])) };
    console.error(v, res.variants[v]);
  }
  res.baselines = { b1: r4(A(rows, (r) => r.b1)), b2: r4(A(rows, (r) => r.b2)) };
  const ranked = Object.entries(res.variants).sort((a, b) => b[1].hard - a[1].hard || a[0].localeCompare(b[0]));
  res.chosen = ranked[0][0];
  res.jevModels = [...modelSeen];
  res.inputTokens = inputTokens;
  writeFileSync(join(here, 'results-dev.json'), JSON.stringify(res, null, 2) + '\n');
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

// --- test: only with a committed, unmodified lock ---
const lockPath = join(here, 'locked.json');
const git = (...a) => execFileSync('git', ['-C', here, ...a], { encoding: 'utf8' });
if (!existsSync(lockPath) || !git('ls-files', 'locked.json').trim() || git('status', '--porcelain', 'locked.json').trim()) {
  console.error('refusing: locked.json must be committed and unmodified before the test split is scored');
  process.exit(3);
}
const { variant } = JSON.parse(readFileSync(lockPath, 'utf8'));
const fn = VARIANTS[variant];
const union = [...new Map([...rows, ...secondary].map((r) => [`${r.sid}:${r.k}`, r])).values()];
const sc = await pool(union, 8, fn);
union.forEach((r, i) => (r.jev = sc[i]));
const am = await pool(rows, 6, arm);
rows.forEach((r, i) => ((r.arm = am[i].p), (r.armMs = am[i].ms)));
const hard = rows.filter((r) => r.hard);
const bar = A(rows, (r) => r.b1) + 0.05;
const hardCI = clusterBoot(hard, (x) => A(x, (r) => r.jev));
const diffCI = clusterBoot(rows, (x) => { const a = A(x, (r) => r.jev), b = A(x, (r) => r.b1); return a == null || b == null ? null : a - b; });
const aAll = A(rows, (r) => r.jev), aHard = A(hard, (r) => r.jev);
const jevMs = [];
for (const r of rows) {
  const st = variant === 'V4' ? r.stateLong : r.state;
  const Q = variant === 'V3' ? QEND : Q4;
  const body = { model: 'jev-latest', state: st, questions: qs(Q) };
  const h = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 20);
  const f = join(cache, `jev-${h}-0.json`);
  if (existsSync(f)) { const ms = JSON.parse(readFileSync(f, 'utf8'))._ms; if (ms != null) jevMs.push(ms); }
}
let gate;
if (aAll == null || aHard == null) gate = 'NOT DECIDED (a class is missing)';
else if (aAll >= bar && hardCI.lo >= 0.7) gate = 'PASS';
else if (aAll < bar || hardCI.hi < 0.7) gate = 'FAIL';
else gate = 'NOT DECIDED (hard-case interval straddles 0.70)';
const lab = Object.values(labels);
const pairs = lab.map((v) => LABELLERS.map((m) => (v[m] === 'natural_close' ? 1 : 0)));
const po = pairs.filter(([a, b]) => a === b).length / pairs.length;
const pa = pairs.filter(([a]) => a).length / pairs.length, pb = pairs.filter(([, b]) => b).length / pairs.length;
const kappa = (po - (pa * pb + (1 - pa) * (1 - pb))) / (1 - (pa * pb + (1 - pa) * (1 - pb)));
if (kappa < 0.6) gate = `NOT DECIDED (labeller kappa ${r4(kappa)} < 0.6)`;
const hardArm = clusterBoot(hard, (x) => A(x, (r) => r.arm));
const res = {
  phase, date: new Date().toISOString().slice(0, 10), variant, jevModels: [...modelSeen], armModel: ARM_MODEL,
  counts: counts(rows), labellerKappa: r4(kappa),
  jev: { all: r4(aAll), hard: r4(aHard), hardCI: [r4(hardCI.lo), r4(hardCI.hi)], diffVsB1CI: [r4(diffCI.lo), r4(diffCI.hi)], ece: r4(ece(rows, (r) => r.jev)), latencyMs: { p50: pct(jevMs, 0.5), p95: pct(jevMs, 0.95), n: jevMs.length } },
  baselines: { b1: r4(A(rows, (r) => r.b1)), b2: r4(A(rows, (r) => r.b2)), bar: r4(bar) },
  claudeArm: { all: r4(A(rows, (r) => r.arm)), hard: r4(A(hard, (r) => r.arm)), hardCI: [r4(hardArm.lo), r4(hardArm.hi)], latencyMs: { p50: pct(rows.map((r) => r.armMs), 0.5), p95: pct(rows.map((r) => r.armMs), 0.95) } },
  secondary: { counts: counts(secondary), jevAll: r4(A(secondary, (r) => r.jev)), jevHard: r4(A(secondary.filter((r) => r.hard), (r) => r.jev)) },
  inputTokens, gate2: gate,
};
writeFileSync(join(here, 'results.json'), JSON.stringify(res, null, 2) + '\n');
console.log(JSON.stringify(res, null, 2));
