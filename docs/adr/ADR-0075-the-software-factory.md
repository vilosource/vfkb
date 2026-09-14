---
type: Decision
title: "ADR-0075: The software factory — gates over agents, and the coder works offline (accepts RFC-039)"
description: "Operator ratification of RFC-039. GitHub Issues become the system of record with state in labels; the orchestrator is a dispatcher and admission-controller, not a supervisor; two new deterministic gates (tamper detection, reproduction gate) sit ABOVE an advisory cross-model reviewer. Three clauses were pre-ruled during design and are reaffirmed here: autonomous merge survives narrowed to admission-gated issues, the cross-model reviewer is advisory, and scope opens at cleanup/testing/refactoring only. NEW RULING: the coder's worktree gets NO network access, with dependencies pre-seeded — resolving RFC-039 §6 question 1, which blocked D5. Questions 2-4 remain open and are deliberately NOT decided here. Build status is tracked in #297, not here."
status: "Accepted"
timestamp: 2026-09-14
---

# ADR-0075: The software factory

- **Status:** Accepted (2026-09-14, operator ratification)
- **Build status — tracked in [#297](https://github.com/vilosource/vfkb/issues/297), not here.**
  Per `scripts/adr-lint.mjs` and brain gotcha `9653e77c09fc` ("ADR-0064 was false within a day of
  being written"), an ADR records a decision; build state is mutable and belongs in the tracker.
  Each clause's proof obligation is named in RFC-039 §5 and enumerated against its clause in #297,
  and binds whenever that clause is built.
- **Date:** 2026-09-14
- **Accepts:** [RFC-039](../rfc/RFC-039-the-software-factory.md) — the research, the per-claim
  evidence labelling, the rejected alternatives and the proof obligations live there and are not
  restated here.
- **Relates:** [ADR-0052](ADR-0052-review-gate.md) (the review gate whose record schema the
  factory's review stage writes into — automated, not replaced);
  [ADR-0070](ADR-0070-guards-that-can-fail.md) (a guard that cannot fail is not a guard — governs
  the two new gates and their ordering); [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md) /
  [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md) /
  [ADR-0051](ADR-0051-delivery-honesty.md) (what a proof must be, and that §3's quiet-success trap
  governs the D5 proof directly);
  [ADR-0067](ADR-0067-hybrid-credential-model.md) (the operator's Claude OAuth never leaves the
  laptop — already ratified, and independently forces the local-execution split);
  [ADR-0074](ADR-0074-consume-the-schema-already-shipped.md) (the immediately prior ADR, whose D5
  sequencing rule — a coverage check first seen green proves nothing — is reused verbatim here);
  [#261](https://github.com/vilosource/vfkb/issues/261) (ADR claims must cite something checkable)

## Decision

**1. The design is accepted as proposed: gates over agents.** RFC-039's central finding is
ratified as the constraint governing every clause — **the orchestrator's leverage is in what it
refuses to dispatch and what it deterministically verifies, not in how many agents it
coordinates.** The research found nothing supporting additional agents and a great deal supporting
additional gates, and the design is deliberately gate-heavy and agent-light as a result.

This also settles the shape the original request proposed. An orchestrator that *supervises* a
coding agent and a review agent is **not** what is being built; RFC-039 D3's dispatcher — which
re-observes GitHub and the worktree before advancing state and never trusts an agent's
self-report — is. The rejection of the supervising-orchestrator topology is recorded in
RFC-039 §3 and is part of what this ADR accepts.

**2. GitHub Issues become the system of record, with state in labels (D1).** One `fsm:` label at
a time. `docs/task-priority.md` is demoted to a generated projection; brain `handoff` facts keep
carrying narrative continuity and stop carrying task state. Projects v2 is rejected as the
substrate and may serve only as a human-facing view.

**3. D2 — the admission gate — is sequenced FIRST, and D8's two gates second.** Both deliver value
with **no coding agent in existence**, which is the reason for the order rather than a
coincidence of it. An issue that does not name acceptance criteria, its surfaces and its governing
ADR/RFC is returned with specific questions and is not dispatched.

D2 is also what makes clause 6 below meaningful, and the two must not be separated: **narrowing
the merge grant to admission-gated issues is worth nothing if the admission gate does not exist.**

**4. D8's two new gates must be observed RED before they are trusted.** Tamper detection against a
tree with a deleted test, an added `.skip` and a `|| true`; the reproduction gate against a test
that already passes at the merge base. This is ADR-0070 §1 applied exactly as ADR-0074's D5
applied it — a gate first seen green proves nothing, and the moment its can-fail arm is available
for free is *before* it is trusted, not after.

**5. [RULED] D6 — the cross-model reviewer is ADVISORY, never blocking.** `codexw` (Codex), in a
session that never saw the coder's transcript, charged to refute "done", emitting `file:line`
findings and never a numeric self-score, writing into the ADR-0052 record. It cannot block a merge.

The reasoning is on the record and is about measured judgement quality, not about Codex: an LLM
reviewer with blocking authority is the least defensible component available, given that GPT-4
self-critique waved through 84.45% of invalid work in the one controlled experiment on the
question. **The cross-model choice is separately motivated** (self-preference bias is
perplexity-driven, and context rot degrades a coder's own judgement) — but RFC-039 D6 labels the
load-bearing inference **UNVERIFIED**, because no cited paper tests cross-model evaluation as a
mitigation. **This decision does not depend on that inference being correct**, and that
independence is deliberate: it is what makes an unverified premise safe to build on.

**6. [RULED] D9 — autonomous merge survives, narrowed to admission-gated issues.** The standing
autonomous-PR grant (operator grant 2026-07-14, brain decision `5f380d6ca496`) is **not**
withdrawn. Under the factory it applies **only to issues that passed the D2 admission gate.**

This is recorded as a knowing divergence rather than an inherited default: every implementation
RFC-039 reviewed enforces the opposite rule, stated by `issue-orchestrator` as *"Agents cannot
merge PRs. Humans merge."* The operator's reasoning, on the record: the original grant was written
for PRs the operator had scoped personally, and unattended dispatch removes that step — so the
admission gate restores it, rather than the grant being withdrawn.

Unchanged: the ADR-0050/0051 DoD gate, the never-push-to-`main` rule, the ADR-0070 §4 escalation
when a round's blocking findings were introduced by the previous round's fixes, and the
requirement to call out an outward publish.

**7. [RULED] D10 — scope opens at cleanup, testing and refactoring only.** Bug fixes and
performance work stay human-dispatched until this repo has its own merge-rate data. **No published
benchmark may be used to size expectations**, per RFC-039 D10 — with OpenAI's own retraction of
SWE-bench Verified on the record, resolve rates carry no usable signal here.

**8. [NEW RULING] The coder's worktree gets NO network access, with dependencies pre-seeded.**
This resolves RFC-039 §6 question 1, which blocked D5.

RFC-039 §4 frames this as a trade — the isolation that prevents exfiltration is the isolation that
produced dotnet/runtime's 41.7% floor, where the agent *"couldn't compile, because firewall rules
blocked NuGet feeds."* **The ruling declines the trade rather than picking a side of it.** Seeding
a known-good `node_modules` into each worktree gives the agent a working build and test loop with
no egress path at all, and it is buildable here specifically because this repo **already does
exactly that**: `npm install` resolves against a corporate Nexus mirror and fails off-VPN, so the
working copy was bootstrapped by copying `node_modules` (gotcha on record). The constraint that
has been an irritant becomes the mechanism.

An allowlisted-egress alternative was rejected on the ground RFC-039 §4 already states: an
allowlist is a probabilistic control over an attacker-writable input, and *"in security, 95% is
very much a failing grade."*

**Accepted limitation, stated rather than discovered later:** an offline worktree cannot add a new
dependency. That is a real capability loss, it is accepted, and the correct response when it binds
is an explicit ruling to re-open this clause — not an ad-hoc hole punched in the isolation.

**9. RFC-039 §6 questions 2, 3 and 4 are NOT decided here**, and that is recorded rather than
glossed. They are: what surfaces a stalled orchestrator; whether the reviewer's advisory output
feeds the brain; and what the merge-rate instrument is.

**Question 4 carries a deadline that the others do not.** D10 makes our own merge and revert rate
the only valid instrument, and **a baseline cannot be retrofitted** — so it must be ruled before
dispatch begins, or D10's evidence standard becomes unmeetable in practice while still being
formally in force.

## Consequences

**Positive.** The repo's existing deterministic assets — `review-gate.mjs`, `adr-lint.mjs`, the two
hook guards with their `.selftest.mjs` siblings, ADR-0070's can-fail requirement and ADR-0052's
mutation logs — become the factory's verification layer rather than being duplicated by it. The
work is dispatch wiring around gates that already exist, which is a materially smaller build than
the original three-agent framing implied.

**The sequencing carries a cost, accepted.** D2 and D8 first means the earliest visible output is
a gate that refuses work, not an agent that produces it. The trade is deliberate and is the same
one ADR-0074 made: the admission gate is the clause with no counter-evidence anywhere in the
research, and the coding agent is the clause whose value every independent measurement disputes.

**A well-calibrated gate will reject correct work, and that is not a defect.** RFC-039 D12 records
the measured baseline — blinded maintainers merged only 68% of *human* gold patches. Rejection is
therefore appealable with a max-3-attempts cap, reusing ADR-0070 §4's escalation rather than
inventing a second one. A gate tuned never to reject correct work would accept everything.

**Negative / accepted.** The coder cannot add dependencies (clause 8). Availability is
laptop-grade: RFC-039 D4 accepts delay over loss, which holds **only** because state lives in
labels — an in-memory "already seen" cursor would silently reintroduce the edge-triggered failure
mode, and is forbidden rather than discouraged.

**Scope this ADR does not take.** No durable-execution engine. No change to the trust model, the
decision lifecycle, or the injection filter. No widening of the factory beyond the operator's own
issues. No claim that any relayed measurement in RFC-039 was independently re-verified — RFC-039
§1.2 states the opposite, and this ADR inherits that labelling rather than laundering it.

## Proof

Per ADR-0029/ADR-0050, each clause carries its own obligation, specified in RFC-039 §5 and
enumerated against its clause in [#297](https://github.com/vilosource/vfkb/issues/297).

Two govern the others:

**The D8 gates must be observed RED first.** A gate first run after the behaviour it checks is
already clean proves nothing, and the clause it supports would be unproven regardless of what the
code does. That ordering is a property of this decision, not of its build state, which is why it
is stated here and not only in the tracker.

**The D5 proof must be a content assertion over the output, never an exit status.** ADR-0051 §3's
quiet-success trap applies to it directly and unusually sharply: an agent that finds the gold diff
on another ref exits 0, reports success, and is indistinguishable from one that reasoned — the
failure presents as a *passing* run. Exit codes and error flags are not admissible evidence here.
