---
type: RFC
title: "RFC-045: Propose-only curation — a stable pin, confirmed handoff retirement, a backlog report (v3 R7)"
description: "v3 theme R7. A probe on 2026-10-21 found that handoffs never retire: 84 to 115 stale handoff facts are live beside the one pin (the range is the boundary between a shape rule and a tag rule), no handoff carries a supersession edge, and they hold 24 of the 90 top-5 slots in the R1 eval. It also found a latent pin defect: latestHandoff orders by `updated`, which every zone change bumps, so archiving, promoting or restoring an old handoff makes it the pin. 14 decisions and links can also take the pin; the one observed hijack was a fact, which 'pin only facts' would not have stopped, and the RFC states that gap. Semantic duplicates are rare: one true double write in 535 entries. This RFC proposes: pin the newest-CREATED handoff/next-tagged fact (amends ADR-0049 selection; the second, raw-line selector in stop-reminder.ts must change in the same build); a `retires` field limited to handoff facts, named by id, that the handoff skill proposes and the user confirms; a read-only backlog report; and semantic dedup deferred on a named trigger. It does not move R1's gate: archiving cannot change the stage-1 metric the gate measures."
status: "Proposed"
timestamp: 2026-10-21
---

# RFC-045: Propose-only curation — a stable pin, confirmed handoff retirement, a backlog report

- **Status:** **Proposed.** Operator questions Q1–Q6 below.
- **Date:** 2026-10-21
- **Deciders:** operator + Claude
- **Theme:** v3 PRD §6 **R7**. Taken ahead of finishing R1 by operator ruling (brain
  `9746fb8556ef`, 2026-10-21, added by this PR), which re-ratified Ruling 4's order **on the
  premise that R7 unblocks R1**. This RFC's probe refutes that premise for R1's gate (see
  "What this does not do for R1"), so Q6 puts the order back to the operator.
- **Relates:**
  - [ADR-0004](../adr/ADR-0004-decision-is-adr-grade.md): decisions are superseded; fluid
    types are edited, not superseded.
  - [ADR-0021](../adr/ADR-0021-auto-distill-and-curator.md): the curator, its delta-only
    operations and the never-rewrite Brake.
  - [ADR-0033](../adr/ADR-0033-session-end-continuity.md): the SessionEnd fallback handoff.
  - [ADR-0041](../adr/ADR-0041-entries-jsonl-merge-union.md): `entries.jsonl` merge=union.
    Materialize then keeps each id's newest-`updated` record (`src/storage.ts:147`).
  - [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md): the pinned handoff, whose
    selection Part A amends.
  - [RFC-043](RFC-043-stop-nudge-observer.md) (Proposed): the stale-handoff nudge. Its
    Part 0 rule 1 would make `latestHandoff` B3's only selector. Until it is built,
    `stop-reminder.ts` has a second one, which Part A must change too. Its Part A amends the
    pin's *render*, as Part B here does.
  - [ADR-0080](../adr/ADR-0080-query-time-injection.md) and
    [ADR-0081](../adr/ADR-0081-r1-step1-lands-below-bar.md): R1. The 0.6 bar is ADR-0080 §2's
    step-1 bar, which ADR-0081 turned into the named gate on step 2.
  - [RFC-003](RFC-003-embedding-accuracy-mode.md): embeddings, still gated.
- **Evidence:**
  - [`docs/v3/research/probes/curation-2026-10-21/`](../v3/research/probes/curation-2026-10-21/),
    run on the pinned R1 snapshot (`9095dc4`) and on `main` at `c224878`, calling the real
    engine (`latestHandoff`, `InMemoryIndex`, `read.query`, `curator.archive`) on a temp
    copy of each brain;
  - brain `583374f75808` (the observed pin hijack, by fact `a91f82e76700`) and PR #358
    (repaired by hand);
  - the adversarial review of this PR (round 1), whose measurements are now in the probe.

## Context

The PRD states R7's problem as 106 `handoff`-tagged entries of which one is ever pinned,
duplicate detection that is exact-match only, and an `isInjectable` that cannot see an entry
went obsolete. It asks for propose-only curation of semantic duplicates, staleness and
handoff lifecycle. The probe measured each one. On `main`, with the figure for the pinned
snapshot in brackets:

