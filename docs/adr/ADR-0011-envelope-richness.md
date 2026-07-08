---
type: Decision
title: "ADR-0011: Envelope v1 adopts a validity window + structured provenance origin; trust is derived"
description: "Envelope v1 adopts validity window + structured provenance origin; trust is derived (D-A)"
status: "Accepted"
timestamp: 2026-06-03
---

# ADR-0011: Envelope v1 adopts a validity window + structured provenance origin; trust is derived

- **Status:** Accepted
- **Date:** 2026-06-03
- **Deciders:** operator + Claude

## Context

vfkb is a greenfield reimplementation with mykb as the studied spike (ADR-0002).
mykb's own retrospective names **retrofitting the entry envelope its #1 v2 debt**
(`envelope-v2-DESIGN.md`): it had to add bi-temporal validity, a trust level, and
structured provenance after the fact. The implementation plan (§3 D-A) flags
deciding the envelope shape *now* as the way to avoid re-incurring that debt.

But the envelope-v2 delta is **narrower for vfkb than it was for mykb**, because
vfkb's schema v1 already carries more than mykb's v1 did:

- `author{role: architect|pm|executor|judge|human|init, id}` (D3a) — structured
  authorship (mykb had only free-text `provenance.source`).
- `provenance{status,date,source,detail}` with agent-default `unverified` (D3d).
- `refs{...,supersedes}` (D3b) — the supersession edge already exists.
- decision-family `status` lifecycle (ADR-0004).

Mapping mykb's three envelope-v2 enrichments against that:

| envelope-v2 enrichment | vfkb v1 already has | genuine gap |
|---|---|---|
| bi-temporal **validity window** | only `refs.supersedes` | **yes** — no `valid_from`/`valid_until` |
| **trust level** (operator/agent/import) | `author.role` (6 roles) + `provenance.status` | **no** — derivable, finer-grained |
| structured **provenance origin** | `refs.commit/files` (work-state linkage) | **partial** — `tool_call`/`message` capture surfaces absent |

vfkb's premises sharpen two of these: as an **ingest substrate** its thesis is
*re-verifiable* provenance (commit+sha+path+line from ingest, tool_call from passive
capture D7b), and as the memory **feeding agents** a stale fact that still injects is
the core failure mode (the Stark-FQDN incident; the recurring snapshot≠history bug).

## Decision

Adopt the two **genuine** gaps into schema v1; **derive** the third; **phase** the
consumption (schema-now / consume-later, mirroring mykb's own migration order).

1. **Bi-temporal validity window (add fields).** Add
   `validity{valid_from, valid_until?, recorded_invalid_at?}` to the envelope.
   `superseded_by` is **not** duplicated — it stays as `refs.supersedes` (the edge
   already exists). `valid_from` defaults to `created`.
2. **Structured provenance origin (add field).** Add
   `provenance.origin?` as a discriminated union:
   `{kind:'commit', repo, sha, path?, line?} | {kind:'message', thread_id, message_id} | {kind:'tool_call', tool, call_id} | {kind:'manual'}`.
   Free-text `provenance.source` is **retained** as the fallback. `origin` is
   distinct from `refs.commit` (which records *which vtf task touched the entry*,
   not *where the claim was observed*).
3. **Trust is derived, not stored.** No `trust` field. A `trust` projection
   (`operator | agent | import`) used by the ADR-0005 injection gate is computed:
   `author.role==human → operator`; `architect|pm|executor|judge → agent`;
   `init|imported → import`. `provenance.status` remains the orthogonal
   review/verification signal. This avoids a parallel field that can drift from
   `author`, and is finer-grained than mykb's flat trust enum.
4. **Phase the consumption (v1 vs deferred).**
   - **v1 wires:** `valid_until < today` exclusion folded into the ADR-0005
     injection filter (alongside superseded/deprecated/archive); `commit` and
     `tool_call` origin capture on ingest and passive capture.
   - **Deferred (stored-capable, not consumed in v1):** `recorded_invalid_at` and
     the retrospective-audit query ("what did we believe about X on date D") — that
     is global-tier / graph-backend territory (IMPL-PLAN §7); embedding-related
     fields (ADR-0012 / D-B).

## Consequences

- **+** Kills mykb's #1 retrofit debt at the source: the fields exist from schema
  v1, additive and cheap; only their *consumption* is phased.
- **+** Directly attacks the stale-injection failure mode (`valid_until` exclusion)
  and serves the ingest thesis (re-verifiable `origin`).
- **+** No redundant `trust` field to keep in sync with `author`; the derivation is
  one documented function the injection gate owns.
- **−** A derived trust projection must be recomputed wherever the gate runs (small,
  deterministic, and centralised in the read/injection layer).
- **−** `recorded_invalid_at` lands as a stored-but-unused field in v1 (accepted: a
  one-line schema cost vs a future migration).
- **Neutral:** `refs.supersedes` and the decision-family `status` lifecycle
  (ADR-0004) are unchanged; validity is additive to them.

## Alternatives Considered

- **Full mykb parity (explicit `trust` field, wire validity+trust gating fully in
  v1).** Rejected: an explicit `trust` enum is redundant with — and can drift from
  — vfkb's richer `author.role`; fully wiring bi-temporal audit queries over-builds
  the query layer before there is data to justify it (mykb's own phasing wisdom).
- **Minimal — add only `valid_until`, defer `origin` and trust entirely.** Rejected:
  re-incurs the structured-origin retrofit debt mykb proved costly, and under-serves
  vfkb's re-verifiable-provenance ingest thesis (the `tool_call`/`commit` origin is
  the point, not an extra).
