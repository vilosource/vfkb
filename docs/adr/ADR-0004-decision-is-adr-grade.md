# ADR-0004: `decision` is a first-class, ADR-grade entry type in vtfkb

- **Status:** Accepted
- **Date:** 2026-06-01
- **Deciders:** operator + Claude

## Context

mykb's `decision` entry already carries `text` + `--why` + `--rejected` +
`--context` — 4 of the 6 ADR fields (Decision · Rationale · Alternatives ·
Context). It is missing **Status (lifecycle)** and explicit **Consequences**, and
it is **mutable** (general `last-write-wins`, D4c).

In an agentic factory, decisions are not just documentation — they are **runtime
constraints the memory feeds to agents** (context engineering). That is a place
mykb (the spike, ADR-0002) was thinner than the field now expects, so it is a
deliberate evolution target.

## Decision

Elevate `decision` to **ADR-grade**:

1. **Six-field template:** Title/ID · **Status** · Context · Decision ·
   **Consequences** · Alternatives. mykb's `context`/`why`/`rejected` map to
   Context/Rationale/Alternatives; **add** an explicit `status` and `consequences`.
2. **Status lifecycle:** `proposed → accepted → deprecated | superseded`
   (supersession via `refs.supersedes`, D3b).
3. **Immutable-supersede for the DECISION FAMILY only** — `decision`, RFC
   (ADR-0007), and constitutional rules (ADR-0008) are **never edited, only
   superseded**. `fact`/`gotcha`/`pattern`/`link` remain **editable**
   (`last-write-wins`, D4c). Immutable entries union cleanly under merge=union;
   a supersession is an **additive edge, never a delete**.
4. **Keep it as the `decision` type** — do not split out a separate "ADR" type
   (it is already 4/6 of the template).

(Human-facing ADR numbering → ADR-0009. RFC modeling → ADR-0007. Constitutional
rules → ADR-0008. Stale-entry injection → ADR-0005.)

## Consequences

- **+** Decisions become agent-consumable constraints with a legible, immutable
  history — the ADR value, native to the memory.
- **+** Reconciles cleanly with merge=union and the trust gradient (D3d).
- **+** Dogfooded: this very ADR log uses the model (ADR-0001).
- **−** Per-type behaviour divergence (decision family immutable; observations
  fluid) — this **partially resolves D3e** (deferred per-type provenance) for the
  decision family.
- **Neutral:** the other four entry types are unchanged.

## Alternatives Considered

- **Keep `decision` mykb-style (mutable, no status)** — rejected: loses the
  immutable-record + agent-constraint value.
- **A distinct 6th "ADR" entry type** — rejected: `decision` is already 4/6 of the
  template; a new type violates D3c's deliberate five.
- **Immutable-supersede for ALL entry types** — rejected: forces ceremony on
  routine fact/gotcha corrections without the same archaeological value.
