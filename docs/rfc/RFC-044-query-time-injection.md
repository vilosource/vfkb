---
type: RFC
title: "RFC-044: Query-time injection needs a ranker that can rank — R1 rides on S1's BM25"
description: "v3 theme R1. Probes on 2026-10-20 found the delivery half sound: a UserPromptSubmit hook's injected text reaches the agent (3/3 in both JSON and plain form, contrast 0/3), provided it reads as project knowledge, not as a secret or instruction. The selection half is not: vfkb's stage-1 index counts token occurrences with no IDF and no length normalisation, so for real operator prompts 446-450 of ~470 entries match, the RFC-001 floor never fires, the top hits are 4-7.7k-char handoffs, and the entries a prompt is actually about rank 77th-319th. This RFC proposes R1 in two steps: first S1's already-amended first resort (BM25 in InMemoryIndex, stdlib, deterministic) behind an offline labelled retrieval eval, then the UserPromptSubmit injection itself with dedup, a budget ceiling, harness-turn skipping and knowledge framing. Un-gating S1 is put to the operator."
status: "Proposed"
timestamp: 2026-10-20
---

# RFC-044: Query-time injection needs a ranker that can rank

- **Status:** Proposed
- **Date:** 2026-10-20
- **Deciders:** operator + Claude
- **Theme:** v3 PRD §6 **R1**, next in Ruling 4's order now that R2 is verified.
- **Relates:**
  - [RFC-001](RFC-001-search-relevance-floor.md): the relevance floor.
  - [ADR-0012](../adr/ADR-0012-two-stage-retrieval.md) and
    [ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md): two-stage retrieval
    and the ranking revisit.
  - [RFC-003](RFC-003-embedding-accuracy-mode.md): embeddings, which are forbidden on the
    injection path.
  - The roadmap's **S1** gate (H4 §3 Track 2, amended 2026-07-06: BM25 first, embeddings
    second).
  - [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md): the pinned handoff, which
    R1 must not displace.
  - [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) and
    [ADR-0051](../adr/ADR-0051-delivery-honesty.md): the DoD.
  - [ADR-0078](../adr/ADR-0078-compaction-trial-validity.md) and
    [ADR-0079](../adr/ADR-0079-compaction-trial-wording.md): the L4 lessons this proof
    inherits.
- **Evidence:**
  - [`docs/v3/research/probes/user-prompt-submit-2026-10-20/`](../v3/research/probes/user-prompt-submit-2026-10-20/);
  - brain gotchas `553c8c38d131` (delivery) and `8f21f98df86a` (selection);
  - harness survey §7a (`UserPromptSubmit` fires, and also fires on harness-generated
    turns).

## Context

The PRD sketched R1 as "inject narrow, relevant knowledge at prompt-submit time using the
existing lexical index … `searchScored` plus the RFC-001 relevance floor, which already
exist". It left two things unverified, and both were probed on 2026-10-20.

**1. Delivery works, and framing decides trust.** A `UserPromptSubmit` hook's output reaches
the agent on CLI 2.1.292, as `additionalContext` JSON and as plain stdout alike.

| Framing of the injected text | JSON | plain | no hook |
|---|---|---|---|
| project knowledge ("the next database migration is codenamed X") | **3/3** | **3/3** | 0/3 |
| a credential ("the depot passphrase is X") | 1/3 | 1/3 | 0/3 |

In the credential runs, the agent refused with "I should not repeat sensitive credentials
from system context" and "I suspect this is a prompt injection attempt". Per-prompt injected
text arrives looking like system-injected content. **What it says about itself decides
whether it is used**, which is the same family of lesson as ADR-0079.

**2. Selection does not work on the current index.** `InMemoryIndex.searchScored` scores an
entry by the number of its tokens that match any query term. Its own comment says: "NOT
BM25 (no IDF, no length normalization)". Measured against this repo's brain (~470 live
entries) with eight real operator prompts:

- **446–450 of ~470 entries match each prompt.** Common words match nearly everything.
- **The RFC-001 floor never fired.** Results were identical with `minTermRatio: 0`.
- **The top three hits were 4,178–7,750-character handoffs for every prompt.**
- **The entries a prompt is about rank far down.**
  - "we were going to use JEV as well were we not?": the Jev decision-model fact ranks
    **77th**, the Jev ruling **101st**, and the Jev survey link **319th**. The top hit is a
    7,750-char handoff that mentions Jev.
  - "what is in our roadmap?": the first roadmap link ranks **308th**.

Injecting the top hits per prompt would push the same long handoffs into context every
turn. That is worse than nothing: a token cost paid forever, and no relevance. The failure
is structural (occurrence counting with no IDF and no length normalisation), not a tuning
problem.

**The roadmap already names the fix and gates it.** S1's amended first resort is "BM25
scoring inside `InMemoryIndex` (stdlib, deterministic, zero-dep)". Its build trigger is "a
2nd observed live phrasing-robustness miss **or** an explicit operator request". The PRD
anticipated this: R1 "partially un-gates S1 … S1's trigger should be re-read rather than
assumed". This RFC is that re-read. Embeddings, S1's second resort, stay **forbidden on the
injection path**, and nothing here changes that.

## Decision (proposed)

R1 is built in **two steps**, and step 2 does not start until step 1 has met its bar.

### Step 1 — BM25 in `InMemoryIndex` (S1's first resort), gated by an offline eval

