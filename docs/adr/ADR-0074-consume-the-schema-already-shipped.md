---
type: Decision
title: "ADR-0074: Specified, shipped, never read — wire the envelope and make the seam observable (accepts RFC-038)"
description: "Operator ratification of RFC-038. The unconsumed-schema pattern is accepted as a real, behavioural gap covering provenance.origin, refs.* and recorded_invalid_at — but NOT read-time key extraction, which is fully wired and deliberately designed. D5's envelope-coverage Brake is ratified and sequenced FIRST, and its credibility depends on being observed failing before anything it flags is wired. D2 (wire-or-delete recorded_invalid_at) is deliberately LEFT UNRULED and needs a separate operator ruling. Build status is tracked in #293, not here."
status: "Accepted"
timestamp: 2026-09-14
---

# ADR-0074: Specified, shipped, never read

- **Status:** Accepted (2026-09-14, operator ratification)
- **Build status — tracked in [#293](https://github.com/vilosource/vfkb/issues/293), not here.**
  Per `scripts/adr-lint.mjs` and brain gotcha `9653e77c09fc` ("ADR-0064 was false within a day of
  being written"), an ADR records a decision; build state is mutable and belongs in the tracker.
  Each clause's proof obligation is named below and binds whenever it is built.
- **Date:** 2026-09-14
- **Accepts:** [RFC-038](../rfc/RFC-038-consume-the-schema-already-shipped.md) — the full
  investigation, the per-instance write-site/read-site evidence, the rejected alternatives and
  the proof obligations live there and are not restated here.
- **Relates:** [ADR-0011](ADR-0011-envelope-richness.md) (the envelope that specified the dormant
  fields, and whose §Decision 4 put `commit` origin capture in the **v1-wires** column — the
  commitment this ADR finds unmet); [ADR-0070](ADR-0070-guards-that-can-fail.md) (a guard that
  cannot fail is not a guard — the reason D5 must be seen red first);
  [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md) /
  [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md) (what a proof must be);
  [ADR-0012](ADR-0012-two-stage-retrieval.md) / [RFC-003](../rfc/RFC-003-embedding-accuracy-mode.md)
  (the gated retrieval question D4 touches but does not open);
  [#261](https://github.com/vilosource/vfkb/issues/261) (ADR claims must cite something checkable)

## Decision

**1. The pattern is accepted as real and behavioural, covering three instances — not four.**
`provenance.origin` (written, only `tool_call` ever constructed, three of four kinds with no
producer), `recorded_invalid_at` (neither written nor read — dead in both directions), and
`refs.*` (a live `# Citations` renderer in `src/export.ts` reading fields `addEntry` never
writes). Read-time key extraction is **explicitly not an instance**: it is fully wired and was
deliberately designed that way, and counting it would have been the overclaiming #261 exists to
stop.

The common cause is accepted as stated: **no test can fail for an unused field.** The unit suite
asserts behaviour over data that exists, the type checker is satisfied by a declaration, and
`src/validate.ts` is deliberately lenient so an unpopulated field never trips it.

**2. D5 — the envelope-coverage Brake — is ratified and sequenced FIRST.** A deterministic check
that enumerates the optional fields of `KnowledgeEntry` and asserts, for each, that a write site
and a read site exist, with an explicit allowlist naming the ADR that defers any field left
dormant on purpose.

It goes first for the reason ADR-0070 §1 gives: **it must be observed failing against the tree as
it stands**, flagging the instances above *before* any of them is wired or allowlisted. A
coverage check first seen green proves nothing. The backlog this RFC found is the Brake's own
can-fail arm, and sequencing it first is what makes that evidence available rather than
retrospective.

**3. D3 — the `refs` write surface — is ratified, second.** Expose `files`, `commit` and
`related` on `kb_add` and `vfkb add`, construct them in `src/engine.ts`, validate them. Delete
`task_id` and `workplan_id`, which name a task model this repo does not have and have no
consumer. Second because the reader already ships and is already exercised by the cold-agent
export scenarios, so it is the clause whose value is observable end to end soonest.

**4. D1 — expose and render `provenance.origin` — is ratified, third**, with its guarantee stated
weakly and openly: vfkb has no transcript, so a `{kind:'commit', repo, sha, path, line}` is a
string whose referent nothing can check. **The shape is validated; the referent is documented as
unverifiable.** No event store is proposed or implied.

The sub-question of whether `verified` provenance should *require* an origin is **deliberately
not decided here.** It is a write-rejecting Brake, a different risk class from a field that
renders, and it should be ruled on after the surface exists and there is data on how often an
origin is actually available at write time.

**5. D4 — write-time keys — is ratified as proposed, which is: no build.** This ADR does not open
the gated S1/RFC-003 question, does not change the index, and does not amend the ratified ledger
at `docs/H4-DEVELOPMENT-ROADMAP.md`. Whether that ledger is re-ratified to name three candidate
resorts instead of two remains an explicit operator ruling, unmade. The S1 trigger has not fired,
and adopting a retrieval change on the strength of a source reading of another project would be
the speculative build the evidence-gated rule forbids.

**6. D2 — `recorded_invalid_at` — is LEFT UNRULED, and that is recorded rather than glossed.**
RFC-038 frames it as choose-one (wire or delete) and recommends delete; the operator's
ratification of the RFC did not carry a ruling on that clause, and this ADR does not manufacture
one. **The field's state is unchanged and the decision is outstanding.**

What is decided about it: *deferring it a third time without ruling is not acceptable as a
resting state.* It has been "consume-later" since ADR-0011 with no producer, while
`docs/FEATURES.md` continues to describe it as stored-awaiting-consumption — a claim the code
does not support. The next session that touches this ADR should obtain the ruling, not inherit
the deferral.

## Consequences

**Positive.** The envelope's unconsumed surface becomes visible rather than latent, and — once
D5 lands — a newly declared field must either be wired or be allowlisted with the ADR that defers
it. That converts a class of drift this repo has demonstrably not caught in two years of ADRs
into something a deterministic check catches at review.

**The ordering carries a cost, accepted.** D5 first means the earliest visible payoff is a red
check rather than a working feature. D3 would have shown value sooner. The trade is deliberate:
ADR-0070's lesson is that a guard first seen green is not evidence, and the only moment the
Brake's can-fail arm exists for free is *before* the backlog is cleared.

**Documentation debt is in scope for each clause, not separate.** `docs/FEATURES.md:105-109` and
`:289` describe `refs`, `origin` and `recorded_invalid_at` more generously than the code supports;
amending those lines rides whichever clause lands, and is not a substitute for any of them.

**Negative / accepted.** D1 ships an evidence pointer whose referent is unverifiable. That is
weaker than the foreign-key guarantee the trigger note observed in Apache Maka, and it is
accepted knowingly: Maka can enforce an FK because it owns a durable event table, and acquiring
one is a substrate change this repo has declined. Stating the weakness in the rendered output is
the mitigation; implying a guarantee the substrate cannot make is the failure mode avoided.

**Scope this ADR does not take.** No event store. No retrieval change. No envelope-breaking
change — every clause is additive except the deletion of never-written fields. No change to the
trust model, the decision lifecycle, or the injection filter's existing clauses. No claim about
Apache Maka's runtime: the trigger note records that Maka was never built or run, and nothing
here rests on it behaving as described.

## Proof

Per ADR-0029/ADR-0050, each clause carries its own obligation, specified in RFC-038 and binding
here whenever the clause is built. The obligations are enumerated against their clauses in
[#293](https://github.com/vilosource/vfkb/issues/293).

The one that governs the others: **D5 must be observed flagging `provenance.origin`,
`recorded_invalid_at` and `refs.*` before any of them is wired or allowlisted.** A coverage check
first run after the backlog is cleared proves nothing, and this ADR's central clause would be
unproven regardless of what the code does. That ordering constraint is a property of the decision,
not of its build state, which is why it is stated here rather than only in the tracker.
