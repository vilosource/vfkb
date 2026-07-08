---
type: Decision
title: "ADR-0027: A conditional Stop-hook decision-capture reminder (accepts RFC-008)"
description: "Reliable decision capture — a conditional end-of-turn (Stop-hook) reminder"
status: "Accepted"
timestamp: 2026-06-29
---

# ADR-0027: A conditional Stop-hook decision-capture reminder (accepts RFC-008)

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** operator + Claude
- **Accepts:** [RFC-008](../rfc/RFC-008-decision-capture-reminder.md) (the proposal + the empirically
  verified Stop-hook contract).
- **Relates:** [ADR-0015](ADR-0015-cross-harness-auto-layer.md) (P1 / Tier-C per-turn injection —
  the external-blocked alternative this works around), [ADR-0021](ADR-0021-auto-distill-and-curator.md)
  (the "a prose rule with no Brake gets ignored" lesson that motivates this),
  [ADR-0023](ADR-0023-scenario-contract-first.md) (the scenario-as-DoD rule, and why this feature is an
  exception), `CLAUDE.md` ("Capturing decisions" standing rule), [RFC-009](../rfc/RFC-009-l4-harness-and-platform-probes.md)
  (the decoupled, evidence-gated harness work).

## Context

Decisions made during a session are captured only by a soft `CLAUDE.md` prose rule. vfkb's own lesson
(ADR-0021): a prose rule with no Brake gets ignored. The timely, mechanical alternative — per-turn
context injection via `UserPromptSubmit` (P1 / ADR-0015 Tier C) — is external-blocked upstream. We want a
stronger, well-timed nudge at end-of-turn without forcing a deterministic Brake we cannot build (a hook
cannot detect that a "decision" was made).

The `Stop` hook contract was **empirically verified at Claude Code CLI v2.1.195** (a Tier-0
platform-contract probe; brain gotcha `d70c0299e144`; print mode and stdin-piped non-print mode behave
identically):

- a `Stop` hook fires at end-of-turn;
- emitting `{"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","additionalContext":"…"}}`
  **continues the turn** with that text as agent context (an injected sentinel was echoed back);
- the harness passes **`stop_hook_active`** — `false` on the first fire, `true` on our own re-entry — the
  **native loop guard** (no marker file needed). This corrected RFC-008's earlier guide-asserted finding
  that v2.1.195 had no such guard;
- the Stop stdin is rich (`cwd`, `session_id`, `transcript_path`, `last_assistant_message`, `effort`).

## Decision

Add a **conditional, once-per-turn `Stop` hook** — `vfkb hook stop` (`src/stop-reminder.ts` +
`src/cli.ts`) — closer to a Brake than a nag:

1. **Native loop guard.** If `stop_hook_active` is true (our own re-entry), allow the stop immediately
   (git-free short-circuit). Defense-in-depth: the pure `decideStop` also honors the flag.
2. **Conditional trigger (the heuristic).** Block — injecting the reminder once — only when a decision
   *plausibly* went unrecorded: the working tree has uncommitted **`src/`/`docs/`** changes **AND** the
   append-only brain gained **no new `decision` entry** since `HEAD`. Otherwise stop cleanly. The
   "decision recorded?" test uses the **uncommitted-since-HEAD delta** of `entries.jsonl` (append-only,
   ADR-0019) — no per-session `KB_SESSION_ID` state, and it aligns with the "record then commit" workflow.
3. **Emit the verified contract** — `decision:block` + `additionalContext` (the reminder) to continue;
   `{}` to allow.
4. **Not a true Brake.** Working-tree-changed ≠ decision-made, so this can over- or under-fire. The
   deterministic backstop for *significant* decisions stays the committed **ADR** (ADR-0001); this only
   fires the nudge at the right moment, when plausibly needed.

**Fail-open everywhere.** Malformed stdin, no git repo, or a missing brain file → allow the stop. A
decision-capture reminder must never wedge a turn.

### Testing (deliberate exception to ADR-0023's scenario-as-DoD)

The reminder is agent-observable, so ADR-0023 would ordinarily require an L4 purpose scenario. We make a
**reasoned exception**, mirroring the structural-guardrail precedent (ADR-0022 #7):

- the **mechanics are deterministic** and unit-tested — `decideStop`'s full truth table + a git-backed
  CLI e2e asserting the verified JSON shape (`test/stop-reminder.test.ts`, 8 tests);
- the **"does the agent act on the reminder" half is exactly what the Tier-0 probe already
  demonstrated** live (the sentinel echo). A full N=3 L4 scenario would re-prove the platform contract,
  not a vfkb-vs-baseline purpose contrast.

So: deterministic unit tests as the gate + the recorded probe as the live evidence; **no L4 scenario**.

### Wiring (gated)

Wiring `hook stop` into `.claude/settings.json` (`Stop` matcher) is a **separate, operator-gated step** —
it changes behavior on *every* session in this repo and a mis-built guard could loop, so it ships only on
explicit sign-off, verified on a live turn here.

## Consequences

- **+** A timely, mechanical decision-capture nudge that fires only when plausibly needed — stronger than
  the prose rule, without P1's blocked upstream dependency.
- **+** Stateless heuristic (git-delta, no `KB_SESSION_ID`); fail-open; native loop guard.
- **+** First feature to formalize the **Tier-0 probe → version-pinned finding → deterministic guard**
  pattern end-to-end.
- **−** Not a true Brake: false negatives (a decision made but `src/`/`docs/` untouched → no nudge) and
  false positives (mechanical edits with no decision → a nudge to dismiss). Accepted; the ADR is the real
  backstop.
- **−** Contract is **version-pinned to CLI v2.1.195** — re-verify on a Claude Code upgrade (RFC-009 #5).
- **−** Heuristic tuning (per-turn vs per-session baseline; widening beyond `src/`/`docs/`) remains open
  (RFC-008 open item #2).

## Alternatives Considered

- **Prose rule only (status quo).** Rejected — the gap this addresses (ADR-0021's lesson).
- **Unconditional every-turn reminder.** Rejected — forces a continuation every turn; noisy.
- **`UserPromptSubmit` per-turn injection (P1).** Preferred *mechanism*, but external-blocked upstream;
  revisit if fixed (would supersede this).
- **A self-managed marker-file loop guard.** Rejected — the harness provides `stop_hook_active` natively
  (verified); a marker file is redundant and more fragile.
- **A full L4 scenario for the reminder.** Rejected — see Testing; redundant with the probe + unit tests.

## Related

[RFC-008](../rfc/RFC-008-decision-capture-reminder.md), [ADR-0015](ADR-0015-cross-harness-auto-layer.md),
[ADR-0021](ADR-0021-auto-distill-and-curator.md), [ADR-0023](ADR-0023-scenario-contract-first.md),
[ADR-0019](ADR-0019-self-hosted-design-brain.md). Brain: gotcha `d70c0299e144` (verified contract),
decision `a16022550efc` (decouple). Code: `src/stop-reminder.ts`, `src/cli.ts` (`hook stop`),
`test/stop-reminder.test.ts`.
