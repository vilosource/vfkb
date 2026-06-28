# ADR-0026: Rebrand vtfkb → vfkb (ViloForge KnowledgeBase) to align the VF-family naming

- **Status:** Accepted
- **Date:** 2026-06-28
- **Deciders:** operator + Claude
- **Scope:** project identity + all in-repo identifiers. **vfwb is out of scope** (its maintainer repoints it
  to the renamed `.vfkb` / repo). Bounded by [ADR-0001](ADR-0001-record-decisions-as-adrs.md) (immutability —
  see the note below) and [ADR-0019](ADR-0019-self-hosted-design-brain.md) (the self-hosted brain dir, renamed).

## Context

The project shipped as **`vtfkb`** (a VFSF-era name). Its consumer, **[ViloForge WorkBench (vfwb)](https://github.com/vilosource/vfwb)**,
is the design/planning workbench that grounds against this knowledge base (vfwb ADR-0003: it pushes a lossy
projection to the project's `.vtfkb/` dir; recall flows back). The VF-product family is named `vf*` —
**vfwb = ViloForge WorkBench** — so the knowledge base is rebranded to **`vfkb` = ViloForge KnowledgeBase** for
a consistent, discoverable family. At rebrand time there are **no live external consumers**: vfwb is
planning-phase and the fleet kb-wiring (which would set `VFKB_ROLE`) is parked — so a clean hard rename is
low-risk.

## Decision

A **full hard rename**, `vtfkb` → `vfkb` (long name **ViloForge KnowledgeBase**), across:

- **Identity:** package `@vilosource/vfkb`; CLI binaries `vfkb` + `vfkb-mcp`; MCP server name `vfkb` (+ the
  self-capture filter now matches `vfkb`); README/docs product name.
- **Env vars:** `VTFKB_*` → `VFKB_*` (`VFKB_DIR`, `VFKB_PROJECT`, `VFKB_ROLE`, `VFKB_MCP_CONFIG`, `VFKB_L4_*`).
- **Directories:** the default brain `~/.vtfkb` → `~/.vfkb`; the self-hosted design-brain `.vtfkb/` → `.vfkb/`
  (ADR-0019); the context-doc spine `<brain>/context.md` is unchanged (path was never name-bound).
- **Harness substrate:** docker image tags `vtfkb-l4-*` → `vfkb-l4-*`.
- **GitHub:** repo renamed `vilosource/vtfkb` → `vilosource/vfkb` (GitHub keeps a redirect from the old name);
  local remote re-pointed.
- **All docs (incl. existing ADRs/RFCs):** the literal string `vtfkb` → `vfkb`.

Existing scenario **records** are kept as historical artifacts (text-rebranded; not re-recorded — re-running
the live L4 suite for a pure rename is not worth the cost; their pinned image digests predate the rename).

## Consequences

- **+** Clean VF-family alignment (`vfkb` ↔ `vfwb`); the product has one discoverable name end-to-end.
- **+** No live consumer breaks (vfwb planning-phase, fleet parked); GitHub redirect preserves old links/clones.
- **−** vfwb's design docs still say `vtfkb`/`.vtfkb` and must be repointed by its maintainer (out of scope
  here; a change-list was handed over).
- **−** Anyone with an existing `~/.vtfkb` brain or `VTFKB_*` env must migrate (rename the dir / env). No
  back-compat aliases were added (deliberately — no live consumers to need them).
- **Neutral:** behaviour is unchanged — this is a pure naming sweep; the engine, MCP surface, and tests are
  byte-for-byte equivalent modulo the renamed strings (95/95 still green).

## Note on ADR immutability (ADR-0001)

[ADR-0001](ADR-0001-record-decisions-as-adrs.md) forbids editing a decided ADR's body. This rebrand edited the
literal product-name string `vtfkb` → `vfkb` inside the already-decided ADRs (0001–0025). The operator
explicitly authorised this as a **branding-only** sweep: **no decision content changed** — only the project's
own name. This ADR is the record that the sweep happened and why; the decisions themselves stand unaltered.

## Alternatives Considered

- **Branding-only (keep `VTFKB_*` env + `.vtfkb` dir).** Rejected — leaves split-brand debt; with no live
  consumers a clean rename is cheaper now than later.
- **Rename with back-compat aliases (accept both `VTFKB_`/`VFKB_`, read `.vtfkb`/`.vfkb`).** Rejected — alias
  code/tests to maintain for consumers that don't exist yet.
- **Leave the immutable ADRs saying `vtfkb`.** Rejected — a split name across the decision record is worse
  than a recorded, authorised branding sweep (this ADR).

## Related

[ADR-0001](ADR-0001-record-decisions-as-adrs.md) (immutability), [ADR-0019](ADR-0019-self-hosted-design-brain.md)
(`.vfkb/`), vfwb [ADR-0003](https://github.com/vilosource/vfwb) (the `.vfkb` projection contract, repointed by
vfwb). Sweep: `vtfkb`→`vfkb` across 107 files + `git mv .vtfkb .vfkb`; GitHub repo + local remote renamed.
