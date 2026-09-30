---
type: RFC
title: "RFC-040: The churn Brake — make fix-introduced findings computable, and force a referent when the same layer keeps failing"
description: "ADR-0070 §4 escalates on blocking findings introduced by the previous round's fixes. Three review arcs this month (#317, #322, vfkb-claude-plugin#60) churned for 7, 4 and 3 rounds with 44–100% of each round's majors fix-introduced, and §4 never fired because none had a blocking finding. All three ended the same way: an authoritative referent replaced a hand-rolled approximation. The lesson — after two rounds in one layer, stop fixing and name the referent — is on record as prose (brain cface5291391) and was read past twice in one day. Proposes one new required review-record field (introducedBy), promotes file to required, and has the review gate compute two signals across a PR's rounds. On fire the gate fails unless the record names the referent. A forced decision, not a freeze."
status: "Proposed"
timestamp: 2026-09-30
---

# RFC-040: The churn Brake

- **Status:** Proposed
- **Date:** 2026-09-30
- **Deciders:** operator + Claude
- **Relates:** [ADR-0070](../adr/ADR-0070-guards-that-can-fail.md) (amends §4's escalation
  trigger), [ADR-0052](../adr/ADR-0052-review-gate.md) (extends the record schema),
  [ADR-0051](../adr/ADR-0051-delivery-honesty.md) (the enforced-disclosure shape this copies).
  Origin: #319 §5. Build tracker: #326. Brain: `cface5291391`, `78bbdd0ef2a7`.

## Context — three arcs, one shape

ADR-0070 §4 changed the autonomous-PR escalation trigger from "three rounds" to "a round whose
**blocking** findings were introduced by the previous round's fixes", on the argument that round
count alone does not imply distress. That argument still holds. What the month showed is that
the trigger is keyed on the wrong severity: churn does its damage at *major*, and a review gate
that never issues a blocking finding can be churned indefinitely with §4 silent throughout.

| PR | rounds | findings introduced by the previous round's fixes | the layer | §4 fired |
|---|---|---|---|---|
| #317 (admission gate) | 8 | 44–67% of majors in every round from r2 (#319 §5) | the selftest, hand-approximating `gh` | never |
| #322 (P2 harness) | 4 | r2: 3 of 4 majors · r3: 2 of 4 | provenance: hand-rolled file hashes where `repoSha` already existed | never |
| vfkb-claude-plugin#60 | 3 | r2: 3 of 3 majors · r3: 5 findings | a predicate hand-enumerating what a model might say | never |

