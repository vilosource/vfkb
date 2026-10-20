process.env.VFKB_DATA_DIR = (process.env.VFKB_REPO || process.cwd()) + '/.vfkb';
const { queryExplained } = await import((process.env.VFKB_REPO || process.cwd()) + '/dist/read.js');
const r = queryExplained({ text: 'what is in our roadmap?', limit: 5 });
console.log(Object.keys(r), Array.isArray(r.entries), r.status, r.reason);
const prompts = [
  'what is in our roadmap?',
  'we were going to use JEV as well were we not?',
  'ok we keep it optional as it is now, lets get to work',
  'has the review settled?',
  'why is it on the merged branch? do what is best',
  'proceed but lets fix the smaller things first',
  'we need to restart, so handoff at first opportunity and pause',
  'continue autonomously',
];
for (const p of prompts) {
  for (const ratio of [undefined, 0]) {
    const x = queryExplained({ text: p, limit: 3, ...(ratio === 0 ? { minTermRatio: 0 } : {}) });
    const list = x.entries || x.results || [];
    console.log(`${ratio === 0 ? '  no-floor' : '> ' + p.padEnd(62) + '\n  floor   '} n=${list.length} ${x.status ?? ''} | ${list.map((e) => e.text.slice(0, 55).replace(/\s+/g, ' ')).join(' || ')}`);
  }
}
