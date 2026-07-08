---
type: Decision
title: "ADR-0007: RFCs are `proposed` decisions, not a new entry type"
description: "RFCs are `proposed` decisions, not a new entry type"
status: "Accepted"
timestamp: 2026-06-01
---

# ADR-0007: RFCs are `proposed` decisions, not a new entry type

- **Status:** Accepted
- **Date:** 2026-06-01
- **Deciders:** operator + Claude

## Context

An RFC ("we should consider X") is a **pre-decision** proposal with a comment
period; an ADR ("we decided X") is post-decision. One RFC may spawn several ADRs.
The ASDLC framework treats RFC and ADR as distinct artifacts. The question: does
vfkb need a distinct RFC entry type? ADR-0004 gave `decision` a **status
lifecycle including `proposed`**, which changes the answer.

## Decision

An **RFC is a `decision` in `proposed` status** with an open comment period:

- **Comments** are role-attributed `related` entries (conflict-free under
  merge=union).
- **Options under discussion** live in the proposed decision's `rejected`/text.
- **Resolution:** flip to `accepted` (it *becomes* the ADR) or `superseded`/closed.
- An RFC that spawns **multiple** ADRs = separate decisions linking back via
  `refs.related`.
- **No new entry type** (honors D3c's deliberate five).

## Consequences

- **+** Essentially free given ADR-0004's lifecycle; keeps the 5-type taxonomy.
- **+** Comment appends are conflict-free (merge=union); the proposed→accepted flip
  is the natural RFC→ADR transition.
- **−** A genuinely multi-option RFC is modelled as one proposed decision carrying
  the options, rather than a first-class options structure. Acceptable for v1;
  revisit if the need proves heavy.

## Alternatives Considered

- **A distinct `rfc` entry type** — rejected (for v1): a new type against D3c and
  ASDLC's "earn their place"; the proposed-decision model covers the need.
- **Defer RFCs entirely** — rejected: near-free now, and useful for the ingest
  PM/architect roles.
