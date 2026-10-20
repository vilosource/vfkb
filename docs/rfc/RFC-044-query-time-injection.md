---
type: RFC
title: "RFC-044: Query-time injection needs a ranker that can rank — R1 rides on S1's BM25"
description: "v3 theme R1. Probes on 2026-10-20 found the delivery half sound: a UserPromptSubmit hook's injected text reaches the agent (3/3 in both JSON and plain form, contrast 0/3) when it reads as project knowledge, not as a secret. The selection half is not: vfkb's stage-1 index counts token occurrences with no IDF, no length normalisation and no stopwords, so a chatty prompt matches nearly every entry, the long handoffs win, and the entries a prompt is about rank 78th-320th on the real index. On two labelled cases, BM25 alone still misses one; BM25 plus stopword pruning ranks them 1st-11th. This RFC proposes R1 in two steps: first S1's amended first resort (BM25 in InMemoryIndex) plus query-term pruning, behind an offline labelled eval; then the UserPromptSubmit injection with dedup, a budget, harness-turn skipping and knowledge framing. Un-gating S1 is put to the operator."
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
entry by the number of its tokens that match any query term. Its own comment says "NOT BM25 (no
IDF, no length normalization)", and it has **no stopword list**. Measured with the
reproducible `measure.mjs`, on the brain at `9095dc4` (524 live entries), with eight real
operator prompts:

- **A chatty prompt matches nearly everything.** The two headline prompts matched 446 and
  450 entries; five others matched 457–473. A terse prompt ("continue autonomously")
  matched 13.
- **The RFC-001 floor fires but cannot help.** It drops 93–238 matches, but it never
  reorders, so it cannot change what reaches the top.
- **The top three hits were 4–7.7k-character handoffs for 7 of 8 prompts.**
- **The entries a prompt is about rank far down.** These are 1-based ranks on the real
  index, which sorts by score and then by newest `updated`. Scores tie heavily, so each rank
  sits in a band:
  - "we were going to use JEV as well were we not?": 78th, 102nd and 320th (bands 77–87,
    100–114 and 312–357);
  - "what is in our roadmap?": 309th and 310th (band 263–310).

  Anything past 200 never reaches `kb_search` at all.

**Which fix?** The same two cases under alternative scorers. These are prototypes over the
real tokenizer and stemmer, with a generic stopword list not tuned to these prompts, and
they break ties by file order:

| Scorer | Jev case | Roadmap case |
|---|---|---|
| current (the real index) | 78, 102, 320 | 309, 310 |
| count + stopwords | 6, 7, 23 | 3, 8 |
| BM25 | 6, 15, 17 | **21, 27** |
| **BM25 + stopwords** | **4, 7, 11** | **1, 2** |

**BM25 alone is not enough; stopword pruning is the larger single factor; the two together
are best.** That is two labelled cases, so it is direction, not tuning. The eval in step 1
decides.

**The roadmap already names the fix and gates it.** S1's amended first resort is "BM25
scoring inside `InMemoryIndex` (stdlib, deterministic, zero-dep)". Its build trigger is "a
2nd observed live phrasing-robustness miss **or** an explicit operator request". The PRD
anticipated this: R1 "partially un-gates S1 … S1's trigger should be re-read rather than
assumed". This RFC is that re-read. Embeddings, S1's second resort, stay **forbidden on the
injection path**, and nothing here changes that.

## Decision (proposed)

R1 is built in **two steps**, and step 2 does not start until step 1 has met its bar.

### Step 1 — BM25 in `InMemoryIndex` (S1's first resort), gated by an offline eval

1. **Replace stage-1 occurrence counting with BM25 plus query-term pruning.**
   - **BM25:** per-term IDF over the live brain, and document-length normalisation, with
     standard `k1`/`b` defaults, stdlib only.
   - **Pruning:** a stopword list applied to the query, and optionally an IDF cutoff that
     drops terms present in most entries.
   - **Unchanged:** stage 2, the ADR-0012 heuristic reranker.
   - **It changes `kb_search` and the CLI `search` for everyone,** not just R1. That is
     intended, and it is why the eval below runs on the explicit-search path too.
