---
type: RFC
title: "RFC-043: The stale-handoff nudge fires on a fact, not a moment — a stale-pin floor and an opt-in decision-model observer"
description: "The Stop-hook nudge that fires 'all the time' is B3 (stale-handoff), not B1: over 104 sessions B1 fired 0 times and B3 23 times, 18 of them mid-session, and agents complied in 14, writing handoffs that the next merge made stale again. B3 has no RFC, ADR or L4. Its trigger is a fact that stays true for the rest of the session, so a cooldown only spaces the nags out. This RFC proposes (A) a deterministic floor that flags a stale pin at the next SessionStart, with no write and no commit, so suppressing B3 is safe; and (B) an opt-in observer seam, where a decision model such as TypeSafe Jev judges from a bounded window of the session whether the session is wrapping up, in shadow mode first, and only times B3, never creating or blocking anything."
status: "Proposed"
timestamp: 2026-10-20
---

# RFC-043: The stale-handoff nudge fires on a fact, not a moment

- **Status:** Proposed
- **Date:** 2026-10-20
- **Deciders:** operator + Claude
- **Governs:** the **B3 stale-handoff nudge** in `src/stop-reminder.ts`. B3 shipped as a
  "pragmatic patch, built NOT yet verified — no RFC/ADR/L4 yet" (its own code comment). This
  is its first governing proposal.
- **Operator ruling it implements:** brain `e9c19cc5819e` (2026-10-19). Scope is B3. A
  decision model only times B3 and never creates a fire. A stale-pin fallback makes a wrong
  "stay quiet" safe. Jev is the leading candidate but not pre-chosen. The shape is an
  observer seam, opt-in, consistent with Ruling 5.
- **Relates:**
  - [ADR-0027](../adr/ADR-0027-stop-hook-decision-capture-reminder.md) (the Stop-hook
    reminder pattern),
    [ADR-0033](../adr/ADR-0033-session-end-continuity.md) (the B2 missing-handoff floor),
    [ADR-0034](../adr/ADR-0034-b1-handoff-nudge.md) (B1) and
    [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md) (the handoff pin is a
    filter, not an inference — unchanged here).
  - [ADR-0013](../adr/ADR-0013-no-hard-native-dep.md): degrade to deterministic behaviour,
    take no hard dependency.
  - [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) and
    [ADR-0051](../adr/ADR-0051-delivery-honesty.md): the L4 contract.
  - v3 PRD Ruling 5 (brain `8b2aefd11171`): decision models stay an optional seam, not a
    theme.
- **Evidence:**
  - brain `a91f82e76700`: B3 is the nudge that fires, with the churn numbers;
  - brain `4f5077d1b89b`: the hand-labelled use-case measurement;
  - brain `fc07da198bfa`: what the native `type:"prompt"` Stop hook can and cannot see;
  - brain `aa294b2708c4`: a decision model can never be a Brake;
  - the probe kit in [`docs/research/probes/stop-nudge-2026-10-19/`](../research/probes/stop-nudge-2026-10-19/);
  - the decision-model survey,
    [`docs/research/decision-models-2026-10.md`](../research/decision-models-2026-10.md)
    §6.3, §9 and §10.

## Context

### What the nudge does today

`decideStop` (`src/stop-reminder.ts`) has three nudges:

| Nudge | Fires when | Governed by |
|---|---|---|
| decision | uncommitted `src/` or `docs/` changes and no `decision` entry since HEAD | ADR-0027 |
| handoff (B1) | the same, plus at least 3 new entries and no `handoff`/`next` entry | ADR-0034 |
| stale-handoff (B3) | the pinned handoff predates a non-brain commit | **nothing** |

Each repeats at most once every `NUDGE_COOLDOWN_TURNS = 10` turns (operator ruling
2026-07-31).

### Which nudge actually fires

The retained transcripts for this repo (104 sessions across the `~/.claude-cldp`, `~/.claude`
and `~/.claude-cldw` config dirs, counting `hook_additional_context` attachments only) show:

| Nudge | Fires |
|---|---|
| B1 handoff | **0** |
| decision | 1 |
| **B3 stale-handoff** | **23** |

B1 almost never arms here, because this repo commits its brain often. **B3 is the one the
operator experiences as "fires all the time"**, and it fired on the first turn of the session
that wrote this RFC, before any work had happened.

### Why the cooldown does not fix it

