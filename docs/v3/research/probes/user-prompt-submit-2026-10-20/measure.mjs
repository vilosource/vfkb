#!/usr/bin/env node
// R1 selection measurement — deterministic, free. Rebuilds the brain exactly as it was
// at BRAIN_SHA (default 9095dc4, the snapshot RFC-044 cites) into a temp dir, then:
//   (a) what the RFC-001 floor does to real prompts (it drops matches; it never reorders)
//   (b) 1-based ranks of the entries each prompt is ABOUT, under four stage-1 scorers:
//       the current one (occurrence count), count + stopwords, BM25, BM25 + stopwords.
// The stopword list is a generic English list (NLTK-style), NOT tuned to these prompts.
// The three ALTERNATIVE scorers are prototypes over the same tokenizer/stemmer; only the
// current scorer's row is the real index.
//
//   cd <vfkb checkout> && npm run build
//   node docs/v3/research/probes/user-prompt-submit-2026-10-20/measure.mjs [BRAIN_SHA]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.cwd();
const SHA = process.argv[2] || '9095dc4';
const tmp = mkdtempSync(join(tmpdir(), 'r1-measure-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const brain = join(tmp, '.vfkb');
mkdirSync(brain, { recursive: true });
writeFileSync(join(brain, 'entries.jsonl'), execFileSync('git', ['show', `${SHA}:.vfkb/entries.jsonl`], { cwd: REPO, maxBuffer: 64 << 20 }));
process.env.VFKB_DATA_DIR = brain;
const { queryExplained } = await import(join(REPO, 'dist', 'read.js'));
const idx = await import(join(REPO, 'dist', 'index-store.js'));
const I = new idx.InMemoryIndex();
const E = I.all();

const PROMPTS = [
  'what is in our roadmap?',
  'we were going to use JEV as well were we not?',
  'ok we keep it optional as it is now, lets get to work',
  'has the review settled?',
  'why is it on the merged branch? do what is best',
  'proceed but lets fix the smaller things first',
  'we need to restart, so handoff at first opportunity and pause',
  'continue autonomously',
];

// (a) the floor
console.log(`brain @ ${SHA}: ${E.length} live entries\n\n(a) RFC-001 floor (drops candidates matching < 1/3 of query terms; never reorders)`);
for (const p of PROMPTS) {
  const s = I.searchScored(p, 100000);
  const q = idx.queryTermCount(p);
  const below = s.filter((x) => x.matched / q < 1 / 3).length;
  const withFloor = queryExplained({ text: p }).results.length;
  const noFloor = queryExplained({ text: p, minTermRatio: 0 }).results.length;
  const top3 = queryExplained({ text: p }).results.slice(0, 3).map((e) => e.text.length);
  console.log(`  ${p.padEnd(62)} matched ${String(s.length).padStart(3)}  below-floor ${String(below).padStart(3)}  results ${noFloor}->${withFloor}  top-3 lengths ${top3.join(',')}`);
}

// (b) rankers
const stem = (t) => { for (const s of ['ing', 'ed', 'ly', 'es', 's']) if (t.length - s.length >= 3 && t.endsWith(s)) return t.slice(0, -s.length); return t; };
const tok = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1).map(stem);
const STOP = new Set(('a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves').split(' ').map(stem));
const docs = E.map((e) => tok(e.text + ' ' + (e.tags ?? []).join(' ')));
const N = docs.length;
const avg = docs.reduce((a, d) => a + d.length, 0) / N;
const df = new Map();
for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
const idf = (t) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
function rank(q, { bm25, stop }) {
  const terms = [...new Set(tok(q))].filter((t) => !(stop && STOP.has(t)));
  return docs.map((d, i) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of terms) {
      const f = tf.get(t) ?? 0;
      if (!f) continue;
      s += bm25 ? (idf(t) * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * d.length) / avg)) : f;
    }
    return { i, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
}
const CASES = [
  ['we were going to use JEV as well were we not?', (e) => ['aa294b2708c4', '8b2aefd11171', '7a1ffdd4e6f0'].includes(e.id)],
  ['what is in our roadmap?', (e) => e.type === 'link' && /roadmap/i.test(e.text)],
];
console.log('\n(b) 1-based ranks of the relevant entries');
for (const [q, rel] of CASES) {
  console.log(`  > ${q}`);
  // The CURRENT scorer's row comes from the REAL index (InMemoryIndex.searchScored), not a
  // reimplementation: its tie-break (newest `updated` first) decides ranks inside large
  // score-tie bands, so a reimplementation reports different ranks (#362 review round 2).
  const real = I.searchScored(q, 100000);
  const realRanks = real.map((x, k) => [k + 1, x]).filter(([, x]) => rel(x.entry));
  const band = (score) => { const b = real.map((y, j) => [j + 1, y.score]).filter(([, sc]) => sc === score).map(([j]) => j); return `${b[0]}-${b.at(-1)}`; };
  console.log(`    ${'current (REAL idx)'.padEnd(18)} matched ${String(real.length).padStart(3)}  relevant ranks ${realRanks.map(([k, x]) => `${k} (tie band ${band(x.score)})`).join(', ')}`);
  for (const [name, mode] of [['count + stopwords', { stop: 1 }], ['BM25', { bm25: 1 }], ['BM25 + stopwords', { bm25: 1, stop: 1 }]]) {
    const r = rank(q, mode);
    const ranks = r.map((x, k) => [k + 1, E[x.i]]).filter(([, e]) => rel(e)).map(([k]) => k);
    console.log(`    ${name.padEnd(18)} matched ${String(r.length).padStart(3)}  relevant ranks ${ranks.slice(0, 4).join(', ')}`);
  }
}