2. **The bar is an offline labelled retrieval eval,** committed as a deterministic test:
   - a set of real prompts, each labelled with the entry ids it is *about*, drawn from this
     repo's brain and session history, with at least 25 prompts;
   - a **pinned brain snapshot**, because entries that *quote* the eval's prompts would
     otherwise rank first for them (observed: this RFC's own probe gotchas do). The snapshot
     must predate any such entry, or exclude it;
   - a metric of **recall@5 and MRR**, measured on the current index and on BM25.

   The eval must be **observed failing on the current index** (ADR-0070): the measurement
   above says it will. It gates step 2 by reaching a threshold the operator sets when
   ratifying (see Q2).
3. **The relevance floor is revisited** under BM25 scores. RFC-001's term-ratio floor
   removes candidates but cannot reorder them, and for chatty prompts most of the ranking's
   top survives it. Step 1 proposes a score-based floor, calibrated on the eval set, not
   guessed.

### Step 2 — inject at `UserPromptSubmit`

4. **A new hook, `hook user-prompt-submit`,** queries BM25 with the prompt text and injects
   the top hits that clear the floor.
   - The budget is far below the session-start 10k, proposed at **≤1,500 chars and ≤3
     entries per prompt**.
   - It emits `hookSpecificOutput.additionalContext`.
   - **Long entries are truncated, not skipped,** to their first ~600 characters with an
     elision marker. Skipping them would make a long relevant entry impossible to recall.
   - **Dedup is per session.** An entry injected once is not re-injected until a compaction
     resets the set.
   - It **fails open**: no output on any error, like every other hook.
5. **Dedup** against everything already in context this session.
   - The Claude face's `hook session-start` must call `SessionState.markInjected` with the
     **ids it actually rendered**. Today `renderResume` returns only text, so this needs an
     API change: return the rendered ids, or render from an id list.
   - **Do not copy the Pi face's call.** It marks `currentInjectableIds()`, which is every
     injectable entry (~470), not the rendered bundle. On the Claude face that would dedup
     away everything, and R1 would inject nothing.
   - Per-prompt injections are marked too, so an entry arrives once per session.
   - A compaction (ADR-0077) re-emits the bundle, so the injected set is **reset on
     `source: "compact"`**: what the summariser dropped may be needed again.
6. **Skip turns nobody typed.** `UserPromptSubmit` also fires for harness-generated turn
   starts. Harness survey §7a recorded the second `prompt` as a `<task-notification>`
   envelope. The hook skips prompts that are harness envelopes; whether that prefix is a
   reliable discriminator across turn kinds is probed first (Q4).
7. **Frame as knowledge, never as instruction:** a labelled block,
   `<vfkb-recall project="…">` with `[type trust] text` lines, and no imperative wording.
   That is the probe's lesson; credentials and instruction-shaped text are distrusted.
8. **Never displace the pins.** The Constitution and the handoff pin are session-start's job
   (ADR-0008/0049). Per-prompt recall never re-injects them, since dedup already covers
   them, and never pushes them out.

### The proof (ADR-0050)

An L4, `query-time-recall`, that **can fail on selection as well as delivery**. It inherits
ADR-0078's validity discipline and ADR-0079's wording rule.

- **Brain:** a large seeded brain where the needed entry, carrying a random sentinel, is
  **below the session-start budget cut**. That is the reproduced 2026-07-09 failure the PRD
  names. It is surrounded by **long distractor entries that share the prompt's common
  words**, which is the measured failure shape.
- **Three arms, each a prompt that is about the entry:**
  1. **recall:** the hook on, with the step-1 ranker. Must hit at least 2/3 valid.
  2. **ranker contrast:** the hook on, with the **current** ranker. Must be **red**: the
     distractors win, and the sentinel is not named. This is the arm that proves
     *selection* matters. Without it, the proof shows only delivery, which the probe
     already showed.
  3. **delivery contrast:** the hook off. Must be 0 hits.
- **The seed must be hard for both rankers.**
  - The long common-word distractors exist so the *old* ranker loses.
  - The brain also needs **hard negatives**: entries that share the prompt's *content* terms
    but are not the target. Without them the new ranker faces no adversary, and the recall
    arm could only fail on delivery or on the model.
- **The ranker contrast is a content assertion, and partly deterministic** (ADR-0051 §3).
  - It is red when the `hook_response` shows an injection happened **and** its injected
    entry ids lack the target.
  - A missing injection (hook error, fail-open, dedup, budget) makes the trial **invalid**,
    not a pass.
  - Because the ranking itself is deterministic, the ranker comparison also ships as a unit
    test over the same seed. The LLM arm adds receipt, not selection.
- **A green ranker contrast means the seed is too easy, not that the proof passed.** The
  scenario marks the run invalid and the seed must be hardened.
- **Validity:**
  - no tools;
  - the answer engages: it names the sentinel or says NONE;
  - an injection is observed in the `hook_response` in the hook-on arms; a missing
    injection makes the trial invalid. In the **recall** arm, an injection that **lacks the
    target's id is a red trial, not an invalid one**. That is what lets the recall arm fail
    on selection;
  - **anti-luck:** the entry is not in the session-start bundle. Otherwise the contrasts
    pass for the wrong reason.
- **Wording:** knowledge framing, and scope rather than naming what to hide.

## Consequences

- **`kb_search` gets better for everyone in step 1,** whether or not step 2 ships. The eval
  is the guard against making it worse.
- **Stale handoffs stay injectable.** Old handoffs say "supersedes X" in their text but
  carry no supersession edge, so a better ranker will still surface them. Tidying that is
  R7's job (curation), and R1 does not depend on it.
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
- **Stopword pruning on the current scorer, without BM25.** This is not rejected outright:
  it does nearly as well on the two measured cases. Its prototype ranks are 6, 7, 23 and 3, 8
  with file-order tie-breaking, and 5, 6, 14 and 7, 15 with the real index's tie-break, so the
  exact numbers move inside score ties. But it keeps
  rewarding long entries for repeated terms. BM25 plus stopwords is better on both cases,
  and the eval compares all of them before step 1 commits to one.

## Open questions for the operator

- **Q1. Un-gate S1's first resort (BM25) now, for R1?** This is an explicit operator request
  under S1's own trigger. It is the precondition for everything else here.
- **Q2. The eval bar.** The proposal is that step 2 starts only when BM25 reaches **recall@5
  ≥ 0.6** on the labelled set and beats the current index on MRR. Or set your own number.
- **Q3. On by default, or opt-in** (`VFKB_RECALL=1`) for the first release?
- **Q4. Probe first, or design now?** Harness survey §7a already shows a
  `<task-notification>` envelope as a harness-generated `prompt`. What is still unknown is
  whether that prefix reliably separates harness turns from typed ones across turn kinds.
  The proposal is to probe that before step 2 is designed.
