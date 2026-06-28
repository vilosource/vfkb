# RFC-008: Reliable decision capture — a conditional end-of-turn (Stop-hook) reminder

- **Status:** Proposed — **WIP (drafted 2026-06-28; continue next session)**
- **Date:** 2026-06-28
- **Deciders:** operator + Claude
- **Relates:** [ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md) (P1 / Tier-C per-turn injection —
  external-blocked), [ADR-0021](../adr/ADR-0021-auto-distill-and-curator.md) (capture + the
  "prose rule needs a Brake" lesson), `CLAUDE.md` ("Capturing decisions" standing rule).

## Context

Decisions made during a session are captured **only** by a soft `CLAUDE.md` prose rule. There is **no
automatic mechanism**: the `PostToolUse` hook records *tool calls*, not conceptual decisions, and is
off against the committed brain. vfkb's own lesson (ADR-0021): **a prose rule with no Brake gets
ignored**. We want a **timelier, stronger nudge at end-of-turn** — when the agent is about to hand
back to the user — without forcing the deterministic-Brake we can't build (a hook can't detect that a
"decision" was made).

## Findings (verified via the Claude Code guide, CLI v2.1.195)

- **`Stop` is the end-of-turn hook** — fires when the main agent finishes responding and is about to
  wait for the user ("once per turn: `UserPromptSubmit`, `Stop`").
- **A `Stop` hook can inject + block:**
  `{"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","additionalContext":"…"}}` →
  the agent **continues the same turn** with that text as context (it acts on the reminder). *(Field
  placement to be confirmed with a 30-second empirical test before relying.)*
- **No documented loop guard** (`stop_hook_active`) in v2.1.195 → a blocking Stop hook must **self-guard**
  (e.g. a per-turn marker file) or it loops / nags forever.
- **A hook cannot tell whether a decision was actually made** → a naive reminder fires **every** turn
  (disruptive: forces a continuation each turn).
- **Per-turn context injection via `UserPromptSubmit` is uncertain/undocumented** — this is exactly
  vfkb's **P1 (ADR-0015 Tier C)**, marked **external-blocked on an upstream hook fix**. `SessionStart`
  injection *does* work (once per session — that's our current continuity).

## Proposed design (recommended — to finalize)

A **conditional, once-per-turn `Stop` hook**, closer to a Brake than a nag:
1. **Loop guard** — write a per-turn marker; if already fired this turn, allow the stop.
2. **Heuristic trigger** — only block when a decision *plausibly* went unrecorded, e.g. the working
   tree has uncommitted `src/`/`docs/` changes **AND** `.vfkb/entries.jsonl` gained **no new
   `decision` entry** this session. Then inject the reminder once; otherwise stop cleanly.
3. **Not a true Brake** (working-tree-changed ≠ decision-made) — the deterministic backstop for
   *significant* decisions stays the committed **ADR**; this just fires the nudge at the right moment,
   only when plausibly needed.

## Alternatives

- **Prose rule only (status quo).** Weak — easily skipped (the very gap this addresses).
- **Unconditional every-turn Stop reminder.** Rejected — forces a continuation every turn; noisy.
- **`UserPromptSubmit` per-turn injection.** Preferred *mechanism* but currently P1 / external-blocked;
  revisit if upstream fixes it.
- **Non-blocking `systemMessage` at Stop.** Reminds the *user*, not the agent; undocumented at Stop.

## Open items (next session)

1. **Empirically test** the exact `Stop` JSON contract + loop behavior in v2.1.195 (does `block` +
   `additionalContext` reach the agent? does it loop without a guard?).
2. Finalize the **heuristic** (entry-count delta vs git diff; per-session vs per-turn baseline).
3. Decide **accept → ADR** (and wire `.claude/settings.json`) **or withdraw** in favour of P1 if/when
   `UserPromptSubmit` injection is fixed upstream.
