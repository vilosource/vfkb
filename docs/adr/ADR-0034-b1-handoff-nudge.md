# ADR-0034: GAP-1 B1 — the agent-authored handoff nudge (settles RFC-011 §B)

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** operator + Claude
- **Settles:** [RFC-011](../rfc/RFC-011-session-end-continuity.md) **§B open items #2 (the GAP-1
  surface) and #3 (the trigger)** — the central open design question ADR-0033 left open. Chooses
  **B1 + B2** (the Stop-hook nudge *plus* the SessionEnd floor), empirically settled by the metered L4.
- **Extends:** [ADR-0033](ADR-0033-session-end-continuity.md) (GAP 2 auto-commit + the GAP-1 **B2**
  deterministic floor). ADR-0033 is unchanged (immutable, ADR-0001); it explicitly deferred B1 as an
  "open follow-on, built only on evidence/explicit request." This ADR records that build.
- **Relates:** [ADR-0027](ADR-0027-stop-hook-decision-capture-reminder.md) (the Stop-hook reminder
  pattern B1 reuses), [ADR-0021](ADR-0021-auto-distill-and-curator.md) (a prose rule with no Brake gets
  ignored → a mechanism), [ADR-0022](ADR-0022-l4-evaluation-methodology.md) (DEMONSTRATED ≥2/3),
  [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md) (proof fits the capability), gotcha
  `e8f324dc3c1a` (`KB_SESSION_ID` unset in the live wiring), gotcha `d70c0299e144` (Stop contract:
  `stop_hook_active` native loop guard).

## Context

ADR-0033 shipped GAP-1's **B2 floor**: at SessionEnd, if the session recorded no `handoff`/`next`
entry, `writeAutoHandoff` (src/session-end.ts) commits a deterministic fallback `fact` tagged
`handoff,next,auto` that **enumerates** the session's new entries. It guarantees a committed forward
pointer, but only a machine list — ADR-0033 flagged this as a "**low-quality floor** (an entry list,
not a curated `next: …`)" and left the higher-quality **B1** nudge open.

