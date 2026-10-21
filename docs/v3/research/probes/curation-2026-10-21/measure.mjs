#!/usr/bin/env node
// R7 curation probe (v3): measure the three things RFC-045 proposes to curate, against the
// REAL engine (dist/), never a reimplementation (lesson from the RFC-044 review).
//
//   node docs/v3/research/probes/curation-2026-10-21/measure.mjs <entries.jsonl> [labels.json]
//
// 1. Handoff lifecycle: how many handoff/next-tagged entries are still injectable, which one
//    latestHandoff pins, and how many of the rest are not handoffs at all (topical tags).
// 2. Near-duplicates: injectable pairs whose token sets overlap (Jaccard) above a threshold.
// 3. Staleness: injectable status/next entries and proposed decisions by age.
// With labels.json (the R1 eval), it also reports which R1 top-5 slots go to entries that
// curation would retire, i.e. whether R7 can plausibly move R1's recall@5.
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [src, labelsPath] = process.argv.slice(2);
if (!src) {
  console.error('usage: measure.mjs <entries.jsonl> [labels.json]');
  process.exit(2);
}
const brain = join(mkdtempSync(join(tmpdir(), 'vfkb-r7-probe-')), '.vfkb');
mkdirSync(brain, { recursive: true });
copyFileSync(resolve(src), join(brain, 'entries.jsonl'));
process.env.VFKB_DATA_DIR = brain;
delete process.env.VFKB_DIR;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const engine = await import(join(root, 'dist/engine.js'));
const { InMemoryIndex } = await import(join(root, 'dist/index-store.js'));
const read = await import(join(root, 'dist/read.js'));
const curator = await import(join(root, 'dist/curator.js'));

const all = engine.readAll();
const sup = engine.supersededIds(all);
// "today" is the newest timestamp in the brain, so a pinned snapshot measures as of itself.
const today = all.map((e) => e.updated).sort().at(-1).slice(0, 10);
const live = all.filter((e) => engine.isInjectable(e, today, sup));
const days = (e) => Math.round((Date.parse(today) - Date.parse(e.updated)) / 864e5);
const pin = engine.latestHandoff(all, today, sup);

console.log(`brain ${src}: ${all.length} materialized, ${live.length} injectable, as of ${today}`);

// --- 1. handoff lifecycle ---
const isHo = (e) => e.tags.includes('handoff') || e.tags.includes('next');
const ho = live.filter(isHo);
// A handoff-shaped entry: a fact whose opening names itself a handoff ("HANDOFF ...",
// "SESSION HANDOFF ...", "RESUME ..."). Other handoff/next-tagged entries are topical tag use
// (queued items, rulings, links) and are NOT retire candidates.
const shaped = (e) => e.type === 'fact' && /^\W*(SESSION\s+)?(HANDOFF|RESUME)\b/i.test(e.text);
const nonFact = ho.filter((e) => e.type !== 'fact');
const notShaped = ho.filter((e) => !shaped(e));
const auto = ho.filter((e) => e.tags.includes('auto'));
console.log(`\n## 1. handoff lifecycle`);
console.log(`injectable handoff/next-tagged: ${ho.length} (pin: ${pin?.id ?? 'none'})`);
console.log(`  shaped as a handoff (a fact opening HANDOFF / SESSION HANDOFF / RESUME): ${ho.filter(shaped).length}`);
console.log(`  NOT shaped as a handoff (topical tag use): ${notShaped.length}`);
console.log(`  not type fact: ${nonFact.length} (${[...new Set(nonFact.map((e) => e.type))].join(', ')})`);
console.log(`  SessionEnd auto fallbacks (tag auto): ${auto.length}`);
const older = ho.filter((e) => e.id !== pin?.id);
const buckets = [1, 7, 30, 90, Infinity];
const hist = buckets.map((b, i) => older.filter((e) => days(e) <= b && days(e) > (buckets[i - 1] ?? -1)).length);
console.log(`  non-pinned, by age (<=1d, <=7d, <=30d, <=90d, older): ${hist.join(' / ')}`);
const handoffSupers = all.filter((e) => isHo(e) && e.refs?.supersedes).length;
console.log(`  handoffs that supersede a predecessor (any state): ${handoffSupers}`);
const nonPinnedShaped = older.filter(shaped);
console.log(`  shaped handoffs still injectable but NOT the pin (stale handoffs): ${nonPinnedShaped.length}`);
// The shape regex is a LOWER bound: handoffs also open "SESSION CLOSE", "SESSION 2026-..",
// "CLOSED OUT ..". The tag-and-type boundary (every handoff/next-tagged fact but the pin) is
// the UPPER bound. Where the line falls changes the R1 counterfactual below.
const nonPinnedFacts = older.filter((e) => e.type === 'fact');
console.log(`  UPPER bound - every handoff/next-tagged fact other than the pin: ${nonPinnedFacts.length}`);
const proseSup = all.filter((e) => /supersedes\s+[0-9a-f]{12}\b/.test(e.text));
console.log(`  entries whose TEXT says "supersedes <12-hex id>": ${proseSup.length} (${proseSup.filter(isHo).length} handoff/next-tagged); carrying refs.supersedes: ${all.filter((e) => e.refs?.supersedes).length}, all decisions: ${all.filter((e) => e.refs?.supersedes).every((e) => e.type === 'decision')}`);

