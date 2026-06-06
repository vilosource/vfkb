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
import { selectIndex } from './index-store.js';

export interface QueryOpts {
  text?: string; // BM25-lite candidate search (index); else the whole brain
  type?: EntryType | EntryType[];
  zone?: Zone | Zone[];
  status?: DecisionStatus | DecisionStatus[]; // matched against EFFECTIVE status
  tags?: string[]; // entry must carry ALL of these
  authorRole?: AuthorRole | AuthorRole[];
  includeStale?: boolean; // default false → apply the freshness gate (ADR-0005/0011)
  includeSuperseded?: boolean; // default false → drop entries behind a supersession edge
  limit?: number;
}

function arr<T>(v?: T | T[]): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

export function query(opts: QueryOpts = {}): KnowledgeEntry[] {
  const all = readAll();
  const superseded = supersededIds(all);

  // Stage 1 (ADR-0012): term-overlap candidates when text is given, else all.
  // Capture the relevance score per id so Stage 2 can keep it as the primary
  // sort key for search (without a query there is no score → score 0 → the
  // heuristic order stands, which is what list/injection want).
  const hasText = !!(opts.text && opts.text.trim());
  const scored = hasText ? selectIndex().searchScored(opts.text as string, 200) : [];
  const scoreOf = new Map(scored.map((s) => [s.entry.id, s.score]));
  const candidates: KnowledgeEntry[] = hasText ? scored.map((s) => s.entry) : all;

  const types = arr(opts.type);
  const zones = arr(opts.zone);
  const statuses = arr(opts.status);
  const roles = arr(opts.authorRole);

  const filtered = candidates.filter((e) => {
    if (types && !types.includes(e.type)) return false;
    if (zones && !zones.includes(e.zone)) return false;
    if (roles && !roles.includes(e.author.role)) return false;
    if (opts.tags && !opts.tags.every((t) => e.tags.includes(t))) return false;
    if (statuses) {
      const eff = effectiveStatus(e, superseded);
      if (!eff || !statuses.includes(eff)) return false;
    }
    // Supersession edge is handled separately from freshness so the two flags
    // are independent.
    if (superseded.has(e.id) && !opts.includeSuperseded) return false;
    if (!opts.includeStale && !isInjectable(e)) return false; // freshness gate (no edge)
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
  return opts.limit ? ranked.slice(0, opts.limit) : ranked;
}
