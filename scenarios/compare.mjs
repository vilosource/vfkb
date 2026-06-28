#!/usr/bin/env node
// Cross-model L4 report card. Compares the per-model behavior records produced by
// l4-purpose.mjs (scenarios/records/<provider>__<model>.json).
//
//   node scenarios/compare.mjs                       # compare ALL records on file
//   node scenarios/compare.mjs deepseek__deepseek-v4-pro deepseek__deepseek-v4-flash
//   node scenarios/compare.mjs path/to/a.json path/to/b.json

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.argv[1], '..', 'records');
const args = process.argv.slice(2);

function loadRecord(ref) {
  const p = ref.endsWith('.json') ? ref : join(DIR, `${ref}.json`);
  if (!existsSync(p)) throw new Error(`record not found: ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

let records;
if (args.length) records = args.map(loadRecord);
else {
  if (!existsSync(DIR)) { console.error('no records dir yet — run l4-purpose.mjs first'); process.exit(1); }
  records = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => loadRecord(join(DIR, f)));
}
if (records.length === 0) { console.error('no records to compare'); process.exit(1); }

const models = records.map((r) => `${r.provider}/${r.model}`);
const allIds = [...new Set(records.flatMap((r) => Object.keys(r.scenarios || {})))].sort();

// Diff logic keys on the demonstrated verdict only; display shows the trial pass-rate.
const demoOf = (rec, id) => { const s = rec.scenarios?.[id]; return s ? (s.demonstrated ? 'YES' : 'no') : '-'; };
const renderCell = (rec, id) => {
  const s = rec.scenarios?.[id];
  if (!s) return '-';
  const rate = s.trials || (s.demonstrated ? '1/1' : '0/1');
  return `${s.demonstrated ? 'YES' : '.no'} ${rate}`;
};

console.log('=== vfkb L4 cross-model report card ===');
records.forEach((r) => console.log(`  ${r.provider}/${r.model}  (sha ${r.vfkb_sha}, ${Object.keys(r.scenarios || {}).length} scenarios${r.trials_n ? `, N=${r.trials_n}` : ''}${r.image_digest ? `, img ${String(r.image_digest).slice(0, 19)}` : ''}, ${r.generated})`));
console.log('');

const idW = Math.max(10, ...allIds.map((i) => i.length));
console.log('scenario'.padEnd(idW) + ' | ' + models.map((m) => m.slice(0, 22).padEnd(22)).join(' | '));
console.log('-'.repeat(idW) + '-+-' + models.map(() => '-'.repeat(22)).join('-+-'));
const diffs = [];
for (const id of allIds) {
  const demos = records.map((r) => demoOf(r, id));
  const differ = new Set(demos.filter((c) => c !== '-')).size > 1;
  if (differ) diffs.push(id);
  console.log(id.padEnd(idW) + ' | ' + records.map((r) => renderCell(r, id).padEnd(22)).join(' | ') + (differ ? '  <-- DIFFERS' : ''));
}

console.log('');
records.forEach((r) => {
  const ids = Object.keys(r.scenarios || {});
  const dem = ids.filter((i) => r.scenarios[i].demonstrated).length;
  console.log(`SCORE  ${r.provider}/${r.model}: ${dem}/${ids.length} demonstrated`);
});
console.log(diffs.length ? `\nDIVERGENCES (${diffs.length}): ${diffs.join(', ')}` : '\nNo divergences across models on shared scenarios.');
