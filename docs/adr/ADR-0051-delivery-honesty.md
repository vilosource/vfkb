---
type: Decision
title: "ADR-0051: Delivery is a capability, it is unproven, and saying so is mechanically enforced (amends ADR-0050)"
description: "Operator ruling (Reading B): ADR-0050's 'declared done or shipped' governs claims, not existence — so plugin releases may continue with the install/upgrade path unproven. The violation is silence. `--plugin-dir` is struck as an example of a 'real surface': it proves the capability, not its delivery. The disclosure is enforced by a deterministic release-gate Brake, not by prose."
status: "Accepted"
timestamp: 2026-07-09
---

# ADR-0051: Delivery is a capability, it is unproven, and saying so is mechanically enforced (amends ADR-0050)

- **Status:** Accepted (operator ruling, 2026-07-09 — "Reading B", ratified explicitly)
- **Date:** 2026-07-09
- **Amends:** [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md) — strikes one clause of
  *"What counts as the full gate"* and settles the scope of *"declared done or shipped"*.
  ADR-0050's body is **not edited** ([ADR-0001](ADR-0001-record-decisions-as-adrs.md)); only its
  status-pointer line records the amendment.
- **Accepts:** [RFC-024](../rfc/RFC-024-staleness-detection-and-delivery-honesty.md)
- **Relates:** [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md) (the DoD rule),
  [ADR-0022](ADR-0022-l4-evaluation-methodology.md) (DEMONSTRATED ≥2/3),
  [ADR-0045](ADR-0045-vfkb-claude-code-plugin.md) (the plugin being delivered),
  vfkb-claude-plugin PR #10 (the Brake this ADR cites, merged `9e3601e`)

## Context — a constitutional rule that named the wrong surface

ADR-0050 was written on the morning of 2026-07-09, after plugin v0.4.0 shipped on a 1-trial smoke
check. It made the sandboxed, agent-driven L4 constitutional. Hours later the same plugin version
was found to be **DEMONSTRATED 3/3 and simultaneously unreachable** — a live session answered
`Unknown command: /vfkb:brief`.

Both facts were true. The record was real and audited. The scenario author cut no corner; they
followed ADR-0050 exactly. ADR-0050's *"What counts as the full gate"* prescribes the
**real surface a user will use (for plugin capabilities: a real plugin load, e.g. `--plugin-dir`)**
— and `--plugin-dir` loads a plugin from a source tree. It bypasses the marketplace clone,
`marketplace.json` resolution, the version cache, `installed_plugins.json`, scope resolution, and
session-startup resolution. Every one of those is part of delivery. None of them was exercised.

A constitutional rule that names the wrong surface is worse than no rule: the gap becomes invisible
and nobody is at fault, because everybody complied.

Two things follow, and they are different in kind. One is a **defect** in ADR-0050's text. The
other is a **question only the operator could answer**, because it asks whether a rule he marked
non-negotiable binds harder than he meant it to.

## Decision

### 1. `--plugin-dir` is struck as an example of "the real surface a user will use"

A plugin loaded with `--plugin-dir` is a **development** surface. It proves the capability and
**not** its delivery. It remains correct for the inner loop and for per-capability L4s — the
`brief-skill` record stands, and `/vfkb:brief` genuinely works once installed. It may **not** be
cited as evidence that a plugin *installs*.

### 2. Delivery and upgrade are capabilities, distinct from the capabilities they carry

Neither is currently proven for this plugin. This is a statement about evidence, not about
suspicion: the install path has never been exercised end-to-end in a sandbox, so nothing is known
about it either way.

### 3. "Declared done or shipped" governs **claims**, not existence — Reading B

ADR-0050 says nothing user-facing may be *"declared done or shipped"* without a full L4. Read
literally, `or shipped` binds existence: every plugin release would freeze until the install-path
L4 is DEMONSTRATED. That is **Reading A**, and it was **rejected**.

**Reading B**, ratified by the operator: the clause governs what may be **claimed**. Delivery was
never *claimed* proven, so releases may continue with delivery unproven.

> **The violation is silence.** Every release note, ADR, and handoff MUST state that **delivery is
> unproven** until a delivery proof exists.

Reading A was rejected because it freezes the plugin over a defect class never observed, and
because the L4 that would unfreeze it is not immediately buildable — it is blocked on adopting
`claude plugin tag`, and the plugin repo has zero tags.

**This relaxes a rule marked non-negotiable.** It is relaxed by explicit operator ruling, on the
record, in an ADR — not by inference, not inside an unrelated amendment, and not silently. An
earlier draft of RFC-024 settled this question quietly, in passing, under a benign title; two
independent adversarial reviewers flagged it as a blocker on exactly that ground. Only the operator
may relax his own non-negotiable, and the ordinary amend precedents ([ADR-0016](ADR-0016-search-ranking-and-embedding-revisit.md)→[ADR-0012](ADR-0012-two-stage-retrieval.md),
[ADR-0024](ADR-0024-relabel-trust-on-promotion.md)→[ADR-0021](ADR-0021-auto-distill-and-curator.md))
are ordinary ADRs. None of them establishes that a **constitutional** rule may be relaxed by
ordinary amendment. This one was put as an explicit either/or and answered.

### 4. The disclosure is a Brake, not a promise

