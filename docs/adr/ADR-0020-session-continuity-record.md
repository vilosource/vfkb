---
type: Decision
title: "ADR-0020: Session continuity = a derived, append-only knowledge-continuity record (vfkb's half of the vtf/vfkb seam)"
description: "Session continuity = a derived, append-only knowledge-continuity record (vfkb's half of the vtf/vfkb seam)"
status: "Accepted"
timestamp: 2026-06-25
---

# ADR-0020: Session continuity = a derived, append-only knowledge-continuity record (vfkb's half of the vtf/vfkb seam)

- **Status:** Accepted
- **Date:** 2026-06-25
- **Deciders:** operator + Claude
- **Origin:** [RFC-005](../rfc/RFC-005-session-continuity-record.md) (accepted; build sequenced
  in [H4-DEVELOPMENT-ROADMAP](../H4-DEVELOPMENT-ROADMAP.md)).
- **Applies / extends:** [D1](../DESIGN.md) (content-vs-work-state seam),
  [ADR-0015](ADR-0015-cross-harness-auto-layer.md) (Tier-A injection + `SessionState`),
  [D7b](../DESIGN.md) (auto-distill). Bounded by
  [ADR-0005](ADR-0005-injection-filters-stale.md) and
  [ADR-0014](ADR-0014-index-freshness.md).

## Context

vfkb's lineage solves session continuity *manually* (mykb's `kb work handoff` → a `## Resume`
slot), which fails three ways: **forgotten** (no handoff written), **stale** (a single
overwritten slot that lies once outdated), **low-fidelity** (captures what the author recalled,
not what happened). This project hit the *stale* failure on 2026-06-25: a workspace "Active"
line claimed the L4 eval was "16/22 in-progress" when the records showed it complete — a stale
prose slot outlived the truth.

The fix is latent in vfkb's design: continuity is **not one tier — it is the vtf/vfkb seam**.
[D1](../DESIGN.md) splits *content vs work-state*: vfkb owns *knowledge handover*, vtf owns
*work-state handover*. mykb conflates them because it is one tool. `SessionState`
(`src/session.ts`, keyed by `KB_SESSION_ID`, persisted at `<brain>/.sessions/<id>.json`) is the
seed of vfkb's half — it carries only `{ injectedIds, turnCount }` today.

## Decision

vfkb builds **its knowledge half** of session continuity; it does **not** build a work-state
tracker (that stays vtf's, referenced one-way by string — [D1 constraint 1](../DESIGN.md)).

1. **Derived, not dictated** — the record is computed from ground truth (entries added / used /
   superseded this session + Tier-B captured tool calls; optional caller-supplied commit/test
   signals, labelled asserted). This is the structural fix for *stale*.
2. **Append-only per-session record log** — grow `SessionState` into a per-session record;
   records accumulate one-per-session-id and are never clobbered (the trajectory is legible).
   Operational/derived state under `.sessions/`, gitignored ([ADR-0014](ADR-0014-index-freshness.md)),
   **not** the committed brain SoR.
3. **Auto-captured, manual-augmentable** — automatic by default (kills *forgotten*), with an
   optional explicit `next:` / intent note for the one thing only the human knows.
4. **Verified-vs-asserted provenance** — the record separates *observed* (derived counts/facts)
   from *asserted* (the operator's free-text intent).
5. **"Resume" is a render, not a stored blob** — a Tier-A session-start injection
   ([ADR-0015](ADR-0015-cross-harness-auto-layer.md)) of the latest record (+ a vtf work-state
   pointer when vtf is wired), obeying [ADR-0005](ADR-0005-injection-filters-stale.md) and the
   10k-char budget; a thin `kb_resume` exposes the same render on the MCP-pull floor.
6. **Composes with auto-distill (D7b)** — the knowledge half *is* what auto-distill writes; the
   record is the session-scoped index over it. Phased build (see roadmap): (a) record + digest +
   resume render first; (b) auto-distilled knowledge later.

## Consequences

- **+** Structurally defeats forgotten/stale/clobbered; the 2026-06-25 bug could not have
  survived a derived record. Reuses `SessionState`, `KB_SESSION_ID` isolation, Tier-A injection,
  and the provenance envelope — no new storage model, no native dep, no vtf dependency.
- **+** Keeps the D1 seam clean (vfkb stays a knowledge product); encodes verified-vs-asserted
  into the artifact.
- **−** A per-session log needs a retention/compaction policy (bounded — derived, gitignored).
- **−** "Derived" is only as rich as the signals fed in; engine-internal counts are free, external
  commit/test signals are optional, caller-supplied, and labelled asserted.
- **Neutral:** work-state tracking, vtf wiring, and the full ACE write side are out of scope here.

## Alternatives Considered

- **Port mykb's manual handoff slot as-is** — rejected (reproduces all three failures; the
  stale-L4 incident is the proof).
- **Build a work-state tracker inside vfkb** — rejected (violates [D1](../DESIGN.md); breaks the
  one-way vfkb→vtf reference; couples vfkb to a product it must stay agnostic of).
- **One overwritten "latest handoff" entry** — rejected (re-introduces clobber; the
  `KB_SESSION_ID` isolation work exists to prevent exactly this).
- **Commit session records to git as knowledge** — rejected ([ADR-0014](ADR-0014-index-freshness.md):
  derived state stays out of the SoR; durable lessons go to `entries.jsonl` via auto-distill).
- **Pure-LLM "summarize the session"** — rejected (non-deterministic; may omit/hallucinate the
  ground truth continuity must preserve; the LLM may *augment* the digest, never *author* facts).

## Related

[RFC-005](../rfc/RFC-005-session-continuity-record.md) (origin), [D1](../DESIGN.md),
[D7b](../DESIGN.md), [ADR-0015](ADR-0015-cross-harness-auto-layer.md),
[ADR-0005](ADR-0005-injection-filters-stale.md), [ADR-0014](ADR-0014-index-freshness.md),
[ADR-0019](ADR-0019-self-hosted-design-brain.md) (vfkb's own brain — first place the resume
render is dogfooded), [H4-DEVELOPMENT-ROADMAP](../H4-DEVELOPMENT-ROADMAP.md) (build sequencing).
Code: `src/session.ts`, `src/engine.ts` (`renderContextBundle`, `renderContextDelta`,
`captureToolCall`). Evidence: 2026-06-25 stale-L4 incident; mykb `kb work handoff` failure modes.
