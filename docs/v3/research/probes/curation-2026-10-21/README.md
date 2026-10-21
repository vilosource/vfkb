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

1. **Handoffs never retire.** 130 [123] injectable entries carry `handoff` or `next`. 85 [78]
   of them are handoff-shaped facts (opening `HANDOFF`, `SESSION HANDOFF` or `RESUME`), and
   only one is pinned, so **84 [77] stale handoffs are live**. Of all the non-pinned
   handoff/next-tagged entries, 55 are more than 90 days old. **No handoff carries a supersession edge.** 24 entries say "supersedes X" in their
   text, but `supersede()` refuses facts (ADR-0004), so the prose is the only record. The
   handoff skill asks the author to "note" a stale predecessor, and it gets noted in prose.
2. **The pin can be hijacked.** 14 injectable handoff/next-tagged entries are not facts:
   decisions and links that carry the tag topically. `latestHandoff` would pin any of them if
   it were the newest. 45 handoff/next-tagged entries are not handoff-shaped (queued items,
   rulings, links). Brain `583374f75808` and PR #358 repaired one live case by hand.
3. **Semantic duplicates are rare.** Word-set Jaccard ≥ 0.5 finds 14 [13] pairs. 11 of them
   are an RFC link and the link to the ADR that accepted it, which are related but not
   duplicates. The other 3 [2] are one double write (`753e0647990c` ~ `dcfbe6a08613`, 0.98,
   written the same day), one correction pair (`cca762c38f5e` ~ `6f48c16787cf`), and, on
   main only, one pair of successive handoffs (`7eb9683fb412` ~ `09e77b61404b`). The near-duplicate triplet the R1 work worried about
   (`e9c19cc5819e`/`4bbe73188958`/`e68ad28f11b6`) had already been resolved by supersession,
   and only `e68ad28f11b6` is live. No two links share a target.
4. **Staleness is mostly the handoff backlog.** 125 status-tagged entries are injectable,
   and 92 of them are more than 30 days old. 29 of 38 proposed decisions are more than 30
   days old. 66 of the 70 incoming entries are more than 30 days old and were never promoted. **No entry
   uses `valid_until`**, so the expiry gate in `isInjectable` has never fired.
5. **The link to R1.** Of the 90 top-5 slots across the 18 R1 eval prompts, stale handoffs
   hold **24 [20]**. In one day the live brain's stage-1 recall@5 fell from 0.565 (the
   snapshot) to **0.517**. Of the 5 slots taken by entries written after the snapshot, 4 went
   to handoffs: `0836d40055dd` (3 slots), and `c6a53a88a8b0`, which says it supersedes two
   handoffs that both stay live. The fifth is `8f21f98df86a`, a probe gotcha that quotes the
   eval prompts, which is the trap the pinned snapshot exists for.
6. **Counterfactual, not a built feature.** Dropping the stale handoffs from the ranking,
   without re-scoring, gives recall@5 0.5926 on the snapshot (0.5741 on main). **That is
   still below the 0.6 step-2 bar**, so R7 alone does not unblock R1 on this evidence. Also,
   `InMemoryIndex.searchScored` ranks every materialized entry, archived ones included (the
   injectable filter runs after stage 1, in `query()`), so archiving does not move the
   stage-1 metric that ADR-0081's gate measures. It moves only the filtered path.

## Limits

- The handoff-shape test is a regex over the opening words. It undercounts handoffs that
  open some other way, and it does not judge whether an old handoff still carries unique
  knowledge.
- Jaccard over word sets is a cheap proxy. It is not the semantic dedup that RFC-003 gates.
- "Today" is the newest timestamp in each brain, so ages are as of that brain.
