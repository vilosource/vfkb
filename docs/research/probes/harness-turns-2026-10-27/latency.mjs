#!/usr/bin/env node
// Wall latency of `vfkb hook user-prompt-submit` on THIS repo's brain (free, no model).
// cold = a fresh session id per call (full gather); same-key = one id whose stored key
// already matches (steady state: rev-parse + pin lookup only). N=10 each. Each call's
// stdout is checked, so a hook that silently bailed early cannot pass as "fast".
//   node docs/research/probes/harness-turns-2026-10-27/latency.mjs   (after npm run build)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../../../..');
const CLI = resolve(process.env.VFKB_HT_CLI || join(REPO, 'dist/cli.js'));
const env = { ...process.env, VFKB_DATA_DIR: '.vfkb', KB_SESSION_ID: '' };
const seed = (id) => { mkdirSync(join(REPO, '.vfkb/.sessions'), { recursive: true }); writeFileSync(join(REPO, `.vfkb/.sessions/${id}.json`), '{"turnCount":1}'); };
const clean = (id) => { rmSync(join(REPO, `.vfkb/.sessions/${id}.json`), { force: true }); rmSync(join(REPO, `.vfkb/.signals/prompt-nudge/${id}.json`), { force: true }); };
const call = (id) => {
  const t = process.hrtime.bigint();
  const out = execFileSync(process.execPath, [CLI, 'hook', 'user-prompt-submit'], { cwd: REPO, env, encoding: 'utf8', input: JSON.stringify({ prompt: 'x', session_id: id }) });
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, emitted: out.includes('vfkb handoff status:') };
};
const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); return { p50: Math.round(s[Math.floor(s.length / 2)]), p95: Math.round(s[Math.ceil(s.length * 0.95) - 1]), max: Math.round(s.at(-1)) }; };
console.log(`brain: ${statSync(join(REPO, '.vfkb/entries.jsonl')).size} bytes; engine: ${CLI}`);
const cold = [];
for (let i = 0; i < 10; i++) { const id = `ht-cold-${i}-${process.pid}`; seed(id); const r = call(id); cold.push(r); clean(id); }
const sid = `ht-same-${process.pid}`; seed(sid); const first = call(sid);
const same = []; for (let i = 0; i < 10; i++) same.push(call(sid)); clean(sid);
console.log('cold     ', stats(cold.map((r) => r.ms)), `emitted ${cold.filter((r) => r.emitted).length}/10`);
console.log('same-key ', stats(same.map((r) => r.ms)), `emitted ${same.filter((r) => r.emitted).length}/10 (expected 0: key cached; first call emitted=${first.emitted})`);
