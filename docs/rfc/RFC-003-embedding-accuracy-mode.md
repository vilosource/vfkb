---
type: RFC
title: "RFC-003: The EmbeddingReranker ships as an opt-in \"accuracy mode\" search tier"
description: "The EmbeddingReranker ships as an opt-in \"accuracy mode\" search tier"
status: "Proposed"
timestamp: 2026-06-15
---

# RFC-003: The EmbeddingReranker ships as an opt-in "accuracy mode" search tier

- **Status:** Proposed
- **Date:** 2026-06-15
- **Deciders:** operator + Claude (proposed — comment period open)
- **Refines (on acceptance):** [ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md)
  decision pt 3 (the *"Planned — pending verification"* embedding work). Strictly bounded
  by [ADR-0013](../adr/ADR-0013-no-hard-native-dep.md).

## Context

[ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md) promoted the
EmbeddingReranker from `deferred` to *"Planned — pending verification"*, gated on **G1**
(a live recall check). Per STATUS-AND-ROADMAP, **G1 passed** — relevance-primary +
stemming surfaced the right entry on the agent's first natural query — so embeddings stay
deferred "as a robustness enhancement." But ADR-0016 names the residual risk itself:
lexical search is **phrasing-fragile** (the live turn's query-2, "proxy"-biased, still
missed), and **G1 is n=1**. The unresolved question is therefore **not whether** to build
embeddings but **in what shape** — such that it honours ADR-0013 (no hard native dep;
nothing load-bearing on the always-on injection path).

Ground truth in the code: there is **no literal `EntryReranker` class**. ADR-0012's
"pluggable reranker" is implemented as `selectIndex()` (`src/index-store.ts` — always
returns `InMemoryIndex` today) plus the Stage-1/Stage-2 split threaded through
`read.query` (`src/read.ts:48,79`). That `selectIndex()` plug-point and the candidate→sort
split **are** the seam; the EmbeddingReranker fills the stub behind them.

**External corroboration — the shape is already field-proven.** AnythingLLM ships exactly
this as a **"Search Preference"** setting (LanceDB): a fast semantic-similarity **default**
and an opt-in **"Accuracy Optimized"** mode that "searches more chunks, then reranks top
results — slightly slower but will yield better results in almost all cases," at an
explicit **+100–500ms** cost, gracefully absent when the backend doesn't support it. That
is precisely ADR-0013's *optional / auto-detected / graceful-degrade* pattern, validated
in a shipping product.

## Decision

1. **Opt-in accuracy tier, never a default, never on injection.** When built, the
   EmbeddingReranker is an **opt-in** mode on explicit search (`kb_search` / `read.query`
   via a flag). The lexical relevance-primary path (ADR-0016) stays the **default** for
   search, and the **only** path for the always-on injection bundle. Semantic rerank is
   **forbidden** on the injection / per-turn-delta path.
2. **Fills the existing seam.** It slots behind `selectIndex()` + the Stage-1/Stage-2
   split — as a semantic rerank of the lexical candidate set (a "Stage-1.5"), or a
   parallel semantic candidate source unioned with the lexical set before Stage-2. No new
   architecture; it occupies the slot ADR-0012 reserved.
3. **ADR-0013 strict.** Auto-detected, graceful-degrade — a local model or an opt-in
   endpoint; backend absent → accuracy mode silently falls back to lexical; the engine
   still loads and operates with **zero native modules compiled**. No native compile on
   the injection path, ever.
4. **It supplies the normalized floor RFC-001 lacked.** A semantic backend yields a
   normalized similarity score (`0–1`), which is the natural relevance floor RFC-001 had
   to approximate with a term-overlap ratio. So the tiers **compose**: lexical ratio floor
   by default, cosine floor in accuracy mode; and RFC-002's `no_match` becomes sharper.
5. **Evidence-gated build trigger.** The decision to *build* remains gated: a **second**
   live phrasing-robustness miss observed in a real turn, or an explicit operator request
   — not speculation. ADR-0016's G1-passed deferral stands until that trigger. This RFC
   decides the **shape now** so that when the trigger fires, the build has no open design
   question ("runbook complete before execute").

## Consequences

- **+** Resolves ADR-0016's open "in what shape" without committing to a default ADR-0013
  forbids. The product's core promise (phrasing-robust recall) gets its real fix as an
  *escalation*; the cheap lexical path stays the everyday default.
- **+** Composes cleanly with RFC-001 (normalized floor) and RFC-002 (sharper honest
  empty).
- **+** The +100–500ms cost lands only on opt-in accuracy queries — never on the
  latency-sensitive injection path, exactly where the latency is tolerable.
- **−** Two retrieval code paths (lexical default + semantic accuracy) to maintain.
  Accepted — the seam already exists (ADR-0012); this fills a reserved stub rather than
  adding a dimension.
- **−** An opt-in mode the agent must know to request. Mitigated by the RFC-002 contract /
  tool-description guidance — e.g. "if a lexical search returns `no_match`, retry in
  accuracy mode."
- **Neutral:** ADR-0012's pipeline and ADR-0016's lexical default both stand unchanged;
  this fills the slot they reserved.

## Alternatives Considered

- **Make embeddings the default search ranker.** Rejected — risks a model/native-dep on
  the hot path (ADR-0013) and over-commits before the n=1 G1 result is ever challenged.
- **Put semantic rerank on the injection path.** Rejected hard — ADR-0013/ADR-0015: the
  always-on bundle and per-turn delta must never be load-bearing on a model; the budgeted
  render is latency-sensitive and runs every turn (Pi).
- **Keep it deferred with no shape decided (status quo).** Rejected — ADR-0016 left "what
  shape" open; deciding it cheaply now (as a proposal) closes the design gap so the build,
  when triggered, is mechanical. Leaving it open invites discovering the design defect
  mid-build.
- **A reranking API call to an LLM (LLM-rerank).** Rejected — ADR-0012 already excluded
  LLM-rerank for latency; an embedding similarity is the cheaper, cacheable mechanism.

## Related

[ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md) (refined),
[ADR-0012](../adr/ADR-0012-two-stage-retrieval.md) (the reserved seam),
[ADR-0013](../adr/ADR-0013-no-hard-native-dep.md) (the binding constraint),
[ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md) (the injection path this must stay
off), [RFC-001](RFC-001-search-relevance-floor.md) /
[RFC-002](RFC-002-honest-no-match-contract.md) (compose with the normalized signal). Code:
`src/index-store.ts` (`selectIndex`), `src/read.ts:48-84`. Evidence: AnythingLLM
**"Accuracy Optimized" Search Preference** (+100–500ms, graceful-degrade); devops-kb
2026-06-06 query-2 phrasing miss.
