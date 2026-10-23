const dir = process.argv[2]; process.env.VFKB_DATA_DIR = dir + '/.vfkb';
const { readAll, latestHandoff, isInjectable, isPinCandidate } = await import(dir + '/dist/engine.js');
const all = readAll(); const pin = latestHandoff(all);
const SHAPE = /^\W*(SESSION\s+)?(HANDOFF|RESUME)\b/i;
// Generic = lifecycle words plus kind-of-work words that span streams (RFC-046 §2 cond. 5,
// widened in review round 2: a shared 'rfc' or 'review' tag is not a shared stream).
const GENERIC = new Set(['handoff','next','status','auto','verified','v2','v3',
  'review','escalation','rfc','adr','plugin','l4','guard','release','tooling','cross-repo',
  'distribution','roadmap','public']);
const live = all.filter(e => isInjectable(e) && isPinCandidate(e) && e.id !== pin.id);
const shaped = [...live, pin].filter(e => SHAPE.test(e.text));
const day = 864e5, pinT = Date.parse(pin.created);
const spec = e => (e.tags||[]).filter(t => !GENERIC.has(t));
let base = 0, guarded = 0, noSpec = 0; const lost = [], cleared = [];
for (const e of live.filter(e => SHAPE.test(e.text))) {
  const newer = shaped.filter(o => o.created > e.created);
  if ((pinT - Date.parse(e.created)) / day < 14 || newer.length < 3) continue;
  base++;
  const s = spec(e);
  if (!s.length) { noSpec++; guarded++; continue; }
  const sameStream = newer.filter(o => spec(o).some(t => s.includes(t)));
  if (sameStream.length >= 1) { guarded++; cleared.push(`${e.id} via ${[...new Set(sameStream.flatMap(o => spec(o).filter(t => s.includes(t))))].join(',')}`); } else lost.push(`${e.id} [${s.join(',')}]`);
}
console.log({ pin: pin.id, base, guarded, noSpecificTags: noSpec, heldBack: lost.length }); lost.forEach(l => console.log('  held', l)); cleared.forEach(l => console.log('  cleared', l));

// Round 3: newest-first evaluation (RFC-046 §2 "Evaluation order"). Each archive is applied
// before older entries are checked, so a handoff archived in this run never clears an older
// one. Conservative: it can only hold back more than the snapshot rule above.
{
  const liveSet = new Set(shaped.map(e => e.id));
  const order = live.filter(e => SHAPE.test(e.text)).sort((a, b) => (a.created < b.created ? 1 : -1));
  const archived = [];
  for (const e of order) {
    const newer = shaped.filter(o => liveSet.has(o.id) && o.created > e.created);
    if ((pinT - Date.parse(e.created)) / day < 14 || newer.length < 3) continue;
    const s = spec(e);
    if (s.length && !newer.some(o => spec(o).some(t => s.includes(t)))) continue;
    archived.push(e.id); liveSet.delete(e.id);
  }
  const snapshot = new Set(cleared.map(l => l.split(' ')[0]));
  const fewer = [...snapshot].filter(id => !archived.includes(id));
  console.log('newest-first archives', archived.length, '(snapshot', base - lost.length + ')', 'held only by newest-first:', fewer.join(' '));
}
