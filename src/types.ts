// vfkb entry envelope — Phase 0 spike shape.
// Implements ADR-0011 (validity window + structured provenance.origin; trust derived).

export type EntryType = 'fact' | 'decision' | 'gotcha' | 'pattern' | 'link';

export type Zone = 'incoming' | 'established' | 'archive';

// Decision-family lifecycle (ADR-0004). Non-decision types leave this undefined.
export type DecisionStatus =
  | 'proposed'
  | 'accepted'
  | 'deprecated'
  | 'superseded';

// Review/verification signal (orthogonal to author identity).
export type ProvenanceStatus = 'verified' | 'unverified' | 'stale' | 'expired';

// Who authored the entry (ADR-0011 D3a). Trust is DERIVED from this + provenance.status.
export type AuthorRole =
  | 'architect'
  | 'pm'
  | 'executor'
  | 'judge'
  | 'human'
  | 'init'
  | 'import';

// Derived trust projection (ADR-0011) — NOT a stored field.
export type Trust = 'operator' | 'agent' | 'import';

// Structured, re-verifiable origin (ADR-0011) — distinct from refs.commit (work-state linkage).
export type ProvenanceOrigin =
  | { kind: 'commit'; repo: string; sha: string; path?: string; line?: number }
  | { kind: 'message'; thread_id: string; message_id: string }
  | { kind: 'tool_call'; tool: string; call_id?: string }
  | { kind: 'manual' };

export interface Provenance {
  status: ProvenanceStatus;
  date?: string;
  source?: string;
  detail?: string;
  origin?: ProvenanceOrigin; // ADR-0011
}

export interface Refs {
  task_id?: string;
  workplan_id?: string;
  commit?: string;
  branch?: string;
  files?: string[];
  related?: string[];
  supersedes?: string; // supersession edge (decision family) — ADR-0004
}

// Bi-temporal validity window (ADR-0011). recorded_invalid_at stored-but-not-consumed in v1.
export interface Validity {
  valid_from: string;
  valid_until?: string;
  recorded_invalid_at?: string;
}

export interface KnowledgeEntry {
  id: string;
  type: EntryType;
  text: string;
  tags: string[];
  zone: Zone;
  author: { role: AuthorRole; id?: string };
  refs?: Refs;
  provenance: Provenance;
  validity: Validity;
  status?: DecisionStatus; // decision family only
  // Engine-managed decision-family fields (NOT user content; exempt from the
  // content-immutability rule — they carry lifecycle/identity, not the decision):
  constitutional?: boolean; // ADR-0008: a constitutional rule (always-injected)
  adr_no?: number; // ADR-0009: human ordinal, stamped by the engine at merge-to-main
  created: string;
  updated: string;
}
