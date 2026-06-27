// vtfkb read layer (Phase 3). Filtered/searched retrieval — the D5c filters
// (status/zone/type/tags/author.role) over the storage kernel, with the ADR-0012
// tiered reranker applied. Consumed by the CLI and (Phase 4) the MCP read tools.

import type {
  AuthorRole,
  DecisionStatus,
  EntryType,
  KnowledgeEntry,
  Zone,
} from './types.js';
import {
  effectiveStatus,
  heuristicCompare,
  isInjectable,
  readAll,
  rerank,
  supersededIds,
} from './engine.js';
import { queryTermCount, selectIndex } from './index-store.js';

// RFC-001: an explicit text query keeps only candidates that match at least this
// fraction of the query's distinct terms. Default = 1/3 with a `>=` test, so a
// 1–2 term query reduces to the existing score>0 (1/1, 1/2 ≥ 1/3) and a 3-term
// query still admits a single strong match (1/3 ≥ 1/3), while the "1 common term
// out of 8" noise that buried the devops-kb answer (1/8 < 1/3) is dropped.
// Conservative by design: it can only remove genuine non-matches, never reorder or
// drop a real top hit. Injection/listing carry no text → no floor (ADR-0016).
export const DEFAULT_MIN_TERM_RATIO = 1 / 3;

export interface QueryOpts {
  text?: string; // stemmed term-overlap candidate search (index); else the whole brain
  type?: EntryType | EntryType[];
  zone?: Zone | Zone[];
  status?: DecisionStatus | DecisionStatus[]; // matched against EFFECTIVE status
  tags?: string[]; // entry must carry ALL of these
  authorRole?: AuthorRole | AuthorRole[];
  verifiedOnly?: boolean; // FEATURES §3.6 trust filter → keep only provenance.status==='verified'
  includeStale?: boolean; // default false → apply the freshness gate (ADR-0005/0011)
  includeSuperseded?: boolean; // default false → drop entries behind a supersession edge
  minTermRatio?: number; // RFC-001 relevance floor; default DEFAULT_MIN_TERM_RATIO. 0 disables.
  limit?: number;
}

// RFC-002: why a search returned nothing. Each candidate the filter stage removes
// is tallied by reason, so an empty result can be classified deterministically from
// the pipeline counts (no heuristics) — never the agent's guess.
export type DropReason = 'type' | 'zone' | 'role' | 'tags' | 'status' | 'provenance' | 'superseded' | 'stale';

export type NoMatchReason =
  | 'empty_topic' // no lexical overlap at all (nothing recorded matches the wording)
  | 'no_match' // lexical matches existed but none cleared the relevance floor (near-miss)
  | 'all_filtered'; // candidates matched but the D5c filters / ADR-0005 gate removed them all

export interface SearchDiagnosis {
  reason: NoMatchReason;
  // candidates that survived text + the RFC-001 floor, i.e. reached the filter stage
  candidates: number;
  // all_filtered: how many candidates each filter reason removed
  filteredOut?: Partial<Record<DropReason, number>>;
  // no_match: the best candidate that fell BELOW the relevance floor — a labelled
  // low-confidence near-miss, kept OUT of `results` but reported so it isn't silently lost
  belowFloor?: { entry: KnowledgeEntry; matched: number; queryTerms: number };
}

export interface SearchResult {
  results: KnowledgeEntry[];
  // present ONLY when results is empty — the honest, cause-distinguished no-match
  diagnosis?: SearchDiagnosis;
}

function arr<T>(v?: T | T[]): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

