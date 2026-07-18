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

## Status honesty (ADR-0050/0051)

**Decided, NOT yet built.** §0's probe record and the §1/§2a deterministic tests are the first
build artifacts; nothing here is claimable as done until they exist and are named.
