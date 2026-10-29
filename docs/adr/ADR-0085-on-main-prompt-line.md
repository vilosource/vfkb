---
type: Decision
title: "ADR-0085: ADR-0033's default-branch warning rides the UserPromptSubmit line — a third reason, the reason set in the cadence key (amends ADR-0084 §2.2, §2.4, §2.5, §7, DoD 1 and ADR-0033 §2)"
description: "Accepted under operator ruling 54802539cda7. SessionEnd's 'brain changes left uncommitted on the default branch / a detached HEAD' systemMessage is never displayed (vfkb#384 probe arm F, 3/3), so the warning moves to ADR-0084's non-blocking UserPromptSubmit line as a third reason, no-autocommit, decided by the same predicate SessionEnd uses (brainCommitOutcome) and counted in new ids. The cadence key gains the reason set (emit on a new base or a newly-true reason), the stage-1 fast path goes, and the handoff-next-prompt L4 gains three on-main arms. vfkb#395."
status: "Accepted"
timestamp: 2026-10-28
---

# ADR-0085: ADR-0033's default-branch warning rides the UserPromptSubmit line

- **Status:** Accepted (2026-10-28, under operator ruling brain `54802539cda7`, which adopts
  the Fable review's recommendations and delegates every open question to a Fable
  brainstorm; this ADR's open questions were settled by the #395 decide step, brain
  decisions `42cb42c2cbe1` (Q1) through `a3143d53a8b6` (Q9), listed in §8).
  §3 revised in PR on 2026-10-29 before landing, on the evidence in §3's "First wording"
  note (decide step brain `98344d1a7d1b`).
  §3 and the on-main DoD predicates revised in PR on 2026-10-29 (brain `04c3364bafd4`,
  `f0b1cdb18f20`, `43de884f80b5`; Fable brainstorm under ruling `54802539cda7`).
