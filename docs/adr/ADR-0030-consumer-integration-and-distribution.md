# ADR-0030: Consumer integration & distribution contract — portable engine (`$VFKB_HOME` + single-file bundles), `vfkb init`, `import`, `doctor`

- **Status:** Accepted
- **Date:** 2026-06-30
- **Deciders:** operator + Claude
- **Accepts:** [RFC-010](../rfc/RFC-010-consumer-integration-and-distribution.md) (the proposal + the
  five FRs + the dependency-forced build order). **Relates:**
  [ADR-0019](ADR-0019-self-hosted-design-brain.md) (self-hosted brain — the wiring this generalizes
  self→consumer), [ADR-0013](ADR-0013-no-hard-native-dep.md) (no hard native dep — the bundle honours
  it), [ADR-0015](ADR-0015-cross-harness-auto-layer.md) (the auto-layer being scaffolded),
  [ADR-0028](ADR-0028-sandbox-validate-auto-layer-wiring.md) (wiring smoke-gate — the DoD this extends
  to a consumer repo), [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md) (the DoD this proof
  obeys), [ADR-0011](ADR-0011-envelope-richness.md) (the versioned envelope FR-4 stamps). Origin: the
  2026-06-30 vfwb onboarding evidence (brain fact `102a92f3`); the gating unknown is resolved (brain
  fact `8c547ae0`).

## Context

vfkb's stated purpose is to be the **per-project knowledge substrate that vfwb and the agent fleet
ground against**. But its only working integration is the one committed at this repo's root, hand-built
*for this repo* and written self-referentially. The first real consumer (vfwb) tried to onboard and hit
five concrete friction points (RFC-010 Context), of which one is a hard blocker: the committed wiring
runs the engine via **relative paths** (`node dist/cli.js`, `node dist/mcp-server.js`) that **only
resolve when the process cwd is this engine repo** (verified 2026-06-30). A consumer repo cannot run
them, and every obvious fallback breaks portability (absolute path), `PATH` (`npm link`), or
install (unpublished + Nexus ENOTFOUND off-VPN).

This is a **standard-setting** decision — *how every consumer integrates, and how the engine is
distributed* — so it is decided as an ADR ahead of the build, per the ASDLC process. The one technical
unknown (could the MCP server bundle to a single zero-dep file?) was **spiked and resolved before this
acceptance**: `esbuild` produces a single 1.1 MB `vfkb-mcp.mjs` with `@modelcontextprotocol/sdk` +
`zod` inlined that runs the full MCP handshake and advertises all 9 tools from a dir with **no
`node_modules`** (brain fact `8c547ae0`).

## Decision

Adopt the **consumer integration & distribution contract** of RFC-010 — five FRs, built in the
**dependency-forced** order (priority labels are urgency, not build order):

1. **FR-2 — Portable engine resolution (P0, built first).** Committed wiring references
   **`node "$VFKB_HOME/vfkb.mjs"`** / **`…/vfkb-mcp.mjs"`** — one env indirection, **zero machine paths
   in git**. Ship `vfkb` + `vfkb-mcp` as **single-file `esbuild` bundles** (`--bundle --platform=node`),
   `npx`-able from a git ref and vendorable for air-gapped/fleet use, honouring ADR-0013.
   **Dogfood it:** this repo's own wiring migrates to the `$VFKB_HOME` form **only after** the consumer
   sandbox proves it (ADR-0028 — never edit the live tool in place). The single-file bundle is the
   committed approach (spike-proven); the vendored-bundle-dir fallback is **not** needed.
2. **FR-1 — `vfkb init [project-name]` (built second).** Idempotent in-repo scaffold of `.mcp.json` +
   `.claude/settings.json` (`$VFKB_HOME` form, `VFKB_PROJECT` defaulted from the dir name) + the
   `.gitignore` stanza + empty `.vfkb/entries.jsonl` + a parameterized "how we track work HERE"
   `CLAUDE.md`/`AGENTS.md` snippet; prints the one manual approval step.
3. **FR-4 — Brain↔engine version stamp + `vfkb doctor` (built third).** Stamp `schema_version` +
   `engine_commit`; `doctor` checks compat, wiring present + `VFKB_PROJECT` correct, MCP/hooks approved,
   and warns on dual-clone committed-brain drift. **Backed by a deterministic unit/Tier-0 gate**, not
   the L4 harness.
