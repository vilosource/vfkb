---
type: Decision
title: "ADR-0017: Explicit search applies a relative relevance floor (amends ADR-0016)"
description: "Explicit search applies a relative relevance floor (distinct query-term ratio; default 1/3); amends ADR-0016"
status: "Accepted"
timestamp: 2026-06-15
---

# ADR-0017: Explicit search applies a relative relevance floor (amends ADR-0016)

- **Status:** Accepted
- **Date:** 2026-06-15
- **Deciders:** operator + Claude
- **Origin:** [RFC-001](../rfc/RFC-001-search-relevance-floor.md) (accepted on implementation).
- **Amends:** [ADR-0016](ADR-0016-search-ranking-and-embedding-revisit.md) — does **not**
  supersede it; 0016's relevance-primary search stands, this adds a filtering stage in
  front of the limit.

## Context

[ADR-0016](ADR-0016-search-ranking-and-embedding-revisit.md) made explicit text search
**relevance-primary**, fixing the *burying* failure (a correct gotcha sorted to ~rank 90
and cut by `limit`). It left the **inverse** open — the *surfacing* of weak matches.

Ground truth in the code: `InMemoryIndex.searchScored()` (`src/index-store.ts`) already
filters `score > 0`, but `score` is an **unnormalized stemmed term-overlap count that
includes repeats** — so a long entry repeating one common query token scores high while
matching only **one distinct** query term. A query of many terms that incidentally shares
one common word with an unrelated entry still surfaces it, and the agent reads the top of
the list as authoritative. This is the same failure *class* as the burying bug, from the
surfacing side; the devops-kb live turn (2026-06-06) showed an agent laundering such a
weak match into a confident wrong answer.

External corroboration: AnythingLLM ships a **Document Similarity Threshold** (default min
20%, settable to "No Restriction") to drop chunks below a relevance score. Same mechanism;
its score is normalized cosine `0–1`, so the *value* 0.2 does not port to vfkb's
term-overlap count — only the *idea* of a floor.

## Decision

Explicit text search applies a **relative** relevance floor, in terms of **distinct
query-term coverage** (not the raw repeat-counting `score`, and not a cosine fraction):

1. A candidate is kept only if `matched / queryTermCount >= minTermRatio`, where `matched`
   is the count of **distinct** stemmed query terms the entry contains and `queryTermCount`
   is the query's distinct stemmed term count. `searchScored` now returns `matched`;
   `queryTermCount()` is exported from the index for a shared tokenizer/stemmer.
2. **Default `minTermRatio = 1/3` with a `>=` test.** A 1–2 term query reduces to the
   prior `score > 0` (1/1, 1/2 ≥ 1/3); a 3-term query still admits a single strong match
   (1/3 ≥ 1/3); the "1 common term out of 8" noise (1/8 < 1/3) is dropped. The default can
   therefore only remove genuine non-matches, never reorder or drop a real top hit.
3. **Explicit search only.** Applied in `read.query()` when `opts.text` is present.
   Listing and the always-on injection bundle have no query → no floor (the ADR-0016
   boundary and the ADR-0005 hard gate are unchanged).
4. **Configurable.** `opts.minTermRatio` overrides per query; `0` disables the floor.

*Implemented and tested* (this commit): `src/index-store.ts` (`matched`,
`queryTermCount`), `src/read.ts` (`DEFAULT_MIN_TERM_RATIO`, the floor), 5 new tests in
`test/read.test.ts`, and a deterministic in-container check (`spike/dogfood-smoke.sh` #7).

## Consequences

- **+** Closes the surfacing side of the relevance hole; incidental single-term matches
  stop masquerading as answers. The ADR-0012 burying regression still passes — the floor
  drops the distractors, *strengthening* it.
- **+** Produces an honest empty result when nothing clears the floor — the groundwork for
  [RFC-002](../rfc/RFC-002-honest-no-match-contract.md)'s cause-distinguished no-match.
- **−** A term-overlap ratio is coarser than a normalized similarity floor; there is no
  graceful 0.2. Accepted — the normalized floor arrives with
  [RFC-003](../rfc/RFC-003-embedding-accuracy-mode.md)'s embeddings, at which point the
  ratio floor defers to cosine in accuracy mode.
- **−** A high `minTermRatio` could drop a real single-strong-term match in a long query.
  Mitigated by the conservative 1/3 default + the per-query override.
- **Neutral:** injection / `kb_list` ordering and `searchScored`'s `score > 0` absolute
  floor are untouched. ADR-0016 stays **Accepted**, annotated *"Amended by ADR-0017."*

## Alternatives Considered

- **Status quo (`score > 0` only).** Rejected — one matched common term is too low a bar at
  brain scale; the surfacing failure is observed.
- **Floor on the raw `score`.** Rejected — `score` counts repeats, so it rewards a long
  entry hammering one common term; distinct-term coverage is what distinguishes signal.
- **Port AnythingLLM's 20% cosine threshold.** Rejected — vfkb's score is unnormalized
  term-overlap, not cosine; the number is meaningless here. Mechanism transfers, value does
  not.
- **Lower the `limit` instead.** Rejected — `limit` controls quantity, not quality.

## Related

[ADR-0016](ADR-0016-search-ranking-and-embedding-revisit.md) (relevance-primary search —
amended here), [ADR-0012](ADR-0012-two-stage-retrieval.md) (the two-stage pipeline),
[ADR-0005](ADR-0005-injection-filters-stale.md) (injection hard gate — distinct,
unaffected), [RFC-002](../rfc/RFC-002-honest-no-match-contract.md) /
[RFC-003](../rfc/RFC-003-embedding-accuracy-mode.md) (build on this floor). Code:
`src/index-store.ts`, `src/read.ts`; tests `test/read.test.ts`. Evidence: devops-kb live
turn 2026-06-06; AnythingLLM Document Similarity Threshold.