All three were resolved the same way. Not by a better approximation — each round *had* produced a
better approximation, and that is what the next round found wanting — but by locating the authority
that already knew the answer: a real `gh` in the L4; `repoSha` from a clean tree; the five sections
`brief/SKILL.md` §5 mandates. That is brain `cface5291391` ("hand the hardest sub-problem to
something authoritative"), a lesson recorded on 2026-09-14 and read past in both of 2026-09-30's
arcs by the same author on the same day. #319 §5 proposed the fix as a paragraph; this RFC is what
it takes to make the paragraph fire.

Two facts make it cheap. First, every reviewer this month reliably answered "was this introduced
by the previous round's fixes, or pre-existing?" — because the prompt asked — and every answer was
then discarded into prose. Second, the union of finding fields across all 71 committed
`reviews/*.json` is `id, summary, severity, status, acceptedBy, category, file, line,
failure_scenario, short_summary`: `file` is already there, unvalidated; `introducedBy` exists in no
record at all. The gate validates only the first five (`scripts/review-gate.mjs:133-147`).

## Proposal

### 1. Two finding fields become required

```jsonc
{
  "id": "R3-MA1",
  "severity": "major",
  "status": "fixed",
  "summary": "…",
  "file": "scenarios/brief-predicates.mjs",   // REQUIRED — the layer
  "introducedBy": "0c5d17b…",                // REQUIRED — null, or the sha of the reviewed
  "acceptedBy": null                          //   commit whose fixes introduced this finding
}
```

`introducedBy` is `null` for a pre-existing defect. It is reviewer-authored, exactly as the whole
record is, and the gate cannot verify it; the limit is the one ADR-0052 already accepts ("it
cannot check that a review happened"). What changes is what ADR-0052 changed: skipping the question
stops being silent and becomes a false statement committed under a name.

### 2. The gate computes two signals across the PR's rounds

`candidateShas()` today walks only from HEAD through trailing review-record commits to find *the
one record that binds the head*. A cross-round signal needs a second, wider walk: every commit in
`merge-base..HEAD` for which `reviews/<sha>.json` exists, ordered by commit order. That is
mechanically available and needs no new inputs.

Over those records, in order:

- **Churn** — the #319 §5 signal, verbatim: ≥50% of a round's findings carry `introducedBy` equal
  to the previous round's reviewed sha, **two consecutive rounds, any severity**.
- **Layer** — ≥3 findings across ≥2 rounds share one `file`.

Either firing is the distress signal §4 was written to detect. The churn signal is what §4 meant;
the layer signal is what the three arcs actually needed, since "the same file keeps producing
findings" is the observable shape of "the referent is wrong".

### 3. On fire, the gate fails unless the head record names the referent

```jsonc
"referentReview": {
  "layer": "scenarios/brief-predicates.mjs",
  "referent": "brief/SKILL.md §5's five mandated sections — bounded, defined by the file under test",
  "conclusion": "changed: the gate is now structural; refusal patterns demoted to diagnostic",
  "by": "<name in reviews/OPERATORS, or the author for a non-blocking round>"
}
```

This is a **forced decision, not a freeze** — the same shape as ADR-0051's mechanically enforced
disclosure and the `acceptedBy` waiver. The block may conclude "unchanged, and here is why the
current referent is right"; what it may not do is stay absent. `by` is validated like
`acceptedBy` when the fired round contains a blocking finding, and may be the author otherwise.

### 4. The failure message names the layer and the rounds

> `GATE FAIL: [churn] 3 of 4 findings in rounds 2–3 are in scenarios/brief-predicates.mjs and were
> introduced by the previous round's fixes. Name the referent in referentReview, or change it.`

A signal that does not say where to look is a signal that gets acknowledged and ignored.

### 5. The review rubric asks for the fields, not the prose

`.claude/commands/review.md` step 8 asks for `file` and `introducedBy` per finding as record
fields. The prompt already asks the question; this moves the answer into the artifact.

## Alternatives considered

- **Leave it as prose in `review.md`** (#319 §5's second suggestion). Rejected: it is already prose,
  in the brain, and was skipped twice in one day by an author who had written it. This repo's
  founding lesson is that a prose rule with no Brake gets skipped (ADR-0050's context).
- **Change §4 to "any severity" and stop there.** Rejected: §4 as written is not computable at all —
  nothing records which round introduced a finding — so a severity change alone changes nothing a
  machine can see. The field is the prerequisite; the threshold is the easy part.
- **Round-count ceiling (the pre-ADR-0070 rule).** Rejected for the reason ADR-0070 gave: round
  count does not imply distress. #322 converged at four rounds with no blocking finding; a ceiling
  would have escalated a PR that was, in fact, done.
- **Freeze the PR on fire.** Rejected: the arcs show the fix was cheap once the referent was named;
  a freeze punishes the diagnosis instead of demanding it.

## Consequences

- **+** Both 2026-09-30 arcs would have fired at round 2 (#60) and round 3 (#322); #317 at r3 and r5.
  That is the can-fail arm, and the DoD below requires replaying the committed records to observe
  it.
- **+** The referent question becomes a structural step in a review, not a memory the author has to
  retrieve under end-of-chain momentum.
- **−** Every finding now carries two more fields; a record with 17 findings (#322's) grows by ~17
  lines. Accepted: the fields are the whole point.
- **−** Existing records lack the fields. They must be grandfathered by `recordVersion` (a v3 record
  requires them; v1/v2 records on already-merged branches do not fail the gate), or every historical
  PR's CI re-run goes red.
- **Stated limit:** self-reported `introducedBy`. See §1.

## Definition of Done

The build tracker is #326; its acceptance criteria are the DoD. In particular, per ADR-0070 §2 each
new gate check ships with its mutation observed red, and the can-fail arm is **replaying the
committed records for #322 and vfkb-claude-plugin#60 through the new check and observing it fire at
the rounds named in the table above** — a churn Brake that does not fire on the arcs that motivated
it proves nothing.
