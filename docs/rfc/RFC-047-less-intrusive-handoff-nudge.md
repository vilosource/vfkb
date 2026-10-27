---
type: RFC
title: "RFC-047: A less intrusive handoff nudge — deterministic WHEN-rules on Stop, the standing reminder moved to the next prompt, and RFC-043's floor built first"
description: "The B3 stale-handoff Stop nudge fires every 10-11 turns while the pin is stale, mostly mid-session, and each fire forces an extra model turn. This RFC consolidates the 2026-10-27 review's phased redesign: deterministic WHEN-rules for the Stop nudges (no B3 before turn 3; every nudge deferred while background work is live; no B3 on the default branch with a clean tree; B3 at most once per session), the reminder text's write-demand removed, the standing B1/B3 reminder moved from a blocking Stop to a non-blocking UserPromptSubmit line, RFC-043 Parts 0 and A built as written, and RFC-043 Part B (a decision model) kept gated on a post-release re-measurement. It records which RFC-043 parts it implements, splits or keeps gated, the answers to every open question (settled by Fable brainstorms under operator ruling 54802539cda7), and the L4 scenarios that are the Definition of Done."
status: "Accepted → ADR-0084 (2026-10-27)"
timestamp: 2026-10-27
---

# RFC-047: A less intrusive handoff nudge

