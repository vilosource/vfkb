---
type: RFC
title: "RFC-045: Propose-only curation — retire handoffs, guard the pin, report staleness (v3 R7)"
description: "v3 theme R7. A probe on 2026-10-21 found that handoffs never retire: 84 stale handoff facts are live beside the one pinned, no handoff carries a supersession edge (supersede() refuses facts, so 'supersedes X' lives only in prose), and they hold 24 of the 90 top-5 slots in the R1 eval. 14 non-fact entries carry the handoff tag and can hijack the pin. Semantic duplicates, the other half of the PRD's R7, are rare: 3 candidate pairs in 535 entries, most Jaccard 'duplicates' being an RFC link plus its accepting ADR link. This RFC proposes four parts: pin only facts (amends ADR-0049 selection, keeping one selector for RFC-043); a write-time `retires` field so a new handoff archives the predecessor its author names; a propose-only `curate handoffs` / `curate stale` report for the backlog; and deferring semantic dedup on a named trigger. It does not claim to unblock R1: on the counterfactual, recall@5 rises to 0.593, still below the 0.6 bar."
status: "Proposed"
timestamp: 2026-10-21
---

# RFC-045: Propose-only curation — retire handoffs, guard the pin, report staleness

- **Status:** **Proposed.** Operator questions Q1–Q5 below.
- **Date:** 2026-10-21
- **Deciders:** operator + Claude
- **Theme:** v3 PRD §6 **R7**. Taken ahead of finishing R1 by operator ruling (brain
  `9746fb8556ef`, 2026-10-21), which re-ratifies Ruling 4's order.
- **Relates:**
  - [ADR-0004](../adr/ADR-0004-decision-lifecycle.md): decisions are superseded; fluid types
    are edited, not superseded.
  - [ADR-0021](../adr/ADR-0021-auto-distill-and-curator.md): the curator, its delta-only
    operations and the never-rewrite Brake.
  - [ADR-0033](../adr/ADR-0033-session-end-auto-commit.md): the SessionEnd fallback handoff.
  - [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md): the pinned handoff, whose
    selection Part A amends.
  - [RFC-043](RFC-043-stop-nudge-observer.md) (Proposed): the stale-handoff nudge, which
    depends on Part A's single selector.
  - [ADR-0080](../adr/ADR-0080-query-time-injection.md) and
    [ADR-0081](../adr/ADR-0081-r1-step1-lands-below-bar.md): R1, whose step 2 is gated.
  - [RFC-003](RFC-003-embedding-accuracy-mode.md): embeddings, still gated.
- **Evidence:**
  - [`docs/v3/research/probes/curation-2026-10-21/`](../v3/research/probes/curation-2026-10-21/),
    run on the pinned R1 snapshot (`9095dc4`) and on `main` at `c224878`;
  - brain `583374f75808` (a topical tag moved the pin) and PR #358 (repaired by hand).

## Context

The PRD states R7's problem as 106 `handoff`-tagged entries of which one is ever pinned,
duplicate detection that is exact-match only, and an `isInjectable` that cannot see an
entry went obsolete. It asks for propose-only curation of semantic duplicates, staleness
and handoff lifecycle. The probe measured each one on the real engine. On `main`, with
the figure for the pinned snapshot in brackets:

1. **Handoffs never retire.** 130 [123] injectable entries carry `handoff` or `next`. 85
   [78] are handoff-shaped facts, and one is pinned, so **84 [77] stale handoffs are
   live**. **No handoff carries a supersession edge.** 24 entries write "supersedes X" in
   their text. `supersede()` refuses facts (ADR-0004), and the handoff skill tells its author
   only to "note" a stale predecessor, so the note stays prose. Each new handoff adds one more
   live entry and retires nothing.
2. **Stale handoffs crowd retrieval.** They hold **24 [20]** of the 90 top-5 slots across
   the 18 R1 eval prompts. In one day the live brain's stage-1 recall@5 fell from 0.565 to
   0.517. Of the 5 slots won by entries written after the snapshot, 4 went to handoffs. One of
   those (`c6a53a88a8b0`) says it supersedes two earlier handoffs, and both of them are still
   live.
