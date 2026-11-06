#!/usr/bin/env node
// vfkb#396 probe: standalone `hook session-end` wall time (no Claude Code) on brains of
// ~0.8k, ~3.2k and ~10.8k lines, with and without a handoff left by the session.
// Each run builds a throwaway git repo, seeds the brain, adds one entry on a topic branch,
// then times one SessionEnd. WARM=1 first runs one SessionEnd (curation's backlog) and
// adds a second entry, so the timed run measures the floor with little left to curate.
//   node timing.mjs <abs path to dist/bundles/vfkb.mjs> <abs path to a seed entries.jsonl> [N=5]
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
const [bundle, seed, nArg] = process.argv.slice(2); const N = +nArg || 5;
const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o });
const env = (x) => { const e = { ...process.env }; for (const k of Object.keys(e)) if (k.startsWith('CLAUDE') || k.startsWith('VFKB_') || k === 'KB_SESSION_ID') delete e[k]; return { ...e, ...x }; };
const mk = (extra) => { const p = join(mkdtempSync(join(tmpdir(), 'se-brain-')), 'entries.jsonl'); cpSync(seed, p);
  for (let i = 0; i < extra; i++) appendFileSync(p, JSON.stringify({ id: `syn${String(i).padStart(6,'0')}`, type: 'fact', text: `filler ${i} ` + 'y'.repeat(400), tags: ['filler'], zone: 'established', author: { role: 'human' }, provenance: { status: 'verified' }, created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z' }) + '\n'); return p; };
function once(brain, newHandoff) {
  const dir = mkdtempSync(join(tmpdir(), 'se-t-')); const g = (...x) => sh('git', x, { cwd: dir });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'p@x.invalid'); g('config', 'user.name', 'p'); g('config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, '.vfkb')); cpSync(brain, join(dir, '.vfkb', 'entries.jsonl'));
  writeFileSync(join(dir, '.gitignore'), '.vfkb/.sessions/\n.vfkb/.journal/\n.vfkb/.lock\n.vfkb/index-meta.json\n');
  g('add', '-A'); g('commit', '-qm', 'seed'); g('checkout', '-q', '-b', 'work');
  sh('node', [bundle, 'add', 'fact', 'timing: one new entry', '--role', 'human', ...(newHandoff ? ['--tag', 'handoff'] : [])], { cwd: dir, env: env({ VFKB_DATA_DIR: join(dir, '.vfkb') }) });
  const se = () => spawnSync('node', [bundle, 'hook', 'session-end'], { cwd: dir, input: JSON.stringify({ session_id: 't' + Math.random(), cwd: dir, reason: 'other' }), env: env({ VFKB_DATA_DIR: join(dir, '.vfkb') }), encoding: 'utf8' });
  if (process.env.WARM) { se(); sh('node', [bundle, 'add', 'fact', 'timing: second entry', '--role', 'human', ...(newHandoff ? ['--tag', 'handoff'] : [])], { cwd: dir, env: env({ VFKB_DATA_DIR: join(dir, '.vfkb') }) }); }
  const t0 = process.hrtime.bigint();
  spawnSync('node', [bundle, 'hook', 'session-end'], { cwd: dir, input: JSON.stringify({ session_id: 't' + Math.random(), cwd: dir, reason: 'other' }), env: env({ VFKB_DATA_DIR: join(dir, '.vfkb') }), encoding: 'utf8' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6; const subj = g('log', '-1', '--format=%s').trim(); rmSync(dir, { recursive: true, force: true }); return { ms, subj };
}
// SIZES=0,10000,30000 picks the filler line counts (default 0, 2400, 10000).
for (const extra of (process.env.SIZES || '0,2400,10000').split(',').map(Number)) {
  const b = mk(extra); const lines = readFileSync(b, 'utf8').split('\n').filter(Boolean).length;
  for (const h of [false, true]) {
    const r = Array.from({ length: N }, () => once(b, h)); const ms = r.map((x) => x.ms).sort((a, c) => a - c);
    console.log(`lines=${lines} handoffLeft=${h} p50=${Math.round(ms[N >> 1])} max=${Math.round(ms.at(-1))} :: ${r[0].subj}`);
  }
}
