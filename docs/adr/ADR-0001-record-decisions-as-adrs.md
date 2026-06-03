# ADR-0001: Record vtfkb architecture decisions as immutable ADRs

- **Status:** Accepted
- **Date:** 2026-06-01
- **Deciders:** operator + Claude

## Context

vtfkb is a generational reimplementation in a lineage (OSB → mykb → vtfkb) where
each step improves on its predecessor by carrying forward *lessons*, not code. To
do that well we must preserve **why** decisions were made and **how the thinking
evolved** — not just the current state.

This need was made concrete this session: when the implementation-language choice
flipped from Python to TypeScript, the decision was **edited in place** in
`vtfkb-DESIGN.md`. That destroyed the prior decision as a record — the
"archaeological record of how thinking evolved" was lost. A mutable `Dn` list in
a design doc cannot preserve superseded reasoning.

Separately, vtfkb's whole purpose is to be the agent-consumable knowledge
substrate of the factory. Decisions that constrain agents want to be immutable,
status-tracked records the agents can read — i.e. ADRs. Using ADRs on vtfkb's own
design **dogfoods** the ADR-grade `decision` capability we want the product to
have (ADR-0004).

## Decision

All significant vtfkb architecture decisions are recorded as **immutable ADRs** in
`vtfkb-adr/`, in Nygard format. A decided ADR is **never edited**; a change of
mind is a **new ADR that supersedes** the old one (old status →
`Superseded by ADR-XXXX`). The ADR log is the authoritative decision record;
`vtfkb-DESIGN.md` becomes the narrative that references it, and its existing
locked `Dn`/`D-On` decisions migrate into the log.

## Consequences

- **+** Preserves rationale and the evolution of thinking; superseded decisions
  stay legible.
- **+** Agent-consumable, status-tracked decisions — the same shape vtfkb will
  serve at runtime.
- **+** Dogfoods ADR-0004 (the product feature) on our own process.
- **−** Ceremony: one record per significant decision, and the up-front migration
  of the current `Dn` list.
- **Neutral:** small, fast decisions still live inline in design docs; only
  *significant* architectural choices earn an ADR.

## Alternatives Considered

- **Inline mutable `Dn` list in the design doc** (status quo) — rejected: it is
  edited in place, which is exactly how we lost the Python→TypeScript record.
- **No formal decision record** — rejected: incompatible with a generational
  "carry the lessons forward" strategy.
