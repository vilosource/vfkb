---
type: Decision
title: "ADR-0065: Write-health loudness — a silent MCP-disconnect must never look like successful capture (accepts RFC-035)"
description: "Probe-first: a committed Tier-0 probe of what the agent actually observes when the plugin MCP server dies on current Claude Code gates every build step except the probe-independent floors — the injected CLI-fallback line (self-knowable quoted bundle path, ≈1 budget entry of cost) and the §2a unit check that the MCP handler maps every engine throw to an explicit tool error. Doctor write-probe round-trips a non-entries file in the brain dir (append-only forbids append-then-remove; a probe namespace would pollute the committed log). The MCP client pipe is named external per the ADR-0015 tier precedent — silent client swallowing is an upstream defect to file, not engine theater to build."
status: "Accepted"
timestamp: 2026-07-18
---

# ADR-0065: Write-health loudness — silent write-unavailability

- **Status:** Accepted
- **Date:** 2026-07-18 (operator ratification; RFC landed via PR #198 after a two-round
  adversarial review)
- **RFC:** [RFC-035](../rfc/RFC-035-write-health-loudness.md) — the full specification, the
  honesty notes (the OI incident predates the current wiring; the failure shape on the current
  stack is unknown until §0 observes it), and the layer-by-layer ownership taxonomy live there.
- **Fixes on build:** [#176](https://github.com/vilosource/vfkb/issues/176)
- **Relates:** [ADR-0064](ADR-0064-durable-capture-journal.md) / RFC-034 (whose journal makes
  the CLI fallback exactly as durable as the MCP path);
  [ADR-0015](ADR-0015-cross-harness-auto-layer.md) (the external-blocked tier precedent);
  [ADR-0051](ADR-0051-delivery-honesty.md) §3 (the quiet-success doctrine, applied to capture);
  [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md) ("external contract → a Tier-0
  probe").

## Decision

Accepted as specified in RFC-035 §0–§3: the §0 Tier-0 MCP-disconnect probe runs first and its
recorded findings gate §2's doctor write-probe shape and any §3 upstream escalation; §1 (the
injected CLI-fallback line) and §2a (the MCP error-mapping unit floor) are probe-independent
and buildable immediately.

## Build status — tracked in [#176](https://github.com/vilosource/vfkb/issues/176), not here

> **Maintainer-authorized correction, 2026-07-19.** This section previously asserted
> *"Decided, NOT yet built"* for the whole ADR. That is now wrong in **both** directions:
> §1 and §2a were built and shipped in plugin v0.11.0, while §0 and §2 remain unbuilt. A
> single frozen sentence cannot describe a decision that ships in parts. ADR-0001 forbids
> editing a decided body, so the operator made an explicit exception rather than leave the
> record misleading.
>
> **The lesson:** an ADR's status tracks the *decision's* lifecycle, never the
> *implementation's* — build state is mutable and belongs in the tracking issue, the roadmap,
> the brain, and machine-derived files. Enforced from now on by `scripts/adr-lint.mjs`.

The evidence rule this decision carries is unchanged and still binding: nothing here is
claimable as done until §0's probe record and the §1/§2a deterministic tests exist **and are
named** (ADR-0050/0051).
