const dir = process.argv[2]; process.env.VFKB_DATA_DIR = dir + '/.vfkb';
const { readAll, latestHandoff, isInjectable, isPinCandidate } = await import(dir + '/dist/engine.js');
const all = readAll(); const pin = latestHandoff(all);
const SHAPE = /^\W*(SESSION\s+)?(HANDOFF|RESUME)\b/i;
const GENERIC = new Set(['handoff','next','status','auto','verified','v3','v2']);
const live = all.filter(e => isInjectable(e) && isPinCandidate(e) && e.id !== pin.id);
const shaped = [...live, pin].filter(e => SHAPE.test(e.text));
const day = 864e5, pinT = Date.parse(pin.created);
const spec = e => (e.tags||[]).filter(t => !GENERIC.has(t));
let base = 0, guarded = 0, noSpec = 0; const lost = [];
for (const e of live.filter(e => SHAPE.test(e.text))) {
  const newer = shaped.filter(o => o.created > e.created);
  if ((pinT - Date.parse(e.created)) / day < 14 || newer.length < 3) continue;
  base++;
  const s = spec(e);
  if (!s.length) { noSpec++; guarded++; continue; }
  const sameStream = newer.filter(o => spec(o).some(t => s.includes(t)));
  if (sameStream.length >= 1) guarded++; else lost.push(`${e.id} [${s.join(',')}]`);
}
console.log({ pin: pin.id, base, guarded, noSpecificTags: noSpec, heldBack: lost.length }); lost.forEach(l => console.log('  held', l));
