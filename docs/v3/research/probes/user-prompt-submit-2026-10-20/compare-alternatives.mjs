// Compare ADR-0080's pre-declared stage-1 alternatives on the committed R1 eval labels.
// A PROTOTYPE: it re-implements the tokenizer, stemmer and scorers (its bm25+stop row
// reproduces the real InMemoryIndex exactly: recall@5 0.5648, MRR 0.6393). The IDF-cutoff
// row uses one fixed setting, df/N <= 0.5. Run from a vfkb checkout:
//   node docs/v3/research/probes/user-prompt-submit-2026-10-20/compare-alternatives.mjs
import { readFileSync } from 'node:fs';
const rows = readFileSync('test/fixtures/recall-eval/brain-9095dc4.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const L = JSON.parse(readFileSync('test/fixtures/recall-eval/labels.json', 'utf8'));
// materialize like storage: latest by updated per id; drop deleted/archive (index includes all live zones)
const m = new Map(); for (const r of rows) { const p = m.get(r.id); if (!p || r.updated >= p.updated) m.set(r.id, r); }
const E = [...m.values()].filter((e) => !e.deleted);
const stem = (t) => { for (const s of ['ing', 'ed', 'ly', 'es', 's']) if (t.length - s.length >= 3 && t.endsWith(s)) return t.slice(0, -s.length); return t; };
const tok = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1).map(stem);
const STOP = new Set(('a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves').split(' ').map(stem));
const D = E.map((e) => tok(e.text + ' ' + (e.tags ?? []).join(' ')));
const N = D.length, avg = D.reduce((a, d) => a + d.length, 0) / N;
const df = new Map(); for (const d of D) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
const idf = (t) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
function rank(q, o) {
  let terms = [...new Set(tok(q))];
  if (o.stop) terms = terms.filter((t) => !STOP.has(t));
  if (o.cut) terms = terms.filter((t) => (df.get(t) ?? 0) / N <= o.cut);
  return E.map((e, i) => { const tf = new Map(); for (const t of D[i]) if (terms.includes(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0; for (const [t, f] of tf) s += o.bm25 ? (idf(t) * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * D[i].length) / avg)) : f;
    return { e, s }; }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || b.e.updated.localeCompare(a.e.updated)).map((x) => x.e.id);
}
for (const [name, o] of [['count+stop', { stop: 1 }], ['bm25', { bm25: 1 }], ['bm25+stop', { bm25: 1, stop: 1 }], ['bm25+stop+idf<=50%', { bm25: 1, stop: 1, cut: 0.5 }], ['bm25+idf<=50% (no stoplist)', { bm25: 1, cut: 0.5 }]]) {
  let r5 = 0, rr = 0;
  for (const t of L.topical) { const s = rank(t.prompt, o); const rel = new Set(t.relevant); r5 += s.slice(0, 5).filter((x) => rel.has(x)).length / Math.min(rel.size, 5); const f = s.findIndex((x) => rel.has(x)); rr += f < 0 ? 0 : 1 / (f + 1); }
  console.log(name.padEnd(28), 'recall@5', (r5 / L.topical.length).toFixed(4), ' MRR', (rr / L.topical.length).toFixed(4));
}
