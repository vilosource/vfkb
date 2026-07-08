---
type: Decision
title: "ADR-0006: Context Map — a derived navigational artifact (v1 = Index/Topology)"
description: "Context Map — a derived navigational artifact (v1 = Index/Topology)"
status: "Accepted"
timestamp: 2026-06-01
---

# ADR-0006: Context Map — a derived navigational artifact (v1 = Index/Topology)

- **Status:** Accepted
- **Date:** 2026-06-01
- **Deciders:** operator + Claude

## Context

vfkb has `kb_search` (pull — you must know what to search for) and the project
**context doc** (D-O8 — a readable *narrative*). It lacks a **navigational index**
that tells an agent *what knowledge exists and where* before fetching — the ASDLC
*Context Map* (Index/Topology + Glossary + Routing Table), whose purpose is to
counter "**Hallucination by Omission**" (the agent invents a decision because it
didn't know one existed).

## Decision

Adopt the Context Map, **derived-first** and **distinct from the context doc**:

- **Derived-first:** rebuilt deterministically from the manifest/areas/tags/refs/
  entry-counts (like the SQLite index), so it is always current with zero
  maintenance (engine-owns-rebuild, D4/D6). The authored context doc and the
  derived map have **separate lifecycles** and stay separate artifacts; the map
  *points into* the entries the doc narrates.
- **v1 scope = the Index/Topology layer ONLY** — auto-injected at session start
  (compact, stable, cache-friendly) as the always-on orientation.
- **Deferred** (designed-now, built-when-corpus-warrants): the **Glossary** and
  **Routing Table** layers — primarily a **global-tier** ("Viloforge KB", D2)
  concern where the corpus is large. (ASDLC *Minimal Scaffolding* — "gates earn
  their place".)

## Consequences

- **+** Agents see *what exists* → fewer omission-hallucinations; better-targeted
  pulls.
- **+** The Index/Topology layer is **near-free** (mykb's manifest already
  produces topology) and is exactly the compact, stable thing D7 wants at session
  start.
- **+** Clean lifecycle separation (derived index vs authored narrative).
- **−** One more rendered/injected artifact (small for the index layer).

## Alternatives Considered

- **Merge the map into the context doc** — rejected: mixes a derived index with an
  authored narrative in one file, fighting git/merge and the rebuild model.
- **Defer the Context Map entirely** — rejected: the Index/Topology layer is
  near-free and high-value for D7; deferring all of it leaves easy value unbanked.
