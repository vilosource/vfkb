#!/usr/bin/env node
// ============================================================================
// Builds scripts/fixtures/admission-render.json — the committed {sha256(body)
// -> GitHub-rendered html} cache the admission-gate selftest runs against.
//
// The gate's visibility layer IS GitHub's renderer (see admission-gate.mjs), so
// its selftest would otherwise need the network on every run. Instead the
// corpus of bodies is rendered once here, committed, and replayed offline. The
// selftest fails LOUDLY on a cache miss rather than falling back to the live
// API, because a silent fallback would make an offline run and a networked run
// mean different things.
//
// Regenerate after adding a case, and re-verify with the selftest's --live arm:
//   node scripts/build-admission-fixtures.mjs
//   node scripts/admission-gate.selftest.mjs --live
// ============================================================================
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { renderViaGitHub } from './admission-gate.mjs';

export const key = (body) => createHash('sha256').update(String(body ?? ''), 'utf8').digest('hex').slice(0, 32);

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'fixtures/admission-render.json');
const cache = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};

// The SELFTEST owns the corpus — one source of truth for the bodies. It is run
// in collect mode, where a cache miss appends the body instead of failing, so
// the corpus can never drift from what the checks actually exercise.
const missFile = resolve(here, '../.admission-misses.tmp');
for (let pass = 1; pass <= 5; pass++) {
  writeFileSync(missFile, '');
  execFileSync(process.execPath, [resolve(here, 'admission-gate.selftest.mjs')], {
    env: { ...process.env, ADM_MISS_FILE: missFile }, stdio: 'ignore',
  });
  const bodies = [...new Set(readFileSync(missFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))];
  if (!bodies.length) { console.error(`pass ${pass}: no misses — cache complete`); break; }
  console.error(`pass ${pass}: rendering ${bodies.length} new body(ies)`);
  for (const body of bodies) { cache[key(body)] = renderViaGitHub(body); process.stderr.write('.'); }
  console.error('');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(cache, null, 1)}\n`);
}
rmSync(missFile, { force: true });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(cache, null, 1)}\n`);
console.error(`fixtures: ${Object.keys(cache).length} rendered bodies -> ${out}`);