3. **The pin can be hijacked.** `latestHandoff` pins the newest injectable entry tagged
   `handoff` or `next`, of any type. 14 injectable decisions and links carry the tag
   topically, and 45 tagged entries are not handoffs at all. One hijack happened live on
   2026-10-19 (brain `583374f75808`) and was repaired by hand (PR #358).
4. **Semantic duplicates are rare.** Word-set Jaccard ≥ 0.5 finds 14 pairs. 11 of them are an
   RFC link plus the link to the ADR that accepted it, which are related, not duplicates. That
   leaves 3 candidates: one double write (0.98, same day), one correction pair, and one pair
   of successive handoffs. The handoff pair is part (1)'s problem, not a dedup problem.
5. **Staleness is mostly the handoff backlog.** 92 of 125 injectable status-tagged entries
   are more than 30 days old. 29 of 38 proposed decisions are more than 30 days old. 66 of
   the 70 incoming entries are more than 30 days old and were never promoted. **No entry has
   ever used `valid_until`**, so `isInjectable`'s expiry check has never fired.

So the measured problem is a **lifecycle** problem, not a similarity problem. The brain
already has the right retirement operation, `curate archive`: a zone delta that never touches
text and keeps the entry recoverable. What is missing is any moment at which it gets used.

### What this does not do for R1

On a counterfactual, dropping the 77 stale handoffs from the snapshot's ranking without
re-scoring takes recall@5 from 0.5648 to **0.5926, still below ADR-0080's 0.6 bar**. Also,
`InMemoryIndex.searchScored` ranks every materialized entry, archived ones included, and the
injectable filter runs after stage 1 in `query()`. So archiving cannot move the stage-1
metric that ADR-0081's `STEP2_GATE_MET` measures. It moves only the filtered path that
`kb_search` serves and that step 2 would inject from. This RFC does **not** claim to unblock
R1, and it proposes no change to the R1 eval or its gate (ADR-0081: no tuning against the
18). Whether the gate should measure the filtered path is Q5, and it is the operator's call.

## Proposal

### Part A — Pin only facts (amends ADR-0049's selection)

`latestHandoff` selects the newest injectable **`type: fact`** entry tagged `handoff` or
`next`. Decisions and links with those tags stay searchable but can never become the pin.

- **One selector.** `latestHandoff` stays the only place a pin is chosen. RFC-043 Part 0
  rule 1 already depends on that: B3's staleness check selects its anchor with
  `latestHandoff` over the materialized set. Part A therefore changes B3's anchor and Part
  A's render annotation automatically, and **must not** add a second selector. The
  accepting ADR names this invariant, and a unit test asserts that every pin surface (the
  resume digest, the context block, the curation report of Part C) goes through the
  function.
- **Why facts, not a new `pin` tag.** The handoff skill and the SessionEnd fallback
  (ADR-0033) already write `type: fact`, so "fact only" needs no change at any writer. A new
  explicit tag would need every writer changed and would leave the existing 85 handoffs
  unpinnable until retagged. The cost is that a topical *fact* tagged `handoff` can still
  win. Part B's retirement and Part C's report make that case visible, and the 45 non-handoff
  tagged entries are listed for the operator.
- **Proof form:** structural, so deterministic unit tests: a newer decision and link tagged
  `handoff` do not displace an older handoff fact, each observed red against today's
  selector.

### Part B — A new handoff retires the predecessor its author names

`kb_add` and `vfkb add` gain an optional **`retires: [ids]`** on fluid entries. In the same
locked write that appends the new entry, each named id that is a live **fluid** entry is
archived (`zone: archive`, the existing `curate archive` delta), and the new entry records
`refs.retires`. The engine refuses the whole write, appending nothing, if any named id is
missing, is a decision-family entry (those are superseded under ADR-0004, never archived
here), or is already archived.

- **It acts only on what the author names.** Nothing is inferred and no similarity is
  computed. It turns the prose "supersedes X", which authors already write, into the
  operation they meant. That keeps it inside "propose-only": the engine proposes nothing on
  its own, and the only actor is the author, explicitly.
- **`retires` also accepts the literal `pin`**, which the engine resolves with
  `latestHandoff` inside the same locked write. This is needed because the resume render the
  skill reads (its step 2) shows the pinned handoff **without its id**. It also keeps Part
  A's single selector, and it closes the race in which another session's handoff lands
  between the skill reading the pin and writing its own.
- **The handoff skill passes it.** `/vfkb:handoff` step 5 passes `retires: ["pin"]` unless
  the user says the current pin is still live. That replaces "note that explicitly" in
  prose. This is a plugin change, so it ships with
  the next plugin release, and that release note states "delivery is unproven" (ADR-0051).
- **Reversible.** The text of an archived handoff is untouched, so ADR-0021's never-rewrite
  Brake holds. Today nothing un-archives, and `vfkb list` has no `--zone` flag. Part B
  therefore adds `curate restore <id>` (a zone delta back to `established`), so a wrong
  retirement can be undone without hand-editing the brain.
- **Not in scope:** the SessionEnd fallback (ADR-0033) does not retire anything. It writes
  only when the session left no handoff, and it has no author to name a predecessor.

### Part C — `curate handoffs` and `curate stale`: a report, never an action

Two read-only CLI subcommands (an MCP surface is Q4):

- **`curate handoffs`** lists every injectable handoff-shaped fact other than the pin (from
  `latestHandoff`), oldest first, with its age and its first line, plus the topically tagged
  entries that Part A stops pinning. Its output is a list of `curate archive <id>` lines for
  the operator to review and run. On this repo today, that is the 84-entry backlog.
- **`curate stale`** lists proposed decisions and unpromoted incoming entries older than N
  days (default 30), and status-tagged facts other than handoffs older than N days. It
  proposes nothing automatically. It is a reading aid for the operator, the PRD's
  "staleness candidates".

Neither command writes. That is enforced by a unit test that runs both against a brain and
asserts `entries.jsonl` is byte-identical afterwards.

### Part D — Semantic dedup: deferred on a named trigger

The probe found 2 true duplicate pairs in 535 entries, and both are already visible to a
reader. Building near-duplicate detection now would be a speculative build (the roadmap's
evidence gate). **Trigger:** a recorded case where a duplicate pair misled an agent or
crowded a pinned or injected result, *or* `curate dups` failing to catch a double write the
operator then found by hand. Until then, `findLexicalDuplicates` stays exact-match, and the
RFC-003 embedding gate is unchanged. Decision models stay optional (Ruling 5) and are not
used by any part here.

### Out of scope, recorded as follow-ons

- **Reviewer and headless sessions displacing the operator's pin** (an RFC-043 follow-on,
  handed to R7 by the RFC-043 session): it reports that 5 B3 fires in reviewer sessions
  produced 5 handoff writes. This RFC has not re-measured that. Part A does not fix this,
  because those writes are facts. The open question is unchanged: nothing observed in the
  Stop payload identifies a headless session. It needs a probe first (R3/R4-style), so it
  stays a follow-on here.
