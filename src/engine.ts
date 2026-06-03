// vtfkb engine facade. The storage kernel lives in storage.ts (append-only JSONL,
// tombstones, LWW, content-hash freshness — ADR-0013/0014) and the read index in
// index-store.ts. This module is: schema defaults, the injection FILTER (ADR-0005),
// the tiered Heuristic reranker (ADR-0012), the budgeted render (ADR-0015), capture.
// Pure Node stdlib, ZERO runtime deps.

import { randomBytes } from 'node:crypto';
import { appendRecord, materialize, readRecords } from './storage.js';
import { selectIndex } from './index-store.js';
import { assertNoSecrets } from './secrets.js';
import type { SessionState } from './session.js';
import type { KbIndex } from './index-store.js';
import type {
  AuthorRole,
  EntryType,
  KnowledgeEntry,
  ProvenanceOrigin,
  Trust,
} from './types.js';

export { brainDir } from './storage.js';
export type { KbIndex } from './index-store.js';

export const SESSION_BUDGET_CHARS = 10_000; // Claude Code additionalContext cap (ADR-0015).

// Fluid types are editable (last-write-wins); the decision family is immutable
// (supersede-only) — ADR-0004. RFC = a `proposed` decision (ADR-0007),
// constitutional = a flagged decision (ADR-0008) — both are the `decision` type,
// not new types.
const FLUID_TYPES: ReadonlySet<EntryType> = new Set(['fact', 'gotcha', 'pattern', 'link']);
const DECISION_FAMILY: ReadonlySet<EntryType> = new Set(['decision']);

export function isDecisionFamily(type: EntryType): boolean {
  return DECISION_FAMILY.has(type);
}

function nowIso(): string {
  return new Date().toISOString();
}
function newId(): string {
  return randomBytes(6).toString('hex');
}

// --- Derived trust (ADR-0011): NOT a stored field. ---
export function deriveTrust(role: AuthorRole): Trust {
  if (role === 'human') return 'operator';
  if (role === 'init' || role === 'import') return 'import';
  return 'agent'; // architect | pm | executor | judge
}

// --- Writes ---
export interface AddOpts {
  role?: AuthorRole;
  tags?: string[];
  status?: KnowledgeEntry['status'];
  provStatus?: KnowledgeEntry['provenance']['status'];
  origin?: ProvenanceOrigin;
  zone?: KnowledgeEntry['zone'];
  validUntil?: string;
  constitutional?: boolean; // ADR-0008 (decision family only)
  supersedes?: string; // refs.supersedes — set by supersede()
}

export function addEntry(type: EntryType, text: string, opts: AddOpts = {}): KnowledgeEntry {
  assertNoSecrets(text); // no-secrets write-time lint (D6e) — throws on a planted secret
  const role: AuthorRole = opts.role ?? 'executor';
  const ts = nowIso();
  const entry: KnowledgeEntry = {
    id: newId(),
    type,
    text,
    tags: opts.tags ?? [],
    zone: opts.zone ?? (deriveTrust(role) === 'operator' ? 'established' : 'incoming'),
    author: { role },
    refs: opts.supersedes ? { supersedes: opts.supersedes } : undefined,
    provenance: {
      status: opts.provStatus ?? (deriveTrust(role) === 'operator' ? 'verified' : 'unverified'),
      date: ts,
      origin: opts.origin,
    },
    validity: { valid_from: ts, valid_until: opts.validUntil },
    // default a brand-new decision to `proposed` (an RFC, ADR-0007) unless told.
    status: opts.status ?? (isDecisionFamily(type) ? 'proposed' : undefined),
    constitutional: isDecisionFamily(type) ? opts.constitutional : undefined,
    created: ts,
    updated: ts,
  };
  appendRecord(entry);
  return entry;
}

export function readAll(): KnowledgeEntry[] {
  return materialize();
}

// Fluid-type edit (last-write-wins). Throws on the decision family (ADR-0004:
// decisions/RFC/constitutional are immutable — supersede, don't edit).
export function updateEntry(
  id: string,
  patch: Partial<Pick<KnowledgeEntry, 'text' | 'tags' | 'zone'>>,
): KnowledgeEntry {
  const cur = readAll().find((e) => e.id === id);
  if (!cur) throw new Error(`no such entry: ${id}`);
  if (!FLUID_TYPES.has(cur.type)) {
    throw new Error(
      `entry ${id} is a ${cur.type} (decision family) — immutable; supersede it, don't edit (ADR-0004)`,
    );
  }
  const next: KnowledgeEntry = { ...cur, ...patch, updated: nowIso() };
  appendRecord(next);
  return next;
}

// Delete = additive tombstone (never rewrites; merge=union safe).
export function deleteEntry(id: string): void {
  appendRecord({ id, deleted: true, updated: nowIso() });
}

