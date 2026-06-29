# RFC-008: Reliable decision capture — a conditional end-of-turn (Stop-hook) reminder

- **Status:** **Accepted → [ADR-0027](../adr/ADR-0027-stop-hook-decision-capture-reminder.md)** (2026-06-29; contract empirically verified)
- **Date:** 2026-06-28 (accepted 2026-06-29)
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

## Findings (EMPIRICALLY VERIFIED 2026-06-29, CLI v2.1.195, host)

Probed with a self-capped Stop hook driven by `claude -p` (print) **and** stdin-piped non-print mode —
both behave identically. (Tier-0 platform-contract probe; finding pinned to v2.1.195 — re-verify on
version change. Brain: gotcha `d70c0299e144`.)

- **`Stop` fires at end-of-turn** — confirmed (fired in both modes).
- **`Stop` block + `additionalContext` WORKS — variant A confirmed:**
  `{"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","additionalContext":"…"}}` → the
  agent **continues the same turn** and acts on the injected text (an injected sentinel was echoed in
  the agent's reply). The earlier "field placement to be confirmed" caveat is **resolved**.
- **A native loop guard EXISTS** — `stop_hook_active` is passed in the hook's stdin: **`false` on the
  first fire, `true` on the re-entry** after a block. So a blocking Stop hook **guards by checking that
  field** — **no marker file needed**. ⚠️ This **corrects** the prior (guide-asserted) finding that
  v2.1.195 had no `stop_hook_active` guard.
- **The Stop stdin is rich** — `cwd`, `session_id`, `transcript_path`, **`last_assistant_message`**,
  `effort`. So the heuristic can read `.vfkb/entries.jsonl` *and* inspect `last_assistant_message` /
  the transcript — stronger signal than the git-diff heuristic first assumed.
- **A hook still cannot tell whether a decision was actually made** → a naive reminder would fire
  **every** turn; the conditional heuristic (below) is what keeps it from nagging.
- **Per-turn context injection via `UserPromptSubmit` remains uncertain/undocumented** — vfkb's **P1
  (ADR-0015 Tier C)**, **external-blocked**. `SessionStart` injection works (once per session — current
  continuity).

## Proposed design (recommended — to finalize)

A **conditional, once-per-turn `Stop` hook**, closer to a Brake than a nag:
1. **Loop guard (native)** — read `stop_hook_active` from the hook stdin; if `true` (we are the
   re-entry after our own block), **allow the stop** immediately. No marker file (the verified contract
   provides this for free).
2. **Heuristic trigger** — only block when a decision *plausibly* went unrecorded, e.g. the working
   tree has uncommitted `src/`/`docs/` changes **AND** `.vfkb/entries.jsonl` gained **no new
   `decision` entry** this session. The rich stdin (`cwd`, `last_assistant_message`, `transcript_path`)
   lets the heuristic also inspect what the turn actually did. Inject the reminder once; otherwise stop
   cleanly.
3. **Not a true Brake** (working-tree-changed ≠ decision-made) — the deterministic backstop for
   *significant* decisions stays the committed **ADR**; this just fires the nudge at the right moment,
   only when plausibly needed.

## Alternatives

- **Prose rule only (status quo).** Weak — easily skipped (the very gap this addresses).
- **Unconditional every-turn Stop reminder.** Rejected — forces a continuation every turn; noisy.
- **`UserPromptSubmit` per-turn injection.** Preferred *mechanism* but currently P1 / external-blocked;
  revisit if upstream fixes it.
- **Non-blocking `systemMessage` at Stop.** Reminds the *user*, not the agent; undocumented at Stop.

## Open items

1. ~~**Empirically test** the exact `Stop` JSON contract + loop behavior in v2.1.195.~~ **DONE
   (2026-06-29)** — see Findings: `block` + `additionalContext` (variant A) reaches the agent; it loops
   without a guard; `stop_hook_active` is the native guard. (Residual: a true-TTY interactive session
   wasn't headlessly testable, but print and stdin-piped non-print modes were identical — low risk.)
2. Finalize the **heuristic** — entry-count delta (new `decision` this session) gated by working-tree
   change, now able to use `last_assistant_message` / transcript. Per-session vs per-turn baseline TBD.
3. Decide **accept → ADR** (and wire `.claude/settings.json` with the verified contract) **or withdraw**
   in favour of P1 if/when `UserPromptSubmit` injection is fixed upstream. *(Contract is verified; this
   is now a design-acceptance call, not blocked on unknowns.)*

## Relationship to the L4-harness work (decoupled)

The L4 sandbox improvements surfaced while scoping this probe (drift-warning banner, a probe-mode that
hosts Tier-0 platform-contract probes beside L4 scenarios, a readiness gate, cost/version telemetry)
are **split out into [RFC-009](RFC-009-l4-harness-and-platform-probes.md)** and are **evidence-gated —
not prerequisites** for RFC-008. RFC-008 stands on the already-verified contract above. (Brain decision
`a16022550efc`.)
