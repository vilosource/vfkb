---
type: Decision
title: "ADR-0080: Query-time injection rides on BM25 — S1's first resort is un-gated for R1 (accepts RFC-044)"
description: "Accepts RFC-044 (v3 theme R1) with the operator's answers to its four questions. Q1: S1's first resort (BM25 plus query-term pruning in InMemoryIndex) is UN-GATED now, by explicit operator request, as R1's precondition; embeddings stay forbidden on the injection path. Q2: step 2 starts only when the new ranker reaches recall@5 >= 0.6 and beats the current index on MRR, on a labelled eval of every real topical prompt in the history (about 22; at least 20) plus a no-recall set, against a pinned brain snapshot, observed failing on the current index first. Q3: query-time injection ships OPT-IN (VFKB_RECALL=1). Q4: the harness-turn discriminator is probed before step 2 is designed."
status: "Accepted"
timestamp: 2026-10-21
---

# ADR-0080: Query-time injection rides on BM25

- **Status:** Accepted (2026-10-21, operator ratification)
- **Build status:** nothing is built at acceptance. Progress is tracked in the v3 PRD §6 R1
  and the H4 §4 table.
- **Date:** 2026-10-21
- **Accepts:** [RFC-044](../rfc/RFC-044-query-time-injection.md), as written at `b179e39`.
  The RFC holds the probe evidence, the two-step design, the L4 and the alternatives. This
  ADR records the decision and the operator's four answers.
- **Changes the roadmap gate on S1:** H4 §3 Track 2's S1 entry. Its first resort is un-gated
  by explicit operator request. The second resort, RFC-003 embeddings, stays gated and stays
  forbidden on the injection path.
- **Relates:**
  - [RFC-001](../rfc/RFC-001-search-relevance-floor.md): the floor, to be revisited.
  - [ADR-0012](ADR-0012-two-stage-retrieval.md) and
    [ADR-0016](ADR-0016-search-ranking-and-embedding-revisit.md): two-stage retrieval.
  - [ADR-0049](ADR-0049-session-start-handoff-pinning.md): the pins R1 must not displace.
  - [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md) and
    [ADR-0051](ADR-0051-delivery-honesty.md): the DoD.
  - [ADR-0070](ADR-0070-guards-that-can-fail.md): guards are seen red.
  - [ADR-0078](ADR-0078-compaction-trial-validity.md) and
    [ADR-0079](ADR-0079-compaction-trial-wording.md): the L4 lessons the R1 proof inherits.

## Context

The R1 probes (RFC-044; `docs/v3/research/probes/user-prompt-submit-2026-10-20/`) found
two things.

**Delivery works.** `UserPromptSubmit` injection reaches the agent 3/3 when the text is
framed as project knowledge. Framed as a credential, the agent usually refuses it as a
prompt injection (2 of 3 times).

**Selection does not work on the current index.** Stage 1 counts token occurrences, with
no IDF, no length normalisation and no stopwords. For real operator prompts on the brain
at `9095dc4`, the entries a prompt is about rank 78th–320th on the real index. In a
prototype, BM25 plus stopword pruning ranks them 1st–11th, while plain BM25 still misses
one of the two cases.

## Decision

1. **Step 1: replace stage 1 with BM25 plus query-term pruning** in `InMemoryIndex`. The eval
   still compares the alternatives RFC-044 named (stopwords alone, plain BM25) and records
   them; BM25 plus pruning is the decided default unless the eval shows another clears the
   bar and BM25 plus pruning does not.
   - BM25 uses per-term IDF and length normalisation with standard `k1`/`b`, stdlib only.
   - Pruning is a generic stopword list on the query, optionally with an IDF cutoff.
   - Stage 2, the heuristic reranker, is unchanged. The RFC-001 floor is revisited: a
     score-based floor, calibrated on the eval, replaces it on the R1 path if the eval
     supports one.
   - **This changes `kb_search` and CLI `search` for everyone,** and that is intended.
2. **The step-1 bar (Q2), as a committed deterministic test:**
   - **The topical set** is every real topical operator prompt in the session history, about
     22 and at least 20, each labelled with the entry ids it is about. The operator ruled
     this on 2026-10-21, replacing the "at least 25" RFC-044 proposed: the real history does
     not contain 25 topical prompts, and inventing prompts would bias the set. The set grows
     as real prompts accumulate.
   - **The no-recall set** is the real non-topical prompts ("continue", "commit and push"…).
     For these, the right behaviour is to inject nothing above the floor, and the floor is
     calibrated against them.
   - **An addition of this ADR, not of RFC-044:** labels are written before the new ranker is
     run on the set, so the labelling cannot follow the ranker. Two cases were already
     ranked by a BM25 *prototype* during the probes: the Jev and roadmap prompts. Their
     relevance definitions were fixed before that run (ids picked by grep; roadmap links by
     type), so they stay in the set, flagged as such.
   - It runs against a pinned brain snapshot that predates any entry quoting the prompts,
     or excludes such entries.
   - It must be **observed failing on the current index** first.
   - It passes at **recall@5 ≥ 0.6 on the topical set, and beating the current index on
     MRR.**
   - Step 2 does not start until this passes.
3. **Step 2: inject at `UserPromptSubmit`,** as RFC-044 specifies:
   - a ≤1,500-char and ≤3-entry budget, with long entries truncated;
   - dedup against the **ids actually rendered** at session start, never Pi's
     every-injectable set, and reset on compaction;
   - skipping harness-generated turns;
   - knowledge framing;
   - failing open.
4. **Opt-in (Q3).** Injection runs only when `VFKB_RECALL=1`. Making it the default is a
   later decision, made on measured cost and benefit.
5. **Probe first (Q4).** Before step 2 is designed, a probe establishes what
   `UserPromptSubmit` prompts look like on harness-generated turns, across turn kinds.
6. **The proof** is RFC-044's three-arm `query-time-recall` L4: recall, ranker contrast and
   delivery contrast.
   - The seed has hard negatives, so the new ranker faces an adversary.
   - The ranker contrast is a content assertion on injected ids, and a missing injection is
     invalid.
   - A recall-arm injection that lacks the target is a red trial.
   - A green ranker contrast means the seed is too easy, and the run is invalid.
   - Per-prompt recall never re-injects or displaces the pinned Constitution and handoff
     (RFC-044 item 8; ADR-0008/0049).
   - Until the L4 is DEMONSTRATED, R1's status is *built, NOT yet verified*.

## Consequences

- **`kb_search` quality changes for every consumer** at step 1. The eval is the guard
  against regressions on the explicit-search path.
- **S1 is no longer wholly gated.** Its BM25 first resort is open. Its embedding second
  resort stays gated, and stays forbidden on the injection path.
- **Opt-in means the feature reaches no one by default.** Its value is measured before any
  default flip, against PRD M1.
