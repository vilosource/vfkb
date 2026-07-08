---
type: RFC
title: "RFC-005: Session continuity = a derived, append-only knowledge-continuity record (vfkb's half of the vtf/vfkb seam) — not a hand-written handoff slot"
description: "Session continuity = a derived, append-only knowledge-continuity record (vfkb's half of the vtf/vfkb seam)"
status: "Accepted → ADR-0020"
timestamp: 2026-06-25
---

# RFC-005: Session continuity = a derived, append-only knowledge-continuity record (vfkb's half of the vtf/vfkb seam) — not a hand-written handoff slot

- **Status:** Accepted → [ADR-0020](../adr/ADR-0020-session-continuity-record.md)
- **Date:** 2026-06-25
- **Deciders:** operator + Claude (accepted; build sequenced in the H4 roadmap)
- **Refines (on acceptance):** applies [D1](../DESIGN.md) (content-vs-work-state scope split;
  vfkb owns *knowledge handover*, vtf owns *work-state handover*) and extends
  [ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md) Tier A (session-start injection) +
  `SessionState`. Composes with [D7b](../DESIGN.md) auto-distill (the future ACE write side).
  Bounded by [ADR-0005](../adr/ADR-0005-injection-filters-stale.md) (don't surface stale),
  [ADR-0014](../adr/ADR-0014-index-freshness.md) (session state is derived/operational, not the
  committed record), and the no-secrets write-time lint.

## Context

vfkb's lineage solves session continuity *manually*: in mykb you run `kb work handoff "…"`
and the next session reads a `## Resume` block. That single hand-written slot has three
failure modes, and **this project hit all the damage of one in this very session**:

- **Forgotten** — a session ends with no handoff written (mykb explicitly warns "no handoff
  written" on `work stop`).
- **Stale** — it is a *single overwritten slot*; forget to update it and it actively lies.
  **Observed 2026-06-25:** vfkb's workspace "Active" line claimed the L4 cross-model eval
  was "16/22 in-progress, C4 remains" — but the records showed it **complete** (5 records,
  22 scenarios each, 2026-06-03). A stale prose slot outlived the truth and had to be
  ground-truthed away before any work could proceed.
- **Low-fidelity** — it captures what the author *remembered* to type, not what actually
  happened (which commits landed, which tests passed, what knowledge was added).

The instinct is to add a richer "handoff tier." That instinct is subtly wrong, and the fix
is already latent in vfkb's own design.

**Continuity is not one tier — it is the vtf/vfkb seam.** [D1](../DESIGN.md) splits any
artifact by *content vs lifecycle*: durable **knowledge** → vfkb; **work-state** → vtf
(vtaskforge). The D1 ownership table is explicit — vfkb holds *"distilled **knowledge
handover**,"* vtf holds *"**work-state handover**."* mykb conflates them because it is one
tool with workspaces. So a well-designed continuity model is **two records, not one**:

- *"I'm on step 3 of task X; next is Y; blocked on Z"* = **work-state** = vtf's Task/Session
  lifecycle. **Not vfkb's to own** (and references stay one-way vfkb→vtf — D1 constraint 1).
- *"While doing this I learned gotcha G; decided D; added/used/superseded these entries"* =
  **durable knowledge** = vfkb's, and is exactly what [D7b](../DESIGN.md) auto-distill
  produces.

vfkb already holds the seed of its half: `SessionState` (`src/session.ts`) is keyed by
`KB_SESSION_ID` (the mykb L4 scar — a single global pointer let concurrent sessions clobber
each other), persisted at `<brain>/.sessions/<id>.json`, surviving restart — but today it
carries only `{ injectedIds, turnCount }`.

## Decision

vfkb builds **its half** of session continuity: a *derived, append-only knowledge-continuity
record* plus a session-start "resume" render. It does **not** build a work-state tracker.

1. **Own the seam explicitly; build only the knowledge half (in-repo, no vtf needed).** The
   work-state half stays vtf's (parked under H2). vfkb's record references vtf work-state by
   string only, one-way ([D1 constraint 1](../DESIGN.md)). This keeps the active frontier
   (H4, in-repo) honest and stops a work-state tracker leaking into vfkb.

2. **Derived, not dictated.** The continuity record is *computed from ground truth* —
   the entries added / used (injected or pulled) / superseded this session, the Tier-B
   captured tool calls, and optionally caller-supplied signals (commit shas, test verdicts)
   passed in, never invented. This is the structural fix for the *stale* failure: a derived
   "L4: 5 records, last run 2026-06-03" cannot rot the way a forgotten prose line did.

3. **Append-only record LOG, not a single overwritten slot.** Grow `SessionState`
   (`<brain>/.sessions/<id>.json`) from `{ injectedIds, turnCount }` into a per-session
   record (timestamps, counts, the derived digest, the optional intent note). Records
   accumulate one-per-session-id and are **never clobbered** — the trajectory is legible, not
   just the latest overwrite. (This is operational/derived state — gitignored per
   [ADR-0014](../adr/ADR-0014-index-freshness.md); it is **not** the committed brain SoR.)

4. **Auto-captured, manual-augmentable.** Default fully automatic, so the basics survive even
   when the operator forgets (kills the *forgotten* failure). An **optional** explicit `next:`
   / intent note rides along — the one thing only the human knows ("next: run the live
   smoke") — so deliberate breadcrumbs are still possible but never *required*.

5. **Carry verified-vs-asserted provenance.** The record distinguishes **observed** facts
   (derived: "12 entries added; 3 tool calls captured; tests green at `abc123`") from
   **asserted** intent (the operator's free-text note). This is the same discipline whose
   absence produced the stale-L4 claim — encoded into the artifact, not left to prose tone.

6. **"Resume" is a render, not a stored blob.** The next-session ramp-up view is a **Tier-A
   session-start injection** ([ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md))
   rendering the latest knowledge-continuity record (+ a vtf work-state pointer *when* vtf is
   wired). It obeys [ADR-0005](../adr/ADR-0005-injection-filters-stale.md) (exclude stale,
   label unverified) and the 10k-char Tier-A budget. Both faces get it; a thin
   `kb_resume` / CLI command exposes the same render on demand (the MCP-pull floor).

7. **Compose with auto-distill (D7b), don't pre-empt it.** The *knowledge* half of continuity
   *is* what auto-distill writes (gotchas/decisions distilled from the session into `incoming`);
   the session record is the **session-scoped index over that**, plus the operational counts.
   A phased build is fine: (a) the append-only record + derived digest + resume render first;
   (b) richer auto-distilled knowledge later, when D7b/ACE lands. This RFC decides the
   **shape**; it does not require ACE to ship first.

8. **Proposed, comment period open** ([ADR-0007](../adr/ADR-0007-rfc-is-proposed-decision.md)).
   In-repo and directly actionable, but not built until accepted.

## Consequences

- **+** Structurally defeats the three handoff failures: *derived* (can't go stale),
  *append-only* (can't be clobbered, trajectory legible), *automatic* (can't be forgotten).
  The exact bug that opened this session would not have survived a derived record.
- **+** Reuses what exists: `SessionState` + `KB_SESSION_ID` isolation + Tier-A injection +
  the zones/provenance envelope. No new storage model, no native dep, no vtf dependency.
- **+** Keeps the D1 seam clean: vfkb stays a *knowledge* product; work-state stays vtf's.
  When vtf is wired (H2), the resume render simply joins in the work-state pointer.
- **+** Encodes verified-vs-asserted into the artifact — a faithful-reporting backstop.
- **−** A per-session record log grows under `.sessions/`; needs a retention/compaction policy
  (e.g. keep last N, or roll up). Bounded — it is derived, gitignored, and rebuildable.
- **−** "Derived from ground truth" is only as good as the signals fed in; commit/test signals
  must be passed by the harness (the engine can't observe git on its own). Mitigated — counts
  of entries added/used/superseded are fully engine-internal; external signals are optional
  enrichment, clearly labelled asserted-by-caller.
- **Neutral:** the work-state tracker, vtf wiring, and the full ACE write side are all out of
  scope here — this decides the seam and builds vfkb's knowledge half only.

## Alternatives Considered

- **Port mykb's manual `kb work handoff` slot as-is.** Rejected — reproduces all three
  failures (forgotten / stale / low-fidelity); the stale-L4 incident is the live proof.
- **Build a full work-state/task tracker inside vfkb.** Rejected — violates
  [D1](../DESIGN.md) (work-state is vtf's), breaks the one-way vfkb→vtf reference direction,
  and couples vfkb to a product it is meant to stay agnostic of.
- **One overwritten "latest handoff" entry.** Rejected — re-introduces the clobber failure
  and erases the trajectory; the `KB_SESSION_ID` isolation work (mykb L4) exists precisely to
  stop single-slot clobbering.
- **Commit session records to git as brain knowledge.** Rejected — they are session-scoped,
  derived, operational state ([ADR-0014](../adr/ADR-0014-index-freshness.md) keeps the index/
  derived state out of the committed SoR). Durable lessons belong in `entries.jsonl` via
  auto-distill, not in the session log.
- **A pure-LLM "summarize the session" each time.** Rejected — non-deterministic; it can omit
  or hallucinate the very ground-truth (did L4 actually run?) that continuity must preserve.
  The record is *derived* from ground truth; an LLM may *augment* the human-readable digest,
  never *author* the facts.

## Related

[D1](../DESIGN.md) (content-vs-work-state seam; vfkb=knowledge handover, vtf=work-state
handover; one-way reference), [D7b](../DESIGN.md) (auto-distill — the ACE write side this
composes with), [ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md) (Tier A session-start
injection; Tier C `SessionState` dedup), [ADR-0005](../adr/ADR-0005-injection-filters-stale.md)
(the resume render must exclude stale / label unverified),
[ADR-0014](../adr/ADR-0014-index-freshness.md) (session state is derived, not committed),
[ADR-0007](../adr/ADR-0007-rfc-is-proposed-decision.md) (this RFC's status model),
[ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) (vfkb's own brain — the first place a
self-hosted resume render would be exercised). Code: `src/session.ts` (`SessionState`,
`KB_SESSION_ID`, `<brain>/.sessions/`), `src/engine.ts` (`renderContextBundle` Tier-A,
`renderContextDelta`, `captureToolCall`). Evidence: the 2026-06-25 stale-L4 workspace-state
incident; mykb `kb work handoff` failure modes.
