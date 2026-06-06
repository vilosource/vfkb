# ADR-0012: Two-stage retrieval pipeline; v1 ships the Heuristic reranker (default); Stage-1 candidate-narrowing right-sized for the per-project tier

- **Status:** Accepted — Amended by [ADR-0016](ADR-0016-search-ranking-and-embedding-revisit.md)
- **Date:** 2026-06-03
- **Deciders:** operator (delegated "find the best solution") + Claude

## Context

mykb's single-stage retrieval (area word-overlap → entries dumped in **load order**
under a token budget) produced two empirically painful failures (`two-stage-
retrieval-DESIGN.md`, IMPL-PLAN L2/L3): high-recall/low-precision selection, and —
the **Stark-FQDN incident** — the injection budget dropping the *newest, corrected*
entry because order was storage order, not relevance. mykb's prescribed fix is
**two-stage retrieval**: Stage 1 = BM25/FTS5 candidate set (top-`k`), Stage 2 = a
pluggable `EntryReranker` (Noop / Heuristic / opt-in Embedding); LLM-rerank excluded
(latency on the always-on injection path).

Two facts reshape this for vtfkb:

1. **The per-project tier is flat and small** (D2e — no areas; tens–low-hundreds of
   entries). At that scale, Stage-1 *candidate narrowing* (the recall optimization)
   matters little — you can score the whole brain cheaply. The **load-bearing half
   is Stage 2**: ordering entries by relevance + freshness + trust *before* the
   budget cut, so the corrected/operator/fresh entry is never dropped.
2. **vtfkb has the ADR-0011 envelope (validity, derived trust) from schema v1.**
   mykb defaulted to `Noop` only because envelope-v2 hadn't shipped. vtfkb can make
   the envelope drive selection from day one.

There is also a separation-of-concerns risk to pin down: the ADR-0005 injection
**filter** is a *hard gate* (exclude superseded/deprecated/archive, and — per
ADR-0011 — `valid_until < today`). A reranker is a *soft sort*. They must not
duplicate exclusion logic.

## Decision

Adopt a **pluggable two-stage retrieval pipeline as the architecture**, but
right-size it for the per-project tier:

1. **`EntryReranker` interface** (`rerank(signal, candidates) → ordered`) with
   `NoopReranker`, `HeuristicReranker`, and a **stubbed** `EmbeddingReranker`.
2. **Stage 2 Heuristic reranker is the v1 deliverable and the default.** Pure-local
   (no native dep, no model). It applies **soft** signals over the survivors of the
   ADR-0005 filter: boost derived `operator` trust (ADR-0011), recency boost
   (newer `updated` / closer `valid_from`), patterns + gotchas first (L3 tiered
   render). It performs **no hard exclusion** — that is the ADR-0005 filter's job.
3. **Stage 1 candidate-narrowing is built behind the same pipeline but is a
   pass-through at v1's flat/small scale**: the candidate set is "all non-archived
   entries in the project brain," scored in-process. FTS5/BM25 candidate-narrowing
   activates only when a brain exceeds a configurable `candidate_k` threshold
   (default high, e.g. 200 → "narrow only when large"). This is consistent with
   ADR-0013 (no native dep at v1 scale).
4. **Embedding reranker = stubbed interface, deferred.** It couples to the native-
   dep / model-endpoint cost (ADR-0013), adds a model dependency on the always-on
   path, and offers low marginal precision over BM25+Heuristic for a small corpus.
   The interface stays so it slots in without rework (future large/global tier).

## Consequences

- **+** Ships the *value* (freshness/trust-aware ordering — the Stark-FQDN fix) and
  makes ADR-0011's fields earn their place, without the premature complexity of
  candidate-narrowing a small corpus doesn't need.
- **+** Clean Driver/Brake separation: ADR-0005 filter = hard gate; reranker = soft
  sort. No duplicated exclusion logic.
- **+** Zero native dependency in v1 (Heuristic is pure-local) — consistent with
  ADR-0013's deploy-everywhere goal.
- **+** The pipeline interface is cheap insurance against mykb's L2 retrofit debt;
  Stage-1 narrowing and Embedding rerank slot in later behind it.
- **−** A `candidate_k` threshold and a (later) switch to FTS5-candidate at scale is
  deferred work — accepted, because v1 corpora don't reach it.
- **Neutral:** `NoopReranker` remains as the interface identity/baseline and a test
  fixture.

## Alternatives Considered

- **Full mykb parity — ship all three rerankers incl. Embedding, BM25-candidate
  always on.** Rejected: over-invests for a flat small per-project corpus, couples
  v1 to the native-dep + model-endpoint cost (ADR-0013), and adds latency risk to
  the always-on injection path.
- **Single-stage, no reranker for now.** Rejected: re-incurs mykb's L2/L3 debt and
  leaves ADR-0011's validity/trust fields unused at selection time — i.e. ships the
  envelope without the mechanism that makes it fix the Stark-FQDN class.
- **Reranker performs the stale exclusion too.** Rejected: duplicates the ADR-0005
  filter and muddies the Brake-vs-ordering separation; a missed sync between the two
  would silently re-admit stale entries.
