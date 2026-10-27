---
type: Decision
title: "ADR-0084: The handoff nudge moves to the next prompt — deterministic Stop WHEN-rules, a non-blocking UserPromptSubmit line, RFC-043's anchor and floor (accepts RFC-047 and RFC-043 Parts 0, 1, A; amends ADR-0034, ADR-0027, ADR-0049 and brain e68ad28f11b6)"
description: "Accepts RFC-047 under operator ruling 54802539cda7, and RFC-043 Parts 0, 1 and A as written (Part B stays gated). On Stop: no B3 before turn 3; every nudge deferred while background_tasks or session_crons is live; the write-demand clause dropped; later, no B3 on the default branch with a clean tree and B3 at most once per session. B1 leaves Stop. The standing B1/B3 reminder becomes one non-blocking UserPromptSubmit additionalContext line (a labelled fact plus one conditional scoped to this prompt), on by default, emitted once per (pin id, created, HEAD) per session, skipped on harness-generated turns, sharing one handler with v3 R1. The stale-pin floor is RFC-043 Part A's read-only render, with Part 0's anchor keyed on created and rule 5 applied without a carrier (B′). The DoD is three L4s; ADR-0034's L4 is retired as a gate. Build status is tracked in vfkb#389, not here."
status: "Accepted"
timestamp: 2026-10-27
---

# ADR-0084: The handoff nudge moves to the next prompt

