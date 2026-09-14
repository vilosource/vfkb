---
type: Decision
title: "ADR-0076: Two owed rulings — the instrument is rounds-to-converge, and recorded_invalid_at is deleted"
description: "Rules the two questions ADR-0074 and ADR-0075 left explicitly owed. (1) RFC-039 §6 Q4: the scope instrument is NOT merge rate, which is degenerate in this repo at 97.7% across 266 PRs of which 246 are self-authored and self-merged; it is rounds-to-converge plus blocking-findings-per-PR, already collected in reviews/*.json, with a baseline measured here of 1.95 mean rounds and ~0.8 blocking findings per reviewed PR. (2) ADR-0074 D2: recorded_invalid_at is DELETED, not deferred — it had no write site and no read site in fifteen months and no entry ever carried it as a key. Also AMENDS ADR-0075 clause 9, whose claim that a baseline cannot be retrofitted is too strong and is narrowed to attribution."
status: "Accepted"
timestamp: 2026-09-14
---

# ADR-0076: Two owed rulings

- **Status:** Accepted (2026-09-14, operator ratification)
- **Build status — tracked in [#293](https://github.com/vilosource/vfkb/issues/293) (D2 deletion)
  and [#297](https://github.com/vilosource/vfkb/issues/297) (the instrument), not here.**
- **Date:** 2026-09-14
- **Rules:** [ADR-0074](ADR-0074-consume-the-schema-already-shipped.md) clause 6 (D2, left unruled
  with the standing instruction that a third deferral is not an acceptable resting state) ·
  [RFC-039](../rfc/RFC-039-the-software-factory.md) §6 question 4, left open by
  [ADR-0075](ADR-0075-the-software-factory.md) clause 9
- **Amends:** [ADR-0075](ADR-0075-the-software-factory.md) clause 9 — see §3. Per
  [ADR-0001](ADR-0001-record-decisions-as-adrs.md) a decided ADR body is immutable, so the
  correction is recorded here rather than edited into ADR-0075.
- **Relates:** [RFC-038](../rfc/RFC-038-consume-the-schema-already-shipped.md) (recommended the
  deletion; this ADR verified its evidence rather than inheriting it);
  [ADR-0052](ADR-0052-review-gate.md) (the review records the instrument reads);
  [ADR-0070](ADR-0070-guards-that-can-fail.md) §4 (the escalation rule that shares the
  instrument's signal); [#261](https://github.com/vilosource/vfkb/issues/261)

## 1. RFC-039 §6 Q4 — the scope instrument

**Merge rate is rejected as the instrument.** ADR-0075 clause 7 makes "our own merge and revert
rate" the only valid evidence for widening dispatch scope. Measured on this repo, that number is
**degenerate**: 259 merged of 265 resolved pull requests = **97.7%**, across 266 total, of which
**246 are authored by `vilosource`** and merged by the same hand.

A merge rate produced by a workflow with no independent rejection pressure carries no information
about correctness. Adopting it would install an instrument that is reassuring and cannot move —
the measurement equivalent of a guard that cannot fail (ADR-0070 §1).

**The instrument is rounds-to-converge and blocking-findings-per-PR**, read from the ADR-0052
review records in `reviews/`, which this repo has been collecting since that gate landed.

**Baseline, measured 2026-09-14 over the 55 records then present:**

| metric | baseline |
|---|---|
| mean rounds-to-converge | **1.95** |
| rounds distribution | 1:23 · 2:22 · 3:4 · 4:3 · 5:2 · 6:1 |
| findings | 44 `blocking` · 82 `major` · 165 `minor` |
| blocking findings per reviewed PR | **~0.8** |
| verdicts | 53 `MERGE` · 2 `FIX-FIRST` |

**Dispatch scope (ADR-0075 clause 7) widens only if dispatched work holds at or below both the
1.95 mean rounds and the ~0.8 blocking-findings figure**, with revert rate as the lagging check.

Two properties of this choice are the reason for it. It measures **rejection pressure that
demonstrably exists here** — 44 blocking findings across 55 records is a gate that visibly bites,
where the merge rate is a gate that visibly does not. And it **shares a signal with ADR-0070 §4**:
the 5- and 6-round records in that distribution are the escalation case where a round's fixes
introduced the next round's blocking findings, so a regression in the instrument and a distress
signal in the review loop are the same observation rather than two systems to reconcile.

**One thing must be built rather than measured: the dispatcher marks its own pull requests** — by
label, or by a field in the review record. This is the sole genuinely time-sensitive part of the
clause (see §3).

## 2. ADR-0074 D2 — `recorded_invalid_at` is DELETED

Deleted, not deferred and not allowlisted. RFC-038 recommended this; the evidence was re-verified
here rather than inherited, per #261.

**Verified:** the field had exactly three occurrences in all code — a declaration in
`src/types.ts`, a comment above it, and a `z.string().optional()` in `src/validate.ts` — with **no
write site and no read site** anywhere in `src/` or `test/` since ADR-0011 declared it. It is the
RFC-038 instance that was dead in *both* directions.

Two findings make deletion safe rather than merely tidy, and both were observed rather than
assumed:

1. **No entry has ever carried it as a key.** Parsing `.vfkb/entries.jsonl` and inspecting each
   entry's `validity` object yields **zero** occurrences; the two textual matches are prose inside
   entries discussing the field.
2. **`validity` is declared with `z.looseObject`**, so an undeclared key is not a rejection.

**A false claim is corrected alongside it.** `src/types.ts` described the field as
"stored-but-not-consumed in v1", and `docs/FEATURES.md` as "stored but not yet read". Both are
wrong in the same direction: it was never *stored* either. A comment asserting a property the code
does not have is itself an instance of the pattern RFC-038 exists to name, which is why the
correction rides this clause rather than waiting.

**Deleting is also what keeps ADR-0074's D5 envelope-coverage Brake honest.** The alternative —
allowlisting the field as deliberately dormant — requires naming an ADR that defers it, and the
only candidate is ADR-0011, whose deferral has been falsified by fifteen months without a producer.
An allowlist entry pointing at a falsified deferral would make the Brake's exemption list the place
where this exact pattern hides next.

**The replacement comment states the rule rather than the history:** re-add the field *with* its
producer, never ahead of one.

**RFC-038's own prescription is departed from, deliberately, and the RFC's rationale was inverted.**
RFC-038:222 defines the delete branch as removing the `types.ts` declaration but **keeping** the
`z.string().optional()` in `src/validate.ts` *"so any entry that ever carried one is not
corrupted."* This ADR removes both, because the review of the implementing change established by
execution that **the declaration was the corrupting element**: given a malformed value, the
`z.string()` fails, the `.catch({})` fires on the **whole** `validity` object, and the declared
siblings are destroyed with it — `valid_until` lost and `valid_from` silently reset to the entry's
`created` stamp. Undeclared, the same bad value is simply carried through by `looseObject`.

That is recorded here rather than left to the diff because a future reader comparing the code
against RFC-038 would otherwise "restore" the declaration believing the RFC required it, and
reintroduce the destructive path. A regression test guards the same thing mechanically.

## 3. Amendment to ADR-0075 clause 9 — the retrofit claim was too strong

ADR-0075 clause 9 states that the merge-rate baseline **"cannot be retrofitted"**, and uses that to
give Q4 a deadline the other open questions do not have. **That claim is too strong and is narrowed
here.**

It was falsified in the course of ruling §1: both a merge-rate baseline (97.7% over 266 PRs) and
the review-record baseline in §1's table were computed **retroactively**, from data GitHub and this
repo had already stored. Nothing had to be instrumented in advance to obtain either.

**What genuinely cannot be retrofitted is attribution** — which pull requests came from the
dispatcher rather than a human. That is not recoverable after the fact, which is why §1 requires
the dispatcher to mark its own PRs.

**The deadline in ADR-0075 clause 9 therefore survives, but for a narrower reason**: not because
the baseline would be unobtainable, but because without attribution the baseline could never be
*compared against* anything. The practical consequence is unchanged — the marking must exist before
dispatch begins — and the stated justification is now accurate.

This amendment is recorded because the original wording would otherwise have been relayed onward as
established, and the asymmetry #261 exists to catch is precisely a confident sentence that nobody
checked.

## Consequences

**Positive.** Both questions ADR-0074 and ADR-0075 left owed are closed, and neither was closed by
deferral. The instrument chosen already has data behind it, so ADR-0075 clause 7's evidence
standard is satisfiable on the day dispatch starts rather than a quarter later.

**Negative / accepted.** The instrument reads `reviews/*.json`, so it measures only work that went
through the ADR-0052 gate — a change small enough to skip review is invisible to it. That is
accepted: the gate's own `IMPL_PATHS` classification already decides what is worth reviewing, and a
second, differently-scoped instrument would be a second thing to keep honest.

Deleting `recorded_invalid_at` means bi-temporal invalidation has no schema surface at all. This is
intended — ADR-0075's own framing is that a field nothing writes is a claim no test can falsify —
but it does mean a future bi-temporal consumer starts from a schema change rather than from a
field already waiting. That cost is accepted as smaller than the cost of the dormant-field pattern
recurring.

**Scope this ADR does not take.** It does not reopen bi-temporal consumption, which remains gated.
It does not change the ADR-0052 record schema. It does not decide RFC-039 §6 questions 2 or 3,
which stay open.

## Proof

**§2 needs no L4 and that is argued, not assumed.** It is the deletion of a declaration with no
call sites, which ADR-0029's capability-level rule exempts as a sub-task; it rides the unit suite,
whose 63 files and 772 tests pass unchanged — a fact that is itself evidence, since a field with a
consumer could not be removed without reddening something.

**§1's obligation binds when the dispatcher is built, not now:** the attribution marking must be
observed on a dispatched PR, and the instrument must be computed from records the dispatcher
produced — not from a hand-assembled sample. Per ADR-0051 §3 the predicate is a content assertion
over the records, never an exit status.