// --- 2. near-duplicates ---
const tok = (s) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
const toks = live.map((e) => ({ e, t: tok(e.text) }));
const jac = (a, b) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i || 1);
};
const pairs = [];
for (let i = 0; i < toks.length; i++)
  for (let j = i + 1; j < toks.length; j++) {
    const s = jac(toks[i].t, toks[j].t);
    if (s >= 0.4) pairs.push({ a: toks[i].e, b: toks[j].e, s });
  }
pairs.sort((x, y) => y.s - x.s);
console.log(`\n## 2. near-duplicates (word-set Jaccard over injectable entries)`);
for (const th of [0.4, 0.5, 0.6, 0.7, 0.8])
  console.log(`  pairs >= ${th}: ${pairs.filter((p) => p.s >= th).length}`);
const both = (p, f) => f(p.a) && f(p.b);
// An RFC link and the ADR link that accepted it share most words but are not duplicates.
const docKind = (e) => (/docs\/rfc\//.test(e.text) ? 'rfc' : /docs\/adr\//.test(e.text) ? 'adr' : null);
const rfcAdr = (p) => p.a.type === 'link' && p.b.type === 'link' && docKind(p.a) && docKind(p.b) && docKind(p.a) !== docKind(p.b);
console.log(`  of pairs >= 0.5, both handoff-tagged: ${pairs.filter((p) => p.s >= 0.5 && both(p, isHo)).length}`);
console.log(`  of pairs >= 0.5, same type: ${pairs.filter((p) => p.s >= 0.5 && p.a.type === p.b.type).length}`);
console.log(`  of pairs >= 0.5, an RFC link + its ADR link (related, not duplicate): ${pairs.filter((p) => p.s >= 0.5 && rfcAdr(p)).length}`);
console.log(`  of pairs >= 0.5, otherwise (duplicate candidates): ${pairs.filter((p) => p.s >= 0.5 && !rfcAdr(p)).length}`);
console.log('  top 15:');
for (const p of pairs.slice(0, 15))
  console.log(
    `   ${p.s.toFixed(2)} ${p.a.id}(${p.a.type}${isHo(p.a) ? ',ho' : ''}) ~ ${p.b.id}(${p.b.type}${isHo(p.b) ? ',ho' : ''}) | ${p.a.text.slice(0, 60).replace(/\s+/g, ' ')}`,
  );

// --- 3. staleness ---
console.log(`\n## 3. staleness`);
const statusTagged = live.filter((e) => e.tags.includes('status'));
console.log(`  injectable status-tagged: ${statusTagged.length}; older than 7d: ${statusTagged.filter((e) => days(e) > 7).length}; older than 30d: ${statusTagged.filter((e) => days(e) > 30).length}`);
const proposed = live.filter((e) => e.type === 'decision' && e.status === 'proposed');
console.log(`  proposed decisions: ${proposed.length}; older than 30d: ${proposed.filter((e) => days(e) > 30).length}`);
const incoming = live.filter((e) => e.zone === 'incoming');
console.log(`  incoming zone: ${incoming.length}; older than 30d: ${incoming.filter((e) => days(e) > 30).length}`);
const withValidity = all.filter((e) => e.validity?.valid_until).length;
console.log(`  entries (any state) carrying valid_until: ${withValidity}`);

// --- 4. R1 link ---
if (labelsPath) {
  const labels = JSON.parse(readFileSync(resolve(labelsPath), 'utf8'));
  const index = new InMemoryIndex();
  const staleHo = new Set(nonPinnedShaped.map((e) => e.id));
  const dupLoser = new Set();
  for (const p of pairs.filter((p) => p.s >= 0.5 && !rfcAdr(p))) dupLoser.add((p.a.updated < p.b.updated ? p.a : p.b).id);
  let slots = 0,
    stale = 0,
    dup = 0,
    hits = 0,
    hitsAfter = 0;
  for (const t of labels.topical) {
    const ranked = index.searchScored(t.prompt).map((r) => r.entry.id);
    const top = ranked.slice(0, 5);
    slots += top.length;
    stale += top.filter((id) => staleHo.has(id)).length;
    dup += top.filter((id) => dupLoser.has(id) && !staleHo.has(id)).length;
    const rel = new Set(t.relevant);
    hits += top.filter((id) => rel.has(id)).length / Math.min(5, rel.size);
    // Counterfactual only, NOT a measurement of a built feature: drop the retire candidates
    // from the ranking and re-take the top 5 (no re-scoring; IDF would shift slightly).
    const after = ranked.filter((id) => !staleHo.has(id) && !dupLoser.has(id)).slice(0, 5);
    hitsAfter += after.filter((id) => rel.has(id)).length / Math.min(5, rel.size);
  }
  const n = labels.topical.length;
  console.log(`\n## 4. R1 link (${n} topical prompts, top-5 slots ${slots})`);
  console.log(`  slots held by stale handoffs: ${stale}; by older near-duplicates (>=0.5): ${dup}`);
  console.log(`  recall@5 now ${(hits / n).toFixed(4)}; counterfactual with those dropped ${(hitsAfter / n).toFixed(4)}`);
  // Same counterfactual at the UPPER boundary (every non-pin handoff/next-tagged fact).
  const upper = new Set(nonPinnedFacts.map((e) => e.id));
  let hitsUpper = 0;
  for (const t of labels.topical) {
    const rel = new Set(t.relevant);
    const after = index.searchScored(t.prompt).map((r) => r.entry.id).filter((id) => !upper.has(id)).slice(0, 5);
    hitsUpper += after.filter((id) => rel.has(id)).length / Math.min(5, rel.size);
  }
  console.log(`  counterfactual at the UPPER boundary (${upper.size} dropped): ${(hitsUpper / n).toFixed(4)}`);
  // The FILTERED path (read.query, what kb_search serves), measured by actually archiving
  // in this probe's temp copy of the brain.
  const filtered = () => {
    let h = 0;
    for (const t of labels.topical) {
      const rel = new Set(t.relevant);
      const top = read.query({ text: t.prompt, limit: 5 }).map((e) => e.id);
      h += top.filter((id) => rel.has(id)).length / Math.min(5, rel.size);
    }
    return (h / n).toFixed(4);
  };
  const supRel = labels.topical.filter((t) => t.relevant.some((id) => sup.has(id)));
  const supIds = [...new Set(supRel.flatMap((t) => t.relevant.filter((id) => sup.has(id))))];
  console.log(`  labelled-relevant ids that are superseded (the filtered path can never return them): ${supIds.join(' ')} (in ${supRel.length} prompts' labels)`);
  const relUpper = [...new Set(labels.topical.flatMap((t) => t.relevant).filter((id) => upper.has(id)))];
  console.log(`  labelled-relevant ids inside the UPPER boundary (archiving them would hide a right answer): ${relUpper.length} ${relUpper.join(' ')}`);
  console.log(`  FILTERED path (read.query, limit 5) recall@5 before archiving: ${filtered()}`);
  for (const id of staleHo) curator.archive(id);
  console.log(`  FILTERED path after archiving the ${staleHo.size} shaped stale handoffs: ${filtered()}`);
  for (const id of upper) if (!staleHo.has(id)) curator.archive(id);
  console.log(`  FILTERED path after archiving all ${upper.size} (upper boundary): ${filtered()}`);
  console.log(`  pin after archiving: ${engine.latestHandoff()?.id} (was ${pin?.id})`);
  const lost = labels.topical.flatMap((t) => t.relevant).filter((id) => staleHo.has(id) || dupLoser.has(id));
  console.log(`  labelled-relevant entries that are themselves retire candidates: ${lost.length} ${lost.join(' ')}`);
}

// --- 5. pin ordering hazard (run last: it mutates this probe's temp brain) ---
// latestHandoff orders by `updated`, and every zone change (promote, archive, an un-archive)
// bumps `updated`. So any curation write to an old handoff can make it the pin.
{
  const before = engine.latestHandoff()?.id;
  const old = engine
    .readAll()
    .filter((e) => e.type === 'fact' && (e.tags.includes('handoff') || e.tags.includes('next')) && e.id !== before)
    .sort((a, b) => a.created.localeCompare(b.created))[0];
  engine.updateEntry(old.id, { zone: old.zone === 'archive' ? 'established' : 'incoming' });
  console.log(`\n## 5. pin ordering`);
  console.log(`  zone edit of the OLDEST handoff fact ${old.id} (created ${old.created.slice(0, 10)}): pin ${before} -> ${engine.latestHandoff()?.id}`);
}
