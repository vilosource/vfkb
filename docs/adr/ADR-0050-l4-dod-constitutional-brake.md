---
type: Decision
title: "ADR-0050: The sandboxed agent-driven L4 Definition of Done is constitutional and mechanically enforced (amends ADR-0029)"
description: "Operator ruling: nothing user-facing may be declared done/shipped without a full sandboxed, agent-driven, can-fail L4 (≥2/3, committed record, observed not asserted) — now a constitutional brain decision (injected every session) plus a deterministic release-gate CI Brake in every shipping repo, because the prose-only rule was observably skipped"
status: "Accepted"
timestamp: 2026-07-09
---

# ADR-0050: The sandboxed agent-driven L4 Definition of Done is constitutional and mechanically enforced (amends ADR-0029)

- **Status:** Accepted (operator ruling, 2026-07-09 — "non-negotiable")
- **Date:** 2026-07-09
- **Amends:** [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md) (the DoD rule itself is
  unchanged; this ADR changes its **enforcement** from prose to mechanism)
- **Relates:** [ADR-0022](ADR-0022-l4-evaluation-methodology.md) (DEMONSTRATED = ≥2/3, records),
  [ADR-0008](ADR-0008-constitution-tier.md) (the constitutional tier used here),
  [ADR-0023](ADR-0023-scenario-contract-first.md),
  [ADR-0045](ADR-0045-vfkb-claude-code-plugin.md) (the shipping repo that got the first Brake),
  vfkb-claude-plugin PR #9 (the first release-gate implementation)

## Context — the rule existed and was skipped anyway

ADR-0029 already said it: *a capability is not "done" until its real use-case is simulated
end-to-end in a sandbox and observed to succeed*, agent-driven, ≥2/3 trials, able to fail. On
2026-07-09 the agent released vfkb-claude-plugin v0.4.0 — a user-facing skill — and declared the
chain "closed" on a **1-trial smoke check with no committed scenario or record**, and with the
Layer 1 model pin **asserted from frontmatter rather than observed**. The operator caught it.

This is not a new failure mode; it is the failure mode this project has already named twice:
**"a prose rule with no Brake — an LLM may skip it"** (CLAUDE.md, on decision capture) and
**"deterministic backstop > probabilistic gate"** (the testing pyramid). End-of-chain momentum
("everything else shipped, this is the last piece") is precisely when the prose rule loses.
The fix is therefore not more prose or better intentions — it is *mechanism*.

## Decision

The ADR-0029 gate is restated as **non-negotiable** and enforced at three layers:

1. **Constitutional brain decision (recall layer).** The rule is recorded as a
   `constitutional`-flagged, accepted decision in this repo's brain (ADR-0008), so the
   Constitution section — always injected first, never budget-dropped, in **every** session —
   leads with it. Wording of record: *"No user-facing capability may be declared done or shipped
   without a full sandboxed, agent-driven L4: committed reproducible scenario, DEMONSTRATED
   ≥2/3 with a can-fail contrast, every load-bearing claim observed not asserted. Until then the
   only honest status is 'built, NOT yet verified'."*
2. **Deterministic release-gate Brake (enforcement layer).** Every repo that ships a user-facing
   artifact carries a CI check that **fails the PR** unless the committed L4 evidence matches
   what is being shipped. First implementation: vfkb-claude-plugin's `scenarios/release-gate.mjs`
   (+ GitHub Actions, PR #9) — required records must exist, be `demonstrated: true`, and carry
   `pluginVersion === plugin.json version`, so a version bump without a re-run goes red with no
   API/auth needed in CI. The gate itself was negative-checked (a synthetic bump fails it) — a
   gate that can't fail proves nothing. vfkb's own release surface (the bundles) gets the
   equivalent check when its release flow is next touched (tracked; the L4 suite re-pin rule of
   ADR-0022 already covers the engine).
3. **Language discipline (reporting layer).** "Done", "shipped", "✅", "complete" are reserved
   for capabilities whose L4 evidence exists and is named in the same breath. Anything else is
   reported as **"built, NOT yet verified"**. Relaying a gate's pass without having read its
   ground truth remains forbidden (the standing VERIFIED-means-observed rule).

## What counts as the full gate (restating ADR-0029 operationally)

- A **committed, reproducible scenario** (`scenarios/*.mjs`) driving the capability through the
  **real surface a user will use** (for plugin capabilities: a real plugin load, e.g.
  `--plugin-dir`; for engine capabilities: the real render/CLI/MCP surface).
- **Sandboxed** — isolated from the live/dogfooded system.
- **Agent-driven** where the capability is agent- or user-facing.
- **DEMONSTRATED ≥2/3** trials with a **can-fail arm** (contrast/RED/negative).
- **Observed, not asserted** — including side-claims (e.g. a pinned model must appear in
  `modelUsage`, not just in frontmatter).
- A **committed record** binding the evidence to the shipped version.

## Consequences

- Sub-tasks, refactors, docs, and formatting remain exempt (ADR-0029's scoping is unchanged);
  the gate binds at the capability level — *anything a user will use*.
- Releasing gains one honest cost: the L4 suite must be re-run when the shipped version changes.
  That cost is the product working as specified; it is not overhead to optimize away.
- The constitutional entry consumes a few lines of every session's injection budget. Accepted —
  it is the cheapest recurrence insurance this project has.
- The 2026-07-09 violation itself was closed the same day: `scenarios/brief-skill.mjs`
  DEMONSTRATED 3/3 vs 0/3 with the Haiku fork observed in `modelUsage` (plugin PR #9).
