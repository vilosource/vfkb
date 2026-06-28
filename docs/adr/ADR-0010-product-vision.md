# ADR-0010: Product Vision — context-doc narrative + heuristic `pattern`s (no new type)

- **Status:** Accepted
- **Date:** 2026-06-01
- **Deciders:** operator + Claude

## Context

ASDLC's guidance hierarchy is **Constitution (rules/must) → Product Vision
(taste/should) → Specs (contracts).** *Product Vision* (Actual Humans · Point of
View · Taste References · Voice & Language · **Decision Heuristics**) transmits a
product's *taste* to agents, preventing generic output. ADR-0008 modelled the
Constitution tier; the Vision (middle) tier was left open. We need a vfkb model
consistent with the session's discipline (lean on existing primitives; no type
proliferation — D3c; "earn their place").

Key distinction from the Constitution: Constitution is **MUST** (hard, immutable);
Vision is **SHOULD/taste** (soft, and it *evolves*).

## Decision

Model Product Vision with existing primitives, **no new entry type and no separate
`VISION.md` artifact**:

- **Narrative Vision** (Actual Humans / Point of View / Taste References / Voice &
  Language) = a **"Vision / Taste" section of the authored project context doc**
  (onboarding D-O8). Human-authored, evolves, architect/PM-owned.
- **Decision Heuristics** (tie-breakers — "when ambiguous, prefer X") = **`pattern`
  entries**, tagged `vision`/`heuristic`. Patterns are **editable**
  (`last-write-wins`) — correct, because taste evolves (unlike immutable
  decisions) — and are **auto-injectable** as low-volume always-on steering (D7).
- **Precedence documented:** Constitution (MUST — `constitutional` decisions,
  ADR-0008) → **Vision (SHOULD/taste — context-doc section + heuristic patterns)** →
  Specs (contracts — vtf-side, D1).
- Seeded at onboarding (greenfield `init` declares taste; brownfield infers little
  — taste is mostly *declared*), maintained by the architect.

## Consequences

- **+** Taste reaches agents (less generic output) using primitives we already
  have — no new type, no new artifact.
- **+** Heuristics are **editable** (taste evolves), which is the right lifecycle —
  and distinct from the immutable Constitution (ADR-0008) and decisions (ADR-0004).
- **+** Completes the Constitution→Vision→Specs hierarchy in vfkb terms.
- **−** Relies on **tag discipline** (`vision`/`heuristic`) to mark which patterns
  are injected as tie-breakers; the engine must honour that tag in D7 selection.

## Alternatives Considered

- **A separate `VISION.md` artifact or a `vision` entry type** — rejected: a new
  artifact/type against D3c and "earn their place"; the context doc + patterns
  cover it.
- **Model heuristics as decisions** — rejected: decisions are **immutable MUSTs**;
  taste is an **editable SHOULD**. `pattern` (editable) is the right home.
- **Fold Vision into the Constitution (ADR-0008)** — rejected: conflates MUST with
  taste — the exact Driver-tier distinction ASDLC draws between Constitution and
  Vision.

## Related
ADR-0008 (Constitution tier), ADR-0006 (derived-render pattern), D-O8 (context
doc skeleton — gains a Vision/Taste section), D7 (injection).
