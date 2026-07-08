---
type: Decision
title: "ADR-0046: Layered knowledge management — vfkb captures, graphify understands, OKF publishes (accepts RFC-020)"
description: "Layered knowledge management — vfkb captures, graphify understands, OKF publishes; one-way trust ratchet with deterministic Brakes (accepts RFC-020)"
status: "Accepted"
timestamp: 2026-07-08
---

# ADR-0046: Layered knowledge management — vfkb captures, graphify understands, OKF publishes (accepts RFC-020)

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** operator + Claude
- **Accepts:** [RFC-020](../rfc/RFC-020-layered-knowledge-capture-understand-publish.md)
  (ratified 2026-07-08 after a post-v2-ship gap-review revision; the RFC carries the full
  rationale, field mapping, alternatives, and phased Definition of Done)
- **Relates:** [ADR-0019](ADR-0019-self-hosted-design-brain.md) (the committed brain this
  exports *from*, never replaces), [ADR-0021](ADR-0021-auto-distill-and-curator.md) (the
  curator/corroboration gate reused as the export threshold), [ADR-0001](ADR-0001-record-decisions-as-adrs.md)
  (ADR immutability, which bounds in-place bundle supersession), [ADR-0045](ADR-0045-vfkb-claude-code-plugin.md)
  (the plugin distribution the export surface rides), `docs/H4-DEVELOPMENT-ROADMAP.md` Track 9 Q3
  (whose render-target scope this widens),
  [vilosource/okf-skill](https://github.com/vilosource/okf-skill) (OKF v0.1 authoring/validation;
  its `validate_okf.py` is this decision's conformance Brake)

## Context

Three knowledge systems now coexist in this project: **vfkb** (live, append-only, typed,
trust/corroboration-gated capture), **graphify** (a derived, rebuildable structural graph with
EXTRACTED/INFERRED/AMBIGUOUS confidence tiering), and **OKF v0.1** (a curated static corpus of
markdown-with-frontmatter docs, zero-tooling readable, with no confidence model of its own).
All three are superficially "knowledge management"; without an ownership decision they drift
into three independent sources of truth. Graphify's extraction was directly observed to have
non-determinism bugs, so wiring it toward any publish path unreviewed would launder structural
guesses into flat fact. RFC-020 (as revised 2026-07-08) resolves this; this ADR records the
decision.

## Decision

Adopt a three-layer model — **Capture → Understand → Publish** — assigning each system exactly
one layer, with knowledge flowing one direction via explicit, reviewed steps:

1. **Capture = vfkb** (`.vfkb/entries.jsonl`). Every fact/decision/gotcha/pattern/link is *born*
   here. Nothing is hand-authored in two layers in parallel.
2. **Understand = graphify** (`graphify-out/`, gitignored, disposable). Reads everything, never
   originates knowledge.
3. **Publish = OKF**, in two parts bound differently by the **one-way ratchet**:
   - The **generated `.okf/` bundle** (`vfkb export okf`, a Q3-shared render target): strictly
     `verified`-only, and `accepted`-only for decision-family entries. Removals move to the
     bundle's `log.md`, never silently vanish.
   - The **in-place `docs/adr/` + `docs/rfc/` bundle**: published *as a deliberation record* via
     mandatory `status:` frontmatter that consumers filter on; superseded ADRs stay immutable in
     place (ADR-0001), never move to `log.md`.

The ratchet is enforced by deterministic Brakes, not prose: okf-skill's `validate_okf.py
--strict` over the in-place bundle (Phase 0, run at acceptance), and a negative projection test —
`unverified`/`proposed` entries must export **nothing** — in the Phase 1 unit gate (RED first).

The export is a CLI verb on the engine and therefore consumer-generic: any project with a
`.vfkb/` brain exports its own bundle via the plugin's vendored CLI (ADR-0045). No `vfkb:okf`
skill is created — hand-authoring is okf-skill's job; whether a vfkb-specific skill surface is
ever wanted is an open item deferred to the eventual Q3 RFC.

## Consequences

- **Phase 0 ships with this acceptance:** OKF frontmatter (`type`, `title`, `description`,
  `status`, `timestamp`) retrofitted onto `docs/adr/*.md` and `docs/rfc/*.md`; a green
  `validate_okf.py --strict` run over both directories recorded in the delivering PR; a
  CLAUDE.md note that `link`-type entries may point at `.okf/` docs today.
- **Phase 1 stays evidence-gated** on Track 9 Q3 being drafted/built: `vfkb export okf` beside
  `vfkb export agents-md`, one deterministic-projection engine, with the negative ratchet test
  and the `okf-bundle-cold-agent` L4 scenario (naive arm answers a seeded question from the
  bundle alone; contrast arm misses — ADR-0022/0029, can fail, RED first) as its DoD.
- **Phase 2 (graphify-assisted draft suggestions, staleness detection) is explicitly gated** on
  a concrete trigger — documentation-drift pain observed or an explicit request.
- ADR/RFC markdown now carries YAML frontmatter; future ADRs/RFCs include it at authoring time.
  This is metadata around the decision body — ADR immutability (ADR-0001) is unaffected.
