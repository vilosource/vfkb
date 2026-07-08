---
type: Decision
title: "ADR-0039: v2 session backbone — real session identity from hook stdin (accepts RFC-014)"
description: "v2 session backbone — real session identity from hook stdin, entry attribution (accepts RFC-014; `--resume` id-stability precondition verified live)"
status: "Accepted"
timestamp: 2026-07-06
---

# ADR-0039: v2 session backbone — real session identity from hook stdin (accepts RFC-014)

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** operator + Claude
- **Accepts:** [RFC-014](../rfc/RFC-014-session-backbone.md) (full analysis lives there). **Its
  acceptance precondition was verified live before this acceptance** — see Context.
- **Relates:** [ADR-0020](ADR-0020-session-continuity-record.md) (the session record this switches
  on), [ADR-0033](ADR-0033-session-end-continuity.md)/[ADR-0034](ADR-0034-b1-handoff-nudge.md)
  (GAP-1/GAP-2, closed at the root), [ADR-0036](ADR-0036-v2-two-branch-strategy.md) (**builds on
  the `v2` branch**), NOTES corner case #13 (attribution). Foundational dependency of
  [ADR-0040](ADR-0040-native-concurrency-lock.md)/[ADR-0041](ADR-0041-entries-jsonl-merge-union.md).

## Context

`src/session.ts` already has the right per-session shape but is keyed off `KB_SESSION_ID`, which
**no verified harness sets** (this repo and vilonotes' kagent pod both — GAP-1). Claude Code's hook
contract delivers a real `session_id` on every hook's stdin, and `src/cli.ts`'s `session-end`
handler already parses it (proven in-repo pattern, currently used only to tag the auto-commit).

**Acceptance precondition (RFC-014 Open items) verified 2026-07-06, CLI v2.1.201:** a live
two-turn probe (fresh `claude -p`, then `claude -p --resume <id>`; a Stop hook logging its stdin)
observed the **same `session_id`** delivered to the hook on both turns — session state keyed on it
accumulates correctly across a resumed conversation. Recorded as a brain gotcha; re-verify if the
CLI major-changes.

## Decision

1. **`cli hook <sub>` reads `session_id` from its own stdin JSON** and uses it as the effective
   session id; `KB_SESSION_ID` becomes an optional override. Closes GAP-1 for every Claude Code
   invocation with zero harness-side wiring changes.
2. **`SessionData` gains an identity/attribution surface:** `agentRole`/`agentLabel` (when known),
   git branch at session start, `pid`.
3. **Every entry written during a session is stamped with `session_id`** (new optional envelope
   field — additive; breaking changes allowed in v2).
4. **`SessionState.records()` is the documented concurrent-session registry** other v2 mechanisms
   consult (the ADR-0040 lock's holder logging; future contradiction checks).

## Definition of Done

Agent-driven scenario (agent-observable behavior): two sessions against one brain dir with
`KB_SESSION_ID` unset — each session's `.sessions/<id>.json` accumulates across turns, entries
stamped with the right `session_id`. **Must-fail arm:** the pre-fix code shows ephemeral state.

## Consequences

- Session continuity (ADR-0020's digest, resume-notes) starts actually persisting in real harness
  wiring — the mechanism existed; this switches it on.
- Entry-level attribution becomes structural, independent of the shared git commit identity.
- **This is v2 code: it builds on the `v2` branch (ADR-0036), first in the v2 order** — RFC-015's
  lock and future session-aware features depend on it.
