---
type: Decision
title: "ADR-0082: Propose-only curation — a stable pin, confirmed handoff retirement, a backlog report (accepts RFC-045, v3 R7; amends ADR-0049)"
description: "Accepts RFC-045 with the operator's rulings of 2026-10-21. The pin becomes the newest-CREATED injectable fact tagged handoff or next, and B3's raw-line selector is rewritten to the same materialized rule in the same build. A topical fact can still take the pin, and the report surfaces it. The handoff skill writes the new handoff first, then proposes the predecessor by id, and retires it only on the user's explicit yes, via `vfkb curate retire`. `retires` lands on vfkb add and kb_add, scoped to handoff facts. Read-only `curate handoffs` / `curate stale` reports are CLI-only. The backlog is archived from an operator-edited list in one brain PR. Semantic dedup is deferred on a named trigger. R1's gate is unchanged. R7 goes next on its own merits, since it does not unblock R1."
status: "Accepted"
timestamp: 2026-10-21
---

# ADR-0082: Propose-only curation — a stable pin, confirmed handoff retirement, a backlog report

- **Status:** Accepted (2026-10-21, operator rulings; brain decisions `96b226ab8f0a` (Q1),
  `680d9cf54e7c` (Q2–Q6) and `e141ecf7cc51` (write order)).
- **Date:** 2026-10-21
- **Accepts:** [RFC-045](../rfc/RFC-045-propose-only-curation.md) (v3 PRD §6 **R7**), with
  its two open items settled below.
- **Amends:** [ADR-0049](ADR-0049-session-start-handoff-pinning.md), Decision item 1 (Layer 0), both the
  pin's *selection* and its *render*. Per
  [ADR-0001](ADR-0001-record-decisions-as-adrs.md) a decided ADR is immutable, so the change
  is recorded here. The rest of ADR-0049 stands: the pin leads after the Constitution, it is
  never budget-dropped, and `/vfkb:brief` is unchanged.
