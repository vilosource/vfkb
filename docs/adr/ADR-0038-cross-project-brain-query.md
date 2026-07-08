---
type: Decision
title: "ADR-0038: Cross-project brain query — read-only recall from a sibling `.vfkb` (accepts RFC-013)"
description: "Cross-project brain query — read-only, provenance-labeled recall from a registered sibling `.vfkb` (accepts RFC-013)"
status: "Accepted"
timestamp: 2026-07-06
---

# ADR-0038: Cross-project brain query — read-only recall from a sibling `.vfkb` (accepts RFC-013)

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** operator + Claude
- **Accepts:** [RFC-013](../rfc/RFC-013-cross-project-brain-query.md) (full analysis and
  alternatives live there — this ADR records the decision).
- **Relates:** [ADR-0019](ADR-0019-self-hosted-design-brain.md) (the brain travels with its repo —
  the property this exploits), DESIGN.md D2c/D2d/D2g (per-project tier; project knowledge is read
  locally), [ADR-0018](ADR-0018-honest-no-match-contract.md) (honest errors),
  [ADR-0033](ADR-0033-session-end-continuity.md) (unaffected — auto-commit is pathspec-scoped).

## Context

An agent in Project A that has cloned Project B should recall B's committed `.vfkb` knowledge
instead of re-deriving it from B's source. The CLI half already works today via `VFKB_DATA_DIR`
override (verified — `brainDir()` resolves fresh per call); the real gap is **in-session**: the MCP
server is pinned to A's brain at spawn, so the nine `kb_*` tools cannot reach B. This is D2d's
local-read pattern pointed at a sibling brain — explicitly **not** the parked H3 global tier.

## Decision

A read-only, provenance-labeled recall surface for **registered** sibling brains:

1. **Links registry `.vfkb/links.json`** (committed) — logical name → path, resolved relative to
   A's repo root; managed by `vfkb link add|list`. Agents pass names, never raw paths.
2. **One dedicated read-only surface** — `kb_query_external` (MCP, tool #10) /
   `vfkb query --source <name>` (CLI). Recall only (`search`/`map`/`context`/`get`); **no write
   verbs exist on this surface** — read-only is an API property, not a runtime check.
3. **Provenance labeling** — foreign results render with their source (`[projectB] …`), keep B's
   own roles/trust/staleness, and are never merged into A's brain.
4. **Implementation seam:** read functions take an explicit `brainDir` argument (small refactor)
   rather than mutating `process.env` per call — reentrant and fleet-safe.

## Definition of Done

Scenario-contract-first: **L4 `cross-project-recall`** — two seeded brains, B registered as a link;
the agent answers a B-only question with the `[projectB]` label and A's brain unchanged; contrast
arm (no link) cannot answer from knowledge. **RED on both harnesses before the build**,
DEMONSTRATED ≥2/3. Plus deterministic unit fixtures: resolver, source labeling, honest
no-match on unknown source, external-never-writes asserted.

## Consequences

- New committed artifact `.vfkb/links.json`; tool count 9 → 10; one new CLI verb pair.
- The trust boundary is explicit: B's entries are B's claims, surfaced honestly — a stale entry in
  B's brain is B's problem to supersede.
- Scope stays per-project (D2g): named local links between single-homed brains — no global store,
  no service, no promotion path.