RFC-011 §B named the crux: the Stop hook is the *only* surface that can prompt the agent (SessionEnd
cannot inject — verified, gotcha `f0e913b97824`), but it fires **per turn** while a handoff is an
**end-of-session** artifact. A naive Stop nudge would nag from turn 1. The open question (#2/#3) was
whether a survivable trigger exists, and whether the agent-authored handoff is actually *better* enough
to justify the mechanism.

## Decision

Build **B1 as a second nudge on the existing Stop hook** — no new hook, no `.claude/settings.json`
change (B1 rides the Stop hook already wired for ADR-0027). `src/stop-reminder.ts` `decideStop` now
**composes** a handoff nudge alongside the decision nudge:

- **Trigger (#3):** `!stop_hook_active` **and** `uncommittedWork` (substantive `src/`/`docs/` change)
  **and** `newEntries ≥ HANDOFF_MIN_ENTRIES` (=3, a strong-signal amount of accumulated knowledge)
  **and** `newHandoffs === 0` (no `handoff`/`next` entry recorded this session).
- **Self-silencing without session state:** `KB_SESSION_ID` is unset in the live wiring (gotcha
  `e8f324dc3c1a`), so "fire at most once per session" cannot use session state. It doesn't need to —
  the moment the agent records *any* `handoff`/`next` entry, `newHandoffs > 0` and the trigger goes
  quiet. The side-effect the nudge asks for is its own guard (exactly how the ADR-0027 decision nudge
  self-limits once a `decision` is recorded). The signal is the same git-HEAD-delta both hooks already
  use, generalized into `newBrainEntriesSinceHead()`.
- **Conditional framing:** the reminder says *"if you are WRAPPING UP, record a handoff … if you are
  still mid-session, ignore this"* — so a mid-session fire is declinable, and the B2 floor still catches
  the case where the agent never writes one.
- **Composite:** when both the decision and handoff nudges trigger, their reminders are joined into one
  `additionalContext` block.

**B2 stays the deterministic backstop.** B1 upgrades the *quality* of the floor when the agent is
present to author a real `next:`; B2 guarantees *something* committed regardless. Together (**B1+B2**)
`/exit` leaves a committed handoff that is agent-authored when possible, enumerated otherwise.

## Definition of Done (ADR-0029) — proof fits the capability

B1 is **agent-facing**, so the proof is an **agent-driven L4 scenario**, not just a unit test:
`scenarios/session-end-handoff.mjs`. The only variable is the Stop hook (B1); the B2 floor + real vfkb
MCP + PreToolUse gating + SessionEnd auto-commit are wired in **both** arms (faithful B1+B2 vs B2-only),
on a topic branch. A task forces ≥3 knowledge entries + a `src/` change but **never mentions a
handoff** — the handoff is the observable, driven purely by the nudge. The metric is an **agent-authored**
handoff (tagged `handoff`/`next` but **not** `auto`), so B2's fallback does not count.

**Result (observed, not asserted — claude-haiku-4-5, N=3, 2026-07-01, CLI v2.1.197):**
**DEMONSTRATED — vfkb (B1 ON) 3/3 agent-authored handoffs (all recalled), baseline (B1 OFF) 0/3**
(each baseline trial got only the B2 `auto` floor). The quality delta is visible in the artifacts:
baseline floor = *"review these entries and record an explicit next"*; B1 = *"Next session: implement
config loader … Logger is ready at src/log.ts … watch for the serialization gotcha when logging
Errors."* Record: `scenarios/records/session-end-handoff.json`.

Deterministic inner gate: `test/stop-reminder.test.ts` (now 16 cases — added: handoff nudge fires at
threshold; below threshold no-op; self-silences once a handoff exists; no nudge without work; composes
with the decision nudge; loop guard wins; two CLI-e2e cases through the real hook). **153/153 unit
green.**

Capable of failing (baseline arm), isolated from the live `.vfkb`, observed before declaring done.

## Consequences

- **+** The guaranteed session-end handoff is now **agent-authored (high quality)** whenever the agent
  is present, falling back to the B2 enumeration only when it isn't — closing the quality gap ADR-0033
  named. `/exit` continuity is both durable (GAP 2) and useful.
- **+** Zero new wiring — B1 is a pure `decideStop` composition on the already-approved Stop hook; it
  reaches live sessions once `dist/bundles/` is rebuilt ($VFKB_BUNDLE_DIR).
- **+** Re-confirms the Stop `decision:block` + `additionalContext` contract still holds at CLI
  **v2.1.197** (originally verified v2.1.195).
- **−** **Premature-nag risk is inherent** to the per-turn Stop surface — a hook cannot know the session
  is about to end. Mitigated (not eliminated) by the strong-signal threshold, the conditional framing,
  and self-silencing; the B2 floor covers a declined nudge.
- **−** `HANDOFF_MIN_ENTRIES = 3` is a heuristic; a session that records <3 entries gets only the B2
  floor (acceptable — little to hand off).
- **−** Contract remains version-pinned (re-verify on a Claude Code upgrade), consistent with ADR-0033.

## Alternatives Considered

- **B2-only (status quo of ADR-0033).** Rejected now that the L4 shows B1 adds real, recallable quality
  (3/3 curated `next:` vs 0/3) at zero extra wiring.
- **B1-only (drop the B2 floor).** Rejected — the per-turn nudge cannot guarantee an end-of-session
  handoff (the agent may decline every fire); B2 is the deterministic guarantee. Keep both.
- **A separate SessionEnd auto-*derive* from `transcript_path` (transcript NLP) as B1's mechanism.**
  Rejected — SessionEnd cannot prompt, and a machine summary is the same low-quality class as B2; the
  Stop nudge gets a genuinely agent-authored artifact.
- **Track "fired once" via a marker file / `KB_SESSION_ID`.** Rejected — `KB_SESSION_ID` is unset
  (gotcha `e8f324dc`) and a marker file is state to manage; self-silencing on the recorded handoff is
  simpler and needs no state.
