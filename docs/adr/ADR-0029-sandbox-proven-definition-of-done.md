# ADR-0029: Definition of Done — a capability is proven by an agent-driven, sandboxed, e2e use-case simulation

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** operator + Claude
- **Generalizes:** [ADR-0023](ADR-0023-scenario-contract-first.md) (scenario-as-DoD, previously scoped to
  *agent-observable* features) → to **any epic / feature / capability**. Composes with
  [ADR-0022](ADR-0022-l4-evaluation-methodology.md) (the L4 harness + DEMONSTRATED bar),
  [ADR-0028](ADR-0028-sandbox-validate-auto-layer-wiring.md) (wiring smoke-gate), the Tier-0 probe
  practice, and the unit/integration pyramid. Origin: the 2026-06-29 decision-capture build (brain
  decision `01878285f562`) — the L4 scenario both *proved* the feature (3/3 vs 0/3) and *caught two real
  bugs* (a tagless-entry search crash; a sandbox repo-leak), exactly because a sandbox run can fail.

## Context

vfkb already proves things in isolation in pieces — unit tests (in-process), L4 scenarios (dockerized),
the wiring smoke-gate (throwaway sandbox), Tier-0 probes (pinned). But the *success criterion for
declaring a capability done* was only written down for one slice (ADR-0023: agent-observable features).
The recurring, hard-won lesson — most recently when decision-capture's sandbox run caught bugs that
testing-in-production would have shipped — is broader: **"done" must mean *proven, by observation, in an
isolated environment that mirrors the real one — before it touches the live system*.**

## Decision

**A capability is not "done" until its real use-case has been simulated end-to-end in a sandbox and
observed to succeed.** Concretely:

1. **Granularity = the capability, not the change.** This binds at the level of an **epic / feature /
   main group of tasks** that delivers a user- or agent-facing capability. Individual sub-tasks, refactors,
   comments, formatting, and pure-doc edits are **exempt** — they ride the inner gates (unit/integration).
   The gate is at the capability level, named in its ADR/RFC.

2. **The proof is an agent-driven, e2e use-case simulation** — an **L4 scenario**: *an e2e test, but
   driven by the agent to simulate the real use case*, exercising the capability the way it will actually
   be used (for vfkb, that almost always means a real agent against the real surface), not a unit of its
   parts. DEMONSTRATED per ADR-0022 (≥2/3 when probabilistic).

3. **It must be able to fail.** The simulation carries a baseline/negative case, a contrast, or is run
   RED-first — *a proof that cannot fail proves nothing* (it is the falsifiability that caught the
   decision-capture bugs).

4. **Four universal clauses** (hold for every proof form — unit, L4, wiring-gate, probe):
   **isolated** from the live/dogfooded system (never test in production) · **observed**, not self-reported
   (VERIFIED = observed) · **before** declaring done/promotion · **capable of failing** (clause 3).

5. **Proof form fits the capability.** Agent-facing → agent-driven L4 (the default for vfkb). Auto-layer
   wiring → the smoke-gate (ADR-0028). External contract → a Tier-0 probe. Structural invariants within
   the capability stay deterministic unit tests (ADR-0023 #4 / ADR-0022 #7) — they are the inner gate, not
   the capability-level success criterion.

6. **Enforcement is layered.** Deterministic gates (`npm test`, the wiring smoke-gate) are the **Brakes**
   where a rule can be mechanized; the capability-level e2e simulation is **discipline**, backstopped by
   this immutable ADR + the standing decision-capture rule (vfkb's own lesson: a prose rule with no Brake
   gets ignored — so the immutable ADR is the durable backstop).

## Consequences

- **+** One clear, falsifiable success criterion for "done" at the level that matters (the capability),
  unifying ADR-0022/0023/0028 + probes under a single DoD instead of scattered slices.
- **+** Forces "what's the real use-case, and how would I see it work *and* see it fail?" into the design —
  killing structurally-correct-but-purposeless or untested-in-anger features, and surfacing bugs on the
  feature that introduced them (the decision-capture evidence).
- **+** "Sandboxed + observed + can-fail" is the same discipline that prevents testing-in-production
  (ADR-0028) and asserting-not-observing (the VERIFIED rule).
- **−** A capability costs a metered, agent-driven sandbox run before it can be called done. Mitigated:
  it is once-per-capability, the inner unit loop stays the fast gate, and sub-task edits are exempt.
- **−** Some capabilities are only *fully* validated live/stochastically; mitigated by a deterministic
  skeleton first (ADR-0023) + the ≥2/3 bar.

## Alternatives Considered

- **Keep DoD scoped to agent-observable features (ADR-0023 only).** Rejected — leaves non-agent-observable
  capabilities and the broader "prove-in-sandbox-before-done" principle unwritten; the gap this closes.
- **Require a sandbox proof for *every* change.** Rejected by the operator — absurd for a typo/refactor;
  the gate belongs at the capability level, with inner gates for the rest.
- **A purely deterministic DoD (unit tests only).** Rejected — unit tests prove the parts, not that the
  capability works *in its real use-case* (ADR-0023's three delivery-gap findings; decision-capture's bugs).

## Related

[ADR-0023](ADR-0023-scenario-contract-first.md), [ADR-0022](ADR-0022-l4-evaluation-methodology.md),
[ADR-0028](ADR-0028-sandbox-validate-auto-layer-wiring.md). Canonical example:
`scenarios/decision-capture.mjs` (+ `scenarios/records/decision-capture.md`). Brain: decision
`01878285f562`.
