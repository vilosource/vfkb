---
type: Decision
title: "ADR-0025: The project context doc + `kb_context` — an assembled \"agent's first read\" (authored spine + derived sections)"
description: "The project context doc + `kb_context` — an assembled \"agent's first read\" (authored spine + derived Constitution/Map/decisions), read on demand"
status: "Accepted (← RFC-007; operator approved the recommended shape 2026-06-28)"
timestamp: 2026-06-28
---

# ADR-0025: The project context doc + `kb_context` — an assembled "agent's first read" (authored spine + derived sections)

- **Status:** Accepted (← [RFC-007](../rfc/RFC-007-project-context-doc-and-kb-context.md); operator approved the recommended shape 2026-06-28)
- **Date:** 2026-06-28
- **Deciders:** operator + Claude
- **Realises:** [FEATURES](../FEATURES.md) §3.7 (the project context doc) + `project-onboarding-schema` **D-O8**
  ([DESIGN](../DESIGN.md)). **Composes with** [ADR-0010](ADR-0010-product-vision.md) (Vision/Taste = a section
  of this doc), [ADR-0006](ADR-0006-context-map.md) (the derived Map this doc stitches + points into),
  [ADR-0008](ADR-0008-constitution-tier.md) (the derived Constitution it stitches),
  [ADR-0019](ADR-0019-self-hosted-design-brain.md) (where the authored spine lives). **Bounded by**
  [ADR-0015](ADR-0015-cross-harness-auto-layer.md) (the 10k Tier-A budget) + the no-secrets lint. Built
  scenario-first ([ADR-0023](ADR-0023-scenario-contract-first.md)).

## Context

FEATURES §3.7 promised every project **one context document** — *the `CLAUDE.md` the factory maintains* —
loaded by **`kb_context`**, that orients any agent instantly (job-to-be-done, architecture, tech profile,
conventions, load-bearing decisions, links). [ADR-0010](ADR-0010-product-vision.md) already *assumed* this doc
exists (it places the Vision/Taste narrative as "a section of the authored project context doc"), and
[ADR-0006](ADR-0006-context-map.md) treats it as an authored artifact separate from the derived Map. But it was
never built: vfkb shipped entry-bundle injection + resume + the derived Map/Constitution — *the pile of
entries and the map of what exists, but never the prose that frames them*. The `kb-context-first-read` scenario
was RED for exactly this. RFC-007 raised the design at the D-ii autonomy ceiling; the operator approved the
recommended shape ("proceed", 2026-06-28).

## Decision

The project context doc is an **assembled artifact** read on demand via **`kb_context`**:

1. **Assembled = authored spine + derived sections (RFC-007 Q1: hybrid).** `kb_context` / `renderContext`
   returns the **authored narrative spine** (job-to-be-done, architecture, tech profile, conventions,
   Vision/Taste — [ADR-0010](ADR-0010-product-vision.md)) followed by **derived sections stitched live**: the
   **Constitution** ([ADR-0008](ADR-0008-constitution-tier.md)), the **Context Map**
   ([ADR-0006](ADR-0006-context-map.md)), the **load-bearing decisions** (accepted, non-constitutional), and
   **links**. The derived half is rendered from the brain each call, so it never drifts into a stale hand-copy
   (the [RFC-005](../rfc/RFC-005-session-continuity-record.md)/anti-drift lesson applied to orientation).
2. **Storage = an authored Markdown file in the brain (Q2):** `<brain>/context.md` (a plain file via
   `storage.contextSpinePath`/`readContextSpine`/`writeContextSpine`), **not** a JSONL entry — so it stays
   freely **editable** (architect-maintained; the never-rewrite Brake governs *entries* only). **No new entry
   type** (consistent with ADR-0008/0010). Committable with the self-hosted design brain
   ([ADR-0019](ADR-0019-self-hosted-design-brain.md)).
3. **Surface = `kb_context` MCP tool + CLI `vfkb context` [project], ON-DEMAND (Q3).** It is the agent's
   deliberate first read, **not** auto-injected — session-start keeps the budget-bounded map+resume
   ([ADR-0015](ADR-0015-cross-harness-auto-layer.md)); the full doc would blow the 10k Tier-A budget.
4. **Seeded via `vfkb context init` (Q4):** scaffolds the authored spine if absent (idempotent — never
   overwrites). v1 ships the scaffold + derived-section auto-fill; deep brownfield inference (architecture/
   tech-profile from the repo) is **deferred**.
5. **One ADR (Q5)** covers the context-doc artifact + `kb_context`; the broader onboarding-schema D-O8 stays a
   future concern.

Scenario-first ([ADR-0023](ADR-0023-scenario-contract-first.md)): `kb-context-first-read` — an agent answers a
project-orienting question (the declared codename) **only** by calling `kb_context`, vs a no-memory baseline;
run RED before the tool existed, green after.

## Consequences

- **+** Delivers §3.7 — the "agent's first read" — and gives ADR-0010's Vision/Taste section its home; closes
  the Track-4b `kb-context-first-read` gap. After this, the in-repo H4 frontier is exhausted.
- **+** The hybrid keeps the high-churn facts (Constitution/Map/decisions) **derived** → the doc cannot rot
  into a stale hand-copy.
- **+** On-demand keeps the session-start Tier-A budget intact; no injection regression.
- **−** A second authored artifact (the spine) to maintain. Mitigated: small, architect-owned, most of the doc
  is derived; `context init` scaffolds it.
- **−** Brownfield inference deferred — v1 scaffolds headers + fills the derived half only.
- **Neutral:** no new entry type; existing injection/search unchanged; `kb_context` adds one MCP tool (surface
  now 9, still ≤10 — ASDLC tight-surface discipline).

## Alternatives Considered

- **Purely-authored monolith doc.** Rejected — drifts; reintroduces the stale-handoff failure mode
  ADR-0020/RFC-005 fought. (RFC-007 Q1.)
- **Auto-inject the whole doc at session start.** Rejected — blows the 10k Tier-A budget and duplicates the
  Map; the doc is a deliberate read, not always-on steering. (Q3.)
- **Model the spine as entries.** Rejected — fights ADR-0010 ("no new type") and the never-rewrite Brake (the
  spine must be freely editable). The derived sections already are entries/derived. (Q2.)

## Related

[RFC-007](../rfc/RFC-007-project-context-doc-and-kb-context.md) (this ADR's proposal), [FEATURES](../FEATURES.md)
§3.7, [ADR-0010](ADR-0010-product-vision.md) / [ADR-0006](ADR-0006-context-map.md) /
[ADR-0008](ADR-0008-constitution-tier.md) (the sections it stitches), [ADR-0019](ADR-0019-self-hosted-design-brain.md)
(spine home), [ADR-0015](ADR-0015-cross-harness-auto-layer.md) (budget), [ADR-0023](ADR-0023-scenario-contract-first.md)
(method). Code: `renderContext` + `initContextSpine` (engine), `contextSpinePath`/`readContextSpine`/`writeContextSpine`
(storage), `kb_context` (mcp-server), `vfkb context`/`context init` (cli). Scenario: `kb-context-first-read`.
Roadmap: [H4-DEVELOPMENT-ROADMAP](../H4-DEVELOPMENT-ROADMAP.md) §4 D-ii.
