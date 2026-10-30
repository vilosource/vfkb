---
type: Decision
title: "ADR-0085: ADR-0033's default-branch warning reaches the user as a UserPromptSubmit systemMessage (amends ADR-0033 §2 and ADR-0084 §2.3, §2.5, §7)"
description: "When SessionEnd would refuse to auto-commit the brain (default branch or detached HEAD, brain dirty), the UserPromptSubmit hook adds a top-level systemMessage for the user, beside the unchanged ADR-0084 additionalContext line. One predicate shared with SessionEnd; one id-based count; one ASCII text shared with SessionEnd's own systemMessage; its own cadence key, kept across compaction; computed first under the one 2 s deadline. The message renders in the interactive TUI and does not render on claude -p text. Replaces the model-relay design of draft PR #407, which never landed."
status: "Accepted"
timestamp: 2026-10-30
---

# ADR-0085: ADR-0033's default-branch warning reaches the user as a UserPromptSubmit `systemMessage`

- **Status:** Accepted (2026-10-30, operator ruling brain `54802539cda7`: follow the Fable
  review's recommendations, settle open questions by a Fable brainstorm, do not ask the
  operator; decide-step rulings D1 to D11 recorded in the brain on this ADR's branch).
- **Date:** 2026-10-30
- **Tracking:** [vfkb#395](https://github.com/vilosource/vfkb/issues/395), under
  [vfkb#389](https://github.com/vilosource/vfkb/issues/389). Build status lives there, not here.
- **Amends:**
  - [ADR-0033](ADR-0033-session-end-continuity.md) §2: the warning's **surface**. SessionEnd
    still refuses to commit on the default branch or a detached HEAD and still exits 0; the
    person is now told at the prompt, where Claude Code shows it, not only at exit, where it
    does not (below).
  - [ADR-0084](ADR-0084-handoff-nudge-next-prompt.md) §2.3 (the hook's output gains a
    top-level `systemMessage`), §2.5 (a second, independent cadence key) and §7 (order:
    #395, then the plugin release, then #388).
- **Number:** ADR-0009 assigns an ordinal when a decision lands on `main`; branch-only drafts
  get none. Draft PR [#407](https://github.com/vilosource/vfkb/pull/407) used "ADR-0085" for
  the relay design below and never merged, so this decision takes 0085 (decide D1). Brain
  references of the form "#395 → ADR-0085" resolve here.

## Context

ADR-0033 §2 says that when SessionEnd will not commit the brain (default branch, or a
detached HEAD) it warns the user with a `systemMessage`. Two observations show that this
warning reaches nobody:

1. **SessionEnd's `systemMessage` is discarded.** The `sessionend-budget` probe's arm F
   (docs/research/probes/sessionend-budget-2026-10-27/) found it absent from `claude -p`
   output 3/3. The interactive TUI was not observed for SessionEnd.
2. **Relaying through the agent failed.** Draft ADR-0085 (PR #407) and code PR
   [#406](https://github.com/vilosource/vfkb/pull/406) put the fact into the ADR-0084
   `additionalContext` line and asked the agent to tell the user. Five L4 records on the
   #406 branch (`f391c82`), `scenarios/records/handoff-next-prompt.on-main.*.json`:
   `red-baseline` 0/3 (pre-change engine), then treatment-main **1/3, 0/3, 0/3, 0/3** across
   four wordings (`confounded-run1`, `probe-run2`, `recipe-run3`, `branch-only-probe-run4`).
   The clause was delivered every time; the agent did not act on it.

The **#408 Tier-0 probe** (docs/research/probes/ups-systemmessage-2026-10-30/, PR #421, brain
`e05a71ae3246`; CLI 2.1.292, haiku, N=3 per arm, 0 void) then asked whether a
`UserPromptSubmit` hook's top-level `systemMessage` reaches the person:

- **Interactive TUI:** rendered **6/6** (with and without an `additionalContext` beside it),
  as the line `UserPromptSubmit says: <msg>`. `additionalContext` alone never rendered.
- **`claude -p` text output:** **0/6** (neither stdout nor stderr).
- **`claude -p --output-format stream-json`:** present as a `system`/`informational` event.
- The model never relayed the marker (0/27).

Routing decision brain `88a019587878` sends #395 to this channel.

## Decision

### §1 Trigger: exactly SessionEnd's refusal

The `UserPromptSubmit` hook emits the warning iff `brainCommitOutcome(git, cwd, dataDir)`
returns `on-default-branch` or `detached-head`. That is ADR-0033 §1 to §3's preconditions as
one exported predicate (in a git work tree; `git status --porcelain -- <brain>/entries.jsonl`
non-empty; `classifyBranch` = `default` or `detached`), and `runSessionEnd` consumes the same
function, so the two surfaces cannot disagree. There is **no "≥ 1 new id" floor**: an
edit-only diff (an archive, tombstone or retag of a committed id) is stranded continuity too,
and SessionEnd and `vfkb doctor` already treat it so (decide D2). A gitignored or out-of-tree
brain reads `brain-clean`; outside a repo, `not-a-repo`; neither warns.

### §2 One count

The count shown is SessionEnd's **id-based** `newEntriesSinceHead` (ADR-0083 §3: new ids, not
added lines), exported and also used by Stop's `newBrainEntriesSinceHead`, replacing Stop's
line count (decide D9, superseding #387 Q5). One brain state prints one N on every surface.

### §3 Surface and text

The warning is a **top-level `systemMessage`** in the hook's JSON. The ADR-0084
`additionalContext` line is unchanged and independent: both may appear in one JSON object,
and the line carries **no** relay clause for this reason (the model is not the audience).
When neither is produced the hook writes nothing, as ADR-0084 requires.

One text function, `renderNoAutocommitMessage(kind, branch, added)`, is used by this hook
and by SessionEnd's own `systemMessage` (decide D5). Printable ASCII, no markdown, because the
TUI renders it literally:

    vfkb will not auto-commit the 3 new brain entries on main (the default branch). Fix: git switch -c <name>; vfkb then commits the brain on exit.
    vfkb will not auto-commit the 1 new brain entry on a detached HEAD. Fix: git switch -c <name>; vfkb then commits the brain on exit.
    vfkb will not auto-commit the edits to existing brain entries on main (the default branch). Fix: ...

The stable lead-in `vfkb will not auto-commit` is exported for unit pins and the L4 assertion.
The fix names only the branch switch: ADR-0033's SessionEnd commits the brain on a topic
branch, and naming `.vfkb/entries.jsonl` would be wrong for a brain elsewhere.

### §4 Cadence

- Key `outcome|branch` (no HEAD, no count, so a `kb_add` or a commit on `main` does not
  repeat it), stored as `smKey` in the per-session signal file beside ADR-0084's `key`.
  Emit when the condition holds and the key differs; when the condition is observed false,
  clear the key so the warning re-arms (decide D4).
- **Compaction does not clear `smKey`** (decide D6): it evicts the agent's context, not the
  user's screen. ADR-0084 §2.5's reset of the line's key is unchanged.
- **Skips:** the harness-turn skip (ADR-0084 §2.6) applies. The first-prompt skip (ADR-0084
  decide Q2) does **not**: its reason was one-shot `claude -p` runs acting on agent-visible
  text, and this message is neither agent-directed nor rendered on `-p` text; a dirty brain
  left on `main` is most worth saying on the first prompt (decide D3).
- **No session id:** no cadence store, so the warning repeats on every prompt while the
  condition holds, as Stop's B3 does for an ephemeral session (decide D4).

### §5 Order and budget

One deadline (ADR-0084 Q12, 2000 ms minus 200). The warning stage runs **first** (it has no
other live surface); the line stage runs only if time is left, and a stage that finishes is
emitted even when the other is cut. Inside the warning stage, a git child that is killed,
times out or cannot spawn is **unobserved**, not a value: no warning that prompt, key
untouched (decide D7). A timed-out `symbolic-ref` must not read as a detached HEAD, nor a
timed-out `git show HEAD:` make every id read as new.

### §6 SessionEnd's own `systemMessage` stays

Kept, with the shared text (decide D10). Its cost is nil and it is the engine-level record of
what SessionEnd concluded. Nothing claims it reaches the user.

### §7 Limits stated, not claimed

- **`claude -p` text:** the warning does not render there. On stream-json it is a structured
  `system`/`informational` event that a consumer may or may not display. A headless run has
  no person watching; this ADR does not claim the warning reaches anyone there.
- **Not observed by #408, observed only by this ADR's L4 if at all:** the label Claude Code
  puts on a **plugin-provided** hook's message (the probe used a settings hook; the L4 records
  what it sees, and this ADR does not pin it).
- **Not observed:** glyphs and styling, terminals other than GNU screen, whether the line
  survives a redraw or `/clear`, CLI versions other than 2.1.292, and whether the model sees
  the `systemMessage` (it reached the transcript; the model never echoed it).

### §8 Definition of Done (ADR-0050/0051)

A capability-level L4, `scenarios/ups-warning-tui.mjs`, in vfkb (decide D8):

- The plugin installed in a sandbox HOME through `claude plugin marketplace add` +
  `claude plugin install` (never `--plugin-dir`); the interactive TUI driven under GNU screen;
  every claude child through `scenarios/lib/claude-auth.mjs` (env token, no-Keychain shim).
- Arms, N=3 valid each, content assertions over the screen buffer and the raw pty log:
  **treatment-main** (main, uncommitted brain entry: warning present), **contrast-topic**
  (topic branch, same entry: absent), **contrast-clean** (main, committed brain: absent). A
  RED baseline runs treatment-main against the pre-#395 plugin and must come out absent.
- DEMONSTRATED at ≥ 2/3 in every arm; the record binds the plugin version, git sha and tree
  hash, the bundle sha and the CLI version, and records the observed label as a diagnostic.
- The detached-HEAD trigger is **inner-gate only** (CLI e2e), not an L4 arm (decide D8).
- The scenario is **not** added to the plugin release-gate REQUIRED list (decide D8).
- Every release note for a plugin that ships this says "delivery is unproven" until
  `install-path` derives proven, says the message shows in the interactive TUI and not on
  `-p` text, and names this record's status.

## Consequences

- A person working on `main` with an uncommitted brain is told so at the prompt in the TUI,
  with the one-step fix; headless runs are not.
- SessionEnd, Stop and the prompt hook share one predicate and one count; Stop's 1c and B1
  can only become quieter (ids ≤ lines), and the decision nudge is no longer silenced by an
  archive copy of an old decision.
- Two keys live in one signal file with independent lifecycles; `clearPromptNudgeKey` removes
  only the line's key.
- The relay records on the #406 branch stay as history; PRs #406 and #407 are closed as
  superseded by this ADR, branches kept.

## Alternatives Considered

1. **Relay through `additionalContext`** (draft ADR-0085, PR #407; code PR #406): rejected on
   five records, best 1/3; the agent will not run an unasked branch switch.
2. **SessionEnd `systemMessage` only** (ADR-0033 as written): discarded on `-p` (arm F 3/3).
3. **`vfkb doctor` only:** a pull, after the fact; kept as the backstop, not the surface.
4. **ADR-0086 with a "withdrawn" row for 0085:** contradicts ADR-0009 (drafts get no
   ordinal), invents a lifecycle state, and 0086 already has a meaning in the #411 notes.
5. **A ≥ 1 new id floor** (#406): breaks parity with SessionEnd and doctor (decide D2).
6. **Reset the warning's key on compaction:** re-nags the user for an unchanged fact (D6).