B3's trigger is a **fact** ("a commit landed after the pin"), not a **moment**. Once a PR
merges, the fact stays true until a new handoff is written, so B3 re-arms every 10 turns for
the rest of the session. The cooldown spaces the nags out. It cannot tell mid-session from
wrap-up, because nothing in `StopContext` says which one it is.

### What it costs

- **It produces premature handoffs.** Of the 23 B3 fires, 18 were mid-session and 5 were on
  the final turn. The agent complied in 14, writing a handoff before the next user prompt,
  and declined in 9. Two of those handoffs say outright that they were written "because that
  nudge has no end-of-session fallback" (turns 4/31 and 28/31 of one session).
- **It feeds a loop.** A mid-session handoff goes stale at the next merge, which re-arms B3.
  Sessions with 4–6 handoff writes each show it (`d5948d4c`: 5 fires, 5 writes; `edf377bb`:
  4 fires, 6 writes). This links to PRD R7's count of 106 `handoff`-tagged entries, of which
  only one is ever pinned.
- **Declining it is safe only if the agent keeps its word.** Session `61f0e751` declined B3
  mid-session ("I'm not wrapping up yet… I'll record a fresh handoff before the session
  ends"). As of 2026-10-20 that session is still running, so whether it keeps the promise is
  **not yet known**. Nothing in the code ensures it does.

That is the constraint on any fix. **B3 has no floor** (a structural fact about the code, not
an observed failure). B1 has ADR-0033's SessionEnd fallback underneath it, but a stale pin
has nothing. So suppressing B3 — by a model or by anything else — rests entirely on the
agent remembering to write a handoff later.

### Why the existing SessionEnd fallback cannot be the floor

`runSessionEnd` (`src/session-end.ts`) returns early when the brain file is clean (step 2), and
it never commits on the default branch (step 3). The defining B3 case is the opposite of a
dirty topic branch: the PR has merged and the checkout is back on `main`, clean. Sessions do
reach that state mid-session (`61f0e751`, turn 3: "Both repos are on `main` with nothing
uncommitted"). A stale-pin fallback written at SessionEnd would miss exactly that case. If it
wrote anyway, it would leave an uncommitted line in the main checkout's brain, the same
collision two sessions hit on 2026-10-19.

## Decision (proposed)

Two parts. **Part A** is deterministic, needs no model, and is worth building even if Part B
never ships. **Part B** is the observer, opt-in and shadow-first.

### Part A — the stale-pin floor: flag it at the next SessionStart

**Mechanism.** In the SessionStart hook shell (`cli.ts`, not the pure `renderContext`), compute
whether the pin is stale, using the existing `handoffIsStale` logic. If it is, list the
non-brain commits since the pin's anchor commit:
`git log --format=%h %s <anchor>..HEAD -- <the same pathspec handoffIsStale uses>`, capped at
10. Pass the result into the render. `renderContext` then appends a deterministic note under
the `## Last handoff` section:

```
⚠ This handoff predates 3 commits on this branch — it may be out of date:
  7d1429c docs: small fixes — CLAUDE.md --tag, ADR index backfill (#354)
  be8be65 test: compaction re-injection is load-bearing (#352)
  …
```

**Why read-only beats a written fallback:**
- It works on a **clean tree** and on **`main`**, which are both cases a SessionEnd write
  cannot cover (Context, last section).
- It writes nothing, so it cannot collide with another session's working copy, cannot
  dirty `main`, and adds no handoff to R7's sprawl.
- It is computed **fresh at read time**, so it also covers merges that land between sessions,
  from another session or an autonomous merge, which a SessionEnd write could not know about.
- It keeps ADR-0049 intact: the pin is still selected by filter, and the note is only an
  annotation on it.

**What it does not do.** It does not write a better handoff. It tells the next session that
the pin is behind and what moved, which is the information a stale pin hides. The
agent-authored handoff stays the higher-quality path, and B3 still asks for it at the right
moment.

**This departs from the ruled mechanism.** Ruling `e9c19cc5819e` names "a SessionEnd fallback
for a stale pin". Part A serves the same purpose by a different mechanism, for the reasons
above. **That substitution is the operator's call (Q1), not this RFC's.**

**Cost.** Two extra git calls at session start (`rev-list` plus `log`) when a pin exists. The
staleness check already runs on every Stop today, so this adds no new kind of work.

### Part B — the observer: a decision model times B3

#### The question being asked

The useful quantity is *"is it likely that no more substantive work happens in this session
after this turn?"* A B3 nudge that fires too early produces the churn above. One that fires
too late or never is covered by Part A.

#### What the observer sees (the window)

**From rules, sent to no model:**
- **Precondition:** B3's trigger holds (the pin is stale) and B3 is not cooling. **The model
  is consulted only when B3 would already fire today.** It can delay or suppress a fire. It
  can never create one.
- **Hard suppress:** the Stop payload's `background_tasks` or `session_crons` is non-empty.
  If something is still running, the session is not ending. (Both fields observed on CLI
  2.1.292.)

**Text sent to the model, about 2k tokens at most:**
- **The last 3 user prompts,** newest last, each truncated to 600 characters. They are
  recorded by a new `hook user-prompt-submit` handler into `SessionState`. That handler makes
  no network call and injects nothing. The prompt arrives in the payload's `prompt` field
  (observed; a docs summary says `user_input`, so accept both).
- **The tail of the agent's final message,** from the Stop payload's `last_assistant_message`,
  last 1,000 characters. That is where "want me to…?" and "I'll merge once CI settles"
  appear.

**Excluded, deliberately:**
- **Hook-injected text, including B3's own reminder.** It literally says "WRAPPING UP".
- **System reminders and pasted blocks.**
- **Turns Claude Code starts on its own** (task notifications, crons). The hooks reference
  says `UserPromptSubmit` also fires for those (**UNVERIFIED**: docs only, not observed
  here). Record only prompts whose source is the user either way.
- **Tool output, diffs, file contents and brain entry text.** They do not predict wrap-up,
  and they would send data off the machine.
- **The transcript file.** Its format is internal and undocumented; the probe session alone
  had more than 8 record types.

All text is checked with `detectSecrets` (`src/secrets.ts`). A window that contains a
detected secret is **not sent**, and the deterministic behaviour applies for that turn.

#### The questions

Atomic yes/no questions, evaluated together in one call, each phrased positively because the
candidate model handles negation inconsistently:

| Id | Question |
|---|---|
| `close` | In the most recent user message, the user indicates the work is finished or asks to finish up (for example: commit and push as a final step, thanks or that's all, wrap up, stop for today, write the handoff). |
| `more` | The recent user messages ask for further work or name work to do next in this session. |
| `ask` | The assistant's final message ends by asking the user a question or waiting for the user's decision. |
| `done` | The assistant's final message reports that the requested work is complete. |

**Policy, in code:** fire B3 if `close ≥ T1`, or if `done ≥ T2` and `ask < T3` and
`more < T4`. Otherwise stay quiet this turn. The thresholds come from calibration (below),
not from guesses. After the observer fires, the existing cooldown applies unchanged.

#### The seam

```ts
interface Decider {
  /** Probabilities per question id, or null for "no decision" (any failure). */
  decide(window: TurnWindow, questions: Question[]): Promise<Record<string, number> | null>;
}
```

- `TurnWindow` is harness-neutral. The Claude Code face fills it from hooks. pi has no Stop
  nudge today, so pi wiring is out of scope, but nothing in the seam is Claude Code-specific.
- **`NullDecider` is the default.** It returns `null`, which means "behave exactly as today".
- **`JevDecider`:** a single `POST` to `https://api.typesafe.ai/v1/systemone` with `fetch`
  (no SDK, per survey §9). The model is pinned to `jev-1.13.0`, because `jev-latest` changes
  without notice and calibrated thresholds would silently drift. The key comes from
  `TYPESAFE_API_KEY`. Timeout 1.5 s. Any 401, 422, 429, 529, timeout, network error, or
  missing key returns `null`.
- **`ReplayDecider`** reads recorded responses from a fixture file, for tests and the L4.
- **Selection is opt-in per project:** `VFKB_DECIDER=jev` and `VFKB_DECIDER_MODE=shadow|act`.
  With neither set, the engine never builds a window, never makes a network call, and
  behaves as today.

#### Shadow mode first

**The available labels are too few to fit thresholds.** The hand-labelled corpus is about 90
interactive turns (brain `4f5077d1b89b`), under the 50–300 labelled decisions the independent
reviews recommend. So the first build ships `VFKB_DECIDER_MODE=shadow`:

- The observer builds the window, calls the model, and computes the policy's answer.
- **It acts on nothing.** B3 behaves exactly as today.
- It appends one record per consulted Stop to `.vfkb/.signals/decider.jsonl` (gitignored):
  timestamp, session, turn, the four probabilities, the rule-based facts, what the policy
  would have done, and what B3 actually did.
- An offline script labels each record afterwards from what really happened (was this the
  session's last substantive turn?) and fits T1–T4.

**The rule-only baseline is evaluated on the same log.** A keyword classifier over the same
window ("wrap up", "that's all", "handoff", "commit and push", ending in a question mark)
runs alongside the model. **If it performs as well as the model, ship the rules instead:** no
egress, no key, fully deterministic. That makes the model earn its place on vfkb's own data.

**The proposed gate for switching to `act`** (Q3, operator's call):
- at least 100 consulted Stops logged;
- on the labelled log, the policy suppresses at least half of today's mid-session B3 fires;
- and it misses at most 1 in 10 final-turn opportunities;
- and it beats the rule-only baseline on the same log.

#### Why Jev is the leading candidate, and what it is compared against

The output the agent sees is vfkb's own fixed reminder, so the model only has to answer
yes or no. That favours a discriminative model that returns a probability over a generative
judge.

| | Jev | Native `type:"prompt"` Stop hook | Rules only |
|---|---|---|---|
| Returns | a probability per question, so thresholds can be tuned | ok/blocked plus a reason, no tunable threshold | yes/no |
| Can see the user's prompt | yes, vfkb builds the window | **no.** `$ARGUMENTS` is the Stop payload only (observed, `fc07da198bfa`) | yes |
| Loop guard | vfkb's `stop_hook_active` | **none unless the prompt handles it.** It re-blocked 10 times on "Say hi" (observed) | vfkb's |
| Latency | vendor: 70–500 ms; one review measured about 105 ms server-side | 1,979 ms, one timed pass (observed) | about 0 |
| Cost per consulted Stop | about $0.0001 (≈2k tokens at $0.042/M) | about 2.9k Haiku input tokens (observed) | 0 |
| Replay in tests | yes, near-deterministic | hard, generative | yes |
| Data egress | yes, to TypeSafe | stays with Anthropic | none |

**Known limits of the leading candidate, each with its handling here:**
- intent-style accuracy is mid-tier, about 72.5% in one independent study → calibration on
  vfkb's own log, and the rule-only baseline as a bar it must clear;
- yes/no answers tend to be underconfident → per-question thresholds, not 0.5;
- about 1–2% of answers change between identical calls → it only times a nudge, and Part A
  covers a miss;
- it cannot explain itself → no explanation is needed, because the reminder text is fixed;
- injectable by text in its input → the agent's final message is in the window, so the agent
  could talk B3 quiet. The cost is one late handoff, which Part A covers. That is a relevance
  cost, not a correctness one, which is the only kind of placement survey §4 allows.

**It is not a Brake.** The deterministic precondition stays the trigger, and the model only
removes fires. Every Brake listed in `aa294b2708c4` stays permanently out of scope.

### Follow-on use cases — listed, not built

The observer is shaped so further question sets can attach. Each needs its own evidence
first. Measured 2026-10-19 (brain `4f5077d1b89b`):

| Use case | Evidence so far | Status |
|---|---|---|
| Rulings stated in the user's prompt are captured as `decision` entries | 17 rulings: 11 recorded within 2 turns, 4 landed only in a fact, handoff or harness memory, 2 missed | **Follow-on.** The real gap is rulings stored in harness memory, which does not travel between config dirs |
| Promises the agent makes ("I'll merge once CI settles") are followed through | About 6 promises: 3 times the operator had to poll; a 4th (`61f0e751`'s promised handoff) is still open because that session is still running | **Needs a better question first.** A background task was running in 2 of the poll cases, so "promised but nothing scheduled" would miss them |
| The decision nudge (survey §6.3 as written) and B1 | B1 fired 0 times; decision once | Follow-on |
| Tool-output capture (survey §6.2) | the feature is switched off for want of a filter | Follow-on |
| Work mentioned in passing ("remember #321") | 2 instances, both captured | **Dropped.** Too rare to justify a build |

At most **one** steering message per turn across all of them, chosen by a fixed priority in
code, so adding consumers cannot recreate the nagging this RFC removes.

## Alternatives considered

- **Lengthen the cooldown.** It changes how often B3 nags, not when. Rejected.
- **Delete B3.** It would leave stale pins unannounced, which is the failure B3 exists for.
  With Part A in place, deletion becomes a real option; the shadow log will show whether the
  observer adds anything over Part A alone.
- **A SessionEnd write for the stale-pin floor.** It misses clean trees and `main`, and it can
  dirty another session's working copy (Context). Q1 asks the operator to choose.
- **The native `type:"prompt"` hook.** It cannot see the user's prompt. Rejected for this
  question.
- **An agent hook (`type:"agent"`) that reads the transcript.** Experimental, 60 s default
  timeout, a full model run per Stop. Rejected.
- **Parse the transcript at Stop instead of recording prompts.** An internal, undocumented
  format. Rejected.
- **The `@typesafe-ai/sdk` package.** One `POST` does not need a dependency. Rejected per
  survey §9.

## Consequences

- **Cross-repo.** The `UserPromptSubmit` hook entry lives in
  [vilosource/vfkb-claude-plugin](https://github.com/vilosource/vfkb-claude-plugin)'s
  `hooks.json`. It must pass the R6 `claude plugin validate --strict` gate. v3 R1 also
  plans a `UserPromptSubmit` hook; the two should share one entry and one handler.
- **Latency.** The `UserPromptSubmit` handler adds one Node process start per prompt (about
  60–110 ms, the same as today's Stop hook) and no network call. The Stop hook adds a model
  call only when B3 would already fire and is not cooling, bounded at 1.5 s.
- **Data egress (opt-in only).** With `VFKB_DECIDER=jev`, the last 3 user prompts and the
  final-message tail go to TypeSafe, a new third-party processor, on the turns where B3 is
  armed. vfkb is a substrate that other repos adopt, so this is off by default, per project,
  and this paragraph must carry into the ADR and the plugin's README.
- **Ruling 5 holds.** This is an opt-in seam with one consumer, not a v3 theme.
- **B3 gains governance.** The accepting ADR becomes B3's first ADR. Its "built, NOT yet
  verified" status ends only with the L4 below.
- **Part A annotates without selecting.** ADR-0049's newest-wins pin is untouched.

## Definition of Done

Both parts are user-facing, so both need an agent-driven L4 under ADR-0050/0051: committed,
reproducible, DEMONSTRATED at 2 of 3 or better, with an arm that can fail.

- **Part A — `scenarios/stale-pin-floor.mjs`.** Seed a sandbox brain with a pinned handoff,
  then make a non-brain commit after it. Start a session and ask what the current state is
  and what to do next. **Treatment:** the agent names the post-pin commit. **Contrast** (the
  annotation disabled): the agent reports the pin's stale state. Predicate: a content
  assertion over the agent's answer for the commit's sentinel subject.
- **Part B — `scenarios/stale-handoff-timing.mjs`,** run with `ReplayDecider` on committed
  fixtures, never a live API (survey §9: a live third-party arm is neither reproducible nor
  sandboxed). Two arms, each a short scripted multi-turn session after a merge:
  - **Mid-session arm:** the user keeps asking for more work. Treatment: B3 does not fire.
    Contrast (`NullDecider`, today's behaviour): B3 fires. The contrast is the can-fail arm.
  - **Wrap-up arm:** the user says "that's all for today". Treatment: B3 fires and the agent
    writes a handoff.
  - Predicates are content assertions over hook outputs and the sandbox brain, not exit codes
    (ADR-0051 §3).
- **Live calibration** is recorded separately as dated evidence from the shadow log, never as
  a gate input.
- **Unit tests (the inner gate):** the window builder (exclusions, truncation, the secret
  skip), the policy (thresholds, the hard suppress, null leads to today's behaviour), the
  Decider error paths (every failure returns null), and the Part A render annotation.
- **Isolation:** the vfkb plugin is enabled at user scope on this machine (brain
  `fb712c13f39e`), so both scenarios disable it per sandbox and assert that it stayed off.

## Open questions (operator)

1. **The floor's mechanism.** Part A's read-only SessionStart annotation (recommended), or
   the SessionEnd write the ruling names? The annotation covers clean trees, `main` and
   merges between sessions; the write does not.
2. **Where shadow mode runs.** Only in this repo, or shipped in the plugin to every consumer
   (inactive without `VFKB_DECIDER`)?
3. **The gate for switching to `act`.** Are the thresholds proposed above (at least 100
   consulted Stops, at least half the mid-session fires suppressed, at most 1 in 10 final
   turns missed, and better than the rules) the right bar?
4. **Sequencing.** Build Part A first and on its own (recommended: it closes the stale-pin
   gap with no model), then Part B?
