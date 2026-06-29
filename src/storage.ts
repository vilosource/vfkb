// vfkb storage kernel (Phase 1). Append-only JSONL = source of truth (ADR-0013).
// Pure Node stdlib, ZERO runtime deps. Records are entries OR tombstones; the
// live set is *materialized* by last-write-wins on `updated` (merge=union-safe:
// concatenating two branches' JSONL and re-materializing is order-independent).

import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
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

export function brainDir(): string {
  return process.env.VFKB_DIR || join(homedir(), '.vfkb');
}
function recordsFile(): string {
  return join(brainDir(), 'entries.jsonl');
}
function metaFile(): string {
  return join(brainDir(), 'index-meta.json');
}

// --- append-only writes. Every write regenerates the freshness meta as a
//     GUARANTEED side-effect (mykb L11; ADR-0014). ---
export function appendRecord(rec: StoredRecord): void {
  mkdirSync(brainDir(), { recursive: true });
  appendFileSync(recordsFile(), JSON.stringify(rec) + '\n', 'utf8');
  writeMeta();
}

// --- Project context doc spine (D-ii / ADR-0025). The AUTHORED, architect-maintained
//     half of the context document — a plain Markdown file in the brain, NOT a JSONL
//     entry (so it stays freely editable; the never-rewrite Brake governs entries only).
//     The derived sections are stitched at render time in engine.renderContext. ---
export function contextSpinePath(): string {
  return join(brainDir(), 'context.md');
}
export function readContextSpine(): string | null {
  const p = contextSpinePath();
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : null;
}
export function writeContextSpine(content: string): void {
  mkdirSync(brainDir(), { recursive: true });
  writeFileSync(contextSpinePath(), content);
}

export function readRecords(): StoredRecord[] {
  const f = recordsFile();
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as StoredRecord);
}

// Collapse the append log to the live entry set.
// Per id, keep the record with the greatest `updated` (ties → later in file);
// if that newest record is a tombstone, the id is gone. Order-independent in
// `updated` → merge=union safe.
export function materialize(records: StoredRecord[] = readRecords()): KnowledgeEntry[] {
  const newest = new Map<string, StoredRecord>();
  for (const r of records) {
    const cur = newest.get(r.id);
    if (!cur || r.updated >= cur.updated) newest.set(r.id, r);
  }
  const out: KnowledgeEntry[] = [];
  for (const r of newest.values())
    // Normalize at the read boundary so every consumer sees a well-formed entry:
    // legacy or externally-projected entries (e.g. vfwb's lossy projection into .vfkb)
    // may omit `tags`; default it to [] once here rather than guarding every call site.
    if (!isTombstone(r)) out.push(r.tags ? r : { ...r, tags: [] });
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
  const f = metaFile();
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as IndexMeta;
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
  mkdirSync(brainDir(), { recursive: true });
  writeFileSync(metaFile(), JSON.stringify(meta), 'utf8');
  return meta;
}
