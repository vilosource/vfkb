---
type: RFC
title: "RFC-013: Cross-project brain query — read-only recall from a sibling project's `.vfkb`"
description: "Cross-project brain query — read-only, provenance-labeled recall from a registered sibling project's `.vfkb` (links registry + `kb_query_external`)"
status: "**Accepted → ADR-0038** (2026-07-06;"
timestamp: 2026-07-02
---

# RFC-013: Cross-project brain query — read-only recall from a sibling project's `.vfkb`

- **Status:** **Accepted → [ADR-0038](../adr/ADR-0038-cross-project-brain-query.md)** (2026-07-06;
  build queued in the Track 9 quality queue, scenario-contract-first)
- **Date:** 2026-07-02
- **Deciders:** operator + Claude
- **Relates:** [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) (the brain is a committed,
  portable artifact that travels with its repo), [DESIGN.md D2c/D2d/D2g](../DESIGN.md) (1:1
  single-homed per-project brain; **project knowledge is read *locally* from the clone**; per-project
  tier only), [ADR-0032](../adr/ADR-0032-env-var-rename-data-dir-bundle-dir.md) (`VFKB_DATA_DIR` as the
  canonical brain-dir env), [ADR-0030](../adr/ADR-0030-consumer-integration-and-distribution.md)
  (portable engine / consumer wiring), [ADR-0023](../adr/ADR-0023-scenario-contract-first.md) /
  [ADR-0029](../adr/ADR-0029-sandbox-proven-definition-of-done.md) (the DoD contract).

## Context

**The scenario.** An agent working in **Project A** clones **Project B** — because B is a dependency,
or A needs to understand how B works. Per [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md), B
ships its own committed `.vfkb/` brain: B's decisions, gotchas, and patterns travel *with* B's repo.
A's agent would rather **recall** that recorded knowledge than re-derive it by reading B's source. So
the ask: from inside A, query B's brain.

**This is D2d, not a new tier.** [DESIGN.md D2d](../DESIGN.md) already draws the line: *project*
knowledge is read **locally from the main-repo clone**; only *global* knowledge goes over MCP/API. A
has cloned B, so **B's `.vfkb` is already sitting on local disk** — reading it is a plain local file
read, no network and no service. This feature is D2d's local-read pattern pointed at a sibling
project's single-homed brain. It is explicitly **not** the parked global served tier
([D2f/D2g](../DESIGN.md), H3) — it is explicit, named, point-to-point recall between two per-project
brains, not a shared store.

**Half of it already works — verified, not asserted.** The read path is brain-dir-agnostic:
`brainDir()` resolves `VFKB_DATA_DIR` **fresh on every call** (`src/storage.ts:23`), and every read
(`search`/`query`/`map`/`context`/`list`/`get`) flows through `readAll()` → that same path
(`src/engine.ts:116`). So from A, a CLI recall of B's brain is already just an env override:

```bash
VFKB_DATA_DIR=/path/to/projectB/.vfkb node dist/cli.js search "how does auth work"
VFKB_DATA_DIR=/path/to/projectB/.vfkb node dist/cli.js map
```

That is fully functional **today** for scripting — read-only, no code change.

**The real gap is in-session.** The MCP server is spawned **once**, with `VFKB_DATA_DIR=.vfkb`
**pinned** in `.mcp.json`'s `env`. The nine `mcp__vfkb__kb_*` tools are therefore bolted to A's *own*
brain for the entire session — there is no per-call way to redirect them. So the actual consumer, an
**in-session agent**, has **no path** to B's brain. That missing surface — plus the ergonomics and
safety around it — is what this RFC decides.

## Decision (proposed)

**Provide a read-only surface to recall from a *registered* sibling project's brain — in-session (MCP)
and via CLI — that never writes to, mutates, or silently merges the foreign brain, and always labels
foreign results with their source.** Concretely, **B + C** of the design options weighed at proposal:
a small **links registry** feeding **one dedicated read-only tool/verb**.

1. **Links registry — `.vfkb/links.json` (committed, ADR-0019-consistent).** A small, reviewable map
   of a **logical name → path**, e.g.:
   ```json
   { "links": { "projectB": { "path": "../projectB/.vfkb", "note": "runtime dependency" } } }
   ```
   Paths resolve **relative to A's repo root** (the brain's parent / `$CLAUDE_PROJECT_DIR`), so sibling
   clones work across machines. Agents pass the **name**, never a raw path — stable, reviewable, and
   machine-portable. Managed by `vfkb link add <name> <path>` / `vfkb link list` (auto-suggesting from
   sibling dirs is a later nicety, not v1).

2. **One dedicated read-only surface — `kb_query_external` (MCP) / `vfkb query --source <name>` (CLI).**
   It exposes only recall (`search` + `map` + `context` + `get`), **never** `add`/`supersede`/
   `transition`. Under the hood it resolves `name → absolute path` from `links.json` and runs the
   existing `queryExplained` against that brain. Keeping this **off** the nine primary tools (rather
   than adding a `source` param to all five read tools) makes "you are reading *someone else's* brain"
   explicit at the call site, gives **one** place to enforce read-only + provenance, and keeps the
   primary tools single-brain and unambiguous.

