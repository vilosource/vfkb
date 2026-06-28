# ADR-0021: Auto-distill + ACE curator — capture distils to `incoming`; curation is deltas + counters, never rewrites

- **Status:** Accepted (Amended by [ADR-0024](ADR-0024-relabel-trust-on-promotion.md) — §4 corroborated promotion now also re-stamps provenance verified)
- **Date:** 2026-06-25
- **Deciders:** operator + Claude
- **Origin:** [RFC-006](../rfc/RFC-006-auto-distill-and-curator.md) (accepted; build sequenced in
  [H4-DEVELOPMENT-ROADMAP](../H4-DEVELOPMENT-ROADMAP.md) M2 — operator-cleared the D7b build gate).
- **Applies / extends:** [D7b](../DESIGN.md) (passive capture → auto-distill, low-confidence →
  `incoming`), [IMPL-PLAN L12](../IMPLEMENTATION-PLAN.md) (deltas-not-rewrites + counters). Composes
  with [ADR-0020](ADR-0020-session-continuity-record.md) (M3) and
  [RFC-003](../rfc/RFC-003-embedding-accuracy-mode.md) (semantic dedup). Bounded by
  [ADR-0005](ADR-0005-injection-filters-stale.md), [ADR-0011](ADR-0011-envelope-richness.md) (zones /
  derived trust), [ADR-0004](ADR-0004-decision-is-adr-grade.md) (supersede-only),
  [ADR-0013](ADR-0013-no-hard-native-dep.md), and the no-secrets lint.

## Context

Knowledge enters vfkb via explicit `kb_add` and dumb Tier-B capture (`"Tool X invoked"` →
`incoming`). As fleet write-volume grows, lessons go uncaptured and the brain drifts (dupes/stale).
This is the **riskiest H4 item**: a memory that writes/edits itself can *delete or corrupt* good
knowledge. mykb already hit the trap ([L12](../IMPLEMENTATION-PLAN.md)) — its curator **rewrote whole
entries** → context collapse. So the *shape + safety rails* are decided before any build.

## Decision

Two cooperating halves over the existing engine, both **non-destructive** and **containment-first**.

1. **Auto-distill (write side) — a pluggable `Distiller`** turns a session's signals into **candidate**
   entries written **ONLY to `incoming` / `unverified` / agent-trust** (containment — the trusted set
   is never polluted). v1 = a **deterministic** distiller; an **optional LLM** distiller slots behind
   the same seam ([ADR-0013](ADR-0013-no-hard-native-dep.md): opt-in, graceful-degrade, **never on the
   always-on inject path** — session-end / on-demand). Keeps the `31f4266` self-tool skip.
2. **ACE curator (maintenance side) — deltas + counters, NEVER rewrites text** ([L12](../IMPLEMENTATION-PLAN.md)).
   It acts only via the engine's non-destructive primitives: **promote** (`incoming`→`established`
   zone transition), **archive** (→`archive`), **supersede** (decisions), **merge** (mark a duplicate;
   supersede/archive the loser), **tombstone** (additive delete). Every action is an **append**,
   auditable + reversible via git ([D1 c3](../DESIGN.md)).
3. **Counters are append-only signals aggregated at read** — helpful/harmful tallies are recorded in an
   append-only stream keyed by entry id and summed at score time; the entry envelope is never edited.
4. **Promotion needs corroboration** (≥N independent signals or a human) — auto-distill alone cannot
   mint trusted knowledge. Dedup composes with [RFC-003](../rfc/RFC-003-embedding-accuracy-mode.md)
   (similarity proposes merges; absent it, lexical); merges are always supersede/archive, never rewrite.
5. **Safety rails (the load-bearing reason this is ADR'd):**
   (a) a **structural Brake** — a deterministic test asserts every curator op leaves entry **text
   byte-identical** (any in-place text edit fails the build); (b) a **retrieval-quality regression** — a
   curation pass must not lower retrieval quality on a fixed corpus; (c) **evidence-gated build** (D7b:
   write-volume bottleneck, or an explicit operator request).

## Consequences

- **+** Knowledge accrues without manual writes; the brain gets a maintenance loop — while the trusted
  set stays protected (incoming-only distillation) and good knowledge **cannot be rewritten away**
  (Brake-enforced). Unlocks [ADR-0020](ADR-0020-session-continuity-record.md) M3.
- **+** Reuses zones / supersede / transitions / tombstones / trust derivation — no new storage model,
  no native dep, nothing on the hot path.
- **−** A counter/signal stream + a session-end distill pass to bound (retention). Accepted — append-only,
  derived.
- **−** An `incoming` queue that, untended, grows. Mitigated — the curator promotes/archives it; it stays
  low-trust + ADR-0005-eligible only when labelled.
- **Neutral:** explicit `kb_add` and the trusted set are unchanged; this adds a *proposal* path beneath them.

## Alternatives Considered

- **Distil straight to `established`.** Rejected — unverified machine extraction polluting the trusted set
  is the worst failure; containment-by-zone is the safety model.
- **Curator rewrites/merges entries in place.** Rejected hard — [L12](../IMPLEMENTATION-PLAN.md) context
  collapse; deltas + supersede preserve the record ([ADR-0001](ADR-0001-record-decisions-as-adrs.md)).
- **Mutate a counter field on the entry.** Rejected — fights append-only + immutability; aggregate an
  append-only signal stream at read.
- **LLM-only distiller.** Rejected as the sole mechanism — non-deterministic; deterministic default +
  optional LLM, both `incoming`-only and off the hot path.
- **Enforce "no rewrites" by prose only.** Rejected — an LLM curator will eventually ignore prose; it
  needs the deterministic Brake.

## Related

[RFC-006](../rfc/RFC-006-auto-distill-and-curator.md) (origin), [D7b](../DESIGN.md),
[IMPL-PLAN L12](../IMPLEMENTATION-PLAN.md), [ADR-0020](ADR-0020-session-continuity-record.md) (M3 consumer),
[RFC-003](../rfc/RFC-003-embedding-accuracy-mode.md) (dedup), [ADR-0005](ADR-0005-injection-filters-stale.md),
[ADR-0011](ADR-0011-envelope-richness.md), [ADR-0004](ADR-0004-decision-is-adr-grade.md),
[ADR-0013](ADR-0013-no-hard-native-dep.md), [ADR-0001](ADR-0001-record-decisions-as-adrs.md).
Code: `src/engine.ts` (`captureToolCall`, zones, `supersede`, `transitionDecision`), `src/session.ts`.
Roadmap: [H4-DEVELOPMENT-ROADMAP](../H4-DEVELOPMENT-ROADMAP.md) M2 (M2a curator safety foundation → M2b distiller).
