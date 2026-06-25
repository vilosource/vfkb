# RFC-006: Auto-distill + ACE curator — capture distils to `incoming`; curation is deltas + counters, never rewrites

- **Status:** Proposed
- **Date:** 2026-06-25
- **Deciders:** operator + Claude (proposed — comment period open)
- **Refines (on acceptance):** [D7b](../DESIGN.md) (passive capture → auto-distill, low-confidence →
  `incoming`) and [IMPL-PLAN L12](../IMPLEMENTATION-PLAN.md) (deltas-not-rewrites). Composes with
  [ADR-0020](../adr/ADR-0020-session-continuity-record.md) (feeds the resume digest — M3) and
  [RFC-003](RFC-003-embedding-accuracy-mode.md) (semantic dedup for the curator). Bounded by
  [ADR-0005](../adr/ADR-0005-injection-filters-stale.md), [ADR-0011](../adr/ADR-0011-envelope-richness.md)
  (derived trust / zones), [ADR-0013](../adr/ADR-0013-no-hard-native-dep.md), and the no-secrets lint.

## Context

vtfkb's knowledge gets in two ways today: **explicit writes** (`kb_add`) and **Tier-B passive
capture**, which currently logs only a dumb `"Tool X invoked"` `fact` into `incoming`
(`engine.captureToolCall`). As the fleet's write volume grows, two problems bite — the ones D7b and
[STATUS-AND-ROADMAP §3](../STATUS-AND-ROADMAP.md) name:
1. **Under-capture:** real lessons (an approach failed, this fixed it; a decision and its why) are
   *not* written unless someone remembers to. They evaporate — the same gap [ADR-0020](../adr/ADR-0020-session-continuity-record.md)
   closes for *continuity*, here for *durable knowledge*.
2. **Drift:** a growing brain accumulates duplicates, near-duplicates, stale entries, and noise that
   degrade retrieval — with no maintenance loop.

This is the **single riskiest H4 item.** A memory subsystem that *writes and edits itself* can, done
carelessly, **delete or corrupt good knowledge** — the worst failure a memory can have. mykb already
hit the specific trap ([L12](../IMPLEMENTATION-PLAN.md)): its curator **rewrote whole entries**, which
causes *context collapse* (rewriting silently degrades accumulated nuance and drifts the corpus). So
this RFC decides the **shape + the safety rails before any build**, per the design-first discipline.

The name **ACE** (Agentic Context Engineering) is the roadmap's shorthand for the pattern this adopts:
evolve the corpus by **incremental deltas + counters**, never wholesale rewrite.

## Decision

Two cooperating halves over the existing engine, both **non-destructive** and **containment-first**.

### A. Auto-distill — the write side (containment by zone)

1. **A pluggable `Distiller`** turns a session's signals (captured tool calls/results, the
   [ADR-0020](../adr/ADR-0020-session-continuity-record.md) session record) into **candidate** entries
   (gotchas/decisions/facts). v1 ships a **deterministic heuristic distiller** (e.g. a
   *failed-command → fixed-command* pair → a `gotcha`; an *error → resolution* → a `gotcha`); an
   **optional LLM distiller** slots behind the same seam ([ADR-0013](../adr/ADR-0013-no-hard-native-dep.md):
   opt-in, auto-detected, graceful-degrade; runs at **session-end / on-demand, NEVER on the always-on
   inject path**).
2. **Containment — distillation writes ONLY to `incoming`, `unverified`, agent-trust.** It can *never*
   write `established`/operator trust. A bad distillation therefore sits in `incoming`, is clearly
   trust-labelled, and is governed by [ADR-0005](../adr/ADR-0005-injection-filters-stale.md) (injected
   only if eligible, always labelled). The trusted set is never polluted by machine extraction.
3. **No self-pollution** — auto-distill keeps the existing skip of vtfkb's own `kb_*`/`mcp__vtfkb__*`
   tool calls (commit `31f4266`).

### B. The ACE curator — the maintenance side (deltas + counters, never rewrites)

4. **The curator NEVER rewrites an entry's text.** [L12](../IMPLEMENTATION-PLAN.md) hard rule. It acts
   *only* through the engine's existing non-destructive primitives: **supersede** (decisions),
   **status/zone transitions** (promote `incoming`→`established`, archive stale), **tombstones**
   (additive deletes), and **merge** (mark a duplicate, supersede/archive the loser). Every action is
   an **append**, fully auditable + reversible via git history ([D1 constraint 3](../DESIGN.md)).
