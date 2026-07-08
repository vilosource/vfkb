---
type: Decision
title: "ADR-0042: Schema honesty — structural `why`, envelope validation, `contradicts` (accepts RFC-017)"
description: "Schema honesty — structural `why`, read-boundary envelope validation, `contradicts` field (accepts RFC-017)"
status: "Accepted"
timestamp: 2026-07-06
---

# ADR-0042: Schema honesty — structural `why`, envelope validation, `contradicts` (accepts RFC-017)

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** operator + Claude
- **Accepts:** [RFC-017](../rfc/RFC-017-schema-honesty.md) **as corrected** — the original
  "`--why` is a no-op" claim was false (fixed 2026-06-30, commit `5ff56fc`); the accepted decision
  is the narrower, true one: `why` works as folded prose but has no structural field.
- **Relates:** [ADR-0011](ADR-0011-envelope-richness.md) (the envelope this extends),
  [ADR-0037](ADR-0037-contradiction-surfacing-at-write.md) (consumes the `contradicts` field),
  [ADR-0036](ADR-0036-v2-two-branch-strategy.md) (**builds on `v2`**).

## Context

Three verified gaps: (1) `why` survives CLI → MCP → storage only as a `"Why: …"` line folded into
`text` — not queryable/renderable independently; (2) only `tags` got a defensive read-boundary
default after a tagless entry crashed `index-store.ts` — other optional fields are unguarded
against entries that enter `.vfkb` outside vfkb's write path (external projections, hand edits);
(3) contradiction relationships are prose-only — ADR-0037's detector has no structural field.

## Decision

1. **A real `why?: string` field** on the decision-family envelope, additive alongside the working
   `foldWhy` text convention (which keeps passing unchanged).
2. **Whole-envelope validation at the read boundary** (zod, already a dep): safe documented
   defaults for malformed/missing fields; entries failing validation surface as a distinct,
   clearly-tagged state instead of crashing the caller. Read-boundary, because it is the one place
   that sees every entry regardless of origin.
3. **A structural `contradicts?: string[]` field** alongside `supersedes`, so contradiction
   detection reads/writes real references.

## Definition of Done

Unit tests only (structural invariant — no L4 scenario): `why` lands structurally and survives the
full path with the text convention unregressed; a deliberately malformed entry crashes no read
path; a `contradicts` reference surfaces through `kb_get`/`kb_search`.

## Consequences

- Rationale becomes a first-class value for rendering/search; ADR-0037 and any index work get
  structural hooks instead of prose-sniffing.
- The read boundary stops trusting its input — externally-projected brains (vfwb) stop being a
  crash risk.
- The malformed-state surfacing shape (silent default vs. visible marker) is a build-time call,
  leaning visible. **Builds on `v2`** (envelope change — breaking allowed there).
