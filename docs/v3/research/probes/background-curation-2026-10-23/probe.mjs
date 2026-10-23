const dir = process.argv[2];
process.env.VFKB_DATA_DIR = dir + '/.vfkb';
const { readAll } = await import(dir + '/dist/engine.js');
const { latestHandoff, isInjectable, isPinCandidate } = await import(dir + '/dist/engine.js');
const all = readAll();
const pin = latestHandoff(all);
const SHAPE = /^\W*(SESSION\s+)?(HANDOFF|RESUME)\b/i;
const live = all.filter(e => isInjectable(e) && isPinCandidate(e) && e.id !== pin.id);
const day = 864e5, pinT = Date.parse(pin.created);
const rows = live.map(e => ({ id: e.id, shaped: SHAPE.test(e.text), gapDays: (pinT - Date.parse(e.created)) / day,
  newerShaped: live.filter(o => SHAPE.test(o.text) && o.created > e.created).length + 1,
  tags: e.tags, auto: (e.tags||[]).includes('auto'), status: (e.tags||[]).includes('status') }));
const sh = rows.filter(r => r.shaped), top = rows.filter(r => !r.shaped);
const cnt = (a, f) => a.filter(f).length;
console.log('pin', pin.id, pin.created);
console.log('shaped', sh.length, 'topical', top.length);
for (const d of [0, 1, 3, 7, 14, 30]) console.log(`shaped created >= ${d}d before pin:`, cnt(sh, r => r.gapDays >= d), ' topical:', cnt(top, r => r.gapDays >= d));
console.log('shaped with auto tag', cnt(sh, r => r.auto), ' topical tagged status', cnt(top, r => r.status));
console.log('shaped within 7d of pin:'); sh.filter(r => r.gapDays < 7).forEach(r => console.log(' ', r.id, r.gapDays.toFixed(1), r.tags.join(',')));
const tagSets = {}; top.forEach(r => { const k = r.tags.filter(t => ['handoff','next','status'].includes(t)).sort().join('+'); tagSets[k] = (tagSets[k]||0)+1; }); console.log('topical tag sets', tagSets);
const liveAll = all.filter(e => isInjectable(e));
const refd = (r) => liveAll.filter(o => o.id !== r.id && o.created > (all.find(x=>x.id===r.id).created) && o.text.includes(r.id)).map(o=>o.id);
const shRef = sh.map(r => ({...r, by: refd(r)}));
console.log('shaped referenced by id in a newer live entry:', shRef.filter(r=>r.by.length).length);
shRef.filter(r=>r.by.length).forEach(r=>console.log(' ', r.id, r.gapDays.toFixed(1)+'d', 'by', r.by.join(',')));
const rule = shRef.filter(r => r.gapDays >= 7 && !r.by.length);
console.log('RULE (shaped, >=7d older than pin, not referenced by a newer live entry):', rule.length);
console.log('--- context of each reference ---');
const ctx = {};
for (const r of shRef) for (const b of r.by) { const t = all.filter(x=>x.id===b).at(-1).text; const i = t.indexOf(r.id); const s = t.slice(Math.max(0,i-45), i+12+30).replace(/\s+/g,' '); console.log(`${r.id}<-${b}: …${s}…`); }
// Candidate auto rule (RFC-046 §2): shaped, >= 14d older than the pin, >= 3 newer shaped handoffs.
const auto = sh.filter(r => r.gapDays >= 14 && r.newerShaped >= 3);
console.log('AUTO RULE (shaped, >=14d before pin, >=3 newer shaped handoffs):', auto.length, ' left for review: shaped', sh.length - auto.length, '+ topical', top.length);