- **`valid_until`** is never used. Making status facts expire by default would be a writer
  change with its own trade-offs, and it waits for evidence that Part B and C leave a
  residue.

## Definition of Done (ADR-0029/0050/0051)

- **Parts A and C** are structural, so their proofs are unit tests, each observed red under a
  mutation. Part C's no-write test is the deterministic backstop for "propose-only".
- **Part B** is agent-facing, so it ships behind an agent-driven L4,
  `scenarios/handoff-retires.mjs`. A sandboxed agent runs `/vfkb:handoff` on a brain whose
  pin is a sentinel handoff, with `retires: ["pin"]` reaching the engine through the
  vendored plugin. Pass means: afterwards exactly one handoff-shaped fact is live,
  it is the new one, it is the pin, and the sentinel predecessor is archived with its text
  byte-identical. These are content assertions over the brain, not exit codes (ADR-0051
  §3). **The can-fail arm** is the same run with today's skill, where the predecessor must
  stay live. DEMONSTRATED at ≥ 2/3 against a contrast of 0/3. Until then its status is
  "built, NOT yet verified", and delivery through the marketplace stays unproven.
- **The backlog** (84 entries here) is applied only after the build, from `curate handoffs`'
  list, with the operator reviewing that list (Q3). It is a brain-data change, not code.

## Questions for the operator

- **Q1. Pin selection.** (a) **Pin only facts** (recommended: no writer changes). (b) Pin
  only entries carrying a new explicit `pin` tag. (c) Leave selection as it is.
- **Q2. Retirement mechanism.** (a) **Write-time `retires`, passed by the handoff skill,
  plus the Part C report for the backlog** (recommended). (b) The Part C report only, with
  every retirement run by hand. (c) A read-time rule that hides non-pinned handoffs from
  search and injection, with no write. This acts with no author naming anything, and it
  would hide old handoffs that still carry unique knowledge.
- **Q3. The backlog.** (a) **After the build, generate `curate handoffs` and archive the
  list in one brain PR the operator reviews** (recommended). (b) Leave the backlog. Only new
  handoffs retire their predecessor.
- **Q4. Surface.** (a) **CLI only for Part C**, and `retires` on both CLI and `kb_add`
  (recommended: the report is for the operator, `retires` is for the agent). (b) Also expose
  Part C as an MCP tool.
- **Q5. R1's gate.** ADR-0081's gate measures stage 1, which sees archived entries. Step 2
  would inject from the filtered path. (a) **Leave the gate as it is**, and raise the question
  again when step 2 is next considered (recommended: no change to an eval ruled to stay
  untuned). (b) Re-open it now, as its own amendment.

## Consequences

- Each handoff written with the skill retires its predecessor, so the live handoff count
  stops growing by one per session.
- The pin can no longer be taken by a decision or a link. RFC-043's anchor follows, because
  it uses the same selector.
- Stale handoffs leave the filtered search path, which raises `kb_search` recall. Stage-1
  recall and R1's gate do not change.
- Duplicate detection does not change. This RFC records that semantic dedup is the smaller
  problem on the evidence, and it names the trigger for revisiting it.
