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
  // Distinct query terms this entry matches (RFC-001). `score` counts entry-token
  // hits *including repeats* — so an entry repeating one common term scores high
  // while matching only one distinct query term; `matched` is the floor's numerator
  // (matched / queryTermCount), `score` stays the relevance sort key.
  matched: number;
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

// Query-term pruning (ADR-0080, accepts RFC-044). A generic English stopword list
// (NLTK-style), deliberately NOT tuned to any prompt set. Without it, a chatty prompt's
// function words ("we", "is", "our") match nearly every entry and drown the content
// terms; measured on the R1 eval, pruning was the larger single factor. Applied to the
// QUERY only. Entries keep every token, so document lengths and IDF are unchanged.
const STOPWORDS = new Set(
  ('a about above after again against all am an and any are as at be because been before being below ' +
    'between both but by can could did do does doing down during each few for from further had has ' +
    'have having he her here hers herself him himself his how i if in into is it its itself just me ' +
    'more most my myself no nor not now of off on once only or other our ours ourselves out over own ' +
    'same she should so some such than that the their theirs them themselves then there these they this ' +
    'those through to too under until up very was we were what when where which while who whom why will ' +
    'with would you your yours yourself yourselves')
    .split(' ')
    .map(stem),
);

/** Distinct stemmed CONTENT terms of a query: tokenized, stopwords removed. */
function queryTerms(query: string): Set<string> {
  return new Set(tokenize(query).filter((t) => !STOPWORDS.has(t)));
}

// BM25 parameters: the standard defaults, not tuned (ADR-0080).
const BM25_K1 = 1.2;
const BM25_B = 0.75;

// Distinct stemmed CONTENT terms in a query (stopwords pruned) — the denominator for RFC-001's relevance
// floor (matched / queryTermCount). Shares the tokenizer/stemmer with searchScored
// so the floor and the search agree on what a "term" is.
export function queryTermCount(query: string): number {
  // The same pruned term set searchScored matches against, so the floor's numerator and
  // denominator agree on what a term is. The floor's RULE (RFC-001's 1/3) is unchanged.
  return queryTerms(query).size;
}

export class InMemoryIndex implements KbIndex {
  private entries: KnowledgeEntry[] = [];
  private token = '';
  // BM25 statistics, derived from `entries` on every rebuild (never persisted).
  private docTokens: string[][] = [];
  private docFreq = new Map<string, number>();
  private avgLen = 0;

  constructor() {
    this.rebuild();
  }

  rebuild(): void {
    this.entries = materialize(readRecords());
    this.token = contentHash(this.entries);
    // tags may be absent on legacy or externally-projected entries (e.g. vfwb's lossy
    // projection into .vfkb) — never let a tagless entry crash search.
    this.docTokens = this.entries.map((entry) => tokenize(entry.text + ' ' + (entry.tags ?? []).join(' ')));
    this.docFreq = new Map();
    for (const toks of this.docTokens) for (const t of new Set(toks)) this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
    const n = this.docTokens.length;
    this.avgLen = n ? this.docTokens.reduce((a, d) => a + d.length, 0) / n : 0;
  }

  // Lucene-style BM25 IDF: always positive, so a very common term still counts a little.
  private idf(term: string): number {
    const n = this.docTokens.length;
    const df = this.docFreq.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
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

  // Stage-1 relevance: BM25 over stemmed text + tags, with the QUERY pruned of
  // stopwords (ADR-0080, accepts RFC-044). It replaced plain occurrence counting (no IDF,
  // no length normalisation), under which long entries won every chatty prompt: on the R1
  // eval, recall@5 was 0.014. Deterministic and stdlib; semantic ranking stays the
  // deferred, gated EmbeddingReranker (ADR-0012/0016), forbidden on the injection path.
  // The envelope-aware Heuristic reranker is a separate Stage-2 applied to these
  // candidates. Ties keep the existing order: newest `updated` first.
  searchScored(query: string, k = 30): ScoredEntry[] {
    this.ensureFresh();
    const terms = queryTerms(query);
    if (terms.size === 0) return [];
    const idf = new Map([...terms].map((t) => [t, this.idf(t)]));
    return this.entries
      .map((entry, i) => {
        const toks = this.docTokens[i];
        const tf = new Map<string, number>();
        for (const t of toks) if (terms.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
        let score = 0;
        const norm = BM25_K1 * (1 - BM25_B + (BM25_B * toks.length) / (this.avgLen || 1));
        for (const [t, f] of tf) score += ((idf.get(t) ?? 0) * f * (BM25_K1 + 1)) / (f + norm);
        return { entry, score, matched: tf.size };
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
