// Pluggable read index (ADR-0013). v1 default = pure-JS in-memory, rebuilt from
// JSONL (source of truth). A better-sqlite3 FTS5 backend is an OPTIONAL future
// implementation behind this same interface — the engine never hard-depends on it.
//
// Freshness (ADR-0014): the index compares a content-derived token before serving
// and rebuilds on mismatch (rebuild-on-doubt — cheap because in-memory + small).

import type { KnowledgeEntry } from './types.js';
import { contentHash, materialize, readMeta, readRecords } from './storage.js';

export interface KbIndex {
  all(): KnowledgeEntry[];
  get(id: string): KnowledgeEntry | undefined;
  search(query: string, k?: number): KnowledgeEntry[];
  rebuild(): void;
  freshnessToken(): string;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

export class InMemoryIndex implements KbIndex {
  private entries: KnowledgeEntry[] = [];
  private token = '';

  constructor() {
    this.rebuild();
  }

  rebuild(): void {
    this.entries = materialize(readRecords());
    this.token = contentHash(this.entries);
  }

  // Rebuild iff the persisted content token differs from what we hold.
  // The meta hash is authoritative when present; else recompute from JSONL
  // (covers a git pull that changed entries.jsonl but not the sidecar).
  private ensureFresh(): void {
    const persisted = readMeta()?.content_hash ?? contentHash();
    if (persisted !== this.token) this.rebuild();
  }

  all(): KnowledgeEntry[] {
    this.ensureFresh();
    return this.entries;
  }

  get(id: string): KnowledgeEntry | undefined {
    this.ensureFresh();
    return this.entries.find((e) => e.id === id);
  }

  // BM25-lite: term-overlap over text + tags. (ADR-0012's reranker is a
  // separate, envelope-aware stage applied to these candidates.)
  search(query: string, k = 30): KnowledgeEntry[] {
    this.ensureFresh();
    const terms = new Set(tokenize(query));
    if (terms.size === 0) return [];
    const scored = this.entries
      .map((e) => {
        const hay = tokenize(e.text + ' ' + e.tags.join(' '));
        let score = 0;
        for (const t of hay) if (terms.has(t)) score++;
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.e.updated.localeCompare(a.e.updated));
    return scored.slice(0, k).map((x) => x.e);
  }

  freshnessToken(): string {
    return this.token;
  }
}

// ADR-0013: select the index backend. v1 always returns the pure-JS in-memory
// index (zero native deps). A future SQLite/FTS5 backend would be auto-detected
// here and fall back to in-memory if the native module is absent.
export function selectIndex(): KbIndex {
  return new InMemoryIndex();
}
