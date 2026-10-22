#!/usr/bin/env node
// Jev calibration spike (RFC-043 Part B gate 2). THROWAWAY — not production code.
// Pre-registration: README.md in this directory. Usage:
//   node spike.mjs <turns.jsonl> <cacheDir> [--exclude <sid>[,<sid>]] [--dry]
// --dry builds windows, labels and the baseline, and makes NO API call.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const [turnsPath, cacheDir] = args;
const ex = args.includes('--exclude') ? args[args.indexOf('--exclude') + 1].split(',') : [];
const dry = args.includes('--dry');
if (!turnsPath || !cacheDir) {
  console.error('usage: spike.mjs <turns.jsonl> <cacheDir> [--exclude sid,..] [--dry]');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const { detectSecrets } = await import(join(root, 'dist/secrets.js'));
mkdirSync(cacheDir, { recursive: true });

// --- corpus, labels, windows (pre-registered) ---
const turns = readFileSync(turnsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const bySession = new Map();
for (const t of turns) {
  if (ex.some((p) => t.s.startsWith(p))) continue;
  (bySession.get(t.s) ?? bySession.set(t.s, []).get(t.s)).push(t);
}
const rows = [];
let secretSkipped = 0;
for (const [sid, ts] of bySession) {
  ts.sort((a, b) => a.i - b.i);
  ts.forEach((t, k) => {
    const label = ts.slice(k + 1).some((u) => u.tools > 0) ? 0 : 1;
    const prompts = ts.slice(Math.max(0, k - 2), k + 1).map((u) => u.prompt.slice(0, 600));
    const finalTail = (t.final || '').slice(-1000);
    const state = { recent_user_messages: prompts, assistant_final_message_tail: finalTail };
    const text = prompts.join('\n') + '\n' + finalTail;
    if (detectSecrets(text).length) {
      secretSkipped++;
      return;
    }
    const kw = /wrap(\s|-)?up|that'?s all|hand\s?off|commit and push|i will exit|new session|we('| a)re done/i;
    const base = kw.test(prompts.at(-1)) && !finalTail.trimEnd().endsWith('?') ? 1 : 0;
    rows.push({ sid, i: t.i, label, base, state });
  });
}

// --- the four questions, worded as RFC-043 Part B's table ---
const Q = {
  close: 'In the most recent user message, the user indicates the work is finished or asks to finish up.',
  more: 'The recent user messages ask for further work or name work to do next in this session.',
  ask: "The assistant's final message ends by asking the user a question or waiting for a decision.",
  done: "The assistant's final message reports that the requested work is complete.",
};
const body = (state) => ({
  model: 'jev-latest',
  state,
  questions: Object.fromEntries(Object.entries(Q).map(([k, v]) => [k, { type: 'noul', instructions: v }])),
});

let key = null;
const getKey = () =>
  (key ??= execFileSync('op', ['read', 'op://Private/JEV_VFKB/credential'], { encoding: 'utf8' }).trim());
let inputTokens = 0;
const CAP = 20_000_000;
let modelSeen = null;
async function call(state, rep = 0) {
  const h = createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 16);
  const f = join(cacheDir, `${h}-${rep}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  if (inputTokens > CAP) throw new Error(`cost cap: ${inputTokens} input tokens`);
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body(state)),
    });
    if (r.status === 429 || r.status === 529) {
      await new Promise((ok) => setTimeout(ok, 500 * 2 ** attempt));
      continue;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    inputTokens += j.usage?.input_tokens ?? 0;
    modelSeen = j.model ?? modelSeen;
    writeFileSync(f, JSON.stringify(j));
    return j;
  }
  throw new Error('retries exhausted');
}
const p = (j, k) => j.answers?.[k]?.noul;
const score = (j) => Math.max(p(j, 'close'), p(j, 'done') * (1 - p(j, 'ask')) * (1 - p(j, 'more')));

// --- metrics ---
function auroc(xs) {
  // xs: [{y, s}]. Mann-Whitney U with ties counted half. null if a class is missing.
  const pos = xs.filter((x) => x.y === 1), neg = xs.filter((x) => x.y === 0);
  if (!pos.length || !neg.length) return null;
  let u = 0;
  for (const a of pos) for (const b of neg) u += a.s > b.s ? 1 : a.s === b.s ? 0.5 : 0;
  return u / (pos.length * neg.length);
}
function ece(xs, bins = 10) {
  let e = 0;
  for (let b = 0; b < bins; b++) {
    const inb = xs.filter((x) => Math.min(bins - 1, Math.floor(x.s * bins)) === b);
    if (!inb.length) continue;
    const conf = inb.reduce((a, x) => a + x.s, 0) / inb.length;
    const acc = inb.reduce((a, x) => a + x.y, 0) / inb.length;
    e += (inb.length / xs.length) * Math.abs(conf - acc);
  }
  return e;
}
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

const pos = rows.filter((r) => r.label === 1).length;
console.log(`sessions ${bySession.size}, turns ${rows.length} (wrap-up ${pos}, not ${rows.length - pos}), secret-skipped ${secretSkipped}`);
const baseAll = auroc(rows.map((r) => ({ y: r.label, s: r.base })));
const hard = rows.filter((r) => r.base !== r.label);
console.log(`baseline AUROC ${r4(baseAll)}; hard cases ${hard.length} (wrap-up ${hard.filter((r) => r.label).length})`);
if (dry) process.exit(0);

for (const r of rows) r.j = await call(r.state);
const all = rows.map((r) => ({ y: r.label, s: score(r.j) }));
const hardXs = hard.map((r) => ({ y: r.label, s: score(r.j) }));
const perQ = Object.fromEntries(Object.keys(Q).map((k) => [k, r4(auroc(rows.map((r) => ({ y: r.label, s: p(r.j, k) }))))]));
// repeat variance: first 10 windows x 5 calls (rep 0 is the main call)
let maxDelta = 0;
for (const r of rows.slice(0, 10)) {
  const ss = [score(r.j)];
  for (let rep = 1; rep < 5; rep++) ss.push(score(await call(r.state, rep)));
  maxDelta = Math.max(maxDelta, Math.max(...ss) - Math.min(...ss));
}
const aAll = auroc(all), aHard = auroc(hardXs);
const pass = aAll != null && baseAll != null && aAll >= baseAll + 0.05 && aHard != null && aHard >= 0.7;
const res = {
  date: new Date().toISOString().slice(0, 10),
  model: modelSeen,
  sessions: bySession.size,
  turns: rows.length,
  wrapUp: pos,
  secretSkipped,
  inputTokens,
  costUsd: r4((inputTokens / 1e6) * 0.042),
  baselineAuroc: r4(baseAll),
  modelAuroc: r4(aAll),
  perQuestionAuroc: perQ,
  hardCases: hard.length,
  hardWrapUp: hard.filter((r) => r.label).length,
  modelAurocHard: r4(aHard),
  ece: r4(ece(all)),
  repeatMaxDeltaS: r4(maxDelta),
  gate2: aHard == null ? 'NOT MET (hard-case clause not evaluable)' : pass ? 'PASS' : 'FAIL',
};
writeFileSync(join(here, 'results.json'), JSON.stringify(res, null, 2) + '\n');
console.log(JSON.stringify(res, null, 2));
