---
type: Decision
title: "ADR-0016: Explicit search is relevance-primary; the EmbeddingReranker is un-deferred to Planned-pending-verification (amends ADR-0012)"
description: "Explicit search is relevance-primary; EmbeddingReranker un-deferred to Planned-pending-verification (amends ADR-0012)"
status: "Accepted — Amended by ADR-0017,"
timestamp: 2026-06-06
---

# ADR-0016: Explicit search is relevance-primary; the EmbeddingReranker is un-deferred to Planned-pending-verification (amends ADR-0012)

- **Status:** Accepted — Amended by [ADR-0017](ADR-0017-search-relevance-floor.md),
  [ADR-0018](ADR-0018-honest-no-match-contract.md)
- **Date:** 2026-06-06
- **Deciders:** operator + Claude
- **Amends:** [ADR-0012](ADR-0012-two-stage-retrieval.md) — does **not** supersede it;
  0012's two-stage architecture and Heuristic-default-for-injection decisions stand.
  Only the search-ranking gap and the embedding deferral are revised.

## Context

ADR-0012 adopted a pluggable two-stage retrieval pipeline, shipped the **Heuristic
reranker** as the v1 default, and left the **EmbeddingReranker** stubbed + deferred.
Its entire framing is the always-on **injection** path (the Stark-FQDN budget-cut):
the Heuristic reranker orders by derived trust + recency + type tier, *deliberately
with no text-relevance term* — correct when there is no query.

A live dogfood turn (devops-kb spike, 2026-06-06; Claude Code, headless, run twice
against a real **1347-entry** brain) exercised the substrate end-to-end and produced
two empirical findings ADR-0012 did not anticipate. Both were **source-confirmed and
reproduced** by replaying the agent's exact queries through the compiled pipeline.

1. **Explicit text search was never given a ranking of its own.** `read.query()`
   reused the *injection* Heuristic reranker for `kb_search`, so the Stage-1
   relevance score was computed and then **discarded** — results re-sorted by
   type → trust → recency. A correctly-retrieved gotcha (Stage-1 relevance rank #2)
   was buried to **~rank 90** and excluded by the caller's `limit`. The agent gave a
   confident **wrong** answer to a question the brain could answer and asserted "no
   recorded entry." The injection reranker is right for injection (no query) and
   wrong for search (explicit query → relevance must dominate). ADR-0012 conflated
   the two because its mental model was injection-only.

2. **Lexical-only matching is phrasing-fragile at non-trivial scale.** The agent
   phrased "hanging silent" where the entry said "hangs silently"; with no stemming
   the term scored ~0. This is the synonym/paraphrase gap that BM25/Heuristic
   cannot close and embeddings are designed to. ADR-0012 deferred the
   EmbeddingReranker citing *"low marginal precision over BM25+Heuristic for a small
   corpus"* — but 1347 entries is not small, and the failure was **paraphrase**, not
   precision-at-the-margin.

## Decision

This ADR amends ADR-0012. Three points:

1. **Explicit text search ranks relevance-primary.** When `query()` carries a text
   term, the Stage-1 relevance score is the **primary** sort key and the Heuristic
   comparator (type/trust/recency) is only the **tiebreak** among equally-relevant
   entries. Without a text term (listing + the injection bundle), the pure Heuristic
   order stands. *Already implemented and tested* (vfkb `2acad3e`); this ADR records
   the decision the live turn forced. The ADR-0005 injection filter (hard gate) is
   unchanged.

2. **Light lexical stemming** on both query and indexed tokens (suffix-stripping —
   `ing/ed/ly/es/s`, min stem 3; *not* a full Porter stemmer) so inflected query
   terms match stored wording. *Implemented and tested* (`f28f107`). A Layer-2
   **stopgap**, not a substitute for semantics.

3. **The EmbeddingReranker is promoted `deferred` → `Planned — pending
   verification`.** The 0012 deferral rationale is weakened by the live evidence, but
   the cheaper lexical fixes (1 + 2) **may already** achieve first-query recall at
   scale — unverified (replay shows the agent's first natural query moved rank
   22 → 4, but no live agent has been *observed* answering correctly). Therefore:
   - **Gate G1 (cheap, first):** a live verification (rebuilt container, the recall
     scenario) to observe whether relevance-primary + stemming already surfaces the
     right entry on the agent's first natural query.
   - **If recall remains phrasing-fragile after G1**, the EmbeddingReranker becomes
     the **next retrieval milestone**, built behind ADR-0012's existing pluggable
     interface and honoring **ADR-0013**: embeddings must be an *optional,
     auto-detected, graceful-degrade* backend (local model or opt-in endpoint),
     **never** a load-bearing dependency on the always-on injection path.
   - **If G1 shows recall is adequate**, embeddings stay deferred as a robustness
     enhancement and the gate result is recorded so the deferral is evidence-backed.

## Consequences

- **+** Closes the search-vs-injection conflation: two ranking jobs, two orderings,
  one shared tiebreak comparator. Injection behaviour (ADR-0012/0005) untouched.
- **+** Converts a silent "deferred" into an evidence-driven, **gated** decision —
  the embedding build is triggered by an observed failure + a verification, not by
  speculation, and not skipped by assumption.
- **+** Preserves ADR-0013's deploy-everywhere invariant: any embedding backend
  stays optional / graceful-degrade.
- **−** Adds one live-verification gate before embedding work. Accepted — far cheaper
  than building a native-dep reranker the lexical fixes may have made unnecessary.
- **−** Stemming is naive (`running`/`runs` unresolved). Accepted as a stopgap;
  superseded if embeddings land.
- **Neutral:** ADR-0012 stays **Accepted**, annotated *"Amended by ADR-0016."*
  This ADR also establishes **"Amended by ADR-XXXX"** as a sanctioned status marker
  in the ADR log (README rules + lifecycle) — a *refinement* pointer distinct from
  `Superseded by` (replacement), for when an ADR still holds but its evidence or
  scope changed.

## Alternatives Considered

- **Edit ADR-0012 in place.** Rejected — ADR-0001 immutability. A new amending ADR
  preserves the history: the deferral *was* correct under its stated assumptions; the
  **evidence** is what changed, and that belongs in a new record.
- **Un-defer and build embeddings now (no gate).** Rejected — over-commits to a
  native-dep/model build before verifying the shipped lexical fixes are insufficient;
  violates "verify the cheap thing first" and risks ADR-0013's deploy-everywhere goal.
- **Two separate ADRs (search-ranking; embedding-revisit).** Defensible under
  "one decision per file" (ADR-0001). Folded here because both stem from a single
  piece of evidence (one live turn) and one subsystem; split on request.
- **Leave search on the Heuristic reranker and just raise the `limit`.** Rejected — a
  larger limit returns more of a *mis-ordered* list; the agent reads the top first
  and relevance still never enters the order. Treats the symptom (the cut), not the
  cause (the discard).

## Related

[ADR-0012](ADR-0012-two-stage-retrieval.md) (two-stage retrieval — amended here),
[ADR-0005](ADR-0005-injection-filters-stale.md) (injection filter — the hard gate,
unchanged), [ADR-0011](ADR-0011-envelope-richness.md) (envelope: derived
trust/validity feeding the Heuristic), [ADR-0013](ADR-0013-no-hard-native-dep.md)
(no hard native dep — constrains any embedding backend),
[ADR-0015](ADR-0015-cross-harness-auto-layer.md) (the injection path).
Evidence: vfkb commits `2acad3e`, `f28f107`; devops-kb live turn 2026-06-06.