1. **Handoffs never retire.** 130 [123] injectable entries carry `handoff` or `next`.
   - Besides the pin, **84 [77]** are facts that open as a handoff (`HANDOFF`, `SESSION
     HANDOFF`, `RESUME`). That is a lower bound: handoffs also open "SESSION CLOSE …" or
     "CLOSED OUT …".
   - **115 [108]** are handoff/next-tagged facts of any shape. That is an upper bound: it
     includes queued items such as `fba5f66fd3df`, which is a labelled right answer in the
     R1 eval.
   - **No handoff carries a supersession edge.** At least 40 [34] entries name a
     predecessor in their text ("supersedes <id>", ignoring case; 37 [31] of them carry the
     handoff/next tag). This is a lower bound: prose also says "supersedes handoff <id>". All 4 entries with `refs.supersedes` are decisions, because
     `supersede()` refuses facts (ADR-0004). The handoff skill only tells its author to
     "note" a stale predecessor. Each new handoff adds one more live entry and retires none.
2. **Stale handoffs crowd retrieval.** They hold **24 [20]** of the 90 top-5 slots across
   the 18 R1 eval prompts. In one day the live brain's stage-1 recall@5 fell from 0.565 to
   0.517. Of the 5 slots won by entries written after the snapshot, 4 went to handoffs. One
   of those (`c6a53a88a8b0`) names two predecessors, and both are still live.
3. **The pin is unstable, in two ways.**
   - **Ordering.** `latestHandoff` orders by `updated`, and every zone change bumps
     `updated` (`updateEntry`, engine.ts:155). The probe archived the oldest handoff
     fact (`1488c66658c4`, created 2026-06-30) and then restored it, and **it became the
     pin** on both brains. So archiving, promoting or restoring any old handoff hijacks the pin. Across
     clones, merge=union plus newest-`updated`-wins makes that worse: any later edit to an old
     handoff in another clone moves the pin.
   - **Eligibility.** Any injectable entry tagged `handoff` or `next` can be pinned. 14
     decisions and links carry the tag topically. The **one hijack observed live**
     (2026-10-19, brain `583374f75808`) was a **fact**, `a91f82e76700`, a measurement
     *about* the nudge, tagged `handoff`.
4. **Semantic duplicates are rare.** Word-set Jaccard ≥ 0.5 finds 14 pairs.
   - 11 are an RFC link plus the link to the ADR that accepted it: related, not duplicates.
   - That leaves 3 candidates:
     - one true double write (`753e0647990c` ~ `dcfbe6a08613`, 0.98, written the same day);
     - one correction pair, which is deliberately two entries;
     - one pair of successive handoffs, which is part (1)'s problem.
   - So there is **one true duplicate**.
5. **Staleness is mostly the handoff backlog.**
   - 92 of 125 injectable status-tagged entries are more than 30 days old.
   - 29 of 38 proposed decisions are more than 30 days old.
   - 66 of the 70 incoming entries are more than 30 days old and were never promoted.
   - **No entry in the log has ever used `valid_until`**, so `isInjectable`'s expiry check
     has never fired.

So the measured problem is **lifecycle**, not similarity. The retirement operation exists:
`curate archive` is a zone delta that never touches text. What is missing is a moment at which
it gets used, and a pin that stays put when it is.

### What this does not do for R1

R1's gate, `STEP2_GATE_MET` (ADR-0081), measures stage 1, `InMemoryIndex.searchScored`. That
stage ranks **every materialized entry, archived ones included**. The injectable filter runs
afterwards, in `read.query`. **So archiving cannot move the gate's metric at all.**

Two counterfactuals drop entries from the stage-1 ranking without re-scoring:

| Entries dropped (snapshot) | Recall@5 | vs 0.6 |
|---|---|---|
| Shape boundary (77) | 0.5926 | below |
| Upper boundary (108) | 0.6037 | above |

These are counterfactuals of a metric archiving cannot change. Choosing the boundary that
crosses 0.6 would be tuning against the 18 prompts, which ADR-0081 forbids, so neither number
is evidence for flipping the gate.

The path that archiving *does* change is the filtered one (`read.query`, which `kb_search`
serves and which step 2 would inject from). It was measured by actually archiving in a temp
copy:

| Brain | Before | After archiving (either boundary) |
|---|---|---|
| Snapshot | 0.4167 | 0.4556 |
| Main | 0.4056 | 0.4556 |

