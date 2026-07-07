# ADR-0045: vfkb ships as a Claude Code plugin — primary distribution for the Claude Code harness face (accepts RFC-021)

- **Status:** Accepted
- **Date:** 2026-07-07
- **Deciders:** operator + Claude
- **Accepts:** [RFC-021](../rfc/RFC-021-vfkb-claude-code-plugin.md) (Phase 0 precondition verified
  live before acceptance — see Consequences).
- **Relates:** [ADR-0030](ADR-0030-consumer-integration-and-distribution.md) (`vfkb init` — kept as
  fallback, not retired), [ADR-0035](ADR-0035-hooks-anchor-to-project-dir.md) (hook path-anchoring
  discipline this reuses), [ADR-0015](ADR-0015-cross-harness-auto-layer.md) (cross-harness
  auto-layer this extends).

## Context

vfkb's Claude Code distribution today is the npm package plus a bespoke `vfkb init` step that
hand-writes `.mcp.json` and `.claude/settings.json` hook entries into every consuming project.
Claude Code has a native plugin/marketplace system that can bundle a human-facing skill, an MCP
server, and hooks as one installable unit, auto-wiring all three on install. RFC-021's Phase 0
research empirically verified this live rather than assuming it from docs: hooks resolve
`${CLAUDE_PROJECT_DIR}` directly; MCP servers need it template-substituted through the config's own
`env` field instead. Phase 0 also found that a same-repo subdirectory-scoped plugin source is
**not** sufficient to keep this repo's own `.vfkb/entries.jsonl` and dev tree off a consumer's
disk — `claude plugin marketplace add` performs a full, unscoped `git clone` before any
plugin-level scoping applies (confirmed directly against `vilosource/okf-skill`'s real
marketplace). A dedicated, minimal repo is the only way to make that structurally safe rather than
dependent on every consumer remembering a `--sparse` flag.

## Decision

Ship a `vfkb` Claude Code plugin from a **dedicated, minimal repo — `vilosource/vfkb-claude-plugin`
(public)** — not a subdirectory of this dev repo, as the **primary, recommended** distribution path
for the Claude Code harness face. It bundles exactly three things, all resolving this repo's
existing harness-agnostic engine bundles (`dist/bundles/vfkb.mjs`, `vfkb-mcp.mjs`) — no engine
changes:

1. A human-facing **skill** (+ slash commands) — the primary interactive entry point for a human.
2. A bundled **MCP server** declaration, `VFKB_DATA_DIR` set via the config's own `env`-field
   template substitution (`${CLAUDE_PROJECT_DIR}/.vfkb`) — the primary entry point for agents.
3. A bundled `hooks/hooks.json` (SessionStart/PreToolUse/Stop/SessionEnd), referencing
   `${CLAUDE_PROJECT_DIR:-.}` directly per ADR-0035's existing pattern.

`vfkb init` (ADR-0030) is **not retired** — it remains the fallback for CI, scripted, and
non-interactive consumers, and for any future harness with no plugin concept.

## Definition of Done

Phase 1: scaffold `vilosource/vfkb-claude-plugin` with the manifest, skill, hooks, and MCP
declaration described above. Full testing regimen: unit/integration coverage for new glue code,
plus an agent-driven L4 scenario proving a plugin-installed vfkb behaves identically to an
`vfkb init`-wired vfkb for a real session (must be able to fail). Dogfood on a real consumer
(`okf-skill`, which already runs vfkb via `vfkb init`) before broader rollout.

## Consequences

- A second repo (`vilosource/vfkb-claude-plugin`) now needs to stay in sync with
  `dist/bundles/*.mjs` as this repo's engine evolves — the exact sync mechanism (a publish step,
  a vendored copy, or something else) is left to Phase 1 implementation, not decided here.
- Two supported Claude Code install paths now coexist (plugin, recommended; `vfkb init`,
  fallback) — acceptable since no evidence yet supports retiring `vfkb init` for CI/scripted
  consumers.
- Sets the template for any future Pi-native or Antigravity packaging: each gets its own dedicated
  repo/branch pointing at the same harness-agnostic bundles, never a shared monorepo subdirectory
  — the exact lesson Phase 0 surfaced for Claude Code generalizes directly.
- Unblocks RFC-020 (OKF): its proposed `vfkb:okf` skill now has a concrete plugin home to target.
