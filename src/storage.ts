// vfkb storage POLICY (v2: ADR-0044 layered over the backend seam). This module is
// backend-agnostic: LWW materialization, ADR-0042 read-boundary normalization, and
// ADR-0014 content-hash freshness — all computed over whatever transport
// `storageBackend()` provides (exactly one ships in v2: JSONL-on-disk, ADR-0019).
// The exported API is unchanged from the pre-seam kernel — the DoD's refactor-safety
// contract (the full suite passes untouched) hangs on that.

import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { storageBackend } from './backend.js';
import { journalAppend } from './journal.js';
import { normalizeEntry } from './validate.js';
import type { KnowledgeEntry } from './types.js';

export interface Tombstone {
  id: string;
  deleted: true;
  updated: string;
}
export type StoredRecord = KnowledgeEntry | Tombstone;

export function isTombstone(r: StoredRecord): r is Tombstone {
  return (r as Tombstone).deleted === true;
}

// The resolved data location. For the JSONL backend this is the brain DIRECTORY the
// committed file lives in — the path git-layer consumers (git.ts, gating.ts,
// stop-reminder.ts, counters, the lock) anchor to. Kept here (not behind the seam):
// those consumers exist because of ADR-0019's committed-file property, and a backend
// without that property simply doesn't wire them.
export function brainDir(): string {
  // VFKB_DATA_DIR is canonical; VFKB_DIR is a kept-working deprecated alias (ADR-0032).
  return process.env.VFKB_DATA_DIR || process.env.VFKB_DIR || join(homedir(), '.vfkb');
}

// Default project name when VFKB_PROJECT is unset. Generic wiring (the Claude Code
// plugin, ADR-0045) can point VFKB_DATA_DIR at a brain but cannot know the project's
// name, so derive it from where the brain lives: an explicit brain dir names its
// project (its parent when the dir itself is dot-named, e.g. <repo>/.vfkb → repo);
// otherwise the hook-injected $CLAUDE_PROJECT_DIR, then the cwd. The old hard-coded
// 'spike' remains only as the last-resort literal (empty basename at fs root, or a
// name that is nothing but stripped characters).
export function defaultProject(): string {
  const raw = (() => {
    if (process.env.VFKB_PROJECT) return process.env.VFKB_PROJECT;
    const explicit = process.env.VFKB_DATA_DIR || process.env.VFKB_DIR;
    if (explicit) {
      const abs = resolve(explicit);
      const name = basename(abs);
      return name.startsWith('.') ? basename(dirname(abs)) : name;
    }
    const root = process.env.CLAUDE_PROJECT_DIR;
    if (root) return basename(resolve(root));
    return basename(process.cwd());
  })();
  // The name lands verbatim inside the injected pseudo-XML headers
  // (<vfkb-resume project="...">) — strip characters that would deform them.
  return raw.replace(/["<>&]/g, '') || 'spike';
}

// --- append-only writes. Every write regenerates the freshness meta as a
//     GUARANTEED side-effect (mykb L11; ADR-0014) — policy, so it lives here,
//     above the backend's raw append. ---
export function appendRecord(rec: StoredRecord): void {
  // ADR-0064: journal-first untracked mirror — the durability floor for the
  // window between this append and the next brain commit.
  journalAppend(storageBackend().location(), rec);
  storageBackend().append(rec);
  writeMeta();
}

// ADR-0040: the exclusive section for read-decide-append engine ops, provided by
// the backend (a lockfile for JSONL; a transaction for a future hosted backend).
export function withExclusive<T>(fn: () => T): T {
  return storageBackend().withExclusive(fn);
}

// --- Project context doc spine (D-ii / ADR-0025) — authored content, stored by the
//     backend, never a JSONL entry (stays freely editable; the never-rewrite Brake
//     governs entries only). ---
export function contextSpinePath(): string {
  return storageBackend().spinePath();
}
export function readContextSpine(): string | null {
  return storageBackend().readSpine();
}
export function writeContextSpine(content: string): void {
  storageBackend().writeSpine(content);
}

// Malformed state of the LAST read pass (ADR-0042 §2): records excluded from the
// live set, surfaced instead of silently dropped or — worse — crashing every read.
// Reset on each readRecords() pass; inspect via lastMalformed().
export interface MalformedRecord {
  line?: number; // 1-based line in entries.jsonl, when the failure was at parse time
  issue: string;
  raw: string;
}
let malformed: MalformedRecord[] = [];
export function lastMalformed(): MalformedRecord[] {
  return [...malformed];
}

export function readRecords(): StoredRecord[] {
  const { records, malformed: bad } = storageBackend().readAllRaw();
  malformed = [...bad];
  return records as StoredRecord[];
}

// Collapse the append log to the live entry set.
// Per id, keep the record with the greatest `updated` (ties → later in file);
// if that newest record is a tombstone, the id is gone. Order-independent in
// `updated` → merge=union safe.
export function materialize(records: StoredRecord[] = readRecords()): KnowledgeEntry[] {
  const newest = new Map<string, StoredRecord>();
  for (const r of records) {
    if (!r || typeof r !== 'object' || typeof (r as { id?: unknown }).id !== 'string' || !(r as { id: string }).id) {
      // Unsalvageable: no usable id → excluded from the live set, visibly counted
      // (ADR-0042 §2 — a distinct surfaced state, never a crash, never silent).
      malformed.push({ issue: 'no usable id', raw: JSON.stringify(r).slice(0, 200) });
      continue;
    }
    const cur = newest.get(r.id);
    if (!cur || r.updated >= cur.updated) newest.set(r.id, r);
  }
  const out: KnowledgeEntry[] = [];
  for (const r of newest.values()) {
    if (isTombstone(r)) continue;
    // Whole-envelope normalization at the read boundary (ADR-0042 §2): every consumer
    // sees a well-formed entry regardless of origin (vfkb write path, external
    // projection, hand edit). Safe defaults for missing/invalid fields; unknown
    // future fields pass through untouched (forward compatibility).
    const n = normalizeEntry(r);
    if (n.ok) out.push(n.entry);
    else malformed.push({ issue: n.issue, raw: JSON.stringify(r).slice(0, 200) });
  }
  return out;
}

// --- content-derived freshness token (ADR-0014: NEVER mtime). Stable across
//     file order and git operations; changes iff the live set changes. ---
export function contentHash(entries: KnowledgeEntry[] = materialize()): string {
  const basis = entries
    .map((e) => `${e.id}@${e.updated}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

export interface IndexMeta {
  content_hash: string;
  entry_count: number;
  last_write: string;
}

export function readMeta(): IndexMeta | null {
  const raw = storageBackend().readMetaRaw();
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as IndexMeta;
  } catch {
    return null;
  }
}

export function writeMeta(): IndexMeta {
  const entries = materialize();
  const meta: IndexMeta = {
    content_hash: contentHash(entries),
    entry_count: entries.length,
    last_write: new Date().toISOString(),
  };
  storageBackend().writeMetaRaw(JSON.stringify(meta));
  return meta;
}
