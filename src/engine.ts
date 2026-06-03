// vtfkb engine facade. The storage kernel lives in storage.ts (append-only JSONL,
// tombstones, LWW, content-hash freshness — ADR-0013/0014) and the read index in
// index-store.ts. This module is: schema defaults, the injection FILTER (ADR-0005),
// the tiered Heuristic reranker (ADR-0012), the budgeted render (ADR-0015), capture.
// Pure Node stdlib, ZERO runtime deps.

import { randomBytes } from 'node:crypto';
import { appendRecord, materialize } from './storage.js';
import { selectIndex } from './index-store.js';
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
// (supersede-only) — ADR-0004.
const FLUID_TYPES: ReadonlySet<EntryType> = new Set(['fact', 'gotcha', 'pattern', 'link']);

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
}

export function addEntry(type: EntryType, text: string, opts: AddOpts = {}): KnowledgeEntry {
  const role: AuthorRole = opts.role ?? 'executor';
  const ts = nowIso();
  const entry: KnowledgeEntry = {
    id: newId(),
    type,
    text,
    tags: opts.tags ?? [],
    zone: opts.zone ?? (deriveTrust(role) === 'operator' ? 'established' : 'incoming'),
    author: { role },
    provenance: {
      status: opts.provStatus ?? (deriveTrust(role) === 'operator' ? 'verified' : 'unverified'),
      date: ts,
      origin: opts.origin,
    },
    validity: { valid_from: ts, valid_until: opts.validUntil },
    status: opts.status,
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

// --- Injection filter (ADR-0005 + ADR-0011 valid_until). Hard gate. ---
export function isInjectable(e: KnowledgeEntry, today = nowIso().slice(0, 10)): boolean {
  if (e.zone === 'archive') return false;
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
  const injectable = rerank(readAll().filter((e) => isInjectable(e)));
  const header = `<vtfkb-context project="${project}">\n`;
  const footer = `\n</vtfkb-context>`;
  let body = '';
  let dropped = 0;
  for (const e of injectable) {
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
  return addEntry('fact', text, {
    role: 'executor',
    tags: ['captured'],
    provStatus: 'unverified',
    origin: { kind: 'tool_call', tool: ev.tool_name, call_id: ev.call_id },
  });
}
