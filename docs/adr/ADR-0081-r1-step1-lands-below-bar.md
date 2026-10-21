---
type: Decision
title: "ADR-0081: R1 step 1 lands below its bar; the bar becomes a named gate on step 2 (amends ADR-0080 §2)"
description: "Records the operator ruling of 2026-10-21. BM25 plus stopword pruning (vfkb#364) lifted the R1 eval from recall@5 0.014 to 0.565 and MRR from 0.043 to 0.639, short of ADR-0080's step-1 bar (recall@5 >= 0.6). Step 1 lands anyway as a kb_search improvement. The eval stops being a pass test for step 1 and becomes a regression guard plus a named gate, STEP2_GATE_MET, which must be true before step 2 starts. No tuning against the 18 labelled prompts."
status: "Accepted"
timestamp: 2026-10-21
---

# ADR-0081: R1 step 1 lands below its bar; the bar becomes a named gate on step 2

- **Status:** Accepted (2026-10-21, operator ruling; brain decision `09c1ed653aee`)
- **Date:** 2026-10-21
- **Amends:** [ADR-0080](ADR-0080-query-time-injection.md) §2, "the step-1 bar". Per
  [ADR-0001](ADR-0001-record-decisions-as-adrs.md) a decided ADR is immutable, so the
  change is recorded here. Everything else in ADR-0080 stands, including §5: the Q4
  harness-turn probe still comes before step 2 is designed.
- **Evidence:** [vfkb#364](https://github.com/vilosource/vfkb/pull/364) (merge `0e806aa`)
  and its review record `reviews/970a1286c0d1bb1e027bacbcb01b3ec5666a2b9d.json`.

## Context

ADR-0080 §2 set a step-1 bar: recall@5 ≥ 0.6 on the labelled eval, plus beating the
pre-BM25 index on MRR. It said "step 2 does not start until this passes". Step 1 was
built to ADR-0080 §1, with BM25 (standard `k1`/`b`) and generic query stopword pruning.
On the 18 real topical prompts, labelled before any ranker existed:

| Stage 1 | recall@5 | MRR |
|---|---|---|
| before | 0.0139 | 0.0432 |
| BM25 + stopwords | **0.5648** | **0.6393** |

The other pre-declared alternatives, measured with the committed prototype
`compare-alternatives.mjs`, scored lower:
- stopwords alone, 0.269;
- plain BM25, 0.432;
- an IDF cutoff, 0.565.

None clears the bar. The remaining misses are structural:
- stale live handoffs that mention the topic outrank it, which is R7's curation problem;
- one prompt has no lexical link to its subject.

## Decision

1. **Step 1 lands below the bar.** It is a large improvement to `kb_search` in its own
   right.
2. **The eval stops being a pass test for step 1.** It becomes:
   - **a regression guard:** stage 1 must beat the pre-BM25 baseline and must not fall
     below the landed level (recall@5 floor 0.56, MRR floor 0.63);
   - **a named gate,** `STEP2_GATE_MET`, in `test/recall-eval.test.ts`, asserted equal
     to (recall@5 ≥ 0.6). It is `false` at landing.
3. **Step 2 starts only when two things are true:**
   - `STEP2_GATE_MET` has been flipped to `true` deliberately, with the re-measurement
     recorded;
   - the ADR-0080 §5 harness-turn probe has run.
4. **No tuning against these 18 prompts.** A change motivated by their misses would
   overfit the set meant to judge it. The routes to the bar are:
   - R7 curation of stale handoffs;
   - more real labelled prompts as the history grows;
   - a ranking change justified independently of this set.

## Consequences

- **R1 is blocked on R7 in practice.** Taking up R7 before R1 finishes is a deviation from
  Ruling 4's order, and it needs the roadmap re-ratified.
- **The landed floors sit just below the landed values.** A tokenizer or ranking change
  that costs recall trips them, by design.
- **Open follow-ups**, from the #364 review and brain `1a45c9ce56ea`:
  - the Stage-2 heuristic tie-break rarely fires under float scores, so score bucketing
    should be considered before step 2;
  - end-to-end `kb_search` recall@5 is 0.461;
  - three near-identical live entries inflate recall slightly.
