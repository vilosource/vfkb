---
type: RFC
title: "RFC-040: The referent question — require a named, checkable referent on any review record that reaches round three"
description: "Four review arcs this month (#307, #317, #322, vfkb-claude-plugin#60) ran 7, 8, 4 and 3 rounds. Every one ended the same way: an operator ruling that replaced a hand-rolled approximation with an authority that already knew the answer — a real gh, a real renderer, git's own repoSha, the skill's own mandated template. ADR-0070 §4 fired on two of them and its ceiling on the other two; the escalation worked. What did not exist was anything that asked the referent question BEFORE a human had to. Brain pattern cface5291391 states the rule and was read past twice in one day. This RFC's first draft claimed §4 never fired; the adversarial review showed that false on the committed record (REDESIGN), and this is the narrower proposal that survives: a referentReview block, required on the head record once reviewer.rounds ≥ 3, whose referent must be a checkable artifact rather than prose. One gate line on a field the gate already validates. A forced question, not an escalation and not a freeze."
status: "Proposed"
timestamp: 2026-09-30
---

# RFC-040: The referent question

- **Status:** Proposed
- **Date:** 2026-09-30
- **Deciders:** operator + Claude
- **Relates:** [ADR-0052](../adr/ADR-0052-review-gate.md) (extends the record schema — the
  instrument), [ADR-0070](../adr/ADR-0070-guards-that-can-fail.md) (§4 unchanged; gains a status
  pointer), [ADR-0051](../adr/ADR-0051-delivery-honesty.md) (the enforced-disclosure shape this
  copies). Origin: #319 §5. Build tracker: #326. Brain: `cface5291391`.

## What this RFC's first draft got wrong, and why it matters here