3. **Provenance labeling — foreign results are marked, never merged.** Every entry returned from B is
   rendered with its source (`[projectB] gotcha …`) so A's agent treats it as *B's* claim and never
   folds it into A's brain silently. Foreign entries keep **their own** author roles / trust /
   staleness, rendered as-is from B's committed JSONL — vfkb does **not** re-verify a foreign brain.

4. **Strictly read-only, enforced structurally.** The external surface has **no write verbs at all**;
   it cannot reach `addEntry`/`supersede` against the foreign dir — read-only is an API property, not a
   runtime check. B's brain integrity is guaranteed, and A's `SessionEnd` auto-commit
   ([ADR-0033](../adr/ADR-0033-session-end-continuity.md)) is unaffected (it is pathspec-scoped to A's
   own `.vfkb`).

**Implementation seam.** Because `readAll`/`queryExplained` already resolve the brain via `brainDir()`,
the tool is a thin wrapper. Prefer a **small refactor letting the read functions take an explicit
`brainDir` argument** over mutating `process.env` per call — explicit threading stays reentrant and
fleet-safe (concurrent writers/readers in one process never race on a shared env), and it improves
test ergonomics generally (the tests already juggle `VFKB_DATA_DIR`).

## Definition of Done (ADR-0023/0029 — scenario-contract-first)

- **L4 `cross-project-recall`** (named here as the contract): a sandbox with **two** brains — **A**
  (seeded with A's own fact) and **B** (seeded with a distinct fact only B knows, e.g. *"projectB
  serves its API on port 7000"*), with **B registered as a link** in A's `links.json`. The task asks
  A's agent a question answerable **only** from B's brain (*"what port does the projectB dependency
  serve on?"*). **vfkb arm:** the agent returns B's fact, **provenance-labeled `[projectB]`**, and A's
  own brain is **unchanged** — no new entry, B's fact **not** copied into A. **Contrast arm** (no link
  registered / tool absent): the agent cannot answer from knowledge and must fall back to reading B's
  source. **Run RED on both harnesses before the build;** DEMONSTRATED ≥2/3 ([ADR-0022](../adr/ADR-0022-l4-evaluation-methodology.md)).
- **Deterministic inner gate:** unit fixtures for the resolver + reader — a name resolves to B's path
  and returns B's entries with a source label; an unknown/invalid `source` yields an **honest
  no-match/error, not a crash** ([ADR-0018](../adr/ADR-0018-honest-no-match-contract.md) spirit);
  querying external **never touches A's `entries.jsonl`** (asserted read-only against A too); and the
  external surface exposes **no** write path (a foreign write is an API impossibility, asserted).

## Consequences

- **New committed artifact `.vfkb/links.json`** — small, reviewable, travels with A
  (ADR-0019-consistent). It is authored config (like `context.md`), so it is **committed**, not
  gitignored.
- **Tool count 9 → 10** (`kb_query_external`) plus one CLI verb (`vfkb query --source`) and a `vfkb
  link` management pair. The tool description documents the `[source]` provenance-label contract so
  agents interpret prefixed results correctly.
- **Read path gains an optional explicit `brainDir` parameter** (small refactor). No new deps, no
  schema change, no new entry type, no write path, no effect on the PreToolUse brain-write gate (there
  are no writes here).
- **Trust boundary is explicit:** B's entries carry B's author roles; A's agent must treat them as B's
  claims — the provenance label *is* that signal. A stale entry in B's brain is B's problem to
  supersede, surfaced honestly to A rather than silently trusted.
- **Scope stays per-project (D2g).** This is not H3; no global store, no service, no promotion — just
  named local links between single-homed brains.

## Alternatives considered

- **Env override only (today's CLI reality).** Already works for scripting (verified above), but the
  MCP server's dir is pinned at spawn, so the **in-session agent** — the real consumer — has no path.
  Necessary-but-insufficient; this RFC exists to close exactly that gap.
- **`source` param on all five read MCP tools.** Spreads foreign-brain handling across every read tool,
  widens five schemas + descriptions, and blurs the read-only boundary (invites an eventual foreign
  write through a shared code path). Rejected in favor of one explicit, obviously-read-only tool.
- **Raw filesystem path as the tool argument (no registry).** Lets an agent pass arbitrary paths —
  unreviewable, brittle across machines, and a mild traversal footgun. Registry **names** are stable,
  reviewable, and portable (the path resolves locally, per machine). Rejected.
- **A second MCP server per external project (multi-server `.mcp.json`).** Static — doesn't scale to
  an *ad-hoc* clone the agent decides to consult mid-session — and duplicates the engine per project.
  One tool + a registry is lighter and dynamic. Rejected.
- **`import` B's entries into A's brain (existing machinery).** Conflates two brains, duplicates
  knowledge that then goes stale independently, and violates the "B's brain is B's truth" boundary.
  `import` is for **migration**, not **live cross-project recall**. Rejected.
- **Global served tier (H3 / D2f–D2g).** Overkill and parked; this is point-to-point local recall, not
  a shared store or a promotion path. Deferred to whenever H3 is actually forked.
