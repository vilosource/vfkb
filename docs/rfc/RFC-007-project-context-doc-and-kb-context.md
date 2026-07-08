---
type: RFC
title: "RFC-007: The project context doc + `kb_context` — an assembled \"agent's first read\" (authored narrative spine + derived sections)"
description: "The project context doc + `kb_context` — an assembled \"agent's first read\" (authored spine + derived sections)"
status: "Accepted → ADR-0025 (operator approved the recommended shape 2026-06-28)"
timestamp: 2026-06-27
---

# RFC-007: The project context doc + `kb_context` — an assembled "agent's first read" (authored narrative spine + derived sections)

- **Status:** Accepted → [ADR-0025](../adr/ADR-0025-project-context-doc-and-kb-context.md) (operator approved the recommended shape 2026-06-28)
- **Date:** 2026-06-27
- **Deciders:** operator + Claude (proposal; the operator decides the open questions below)
- **Refines (on acceptance):** realises [FEATURES](../FEATURES.md) §3.7 (the project context doc) and the
  `project-onboarding-schema` **D-O8** ([DESIGN](../DESIGN.md)); composes with
  [ADR-0010](../adr/ADR-0010-product-vision.md) (Product Vision = a *section of the authored context doc* +
  heuristic patterns — this RFC is where that context doc finally gets a home),
  [ADR-0006](../adr/ADR-0006-context-map.md) (the derived Context Map — *separate* artifact the doc points
  into), [ADR-0008](../adr/ADR-0008-constitution-tier.md) (the derived Constitution), and
  [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) (where authored project docs live). Bounded by
  [ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md) (the 10k Tier-A session-start budget) and the
  no-secrets write-time lint. Closes the Track-4b `kb-context-first-read` gap (§3.7).

## Context

vfkb's vision (FEATURES §3.7) promises every project **one context document** — *"the `CLAUDE.md` every
project should have, except the factory writes and maintains it"* — loaded by **`kb_context`**, that orients
any agent instantly: the job-to-be-done, architecture, tech profile, conventions, the load-bearing decisions,
and links into `docs/`. It is *"what turns a generic model with a repo into an agent that already understands
your system."*

