---
type: Decision
title: "ADR-0031: A committed bootstrap guards engine resolution and informs the user when `$VFKB_HOME` is unset"
description: "A committed bootstrap guards engine resolution and informs the user when `$VFKB_BUNDLE_DIR` is unset"
status: "Accepted"
timestamp: 2026-06-30
---

# ADR-0031: A committed bootstrap guards engine resolution and informs the user when `$VFKB_HOME` is unset

- **Status:** Accepted
- **Date:** 2026-06-30
- **Deciders:** operator + Claude
- **Amends:** [ADR-0030](ADR-0030-consumer-integration-and-distribution.md) — refines its locked wiring
  entry-point ("committed wiring references `node "$VFKB_HOME/vfkb.mjs"`") to go through a committed
  bootstrap. **Relates:** [ADR-0028](ADR-0028-sandbox-validate-auto-layer-wiring.md) (the wiring this
  guards), [ADR-0027](ADR-0027-stop-hook-decision-capture-reminder.md) (the Stop hook it must not
  break). Brain: decision `53f4ad28`.

## Context

ADR-0030 (FR-2) made the consumer wiring reference the engine via `$VFKB_HOME` directly
(`node "$VFKB_HOME/vfkb.mjs" …`, `${VFKB_HOME}/vfkb-mcp.mjs`). That is portable, but its failure mode
when a consumer (or our own future live-wired session) has **`VFKB_HOME` unset** is bad:

- the shell expands the unset var to nothing → `node /vfkb.mjs` → a **cryptic `Cannot find module`**
  stack trace, with no hint that the fix is "set `VFKB_HOME`";
- a **`PreToolUse` hook that errors could block every Write/Edit** — a broken knowledge layer would
  halt normal work;
- `.mcp.json` relied on **`${VFKB_HOME}` argument expansion**, an uncertain/undocumented Claude Code
  behaviour.

The operator asked for a guardrail: the user must be **informed** ("set `VFKB_HOME`"), with a graceful
degrade — not a stack trace, and never a blocked session.

## Decision

`vfkb init` writes a small, **committed, self-contained bootstrap** at a **relative** path,
`.vfkb/bin/bootstrap.mjs`, and the wiring calls it instead of `$VFKB_HOME/…` directly:

- `.mcp.json` → `node .vfkb/bin/bootstrap.mjs mcp`
- hooks → `… node .vfkb/bin/bootstrap.mjs cli hook <session-start|pre-tool-use|stop>`

Because the bootstrap is committed at a relative path, it is **always resolvable** in any clone. It
resolves the real engine via **`$VFKB_HOME` at runtime** and **degrades gracefully** when that is unset
or the bundles are missing:

- **SessionStart** → emits a valid hook payload whose `additionalContext` is a clear **⚠️ "vfkb is
  INACTIVE: VFKB_HOME is not set — here's the fix"** banner, so the user is informed *in-session*;
- **PreToolUse / Stop** → exit 0 (never block a write, never error a turn);
- **MCP** → a clear stderr note, clean exit (no crash).

When `$VFKB_HOME` resolves, the bootstrap runs the engine transparently (stdio passed through). The
bootstrap carries a version marker so `vfkb init` **upgrades** an older one in place. `vfkb doctor`
checks it is present; the env-read also **removes the `${VFKB_HOME}` arg-expansion dependency**.

## Consequences

- **+** An unset/misconfigured `VFKB_HOME` produces an **actionable message**, never a stack trace, and
  **never blocks work** — the guardrail the operator asked for, and the safety net for our own live
  migration to `$VFKB_HOME`.
- **+** The committed relative entry-point travels with the repo (always resolvable); drops the
  uncertain `${VFKB_HOME}` expansion.
- **−** One extra (thin, stdio-relaying) Node process per hook/MCP invocation.
- **−** A small committed file in every consumer repo (`.vfkb/bin/bootstrap.mjs`), engine-regenerated;
  it is Node (cross-platform) but the surrounding hook env-prefix is still POSIX (consistent with the
  prior wiring; Windows remains out of scope).

## Alternatives Considered

- **Inline guards in each hook command.** Rejected — three copies of the same shell guard, brittle and
  hard to upgrade.
- **Reference `$VFKB_HOME` directly (ADR-0030 status quo).** Rejected — the cryptic-failure /
  blocked-writes problem this fixes.
- **A POSIX shell shim.** Rejected in favour of a Node bootstrap (no extra shell-portability surface;
  Node is already required).

## Related

[ADR-0030](ADR-0030-consumer-integration-and-distribution.md). Inner gate: `src/bootstrap.test.ts`
(+ `src/init.test.ts`). Guard verified end-to-end: the consumer-onboarding scenario still DEMONSTRATED
against the bootstrap wiring. Brain: decision `53f4ad28`.
