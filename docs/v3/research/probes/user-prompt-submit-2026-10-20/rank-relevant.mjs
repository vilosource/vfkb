process.env.VFKB_DATA_DIR = (process.env.VFKB_REPO || process.cwd()) + '/.vfkb';
const idx = await import((process.env.VFKB_REPO || process.cwd()) + '/dist/index-store.js');
const I = new idx.InMemoryIndex(); // reads the brain at VFKB_DATA_DIR
for (const q of ['we were going to use JEV as well were we not?', 'what is in our roadmap?']) {
  const s = I.searchScored(q, 600);
  const jev = s.findIndex((x) => /\bjev\b/i.test(x.entry.text));
  const road = s.findIndex((x) => /roadmap/i.test(x.entry.text) && x.entry.type === 'link');
  console.log(q, '| candidates', s.length, '| first Jev entry rank', jev, '| first roadmap link rank', road,
    '| top3 scores', s.slice(0, 3).map((x) => x.score.toFixed?.(2) ?? x.score), '| top3 text lengths', s.slice(0, 3).map((x) => x.entry.text.length));
}
