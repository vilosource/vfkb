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
  AUTO_ARCHIVED,
  CURATION_KEPT,
} from './engine.js';
import { withExclusive, readRecords, materialize, isTombstone } from './storage.js';
import { normalizeEntry } from './validate.js';
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
    // ADR-0083 §2: undoing the Tier-1 rule also exempts the entry from it for good.
    const ruleArchived = e.tags.some((t) => t.startsWith(AUTO_ARCHIVED));
    const tags = e.tags.filter((t) => !t.startsWith(RETIRED_BY) && !t.startsWith(AUTO_ARCHIVED));
    return updateEntry(id, { zone: 'established', tags: ruleArchived ? [...new Set([...tags, CURATION_KEPT])] : tags });
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

// --- Background curation, Tier 1 (ADR-0083, accepts RFC-046). A deterministic rule —
// no model — that archives a clear-cut old handoff. It reads only `created`, tags and
// the shape test, never what the text says about other entries: "supersedes X" is too
// often partial to drive a rule (RFC-046 Context item 2). Archiving is the existing
// zone delta plus a dated rule tag; text is never touched (ADR-0021).
export { AUTO_ARCHIVED, CURATION_KEPT };
const AUTO_RULE = 'old-handoff';
// Constants, changed only by RFC (ADR-0083 §7).
const MIN_AGE_DAYS = 14;
const MIN_NEWER = 3;
// Tags that do not name a stream (ADR-0083 §2 condition 5): lifecycle words, then
// kind-of-work words that span streams.
const GENERIC_TAGS = new Set([
  'handoff', 'next', 'status', 'auto', 'verified', 'v2', 'v3',
  'review', 'escalation', 'rfc', 'adr', 'plugin', 'l4', 'guard', 'release', 'tooling',
  'cross-repo', 'distribution', 'roadmap', 'public',
]);
const topicTags = (e: KnowledgeEntry) => e.tags.filter((t) => !GENERIC_TAGS.has(t));
const isRuleLine = (e: KnowledgeEntry) => e.tags.some((t) => t.startsWith(AUTO_ARCHIVED));
const createdMs = (e: KnowledgeEntry) => Date.parse(e.created);

export interface AutoCurateResult {
  archived: string[];
  repaired: string[];
}

/**
 * Run the Tier-1 rule once. `today` dates the rule tag; the age test is measured
 * against the pin's `created`, not the wall clock. `dryRun` reports without writing.
 */
export function autoCurate(today = todayIso(), opts: { dryRun?: boolean } = {}): AutoCurateResult {
  return withExclusive(() => {
    const records = readRecords();
    const all = materialize(records);
    const linesById = new Map<string, KnowledgeEntry[]>();
    // Every raw line of each id, normalized the way materialize normalizes the newest.
    for (const r of records) {
      if (!r || typeof r.id !== 'string' || isTombstone(r)) continue;
      const n = normalizeEntry(r);
      if (!n.ok) continue;
      const list = linesById.get(r.id) ?? [];
      list.push(n.entry);
      linesById.set(r.id, list);
    }
    const result: AutoCurateResult = { archived: [], repaired: [] };

    // The sticky repair: an entry the operator restored (curation-kept) that a branch
    // forked before the restore re-archived. Judged by the newest line the rule did not
    // write, newest by `updated` as materialize orders them, never by file position.
    for (const e of all) {
      if (e.zone !== 'archive' || !isRuleLine(e)) continue;
      const others = (linesById.get(e.id) ?? []).filter((l) => !isRuleLine(l));
      let newest: KnowledgeEntry | undefined;
      for (const l of others) if (!newest || l.updated >= newest.updated) newest = l;
      if (!newest || newest.zone === 'archive' || !newest.tags.includes(CURATION_KEPT)) continue;
      result.repaired.push(e.id);
      if (!opts.dryRun) {
        const tags = [...new Set([...newest.tags.filter((t) => !t.startsWith(AUTO_ARCHIVED)), CURATION_KEPT])];
        updateEntry(e.id, { zone: newest.zone, tags });
      }
    }

    const superseded = supersededIds(all);
    const pin = latestHandoff(all, today, superseded);
    // An unparseable `created` (normalizeEntry accepts any string) would make every age
    // and order test NaN — and NaN passes "< 14 days" as false. Skip such entries, and
    // run nothing when the pin itself has one.
    if (!pin || !Number.isFinite(createdMs(pin))) return result;
    const kept = new Set<string>();
    for (const [id, lines] of linesById) if (lines.some((l) => l.tags.includes(CURATION_KEPT))) kept.add(id);
    const repaired = new Set(result.repaired);
    const shaped = all.filter(
      (e) =>
        !repaired.has(e.id) && isInjectable(e, today, superseded) && isPinCandidate(e) &&
        HANDOFF_SHAPE.test(e.text) && Number.isFinite(createdMs(e)),
    );
    const live = new Set(shaped.map((e) => e.id));
    // Newest-first, so a handoff this run archives never clears an older one.
    const candidates = shaped.filter((e) => e.id !== pin.id).sort((a, b) => createdMs(b) - createdMs(a));
    for (const e of candidates) {
      if (kept.has(e.id)) continue;
      if (createdMs(pin) - createdMs(e) < MIN_AGE_DAYS * DAY_MS) continue;
      // Compared as instants, not strings: `created` may carry a timezone offset.
      const newer = shaped.filter((o) => live.has(o.id) && createdMs(o) > createdMs(e));
      if (newer.length < MIN_NEWER) continue;
      const topics = topicTags(e);
      if (topics.length && !newer.some((o) => topicTags(o).some((t) => topics.includes(t)))) continue;
      live.delete(e.id);
      result.archived.push(e.id);
      if (!opts.dryRun) {
        updateEntry(e.id, { zone: 'archive', tags: [...new Set([...e.tags, `${AUTO_ARCHIVED}${AUTO_RULE}@${today}`])] });
      }
    }
    return result;
  });
}

export interface AutoArchiveRow extends ReportRow {
  rule: string;
  date: string;
}

/** READ-ONLY (ADR-0083 §5): entries archived by the Tier-1 rule, newest archive first. */
export function autoArchiveLog(entries: KnowledgeEntry[] = readAll(), today = todayIso()): AutoArchiveRow[] {
  const out: AutoArchiveRow[] = [];
  for (const e of entries) {
    if (e.zone !== 'archive') continue;
    const tag = e.tags.find((t) => t.startsWith(AUTO_ARCHIVED));
    if (!tag) continue;
    const [rule, date = ''] = tag.slice(AUTO_ARCHIVED.length).split('@');
    out.push({ ...row(e, today), rule, date });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