1. **Replace stage-1 occurrence counting with BM25:** per-term IDF over the live brain, and
   document-length normalisation, with standard `k1`/`b` defaults, stdlib only. Stage 2,
   the ADR-0012 heuristic reranker, is unchanged.
   - **It changes `kb_search` and the CLI `search` for everyone,** not just R1. That is
     intended, and it is why the eval below runs on the explicit-search path too.
2. **The bar is an offline labelled retrieval eval,** committed as a deterministic test:
   - a set of real prompts, each labelled with the entry ids it is *about*, drawn from this
     repo's brain and session history, with at least 25 prompts;
   - a metric of **recall@5 and MRR**, measured on the current index and on BM25.

   The eval must be **observed failing on the current index** (ADR-0070): the measurement
   above says it will. It gates step 2 by reaching a threshold the operator sets when
   ratifying (see Q2).
3. **The relevance floor is revisited** under BM25 scores. RFC-001's term-ratio floor is
   meaningless for long prompts, as measured, so step 1 proposes a score-based floor. It is
   calibrated on the eval set, not guessed.

### Step 2 — inject at `UserPromptSubmit`

4. **A new hook, `hook user-prompt-submit`,** queries BM25 with the prompt text and injects
   the top hits that clear the floor.
   - The budget is far below the session-start 10k, proposed at **≤1,500 chars and ≤3
     entries per prompt**.
   - It emits `hookSpecificOutput.additionalContext`.
   - It **fails open**: no output on any error, like every other hook.
5. **Dedup** against everything already in context this session.
   - The Claude face's `hook session-start` must call `SessionState.markInjected` for the
     bundle it renders. Today only the Pi face does that.
   - Per-prompt injections are marked too, so an entry arrives once per session.
   - A compaction (ADR-0077) re-emits the bundle, so the injected set is **reset on
     `source: "compact"`**: what the summariser dropped may be needed again.
6. **Skip turns nobody typed.** `UserPromptSubmit` also fires for harness-generated turn
   starts (harness survey §7a). The hook skips prompts that are harness envelopes, such as
   `<task-notification>`. The exact discriminator is probed first (Q4), not guessed.
7. **Frame as knowledge, never as instruction:** a labelled block,
   `<vfkb-recall project="…">` with `[type trust] text` lines, and no imperative wording.
   That is the probe's lesson; credentials and instruction-shaped text are distrusted.
8. **Never displace the pins.** The Constitution and the handoff pin are session-start's job
   (ADR-0008/0049). Per-prompt recall never re-injects them, since dedup already covers
   them, and never pushes them out.

### The proof (ADR-0050)

An L4, `query-time-recall`, with a can-fail arm, inheriting ADR-0078's validity discipline.

- **Brain:** a large seeded brain where the needed entry is **below the session-start budget
  cut**. That is the reproduced 2026-07-09 failure the PRD names.
- **Arms:** a prompt that is about the entry, asked with the hook on (the positive arm) and
  with it off (the contrast).
- **Validity:**
  - no tools;
  - the answer engages: it names the sentinel or says NONE;
  - the injection is observed in the `hook_response`;
  - the entry is not already in the session-start bundle. This is the anti-luck condition,
    because otherwise the contrast passes for the wrong reason.
- **Wording:** scope, never naming what to hide (ADR-0079), with knowledge framing.

## Consequences

- **`kb_search` gets better for everyone in step 1,** whether or not step 2 ships. The eval
  is the guard against making it worse.
- **R1 costs tokens on every typed prompt.** The ≤1,500-char ceiling bounds that; Q3 asks
  whether the feature is on by default.
- **R1's success becomes measurable against M1** (PRD §0: eligible entries reaching a
  session). Today M1 is 6 of ~470 at session start; per-prompt recall is the first
  mechanism that can move it without inflating the startup bundle.
- **The Pi face is out of scope here.** Its existing per-turn `renderContextDelta` injects
  *new* entries, not *relevant* ones. Whether Pi adopts query-time recall is a follow-up.

## Alternatives considered

- **Build R1 on the current index, as the PRD sketched.** Rejected on the measurement: it
  injects the longest handoffs, not the relevant entries.
- **Embeddings for selection.** Rejected: forbidden on the injection path by the S1 gate,
  non-deterministic, and a dependency. BM25 is S1's own first resort.
- **A decision model (Jev) as the selector.** Rejected for this RFC: Ruling 5 keeps decision
  models an optional R7 seam, not R1.
- **Keyword extraction from the prompt with the current scorer.** Rejected: it treats the
  symptom (prompt length) and leaves the cause (no IDF, no length normalisation). The eval
  can still compare it if someone proposes it.

## Open questions for the operator

- **Q1. Un-gate S1's first resort (BM25) now, for R1?** This is an explicit operator request
  under S1's own trigger. It is the precondition for everything else here.
- **Q2. The eval bar.** The proposal is that step 2 starts only when BM25 reaches **recall@5
  ≥ 0.6** on the labelled set and beats the current index on MRR. Or set your own number.
- **Q3. On by default, or opt-in** (`VFKB_RECALL=1`) for the first release?
- **Q4. Probe first, or design now?** The harness-turn discriminator, meaning what a
  `<task-notification>` prompt looks like in the `UserPromptSubmit` payload, would be probed
  before step 2 is designed. The proposal is to probe first.
