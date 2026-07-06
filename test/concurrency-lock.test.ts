import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// V2-2 concurrency lock (ADR-0040 ← RFC-015): the read-decide-append critical section
// of supersede/transition is engine-internally serialized across PROCESSES.
//
// ADR-0029 discipline: the storage layer is fully synchronous, so in-process callbacks
// CANNOT race — this test forces a real cross-process overlap: N child processes, a
// shared time barrier, and a test-only injectable pause (VFKB_TEST_LOCK_HOLD_MS) inside
// the critical section between the read and the append. The must-fail arm
// (VFKB_LOCK_DISABLED=1) proves the race actually manifests without the lock.

const DIST = resolve(__dirname, '../dist');

// Child: at the barrier instant, supersede the same target. Prints OK <id> or ERR <msg>.
const CHILD = `
import { supersede } from '${DIST.replace(/\\/g, '/')}/engine.js';
const [, , target, label, barrierAt] = process.argv;
const wait = Number(barrierAt) - Date.now();
if (wait > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
try {
  const e = supersede(target, 'winner ' + label, { role: 'human' });
  console.log('OK ' + e.id);
} catch (err) {
  console.log('ERR ' + err.message);
}
`;

function seedDecision(brain: string): string {
  // Seed synchronously through the engine in a child (keeps THIS process's env clean).
  const seed = `
import { addEntry } from '${DIST.replace(/\\/g, '/')}/engine.js';
console.log(addEntry('decision', 'the target decision', { role: 'human', status: 'accepted' }).id);
`;
  writeFileSync(join(brain, 'seed.mjs'), seed);
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  return execFileSync('node', [join(brain, 'seed.mjs')], {
    env: { ...process.env, VFKB_DATA_DIR: brain },
    encoding: 'utf8',
  }).trim();
}

async function race(
  brain: string,
  target: string,
  n: number,
  extraEnv: Record<string, string>,
): Promise<string[]> {
  writeFileSync(join(brain, 'child.mjs'), CHILD);
  const barrier = String(Date.now() + 600);
  const env = { ...process.env, VFKB_DATA_DIR: brain, VFKB_TEST_LOCK_HOLD_MS: '300', ...extraEnv };
  delete (env as Record<string, unknown>).KB_SESSION_ID;
  const runs = Array.from({ length: n }, (_, i) =>
    new Promise<string>((res, rej) => {
      const p = spawn('node', [join(brain, 'child.mjs'), target, `c${i}`, barrier], { env });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', () => {});
      p.on('close', () => res(out.trim()));
      p.on('error', rej);
    }),
  );
  return Promise.all(runs);
}

function lines(brain: string): Record<string, unknown>[] {
  return readFileSync(join(brain, 'entries.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('ADR-0040 — cross-process read-decide-append serialization', () => {
  it('with the lock: exactly ONE of 3 concurrent supersedes of the same target wins', async () => {
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-lock-'));
    const target = seedDecision(brain);
    const results = await race(brain, target, 3, {});
    const oks = results.filter((r) => r.startsWith('OK'));
    const errs = results.filter((r) => r.startsWith('ERR'));
    expect(oks).toHaveLength(1);
    expect(errs).toHaveLength(2);
    for (const e of errs) expect(e).toMatch(/already superseded/);
    // storage integrity: every line still valid JSON, exactly one supersession edge
    const all = lines(brain);
    const edges = all.filter((e) => (e as { refs?: { supersedes?: string } }).refs?.supersedes === target);
    expect(edges).toHaveLength(1);
    // the lock file does not leak past the operations
    expect(existsSync(join(brain, '.lock'))).toBe(false);
  }, 30_000);

  it('MUST-FAIL arm: with the lock disabled the race manifests (>=2 winners) — the test can fail', async () => {
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-lock-off-'));
    const target = seedDecision(brain);
    const results = await race(brain, target, 3, { VFKB_LOCK_DISABLED: '1' });
    const oks = results.filter((r) => r.startsWith('OK'));
    // all three read during overlapping holds → none sees another's edge → all "win"
    expect(oks.length).toBeGreaterThanOrEqual(2);
    const all = lines(brain);
    const edges = all.filter((e) => (e as { refs?: { supersedes?: string } }).refs?.supersedes === target);
    expect(edges.length).toBeGreaterThanOrEqual(2); // the forked lineage the lock prevents
  }, 30_000);

  it('a stale lock (dead holder) is broken, not waited on forever', async () => {
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-lock-stale-'));
    const target = seedDecision(brain);
    // plant a lock owned by a dead pid, timestamped old
    writeFileSync(
      join(brain, '.lock'),
      JSON.stringify({ pid: 999999999, at: new Date(Date.now() - 60_000).toISOString() }),
    );
    const results = await race(brain, target, 1, { VFKB_TEST_LOCK_HOLD_MS: '0' });
    expect(results[0]).toMatch(/^OK/);
  }, 30_000);

  it('already-superseded rejection also holds single-process (the decide the lock protects)', async () => {
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-lock-seq-'));
    const target = seedDecision(brain);
    const r1 = await race(brain, target, 1, { VFKB_TEST_LOCK_HOLD_MS: '0' });
    expect(r1[0]).toMatch(/^OK/);
    const r2 = await race(brain, target, 1, { VFKB_TEST_LOCK_HOLD_MS: '0' });
    expect(r2[0]).toMatch(/ERR .*already superseded/);
  }, 30_000);
});
