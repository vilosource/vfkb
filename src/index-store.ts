// Pluggable read index (ADR-0013). v1 default = pure-JS in-memory, rebuilt from
// JSONL (source of truth). A better-sqlite3 FTS5 backend is an OPTIONAL future
// implementation behind this same interface — the engine never hard-depends on it.
//
// Freshness (ADR-0014): the index compares a content-derived token before serving
// and rebuilds on mismatch (rebuild-on-doubt — cheap because in-memory + small).

import type { KnowledgeEntry } from './types.js';
import { contentHash, materialize, readMeta, readRecords } from './storage.js';

export interface ScoredEntry {
  entry: KnowledgeEntry;
  score: number;
}

export interface KbIndex {
  all(): KnowledgeEntry[];
  get(id: string): KnowledgeEntry | undefined;
  search(query: string, k?: number): KnowledgeEntry[];
  searchScored(query: string, k?: number): ScoredEntry[];
  rebuild(): void;
  freshnessToken(): string;
}

// Light suffix stripping (NOT a full Porter stemmer) so a natural-language query
// term lexically matches the stored wording: hanging/hangs -> hang,
// silently/silent -> silent. Found load-bearing by the devops-kb live turn — the
// agent phrased "hanging silent" while the entry said "hangs silently", so the
// relevant gotcha scored ~0 and was never surfaced. Conservative: min stem length
// 3, longest suffix first; mismatches it can't resolve (running/runs) are accepted
// for v1 — the real robustness fix is the deferred semantic reranker (ADR-0012).
function stem(t: string): string {
  for (const suf of ['ing', 'ed', 'ly', 'es', 's']) {
    if (t.length - suf.length >= 3 && t.endsWith(suf)) return t.slice(0, -suf.length);
  }
  return t;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
    .map(stem);
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

  // Stage-1 relevance: stemmed term-overlap count over text + tags — NOT BM25
  // (no IDF, no length normalization; the score is # of entry tokens matching a
  // query term). Adequate as a candidate signal at per-project scale; semantic
  // ranking is the deferred EmbeddingReranker (ADR-0012/0016). The envelope-aware
  // Heuristic reranker is a separate Stage-2 applied to these candidates.
  searchScored(query: string, k = 30): ScoredEntry[] {
    this.ensureFresh();
    const terms = new Set(tokenize(query));
    if (terms.size === 0) return [];
    return this.entries
      .map((entry) => {
        const hay = tokenize(entry.text + ' ' + entry.tags.join(' '));
        let score = 0;
        for (const t of hay) if (terms.has(t)) score++;
        return { entry, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.updated.localeCompare(a.entry.updated))
      .slice(0, k);
  }

  search(query: string, k = 30): KnowledgeEntry[] {
    return this.searchScored(query, k).map((x) => x.entry);
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