That path is **lower** than stage 1. Part of the reason is that two labelled-relevant ids
(`e9c19cc5819e`, `4bbe73188958`, in 4 prompts' labels) were superseded after labelling, so
the filtered path can never return them. Q5 asks what, if anything, to do about the gate.

## Proposal

### Part A — A stable pin (amends ADR-0049's selection)

- **A1. Order by `created`, not `updated`.** `latestHandoff` picks the injectable eligible
  entry with the newest `created`, ties broken by append position as today. A zone change,
  a promotion, a restore or a cross-clone edit then cannot move the pin. This is a
  correctness fix, independent of Q1.
- **A2. Facts only** (operator ruling at the round-2 escalation, brain `96b226ab8f0a`;
  Q1 records it). The pin is the newest-created injectable **fact** tagged `handoff` or
  `next`. It is a per-entry rule, and no writer changes. The 14 decisions and links that
  carry the tag topically can no longer be pinned.
  - **The gap, stated.** A topical *fact* tagged `handoff` can still win. That is what
    happened in the one observed hijack (`a91f82e76700`). Part C's report lists every
    handoff/next-tagged fact other than the pin, flagging those not shaped as handoffs, so
    such a fact is visible to the operator. It is not prevented.
  - **Rejected in review: a writer-set `pin` marker with a brain-wide fallback.**
    - It froze the pin once any marked fact existed. Most handoffs are written by the
      nudge-directed `kb_add` path (`src/stop-reminder.ts:80` and `:102`) and by hand, not by
      the skill, and older plugins never set the marker.
    - The `pin` tag is also already used topically (`583374f75808`).
- **Two selectors today, one after.** `latestHandoff` is meant to be the only place a pin is
  chosen. But `stop-reminder.ts:232` (`newestHandoffTimestamp`) is a second selector. It
  scans raw lines and copies the `updated`-then-`created` order, so changing only
  `latestHandoff` would split the rendered pin from B3's anchor.
  - **So Part A changes both in the same build.** `newestHandoffTimestamp` gets the same
    rule (facts only, newest `created`). B3's staleness input becomes the pin's `created`,
    not its `updated`, because a zone edit to the pin does not change what it says.
  - RFC-043 Part 0 rule 1, when built, then removes the second selector altogether. Its
    accepting ADR should take `created` as its input `u`.
  - A unit test asserts that the rendered pin and B3's anchor agree on brains with zone
    edits, topical tags and decisions.
  - On today's brain, 0 of 116 live handoff facts have `updated` ≠ `created`, so Part A
    moves no current pin.
- **Proof form:** structural, so deterministic unit tests, each observed red against today's
  selector:
  - a zone edit, promote or restore of an old handoff does not move the pin;
  - a newer decision or link tagged `handoff` never pins;
  - `latestHandoff` and `newestHandoffTimestamp` select the same entry.

### Part B — Retiring a predecessor: proposed by the skill, confirmed by the user

- **The engine side.** `kb_add` and `vfkb add` gain an optional **`retires: [ids]`**.
  - **Scope:** each id must be a live **fact tagged `handoff` or `next`**. Otherwise (a
    missing id, any other type, an archived entry) the engine refuses the whole write and
    appends nothing.
  - **Effect:** in the same locked write, the named facts are archived (the existing `curate
    archive` delta), and the new entry records `refs.retires`.
  - **What it is not:** a general archive-on-write capability. It is limited to the
    lifecycle this RFC is about.
- **Ids only, named explicitly.** There is no "retire the current pin" shorthand. A literal
  `pin` resolved inside the lock would archive a *concurrent* session's fresh handoff that
  the author never saw. With explicit ids, a handoff written by another session meanwhile
  stays live, and Part C lists it.
- **The pin shows its id.** Today the resume render shows the pinned handoff without its id,
  except when truncated (`kb_get <id>`, engine.ts:578). Part B adds the id to the `## Last
  handoff` line. That is a render change to ADR-0049, made alongside RFC-043 Part A's render
  annotation.
- **The skill proposes, the user confirms** (Q2 recommendation). `/vfkb:handoff` step 5 names
  the current pin's id and its first line, asks whether the new handoff retires it, and
  passes `retires` only on a yes.
  - This stays inside the PRD's "propose-only": the agent proposes and a human decides.
  - Retiring by default unless the user objects (Q2 b) is cheaper, but it is act-by-default
    curation decided by an LLM. That departs from the PRD's wording and needs an explicit
    ruling.
  - **Confirmation is an explicit user reply in the same skill run.** The skill asks, and
    passes `retires` only after a user turn that answers yes. vfkb does not detect headless
    runs, since nothing observed identifies one. A run where no user answers never reaches
    the yes, so it retires nothing.
  - It is a plugin change, so it ships with a plugin release whose notes state "delivery is
    unproven" (ADR-0051).
- **No pin, nothing proposed.** On an empty brain, or one whose pin is not a handoff fact,
  the skill proposes nothing.
- **Reversible, with a named hazard.** An archived handoff keeps its text, so ADR-0021's
  never-rewrite Brake holds. It stays listable with `vfkb search --zone archive --stale`. Part
  B adds `curate restore <id>`, a zone delta back to `established`. Under A1 it cannot move
  the pin.
  - **Cross-clone hazard (named, not fixed):** under merge=union plus newest-`updated`-wins,
    a later edit to the same entry in another clone silently un-archives it.
  - Handoff facts are rarely edited after they are written, and Part C relists any that come
    back.
- **The cost applies to every retirement option (B, C and Q2's d):** an archived handoff
  leaves injection even if it still carries unique knowledge. Confirmation (Q2 a) and the
  report's review (Part C) are where a human catches that. A read-time rule (Q2 d) catches it
  nowhere.
- **Not in scope:** the SessionEnd fallback retires nothing. It writes only when the session
  left no handoff, and it has no author to confirm.

### Part C — `curate handoffs` and `curate stale`: a report, never an action

Two read-only CLI subcommands (an MCP surface is Q4):

- **`curate handoffs`** lists every injectable handoff/next-tagged fact other than the pin
  (selected by `latestHandoff`), oldest first. Each row shows its age, its first line, and
  whether it is handoff-shaped. It also lists the topical decisions and links that Part A
  stops pinning.
  - **It uses the tag-and-type boundary, not a shape rule, and decides nothing.** The probe
    shows why. The shape rule misses real handoffs ("SESSION CLOSE …"). The tag rule includes
    `fba5f66fd3df`, a queued item that is a labelled right answer. Only a reader can tell.
  - **Its output** is a list of `curate archive <id>` lines for the operator to edit and run.
- **`curate stale`** lists:
  - proposed decisions and unpromoted incoming entries older than N days (default 30);
  - non-handoff status-tagged facts older than N days.

  It is a reading aid, the PRD's "staleness candidates". It proposes no action of its own.

Neither command writes. A unit test runs both against a brain and asserts `entries.jsonl` is
byte-identical afterwards.

### Part D — Semantic dedup: deferred on a named trigger

The probe found one true duplicate in 535 entries, and it was found by reading. Building
near-duplicate detection now would be a speculative build (the roadmap's evidence gate).

- **Trigger:** either of these, recorded:
  - a case where a duplicate pair misled an agent, or crowded a pinned or injected result;
  - a double write the operator found by hand that `curate dups` missed.
- **Until then:** `findLexicalDuplicates` stays exact-match, and the RFC-003 embedding gate
  is unchanged.
- **Decision models** stay optional (Ruling 5) and are used by no part here.

### Out of scope, recorded as follow-ons

- **Reviewer and headless sessions displacing the operator's pin** (an RFC-043 follow-on,
  handed to R7 by the RFC-043 session). That session reports that 5 B3 fires in reviewer
  sessions produced 5 handoff writes. This RFC has not re-measured that.
  - Part A does not cover it, because those writes are facts.
  - Nothing observed in the Stop payload identifies a headless session, so this needs a
    probe first.
- **`valid_until`** is never used. Expiring status facts by default would be a writer change
  with its own trade-offs. It waits for evidence that Parts B and C leave a residue.

## Definition of Done (ADR-0029/0050/0051)

- **Parts A and C are structural,** so their proofs are unit tests, each observed red under a
  mutation. Part C's no-write test is the deterministic backstop for "propose-only".
- **Part B's engine side** gets two unit tests:
  - the scope refusal (a gotcha, a decision or an archived id each refuses the whole write);
  - the race: a concurrent handoff not named in `retires` stays live, and the pin is the
    newest-created of the two.
- **Part B's skill side** is agent-facing, so it ships behind an agent-driven L4,
  `scenarios/handoff-retires.mjs`. A sandboxed agent runs `/vfkb:handoff`, through the
  vendored plugin, on a brain whose pin is a sentinel handoff among older live handoffs. The
  scenario supplies the user's answer as a **second scripted turn** (a resumed session), after
  the skill has asked. It is never pre-loaded into the first prompt, so an agent that retires
  without asking fails.
  - **Positive arm.** The user's second turn confirms. Afterwards the new handoff is the pin, the sentinel
    is archived with its text byte-identical, and the older handoffs are untouched.
  - **Negative arm.** The user's second turn says the current handoff is still live.
    Nothing is archived.
  - **No-answer arm.** There is no second turn. Nothing is archived.
  - **Contrast arm.** Today's skill. The sentinel stays live.
  - **Scoring.** All three are content assertions over the brain, never exit codes (ADR-0051
    §3). DEMONSTRATED needs ≥ 2/3 on each of the positive, negative and no-answer arms,
    against a contrast of 0/3.
  - **Until then** its status is "built, NOT yet verified", and delivery through the
    marketplace stays unproven.
- **The backlog** (84–115 entries here) is cleared only after the build. The operator edits
  `curate handoffs`' list and the result lands as one brain PR (Q3). It is a brain-data
  change, not code.

## Questions for the operator

- **Q1. Pin eligibility. Ruled at the round-2 escalation (brain `96b226ab8f0a`): facts only,
  with the gap stated** (A2). A1's `created` ordering is a fix either way. Recorded for
  acceptance:
  - (a) **Facts only** (ruled): a per-entry rule with no writer changes. A topical fact can
    still win, and Part C surfaces it.
  - (b) An engine-enforced marker set by every writer (the skill, the SessionEnd fallback,
    both nudge texts, CLAUDE.md). It stops the observed hijack class, but it touches many
    surfaces, and mixed plugin versions or hand-writes still risk freezing the pin.
  - (c) Leave eligibility as it is.
- **Q2. Retirement.**
  - (a) **The skill proposes the predecessor by id, and retires it only on the user's
    explicit yes** (recommended: inside the PRD's "propose-only").
  - (b) The skill retires the predecessor by default unless the user objects. This departs
    from the PRD's wording.
  - (c) The Part C report only, with every retirement done by hand.
  - (d) A read-time rule that hides non-pinned handoffs from injection, with no write and no
    human check.
  - Every option except (c) removes old handoffs from injection, including any that still
    carry unique knowledge.
- **Q3. The backlog.**
  - (a) **After the build, the operator edits the `curate handoffs` list, and the archive
    lands as one brain PR** (recommended).
  - (b) Leave the backlog; only new handoffs retire a predecessor.
- **Q4. Surface.**
  - (a) **Part C on the CLI only; `retires` on both the CLI and `kb_add`** (recommended: the
    report is for the operator, `retires` is for the agent).
  - (b) Also expose Part C as an MCP tool.
- **Q5. R1's gate.** It measures stage 1, which archiving cannot change. Step 2 would inject
  from the filtered path, which scores **0.41–0.46**. Stage 1 today scores 0.52 (main) and
  0.56 (the snapshot). Two of the labelled
  ids have since been superseded, so the filtered path can never return them.
  - (a) **Leave the gate as it is, and raise the question again when step 2 is next
    considered** (recommended). Measuring the filtered path would make the gate harder to
    meet, and it would first need the superseded labels resolved to their successors.
  - (b) Re-open it now, as its own amendment to ADR-0081.
- **Q6. Order.** The ruling that put R7 ahead of R1 rested on R7 unblocking R1. The probe
  shows it does not move R1's gate.
  - (a) **Keep R7 next** (recommended). On its own merits it fixes a latent pin defect (A1)
    and the 14 decision/link hijackers (A2), and it stops the filtered path's decay.
  - (b) Return to Ruling 4's order: R3 next, R7 after it.

## Consequences

- The pin stays put under curation, promotion and cross-clone edits, and topically tagged
  decisions and links cannot take it. A topically tagged fact still can (the stated gap).
  B3's anchor moves with the pin, because both selectors change in the same build.
- A confirmed handoff retires its predecessor, so the live handoff count stops growing by one
  per session.
- Archiving the backlog raises the filtered path's recall@5 (measured: 0.41 → 0.46 on main).
  Stage-1 recall and R1's gate do not change.
- Duplicate detection does not change. This RFC records that semantic dedup is the smaller
  problem on the evidence, and it names the trigger for revisiting it.