// Deterministic rebuild of the read index from JSONL (ADR-0014).
export function rebuild(): KbIndex {
  const ix = selectIndex();
  ix.rebuild();
  return ix;
}

export function getIndex(): KbIndex {
  return selectIndex();
}

// =========================================================================
// Context Map (ADR-0006) — a DERIVED navigational artifact. v1 = the
// Index/Topology layer: what knowledge exists + how to pull more. Auto-injected
// at session start (Glossary + Routing Table are deferred / global tier).
// =========================================================================

export interface ContextMap {
  total: number;
  byType: Record<EntryType, number>;
  byZone: Record<KnowledgeEntry['zone'], number>;
  decisions: { accepted: number; proposed: number; superseded: number; deprecated: number; constitutional: number };
  topTags: Array<{ tag: string; n: number }>;
}

export function buildContextMap(): ContextMap {
  const all = readAll();
  const superseded = supersededIds(all);
  const byType = { fact: 0, decision: 0, gotcha: 0, pattern: 0, link: 0 } as Record<EntryType, number>;
  const byZone = { incoming: 0, established: 0, archive: 0 } as Record<KnowledgeEntry['zone'], number>;
  const decisions = { accepted: 0, proposed: 0, superseded: 0, deprecated: 0, constitutional: 0 };
  const tagCounts = new Map<string, number>();

  for (const e of all) {
    byType[e.type]++;
    byZone[e.zone]++;
    for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    if (isDecisionFamily(e.type)) {
      const eff = effectiveStatus(e, superseded);
      if (eff === 'accepted') decisions.accepted++;
      else if (eff === 'proposed') decisions.proposed++;
      else if (eff === 'superseded') decisions.superseded++;
      else if (eff === 'deprecated') decisions.deprecated++;
      if (e.constitutional && eff === 'accepted') decisions.constitutional++;
    }
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([tag, n]) => ({ tag, n }));

  return { total: all.length, byType, byZone, decisions, topTags };
}