- **Status:** **Accepted 2026-10-27 → [ADR-0084](../adr/ADR-0084-handoff-nudge-next-prompt.md).**
  Acceptance is by operator ruling brain `54802539cda7`, which adopts the review's
  recommendations and delegates every residual question to a Fable brainstorm rather than to
  the operator. This RFC was therefore written already-accepted and lands in the same PR as
  its ADR (§9 explains the departure from the two-PR shape of #376/#378).
- **Date:** 2026-10-27
- **Deciders:** operator (ruling `54802539cda7`) + Claude; open questions settled by Fable
  brainstorm agents (§8).
- **Tracking:** [vfkb#389](https://github.com/vilosource/vfkb/issues/389); this document is
  [vfkb#382](https://github.com/vilosource/vfkb/issues/382).
- **Source:** the read-only review
  [`docs/research/probes/nudge-review-2026-10-27/README.md`](../research/probes/nudge-review-2026-10-27/README.md)
  (merged in #381). **Its figures are the review's own measurements over local transcripts.
  They are cited, not re-verified here.**
- **Amends (via ADR-0084):** [ADR-0034](../adr/ADR-0034-b1-handoff-nudge.md) (the B1 surface),
  [ADR-0027](../adr/ADR-0027-stop-hook-decision-capture-reminder.md) (the decision nudge gains
  the paused-stop deferral), [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md)
  (the `## Last handoff` render, Part A) and brain ruling `e68ad28f11b6` (a model decides
  WHEN; a SessionEnd write is the floor).
- **Absorbs:** [RFC-043](RFC-043-stop-nudge-observer.md) Parts 0, 1 and A (§5). RFC-043's
  body is not edited; only its status line points here.
- **Relates:** [ADR-0033](../adr/ADR-0033-session-end-continuity.md) (the B2 SessionEnd
  floor), [ADR-0077](../adr/ADR-0077-compaction-survival-guard.md) (SessionStart
  `source=compact`), [ADR-0080](../adr/ADR-0080-query-time-injection.md) /
  [RFC-044](RFC-044-query-time-injection.md) (v3 R1, the other `UserPromptSubmit` consumer),
  [ADR-0082](../adr/ADR-0082-propose-only-curation.md) §2 (one pin selector; `created` keys),
  [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) /
  [ADR-0051](../adr/ADR-0051-delivery-honesty.md) (Definition of Done, delivery honesty).

## 1. Context

Three Stop nudges live in `decideStop` (`src/stop-reminder.ts`): `decision` (ADR-0027),
`handoff` (B1, ADR-0034) and `staleHandoff` (B3, governed by nothing; RFC-043 is Proposed).
Each is rate-limited by a 10-turn cooldown. The review measured (its own figures):

- **B3 is the nudge that fires.** A stale pin stays stale until a new handoff is written, so
  B3 fires on the first eligible turn and then every 10–11 turns for the rest of the session.
  37 fires over 18 sessions in this repo's window; 91 across 68 `cldp` sessions. B1 fired 2
  times and `decision` 15, all declined.
- **Most fires are at the wrong moment.** 32 of 37 were mid-session and only 5 on a final
  turn. 8 were on turn 1 or 2. About 10 were in sessions recorded on `main`, where SessionEnd
  never commits the brain. 4 were in one-shot headless sessions whose handoff then displaced
  the operator's pin.
- **Fires cause premature handoffs.** 20 of 37 were acted on before the next user prompt.
  The reminder's closing clause ("…must be recorded before the session ends") is the text
  agents quote when they do it.
- **Each fire costs a forced model turn:** median 2,283 output tokens and 19 s, with the whole
  context re-read.
- **A squash merge makes the handoff it carries look stale** (RFC-043 cause 1; gotcha
  `68ea8f1db58d`). This share of fires is unmeasured.
- **Claude Code surfaces** (the review's quotations of the hooks reference, fetched
  2026-10-27): Stop `additionalContext`
  is not a cheaper channel than `decision:block`; it forces a turn the same way. Stop input
  now carries `background_tasks` and `session_crons` "to distinguish 'session is done' from
  'session is paused'". `UserPromptSubmit` `additionalContext` costs no turn and runs with
  the user's prompt in hand. SessionEnd hooks have a 1.5 s default budget that plugin hooks
  cannot raise; whether vfkb's SessionEnd fits it is **unverified**.
- **No other memory system surveyed blocks the agent's stop to ask for a summary.**

The review's conclusion, adopted by ruling `54802539cda7`: fix B3 with deterministic rules,
move the standing reminder to the one surface where "is the user wrapping up?" has its answer
in hand, build the floor RFC-043 designed, and keep a decision model (Jev) gated on evidence
gathered after all of that ships.

## 2. Principles the design is held to

1. **Less intrusive:** no forced turn that a non-blocking surface can replace; no repeat fire
   on a fact that cannot change.
2. **Deterministic backstop over probabilistic gate:** every suppression is a pure rule over
   git, brain and hook-payload facts, unit-testable, and every suppression that could hide a
   stale pin is backed by a floor (B2 for a missing handoff; Part A for a stale one).
3. **Fail toward today's behaviour** where a fact is unreadable, except where today's posture
   is already silence (`handoffIsStale` and Part A fail toward silence, as RFC-043 specifies).
4. **Provable with a can-fail L4** for every agent-facing change; content assertions only
   (ADR-0051 clause 3).

## 3. The phases

The issues use their own numbering. The review's §4 numbered differently; this table maps
them.

| Issue | Phase | Content | Review §4 |
|---|---|---|---|
| [#383](https://github.com/vilosource/vfkb/issues/383) | 1 | 1a no B3 before turn 3 · 1b defer every nudge on a paused stop · 1d drop the write-demand clause | Phase 1 rows 1a, 1b, 1d |
| [#384](https://github.com/vilosource/vfkb/issues/384) | 2 | update the plugin on all four profiles; Tier-0 probe of the SessionEnd 1.5 s budget; `vfkb doctor` symptom check | ranking item 2 |
| [#385](https://github.com/vilosource/vfkb/issues/385) | 3 | the standing reminder moves to `UserPromptSubmit`; B1 leaves Stop; harness-turn skip; Tier-0 probe of harness-generated turns | Phase 3 |
| [#386](https://github.com/vilosource/vfkb/issues/386) | 4 | RFC-043 Part 0 (anchor) and Part A (floor); the second half of Part 1's text | Phase 2 |
| [#387](https://github.com/vilosource/vfkb/issues/387) | 5 | 1c no B3 on the default branch with a clean tree · 1e B3 at most once per session | Phase 1 rows 1c, 1e (held until the floor exists) |
| [#388](https://github.com/vilosource/vfkb/issues/388) | 6 | re-measure after a release; Part B verdict | Phase 4 |

1c and 1e are held behind #386 because they can leave a session ending on a stale pin, and
only Part A makes that a relevance cost rather than a continuity loss.

## 4. Proposal

### 4.1 Phase 1 (#383): deterministic Stop WHEN-rules

In `decideStop`:

- **1a. No B3 before turn 3.** `turnValid && turn < 3` → B3 quiet. An invalid or missing turn
  keeps today's behaviour (fire). A turn-1 handoff can say nothing new, and this removes all
  single-turn headless fires.
- **1b. Every nudge is deferred on a paused stop.** `StopHookInput` gains optional
  `background_tasks` and `session_crons`; `cli.ts hook stop` passes them through from stdin.
  If either is an array with length > 0, `decideStop` returns `{ block: false }` immediately
  after the `stop_hook_active` guard, before any cooldown or trigger work and without
  `markNudged` (the cooldown slot is untouched). Absent, null, non-array or empty → today's
  behaviour. This applies to **all three nudges** (§8 G), so ADR-0084 amends ADR-0027 too.
  Accepted consequence: a long-lived background task or cron silences all nudges while it
  lives; B2, Part A and the committed-ADR backstop cover that, and Phase 6 counts deferred
  stops so it stays observed.
- **1d. Drop the write demand.** In `STALE_HANDOFF_REMINDER`, the sentence beginning "If you
  are still mid-session and plan to record one…" (through "…must be recorded before the
  session ends.") is replaced by **"If you are still mid-session, ignore this and finish
  normally."** (B1's wording). The lead-in `vfkb stale-handoff check:` stays byte-identical,
  because `nudge-fires.py` counts fires by it and Phase 6 must stay comparable with the
  review's baseline. Nothing in the Phase-1 text may claim a floor that does not exist yet.
- The code comment "built NOT yet verified — no RFC/ADR/L4 yet" is updated to cite ADR-0084
  (the status words stay until the L4 records exist).

### 4.2 Phase 2 (#384): the floor B2 leans on, checked first

- Update the plugin on all four profiles (`cldp`, `cldw`, `claude`, `oneio`); the review
  found all three it checked on 0.18.0, before ADR-0082's B3. Nothing is re-measured on an
  old plugin.
- **Tier-0 probe, first task of the phase**, committed under `docs/research/probes/`:
  (a) on the current CLI, is vfkb's SessionEnd (git status/show/add/commit, ADR-0083 Tier-1
  curation, the B2 fallback) killed at the 1.5 s default? Content assertion: after a
  `claude -p` session that adds a brain entry, the pathspec-scoped auto-commit is in
  `git log` and the hook's outcome says `committed`; a can-fail arm makes the hook sleep past
  1.5 s. (b) Does `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` raise the budget for a
  plugin-provided hook?
- **README guidance follows the probe, never precedes it** (§8 L): fits → no guidance, and
  a version-pinned gotcha supersedes `f0e913b97824`; truncated and (b) works → one
  symptom-driven README line; truncated and (b) fails → the fix goes in the hook (commit the
  brain first, curation and fallback inside a self-imposed deadline).
- **`vfkb doctor` symptom check** (RFC-024 §1's detection ownership): a session record
  exists, brain entries are newer than HEAD on a topic branch, and there is no vfkb
  auto-commit. It catches a silent truncation in any consumer regardless of the README.

### 4.3 Phase 3 (#385): the standing reminder moves to the next prompt

**Handler.** One new command, `vfkb hook user-prompt-submit` in `src/cli.ts`, registered
once in the plugin's `hooks.json`. v3 R1 (ADR-0080 step 2, still blocked on
`STEP2_GATE_MET`) plugs into the same handler later, as a separately gated branch
(`VFKB_RECALL=1`). The decision is a pure `decidePromptNudge` beside `decideStop`, reusing
`gatherStopContext` and the staleness check. The reminder text and predicate live in one
engine-side function so a later face can call it.

**Trigger.** Emit when (pin stale) OR (B1's condition: uncommitted `src/`/`docs/` work AND
≥ 3 new entries AND no `handoff`/`next` entry this session). "Pin stale" is today's
`handoffIsStale` until #386 lands, then Part 0.

**Output.** `hookSpecificOutput.additionalContext` with `hookEventName: "UserPromptSubmit"`.
Any failure emits nothing (no turn is at stake). **On by default** (§8 J): it replaces
default-on behaviour, and an opt-in would make Phase 3 a coverage loss.

**Wording** (§8 C), pinned by a unit test. A labelled fact, then one conditional whose
condition is the prompt in hand:

> vfkb handoff status: the pinned handoff ({id}, {created-date}) predates {N} commits on
> {branch}: {h1 subj}; {h2 subj} (+{k} more). If this prompt ends the session, a fresh
> handoff/next entry (kb_add type=fact, tags=handoff,next, role=human) naming what changed
> and what is next is the one thing worth recording before finishing; otherwise nothing is
> needed now — the next session sees this same list at start.

For B1 the fact clause is "this session has recorded {n} entries and no handoff/next
entry"; when both hold, both fact clauses appear and the conditional appears once. The
commit list is the same set Part A renders (newest first, `%h %s`, subjects ≤ 100 chars,
about 400 chars total). Before #386 the list is omitted and the fact clause says only that
the pin predates a later commit. Binding constraints:
1. The condition is about **this** prompt; never "before the session ends", "must", or "plan
   to record one".
2. The "otherwise" branch states that declining costs nothing (true once Part A ships; until
   then the "next session sees this same list" clause is omitted, per §8 K).
3. One imperative-shaped clause at most, inside the conditional.
4. A distinct label, never inside R1's `<vfkb-recall>` block, so it does not count against
   R1's budget or dedup.
5. The hook never inspects the prompt text to decide anything except the harness-turn skip
   below. The agent, with the prompt in hand, is the judge.

**Cadence** (§8 D). The SessionState record stores the last emitted key, `(pin id, pin
created, HEAD)`. Emit iff the condition holds and the key differs from the stored one. A
reason-only change (B1 vs stale) does not re-fire. An identical key returns before any
staleness work, so the steady-state cost is one `git rev-parse HEAD` plus the pin lookup.
The stored key is cleared on SessionStart `source: "compact"` (compaction evicts the line;
ADR-0080 set the same precedent), not on `resume`. No session id, or a failed save, → treat
as unset → emit while the condition holds.

**Harness-generated turns** (§8 E). A pure, git-free `isHarnessPrompt(prompt)` shared with
R1 skips prompts that start at column 0 with an observed harness lead-in: `<task-notification>`,
`Another Claude session sent a message:`, `Your claude.ai usage limit has reset`. Anything
else counts as typed (fail-open: a stray line costs no turn). The allowlist is data in one
place, citing the probe record. The three lead-ins come from brainstorm E's read-only tally of
local transcripts (1,353 of 1,377 system-origin turns start with `<task-notification>`, the
rest with the other two; 0 of 4,461 typed prompts match). **That tally is UNVERIFIED here.**
The probe below is what confirms it. A Tier-0 probe in this phase records the verbatim prompt head
for each harness turn kind the CLI can start (background-task completion, subagent hand-back,
cross-session message, cron or `/loop` tick, queued prompt, `-p` prompt) and whether the hook
fires at all. That discharges ADR-0080 §5's Q4 for both consumers.

**What stays on Stop** (§8 F): the loop guard, the `decision` nudge, and B3 only.
- **B1 leaves Stop entirely.** `decideStop` no longer composes `HANDOFF_REMINDER`, and the
  `nudgedAtTurn.handoff` key retires. B1 already has the B2 floor, and its uncommitted-work
  gate makes a Stop fire structurally mid-session.
- **B3 on Stop stays quiet once the line was delivered this session.** When the prompt line
  is emitted with the stale-pin reason, the handler calls the existing
  `SessionState.markNudged('staleHandoff', turn)`. Before #387 the existing cooldown then
  keeps Stop quiet for 10 turns; after #387 (1e) it is quiet for the session. One state, one
  rule. Missing session state keeps today's fail-open-toward-firing.
- Net Stop after Phases 1, 3 and 5: loop guard, decision nudge, and at most one B3 fire per
  session, only when B3 became true mid-turn at turn ≥ 3 and no prompt has carried the line.

**Pi** (§8 I) gets no reminder line. It never had Stop nudges, and it re-renders the resume
(with Part A) on every `before_agent_start`. Revisit only on evidence from a pi-session probe
showing stale pins at shutdown in ≥ 1 of 3 sessions.

### 4.4 Phase 4 (#386): RFC-043 Parts 0 and A, as written

Built as RFC-043 specifies, with these settled points:
- **Part 0's keys are `created`** (ADR-0082 §2, brain `853d9444599c`): `u` and the carrier
  `-G` pattern use the pin's `created`. The committed re-run of `anchor-proto.sh` with
  `created` keys
  ([`rerun-created-keys.txt`](../v3/research/probes/curation-2026-10-21/rerun-created-keys.txt))
  changes exactly two of 18 rows: case 3 quiet → `STALE {code2|code1}`, case 3b `{code3}` →
  `{code3|code2|code1}`. Those are the fixture answers for those rows.
- **Q5 / B′ adopted** (§8 B): with no carrier (uncommitted pin, outside-tree brain), rule 5
  drops from `S` every commit whose author date (instant compare) is at or before `u`, with
  no ancestry condition. The carrier path is unchanged. Unreadable author date → drop
  (toward silence). The disclosure widens: the amend/fixup/back-date silence (N2–N4) and the
  case-11 silence now also apply to no-carrier pins. Fixtures from round 4's `bp-all.out`: N5
  quiet, N5b `STALE {M1}` only (both flip from STALE under plain Part 0, so a missing B′ fails
  them), and 4b/8b/10b still STALE (the no-carrier path still fires).
- **The 33-case B′ table must be re-derived before it is a fixture source.** `bp-all.sh`
  sources `../rules-bp.sh`, which **was never committed** (checked 2026-10-27: no file in any
  branch or worktree). So `bp-all.out` is recorded evidence under `updated` keys, not a
  reproducible run. #386 recreates the rules (as the production code plus a committed
  script), re-runs all 33 cases under `created` keys, and commits the output before freezing
  fixtures. **Expected, not observed:** rows whose pin has a later version with a new
  `updated` (cases 3/3b, N8/N8b) may change the way case 3 did.
- **Part A** is the read-only render (§8 A): an injected `pinStaleness` provider (git layer,
  sharing Part 0's code and its `(pin id, created, HEAD)` cache) wired at `resumePayload`,
  the SessionStart hook, `context-block` and pi; a 400-char reserved slice under
  `## Last handoff`; neutral wording with no call to action; no annotation on git failure.
  This amends ADR-0049's render, beside ADR-0082 §3's pin id.
- **Part 1, second half** (§8 K), in the same PR as Part A: the B3 Stop text gains the
  "what moved" list (the same `S`, bounded) and the sentence "The next session's resume lists
  these same commits under `## Last handoff`, so a handoff written now is optional unless you
  are wrapping up." The `UserPromptSubmit` line gains its "next session sees this same list"
  clause at the same time.

### 4.5 Phase 5 (#387): the rules held for the floor

- **1c. No B3 on the default branch with a clean tree:** suppress `staleHandoff` iff
  `isOnDefaultBranch && !uncommittedWork && newEntries === 0`. `isOnDefaultBranch(git, cwd)`
  is **one helper extracted from `src/session-end.ts`** (§8 H) and called by both SessionEnd
  and 1c, so "where SessionEnd refuses to commit" and "where 1c is quiet" cannot drift. Its
  semantics: branch read live via `git symbolic-ref --short -q HEAD` (never the SessionState
  start branch); default = short name of `refs/remotes/origin/HEAD` when it resolves; a branch
  literally named `main` or `master` also counts; anything else (no origin/HEAD, detached
  HEAD, empty output) is **not** default, so B3 stays eligible. The helper's current
  `return 'main'` fallback goes (subsumed by the name rule). The branch calls run lazily, only
  when B3 is otherwise about to fire. SessionEnd's behaviour is unchanged.
- **1e. B3 at most once per session:** `lastNudged.staleHandoff` set (by a Stop fire or by
  the prompt line) → B3 quiet on Stop for the rest of the session.

### 4.6 Phase 6 (#388): re-measure, then decide Part B

After Phases 1–5 ship in a plugin release and every profile is updated, re-run
`nudge-fires.py` over ≥ 10 interactive sessions; also count deferred stops (1b) and
final-turn handoffs. **Part B's bar** is the ruling's: Stop-B3 still fires mid-session in
≥ 1 of 3 interactive sessions. Below the bar → Part B is recorded **not built** (a brain
decision citing #388's record), and deleting B3 from Stop becomes a live option. At or above
→ at most a per-project opt-in, log-only shadow; an amending ADR only if anything is built.

## 5. Relation to RFC-043

| RFC-043 part | Disposition here |
|---|---|
| Part 0 (anchor) | **Implemented as written**, keys switched to `created` (ADR-0082 §2), with Q5's B′ adopted. #386. |
| Part 1 (text) | **Implemented, split.** The write demand is dropped now (1d, #383); the "what moved / next session sees it" wording lands with Part A (#386), because it is false until then. |
| Part A (floor) | **Implemented as written**, read-only render (Q1). #386. |
| Part B (decision model) | **Gated**, not built. Bar named; owner #388. |
| act-mode `background_tasks` item | **Implemented by 1b**, widened from B3 to every nudge. |
| Q1–Q5 | Q1 read-only render; Q2 the ruling's bar; Q3 moot while Part B is gated; Q4 Parts 0/1/A first, then re-measure; Q5 adopt B′. |
| DoD scenarios | `stale-handoff-anchor.mjs` and `stale-pin-floor.mjs` kept as RFC-043 specifies (§7). |

**New here, not in RFC-043:** the deterministic WHEN-rules 1a, 1c, 1e; B1 leaving Stop; the
move of the standing reminder to `UserPromptSubmit`; the harness-turn predicate; the
SessionEnd budget probe and doctor check.

**Departure from RFC-043's own text, stated:** RFC-043 says "the accepting ADR records
Part B as not built, with the evidence". That evidence cannot exist before Phases 1–5 ship,
so ADR-0084 records Part B as **gated** and the verdict follows #388.

## 6. Alternatives considered

- **Jev on every turn (shadow or act).** Rejected now (review §3): at Stop a model must
  *predict* the next prompt; at `UserPromptSubmit` the prompt is in hand and the agent judges
  it for free. Its re-spike PASS is narrow and labeller-dependent, and gate 1 is unmeasured.
- **Delete B3 outright.** Not before Part A exists: it leaves a stale pin with no backstop.
  Becomes an option at #388.
- **A longer cooldown.** A rate limit, not an off-switch; it changes how often B3 nags, not
  why.
- **`type: "prompt"` / `"agent"` hooks.** Cannot see the user's prompt on Stop and loop
  without a guard (`fc07da198bfa`).
- **Stop `additionalContext` instead of `decision:block`.** The docs say it forces the same
  continuation; no saving.
- **A SessionEnd write as the stale-pin floor** (the floor `e68ad28f11b6` named). Misses
  clean trees and `main` by construction (`session-end.ts` returns `brain-clean` and refuses
  the default branch), dirties shared checkouts if forced, adds handoff sprawl, and is stale by
  the next session.
- **A statusline indicator.** Shows the user, not the agent; produces no handoff.
- **A pure fact line, or an unconditional instruction, on `UserPromptSubmit`.** The first
  passes its L4 only where CLAUDE.md already states the policy (a quiet success); the second
  is the clause that drove 18 of 24 premature writes (§8 C).

## 7. Definition of Done (ADR-0023/0029/0050/0051)

All L4s: Claude harness (`claude-haiku-4-5`), N = 3, DEMONSTRATED ≥ 2/3, a can-fail arm,
content assertions only. The vfkb plugin is disabled per sandbox and each scenario asserts it
stayed off (brain `fb712c13f39e`). One docker L4 at a time. Each is written and run **RED
before its build**.

1. **`scenarios/handoff-next-prompt.mjs`** (#385; also verifies 1a from #383). Two
   `claude -p` turns with one harness session id (`--resume`).
   - **Treatment (stale pin):** pin seeded, then a later plain non-brain commit (stale under
     today's rule and Part 0). Turn 2's prompt is a wrap-up. Asserts an agent-authored handoff
     (tags `handoff`/`next`, not `auto`) containing a session sentinel.
   - **Treatment (B1):** no stale pin; turn 1 makes uncommitted `src/` work and ≥ 3 entries;
     turn 2 is a wrap-up. Same assertion.
   - **Contrast:** the `UserPromptSubmit` entry disabled, B2 wired → only the `auto` floor.
   - **Negative (can-fail):** a mid-session turn-2 prompt → **no** handoff written.
   - **Stop precondition in every arm** (§8, 1a-in-L4 decision): the Stop hook is wired as
     `sh -c 'node <CLI> hook stop | tee -a <sandbox>/.stop-hook.log'`. After each turn the log
     must show ≥ 1 invocation (the hook ran) and no line containing `vfkb stale-handoff check`
     or `vfkb handoff check`. "Output is `{}`" is **not** the predicate (the decision nudge
     may legitimately block). A trial failing the precondition scores FAILED. Once, the
     predicate is shown RED against a pre-1a bundle.
   - Optional: if a backgrounded Bash call cheaply produces a `<task-notification>` turn, the
     hook output on that turn contains no `vfkb handoff status` line.
2. **`scenarios/stale-handoff-anchor.mjs`** (#386, Parts 0 and 1). Squash arm: the Stop hook
   ran and its output lacks the B3 text. Can-fail arm (a later commit): it contains the
   Phase-4 B3 text. Unit fixtures port all 18 prototype rows (created-key answers for 3/3b),
   round 4's rows from the re-derived 33-case run, the R3-M3 selector case and the
   regex-escape case.
3. **`scenarios/stale-pin-floor.mjs`** (#386, Part A). Agent with only the vfkb MCP tools
   (no shell). Treatment: SessionStart output contains the sentinel commit and the agent
   names it. Contrast (annotation disabled): it cannot. Squash negative: the output contains
   `## Last handoff` and the pin's own sentinel, and no "Commits since this handoff".
4. **Retired as a gate: `scenarios/session-end-handoff.mjs`** (ADR-0034's L4). It is a
   single-turn scenario blind to every change here and has no arm that can catch nagging.
   It and `scenarios/records/session-end-handoff.json` stay as ADR-0034's historical
   evidence; #385 adds a header note pointing at ADR-0084. It is not re-run.
5. **`scenarios/decision-capture.mjs`** is re-run after #383, since 1b changes the decision
   nudge's truth table.
6. **Unit / CLI e2e (inner gate)** for every phase: 1a (incl. invalid turn → fire); the 1b
   truth table (`[{}]` defers all three; `[]`/absent/`"x"` fires all three; same for
   `session_crons`) and a CLI e2e asserting `{}` stdout for a paused-stop payload; the 1d
   text and lead-in pinned; `decidePromptNudge` cadence (same key once; HEAD moved, pin
   replaced, compaction reset each re-emit; no session id emits every prompt) and a CLI e2e
   whose second identical payload produces empty output; `isHarnessPrompt` fixtures (every
   observed system shape skips; `<pasted_content …>`, slash text, `[Image #1]`, plain text do
   not; leading-whitespace `<task-notification>` documented as not skipped); the cross-hook
   e2e (`user-prompt-submit` then `stop`, same session id → no B3 text, different id → B3
   text); `decideStop` with B1's condition true emits no handoff nudge; the
   `isOnDefaultBranch` table and its divergence test against `sessionEnd(...).reason`.
7. **Status until those records exist:** every phase is **"built, NOT yet verified"**.
   **Delivery** of each plugin release is unproven until its install-path record is
   re-pinned; release notes carry what `release-gate.mjs` derives from
   `DELIVERY-STATUS.json`, and "delivery is unproven" whenever it is.

## 8. Open questions — settled

Each was answered by a Fable brainstorm agent under ruling `54802539cda7` and recorded as a
brain `decision` (role human) on the topic branch that introduced this RFC. Short form; the
reasons are in those entries and summarised in ADR-0084.

- **A (RFC-043 Q1).** The stale-pin floor is Part A's read-only render. No SessionEnd write,
  no hybrid.
- **B (RFC-043 Q5).** Adopt B′ (rule 5 applies without a carrier), with the fixtures,
  widened disclosure and created-key re-run in §4.4.
- **C. Line wording.** A labelled fact plus one conditional scoped to this prompt (§4.3).
  RFC-044 item 7 ("knowledge, never instruction") governs recall entries; Part A's "no call to
  action" governs the render, where no prompt is in hand. Neither governs this line.
- **D. Cadence.** Once per change of `(pin id, created, HEAD)` per session; reset on
  compaction.
- **E. Harness turns.** Ship the literal lead-in allowlist now; the Tier-0 probe feeds its
  fixtures in #385.
- **F. B1 on Stop.** Dropped. B3's Stop fallback stays quiet once the line was delivered
  (shared `markNudged('staleHandoff')`).
- **G. Does 1b defer the decision nudge?** Yes, every nudge; ADR-0084 amends ADR-0027.
- **H. Default branch for 1c.** One shared `isOnDefaultBranch` helper with SessionEnd;
  unknown → not default.
- **I. Pi parity.** No; Part A only.
- **J. Default.** On by default; R1 recall stays `VFKB_RECALL=1` in the same handler; no
  opt-out flag yet.
- **K. Accepting ADR.** ADR-0084 accepts this RFC and RFC-043 Parts 0, 1 and A; Part B
  gated. Part 1 is split as in §4.1/§4.4.
- **L. SessionEnd budget guidance.** Deferred to the probe, which runs first in #384; the
  doctor check is added regardless.
- **M. One PR or two.** One (§9).
- **1a in the L4.** Asserted as a precondition inside `handoff-next-prompt.mjs` via a tee
  log, not as its own arm.
- **`session-end-handoff.mjs`.** Superseded as a gate, kept as evidence, not re-run.

## 9. Why one PR

The two-PR shape of #376/#378 existed for a human acceptance step between proposal and
decision. Ruling `54802539cda7` already consumed that step, so a Proposed RFC on `main` would
be a comment period with no commenter. One PR lets the ADR-0052 review check that the ADR
accepts exactly this RFC. Precedent: RFC-004 + ADR-0019 and RFC-022 + ADR-0047 each landed
together.
