// ADR-0042 §2 (v2): whole-envelope validation at the READ boundary — the one place
// that sees every entry regardless of origin (vfkb's own writes, vfwb's lossy external
// projection, hand-edited legacy lines, a future RFC-019 backend). Malformed/missing
// fields get safe DOCUMENTED defaults; a record that cannot be salvaged at all (no
// usable id) is excluded from the live set and surfaced as a counted, inspectable
// state (storage.lastMalformed / the context map's malformed count) — visible, never
// a silent drop, and never a crash in a caller.
//
// Philosophy: permissive-with-defaults, loose (unknown future fields PASS THROUGH —
// a v2 brain read by this code, or a foreign brain with extra fields, must not be
// stripped). zod is used per the accepted ADR; it is currently satisfied transitively
// via @modelcontextprotocol/sdk (declaring it directly is a noted follow-up).

import { z } from 'zod';
import type { KnowledgeEntry } from './types.js';

const ROLE = z.enum(['architect', 'pm', 'executor', 'judge', 'human', 'init', 'import']);
const PROV_STATUS = z.enum(['verified', 'unverified', 'stale', 'expired']);

// Defaults (documented): unknown role → executor (agent-trust, the safe floor);
// unknown provenance → unverified (never accidentally verified); unknown zone →
// incoming (never accidentally injected as established); missing tags → [].
//
// TWO KNOWN CONSEQUENCES (review gate, 2026-07-06 — deliberate, documented):
// 1. PERSISTENCE-ON-UPDATE: update paths (updateEntry/setProvenanceStatus/transition)
//    spread the NORMALIZED entry and re-append, so read-time defaults become stored
//    values on the next edit of a legacy/foreign entry. The original line stays
//    untouched (append-only intact) and normalization is idempotent, but an
//    invalid-but-meaningful original value leaves the live record permanently.
// 2. UNKNOWN TYPE COERCES TO 'fact' (the one place passthrough does NOT hold): a
//    future v3 entry type read by this code renders as a fact, and via (1) an edit
//    would persist that coercion. Revisit before any v3 schema introduces new types.
const entrySchema = z
  .looseObject({
    id: z.string().min(1),
    type: z.enum(['fact', 'decision', 'gotcha', 'pattern', 'link']).catch('fact'),
    text: z.string().catch(''),
    tags: z.array(z.string()).catch([]),
    zone: z.enum(['incoming', 'established', 'archive']).catch('incoming'),
    author: z.looseObject({ role: ROLE.catch('executor'), id: z.string().optional() }).catch({ role: 'executor' }),
    refs: z
      .looseObject({
        supersedes: z.string().optional(),
        contradicts: z.array(z.string()).optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
    provenance: z
      .looseObject({
        status: PROV_STATUS.catch('unverified'),
        date: z.string().optional(),
        source: z.string().optional(),
        detail: z.string().optional(),
        origin: z.unknown().optional(),
      })
      .catch({ status: 'unverified' }),
    validity: z
      .looseObject({
        valid_from: z.string().optional(),
        valid_until: z.string().optional(),
        recorded_invalid_at: z.string().optional(),
      })
      .catch({}),
    status: z.enum(['proposed', 'accepted', 'deprecated', 'superseded']).optional().catch(undefined),
    why: z.string().optional().catch(undefined),
    constitutional: z.boolean().optional().catch(undefined),
    adr_no: z.number().optional().catch(undefined),
    session_id: z.string().optional().catch(undefined),
    created: z.string().catch(''),
    updated: z.string().catch(''),
  });

export type NormalizeResult =
  | { ok: true; entry: KnowledgeEntry }
  | { ok: false; issue: string };

export function normalizeEntry(raw: unknown): NormalizeResult {
  const parsed = entrySchema.safeParse(raw);
  if (!parsed.success) {
    // Only an unsalvageable record lands here (everything else is caught-with-default):
    // not an object, or no usable string id.
    return { ok: false, issue: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  const e = parsed.data as unknown as KnowledgeEntry;
  // valid_from is required by the TS envelope type (no runtime consumer today) —
  // default it from the entry's own created stamp, else epoch (visibly ancient
  // beats invisibly wrong).
  if (!e.validity.valid_from) {
    e.validity = { ...e.validity, valid_from: e.created || '1970-01-01T00:00:00.000Z' };
  }
  return { ok: true, entry: e };
}
