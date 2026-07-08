---
type: Decision
title: "ADR-0008: Constitutional rules = `constitutional`-flagged decisions + a derived Constitution"
description: "Constitutional rules = flagged decisions + a derived Constitution"
status: "Accepted"
timestamp: 2026-06-01
---

# ADR-0008: Constitutional rules = `constitutional`-flagged decisions + a derived Constitution

- **Status:** Accepted
- **Date:** 2026-06-01
- **Deciders:** operator + Claude

## Context

ASDLC separates two kinds of control: **Context Gates** ("the Brakes" —
*deterministic*, enforced regardless of LLM intent → vafi's judge + CI) and the
**Agent Constitution** ("the Driver" — *probabilistic* steering in the context
window → persistent directives the agent should honor). It also gives a precedence
hierarchy: **Constitution (rules/must-nots) → Product Vision (taste) → Specs
(contracts).** vfkb needs a model for the must-honor rules. ("Guardrails" is
deprecated precisely for conflating the Brakes and the Driver.)

## Decision

- A **constitutional rule is a `decision` flagged `constitutional`** — decision
  family, so immutable + supersede-able (ADR-0004), with full provenance.
- The **Agent Constitution "document" is a DERIVED aggregation** of all *active*
  constitutional decisions, rendered into the `NEVER/ASK/ALWAYS` Judgment
  Boundaries of the injected AGENTS.md, and **always auto-injected** (never
  filtered by ADR-0005, being current/established) as the "Driver."
- **Vocabulary (adopt across VFSF):** Constitution = the Driver (vfkb,
  probabilistic); Context Gates = the Brakes (vafi judge/CI, deterministic).
  **Retire "guardrails."**
- **No new entry type.** (Product Vision / taste is a *separate* concern — not this
  ADR.)

## Consequences

- **+** Must-honor rules get provenance, supersession, and always-on injection.
- **+** The rendered Constitution falls out as a **derived view** — same pattern as
  the Context Map (ADR-0006) and the rendered AGENTS.md.
- **+** Clean Driver/Brakes vocabulary removes the "guardrails" ambiguity.
- **−** Adds a `constitutional` flag + an aggregation/render step in the engine.

## Alternatives Considered

- **A distinct `constitution`/`principle` entry type** — rejected: new type against
  D3c and the lean-on-markers approach (ADR-0004/0007).
- **Just use `established`-zone decisions** — rejected: no always-on "MUST" framing
  and no derived Constitution document.
