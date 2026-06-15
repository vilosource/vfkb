# RFC-001: Explicit search applies a relative relevance floor

- **Status:** Proposed
- **Date:** 2026-06-15
- **Deciders:** operator + Claude (proposed — comment period open)
- **Refines (on acceptance):** [ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md)
  decision pt 1 (relevance-primary search). Does not touch the ADR-0005 injection gate.

## Context

[ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md) made explicit text
search **relevance-primary** — Stage-1 score is the primary sort key, the Heuristic
comparator only a tiebreak — fixing the *burying* failure (a correct gotcha sorted to
~rank 90 and cut by `limit`). It did not address the **inverse**: the *surfacing* of
weak matches.

Ground truth in the shipped code:

- `InMemoryIndex.searchScored()` (`src/index-store.ts:83`) already applies an absolute
  floor of `score > 0` (`:94`): an entry must match **≥1 stemmed query term** to be
  returned, capped at the top-k by raw match count. There is **no zero-score padding**.
- The score is an **unnormalized stemmed term-overlap count** (`:79` — "no IDF, no
  length normalization; the score is # of entry tokens matching a query term").
- `read.query()` (`src/read.ts:48`) pulls 200 candidates from `searchScored`, then
  applies the ADR-0016 relevance-primary sort and slices to `limit` (MCP default 25).

So a floor exists, but `score > 0` is a **very low bar**: a query of eight substantive
terms that matches **one** common term in an unrelated entry yields `score = 1` and that
entry surfaces. At the per-project scale this is mostly noise; the agent reads the top of
the list as authoritative. This is the same failure *class* as the original bug — a
low-relevance entry presented as an answer — now from the surfacing side. The devops-kb
live turn (2026-06-06) showed an agent laundering exactly such a weak match into a
confident wrong answer.

**External corroboration.** AnythingLLM ships a **Document Similarity Threshold**
(default **minimum 20%**, settable to **"No Restriction"**) precisely to drop chunks
below a relevance score before they reach the LLM, and its docs name a too-low threshold
as "likely the cause" of hallucinated answers. Same intent; different scoring basis
(their normalized cosine `0–1` vs vtfkb's unnormalized term-overlap **count**) — so the
*value* `0.2` is not portable, only the *mechanism*.

## Decision

Explicit text search applies a **relative** relevance floor on top of the existing
`score > 0`, excluding weak candidates **before** the `limit` slice. Because the Stage-1
score is an unnormalized count, the floor is defined in term-overlap terms, **not** as a
fixed cosine fraction:

1. **Ratio floor (primary):** a candidate must match at least a configurable fraction
   `min_term_ratio` of the **distinct stemmed query terms** (default conservative, e.g.
   `0.34` — "≥1/3 of the query's terms", which for short 1–2 term queries reduces to the
   current `score > 0`). This kills the "1-of-8 common-word match" noise without
   penalising genuine short queries.
2. **Applies to explicit search only.** When `opts.text` is present (`read.query` /
   `kb_search`). The injection bundle and `kb_list` have **no query** → no floor (the
   ADR-0005 hard gate and pure Heuristic order are unchanged — ADR-0016's boundary).
3. **Configurable, conservative by default.** The floor can only ever *remove* genuine
   non-matches; it must never drop an entry that the relevance-primary sort would have
   ranked among the real top hits. Tunable per query (an arg) and per project (config),
   default off-or-low so accepting this RFC cannot silently regress recall.

A floor that removes **all** candidates produces an empty result — whose honest
reporting is [RFC-002](RFC-002-honest-no-match-contract.md).

## Consequences

- **+** Closes the surfacing side of the relevance hole: weak/incidental matches stop
  masquerading as answers. Directly attacks the devops-kb failure class.
- **+** Enables RFC-002 (a floor that removes everything → an explicit, honest no-match).
- **+** Conservative default + ratio-not-absolute design means it cannot regress any
  query that already returns real matches.
- **−** A term-overlap ratio is coarser than a normalized similarity floor — there is no
  graceful "0.2". Accepted; the normalized floor arrives with
  [RFC-003](RFC-003-embedding-accuracy-mode.md)'s embeddings, at which point this ratio
  floor defers to cosine in accuracy mode.
- **−** A too-aggressive `min_term_ratio` could drop a real single-strong-term match in a
  long query. Mitigated by the conservative default and the stemming already in place
  (ADR-0016 pt 2).
- **Neutral:** injection / `kb_list` ordering untouched; `searchScored`'s `score > 0`
  stays as the absolute floor beneath the ratio floor.

## Alternatives Considered

- **Status quo (`score > 0` only).** Rejected — the surfacing failure is real and
  observed; one matched common term is too low a bar at brain scale.
- **Port AnythingLLM's 20% cosine threshold directly.** Rejected — vtfkb's Stage-1 score
  is an unnormalized term-overlap count, not cosine; `0.2` is meaningless against it. The
  *mechanism* transfers, the *number* does not.
- **Lower the `limit` instead.** Rejected — `limit` controls quantity, not quality; a
  small limit still returns the best of the noise. (ADR-0016 already rejected the
  symmetric "raise the limit" for the burying bug.)
- **An absolute count floor (`score ≥ N`).** Rejected — length-dependent: punishes short
  queries, lets long-query noise through. The ratio is query-length-invariant.

## Related

[ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md) (relevance-primary
search — refined here), [ADR-0012](../adr/ADR-0012-two-stage-retrieval.md) (the two-stage
pipeline), [ADR-0005](../adr/ADR-0005-injection-filters-stale.md) (injection hard gate —
distinct, unaffected), [RFC-002](RFC-002-honest-no-match-contract.md) (honest empty —
depends on this), [RFC-003](RFC-003-embedding-accuracy-mode.md) (a normalized floor,
later). Code: `src/index-store.ts:83-96`, `src/read.ts:43-84`. Evidence: devops-kb live
turn 2026-06-06; AnythingLLM **Document Similarity Threshold** (default 20% / "No
Restriction").
