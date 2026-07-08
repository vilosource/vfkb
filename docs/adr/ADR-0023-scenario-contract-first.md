---
type: Decision
title: "ADR-0023: Agent-observable features are scenario-contract-first (the L4 scenario is the DoD, run RED before implementation)"
description: "Agent-observable features are scenario-contract-first — the L4 scenario is the DoD, run RED before implementation (invariants stay unit tests)"
status: "Accepted"
timestamp: 2026-06-27
---

# ADR-0023: Agent-observable features are scenario-contract-first (the L4 scenario is the DoD, run RED before implementation)

- **Status:** Accepted
- **Date:** 2026-06-27
- **Deciders:** operator + Claude
- **Origin:** the 2026-06-27 Track-4 build. The 2026-06-27 L4 coverage audit had already found that
  Track 1 (M1–M3) shipped with deterministic unit backstops but **zero** L4 (agent-level) coverage. Writing
  the Track-4 purpose-demonstration scenarios *after* the features shipped then surfaced **three real
  delivery gaps that the unit tests could not see** (below). The lesson generalises into process.
- **Applies / extends:** [ADR-0022](ADR-0022-l4-evaluation-methodology.md) (the L4 harness this governs the
  *use* of), the testing-pyramid / "deterministic backstop > probabilistic gate" principle
  ([H4-DEVELOPMENT-ROADMAP](../H4-DEVELOPMENT-ROADMAP.md) §5 P2). Bounded by ADR-0022 principle #7 (L4 tests
  purpose, not invariants).

## Context

vfkb's features split into two kinds. **Structural invariants** (the curator never-rewrite Brake,
append-only counters, supersession exclusion) are proved by **deterministic unit tests** — that is already
their contract, and ADR-0022 #7 keeps them there. **Agent-observable behaviour** (a real agent behaves
better *because of* a feature) is what the **L4 purpose-demonstration** scenarios exist to prove.

The failure mode the Track-4 build exposed: a feature can pass every unit test — its modules work — and still
**not be delivered to a real agent**, or be delivered with no observable effect. Unit tests check the parts;
they do not check that the part is wired to the agent on every harness. Three concrete gaps, all in
already-"done", unit-green Track-1 code, found only when the L4 scenario was finally written:

1. **Undelivered on a whole harness** — the pi extension injected only the live bundle, *not* the resume
   render, so ADR-0020 pt 5 (the resume render as the session-start injection) was never delivered on pi.
   A scenario run RED on pi would have caught this at M1.
2. **A capability that can't fire live** — pi's live extension captures tool calls at invocation, *without*
   the result, so a live pi session can never produce a `capture:error` and therefore can never auto-distill
   a failure. Unit tests of the distiller (fed synthetic captures) were green throughout.
3. **A claimed effect that isn't observable** — corroborated promotion (ADR-0021 §4) elevates the *zone* but
   not the agent-visible trust label, so "delivered as trusted" has no agent-observable signal. Writing the
   assertion first would have surfaced "this has no observable effect" at design time.

Each gap is the same shape: **the unit test proved the mechanism; only the scenario proved the purpose** —
and the scenario was written too late.

## Decision

For any **agent-observable** feature, the **L4 purpose-demonstration scenario is part of the
Definition of Done, authored as a contract and run RED before (or alongside) implementation** — not after.

1. **Name the contract in the ADR/RFC.** A feature spec for agent-observable behaviour must state, up front,
   the scenario that would prove it: *what does a real agent observably do differently because of this, and
   what is the `vfkb`-vs-baseline contrast?* If that question has no answer, that is a **design finding before
   any code** (corroborated-promotion is the proof: the answer was "nothing observable" — which is the
   relabel-on-promotion decision, surfaced at design time instead of after shipping).
2. **Write the scenario and run it RED first.** A red run proves the scenario exercises the *real* path and —
   critically — exercises it **on every harness**. A scenario green on claude but red on pi is a delivery gap
   caught at build time (gap #1 above), not weeks later.
3. **The deterministic unit test stays the fast inner gate.** Scenario-first does **not** replace it (P2). The
   unit test is the per-edit red-green loop; the L4 scenario is the **once-per-feature** purpose gate (it is
   live, stochastic, token-metered, minutes at N=3 — it cannot be a tight TDD loop, and must not be run like
   one).
4. **Scope: agent-observable behaviour only.** Structural invariants stay deterministic unit tests
   (ADR-0022 #7); they get **no** scenario (an L4 scenario for a structural rule is redundant — cf. the
   archive-zone exclusion already omitted from the harness as "table-stakes"). The rule is *scenario-first for
   agent-observable behaviour*, not *scenario-first for everything*.

## Consequences

- **+** Delivery gaps (undelivered-on-a-harness, can't-fire-live, no-observable-effect) are caught at build
  time, on the feature that introduced them, instead of by later archaeology. The three Track-4 findings would
  all have been M1/M2b-time failures.
- **+** Forces the "what's the agent-observable proof?" question into the design, killing structurally-correct
  but purposeless features early.
- **+** Composes with ADR-0022: the scenario is reproducible, dual-harness, multi-trial; "run RED on every
  harness" *is* the per-harness delivery check.
- **−** Higher up-front cost per agent-observable feature, and L4 runs are slow/metered — so the scenario is a
  once-per-feature gate, not an inner loop. Mitigated by keeping the deterministic unit test as the fast gate.
- **−** Some contracts can only be *fully* validated live (stochastic). Mitigated: author a deterministic
  skeleton/assertion first where possible (e.g. the seed→distill→resume chain was validated deterministically
  before the agent run), then confirm live.
- **Neutral:** does not change what any scenario asserts or how the harness runs (ADR-0022); governs *when*
  the scenario is written relative to the implementation.

## Alternatives Considered

- **Keep scenarios as post-hoc coverage (status quo before this ADR).** Rejected — it is exactly what let the
  three Track-1 gaps ship green; the audit + Track-4 build are the evidence.
- **Full TDD red-green-refactor on the live scenarios.** Rejected — live, stochastic, token-metered scenarios
  cannot be an inner loop; that role stays with the deterministic unit tests (P2).
- **Scenario-first for every feature, including structural invariants.** Rejected — redundant for invariants
  already proved deterministically (ADR-0022 #7); would bloat the metered L4 suite with non-differentiating
  scenarios (the archive-zone precedent).

## Related

[ADR-0022](ADR-0022-l4-evaluation-methodology.md) (the harness + the "purpose, not invariants" boundary),
[ADR-0020](ADR-0020-session-continuity-record.md) + [ADR-0021](ADR-0021-auto-distill-and-curator.md) (the
features whose gaps motivated this), [ADR-0019](ADR-0019-self-hosted-design-brain.md) (dogfood target).
Roadmap: [H4-DEVELOPMENT-ROADMAP](../H4-DEVELOPMENT-ROADMAP.md) §5 (standing principles) + Track 4 (the three
findings of record). Evidence: the 2026-06-27 Track-4 build — pi resume-render gap (fixed), pi
live-capture-result gap (logged), corroborated-promotion trust-render gap (logged).