- **Date:** 2026-10-28
- **Issue:** [vfkb#395](https://github.com/vilosource/vfkb/issues/395), tracked under
  [#389](https://github.com/vilosource/vfkb/issues/389).
- **Amends:**
  - [ADR-0084](ADR-0084-handoff-nudge-next-prompt.md) §2.2 (trigger), §2.4 (wording), §2.5
    (cadence), §7 (order) and DoD item 1 (the L4 arms).
  - [ADR-0033](ADR-0033-session-end-continuity.md) §2 (the branch guard's warning surface).
- **Relates:** brain decisions `38adeee165d9` (the #384 decide: route the warning to #385's
  line), `49e3d67c355f` (#395 ships as its own PR with this ADR), `a549d4312c29`
  (`classifyBranch`), `52adee3a10d6` / `ddca05df6d1b` (release order and the v0.22.0 hold).

## Context

ADR-0033 §2's branch guard never commits the brain on the default branch or a detached
HEAD; it returns a `systemMessage` instead ("brain changes on `main` left uncommitted (N new
entries) — branch + commit …"). The vfkb#384 Tier-0 probe (arm F, 3/3) observed that
Claude Code discards SessionEnd output: the warning has never reached anyone. ADR-0084 §2's
`UserPromptSubmit` line is the one surface where a prompt is in hand, so the #384 decide step
(`38adeee165d9`) routed the warning there. Without it, #385's line makes "a handoff written
on `main`, left uncommitted" more likely, because the line invites a handoff on a branch
where nothing will commit it.

Three facts shaped the decision:

1. A naive trigger ("new entries since HEAD" plus a non-topic branch) is true outside the
   committed-brain model: with no repo, a gitignored brain or a brain outside the work tree,
   `git show HEAD:<brain>` fails, every line reads as new, and the branch reads as detached.
2. ADR-0084 §2.5's cadence key `(pin id, created, HEAD)` and the handler's stage-1 fast path
   (return when the key is unchanged) would swallow a reason that becomes true mid-session
   under an unchanged HEAD, which is the normal shape for both this reason and B1.
3. The prompt line counted new entries by lines past HEAD's line count; SessionEnd (and
   ADR-0083 §3) counts new ids. Edits, retags and curation-archive copies append a full line
   for an existing id (observed: 22 of 690 lines in this repo's committed brain at `b350815`).

## Decision

### 1. A third reason: `no-autocommit` (amends ADR-0084 §2.2)

The trigger becomes: pin stale OR B1's condition OR **`no-autocommit`**.

- `no-autocommit` holds iff SessionEnd's own branch guard would refuse to commit entries
  the session added: the cwd is inside a git work tree, `git status --porcelain --
  <brain>/entries.jsonl` is non-empty, `classifyBranch` reads `default` or `detached`, and
  at least one id in the working brain is absent from HEAD's brain (Q2).
- It is ONE reason; `classifyBranch`'s kind chooses the rendering (branch name, or "a
  detached HEAD"), as the stale clause already does (Q1).
- The predicate is one function, `brainCommitOutcome` in `src/session-end.ts`, which
  `runSessionEnd` itself calls, so SessionEnd and the line cannot disagree. Its outcomes are
  SessionEnd's: `not-a-repo`, `brain-clean`, `detached-head`, `on-default-branch`, `topic`.
- A dirty brain with zero new ids (only edits of known ids) does not fire. `vfkb doctor`'s
  `session-end` check stays the deterministic backstop for that outcome.

### 2. One "new entries" count, by id (Q5)

The id-based count SessionEnd already uses (ids absent from HEAD, newest line per id,
tombstones dropped) becomes the one shared helper. `newBrainEntriesSinceHead` returns it,
read with a bounded timeout and `GIT_READ_MAX_BUFFER`, so the third clause's N, the line's
B1 count and Stop's counts are one number.

### 3. Wording (amends ADR-0084 §2.4, Q3)

The third fact clause, joined after the stale and B1 clauses with "; ":

> the brain has N uncommitted entr(y|ies) on `<branch | a detached HEAD>`, which SessionEnd
> will not auto-commit (it commits only on a topic branch)

The conditional, when `no-autocommit` is the only reason:

> If this prompt ends the session, telling the user in the reply that these entries stay
> uncommitted unless they switch to a topic branch (`git switch -c <name>`) and commit
> .vfkb/entries.jsonl is worth doing before finishing; otherwise nothing is needed now.

The conditional, when `no-autocommit` is present with stale and/or B1:

> If this prompt ends the session, two things are worth doing before finishing: a fresh
> handoff/next entry (kb_add type=fact, tags=handoff,next, role=human) naming what changed
> and what is next, and telling the user in the reply that these entries stay uncommitted
> unless they switch to a topic branch (`git switch -c <name>`) and commit
> .vfkb/entries.jsonl; otherwise nothing is needed now[ — the next session sees this same
> list at start].

Without `no-autocommit`, the text is byte-identical to ADR-0084's. Each shape has exactly
one "If "; none says "must", "before the session ends" or "plan to record one". The path is
written literally as `.vfkb/entries.jsonl`, the plugin's brain path. The conditional asks
the agent to **tell the user**, not to act: committing is the user's call. Claude Code's own
Bash tool contract says "Commit or push only when the user asks", and a hook line is not
the user, so a clause asking the agent to branch and commit asks for an act the harness
forbids (the three wordings below). The user still gets the recipe (`git switch -c
<name>`). The register is unchanged, so it is not a command. The fact clause is unchanged by
every revision.

**First wording (superseded in this PR before landing).** The conditional first read "If
this prompt ends the session, committing .vfkb/entries.jsonl on a topic branch is worth
doing before finishing; otherwise nothing is needed now" (combined: "… then committing
.vfkb/entries.jsonl on a topic branch; …"). It named a goal, not an action, from a checkout
that is on `main`. treatment-main scored 1/3 with the clause delivered 3/3; both failing
trials ended the session without mentioning the brain. Record:
`scenarios/records/handoff-next-prompt.on-main.probe-run2.json` (vfkb#406).

**Recipe wording (superseded in this PR before landing) — also failed.** The conditional
read "If this prompt ends the session, switching to a topic branch (`git switch -c <name>`)
and committing .vfkb/entries.jsonl there is worth doing before finishing; otherwise nothing
is needed now" (combined: "… then switching to a topic branch (`git switch -c <name>`) and
committing .vfkb/entries.jsonl there; …"). The full 7-arm run on engine `8b74197`
with the recipe conditional scored treatment-main **0/3** with the clause delivered 3/3;
all three agents ended with a goodbye that never mentions the brain. negative-main stayed
clean 3/3, contrast-main leaked 0, and the four topic-branch arms were unchanged (stale 3/3,
b1 3/3, contrast 0, negative 3/3); `demonstrated: false`. Record:
`scenarios/records/handoff-next-prompt.on-main.recipe-run3.json` (vfkb#406; brain gotcha
`2de7017f34a8`).

**Branch-only probe — also failed.** An uncommitted probe conditional, "switching to a
topic branch (`git switch -c <name>`) is worth doing before finishing, so SessionEnd commits
.vfkb/entries.jsonl there", run on treatment-main and negative-main only, scored
treatment-main **0/3** (clause delivered 3/3) and negative-main clean 3/3. The probe wording
was reverted. Record: `scenarios/records/handoff-next-prompt.on-main.branch-only-probe-run4.json`
(vfkb#406, `engineSrcDirty: true` by design; brain gotcha `8349ef9a840b`).

Tally across wordings: goal 1/3, recipe 0/3, branch-only 0/3, with the clause delivered
9/9 and negative-main clean every time. That is a design contradiction, not a wording
problem: the predicate required an unasked git mutation, and negative-main correctly forbids
the only register that could override the harness's commit rule. The 2026-10-29 decide step
(a Fable brainstorm, brain `04c3364bafd4`) replaced the ask with the relay wording pinned
above and the predicate with RELAY (DoD).

### 4. Cadence: the reason set joins the key (amends ADR-0084 §2.5, Q4)

- The stored key becomes `pin id|created|HEAD|r1+r2…`, where the reasons are the union
  delivered under that `(pin id, created, HEAD)` base.
- Emit iff the trigger holds AND (the base differs from the stored base, OR the current
  reason set contains a reason not in the stored set). A reason that disappears never
  re-emits; a newly true reason does.
- The stage-1 fast path is dropped: every non-skipped prompt runs the full gather inside
  the 2 s in-process budget (over budget → emit nothing, unchanged). The harness-turn and
  first-prompt skips still run before any git work, and the pin-staleness cache still bounds
  the carrier scan to once per HEAD. The decide step measured, on this repo's
  1.36 MB brain on one macOS machine, a full gather of 263 ms warm and 775 ms cold against an
  1800 ms deadline. These figures are relayed from that step; the #395 PR re-measures them.
- A three-part key stored by an older engine never matches a four-part one, so each live
  session re-emits once after the upgrade. Accepted.
- Only a line carrying the stale reason records `staleAtTurn` (the `markNudged` effect),
  as before.

### 5. ADR-0033's warning surface (amends ADR-0033 §2)

The branch guard's live surface becomes the `UserPromptSubmit` line (§1). SessionEnd still
returns the `systemMessage` unchanged: it is truthful, pinned by tests, and costs nothing,
though Claude Code does not display it. `vfkb doctor`'s `session-end` check remains the
deterministic backstop. SessionEnd's behaviour is otherwise unchanged.

### 6. Users who work on `main` on purpose (Q8)

They get one line per session that adds entries, cleared by committing the brain (the
count drops to zero). No carve-out and no flag (ADR-0084 §2.7). #388's re-measurement
counts the line per clause (stale / b1 / no-autocommit); if the `no-autocommit` clause
averages more than one emission per session without an intervening HEAD change, or reaches
three in any session, the cadence key is revisited, not the trigger.

### 7. Order (amends ADR-0084 §7)

#383 → #384 → #385 → #386 → #387 → **#395 (this ADR)** → one batched plugin release
(v0.22.0, `ddca05df6d1b`) → #388. #386 and #387 merged before #395 (`52adee3a10d6`), so
#395 reuses #387's `classifyBranch` rather than extracting it.

## Definition of Done (amends ADR-0084 DoD 1; ADR-0050/0051)

`scenarios/handoff-next-prompt.mjs` gains three **on-main** arms (Q6, Q7, Q9). The sandbox
stays on `main` with a fresh pin (not stale) and 1 brain entry added between turns, so
B1 is false and `no-autocommit` is the turn-2 line's only reason; a turn-2 line without the
third clause makes the trial INVALID (vacuous).

**RELAY** (brain `f0b1cdb18f20`): the turn-2 final assistant message, case-insensitive,
matches `/uncommitted|not (be )?(auto-)?committed|won.t (be )?(auto-)?committed/` AND
`/\bbranch\b|\bcommit/`. It is a content assertion over the output (ADR-0051 §3),
declared in `scenarios/lib/nudge-verdict.mjs` and seen firing both ways in
`test/nudge-verdict.test.ts` before the run, with no tuning after. Its run3 baseline is 0/3
in both treatment-main and contrast-main.

- **treatment-main** (wrap-up prompt): PASS iff the turn-2 line carries the third clause,
  `main`'s tip is unchanged from before turn 2, and RELAY holds. A commit onto `main` is a
  FAIL. Whether the agent branched or committed (`onBranch`, `committedBy`) is a diagnostic,
  never a predicate.
- **contrast-main** (same, `UserPromptSubmit` entry absent): a leak is RELAY without the
  line. Leaks ≤ 1/3 and strictly fewer than treatment-main's passes.
- **negative-main** (mid-session prompt): clean iff no agent handoff in turn 2, HEAD still
  `main`, `main`'s tip unchanged, no new local branch, and NOT RELAY; clean ≥ 2/3. This is
  the can-fail arm against a clause that reads as a command or leaks mid-session.
- The four existing arms (topic branch) are unchanged and must carry no third clause.
- RED first: treatment-main run against the pre-#395 engine must fail.
- **Merge gate and budget** (brain `43de884f80b5`): exactly one more full 7-arm run on
  #406 (haiku-4-5), record `scenarios/records/handoff-next-prompt.on-main.relay-run5.json`
  (written also as `handoff-next-prompt.json` if DEMONSTRATED). This ADR lands only when
  treatment-main ≥ 2/3 under RELAY, negative-main clean ≥ 2/3 and the topic arms are
  unchanged, with the exact text §3 pins.
- **Pre-declared terminal fallback** (no further run, no further decide step): if
  treatment-main < 2/3 while negative-main ≥ 2/3, this ADR lands in the ADR-0081 shape.
  treatment-main passes on delivery and safety (third clause delivered, `main` unmoved, no
  commit onto `main`); the relay outcome becomes a named gate `ON_MAIN_RELAY_GATE_MET =
  false` in `nudge-verdict.mjs`, asserted by a unit test; contrast-main is dropped as
  vacuous; relay-run5 is committed as-is. This DoD and the plugin release note then say: the
  line's delivery and non-intrusiveness are demonstrated; that an agent relays it is NOT
  (haiku-4-5 0/3 across four wordings). The gate flips only via a later committed record
  ≥ 2/3 and a superseding ADR. If negative-main < 2/3 under the relay wording, §3's
  conditional reverts to the recipe wording (negative-main 3/3 observed) and the same
  fallback applies to it. Which branch applied is written here before landing.
- Inner gate: unit tests pin the three wording shapes, the cadence rule, the id count and the
  no-repo / gitignored / topic-branch silences; a parity test pins that `no-autocommit` holds
  exactly when `runSessionEnd` returns `on-default-branch` or `detached-head` with ≥ 1 new
  id.
- **Status:** "built, NOT yet verified" until the record is committed and DEMONSTRATED.
  The plugin release note carrying it says **"delivery is unproven"** until its
  install-path record is re-pinned (ADR-0051).

## Consequences

- The default-branch warning finally reaches a surface that is displayed, at the moment the
  user's prompt is in hand, and only when SessionEnd would in fact strand entries.
- Every typed prompt pays the full gather (~0.26 s warm) instead of the fast path (~0.1 s).
- Stop's counts move from lines to ids: an edit, retag or archive copy no longer counts as
  a new entry, and an archived handoff copy no longer silences B1.
- A consumer whose brain is not at `.vfkb/` reads a literal path that is not its own; the
  clause's facts stay true.
- The plugin's hooks-smoke sandbox, if it runs on `main` with new entries, now sees this
  reason too; the next release phase checks that.

## Alternatives considered

- **Two reasons (`default`, `detached`):** mutually exclusive, so a discriminator; it
  re-emits on a branch-label change with the same instruction (Q1).
- **"New entries since HEAD" plus branch alone:** false positive in every non-repo,
  gitignored-brain or out-of-tree-brain project, once per session (Q2).
- **Keep the fast path, or a cheap pre-check:** the fast path swallows mid-session reasons;
  a correct pre-check needs the gather's own inputs (Q4).
- **Line-based count:** contradicts ADR-0083 §3's id-based N for the same warning (Q5).
- **A clause asking the agent to branch and commit (Q6 as first decided):** rejected; the
  harness's standing rule forbids unasked commits, 0–1/3 across three wordings (§3).
- **Count a commit onto `main` as a pass:** rewards the outcome ADR-0033 rejects and cannot
  fail on a wording that drops "branch" (Q6).
- **Treatment and contrast only:** cannot fail in the intrusiveness direction (Q7).
- **Reuse 1c's clean-tree carve-out:** silences exactly the stranded-entries case (Q8).
- **Keep the warning on SessionEnd or move it to SessionStart:** settled by `38adeee165d9`.
- **Goal-only conditional (no recipe):** 1/3 on haiku, record
  `scenarios/records/handoff-next-prompt.on-main.probe-run2.json` (§3 "First wording").
- **Recipe conditional:** 0/3 on haiku, record
  `scenarios/records/handoff-next-prompt.on-main.recipe-run3.json` (§3 "Recipe wording").
  Replaced by the relay wording; kept as the fallback if relay leaks into negative-main.
- **Branch-only conditional (ask for the switch, let SessionEnd commit):** 0/3 on haiku,
  record `scenarios/records/handoff-next-prompt.on-main.branch-only-probe-run4.json`
  (§3 "Branch-only probe").
- **A forceful conditional ("must", imperative, "before the session ends"):** reads as a
  command; negative-main exists to fail it (Q7). The revision adds specificity, not force.
- **A relay predicate with the recipe wording unchanged:** run3 scores it 0/3, and it would
  tune the judge to the run. (The first decide step rejected "change the predicate" on this
  basis; relay wording plus a pre-declared relay predicate is a different option, §3.)
- **Close or descope the on-main arms:** ships a user-facing line with no DEMONSTRATED
  record and no can-fail intrusiveness arm (ADR-0050).
- **Commit the brain deterministically at SessionEnd to a side ref on the default branch:**
  a new mechanism amending ADR-0033 §2 with unasked ref creation; parked behind #388's
  evidence.

## Decide-step record (§8)

| Q | Brain id | Settles |
|---|---|---|
| Q1 | `42cb42c2cbe1` | one reason, `no-autocommit` |
| Q2 | `1e112efbd5d4` | mirror SessionEnd via `brainCommitOutcome` |
| Q3 | `04c3364bafd4` (supersedes `c339801d4c1f`, which superseded `f6a86d9024bc`) | wording, three shapes; the conditional asks the agent to tell the user |
| Q4 | `0e9b2a0f0087` | drop the fast path; superset cadence |
| Q5 | `6cd65965e314` | one id-based count |
| Q6 | `f0b1cdb18f20` (supersedes `080afb7eecd7`) | RELAY predicate; main unmoved; branch/commit a diagnostic |
| Q7 | `d32746396be8` | treatment-, contrast-, negative-main |
| Q8 | `494738db29af` | accept on-purpose main; count in #388 |
| Q9 | `a3143d53a8b6` | SessionEnd committing after a branch passes |
| §3 revision | `43de884f80b5` (supersedes `98344d1a7d1b`) | revise §3 in this PR; one relay run; merge gate treatment-main (RELAY) and negative-main ≥ 2/3; pre-declared ADR-0081-shape fallback |
| process | `761bd6bb6ac5` | the round-3 ADR-0070 §4 escalation was a false positive (draft PR, no new head) |