vfkb's founding lesson — the one that produced ADR-0050 that same morning — is that **a prose rule
with no Brake gets skipped**. Reading B *is* a prose rule: "always disclose." Left there, it decays
the first time someone cuts a release in a hurry, which is precisely how v0.4.0 shipped.

So the disclosure is enforced deterministically, in CI, by `scenarios/release-gate.mjs` in
vfkb-claude-plugin:

- The plugin repo carries a machine-readable delivery-status assertion, `DELIVERY-STATUS.json`,
  valued `unproven` or naming the record that proves it.
- The gate **derives** the true status from `scenarios/records/install-path.json` and **fails on any
  mismatch**. `unproven` with no disclosure in `README.md` fails. A hand-typed `proven` whose record
  is absent, version-mismatched, or carries a failing arm fails. A landed proof whose status was
  never flipped also fails.
- It flips to `proven` **automatically and only** when that record lands DEMONSTRATED and
  version-bound.

The status field is a **claim**; the record is the **evidence**; the gate believes only the
evidence. This is the same architecture as the existing Brake — verify committed evidence in CI,
never trust prose.

### 5. Corollary — the quiet-success trap

Where a delivery failure presents as a *successful* run lacking the capability (exit 0,
`is_error: false`, `"Unknown command"`), the predicate MUST be a **content assertion over the
output**. Exit status and error flags are **not admissible evidence** of delivery.

### 6. Corollary — a release-time gate cannot observe a consumer's stale clone

*Scoped narrowly, and deliberately so:* CI runs before any consumer exists, so no release gate can
detect that a particular consumer's marketplace clone never advanced. That specific failure mode is
a **detection** problem, owned by `vfkb doctor` (RFC-024 §1). This says nothing about other delivery
defects — packaging omissions, install failures, upgrade corruption — which a delivery gate *can*
catch, and for which one should be built when evidence warrants.

This ADR does **not** amend ADR-0022. Its ≥2/3 single-contrast rule is untouched.

## Consequences

- **Plugin releases continue.** The freeze of Reading A does not happen.
- **"The plugin installs" remains unproven**, and every release note must say so until the gated
  `install-path` L4 runs. This is now impossible to forget: CI fails the release without it.
- **The `brief-skill` record stands.** `--plugin-dir` proved the capability; that was always what it
  proved. What changed is the vocabulary — it may no longer be *called* the delivery surface.
- **A constitutional rule has been relaxed once, explicitly.** The precedent is narrow: an operator
  ruling, recorded as an ADR, with a Brake attached. It is not a precedent for relaxing
  constitutional rules by ordinary amendment, and it is emphatically not a precedent for doing so
  quietly.
- **`vfkb doctor` still cannot detect a stale clone.** RFC-024 §1 specifies the detector and its own
  agent-driven L4 (`scenarios/doctor-staleness.mjs`). Unbuilt; it is the remaining live work.
- **The `install-path` L4 stays gated** (RFC-024 §4). Building it now would be the speculative build
  CLAUDE.md forbids. Its trigger: a delivery or upgrade defect the packaging check cannot see.

## Evidence — the Brake was observed, not asserted

Per ADR-0050's own standard, and because this ADR's central claim is *"the disclosure is
mechanically enforced,"* that enforcement is observed:

- `scenarios/release-gate.selftest.mjs` drives the gate against 18 synthetic plugin trees and
  asserts each goes red: stale record, leaking contrast arm, missed model pin, legacy
  self-asserting record, deleted skill, unshipped agent, missing bundle, unparseable `hooks.json`,
  silent README, and four flavours of false proof claim — with **two green baselines**, so the reds
  are not vacuous.
- Observed in CI on `main` (run `29035013588`), not merely locally:
  `release-gate selftest passed: 18/18 cases (the Brake is connected)` followed by
  `release gate PASSED for plugin v0.4.0`.
- `release-gate` is a **required** status check on the plugin's `main` branch protection.
  Caveat, recorded rather than glossed: `enforce_admins` is `false`, so the Brake is mechanical for
  agents and advisory for the operator.

Per RFC-024 §2, these are structural invariants; ADR-0029 §5 routes their proof form to
deterministic tests, so they carry no L4 of their own. The gate verifies committed evidence — it
does not run the L4s, which are metered and need auth.

## Alternatives considered

- **Reading A — `or shipped` binds literally.** Freeze all plugin releases until the install-path
  L4 is DEMONSTRATED. Rejected by the operator: it freezes the plugin over a defect class never
  observed, and the unfreezing L4 is blocked on `claude plugin tag` adoption.
- **Amend ADR-0050 quietly inside a `--plugin-dir` fix.** This is what an earlier RFC-024 draft did.
  Rejected: it weakens a constitutional non-negotiable hours after the operator wrote it, under a
  benign title. Caught by adversarial review; the question was extracted and put explicitly instead.
- **Reading B with prose-only disclosure.** Rejected: it is precisely the un-braked prose rule that
  produced the v0.4.0 smoke-check release. The Brake is not optional to Reading B; it is what makes
  Reading B honest.
- **Record the delivery status in `plugin.json`.** Rejected: `plugin.json` is consumed by Claude
  Code against a schema we do not own. `DELIVERY-STATUS.json` is ours, and its absence is itself a
  gate failure.