5. **Counters are append-only signals aggregated at read — not mutated fields.** ACE "helpful/harmful"
   tallies (an entry was injected-and-used vs contradicted) are recorded as an **append-only signal
   stream** keyed by entry id and aggregated at score time; the entry envelope is never edited. This
   honours append-only JSONL + decision immutability ([ADR-0004](../adr/ADR-0004-decision-is-adr-grade.md)).
6. **Promotion requires corroboration, never a single distillation.** `incoming`→`established` needs ≥N
   independent signals (or a human) — auto-distill alone cannot mint trusted knowledge.
7. **Semantic dedup composes with [RFC-003](RFC-003-embedding-accuracy-mode.md):** when the embedding
   tier exists, the curator uses similarity to *propose* merges; absent it, dedup is lexical. Merges are
   always supersede/archive (delta), never a rewrite.

### C. Safety rails (the gate to build — this is why it is RFC'd, not just coded)

8. **Structural Brake** (per *structural-rules-need-a-Brake*): a deterministic test asserts the curator
   emits **only** add/supersede/transition/tombstone — **any in-place text edit fails the build**. A
   prose rule is not enough for an LLM agent; the rewrite ban must be machine-enforced.
9. **Retrieval-quality regression:** a curation pass must **not lower** retrieval quality on a fixed
   corpus (deterministic gate). 10. **Evidence-gated build:** *shape decided now;* build triggers when
   explicit-write volume is the bottleneck (D7b) — not speculatively.

## Consequences

- **+** Knowledge accrues without anyone remembering to write it; the brain gets a maintenance loop —
  while the **trusted set stays protected** (incoming-only distillation) and **good knowledge cannot be
  rewritten away** (Brake-enforced deltas).
- **+** Unlocks [ADR-0020](../adr/ADR-0020-session-continuity-record.md) **M3** (continuity Phase B): the
  resume digest gains real distilled lessons (from `incoming`, low-confidence labelled).
- **+** Reuses existing primitives (zones, supersede, transitions, tombstones, trust derivation) — no new
  storage model, no native dep, nothing on the hot path.
- **−** A counter/signal stream + a session-end distill pass to build and bound (retention/compaction).
  Accepted — both are append-only and derived.
- **−** An incoming queue that, untended, grows. Mitigated — the curator promotes/archives it; un-promoted
  candidates are clearly low-trust and ADR-0005-eligible only when labelled.
- **Neutral:** explicit `kb_add` and the trusted set are unchanged; this adds a *proposal* path beneath them.

## Alternatives Considered

- **Distil straight to `established`/operator trust.** Rejected — unverified machine extraction polluting
  the trusted set is the worst failure; containment-by-zone is the whole safety model.
- **Curator rewrites entries to "improve/merge" them.** Rejected hard — [L12](../IMPLEMENTATION-PLAN.md)
  context collapse; deltas + supersede preserve the archaeological record ([ADR-0001](../adr/ADR-0001-record-decisions-as-adrs.md)).
- **Mutate a usefulness counter field on the entry.** Rejected — fights append-only JSONL + immutability;
  use an append-only signal stream aggregated at read.
- **LLM-only distiller.** Rejected as the *sole* mechanism — non-deterministic; keep a deterministic
  default with an optional LLM, both `incoming`-only and off the hot path.
- **Enforce "no rewrites" by prose convention only.** Rejected — a behavioural rule an LLM curator will
  eventually ignore; it needs the deterministic Brake (rail 8).
- **Build now without an RFC.** Rejected — the riskiest item; shape + rails first ("runbook complete
  before execute").

## Related

[D7b](../DESIGN.md) (auto-distill capture), [IMPL-PLAN L12](../IMPLEMENTATION-PLAN.md) (deltas-not-rewrites,
counters), [ADR-0020](../adr/ADR-0020-session-continuity-record.md) (M3 consumer),
[RFC-003](RFC-003-embedding-accuracy-mode.md) (semantic dedup), [ADR-0005](../adr/ADR-0005-injection-filters-stale.md)
(inject labelled, not filtered-for-unverified), [ADR-0011](../adr/ADR-0011-envelope-richness.md) (zones +
derived trust), [ADR-0004](../adr/ADR-0004-decision-is-adr-grade.md) (supersede-only immutability),
[ADR-0013](../adr/ADR-0013-no-hard-native-dep.md) (optional/graceful-degrade distiller), [ADR-0001](../adr/ADR-0001-record-decisions-as-adrs.md)
(preserve the record). Code: `src/engine.ts` (`captureToolCall`, zones, `supersede`, `transitionDecision`),
`src/session.ts` (session signals). Roadmap: [H4-DEVELOPMENT-ROADMAP](../H4-DEVELOPMENT-ROADMAP.md) M2.
