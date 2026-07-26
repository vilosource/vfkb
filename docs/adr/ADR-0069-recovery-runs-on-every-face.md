---
type: Decision
title: "ADR-0069: Journal recovery runs on every face that starts a session, once per session (amends ADR-0064 §2)"
description: "ADR-0064 §2 and RFC-034 §2 name the Claude Code session-start hook literally as where recoverFromJournal runs, and that literal reading was implemented exactly: one call site. The pi face, the kb_resume MCP tool and the vfkb resume verb therefore never healed a destroyed brain, which stopped being theoretical when the pi package shipped delivered-and-proven. This amends the spec to bind recovery to the EVENT (a session reading the brain for the first time) rather than to one harness's hook, and fixes the cadence at once per session (a process latch backed by a brain marker) — because pi's before_agent_start fires every turn, the pi MCP bridge spawns a fresh server per call, and the journal is branch-agnostic, so per-call healing re-appends another branch's entries into the working tree."
status: "Accepted"
timestamp: 2026-07-26
---

# ADR-0069: Journal recovery runs on every face, once per session

- **Status:** Accepted
- **Date:** 2026-07-26
- **Amends:** [ADR-0064](ADR-0064-durable-capture-journal.md) §2 (which named the Claude Code
  session-start hook as recovery's home) and the corresponding wording in
  [RFC-034](../rfc/RFC-034-durable-capture-journal.md) §2. ADR-0064's body is immutable
  (ADR-0001), so this amends rather than edits.
- **Closes:** [#205](https://github.com/vilosource/vfkb/issues/205)
- **Relates:** [ADR-0066](ADR-0066-pi-package-delivery.md) (the pi package's delivery is what made
  this urgent); [ADR-0015](ADR-0015-cross-harness-auto-layer.md) (one engine, several faces —
  the parity obligation this violated); [ADR-0040](ADR-0040-native-concurrency-lock.md) (recovery
  holds the exclusive lock)

## Context

ADR-0064 §2 says recovery runs in the session-start hook. That sentence was implemented precisely:
`recoverFromJournal` had exactly one call site, `cli.ts hook session-start`. Everything else that
begins a session — the pi extension's `before_agent_start`, the `kb_resume` MCP tool, and the
`vfkb resume` verb this repo's own CLAUDE.md tells operators to run — read the brain without ever
healing it.

For a year that was survivable, because pi was experimental and `kb_resume` was a convenience. It
stopped being survivable when ADR-0066 shipped the pi package as a delivered, delivery-proven
product: a pi-only consumer whose uncommitted brain was destroyed by a careless git operation had
**no recovery path at all**, while a Claude consumer in the same repository had one. The
destroyed-brain incident class is precisely where the pi tier lives.

The spec's literal wording is what made this invisible. Nobody was violating ADR-0064; ADR-0064 was
describing one harness as if it were the rule.

## Decision

1. **Recovery binds to the EVENT, not the harness.** Any face that performs a session's first read
   of the brain heals it first: the Claude session-start hook, the pi extension's injection point,
   `kb_resume`, and `vfkb resume`. **Nothing structurally enforces this on a face nobody has
   written yet** — a new face calling `renderResume` directly reproduces #205, and saying otherwise
   would be the same overclaim that produced the original bug. What exists instead is
   `resumePayload()` as the obvious thing to call, and **process-level guards that spawn the real
   binaries** (`test/heal-faces.test.ts`), so a call site that stops healing goes red instead of
   staying quietly green.
2. **One implementation, shared.** `src/heal.ts` owns the lock, the recovery call, the freshness
   refresh, the operator note and the fail-open posture. Faces call it; none of them re-implement
   it. (Three hand-copies of a five-line sequence is how the faces drift apart again.)
3. **Heal BEFORE rendering, and the note LEADS the payload.** Restored entries must be inside the
   render, and a restore nobody is told about is a silent mutation of the knowledge base — hook
   stderr is not reliably surfaced, so the injected digest is the only channel that reliably
   reaches the agent and through it the operator. A failure to *stamp* freshness must never
   suppress the *report*.
4. **Once per session, enforced by a marker — not merely once per process.** This is the clause with teeth. pi's
   `before_agent_start` fires on **every user message** (verified in pi 0.73.1: it is emitted from
   the per-message path, not once per session), and the journal is deliberately gitignored, so it
   survives `git switch`. Healing on every call therefore re-appends entries committed only on
   *another* branch into whatever branch is checked out now — observed during review on a real
   checkout, where a single heal restored a foreign branch's entry into the working tree. A
   per-process latch restores the cadence ADR-0064 always intended by saying "session-start", and
   makes the cost (three git subprocesses and two passes over `entries.jsonl`) a per-session cost
   rather than a per-turn one.

   **A process latch alone is not enough, and the gap is on the tier this ADR exists for.**
   `src/pi-mcp-bridge.ts` is connect-per-call: every `kb_resume` from a pi session spawns a fresh
   `dist/mcp-server.js`, so a fresh process gets a fresh latch and heals again — the unbounded
   re-restore loop the latch was supposed to close. The latch is therefore backed by a marker in
   the brain (`.vfkb/.journal/.healed`): keyed on the **session id** where one exists (the Claude
   hook carries one, so a genuinely new session still heals immediately and that face loses
   nothing), and falling back to a **time window** where none does (a bridge-spawned MCP process,
   where "same session" is unknowable and an unbounded loop is worse than a bounded delay).
5. **Fail-open remains absolute.** Recovery must never cost a session its start. Every error path
   returns an empty note and lets the session proceed.

## Consequences

- The pi tier gets the durability guarantee ADR-0064 was written to provide; RFC-034's promise is
  now true on every face rather than on one.
- **The cross-branch contamination risk is bounded, not eliminated.** A per-session heal on a
  branch whose wal carries another branch's entries still restores them once. That is the
  pre-existing ADR-0064 behaviour on the Claude face, unchanged here — but it is now on record as a
  known property rather than an accident, and the RFC-034 §4 redaction window is a session again,
  not a message.
- A long-lived MCP server process heals once for its lifetime; a bridge-spawned one heals once per
  marker window. If a brain is destroyed *mid-session*, recovery waits for the next session (or the
  window to lapse). Accepted deliberately: the alternative is the per-call cadence this ADR exists
  to remove. `VFKB_HEAL_DEBOUNCE_MS` tunes the window for anyone who needs different arithmetic.
- The deterministic guards for this live in `test/heal.test.ts` and are **behavioural** — they drive
  the real handlers. An earlier draft asserted over source text and was defeated in review by a
  comment mentioning the function name, which is the whole lesson: a guard a comment can satisfy is
  not a guard.
