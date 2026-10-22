// ACE curator (ADR-0021 / RFC-006) — the maintenance side of auto-distill.
// DELTAS + COUNTERS, NEVER REWRITES (IMPL-PLAN L12 context-collapse). Every op here
// acts ONLY through the engine's non-destructive primitives and leaves the entry's
// TEXT byte-identical. That invariant is the load-bearing safety rail and is enforced
// by the structural Brake in test/curator.test.ts (any in-place text edit fails the
// build) — because a prose "don't rewrite" rule an LLM curator will eventually ignore.
//
// M2a ships the curator ops + the Brake + the retrieval-quality regression. The
// distiller (write side) and the counter/signal stream that DRIVES promotion are M2b.

import {
  readAll,
  updateEntry,
  setProvenanceStatus,
  transitionDecision,
  isDecisionFamily,
  isInjectable,
  isPinCandidate,
  latestHandoff,
  retirementRefusal,
  supersededIds,
  effectiveStatus,
  RETIRED_BY,
} from './engine.js';
import { withExclusive } from './storage.js';
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
  // D-iii (ADR-0024): the trust elevation must be AGENT-OBSERVABLE, not just a zone move.
  // Corroboration-by-recurrence is the independent "second agent" signal §3.6 requires
  // (the recurrence, not the author, asserts it) — so promotion both moves the zone AND
  // re-stamps provenance verified, putting the lesson into the verified-only view + the ✓
  // glyph. Text stays byte-identical (the never-rewrite Brake holds — setProvenanceStatus
  // touches only metadata).
  promote(id);
  return setProvenanceStatus(id, 'verified');
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

// retire (ADR-0082 §4): the after-the-fact form of `retires` — what /vfkb:handoff runs
// on the user's explicit yes. `old` must be a live handoff/next fact; `by` a live
// handoff/next fact other than `old`, created no earlier (so `retire <pin> --by <older>`
// cannot move the pin back). A refusal appends nothing. Text is never touched.
export function retire(oldId: string, byId: string): KnowledgeEntry {
  return withExclusive(() => {
    const all = readAll();
    const old = all.find((e) => e.id === oldId);
    if (!old) throw new Error(`no such entry: ${oldId}`);
    const by = all.find((e) => e.id === byId);
    if (!by) throw new Error(`no such entry: ${byId}`);
    const refusal = retirementRefusal(old, by, undefined, supersededIds(all));
    if (refusal) throw new Error(refusal);
    const tags = [...new Set([...old.tags, `${RETIRED_BY}${byId}`])];
    return updateEntry(oldId, { zone: 'archive', tags });
  });
}

// restore (ADR-0082 §4): an archived fluid entry back to `established`, minus its
// `retired-by:` edge. Under the created-ordered pin (§1) a restore cannot move the pin.
export function restore(id: string): KnowledgeEntry {
  return withExclusive(() => {
    const e = get(id);
    if (isDecisionFamily(e.type)) {
      throw new Error(`restore() is for fluid types; a decision's standing is its status (use transitionDecision)`);
    }
    if (e.zone !== 'archive') throw new Error(`entry ${id} is not archived (zone ${e.zone}) — nothing to restore`);
    return updateEntry(id, { zone: 'established', tags: e.tags.filter((t) => !t.startsWith(RETIRED_BY)) });
  });
}

// --- Read-only reports (ADR-0082 §6, CLI-only). PROPOSE, never act: each returns
// data; the CLI prints `curate archive <id>` lines for the operator to edit and run.
export interface ReportRow {
  id: string;
  type: KnowledgeEntry['type'];
  created: string;
  ageDays: number;
  firstLine: string;
}
export interface HandoffRow extends ReportRow {
  /** opens as a handoff ("HANDOFF", "SESSION HANDOFF", "RESUME") — the probe's shape rule */
  shaped: boolean;
}

const HANDOFF_SHAPE = /^\W*(SESSION\s+)?(HANDOFF|RESUME)\b/i;
const DAY_MS = 86_400_000;
const todayIso = () => new Date().toISOString().slice(0, 10);

function row(e: KnowledgeEntry, today: string): ReportRow {
  const ageDays = Math.floor((Date.parse(today) - Date.parse(e.created.slice(0, 10))) / DAY_MS);
  return { id: e.id, type: e.type, created: e.created, ageDays, firstLine: e.text.split('\n')[0].slice(0, 100) };
}
const oldestFirst = (a: KnowledgeEntry, b: KnowledgeEntry) => a.created.localeCompare(b.created);
const tagged = (e: KnowledgeEntry) => e.tags.includes('handoff') || e.tags.includes('next');

export function handoffReport(
  today = todayIso(),
  entries: KnowledgeEntry[] = readAll(),
): { pin: HandoffRow | null; candidates: HandoffRow[]; unpinnable: ReportRow[] } {
  const superseded = supersededIds(entries);
  const live = entries.filter((e) => isInjectable(e, today, superseded)).sort(oldestFirst);
  const pin = latestHandoff(entries, today, superseded);
  const shapedRow = (e: KnowledgeEntry): HandoffRow => ({ ...row(e, today), shaped: HANDOFF_SHAPE.test(e.text) });
  return {
    pin: pin ? shapedRow(pin) : null,
    candidates: live.filter((e) => isPinCandidate(e) && e.id !== pin?.id).map(shapedRow),
    // tagged handoff/next but not a fact: §1 stops these pinning (listed, not proposed)
    unpinnable: live.filter((e) => tagged(e) && e.type !== 'fact').map((e) => row(e, today)),
  };
}

export function staleReport(
  days = 30,
  today = todayIso(),
  entries: KnowledgeEntry[] = readAll(),
): { proposed: ReportRow[]; incoming: ReportRow[]; status: ReportRow[] } {
  const superseded = supersededIds(entries);
  const old = entries
    .filter((e) => isInjectable(e, today, superseded))
    .filter((e) => row(e, today).ageDays > days)
    .sort(oldestFirst);
  return {
    proposed: old.filter((e) => isDecisionFamily(e.type) && effectiveStatus(e, superseded) === 'proposed').map((e) => row(e, today)),
    incoming: old.filter((e) => e.zone === 'incoming' && !isDecisionFamily(e.type)).map((e) => row(e, today)),
    status: old.filter((e) => e.type === 'fact' && e.tags.includes('status') && !tagged(e)).map((e) => row(e, today)),
  };
}