export function renderContextMap(map: ContextMap = buildContextMap()): string {
  const types = (Object.entries(map.byType) as Array<[EntryType, number]>)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${t} ${n}`)
    .join(' · ');
  const d = map.decisions;
  const decLine =
    `decisions: ${d.accepted} accepted (${d.constitutional} constitutional)` +
    (d.proposed ? ` · ${d.proposed} proposed` : '') +
    (d.superseded ? ` · ${d.superseded} superseded` : '') +
    (d.deprecated ? ` · ${d.deprecated} deprecated` : '');
  const tags = map.topTags.length ? map.topTags.map((t) => `${t.tag}(${t.n})`).join(' ') : '(none)';
  return (
    `<vtfkb-map>\n` +
    `${map.total} entries · ${types} · zones: established ${map.byZone.established}/incoming ${map.byZone.incoming}\n` +
    `${decLine}\n` +
    `top tags: ${tags}\n` +
    `pull more: search <terms> · filter by type/tag/status/author\n` +
    `</vtfkb-map>`
  );
}

// =========================================================================
// Decision family (ADR-0004/0007/0008/0009). Decisions are immutable in their
// CONTENT (text/rationale) — superseded, not edited. But lifecycle/identity
// fields the ENGINE manages (status, refs.supersedes, adr_no) may change via
// the dedicated operations below, which preserve the content verbatim.
// =========================================================================

// Supersede a decision with a new one (additive edge — the old is never edited).
// The old entry's effective status becomes `superseded`, derived from the edge.
export function supersede(oldId: string, text: string, opts: AddOpts = {}): KnowledgeEntry {
  const old = readAll().find((e) => e.id === oldId);
  if (!old) throw new Error(`no such entry: ${oldId}`);
  if (!isDecisionFamily(old.type)) {
    throw new Error(`entry ${oldId} is not a decision — fluid types are edited, not superseded`);
  }
  return addEntry('decision', text, {
    role: opts.role ?? 'human',
    tags: opts.tags,
    status: opts.status ?? 'accepted',
    constitutional: opts.constitutional ?? old.constitutional,
    supersedes: oldId,
  });
}

// Lifecycle transition (proposed→accepted→deprecated). Appends a new version with
// the SAME content but a new status. Cannot set `superseded` (that is edge-derived),
// and refuses to alter `text` (content-immutability — use supersede() instead).
export function transitionDecision(
  id: string,
  status: NonNullable<KnowledgeEntry['status']>,
): KnowledgeEntry {
  if (status === 'superseded') {
    throw new Error('`superseded` is derived from a supersession edge — use supersede()');
  }
  const cur = readAll().find((e) => e.id === id);
  if (!cur) throw new Error(`no such entry: ${id}`);
  if (!isDecisionFamily(cur.type)) {
    throw new Error(`entry ${id} is not a decision — use updateEntry() for fluid types`);
  }
  const next: KnowledgeEntry = { ...cur, status, updated: nowIso() };
  appendRecord(next);
  return next;
}

// The set of ids superseded by some live entry (the supersession edges).
export function supersededIds(entries: KnowledgeEntry[] = readAll()): Set<string> {
  const s = new Set<string>();
  for (const e of entries) if (e.refs?.supersedes) s.add(e.refs.supersedes);
  return s;
}

// Effective status folds the supersession edge in: an entry pointed at by a live
// supersession is `superseded` regardless of its own stored status.
export function effectiveStatus(
  e: KnowledgeEntry,
  superseded: Set<string> = supersededIds(),
): KnowledgeEntry['status'] {
  if (superseded.has(e.id)) return 'superseded';
  return e.status;
}

// Stamp human ADR ordinals (ADR-0009). Assigns the next monotonic `adr_no` to live
// decision-family entries lacking one, in `created` order. Idempotent: already-
// stamped entries keep their number. Models the engine's merge-to-main step (main
// is serialized + sole-writer → monotonic, no collision).
export function stampOrdinals(): number {
  const live = readAll();
  let max = 0;
  for (const e of live) if (typeof e.adr_no === 'number' && e.adr_no > max) max = e.adr_no;
  // "Creation order" = append-log order (first appearance in the JSONL). This is
  // the ground-truth write order, immune to same-millisecond `created` collisions.
  const firstSeen = new Map<string, number>();
  readRecords().forEach((r, i) => {
    if (!firstSeen.has(r.id)) firstSeen.set(r.id, i);
  });
  const unstamped = live
    .filter((e) => isDecisionFamily(e.type) && typeof e.adr_no !== 'number')
    .sort((a, b) => (firstSeen.get(a.id) ?? 0) - (firstSeen.get(b.id) ?? 0));
  let stamped = 0;
  for (const e of unstamped) {
    appendRecord({ ...e, adr_no: ++max, updated: nowIso() });
    stamped++;
  }
  return stamped;
}

// Derive the always-injected Constitution (ADR-0008): live, accepted, constitutional
// decisions that are not superseded/deprecated.
export function deriveConstitution(): KnowledgeEntry[] {
  const live = readAll();
  const superseded = supersededIds(live);
  return live
    .filter(
      (e) =>
        isDecisionFamily(e.type) &&
        e.constitutional === true &&
        effectiveStatus(e, superseded) === 'accepted',
    )
    .sort((a, b) => (a.adr_no ?? 1e9) - (b.adr_no ?? 1e9));
}

// --- Injection filter (ADR-0005 + ADR-0011 valid_until). Hard gate. ---
export function isInjectable(
  e: KnowledgeEntry,
  today = nowIso().slice(0, 10),
  superseded?: Set<string>,
): boolean {
  if (e.zone === 'archive') return false;
  if (superseded?.has(e.id)) return false; // superseded by a live edge (ADR-0004)
  if (e.status === 'deprecated' || e.status === 'superseded') return false;
  if (e.provenance.status === 'stale' || e.provenance.status === 'expired') return false;
  if (e.validity.valid_until && e.validity.valid_until.slice(0, 10) < today) return false;
  return true; // unverified entries ARE injected (labelled) per ADR-0005.
}

// --- Heuristic reranker (ADR-0012). Soft sort over the survivors of the filter. ---
const TYPE_WEIGHT: Record<EntryType, number> = {
  pattern: 5, // patterns + gotchas first (L3 tiered render)
  gotcha: 5,
  decision: 4,
  fact: 2,
  link: 1,
};

function withinTierScore(e: KnowledgeEntry): number {
  let s = 0;
  if (deriveTrust(e.author.role) === 'operator') s += 3; // operator-trust boost
  if (e.provenance.status === 'verified') s += 1;
  return s;
}

// Tiered sort (L3): TYPE tier is the PRIMARY key (patterns/gotchas first), so
// trust/recency reorder *within* a tier but never lift a fact above a pattern.
export function rerank(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  return [...entries].sort((a, b) => {
    const tier = TYPE_WEIGHT[b.type] - TYPE_WEIGHT[a.type];
    if (tier !== 0) return tier;
    const within = withinTierScore(b) - withinTierScore(a);
    if (within !== 0) return within;
    return b.updated.localeCompare(a.updated); // recency tiebreak
  });
}

// --- Tier-A session-start bundle (ADR-0015), budgeted to 10k chars. ---
function trustGlyph(e: KnowledgeEntry): string {
  const t = deriveTrust(e.author.role);
  const v =
    e.provenance.status === 'verified' ? '✓' : e.provenance.status === 'unverified' ? '⚠' : '';
  return `${v}${t}`;
}

export function renderContextBundle(project = 'spike', budget = SESSION_BUDGET_CHARS): string {
  const all = readAll();
  const today = nowIso().slice(0, 10);
  const superseded = supersededIds(all);
  const injectable = rerank(all.filter((e) => isInjectable(e, today, superseded)));
  const header = `<vtfkb-context project="${project}">\n`;
  const footer = `\n</vtfkb-context>`;
  let body = '';

  // Constitution always leads (ADR-0008): accepted, constitutional, non-superseded
  // decisions, injected first and never budget-dropped.
  const constitution = deriveConstitution();
  if (constitution.length > 0) {
    body += '## Constitution (always applies)\n';
    for (const c of constitution) {
      const n = typeof c.adr_no === 'number' ? `ADR-${String(c.adr_no).padStart(4, '0')} ` : '';
      body += `- [${n}constitutional] ${c.text}\n`;
    }
    body += '\n';
  }
  const constitutionalIds = new Set(constitution.map((c) => c.id));

  // Context Map (ADR-0006): the navigational index, always injected, never dropped.
  body += renderContextMap() + '\n\n';

  let dropped = 0;
  for (const e of injectable) {
    if (constitutionalIds.has(e.id)) continue; // already in the Constitution section
    const line = `- [${e.type} ${trustGlyph(e)}] ${e.text}\n`;
    if (header.length + body.length + line.length + footer.length > budget) {
      dropped++;
      continue;
    }
    body += line;
  }
  if (dropped > 0) {
    const note = `<!-- ${dropped} lower-ranked entries omitted for the ${budget}-char budget -->\n`;
    if (header.length + body.length + note.length + footer.length <= budget) body += note;
  }
  return header + body + footer;
}

// --- Naive flat dump (NOT used in production). Represents a mykb-v1-style memory:
//     all live entries in load/creation order, flat, NO supersession/stale filter,
//     NO rerank, budget-cut from the end (so the newest can be dropped). Used only
//     by the L4 scenario harness as the contrast baseline. ---
export function renderNaiveDump(
  project = 'spike',
  budget = SESSION_BUDGET_CHARS,
  limit?: number,
): string {
  let entries = readAll()
    .filter((e) => e.zone !== 'archive')
    .sort((a, b) => a.created.localeCompare(b.created)); // oldest first (load order)
  // A `limit` reproduces the Stark-FQDN incident faithfully: a load-order memory
  // truncated to a token budget keeps the OLDER entries and drops the newest
  // correction — exactly mykb v1's failure mode.
  if (typeof limit === 'number') entries = entries.slice(0, limit);
  const header = `<context project="${project}">\n`;
  const footer = `\n</context>`;
  let body = '';
  for (const e of entries) {
    const line = `- ${e.text}\n`;
    if (header.length + body.length + line.length + footer.length > budget) break; // drops newest
    body += line;
  }
  return header + body + footer;
}

// --- Tier-B passive capture (ADR-0015 / ADR-0011 tool_call origin). ---
export interface ToolEvent {
  tool_name?: string;
  tool_input?: unknown;
  tool_result?: unknown;
  call_id?: string;
}

export function captureToolCall(ev: ToolEvent): KnowledgeEntry | null {
  if (!ev.tool_name) return null;
  const inputSummary =
    typeof ev.tool_input === 'object' && ev.tool_input
      ? JSON.stringify(ev.tool_input).slice(0, 200)
      : String(ev.tool_input ?? '');
  const text = `Tool ${ev.tool_name} invoked${inputSummary ? `: ${inputSummary}` : ''}`;
  try {
    return addEntry('fact', text, {
      role: 'executor',
      tags: ['captured'],
      provStatus: 'unverified',
      origin: { kind: 'tool_call', tool: ev.tool_name, call_id: ev.call_id },
    });
  } catch {
    // no-secrets lint (or any write error) → skip the capture, never crash the harness.
    return null;
  }
}

// Ids of entries currently eligible for injection (filter + supersession applied).
export function currentInjectableIds(): string[] {
  const all = readAll();
  const sup = supersededIds(all);
  return all.filter((e) => isInjectable(e, undefined, sup)).map((e) => e.id);
}

// --- Per-turn delta injection (Tier C, Pi-only — ADR-0015). Inject only entries
//     not already injected this session (dedup via SessionState, L4). Returns ''
//     when there is nothing new this turn. ---
export function renderContextDelta(session: SessionState, project = 'spike'): string {
  const all = readAll();
  const superseded = supersededIds(all);
  const fresh = rerank(all.filter((e) => isInjectable(e, undefined, superseded))).filter(
    (e) => !session.isInjected(e.id),
  );
  session.bumpTurn();
  if (fresh.length === 0) return '';
  session.markInjected(fresh.map((e) => e.id));
  const lines = fresh.map((e) => `- [${e.type} ${trustGlyph(e)}] ${e.text}`).join('\n');
  return `<vtfkb-context-delta project="${project}">\n${lines}\n</vtfkb-context-delta>`;
}
