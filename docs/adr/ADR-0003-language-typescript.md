---
type: Decision
title: "ADR-0003: Implementation language = TypeScript"
description: "Implementation language = TypeScript"
status: "Accepted"
timestamp: 2026-06-01
---

# ADR-0003: Implementation language = TypeScript

- **Status:** Accepted
- **Date:** 2026-06-01
- **Deciders:** operator + Claude
- **Supersedes:** the prior position (vfkb-DESIGN D6a, original) that vfkb would
  be written in **Python**. That position is preserved below under *Alternatives*
  as the superseded reasoning.

## Context

vfkb needs three faces over one engine: an **MCP server** (the cross-harness
query/write baseline — the fleet is multi-harness: architect on Pi, executor/judge
on Claude Code CLI), a **thin CLI**, and — crucially (D7) — an **automatic
context-injection + passive-capture layer** that hooks each harness's agent loop.

The Pi auto-injection extension is itself a **JavaScript module**. So the decisive
question is which language lets that extension and the engine be **one in-process
codebase**, the way mykb achieves its deep Pi integration today.

## Decision

Implement vfkb in **TypeScript.** One TS engine (storage/index/git/scoring) with
an in-process Pi extension, a Claude Code hooks adapter that shells to the engine
CLI/MCP, an MCP server, and a thin CLI.

## Consequences

- **+** The Pi auto-injection extension and the engine share **one in-process TS
  codebase** — the property that makes mykb's integration deep, preserved.
- **+** Keeps lineage continuity with mykb (the spike is TS), so its lessons and
  patterns translate directly even under a clean reimplementation (ADR-0002).
- **−** A TypeScript/Node runtime in agent images (vs a single static Go binary).
  Accepted: the controller already invokes Node/CLI subprocesses, and an MCP
  server in Node is unremarkable.
- **Neutral:** vfkb does not match the Django/Python orchestration stack — but it
  is a separate product/repo (D1), so stack-matching was never a real constraint.

## Alternatives Considered

- **Python (the superseded prior decision).** Original rationale: (1) "the
  platform — vtaskforge/vafi — is Python," stack alignment; (2) "embeds natively
  as CLI + MCP in agent images, no Node runtime in pods." **Why superseded:**
  reason (2) argues against *TypeScript* but does **not** favor Python over Go (Go
  gives a *better* single-static-binary image story than Python). Reason (1) is
  weak because vfkb is a separate repo that need not match the orchestration
  stack. Decisively, **Python forces the Pi extension to shell out** instead of
  sharing the engine in-process — sacrificing exactly the deep integration that is
  vfkb's signature value.
- **Go.** Best "drop a single static binary into any agent image" story, and
  aligns with other Viloforge Go work — but, like Python, it cannot host the Pi
  extension in-process (the extension must be JS). Rejected for the same
  in-process reason that selected TS.
