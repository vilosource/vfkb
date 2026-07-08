---
type: Decision
title: "ADR-0013: No hard native dependency; pluggable `Index` with a pure-JS in-memory default, SQLite/FTS5 an optional backend"
description: "No hard native dep; pluggable `Index`, pure-JS in-memory default, SQLite/FTS5 optional (D-C)"
status: "Accepted"
timestamp: 2026-06-03
---

# ADR-0013: No hard native dependency; pluggable `Index` with a pure-JS in-memory default, SQLite/FTS5 an optional backend

- **Status:** Accepted
- **Date:** 2026-06-03
- **Deciders:** operator (delegated "find the best solution") + Claude

## Context

mykb compiled `better-sqlite3` (a **native** module) in-container; IMPL-PLAN L6
records this as real deployment pain, and notes pi-mem demonstrated a **no-native-
dep** memory in ~460 LOC. vfkb's engine must bake into **four** agent images
(`vafi-developer:{claude,agy,pi,gemini}`), and the **deployment/loading path is
vfkb's #1 risk** (mykb's single hardest lesson; Phase 0 owns it). JSONL is the
source of truth; SQLite/FTS5 was only ever the *disposable mirror*.

Why SQLite was load-bearing for mykb but is **not** for vfkb v1:

- mykb is invoked **process-per-CLI-call** over a multi-area, potentially large
  single-user brain → a persistent SQLite cache avoided rebuilding an index every
  invocation.
- vfkb's hot paths are **long-lived processes**: the Pi auto-layer is an
  **in-process TS extension**; the Claude Code path is a **long-lived MCP server**.
  Both hold the index in memory across calls → there is no per-call rebuild cost to
  amortize. Only the thin debug CLI is process-per-call, and it is not a hot path.
- The per-project tier is **flat and small** (D2e): a pure-JS in-memory inverted
  index over a few hundred small JSONL entries rebuilds in well under the hook
  latency budget.

So at v1 scale, SQLite/FTS5 buys little and costs the exact native-compile pain
mykb suffered across images.

## Decision

**No hard native dependency.** The engine MUST load and operate with zero native
modules compiled.

1. **`Index` is a pluggable interface** (search / candidate / rebuild).
2. **v1 default = pure-JS in-memory index**: JSONL is scanned at process start into
   an in-memory inverted index + BM25-style scorer, held for the life of the
   long-lived process. (Concrete impl — hand-rolled vs a pure-JS library such as
   MiniSearch/FlexSearch — is a Phase-1 detail, **not** load-bearing here, and to be
   confirmed against the real library at Phase 1; no native module either way.)
3. **`better-sqlite3` FTS5 is an OPTIONAL backend** behind the same interface,
   **auto-detected** at startup. If the native module is present it MAY be used
   (e.g. for a future large/global tier); if absent the engine **degrades
   gracefully** to the pure-JS index — it never hard-fails on a missing native
   module.
4. **JSONL remains the source of truth** (validated by mykb, carried forward). The
   index — in whichever backend — is always rebuildable from JSONL.

This **inverts** mykb's storage posture (SQLite-primary → JSON-source) into
**JSON-source → in-memory-index-primary, SQLite-optional**.

## Consequences

- **+** Directly kills mykb's worst pain: the four agent images deploy with **zero
  native compilation**; the Phase 0 deployment spike is de-risked.
- **+** Adequate performance: in-process/long-lived MCP hold the index in memory;
  small corpus → microsecond–low-ms queries.
- **+** Cheap, frequent rebuilds are now affordable — which ADR-0014 leans on
  (rebuild-on-doubt freshness).
- **+** Upgrade path preserved: the SQLite/FTS5 backend slots in behind the `Index`
  interface for a future large/global tier without touching callers.
- **−** A pure-JS BM25 index must be implemented/chosen and kept correct (bounded:
  small surface, pi-mem-proven feasible, covered by retrieval-quality tests).
- **−** Two index backends to keep behaviourally equivalent **if** SQLite is ever
  enabled (mitigated: SQLite is off by default in v1; parity is a test concern only
  when adopted).

## Alternatives Considered

- **Hard `better-sqlite3` dependency (mykb's posture).** Rejected: re-incurs the
  in-container native-compile pain across four images — the documented #1 deployment
  risk.
- **No SQLite ever, pure-JS only, no interface.** Rejected: forecloses the FTS5
  accelerator for the future large/global tier; the pluggable interface costs almost
  nothing and keeps that door open.
