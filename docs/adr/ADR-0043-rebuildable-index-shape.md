---
type: Decision
title: "ADR-0043: Rebuildable index — shape ratified, build evidence-gated (accepts RFC-018)"
description: "Rebuildable index — shape ratified, build evidence-gated (accepts RFC-018; trigger settled)"
status: "Accepted (shape) — **build GATED** (see trigger below)"
timestamp: 2026-07-06
---

# ADR-0043: Rebuildable index — shape ratified, build evidence-gated (accepts RFC-018)

- **Status:** Accepted (shape) — **build GATED** (see trigger below)
- **Date:** 2026-07-06
- **Deciders:** operator + Claude
- **Accepts:** [RFC-018](../rfc/RFC-018-rebuildable-index.md) on its own revised terms:
  ratify-shape-but-gate-build, the same pattern as RFC-003.
- **Relates:** [ADR-0014](ADR-0014-index-freshness.md) (whose content-hash check this deliberately
  does **not** reuse — see Decision), [ADR-0019](ADR-0019-self-hosted-design-brain.md) (JSONL stays
  the source of truth), [ADR-0044](ADR-0044-storage-backend-abstraction.md) (shares the seam),
  [ADR-0013](ADR-0013-no-hard-native-dep.md) (constrains any SQLite-mirror implementation).

## Context

`readAll()` re-parses the whole log on every call — correct (always fresh) but linear. The honest
evidence check: this repo's brain is ~126 entries, no observed slowness, no consumer near 1,000.
The weakest-evidenced item in the v2 batch, so the build waits for evidence, per the repo's own
evidence-gated-builds rule.

## Decision

- **Shape (ratified now):** `entries.jsonl` stays the single committed source of truth (ADR-0019
  unchanged). The index is derived, gitignored, rebuildable — like `index-meta.json`, but a real
  queryable structure. **Invalidation model: incremental, append-offset-based parsing** (parse only
  bytes past the last-read offset; fold into the in-memory structure) — explicitly **not**
  ADR-0014's content-hash check, which itself requires the full parse the index exists to avoid.
- **Build (gated). Trigger — settled here, as RFC-018's open item required:** build when **(a)** a
  real consumer reports observed read-path slowness, **(b)** a real brain crosses **10,000
  entries**, or **(c)** the operator explicitly requests it. Until then: no build.

## Definition of Done (applies when the build triggers)

A benchmark at ≥10,000 entries showing materially faster lookups than the linear scan, and the
full existing read-path test suite passing unchanged (refactor-safety contract).

## Consequences

- The design exists when the evidence arrives; nothing is built speculatively.
- The concrete structure (in-memory vs. SQLite-family mirror, ADR-0013-constrained) is compared at
  build time; session-attribution queries (ADR-0039) are assessed then too.
