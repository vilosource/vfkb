import { readFileSync } from 'node:fs';
const D='/Users/jasonviloria/GitHub/vfkb/dist/';
const eng = await import(D+'engine.js');
const mods = {};
for (const f of ['engine.js','read.js','storage.js','stop-reminder.js']) { try { Object.assign(mods, await import(D+f)); } catch(e){} }
const lines = readFileSync(process.env.VFKB_DATA_DIR+'/entries.jsonl','utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const sup = mods.supersededIds(lines);
const today = new Date().toISOString().slice(0,10);
let raw;
for (const e of lines){ if(!((e.tags||[]).includes('handoff')||(e.tags||[]).includes('next'))) continue; let ok; try{ok=mods.isInjectable(e,today,sup)}catch{continue} if(!ok)continue; if(!raw){raw=e;continue} if((e.updated.localeCompare(raw.updated)||e.created.localeCompare(raw.created))>=0) raw=e;}
const pin = eng.latestHandoff();
console.log('B3 raw-scan pin:', raw.id, raw.updated);
console.log('engine pin     :', pin.id, pin.updated);