- **Relates:**
  - [ADR-0004](ADR-0004-decision-is-adr-grade.md) (facts are not superseded);
  - [ADR-0021](ADR-0021-auto-distill-and-curator.md) (the curator's delta-only operations
    and the never-rewrite Brake);
  - [ADR-0033](ADR-0033-session-end-continuity.md) (the SessionEnd fallback);
  - [ADR-0041](ADR-0041-entries-jsonl-merge-union.md) (merge=union);
  - [RFC-043](../rfc/RFC-043-stop-nudge-observer.md) (Proposed; §2 absorbs its Part 0 rule 1);
  - [ADR-0081](ADR-0081-r1-step1-lands-below-bar.md) (R1's gate, unchanged).
- **Evidence:**
  - [`docs/v3/research/probes/curation-2026-10-21/`](../v3/research/probes/curation-2026-10-21/);
  - the three adversarial review rounds of [vfkb#366](https://github.com/vilosource/vfkb/pull/366),
    whose round 2 was escalated under ADR-0070 §4;
  - brain `853d9444599c` ([vfkb#367](https://github.com/vilosource/vfkb/pull/367)), the
    RFC-043 prototype re-run with `created` keys.

## Context

RFC-045's probe found the measured R7 problem is handoff **lifecycle**, not similarity.
- 84 to 115 stale handoff facts are live beside the one pin, and none has ever been retired.
  The range is the gap between a shape rule and a tag rule, and neither boundary is safe.
- `latestHandoff` orders by `updated`, which every zone change bumps. Archiving and then
  restoring an old handoff made it the pin on both brains measured.
- 14 decisions and links can take the pin. The one hijack observed live was a fact.
- Semantic duplicates are rare: one true double write in 535 entries.
- Retiring the backlog raises filtered recall@5 from 0.41 to 0.46. It cannot move R1's gate,
  which measures a stage that ranks archived entries too.

The operator answered RFC-045's questions on 2026-10-21. Every answer was the recommended
option:

| Question | Ruling |
|---|---|
| Q1 | Facts only, with the gap stated |
| Q2 | The skill proposes, the user confirms |
| Q3 | An operator-edited backlog list, archived in one brain PR |
| Q4 | `retires` on the CLI and MCP; the reports CLI-only |
| Q5 | Leave R1's gate; revisit at step 2 |
| Q6 | Keep R7 next |

For the RFC's first open item, the operator chose **write first, retire on yes**.

## Decision

### 1. Pin selection (amends ADR-0049 Decision item 1)

The pin is the injectable **`type: fact`** entry tagged `handoff` or `next` with the newest
**`created`**, ties broken by append position (the later write wins, as today).
- **Ordering by `created`** means a zone edit, a promotion, a restore or a cross-clone edit of
  an old handoff cannot move the pin.
- **Restricting to facts** means topically tagged decisions and links can never be pinned.
- **The gap, stated:** a topical *fact* tagged `handoff` can still win, as `a91f82e76700`
  did on 2026-10-19. It is surfaced by §6's report, not prevented.
- **Rejected:** a writer-set `pin` marker. Its brain-wide fallback froze the pin once any
  marked fact existed. Most handoffs come from the nudge-directed `kb_add` path and by hand,
  and the tag is already used topically (`583374f75808`).
- **No pin moves today.** None of the 116 live handoff facts on `main` at `c224878` has
  `updated` ≠ `created` (probe §1). The reviewer re-checked on later `main` (117, still 0,
  same pin under both rules).

### 2. One selector, built in the same change

`latestHandoff` (`src/engine.ts`) is the only pin selector after this build.
- **The second selector is rewritten.** `newestHandoffTimestamp` (`src/stop-reminder.ts`) is
  a second selector today. It scans raw lines, so an archived entry's pre-archive line still
  passes `isInjectable`. This build rewrites it to **materialize and apply §1's rule**, which
  is RFC-043 Part 0 rule 1, absorbed here.
- **B3's staleness input** becomes the pin's **`created`**, because a zone edit to the pin
  does not change what it says.
- **Conditions on RFC-043's accepting ADR** (brain `853d9444599c`):
  - Its input `u` and its carrier lookup both key on `created`.
  - It must re-run `anchor-proto.sh` with `created` keys, switching **both** the
    `pin_in_head` match (line 18) and the carrier `-G` pattern (line 20). It must also
    change `lib.sh`'s `entry()` so that `created` defaults to `updated`.
  - It must state the result. The committed re-run
    ([`rerun-created-keys.sh`](../v3/research/probes/curation-2026-10-21/rerun-created-keys.sh),
    output [`rerun-created-keys.txt`](../v3/research/probes/curation-2026-10-21/rerun-created-keys.txt))
    shows only two cases change. Case 3 ("retagged old entry") flips from quiet to `STALE
    {code2|code1}`, and case 3b widens from `{code3}` to `{code3|code2|code1}`. The other 16
    of 18 cases are unchanged.
  - Rule 5 still compares as instants, but its cut-off moves with `u`.
- **This build owns that flip, not only RFC-043.** Case 3 also flips under today's tree-diff
  rule (`today: quiet → STALE (tree diff)` in the re-run), and that is the B3 rule this
  build ships. So after this build, an old handoff fact retagged into the pin reads as stale
  if code landed after it was first written. Under §1 such an entry wins the pin only when it
  is the newest-created handoff fact, which is rare. The trade is accepted.
- **A unit test** asserts that the rendered pin and B3's anchor select the same entry on
  brains with zone edits, topical tags, decisions and archived lines.

### 3. The pin shows its id (amends ADR-0049 Decision item 1, the render)

The `## Last handoff` line carries the pinned entry's id, so the skill can name it. It sits
alongside RFC-043 Part A's render annotation, if and when that is accepted.

### 4. `retires` and `curate retire`

- **Scope, for every retirement path.** `<old>` must be a **live** (`isInjectable`) fact
  tagged `handoff` or `next`. `<new>` must be a live handoff/next-tagged fact other than
  `<old>`, with `created` no earlier than `<old>`'s. That last check refuses `curate retire
  <pin> --by <older>`, which would move the pin back. Any failure refuses the whole operation
  and appends nothing.
- **The edge is a tag** (this ADR's choice, mirroring curator `mergeDuplicate`'s
  `merged-into:`). `<old>` is archived (zone `archive`, the existing curator delta) and tagged
  `retired-by:<new id>`. No `Refs` field is added, because `curate retire` works through
  `updateEntry`, which patches only `text`, `tags` and `zone`, so both paths record the edge
  the same way.
- **`retires: [ids]` on `vfkb add` and `kb_add`** (Q4) applies that to each id in the same
  locked write as the new entry, for atomic, scripted use.
- **`vfkb curate retire <old> --by <new>`** applies it after the fact. This is what the skill
  uses.
- **`vfkb curate restore <id>`** moves an archived entry back to `established` and removes
  its `retired-by:` tag. Under §1 it cannot move the pin.
- **Text is never touched**, so ADR-0021's never-rewrite Brake holds.
- **Named hazard, not fixed:** under merge=union plus newest-`updated`-wins, a later edit to
  the same entry in another clone silently un-archives it. Handoff facts are rarely edited
  after writing, and §6 relists any that come back.
- The MCP surface stays at 9 tools.

### 5. The handoff skill: write first, propose, retire only on yes (Q2 and the write order)

`/vfkb:handoff` (vfkb-claude-plugin) works in this order:
1. It reads the current pin's id from its step-2 `resume` (§3), **before** writing, because
   once the new handoff is written it is the pin.
2. It writes the new handoff exactly as today, with no `retires`.
3. If that previous pin exists and is a handoff fact, it names its id and first line in plain
   text, asks whether the new handoff replaces it, and **ends its turn**. It uses no
   blocking question tool, which may be unavailable under `claude -p`.
4. **Only on an explicit yes in a later user turn** does it run `vfkb curate retire <old> --by
   <new>`.

A run where nobody answers keeps its new handoff and retires nothing. vfkb does no headless
detection. This is a plugin change. It ships with the next plugin release, batched as the
operator ruled (brain `9746fb8556ef`), and that release's notes state "delivery is unproven" (ADR-0051).

### 6. The reports, CLI-only and read-only (Q3, Q4)

- **`vfkb curate handoffs`** lists, oldest first:
  - every injectable handoff/next-tagged fact other than the pin, with its age, its first
    line, and a flag for whether it is handoff-shaped;
  - the topically tagged decisions and links that §1 stops pinning.

  It prints a `curate archive <id>` line per candidate, for the operator to edit and run. It
  uses the tag-and-type boundary and decides nothing.
- **`vfkb curate stale [--days N]`** (default 30) lists:
  - proposed decisions and unpromoted incoming entries older than N days;
  - non-handoff status-tagged facts older than N days.
- **Neither writes.** A unit test asserts that `entries.jsonl` is byte-identical after both.
- **The backlog** is archived after the build, from the operator's edited list, as one
  brain-only PR (Q3).

### 7. Not built

- **Semantic dedup** is deferred. Its trigger: a recorded case where a duplicate pair misled
  an agent or crowded a pinned or injected result, or a double write the operator found by
  hand that `curate dups` missed.
- **Reviewer and headless sessions displacing the pin** stays a follow-on that needs a probe.
- **`valid_until`** stays unused.
- **Decision models** stay optional (Ruling 5) and are not used.

### 8. R1 and the order (Q5, Q6)

- **R1's gate** (ADR-0081) is unchanged. When step 2 is next considered, the operator
  revisits which path it measures, after the superseded labels `e9c19cc5819e` and
  `4bbe73188958` are resolved to their successors.
- **R7 goes next on its own merits.** The premise that it unblocks R1 is refuted, which re-
  ratifies Ruling 4's order as: R1 step 1 → **R7** → R3, R4, R8, with R1 step 2 gated.

## Definition of Done (ADR-0029/0050/0051)

- **Structural** (unit tests, each observed red under a mutation of the code it guards):
  - §1: a zone edit, promote or restore of an old handoff does not move the pin; a newer
    decision or link tagged `handoff` never pins.
  - §2: the rendered pin and B3's anchor agree on every fixture brain.
  - §4, for both `retires` and `curate retire`: each scope refusal (non-fact, archived,
    `<new>` = `<old>`, `<new>` older than `<old>`) appends nothing. A success archives
    `<old>`, tags `retired-by:<new>` and leaves its text byte-identical. `curate restore`
    removes the tag. A concurrent handoff not named stays live, and the pin is the
    newest-created of the two.
  - §6: neither report writes.
- **Agent-facing** (§5): the L4 `scenarios/handoff-retires.mjs` (vfkb-claude-plugin) runs
  `/vfkb:handoff` through the vendored plugin, on a brain whose pin is a sentinel handoff
  among older live handoffs. The user's answer is a **second, resumed turn**, never
  pre-loaded into the first prompt.
  - **Positive arm:** the second turn says yes. The new handoff exists and is the pin, the
    sentinel is archived with its text byte-identical, and the older handoffs are untouched.
  - **Negative arm:** the second turn says the current handoff is still live. The new
    handoff exists and is the pin, and **no handoff is archived**.
  - **No-answer arm:** there is no second turn. The new handoff exists and is the pin, and
    **no handoff is archived**.
  - **Contrast arm:** today's skill, given the same "yes" second turn as the positive arm.
    The sentinel stays live.
  - **Scoring:** every predicate is a content assertion over the brain, never an exit code
    (ADR-0051 §3). DEMONSTRATED needs ≥ 2/3 on each of the positive, negative and no-answer
    arms, with the contrast at 0/3 on retirement.
  - **The two-turn `--resume` mechanism is unrun.** Building the scenario starts by proving
    it can carry a skill's question and an answer. If it cannot, the L4 cannot be built as
    specified, and the design goes back to the operator. The answer is never pre-loaded into
    the first prompt as a workaround.
- **Until that record exists**, §5's status is "built, NOT yet verified", and delivery
  through the marketplace stays unproven.

## Consequences

- The pin stays put under curation, promotion and cross-clone edits. Decisions and links
  cannot take it, and a topical fact still can (stated, surfaced).
- B3's anchor and the rendered pin can no longer disagree, and RFC-043 inherits that.
- Each confirmed handoff retires its predecessor, so the live count stops growing by one per
  session. Unanswered runs still keep their new handoff.
- Archiving the backlog raises filtered recall@5 (measured 0.41 → 0.46 on `main`). Stage-1
  recall and R1's gate do not change.
- The build spans two repos: the engine here, and the skill plus the L4 in
  vfkb-claude-plugin. The plugin half ships with the next batched release.
