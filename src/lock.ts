// ADR-0040 (v2): a vfkb-native advisory lock for the read-decide-append critical
// section. Held INTERNALLY by the engine around operations that read state before
// writing (supersede, transition, fluid edits, provenance re-stamps) — never something
// callers must remember to acquire. Scoped to one VFKB_DATA_DIR.
//
// Mechanism (ADR-0013: no native dep, so no real flock): a plain lockfile taken with
// O_EXCL exclusive-create at <brain>/.lock, carrying {pid, at, session_id} so
// contention is observable (ADR-0039's registry tells you who). Staleness: a holder
// whose pid is dead, or older than STALE_MS, is broken (a crashed process must not
// wedge every future engine op). Acquisition is a bounded retry loop; on timeout the
// engine proceeds WITHOUT the lock (fail-open: liveness over strictness — the same
// posture as the hooks; the pathological case is a >5s hold, which staleness already
// bounds at 10s).
//
// Re-entrancy: node is single-threaded, so a process-local depth counter suffices —
// should engine ops ever compose in-process, the inner op runs under the outer
// acquisition instead of deadlocking on its own lockfile.
//
// Release is OWNER-CHECKED (review gate F1): the holder file carries a unique token;
// release unlinks only if the file still holds OUR token. Without this, a holder whose
// critical section outlives STALE_MS would unlink the NEXT holder's fresh lock and
// admit an unbounded chain of overlapping writers.

import { openSync, closeSync, writeSync, readFileSync, unlinkSync, mkdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { brainDir } from './storage.js';

const STALE_MS = 10_000;
const ACQUIRE_TIMEOUT_MS = 5_000;
const RETRY_MS = 25;

let depth = 0; // process-local re-entrancy (single-threaded)

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = the process EXISTS but belongs to another user (shared brain dirs) —
    // that is an alive holder, not a dead one (review gate F2).
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface LockHolder {
  pid?: number;
  at?: string;
  session_id?: string;
}

// Test-only injectable pause (ADR-0040 DoD): called by the engine INSIDE the critical
// section, between the read and the append, so a test can deterministically force two
// processes' read-decide-append sequences to overlap in time. No-op unless the env
// knob is set; never set it outside a test.
export function testHoldForRace(): void {
  const ms = Number(process.env.VFKB_TEST_LOCK_HOLD_MS || 0);
  if (ms > 0) sleepSync(ms);
}

export function withBrainLock<T>(fn: () => T): T {
  // Escape hatch for the DoD's must-fail arm ONLY (proves the race is real).
  if (process.env.VFKB_LOCK_DISABLED === '1') return fn();
  if (depth > 0) {
    depth++;
    try {
      return fn();
    } finally {
      depth--;
    }
  }
  const lockPath = join(brainDir(), '.lock');
  const started = Date.now();
  let contended = false;
  // Unique per-acquisition token: release only unlinks a lock that is still OURS.
  const ourContent = JSON.stringify({
    pid: process.pid,
    at: new Date().toISOString(),
    session_id: process.env.KB_SESSION_ID,
    token: randomBytes(6).toString('hex'),
  });
  for (;;) {
    try {
      mkdirSync(brainDir(), { recursive: true });
      const fd = openSync(lockPath, 'wx'); // O_EXCL: atomic exclusive create
      writeSync(fd, ourContent);
      closeSync(fd);
      break; // acquired
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // Judge the holder. CAREFUL: a lockfile can legitimately be caught in the
      // microsecond window between its exclusive-create and its content write —
      // unparseable content is NOT evidence of staleness. Fall back to the file's
      // mtime: a fresh-but-empty lock is waited on; only a demonstrably OLD or
      // dead-holder lock is broken.
      let holder: LockHolder | undefined;
      let raw = '';
      try {
        raw = readFileSync(lockPath, 'utf8');
        holder = JSON.parse(raw) as LockHolder;
      } catch {
        holder = undefined;
      }
      let age: number;
      if (holder?.at) {
        age = Date.now() - Date.parse(holder.at);
      } else {
        try {
          age = Date.now() - statSync(lockPath).mtimeMs;
        } catch {
          continue; // lock vanished between EEXIST and stat → retry acquisition now
        }
      }
      const dead = typeof holder?.pid === 'number' && !pidAlive(holder.pid);
      if (dead || age > STALE_MS) {
        // Confirm before breaking: re-read; only unlink if the content is still the
        // same lock we judged stale (shrinks the window where a waiter could break a
        // JUST-acquired fresh lock; not perfectly atomic without flock — accepted,
        // documented ADR-0013 constraint).
        try {
          if (readFileSync(lockPath, 'utf8') !== raw) continue;
          unlinkSync(lockPath);
        } catch {
          /* raced with the holder's own release — loop retries either way */
        }
        process.stderr.write(
          `vfkb: broke a stale brain lock (pid ${holder?.pid ?? '?'}${
            holder?.session_id ? `, session ${holder.session_id}` : ''
          })\n`,
        );
        continue;
      }
      if (Date.now() - started > ACQUIRE_TIMEOUT_MS) {
        process.stderr.write(
          `vfkb: brain lock busy >${ACQUIRE_TIMEOUT_MS}ms (pid ${holder?.pid ?? '?'}${
            holder?.session_id ? `, session ${holder.session_id}` : ''
          }) — proceeding without the lock (fail-open)\n`,
        );
        return fn();
      }
      contended = true;
      sleepSync(RETRY_MS);
    }
  }
  if (contended) {
    process.stderr.write('vfkb: brain lock acquired after contention\n');
  }
  depth = 1;
  try {
    return fn();
  } finally {
    depth = 0;
    try {
      // Owner-checked release (F1): if a waiter judged us stale and took over, the
      // file now carries THEIR token — leave it alone rather than freeing their lock.
      if (readFileSync(lockPath, 'utf8') === ourContent) unlinkSync(lockPath);
    } catch {
      /* already broken as stale by a waiter — nothing to release */
    }
  }
}