**What exists today** (and what doesn't):

- ✅ Entry-bundle injection — `renderContextBundle` (Tier-A, [ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md)):
  the freshest individual entries, budgeted to 10k at session start.
- ✅ The resume render — prior-session digest + bundle ([ADR-0020](../adr/ADR-0020-session-continuity-record.md)).
- ✅ The derived **Context Map** (index/topology, [ADR-0006](../adr/ADR-0006-context-map.md)) and derived
  **Constitution** ([ADR-0008](../adr/ADR-0008-constitution-tier.md)).
- ❌ **No authored context *document*** — no single narrative artifact that says *what this project is*.
- ❌ **No `kb_context` tool** — an agent cannot pull "the orientation doc" as one read.

So the agent today gets *a pile of fresh entries* + *a map of what exists*, but never *the prose that frames
them*. [ADR-0010](../adr/ADR-0010-product-vision.md) already **assumes** this doc exists (it places the
Vision/Taste narrative as *"a section of the authored project context doc"*) and
[ADR-0006](../adr/ADR-0006-context-map.md) is explicit that the **authored context doc and the derived map are
separate artifacts** with separate lifecycles — *the map points into the entries the doc narrates*. The doc is
the one piece of the design referenced by others but never built. The `kb-context-first-read` scenario is RED
for exactly this reason: there is no mechanism to read.

The reason this is the **autonomy ceiling** (RFC + pause, not an unattended build like D-i/D-iii/D-iv): unlike
those — which completed an already-decided contract — this feature has **genuinely open, interlocking design
choices** (below). They shape storage, maintenance, the inject budget, and the onboarding flow, and they
deserve an operator decision before code.

## Decision (RECOMMENDED — pending operator answers to the open questions)

> **RESOLVED 2026-06-28:** the operator approved the recommended shape ("proceed"). All five open
> questions below were answered as recommended (hybrid; `<brain>/context.md`; on-demand; `vfkb context init`
> scaffold + deferred brownfield inference; one ADR). The accepted decision is **[ADR-0025](../adr/ADR-0025-project-context-doc-and-kb-context.md)** and is shipped. The text below is preserved as the original proposal.

Build the project context doc as an **assembled artifact**: a hand-authored **narrative spine** stitched with
**derived sections** that vfkb already owns, exposed through a new **`kb_context`** read.

1. **Assembled, not a hand-maintained monolith (hybrid).** `kb_context` returns:
   - **Authored spine** (hand-written, evolves): job-to-be-done, architecture overview, tech profile,
     conventions, and the **Vision/Taste** section ([ADR-0010](../adr/ADR-0010-product-vision.md)).
   - **Derived sections** (stitched at render, never hand-copied → never drift): the **Constitution**
     ([ADR-0008](../adr/ADR-0008-constitution-tier.md)), the **Context Map** index
     ([ADR-0006](../adr/ADR-0006-context-map.md)), the current **load-bearing decisions** (established/
     constitutional), and **`docs/` links** (from entry refs). FEATURES §3.7's own list spans both kinds; the
     derivable half self-maintains, so only the spine is hand-kept.
2. **Storage = an authored Markdown file in the self-hosted design brain** (`.vfkb/CONTEXT.md`,
   [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md)) — **no new entry type** (consistent with
   ADR-0008/0010). The spine is **editable / last-write-wins** (orientation evolves, like vision patterns); the
   never-rewrite Brake governs *distilled* entries, not the authored doc.
3. **Surface = `kb_context` MCP tool (+ CLI `vfkb context`), ON-DEMAND.** It is the agent's deliberate "first
   read," not a session-start auto-inject — the full doc would blow the 10k Tier-A budget
   ([ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md)). Session start stays the compact **map + resume**;
   `kb_context` is the deeper pull when an agent onboards to the project.
4. **Seeded at onboarding (D-O8), architect-maintained.** A `vfkb context init` scaffolds the spine
   (greenfield *declares* job/taste; brownfield scaffolds headers + auto-fills the derived sections); the
   architect keeps the spine current.
5. **Scenario-first ([ADR-0023](../adr/ADR-0023-scenario-contract-first.md)):** `kb-context-first-read` — an
   agent answers a project-orienting question (e.g. the job-to-be-done / a named convention) **only** by
   calling `kb_context`, contrasted against a no-context baseline; written + run RED before code, on both
   harnesses.

## Open questions for the operator (the pause)

- **Q1 — Assembled-hybrid vs purely-authored?** Recommend **hybrid** (spine + derived) so the load-bearing
  decisions/constitution/map never drift from a hand-copy. Alternative: a single fully-authored doc (simpler,
  but goes stale — the exact failure mode RFC-005 fought for continuity).
- **Q2 — Storage of the spine?** Recommend **`.vfkb/CONTEXT.md`** (ADR-0019 self-host, git-tracked).
  Alternative: a singleton entry / tagged section-entries (keeps it in the JSONL store + index, but fights
  ADR-0010's "no new type" and the never-rewrite Brake).
- **Q3 — On-demand only, or also session-start inject?** Recommend **on-demand** (budget-safe; map+resume stay
  the always-on orientation). Alternative: inject a *summary* of the doc at session start (richer cold-start,
  but eats the 10k budget and overlaps the map).
- **Q4 — Onboarding/maintenance:** is `vfkb context init` + architect-maintained-Markdown the right seam, and
  how much brownfield **inference** is in scope for v1 (headers-only vs infer architecture/tech-profile from
  the repo)?
- **Q5 — ADR shape:** accept this as **one ADR** (context-doc + `kb_context`), or split (context-doc artifact
  vs the `kb_context`/onboarding-schema D-O8)? 

## Consequences

- **+** Delivers §3.7 — the "agent's first read" — and gives ADR-0010's Vision/Taste section its long-assumed
  home; closes the Track-4b `kb-context-first-read` gap.
- **+** The hybrid keeps the high-churn facts (decisions/constitution/map) **derived** → the doc can't rot into
  a stale hand-copy (the RFC-005 lesson applied to orientation).
- **+** On-demand keeps the session-start budget intact; no Tier-A regression.
- **−** A second authored artifact to maintain (the spine). Mitigated: small, architect-owned, and most of the
  doc is derived.
- **−** Brownfield inference is open-ended; v1 likely ships headers + derived-fill and defers deep inference.
- **Neutral:** no new entry type; no change to existing injection/search.

## Alternatives Considered

- **Purely-authored monolith doc.** Rejected (recommendation) — drifts; reintroduces the stale-handoff failure
  mode continuity (RFC-005/ADR-0020) was built to kill. Kept as Q1 for the operator.
- **Auto-inject the whole doc at session start.** Rejected — blows the 10k Tier-A budget and duplicates the
  map; the doc is a deliberate read, not always-on steering. Kept as Q3.
- **Model the doc as entries (no file).** Rejected for the spine — fights ADR-0010 ("no new type") and the
  never-rewrite Brake (the spine must be freely editable); the *derived* sections already are entries/derived.

## Related

[FEATURES](../FEATURES.md) §3.7; [ADR-0010](../adr/ADR-0010-product-vision.md) (Vision = a context-doc
section), [ADR-0006](../adr/ADR-0006-context-map.md) (separate derived map), [ADR-0008](../adr/ADR-0008-constitution-tier.md)
(derived Constitution), [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) (authored-docs home),
[ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md) (Tier-A budget), [ADR-0020](../adr/ADR-0020-session-continuity-record.md)
+ [RFC-005](RFC-005-session-continuity-record.md) (the anti-drift lesson). Roadmap:
[H4-DEVELOPMENT-ROADMAP](../H4-DEVELOPMENT-ROADMAP.md) §4 D-ii (autonomy ceiling). Scenario: `kb-context-first-read`.