// The single pipeline. `query` returns just the entries (unchanged contract);
// `queryExplained` returns the entries plus, when empty, why (RFC-002).
function run(opts: QueryOpts = {}): SearchResult {
  const all = readAll();
  const superseded = supersededIds(all);

  // Stage 1 (ADR-0012): term-overlap candidates when text is given, else all.
  // Capture the relevance score per id so Stage 2 can keep it as the primary
  // sort key for search (without a query there is no score → score 0 → the
  // heuristic order stands, which is what list/injection want).
  const hasText = !!(opts.text && opts.text.trim());
  const scored = hasText ? selectIndex().searchScored(opts.text as string, 200) : [];

  // RFC-001 relevance floor: drop candidates matching < minTermRatio of the query's
  // distinct terms, before Stage 2 / the limit. Applies only to explicit search;
  // listing/injection have no text and skip this entirely.
  const minRatio = opts.minTermRatio ?? DEFAULT_MIN_TERM_RATIO;
  const qTerms = hasText ? queryTermCount(opts.text as string) : 0;
  const floored =
    hasText && qTerms > 0 && minRatio > 0
      ? scored.filter((s) => s.matched / qTerms >= minRatio)
      : scored;

  const scoreOf = new Map(floored.map((s) => [s.entry.id, s.score]));
  const candidates: KnowledgeEntry[] = hasText ? floored.map((s) => s.entry) : all;

  const types = arr(opts.type);
  const zones = arr(opts.zone);
  const statuses = arr(opts.status);
  const roles = arr(opts.authorRole);

  // Tally the reason each candidate is dropped (first failing reason wins — same
  // keep/drop decision as before, now also classified for RFC-002).
  const filteredOut: Partial<Record<DropReason, number>> = {};
  const filtered = candidates.filter((e) => {
    let reason: DropReason | null = null;
    if (types && !types.includes(e.type)) reason = 'type';
    else if (zones && !zones.includes(e.zone)) reason = 'zone';
    else if (roles && !roles.includes(e.author.role)) reason = 'role';
    else if (opts.verifiedOnly && e.provenance.status !== 'verified') reason = 'provenance';
    else if (opts.tags && !opts.tags.every((t) => e.tags.includes(t))) reason = 'tags';
    else if (statuses) {
      const eff = effectiveStatus(e, superseded);
      if (!eff || !statuses.includes(eff)) reason = 'status';
    }
    // Supersession edge and freshness are handled separately from the D5c filters
    // so the include_* flags are independent.
    if (!reason && superseded.has(e.id) && !opts.includeSuperseded) reason = 'superseded';
    if (!reason && !opts.includeStale && !isInjectable(e)) reason = 'stale'; // freshness gate
    if (reason) {
      filteredOut[reason] = (filteredOut[reason] ?? 0) + 1;
      return false;
    }
    return true;
  });

  // Stage 2 (ADR-0012): for an explicit text query, RELEVANCE is the primary key
  // and the heuristic tier (type/trust/recency) is only the tiebreak among
  // equally-relevant entries — so a relevant entry is never buried by a fresher,
  // higher-trust, but barely-relevant one. Without a query, fall back to the pure
  // heuristic order (the injection bundle / `kb_list` ordering).
  const ranked = hasText
    ? [...filtered].sort((a, b) => {
        const s = (scoreOf.get(b.id) ?? 0) - (scoreOf.get(a.id) ?? 0);
        return s !== 0 ? s : heuristicCompare(a, b);
      })
    : rerank(filtered);
  const results = opts.limit ? ranked.slice(0, opts.limit) : ranked;
  if (results.length > 0) return { results };

  // Empty (RFC-002): classify deterministically from the stage counts.
  let diagnosis: SearchDiagnosis;
  if (candidates.length > 0) {
    // Candidates survived text + floor but the filters / ADR-0005 gate removed them.
    diagnosis = { reason: 'all_filtered', candidates: candidates.length, filteredOut };
  } else if (hasText && scored.length > 0) {
    // There were lexical matches, but none cleared the relevance floor (near-miss).
    const b = scored[0];
    diagnosis = { reason: 'no_match', candidates: 0, belowFloor: { entry: b.entry, matched: b.matched, queryTerms: qTerms } };
  } else {
    // No lexical overlap at all (or a structural query with nothing in scope).
    diagnosis = { reason: 'empty_topic', candidates: 0 };
  }
  return { results, diagnosis };
}

export function query(opts: QueryOpts = {}): KnowledgeEntry[] {
  return run(opts).results;
}

export function queryExplained(opts: QueryOpts = {}): SearchResult {
  return run(opts);
}
