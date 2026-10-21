# R7 curation probe (2026-10-21)

The evidence for [RFC-045](../../../../rfc/RFC-045-propose-only-curation.md). It measures what
R7 proposes to curate, on two brains, using the real engine (`dist/`; run `npm run build` first):

```
node docs/v3/research/probes/curation-2026-10-21/measure.mjs test/fixtures/recall-eval/brain-9095dc4.jsonl test/fixtures/recall-eval/labels.json
git show c224878:.vfkb/entries.jsonl > /tmp/main.jsonl
node docs/v3/research/probes/curation-2026-10-21/measure.mjs /tmp/main.jsonl test/fixtures/recall-eval/labels.json
```

Outputs: [`snapshot-9095dc4.txt`](snapshot-9095dc4.txt) is the pinned R1 eval snapshot, and
[`main-c224878.txt`](main-c224878.txt) is the brain on `main` after R1 step 1 landed.

## What it found (main at c224878; snapshot figures in brackets)

1. **Handoffs never retire.**
   - 130 [123] injectable entries carry `handoff` or `next`.
   - Besides the pin, 84 [77] are facts that open as a handoff. That is the shape boundary,
     a lower bound: some handoffs open "SESSION CLOSE …" or "CLOSED OUT …".
   - 115 [108] are handoff/next-tagged facts of any shape. That is the tag boundary, an
     upper bound: it includes `fba5f66fd3df`, a queued item that is a labelled right answer.
   - 24 [18] entries name a predecessor in their text ("supersedes <12-hex id>"). All 4
     entries with `refs.supersedes` are decisions, because `supersede()` refuses facts
     (ADR-0004).
2. **The pin is unstable.**
   - `latestHandoff` orders by `updated`, and `updateEntry` bumps it. A zone edit of the
     oldest handoff fact (`1488c66658c4`) made it the pin on both brains.
   - Eligibility is any tagged type. 14 decisions and links carry the tag topically.
   - The one hijack observed live was a fact, `a91f82e76700` (brain `583374f75808`, repaired
     in PR #358).
3. **Semantic duplicates are rare.** Word-set Jaccard ≥ 0.5 gives 14 [13] pairs.
   - 11 are an RFC link plus the link to the ADR that accepted it.
   - That leaves 3 [2]: one double write (`753e0647990c` ~ `dcfbe6a08613`, 0.98), one
     correction pair (`cca762c38f5e` ~ `6f48c16787cf`), and, on main only, two successive
     handoffs.
   - The triplet `e9c19cc5819e`/`4bbe73188958`/`e68ad28f11b6` was already resolved by
     supersession.
4. **Staleness is mostly the handoff backlog.**
   - 92 of 125 status-tagged injectable entries are more than 30 days old.
   - 29 of 38 proposed decisions are more than 30 days old.
   - 66 of 70 incoming entries are more than 30 days old.
   - No entry in the log has ever carried `valid_until`.
5. **The link to R1.**
   - Stale handoffs hold 24 [20] of the 90 top-5 slots on the 18 eval prompts.
   - Live stage-1 recall@5 fell from 0.565 (the snapshot) to 0.517 in one day. 4 of the 5
     slots won by post-snapshot entries went to handoffs (`0836d40055dd` ×3,
     `c6a53a88a8b0`). The fifth went to `8f21f98df86a`, a gotcha that quotes the eval
     prompts.
6. **Stage-1 counterfactuals** (dropping entries from the ranking without re-scoring): 0.5926
   at the shape boundary and 0.6037 at the tag boundary on the snapshot; 0.5741 and 0.5852 on
   main.
   - `searchScored` ranks archived entries too, so archiving cannot move this metric, and it
     is the one ADR-0081's gate measures.
   - Picking the boundary that crosses 0.6 (ADR-0080 §2's step-1 bar, now the named gate on
     step 2) would be tuning against the 18.
7. **The filtered path** (`read.query`, limit 5, measured by archiving in the temp copy):
   - 0.4167 → 0.4556 on the snapshot, and 0.4056 → 0.4556 on main, at either boundary.
   - Two labelled-relevant ids (`e9c19cc5819e`, `4bbe73188958`, in 4 prompts' labels) have
     since been superseded, so this path can never return them.

## Limits

- The handoff-shape test is a regex over the opening words. It undercounts handoffs that
  open some other way, and it does not judge whether an old handoff still carries unique
  knowledge.
- Jaccard over word sets is a cheap proxy. It is not the semantic dedup that RFC-003 gates.
- "Today" is the newest timestamp in each brain, so ages are as of that brain.
