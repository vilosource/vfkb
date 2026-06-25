// ACE curator (ADR-0021 / RFC-006) — the maintenance side of auto-distill.
// DELTAS + COUNTERS, NEVER REWRITES (IMPL-PLAN L12 context-collapse). Every op here
// acts ONLY through the engine's non-destructive primitives and leaves the entry's
// TEXT byte-identical. That invariant is the load-bearing safety rail and is enforced
// by the structural Brake in test/curator.test.ts (any in-place text edit fails the
// build) — because a prose "don't rewrite" rule an LLM curator will eventually ignore.
//
// M2a ships the curator ops + the Brake + the retrieval-quality regression. The
// distiller (write side) and the counter/signal stream that DRIVES promotion are M2b.

import { readAll, updateEntry, transitionDecision, isDecisionFamily } from './engine.js';
import { tally } from './counters.js';
import type { KnowledgeEntry } from './types.js';

function get(id: string): KnowledgeEntry {
  const e = readAll().find((x) => x.id === id);
  if (!e) throw new Error(`no such entry: ${id}`);
  return e;
}

// promote: an `incoming` candidate becomes trusted-zone (`established`). Fluid types
// move zone; a decision's standing is its status (transitionDecision), never a zone
// promotion here. Text is never touched.
export function promote(id: string): KnowledgeEntry {
  const e = get(id);
  if (isDecisionFamily(e.type)) {
    throw new Error(`promote() is for fluid types; a decision's standing is its status (use transitionDecision)`);
  }
  return updateEntry(id, { zone: 'established' });
}

// CORROBORATED promotion (ADR-0021 pt 4): auto-distilled `incoming` knowledge CANNOT be
// minted into the trusted set on a single distillation — it needs ≥N independent
// corroborating signals (or a human, who uses the unguarded promote() above). The
// evidence is the append-only counter stream, aggregated at read; promotion itself is
// still the same non-destructive zone transition (text never touched). This is the gate
// that keeps machine extraction from self-promoting.
export const PROMOTION_THRESHOLD = 2; // net helpful signals required (≥2 corroborations)

export function eligibleForPromotion(id: string, threshold = PROMOTION_THRESHOLD): boolean {
  return tally(id).net >= threshold;
}

export function promoteIfCorroborated(id: string, threshold = PROMOTION_THRESHOLD): KnowledgeEntry {
  const t = tally(id);
  if (t.net < threshold) {
    throw new Error(
      `entry ${id} is not corroborated (net ${t.net} < ${threshold}) — auto-distill alone cannot mint trusted knowledge (ADR-0021); needs more signals or a human promote`,
    );
  }
  return promote(id);
}

// archive: retire a stale/noise entry out of the injection set. Fluid → zone
// `archive`; decision → `deprecated` (status). Text is never touched.
export function archive(id: string): KnowledgeEntry {
  const e = get(id);
  if (isDecisionFamily(e.type)) return transitionDecision(id, 'deprecated');
  return updateEntry(id, { zone: 'archive' });
}

// mergeDuplicate: keep `winnerId`, retire the fluid duplicate `loserId` by archiving
// it + tagging the edge so the merge is auditable. NEITHER entry's text is rewritten.
// Decisions are merged by an explicit supersede() edge, never here.
export function mergeDuplicate(loserId: string, winnerId: string): KnowledgeEntry {
  const loser = get(loserId);
  get(winnerId); // winner must exist
  if (isDecisionFamily(loser.type)) {
    throw new Error(`merge a decision via supersede(), not the curator`);
  }
  const tags = [...new Set([...loser.tags, `merged-into:${winnerId}`])];
  return updateEntry(loserId, { zone: 'archive', tags });
}

// PROPOSE (does not act): exact lexical-duplicate pairs among live (non-archive)
// fluid entries of the same type — normalized whitespace + case. Semantic dedup
// composes later with RFC-003; this is the lexical floor the curator can act on.
export interface DuplicatePair {
  loser: string;
  winner: string;
}
export function findLexicalDuplicates(entries: KnowledgeEntry[] = readAll()): DuplicatePair[] {
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
  const seen = new Map<string, string>(); // normalized text → first (winner) id
  const out: DuplicatePair[] = [];
  for (const e of entries) {
    if (e.zone === 'archive' || isDecisionFamily(e.type)) continue;
    const key = `${e.type}:${norm(e.text)}`;
    const winner = seen.get(key);
    if (winner) out.push({ loser: e.id, winner });
    else seen.set(key, e.id);
  }
  return out;
}