4. **FR-3 — `vfkb import` (built fourth).** `--from-mykb` / `--from-adr` / `--from-markdown`, routed
   through the engine (honouring the write-gate), provenance `imported`.
5. **FR-5 — `docs/CONSUMER-ONBOARDING.md` (built last) + this ADR (the contract).**

**Build order:** *(this ADR)* → FR-2 → FR-1 → FR-4 → FR-3 → CONSUMER-ONBOARDING.md.

**Definition of Done (ADR-0029).** The capability is agent-facing, so its proof is an **agent-driven
sandbox scenario that must be able to fail**, extending the wiring smoke-gate (ADR-0028)
**self → consumer**: `vfkb init` a throwaway empty repo, set `$VFKB_HOME` to the bundle dir, run a real
agent turn, and **observe** — `SessionStart` injects · the `PreToolUse` gate blocks a direct `.vfkb/`
write · MCP `kb_*` resolve · a `kb_add` lands — with a **contrast arm** (an un-`init`'d repo shows
none of it). `doctor` (FR-4) gets a deterministic backstop.

**Three design choices locked here** (flagged in RFC-010, decided as *defaults*, revisable by a
superseding ADR only):
- **FR-4 stamp lives in `.vfkb/manifest.json`** — a small **committed** file (schema/engine identity is
  durable knowledge that must travel with the brain), distinct from the **derived, gitignored**
  `index-meta.json` (ADR-0019). It is engine-written (never hand-edited; the write-gate applies).
- **FR-3 mykb mapping is explicitly lossy** (like vfwb's own projection) — types map 1:1 where they
  exist (decision→decision, etc.), free-form journal entries import as `fact`/`link` with provenance
  `imported`; fidelity is best-effort, not guaranteed round-trip.
- **`$VFKB_HOME` bootstrap is a documented one-time per-machine step** (`vfkb init` *prints* it; it
  cannot set another process's env). Default bundle location: a committed/release `bundles/` (or
  `dist/bundles/`) the consumer points `$VFKB_HOME` at, or vendors.

## Consequences

- **+** vfwb and the fleet can run vfkb **anywhere** (the blocker FR-2 removes); onboarding becomes one
  command; existing knowledge migrates (FR-3); two known corruption modes get a guard (FR-4); the self
  repo stops being a special case (same `$VFKB_HOME` wiring).
- **+** "spiked the unknown before accepting" kept this ADR from committing to an unproven distribution
  shape.
- **−** A bundle/build step enters the release path; `$VFKB_HOME` is a new one-time setup; `manifest.json`
  adds a committed file to the `.vfkb/` contract.
- **−** The three locked defaults may need revisiting under real consumer load — handled by supersession,
  not edit (ADR-0001).

## Alternatives Considered

- **Hand-wire each consumer (status quo).** Rejected — ~30 min, undocumented, copy-paste-hazardous, and
  **non-portable** (the relative paths don't run in a consumer repo).
- **Absolute engine path / `npm link` / registry install.** Rejected as the mechanism — breaks across
  clones/containers/fleet, or non-login `PATH`, or unpublished + Nexus ENOTFOUND. The git-ref-bundle +
  `$VFKB_HOME` avoids all three. (Publishing later composes with the bundle, not a substitute.)
- **Vendored-bundle-dir instead of single-file.** Rejected as the default — the spike proved single-file
  works; kept only as a documented fallback if a future dep resists bundling.
- **Hand-write `vfkb add` / edit JSONL to migrate knowledge.** Rejected — defeats the write-gate; FR-3
  `import` is the verb.

## Related

[RFC-010](../rfc/RFC-010-consumer-integration-and-distribution.md),
[ADR-0019](ADR-0019-self-hosted-design-brain.md),
[ADR-0028](ADR-0028-sandbox-validate-auto-layer-wiring.md),
[ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md). DoD scenario (to build):
`scenarios/consumer-onboarding.mjs`. Brain: facts `102a92f3` (evidence), `8c547ae0` (bundle spike);
decision (acceptance) recorded on merge.