- **Status:** Accepted (2026-10-27, operator ruling brain `54802539cda7`, which adopts the
  review's recommendations and delegates every open question to a Fable brainstorm).
- **Date:** 2026-10-27
- **Accepts:**
  - [RFC-047](../rfc/RFC-047-less-intrusive-handoff-nudge.md), whole.
  - [RFC-043](../rfc/RFC-043-stop-nudge-observer.md) **Parts 0, 1 and A, as written** at
    `dd23f40`, with the settled points in §5. **Part B stays gated, not built** (§6). This is
    B3's first ADR.
- **Amends:**
  - [ADR-0034](ADR-0034-b1-handoff-nudge.md): B1's surface moves from the blocking Stop hook
    to a non-blocking `UserPromptSubmit` line; B1 no longer fires on Stop; it is no longer
    "self-silencing only" (it also has a per-session emission key). Its trigger, threshold and
    the B2 floor are unchanged.
  - [ADR-0027](ADR-0027-stop-hook-decision-capture-reminder.md): one new precondition. A
    Stop whose payload reports a non-empty `background_tasks` or `session_crons` is a paused
    stop, not an end of turn; all Stop nudges, the decision nudge included, defer to the next
    unpaused Stop. The rest of ADR-0027 stands.
  - [ADR-0049](ADR-0049-session-start-handoff-pinning.md) Decision item 1, **the render
    only**: Part A's commit list appears under `## Last handoff`, beside ADR-0082 §3's pin id.
    Pin selection is unchanged.
  - Brain ruling **`e68ad28f11b6`** (2026-10-19), in two points: (1) deterministic WHEN-rules
    for B3 are allowed alongside the deterministic precondition, not only a model; (2) the
    stale-pin floor is Part A's read-only render, replacing "a SessionEnd fallback for a STALE
    pin". The rest of it stands: scope is B3; a decision model, if ever built, only times B3
    and never creates a fire; Jev is not pre-chosen; the observer seam is opt-in under
    Ruling 5. This amendment is ordered by `54802539cda7` item 1.
- **Relates:**
  - [ADR-0033](ADR-0033-session-end-continuity.md): B2 remains the missing-handoff floor.
  - [ADR-0080](ADR-0080-query-time-injection.md) / [ADR-0081](ADR-0081-r1-step1-lands-below-bar.md):
    v3 R1 shares the `UserPromptSubmit` handler later; this ADR's harness-turn probe
    discharges ADR-0080 §5's Q4 for both. Not amended (§3.4).
  - [ADR-0082](ADR-0082-propose-only-curation.md) §2: one pin selector and `created` keys;
    its conditions on RFC-043's accepting ADR are met in §5.1.
  - [ADR-0077](ADR-0077-compaction-survival-guard.md): SessionStart `source=compact`.
  - [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md) / [ADR-0051](ADR-0051-delivery-honesty.md).
- **Evidence:** the review
  [`docs/research/probes/nudge-review-2026-10-27/README.md`](../research/probes/nudge-review-2026-10-27/README.md)
  (its own figures, not re-verified); RFC-043's probe kit; the created-key re-run
  [`rerun-created-keys.txt`](../v3/research/probes/curation-2026-10-21/rerun-created-keys.txt).
- **Tracking:** [vfkb#389](https://github.com/vilosource/vfkb/issues/389); phases #383–#388.

## Context

B3, the stale-handoff Stop nudge, fires every 10–11 turns while the pin is stale, because
its 10-turn cooldown is a rate limit on a trigger that stays true until a new handoff exists.
The review counted 37 fires in 18 sessions, 32 of them mid-session, 20 acted on with a
premature handoff, each a forced extra turn (median 2,283 output tokens, 19 s). Some fires
are false: a squash merge makes the handoff it carries look stale (RFC-043 cause 1). B1 and
the decision nudge rarely fire. No surveyed memory system blocks a stop to ask for a summary.

Claude Code now offers two facts that change the design space: Stop input carries
`background_tasks` / `session_crons` to mark a paused stop, and `UserPromptSubmit`
`additionalContext` injects a line with no extra turn, at the one moment the user's prompt is
in hand. RFC-047 sets out the full argument; this ADR records the decision.

## Decision

### 1. Stop: deterministic WHEN-rules

In `decideStop` (`src/stop-reminder.ts`):

1. **1a.** B3 is quiet when the turn is valid and `turn < 3`. Invalid turn → today.
2. **1b.** If `background_tasks` or `session_crons` is an array with length > 0, return
   `{ block: false }` right after the `stop_hook_active` guard, before any trigger or
   cooldown work and without `markNudged`. Absent, null, non-array or empty → today. Applies
   to every nudge.
3. **1d.** `STALE_HANDOFF_REMINDER`'s trailing sentence ("If you are still mid-session and
   plan to record one … must be recorded before the session ends.") becomes "If you are still
   mid-session, ignore this and finish normally." The lead-in `vfkb stale-handoff check:`
   stays byte-identical, so the re-measurement in §6 stays comparable.
4. **1c** (only after Part A ships). B3 is quiet iff `isOnDefaultBranch && !uncommittedWork
   && newEntries === 0`. `isOnDefaultBranch(git, cwd)` is one helper extracted from
   `src/session-end.ts` and used by both SessionEnd and 1c: branch read live; default =
   `refs/remotes/origin/HEAD` when it resolves, plus any branch named `main` or `master`;
   anything unknown (no origin/HEAD, detached HEAD) is not default.
5. **1e** (only after Part A ships). Once `lastNudged.staleHandoff` is set, by a Stop fire
   or by §2's line, B3 is quiet on Stop for the rest of the session.
6. **B1 no longer fires on Stop.** `decideStop` stops composing `HANDOFF_REMINDER`; the
   `nudgedAtTurn.handoff` key retires.

After all phases, Stop does three things: the loop guard, the decision nudge, and at most one
B3 fire per session.

### 2. The standing reminder: one non-blocking `UserPromptSubmit` line

1. **Handler:** `vfkb hook user-prompt-submit`, one plugin `hooks.json` entry, shared later
   with v3 R1 as a separately gated branch (`VFKB_RECALL=1` and ADR-0081's
   `STEP2_GATE_MET`). Decision logic is a pure `decidePromptNudge`; text and predicate live
   in one engine-side function.
2. **Trigger:** pin stale (today's check until Part 0 ships, then Part 0) OR B1's condition.
3. **Output:** `hookSpecificOutput.additionalContext`, `hookEventName: "UserPromptSubmit"`.
   Any failure emits nothing.
4. **Wording:** RFC-047 §4.3's text, pinned by a unit test. A line labelled `vfkb handoff
   status:` states the fact, then one conditional ("If this prompt ends the session, …;
   otherwise nothing is needed now …"). It never says "must", "before the session ends" or
   "plan to record one". The "next session sees this same list" clause appears only once
   Part A ships.
5. **Cadence:** emit iff the trigger holds and `(pin id, pin created, HEAD)` differs from the
   last key stored on the SessionState record. Reset that key on SessionStart
   `source: "compact"`. No session state → emit while the trigger holds. When the line is
   emitted with the stale-pin reason, the handler calls `markNudged('staleHandoff', turn)`, so
   §1's Stop fallback stays quiet afterwards.
6. **Harness-generated turns:** a shared, git-free `isHarnessPrompt(prompt)` skips prompts
   that start at column 0 with `<task-notification>`, `Another Claude session sent a
   message:` or `Your claude.ai usage limit has reset`. Everything else counts as typed.
7. **Default:** on, for every consumer. No opt-in and no opt-out flag in this ADR.
8. **Pi:** no reminder line. Pi gets Part A, which it renders on every prompt.

### 3. Scope notes, so later reviews read the rules correctly

1. RFC-044 item 7 ("frame as knowledge, never as instruction") governs **recall entries**,
   whose job is to be knowledge. It does not govern §2's line, which inherits ADR-0034's
   conditional framing.
2. RFC-043 Part A's "no call to action" governs **the render**, which re-runs at session
   start and after compaction with no prompt in hand. §2's line is the one surface where the
   prompt is in hand.
3. The hook decides only on git, brain and payload facts. It never classifies the user's
   prompt beyond §2.6's literal lead-in skip.
4. ADR-0080 is related, not amended: R1 keeps its own gate, budget and `<vfkb-recall>`
   block; §2's line never enters that block.

### 4. The SessionEnd floor is checked before anything leans harder on it

The first task of #384 is a Tier-0 probe of whether vfkb's SessionEnd fits Claude Code's
1.5 s default budget on the current CLI, and whether `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS`
applies to plugin hooks. README guidance is written only on the probe's result (RFC-047
§4.2). A `vfkb doctor` check for the symptom (session record present, brain entries beyond
HEAD on a topic branch, no auto-commit) is added regardless. B2's role as the floor is not
claimed in any release note until the probe is committed.

### 5. RFC-043, as accepted

1. **Part 0 is keyed on `created`.** Condition `853d9444599c` / ADR-0082 §2 is met by the
   committed re-run: under `created` keys, case 3 changes from quiet to `STALE {code2|code1}`
   and case 3b from `{code3}` to `{code3|code2|code1}`; the other 16 of 18 rows are
   unchanged. Those are the fixture answers. Rule 5 compares instants; its cut-off moves
   with `u`.
2. **Q5 / B′ is adopted.** With no carrier, rule 5 drops every commit authored at or before
   `u`, with no ancestry condition. The carrier path is unchanged. An unreadable author date
   drops the commit. RFC-043's disclosure widens: the amend/fixup/back-date silence and the
   case-11 silence now also apply to uncommitted and outside-tree pins.
3. **The 33-case table is not yet reproducible.** Round 4's `bp-all.sh` sources
   `rules-bp.sh`, which was never committed. `bp-all.out` (N5 → quiet, N5b → `STALE {M1}`
   under B′; no case worse) is recorded evidence under `updated` keys. #386 must recreate the
   rules, re-run all 33 cases under `created` keys and commit the output before those rows
   become fixtures.
4. **Q1:** the floor is Part A's read-only render (amends ADR-0049's render). No SessionEnd
   write.
5. **Part 1 is split.** The write demand goes now (§1.3); the "what moved, and the next
   session sees it" wording lands in the same PR as Part A.
6. **Q2:** Part B's bar is the ruling's. **Q3:** moot while Part B is gated. **Q4:** Parts 0,
   1 and A first, then re-measure.

### 6. Part B is gated

Part B is not to be built unless this gate passes. After Phases 1–5 ship in a plugin release and all profiles run it, #388 re-runs
`nudge-fires.py` over ≥ 10 interactive sessions. If Stop-B3 fires mid-session in ≥ 1 of 3,
the most that may follow is a per-project opt-in, log-only shadow. Otherwise a brain decision
citing #388's record says Part B is not built, and deleting B3 from Stop becomes an option.
An amending ADR is needed only if something is built.

### 7. Order

#383 (1a, 1b, 1d) → #384 (plugin update, SessionEnd probe, doctor check) → #385 (§2, B1 off
Stop, harness-turn probe) → #386 (Parts 0 and A, Part 1's second half) → #387 (1c, 1e) →
#388 (re-measure, Part B verdict). 1c and 1e never ship before Part A.

## Definition of Done (ADR-0023/0029/0050/0051)

Every L4 runs on the Claude harness (`claude-haiku-4-5`), N = 3, DEMONSTRATED ≥ 2/3, with a
can-fail arm and content assertions only. The vfkb plugin is disabled per sandbox and the
scenario asserts it stayed off (`fb712c13f39e`). Each is written and run **RED before** its
build, one docker run at a time.

1. **`scenarios/handoff-next-prompt.mjs`** (#385; also the agent-facing proof of 1a):
   - two turns, one session id;
   - two treatment arms, a seeded stale pin and B1's condition: a wrap-up prompt produces an
     agent-authored handoff (`handoff`/`next`, not `auto`) carrying a session sentinel;
   - a contrast arm with the `UserPromptSubmit` entry disabled and B2 wired produces only the
     `auto` floor;
   - a negative arm, where a mid-session prompt produces **no** handoff;
   - in every arm, a tee log of the Stop hook's stdout shows ≥ 1 invocation and neither
     `vfkb stale-handoff check` nor `vfkb handoff check` text. A trial failing this scores
     FAILED.
2. **`scenarios/stale-handoff-anchor.mjs`** (#386; Parts 0 and 1), as RFC-043 specifies:
   - a squash arm, where the hook ran and its output lacks the B3 text;
   - a can-fail arm with a later commit, whose output contains the new B3 text.
3. **`scenarios/stale-pin-floor.mjs`** (#386; Part A), as RFC-043 specifies:
   - the agent has no shell;
   - treatment: the agent names the sentinel commit from the render;
   - contrast: it cannot;
   - squash negative: the render contains `## Last handoff` and the pin's sentinel, and no
     "Commits since this handoff".
4. **`scenarios/session-end-handoff.mjs` is retired as a gate.** It is single-turn, so it
   cannot see any change in this ADR, and it has no arm that could catch nagging. It and
   `scenarios/records/session-end-handoff.json` stay as ADR-0034's historical evidence and
   are not re-run. #385 adds a header note pointing here.
5. **`scenarios/decision-capture.mjs`** is re-run after #383, because §1.2 changes the
   decision nudge's truth table.
6. **The inner gate** is the unit and CLI e2e set listed in RFC-047 §7.6, each observed red
   first.
7. **Status:** until those records exist and are DEMONSTRATED, a built phase is **"built,
   NOT yet verified"**. Build status is tracked in
   [#389](https://github.com/vilosource/vfkb/issues/389) and its phase issues, not here.
8. **Delivery:** each plugin release carrying a phase says **"delivery is unproven"** until
   its install-path record is re-pinned (ADR-0051), as `release-gate.mjs` derives from
   `DELIVERY-STATUS.json`. The release notes also say that B3 fires less, that its text
   changed, and, from #385, that a new `UserPromptSubmit` hook entry is installed.

## Consequences

- **Behaviour change for every consumer**, phase by phase:
  - fewer Stop blocks;
  - new B3 text;
  - B1 never blocks a stop;
  - a one-line system reminder on prompts while the pin is stale or a handoff is missing;
  - a commit list under `## Last handoff` on every face.
- **A session that ends with no further prompt** gets no agent-authored handoff from B1. It
  gets B2's enumerated floor. A stale pin at session end is disclosed by the next session's
  render instead of being forced now. That is a relevance cost, not a continuity loss.
- **A long-lived background task or cron silences every Stop nudge** for its lifetime. B2,
  Part A and the committed-ADR backstop cover that, and #388 counts deferred stops.
- **The plugin gains a `UserPromptSubmit` hook.** This is cross-repo work:
  `claude plugin validate --strict`, `release-gate.mjs`/`hooks-smoke` updates, a re-pin of
  install-path, and a release.
- **R1 inherits a handler, a hook entry and a harness-turn predicate** when its step 2
  unblocks.
- **B3 gains governance.** #383 points its code comment at this ADR; the "built, NOT yet
  verified" words stay until the L4 records above exist.

## Alternatives considered

RFC-047 §6 lists them in full. The rejected options are:
- Jev on every turn;
- deleting B3 before the floor exists;
- a longer cooldown;
- `type: "prompt"` / `"agent"` hooks;
- Stop `additionalContext` instead of `decision:block`;
- a SessionEnd write as the floor;
- a statusline;
- a fact-only line, or an unconditional instruction, on `UserPromptSubmit`.

Separate ADRs for RFC-047 and RFC-043 were also rejected: two documents that could not be read
alone, with no extra decision content.
