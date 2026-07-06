// ADR-0044 (v2): the storage-backend interface — the seam the engine's persistence
// flows through instead of assuming a local file directly. Exactly ONE implementation
// ships in v2: JSONL-on-disk, matching ADR-0019 byte-for-byte (zero behavior change —
// the DoD is the full pre-existing suite passing unchanged). A second (hosted) backend
// is explicitly NOT decided here; `setStorageBackend` is the future opt-in door.
//
// Layering: engine.ts → storage.ts (backend-AGNOSTIC policy: LWW materialization,
// ADR-0042 normalization, ADR-0014 meta derivation) → this interface (transport:
// where records/spine/meta/session records physically live, and what "exclusive"
// means there — a lockfile here, a transaction in a hypothetical hosted backend).
// Git-layer consumers (git.ts, gating.ts, stop-reminder.ts, session-end.ts) stay
// file-based BY DESIGN: they exist because the brain is a committed file (ADR-0019);
// a backend without that property simply doesn't wire them.
//
// The method surface was shaped by the shipped v2 code, per RFC-019's sequencing
// intent: records (the kernel), spine/meta (ADR-0025/0014), session records
// (ADR-0039's registry), withExclusive (ADR-0040's critical section).

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { withBrainLock } from './lock.js';

// A record the transport could not even hand back (e.g. an unparseable JSONL line).
// Shape-level validation failures are storage-policy (ADR-0042), not transport.
export interface RawMalformed {
  line?: number; // 1-based, when the transport is line-oriented
  issue: string;
  raw: string;
}

export interface StorageBackend {
  readonly name: string;
  /** Human-readable locator for logs/doctor (the brain dir for JSONL). */
  location(): string;
  /** Append one record. Durable on return. No derived side-effects (policy's job). */
  append(rec: unknown): void;
  /** Every stored record, transport-order, plus what could not be decoded at all. */
  readAllRaw(): { records: unknown[]; malformed: RawMalformed[] };
  readMetaRaw(): string | null;
  writeMetaRaw(json: string): void;
  readSpine(): string | null;
  writeSpine(content: string): void;
  spinePath(): string;
  listSessionIds(): string[];
  readSessionRecord(id: string): string | null;
  writeSessionRecord(id: string, json: string): void;
  /** Serialize a read-decide-append critical section against concurrent writers
   *  of the SAME store (ADR-0040). JSONL: the owner-checked lockfile. */
  withExclusive<T>(fn: () => T): T;
}

// --- the one shipped implementation: JSONL on disk (ADR-0019) ---

function dataDir(): string {
  // VFKB_DATA_DIR is canonical; VFKB_DIR is a kept-working deprecated alias (ADR-0032).
  return process.env.VFKB_DATA_DIR || process.env.VFKB_DIR || join(homedir(), '.vfkb');
}
const safeKey = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_');

class JsonlFsBackend implements StorageBackend {
  readonly name = 'jsonl-fs';
  location(): string {
    return dataDir();
  }
  private file(): string {
    return join(dataDir(), 'entries.jsonl');
  }
  append(rec: unknown): void {
    mkdirSync(dataDir(), { recursive: true });
    appendFileSync(this.file(), JSON.stringify(rec) + '\n', 'utf8');
  }
  readAllRaw(): { records: unknown[]; malformed: RawMalformed[] } {
    const f = this.file();
    if (!existsSync(f)) return { records: [], malformed: [] };
    const records: unknown[] = [];
    const malformed: RawMalformed[] = [];
    const lines = readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim().length === 0) continue;
      try {
        records.push(JSON.parse(l));
      } catch (err) {
        // ADR-0042: one corrupt line must not crash every read of the whole brain.
        malformed.push({ line: i + 1, issue: `unparseable JSON: ${(err as Error).message}`, raw: l.slice(0, 200) });
      }
    }
    return { records, malformed };
  }
  readMetaRaw(): string | null {
    const f = join(dataDir(), 'index-meta.json');
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  }
  writeMetaRaw(json: string): void {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(join(dataDir(), 'index-meta.json'), json, 'utf8');
  }
  readSpine(): string | null {
    const p = this.spinePath();
    return existsSync(p) ? readFileSync(p, 'utf8').trim() : null;
  }
  writeSpine(content: string): void {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(this.spinePath(), content);
  }
  spinePath(): string {
    return join(dataDir(), 'context.md');
  }
  listSessionIds(): string[] {
    const dir = join(dataDir(), '.sessions');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length));
  }
  readSessionRecord(id: string): string | null {
    const f = join(dataDir(), '.sessions', `${safeKey(id)}.json`);
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  }
  writeSessionRecord(id: string, json: string): void {
    const dir = join(dataDir(), '.sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${safeKey(id)}.json`), json, 'utf8');
  }
  withExclusive<T>(fn: () => T): T {
    return withBrainLock(fn);
  }
}

const jsonl = new JsonlFsBackend();
let current: StorageBackend = jsonl;

export function storageBackend(): StorageBackend {
  return current;
}
// The future opt-in door (a hosted/alternate backend per project) and the test seam.
// Returns the previous backend so callers can restore it.
export function setStorageBackend(b: StorageBackend): StorageBackend {
  const prev = current;
  current = b;
  return prev;
}
