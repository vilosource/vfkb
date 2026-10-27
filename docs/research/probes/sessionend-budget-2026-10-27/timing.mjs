#!/usr/bin/env node
// vfkb#384 probe, arm G: wall time of `hook session-end` run standalone (no Claude Code),
// N fresh sandboxes per cell, so curation's first (backlog) run is what is measured.
// Cells: engine (v021 / main / fix) × brain (the seeded real brain, and a ~3,000-line
// synthetic one: the real brain plus unique filler facts). Same env vars as probe.mjs.
//   PROBE_TIMING_N=10 node timing.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const N = Math.max(1, parseInt(process.env.PROBE_TIMING_N || '10', 10));
const BUNDLES = { v021: process.env.PROBE_BUNDLE_V021, main: process.env.PROBE_BUNDLE_MAIN, fix: process.env.PROBE_BUNDLE_FIX };
const BRAIN = process.env.PROBE_BRAIN;
const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o });
const env = (extra) => {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith('CLAUDE') || k.startsWith('VFKB_') || k === 'KB_SESSION_ID') delete e[k];
  return { ...e, ...extra };
};

const big = join(mkdtempSync(join(tmpdir(), 'vfkb-se-timing-brain-')), 'entries.jsonl');
cpSync(BRAIN, big);
for (let i = 0; i < 2400; i++) {
  appendFileSync(big, JSON.stringify({ id: `synthetic${String(i).padStart(5, '0')}`, type: 'fact', text: `synthetic filler ${i} ` + 'y'.repeat(400), tags: ['filler'], zone: 'established', author: { role: 'human' }, provenance: { status: 'verified' }, created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z' }) + '\n');
}
const BRAINS = { real: BRAIN, synthetic3k: big };

function once(bundle, brain) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-se-timing-'));
  const g = (...x) => sh('git', x, { cwd: dir });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'p@example.invalid'); g('config', 'user.name', 'p'); g('config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, '.vfkb'));
  cpSync(brain, join(dir, '.vfkb', 'entries.jsonl'));
  writeFileSync(join(dir, '.gitignore'), '.vfkb/.sessions/\n.vfkb/.journal/\n.vfkb/.lock\n.vfkb/index-meta.json\n');
  g('add', '-A'); g('commit', '-qm', 'seed'); g('checkout', '-q', '-b', 'work');
  sh('node', [bundle, 'add', 'fact', 'timing: one new entry', '--role', 'human'], { cwd: dir, env: env({ VFKB_DATA_DIR: join(dir, '.vfkb') }) });
  const t0 = process.hrtime.bigint();
  const r = spawnSync('node', [bundle, 'hook', 'session-end'], {
    cwd: dir, input: JSON.stringify({ session_id: 'timing-' + Math.random().toString(16).slice(2), cwd: dir, reason: 'other' }),
    env: env({ VFKB_DATA_DIR: join(dir, '.vfkb') }), encoding: 'utf8',
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const subject = sh('git', ['log', '-1', '--format=%s'], { cwd: dir }).trim();
  rmSync(dir, { recursive: true, force: true });
  return { ms, subject, status: r.status };
}

const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const out = { date: new Date().toISOString(), n: N, node: process.version, brains: Object.fromEntries(Object.entries(BRAINS).map(([k, p]) => [k, { lines: readFileSync(p, 'utf8').split('\n').filter(Boolean).length, bytes: readFileSync(p).length }])), cells: {} };
for (const [eng, bundle] of Object.entries(BUNDLES)) {
  for (const [bname, brain] of Object.entries(BRAINS)) {
    const runs = Array.from({ length: N }, () => once(bundle, brain));
    const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
    out.cells[`${eng}/${bname}`] = { p50: Math.round(q(ms, 0.5)), p95: Math.round(q(ms, 0.95)), max: Math.round(ms.at(-1)), min: Math.round(ms[0]), subject: runs[0].subject };
    console.log(eng, bname, JSON.stringify(out.cells[`${eng}/${bname}`]));
  }
}
writeFileSync(join(HERE, 'out', 'timing.json'), JSON.stringify(out, null, 2) + '\n');
