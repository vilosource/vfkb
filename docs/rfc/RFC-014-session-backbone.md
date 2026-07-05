# RFC-014: Session backbone — real session identity from hook stdin, widened for attribution

- **Status:** Proposed
- **Date:** 2026-07-05
- **Deciders:** operator + Claude
- **Relates:** [ADR-0020](../adr/ADR-0020-session-continuity-record.md) (the session-continuity
  record this extends), [ADR-0033](../adr/ADR-0033-session-end-continuity.md) /
  [ADR-0034](../adr/ADR-0034-b1-handoff-nudge.md) (GAP-1/GAP-2, which this closes at the root),
  `docs/V2-VISION.md` §1/§2, `docs/NOTES-multi-agent-concurrency-corner-cases.md` (corner case
  #13, attribution)

## Context

`src/session.ts` already implements the right shape: per-session state keyed as
`<brain>/.sessions/<sessionId>.json`, one file per session id, never a shared mutable
singleton. This is a deliberate carry-forward of mykb's own lesson (L4, per
`docs/IMPLEMENTATION-PLAN.md` §2): mykb's single global `.active` workspace pointer let
concurrent sessions clobber each other; vfkb's answer was per-session isolation via
`KB_SESSION_ID`, from day one.

The mechanism is right; it just isn't switched on. Verified this session in **two
independent harnesses**: this repo's own `.claude/settings.json` (four hooks — SessionStart,
PreToolUse, Stop, SessionEnd) and vilonotes' identical wiring inside its kagent-hosted
researcher pod. **Neither sets `KB_SESSION_ID`.** Per `SessionState.load()`, no id means
ephemeral in-memory state — nothing persisted, matching the already-recorded GAP-1 finding.

Separately, `SessionData` today only carries resume-digest bookkeeping (`injectedIds`,
`capturedIds`, `note`, `signals`, `turnCount`) — nothing that identifies *who* wrote an
entry beyond the coarse `author.role` already on the envelope (ADR-0011). Corner case #13
(`docs/NOTES-multi-agent-concurrency-corner-cases.md`): every agent shares one git identity,
so `git blame`/`log` can't distinguish which agent produced which change. The same gap
exists one layer down, in the knowledge entries themselves.

## Decision

1. **`cli hook <sub>` reads `session_id` from its own stdin JSON payload** and uses it as
   the effective session id internally. Claude Code's hook contract already delivers a real
   `session_id` on every invocation (verified this session for `Stop`/`SessionEnd` payloads).
   `KB_SESSION_ID` becomes an optional override (e.g. for non-Claude-Code harnesses that
   can't supply stdin the same way), not the only path — so this closes GAP-1 for every
   Claude Code invocation with **zero harness-side wiring changes**.
2. **`SessionData` gains an identity/attribution surface:** `agentRole`/`agentLabel` (when
   known), the git branch at session start, and `pid`.
3. **Every entry written during a session is stamped with `session_id`** (new optional
   field on the stored envelope — additive, breaking changes allowed in v2) — independent
   of what git commit identity is later used to land it.
4. **`SessionState.records()` is documented and exposed as the concurrent-session
   registry** other v2 mechanisms consult — RFC-015's lock (session-aware logging of who
   holds it) and any future contradiction check (RFC-012) can ask "which other sessions are
   active against this brain right now" instead of operating blind.

## Alternatives Considered

- **Keep requiring the `KB_SESSION_ID` env var, fix each harness's wiring individually** —
  rejected: verified to independently fail in two separate harnesses already (this repo and
  vilonotes' kagent pod); doesn't scale to the next harness either.
- **Mint a random session id inside vfkb itself when none is provided** — rejected: a fresh
  random id per hook invocation wouldn't accumulate correctly turn-over-turn within the
  *same* conversation. The id must come from the harness's own stable session identifier,
  not be invented locally.
- **Stamp only `agent_id`, skip `session_id` on entries** — rejected: `session_id` is the
  thing actually guaranteed unique and available today; a separate durable `agent_id`
  concept (e.g. "this is always the researcher agent" vs. "this is always the architect
  agent") is a real future need but is out of scope here — nothing today assigns one.

## Definition of Done (ADR-0029)

Agent-driven scenario, not just unit tests (this is agent-observable behavior): two
sessions run against one brain dir with `KB_SESSION_ID` unset. Assert each session's
`.sessions/<id>.json` accumulates correctly across multiple hook invocations (turns) of the
*same* conversation, and entries added in each session are stamped with the right
`session_id`. **Must-fail arm:** the same scenario against the pre-fix code — session state
must be ephemeral (regression guard, proves the scenario can actually fail).

## Open items

- **Verify, don't assume:** does Claude Code's hook-stdin `session_id` stay the *same*
  value across multiple `claude -p --resume <id>` invocations of one conversation? This is
  expected `--resume` behavior and consistent with how vilonotes' `run.py` already reuses
  the id it captures, but it hasn't been independently probed live. Cheap pre-flight check
  before or during the build, not a blocker to drafting this RFC.