The first draft's premise was that ADR-0070 §4 "never fired" on any of the four arcs because none
had a blocking finding. The adversarial review of that draft (PR #327, round 1) checked the
committed records and found it false: #307's own PR body records *"four ADR-0070 §4 escalations"*;
#317's round-4 record carries a **blocking** finding that opens *"INTRODUCED BY 1d5e0d5"*, the
round-3 fix commit, and the verdict REDESIGN; #322 and #60 hit §4's three-round ceiling and were
escalated. Every arc reached the operator, and every operator ruling *was* a referent decision —
`dd0711ae5a3b` on #317: *"the referent is a renderer, so the authority must BE the renderer."*

That matters beyond correcting a table. The draft was written by an author who had that day
twice failed to ask the referent question until a reviewer forced it, and the draft then asserted
a fact about four arcs having checked two. The mechanism this RFC proposes is the one that would
have caught its own first draft: a required, checkable statement of *what authority decides this*,
demanded by a gate rather than remembered by a person.

## Context — four arcs, one ending

| PR | rounds | how §4 behaved | the layer that churned | how it actually ended |
|---|---|---|---|---|
| #307 (tamper gate) | 7 builds, 7 reviews | fired 4× (r4, r5, r6 escalated) | regex over diff lines | operator narrowed scope (r5) and ruled fixes (r7); `vitest list --json` became the authority |
| #317 (admission gate) | 8 | fired r4 (blocking R4-B1 introduced by the r3 fix; REDESIGN) | the selftest hand-approximating `gh` | ruling `dd0711ae5a3b`: the renderer is the authority; ruling `f0c9a966545b`: split, don't iterate |
| #322 (P2 harness) | 4 | ceiling (r3), escalated | hand-rolled file hashes where `repoSha` already existed | advisory review: verdict re-derives from raw observations; operator ruled merge; residual → #323 |
| vfkb-claude-plugin#60 | 3 | ceiling (r3), HITL recommended | a predicate hand-enumerating what a model might say | `brief/SKILL.md` §5's five mandated sections became the gate; operator ruled merge |

Two things are true of all four. The escalation machinery **worked** — every arc reached a human.
And the thing the human then did was, in each case, name the referent: the authority that already
computed the answer the harness had been approximating. Brain `cface5291391` (a `pattern`,
2026-09-17, out of #307) states this as a method — *"if a guard's core is a regex, a substring
test, a count, or a similarity threshold, ask what tool already computes that answer
authoritatively"* — and states the shape of the escalation too: *"when §4 fires twice on the same
component, stop iterating and ask what authority you are approximating."*

The gap is not the trigger. It is that **the referent question is asked only by a human, only at
escalation, and its answer is recorded nowhere a gate can see.** On #322 and #60 that meant two
rounds of better approximations before anyone asked; on #307 it meant four. The pattern that
would have shortened every arc existed in the brain the whole time and was not consulted, which is
this repo's founding lesson about prose rules (ADR-0050's context) at one remove.

## Proposal

### 1. A `referentReview` block, required once `reviewer.rounds ≥ 3`

`reviewer.rounds` is already gate-validated as an integer ≥ 1 (`scripts/review-gate.mjs:126`).
The rule is one line on that field: a record declaring three or more rounds must carry

```jsonc
"referentReview": {
  "layer": "scenarios/brief-predicates.mjs",           // the component the rounds kept finding
  "referent": "plugin/skills/brief/SKILL.md",          // a CHECKABLE artifact — see §2
  "conclusion": "changed",                             // enum: changed | unchanged
  "why": "the template the skill promises is bounded; refusal phrasings are not",
  "by": "<author, or a reviews/OPERATORS name if the round carries a blocking finding>"
}
```

Three rounds is not an escalation threshold here and this RFC does **not** amend §4: the
escalation trigger (blocking, fix-introduced) and its ceiling stay exactly as written. Three rounds
is the point at which the record must *say what authority decides the contested behaviour*. A
four-round arc that was honest convergence (#322 was) answers the question in a sentence with
`conclusion: unchanged`; the block is a question, not a freeze, and not a summons.

### 2. The referent must be checkable, not prose

This is what closes the hole the review's M1 named — *a self-service escape hatch always leaks*
(`cface5291391`'s second rule). If `referent` were free text, the author writes "the current
design" and the gate is satisfied. So the gate accepts a referent only if it is one of:

- a **path** that exists in the repository (`plugin/skills/brief/SKILL.md`, `docs/adr/ADR-0042-…`),
- a **decision** that resolves (`ADR-0075`, `RFC-039`) — the admission gate's `find()` already does this,
- a **named tool** from a short allowlist (`git`, `gh`, `vitest`, `node`) — the authorities the four
  arcs actually landed on.

Existence, not quality — the same move the admission gate made when it stopped asking a model
whether an issue "looks well specified" and started checking that the named surfaces exist. The
gate cannot judge whether the referent is the *right* authority; a reviewer and the operator can,
and the block puts the claim where they will read it. That residual is stated, not hidden.

`by` follows `acceptedBy`'s existing rule: the author may sign a block on a round with no blocking
finding; a round that carries one needs a name in `reviews/OPERATORS`. This adds no new
accountability mechanism, which is `cface5291391`'s second rule in the positive.

### 3. `introducedBy` becomes an optional, informational finding field

The first draft made `introducedBy` required and computed a churn ratio from it. The review showed
that cannot be built as specified: record topology is inconsistent across the corpus (#317 filed
per round, #307 rounds 6–7 only, #322 one cumulative record), so "the previous round's reviewed
sha" is undefined for the very arcs that motivated the signal, and a 1-of-1 round is 100%.

The field is still worth having. Reviewers already answer the question when asked — in #317's
rounds 2, 3 and 4 **every finding's summary opens with the label** (`R2-B1 "PRE-EXISTING, not
introduced by round 2"`, `R2-M2..M6 "INTRODUCED BY ROUND 2"`, `R3-B1 "NOT introduced by round 3"`,
`R4-B1 "INTRODUCED BY 1d5e0d5"`, `R4-m1 "pre-existing"`), and #307's PR body carries an
"introduced-by-previous-round" column — and every one of those answers is prose inside `summary`,
where no gate can read it. So: optional, encouraged by `.claude/commands/review.md`
step 5 alongside `file:line`, **not gating**. If the corpus accrues enough of it to define a
computable signal honestly, that is a later RFC with data.

The **layer signal** from the first draft (≥3 findings, ≥2 rounds, one file) is dropped. It
false-fires on any multi-round PR that touches one file — the #326 build itself would trip it —
and the referent question at round three covers the same ground without the arithmetic.

### 4. The failure message names the rounds and the missing block

> `GATE FAIL: [referent] this record declares 4 review rounds and carries no referentReview.
> Three rounds is where the record must say what authority decides the contested behaviour — name
> a checkable referent (a repo path, an ADR/RFC, or git|gh|vitest|node), and whether it changed.`

## Alternatives considered

- **Compute a churn ratio from `introducedBy`** (this RFC's first draft; #319 §5 as written).
  Rejected for now: the data does not exist, the record topology it needs is inconsistent, and the
  can-fail arm could not be executed against either 2026-09-30 arc. The field is kept optional so
  the data can accrue.
- **Leave it as prose in `review.md`.** Rejected: it is already prose, in the brain, and was read
  past twice in one day. A prose rule with no Brake gets skipped.
- **Require an operator name on every `referentReview`.** Rejected: that makes round three a
  summons, which is the round-count escalation ADR-0070 §4 deliberately removed. Checkability of
  the referent, not a human signature, is what stops the block being boilerplate.
- **Round ceiling as escalation** (the pre-ADR-0070 rule). Unchanged and out of scope: §4 keeps its
  ceiling; this RFC adds a question at the same threshold, not a second escalation.

## Consequences

- **+** The four motivating arcs' **final committed records** all declare `rounds ≥ 3` (#307: 6 and
  7; #317: 8; #322: 4) and none carries `referentReview`. In fact **21 of the 71 committed records**
  declare three or more rounds, and none carries the block. Replaying them through the new check
  goes RED on all 21 — a can-fail arm that runs against evidence that exists, in the shape it
  exists in, and one that also measures the cost honestly: roughly 30% of records would have owed
  the paragraph.
- **+** The question that ended every arc is asked at round three by a gate instead of at round
  four-to-seven by a human.
- **−** Honest four-round convergence pays one paragraph. Accepted; the paragraph is the point.
- **−** All 71 committed records are `recordVersion: 1` and the gate rejects any other version
  (`scripts/review-gate.mjs:117`). The build bumps to `recordVersion: 2`, requires `referentReview`
  only on v2 records, and leaves v1 alone. Since the gate reads only `merge-base..HEAD`, history is
  never re-validated; the sole transition case is a PR open across the change, which re-files.
- **Stated limits:** the gate checks that the referent *exists*, not that it is the right authority;
  and `introducedBy` remains reviewer-authored and unverifiable, which is why it does not gate.

## Definition of Done

#326 is the build tracker and will be re-specified against this shape once accepted. In particular:
the check ships with its mutation observed red (ADR-0070 §2); the can-fail arm is the replay above —
all four motivating records RED, then green once each carries a valid block; and the
existence-probe for `referent` reuses the admission gate's `has()`/`find()` rather than a new
approximation of them.
