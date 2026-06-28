# vfkb — working context

You are working in the **vfkb** repository: a knowledge substrate for LLM coding
agents. It captures, indexes, and serves project knowledge (facts, decisions,
gotchas, patterns) across sessions. Faces: a CLI, Claude Code hooks, and an MCP
server.

## Your knowledge tool

This session is wired to a **vfkb** knowledge store (MCP server `vfkb` + session
hooks). Treat it as your project memory:

- **Recall before you act.** Use the `vfkb` MCP tools (search / query / map) to
  pull what's already known about the area you're touching. Relevant knowledge is
  also injected at session start.
- **Capture what you learn.** When you discover a durable fact, make a decision
  (record the *why*), hit a gotcha, or establish a pattern, add it through the
  `vfkb` tools — not by editing files directly. The engine is the sole writer; it
  keeps the index, freshness, and no-secrets invariants.
- Direct writes into the knowledge store are blocked by design. Editing code in
  this repo is normal and unrestricted.

## Repo orientation

- `src/` — engine + faces (`cli.ts`, `mcp-server.ts`, `pi-extension.ts`).
- `docs/` — `DESIGN.md`, `FEATURES.md`, `IMPLEMENTATION-PLAN.md`, and
  `docs/adr/ADR-0001..0015` + `docs/adr/README.md`.
- `scenarios/` — the L4 purpose-evaluation harness.
- Build + test: `npm run build` then `npm test`.
