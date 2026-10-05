# Decision Models ("System One") and vfkb — October 2026

> **Research survey.** What the new *decision model* class is (TypeSafe **Jev**,
> OpenAI's **Decisions API**), measured against vfkb's actual retrieval, capture
> and curation seams, ending with ranked adoption candidates and an explicit
> non-candidate list. Prompted by an operator question on 2026-10-03.
> **Nothing here is decided or built** — no ADR, no RFC, no code; a proposal
> would be an RFC per [ADR-0007](../adr/ADR-0007-rfc-is-proposed-decision.md).
> Companion to [`agent-memory-landscape-2026-07.md`](agent-memory-landscape-2026-07.md),
> which surveyed memory *products*; this one examines a model *class* and where
> in vfkb it would attach.
>
> **Verification discipline.** Vendor docs and the HTTP API reference were
> fetched live on 2026-10-03; independent benchmarks and robustness audits were
> read the same day. Every substantive claim is tiered:
>
> | Marker | Means |
> |---|---|
> | **[vendor]** | TypeSafe's or OpenAI's own page — unverified by anyone else |
> | **[independent]** | a third-party audit, benchmark or reproduction |
> | **[secondary]** | press, blog or tracker reporting |
> | **[measured]** | measured in *this* repo at `8237fc4`, command or path given |
>
> **No decision-model API has been called from this repo.** Every cost, latency
> and accuracy figure below is someone else's measurement. That distinction is
> load-bearing: §10 makes an on-our-own-data calibration spike the precondition
> for everything, precisely because §2.3 shows the vendor's headline numbers do
> not transfer.

---

## 1. Verdict

1. **The category is real, cheap, and newly contested.** A decision model takes a
   *state* plus *typed questions* and returns typed values with probabilities —
   no prose, ever. Jev shipped 2026-09-15; OpenAI announced a competitor
   2026-09-29, two weeks later. Two vendors in one month de-risks the *category*
   even if neither product is adopted.
2. **Only one of them is buildable today.** Jev has a documented HTTP endpoint,
   an MIT-licensed SDK and independent benchmarks. OpenAI's Decisions API, as of
   2026-10-02, has **no published request schema, no response schema, no
   endpoint spec and no pricing**, and returns `403 "Decision API is not enabled
   for this user"` on a standard key [secondary]. Designing for it now would be
   building on an announcement.
3. **A decision model can never be a vfkb Brake.** This is the governing finding
   and it kills the most attractive-looking ideas. It is a judgement with no
   authoritative referent, it cannot explain itself, its `choice` confidence is
   algebra on `p_max` rather than an independent signal, and it is susceptible to
   authority-framed injection. Putting one inside the tamper detector, the review
   gate, the admission gate or RFC-041's predicate would be the fifth repetition
   of the PR #307 mistake with a faster, cheaper, *less inspectable* judge. §3.
4. **The problem it genuinely fits is the one vfkb has measured and not solved:**
   the session-start injection budget discards **~99% of eligible knowledge** — 450
   of 456 injectable entries, ~201k tokens, into a 10,000-char budget, selected by a
   type-tier heuristic with **no relevance signal at all** — and four of the six
   survivors are pinned by rule, so **the ADR-0012 reranker's entire contribution
   to a session is two entries, both `gotcha`** [measured, §5]. A
   situational relevance gate costs ~**$0.009** and ~500ms for the whole brain
   [derived from vendor pricing].
5. **The architectural shape it needs is already ratified twice.**
   [ADR-0013](../adr/ADR-0013-no-hard-native-dep.md) established
   pluggable-interface / free-default / optional-backend / graceful-degrade, and
   [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md) established
   "anything that runs automatically for every user must be free to run;
   inference is opt-in and cheap by default." A decision model fits as an opt-in
   rung *below* the Haiku skill. §8.
6. **The precondition is a calibration spike on vfkb's own entries, not a
   build.** The vendor's calibration headline is measured on "familiar English";
   this brain is dense in-house jargon. If confidence does not separate correct
   from incorrect on *our* hard cases, §6 collapses — and that costs about a
   dollar and an afternoon to find out. §10.

---

## 2. What a decision model is

A decision model inverts the LLM contract. Instead of *"continue this text,"* it
answers *"evaluate these typed questions against this state."* The output is a
value your code branches on, with a probability attached. It cannot write a
sentence, and that constraint is the product.

### 2.1 Jev (TypeSafe AI) — the API in full

Released **2026-09-15** in limited early access alongside a US$40M seed; stable
`jev-1.13.0`. A non-autoregressive discriminative transformer trained
exclusively on synthetic data with *Reinforcement Learning for Calibrated
Decisions* (RLCD). Architecture, weights and a technical paper are unpublished;
outside observers suspect an open-weight base [secondary]. TypeSafe calls it the
first **"System One model"**, after Kahneman's fast intuitive thinking.

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

```json
{
  "model": "jev-latest",
  "state": "string | object | array",
  "questions": {
    "<question_id>": {
      "type": "noul | choice | score",
      "instructions": "string | object | array",
      "criteria": "object | map | array"
    }
  }
}
```

Three primitives, mixable in one call:

| Type | Ask | Returns |
|---|---|---|
| **`noul`** | a yes/no statement | `noul`: probability 0–1. `criteria.true` / `criteria.false` descriptions optional but recommended |
| **`choice`** | pick one of ≤ **255** options | `choice` (the key), `probabilities` per option, `confidence`. `criteria` is a required map of option key → description |
| **`score`** | rate against **2–10** ordered levels | `score` (probability-weighted number), `probabilities`, `legend`, `confidence`. `criteria` is a required array of level descriptions |

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "<question_id>": {
      "type": "noul", "noul": 0.98,
      "choice": "sponsorship", "probabilities": { "…": 0.9 },
      "score": 1.9, "legend": { "…": "…" }, "confidence": 0.94
    }
  },
  "usage": { "input_tokens": 96, "output_tokens": 0 }
}
```

Every question in a call is **evaluated in parallel and in isolation** against
the same state — the property that makes a fan-out rerank coherent.

| Property | Value | Tier |
|---|---|---|
| Price | **$0.042 / M input tokens; output free** (no text is generated) | [vendor] |
| Latency | 70–500ms end-to-end; **p50 ~0.21s measured on real traffic** | [vendor] / [independent] |
| Limits | **32k tokens** for state + longest question; **64k total**; 255 options; 10 levels | [vendor] |
| Errors | 401 bad key · 422 validation · 429 rate limit · 529 overloaded (exponential backoff) | [vendor] |
| SDKs | `@typesafe-ai/sdk` (npm, MIT, Node ≥20, ESM+CJS+types, `noul()`/`choice()`/`score()` helpers), Python, a Pydantic-AI provider, Cloudflare Workers AI, OpenRouter | [vendor] |
| Design guidance | *"Ask each factor as a separate question, then combine the results with logic in your code"* — atomic questions, composition in code | [vendor] |

Documented architectural patterns: **confidence-gated routing**, **fan-out
requests**, **composite scoring**.

### 2.2 OpenAI Decisions API — an announcement, not a dependency

Announced at **DevDay 2026-09-29**. Constrains **GPT-6 Luna** to developer-defined
questions with finite pre-defined answers, returning a selection the caller
branches on; built for ticket classification, routing and "picking an agent's
next action." **~150ms** versus ~1.6s for a standard Luna call [vendor].

Its one clear advantage over Jev is **image input** — Jev is text-only. For
vfkb that advantage is worth nothing: the brain is text.

Status as of **2026-10-02** [secondary]: no docs page, no request schema, no
response schema, no endpoint path, no SDK method, no pricing row, and
`POST /v1/decisions` → `403 "Decision API is not enabled for this user"` on a
standard key. Confidence semantics are undocumented.

And the one independent measurement of Luna's confidence is a warning, not a
reassurance: at a stated **≥99% confidence it was correct 68% of the time**, and
at the hardest difficulty tier its stated probability had **AUROC 0.51 —
indistinguishable from random** [independent]. The authors' point is sharper
than "it is overconfident," which recalibration fixes: on hard problems the
signal *carries no information* separating right from wrong, and calibration
cannot manufacture discriminative power that is not there.

**Posture for vfkb:** treat it as evidence the category is real. Keep any seam
vendor-agnostic so Decisions can become a second implementation once it has
documentation. Do not design against it.

### 2.3 Measured weaknesses — the part that governs

This is the section that should be read before any of §6. The vendor's own
disclosures plus independent audits:

| Property | Finding | Tier |
|---|---|---|
| **Accuracy** | ~**72.5%** multi-task — level with mid-price LLMs (Kimi K3, MiniMax M3), **6.5–11.5 pts behind frontier**. Banking77 75.3–84.0%. Spam 98.33% | [independent] |
| **Calibration** | Best-calibrated of the models measured **on familiar English tasks**, median **ECE 0.071** — but wrong in both directions off them. Temperature fitting on **50–300 labels** fixes most of the error | [independent] |
| **`choice` confidence is not a signal** | It follows a fixed formula, **`(N·p_max − 1)/(N − 1)`**, rather than an independent estimate. `noul` tends *under*confident | [independent] |
| **Cannot abstain** | With no explicit "unknown"/"none" option it returns the **least wrong answer** rather than declining. Given one, it used it for 95% of 300 ambiguous items; **forced-choice accuracy on those same items was 0%** | [independent] |
| **Option-order bias** | 88% accurate when the correct option is listed **first**, **57% when last** | [independent] |
| **Option-naming bias** | Renaming the option labels changed **~32.5%** of answers | [independent] |
| **Arithmetic / counting / dates** | Disclosed weakness. **13.2%** on sequential state mutation. Cannot reliably count or sort | [vendor] / [independent] |
| **Negation incoherence** | `P(x) + P(¬x)` averages 1.02 but **ranges 0.71–1.42** | [independent] |
| **Non-English** | Russian XNLI drops **88.3% → 77.3%** | [independent] |
| **Granularity** | Probabilities rounded to 0.01 and **clamped to [0.01, 0.98]** | [independent] |
| **Determinism** | Near-deterministic, not deterministic: σ 0.001–0.015 across identical requests; **15 distinct answer sets in 50 identical calls**; probability shifts up to **0.13** between repeats | [independent] |
| **Context rot** | Accuracy degrades with irrelevant context — state must be tightly built | [independent] |
| **Explanations** | **Never.** By design | [vendor] |

**Prompt injection — and the conflict is itself the finding.** Blunt system
commands fail (0 of 30 dangerous prompts succeeded). But **authority-style
injection — falsely claiming human approval — penetrated in up to 10% of
cases**, and one study found that *fluent, answer-preserving context added to the
state* redirected initially-correct decisions in **61.4%** of cases. A different
benchmark reports **0.09%** across 1,056 injection attacks [all independent].
A two-to-three-order-of-magnitude spread between audits means **no injection
number here can be relied on**, which is sufficient on its own to disqualify the
model from any adversarial position (§3).

**As a judge, on the other hand, it is remarkable value:** against 6,003 rubric
checks it matched Claude Fable 5.1's verdicts **91.5%** of the time at **$160 per
million graded answers against $33,000** [independent]. DeepSeek V4.1 Flash
reached 93.5% at $260. Human-judge agreement was not reported — note that
carefully: the baseline is *another model*, not ground truth.

**The ecosystem's own standing advice**, from the community field guide:
*"measure Jev's error and abstention rates on your own cases before automating a
consequential step"*, calibrate on representative traffic, and **never treat a
probability as a sort key** — *"a good classifier is not automatically a good
sort key."* An ordering study passed six ranking gates on 360 rows and then
failed four of six on 306 human-graded pairs [independent]. §6.1 is designed
around that sentence.

---

## 3. The hard constraint — a decision model is never a Brake

vfkb's most expensive lesson forbids the first thing anyone reaches for. From
`scripts/admission-gate.mjs:18-22`, written after four defeated rounds on PR #307:

> The obvious build is "ask a model whether this issue is well specified". That
> is the shape that failed four times on this phase's sibling gate (#307): a
> judgement call, authored and graded by the same kind of thing, with no
> authoritative referent. The lesson recorded from that arc (brain gotcha
> `1af189641750`) is to hand the hardest sub-problem to something authoritative.

And the actual intellectual output of the RFC-041 arc — five defeated designs on
one predicate, brain gotcha `a01b84569d79` — is **key admissibility**: a
comparison key is admissible only if it is **attested outside the checked
party's collection-time control**.

A decision model fails that test on every clause:

- **No referent.** Its answer is its own authority. The admission gate's design
  deliberately hands two of its three requirements to the *repository* (a path
  exists or it does not; a cited ADR exists or it does not) because that is
  authoritative and a model is not.
- **No explanation, ever.** A finding without a rationale is unactionable, which
  is the whole value of [ADR-0052](../adr/ADR-0052-review-gate.md)'s review
  records and the entire subject of
  [RFC-040](../rfc/RFC-040-the-referent-question.md).
- **Confidence that looks like evidence and is not.**
  [ADR-0051](../adr/ADR-0051-delivery-honesty.md) §3 (the quiet-success
  trap) requires a gate's predicate to be a **content assertion over output**,
  because exit status and error flags are not admissible evidence. A `noul`
  returning `0.94` is precisely the kind of number that *reads* as a content
  assertion while being neither content nor assertion — and for `choice` it is
  provably just `p_max` restated (§2.3).
- **A lever the checked party can reach.** Authority-framed injection lands in
  up to 10% of attempts, and the audits disagree by three orders of magnitude.
  Brain gotcha `43c1af80effb` states the generalisation already:
  *"a reconciliation rule whose trigger the checked party can manufacture is not
  a Brake."* An agent that can write into the state being judged can write
  "the operator approved this."
- **Not even deterministic.** 15 distinct answer sets in 50 identical calls. A
  Brake that answers differently on a re-run cannot ground a durable claim.

**Therefore, out of scope permanently, not pending better calibration:**
`scripts/tamper-check.mjs`, `scripts/review-gate.mjs`,
`scripts/admission-gate.mjs`, `scripts/reproduction-gate.mjs`,
`scripts/hook-durable-claim-check.mjs`, the ADR-0052 review verdict, and
RFC-041's declared-vs-runnable predicate.

This last one deserves naming explicitly, because it is where a session running
on momentum would go first: RFC-041 is **held** after two review rounds and
[ADR-0070](../adr/ADR-0070-guards-that-can-fail.md) §4 firing twice,
and the brain's standing instruction is that **no sixth design be written**.
"Ask a decision model" would be a sixth design *and* the #307 shape at once.
A faster, cheaper judge is still a judge.

---

## 4. The asymmetry test

The usable rule, which §6 and §7 are just applications of:

> **Is the cost of being wrong borne by *relevance*, or by *correctness*?**

| | Wrong relevance | Wrong correctness |
|---|---|---|
| **Cost** | the operator reads one less useful line | a Brake passes a tamper; a false claim becomes durable |
| **Recoverable** | yes, silently, next session | no — and the record shows these arcs run 4–8 review rounds |
| **Already happening** | **yes — 450 of 456 eligible entries dropped per session** [measured] | no, and four ADRs exist to keep it that way |
| **Decision model** | **fits** | **never** |

A decision model belongs entirely in the left column. The fortunate part is that
vfkb's largest *unsolved* problem lives there too.

---

## 5. vfkb's measured surface

Measured at `8237fc4` on this branch, 2026-10-05. (The brain has since grown
by the entries this document's own PR adds; re-run the command below for current
figures. The ratio is what matters, and it moves slowly in the wrong direction.)

**First, the trap, because it invalidated this section's first draft.**
`entries.jsonl` is **append-only with delta records**: an edit, a zone move, a
provenance re-stamp or a decision status transition appends a *new line for the
same `id`*. `readAll()` (`src/engine.ts:137`) delegates to `materialize()`
(`src/storage.ts:137-148`), which folds records by `id` keeping the greatest
`updated` — last-write-wins — and additionally drops tombstones and records with
no usable `id`. So **`wc -l` is not the entry count.**

Measured at this commit, the fold is the *only* reason the two differ: **473
physical lines → 460 distinct entries**, with **12 ids carrying 13 extra lines**,
zero tombstones and zero id-less records. Of those 12, **9 are decisions and all
9 changed `status` across their lines** — exactly the 103-vs-94 over-count the
first draft published. Decisions attract deltas because `updateEntry` refuses the
decision family outright (`src/engine.ts:150-153`; ADR-0004 — immutable in text,
supersede rather than edit), so transitions are the delta they do get. Note the
code permits one other path: `setProvenanceStatus` (`src/engine.ts:166-180`)
carries **no** decision-family guard and would append a delta for any type — it
simply has not been used on a decision here. All 9 being transitions is an
observation about this brain, not a guarantee from the code. The other three
duplicated ids are one `fact` and two `link`s moved to `archive` by
`curate merge`. Measure through the engine, not the file:

```sh
VFKB_DATA_DIR=.vfkb node --input-type=module -e '
import { readAll, renderContextBundle, SESSION_BUDGET_CHARS, isInjectable, supersededIds }
  from "./dist/engine.js";
const all = readAll();                    // folded, not lines
const live = all.filter(e => e.zone !== "archive");
const inj = all.filter(e => isInjectable(e, undefined, supersededIds(all)));
const chars = live.reduce((a,e) => a + (e.text||"").length + (e.why||"").length, 0);
const bundle = renderContextBundle();
console.log({ distinct: all.length, live: live.length, injectable: inj.length,
  chars, approxTokens: Math.round(chars/4), budget: SESSION_BUDGET_CHARS,
  rendered: bundle.length,
  omitted: (bundle.match(/\+ (\d+) lower-ranked entries omitted/)||[])[1] });
'
```

| Measurement | Value |
|---|---|
| Distinct entries (`readAll()`) | **460** — from **473** physical lines |
| Live (`zone !== archive`) | **458** |
| Injectable (`isInjectable`) | **456** |
| Total `text` + `why` (live) | **803,284 chars ≈ 201k tokens** |
| Entry `text` length | p50 **1,408** · p90 **3,220** · max **7,433** chars |
| Live by type | fact 194 · decision 94 · link 84 · gotcha 81 · pattern 5 |
| Session-start budget | **10,000 chars** (`src/engine.ts:41`, `SESSION_BUDGET_CHARS`) |
| Rendered bundle | **9,854 chars** |
| **Entries omitted** | **450 of 456 injectable** — the render prints it itself: `+ 450 lower-ranked entries omitted` (`src/engine.ts:633`) |

So **six entries reach a session out of 456 that are eligible — ~1.3%.** The
headline is not "the budget is tight"; it is that **~99% of eligible knowledge is
discarded at every session start**, and the rule deciding which 1.3% survives has
no relevance input.

**And it is worse than that, because four of the six are pinned by rule.**
Locating each surviving entry within the render gives:

| Section | Selected by | Entries |
|---|---|---|
| `## Constitution` | ADR-0008 pin — never budget-dropped | 2 `decision` |
| `## Last handoff` | ADR-0049 Layer 0 pin — newest handoff/next | 1 `fact` |
| `## Cross-repo operations` | pin | 1 `fact` |
| the ranked bundle | **the ADR-0012 heuristic reranker** | **2 `gotcha`** |

**The reranker's entire contribution to a session is two entries, and both are
`gotcha`** — the joint-top type tier. Not one `fact`, `decision`, `pattern` or
`link` from the ranked set survives the budget. That is the type-tier lottery of
the rule above, observed rather than argued: once the pins are paid for,
`TYPE_WEIGHT` has about two slots to spend and spends them both in tier 5.
Everything ADR-0049 said about facts being unreachable under gotcha pressure is
still true — the pin bought back exactly one `fact`, by name, as a special case.

**The selection rule is, in full** (`src/engine.ts:402-433`):

```
TYPE_WEIGHT   pattern 5 = gotcha 5 > decision 4 > fact 2 > link 1   (primary)
  ↳ withinTierScore   operator-trust +3, verified +1                (secondary)
    ↳ updated desc                                                  (tiebreak)
```

**There is no relevance signal at session start, because there is no query.**
[ADR-0012](../adr/ADR-0012-two-stage-retrieval.md)'s two-stage retrieval only
produces relevance for an explicit text search (`src/read.ts:88,138` — relevance
primary, `heuristicCompare` as tiebreak); with no text, `rerank()` is the pure
heuristic.

ADR-0049's own Context section documents where that leads: with **23** gotchas in
the brain the budget dropped **every `fact`**, which is how the end-of-day
handoff vanished (issues #95/#96, 2026-07-09) and required a hard-coded pin to
fix. There are now **81** gotchas. The pin rescued one entry; the structural
problem is **3.5× worse** than when it was diagnosed.

---

## 6. Adoption candidates, ranked

All four are propose-only or fail-open, and all four sit in §4's left column.
**None is proposed for build here** — a build needs an RFC and the §9 gate.

### 6.1 Injection selection — the real prize

**Problem:** §5. ~99% of eligible knowledge discarded by a rule with no relevance
input — and once the pins are paid for, that rule is choosing just **two** of the
456 eligible entries, spending both slots in the top type tier.

**Shape:**
- **State** = the session's situation, derivable deterministically with **no
  model**: branch, last N commit subjects, `git status` paths, the pinned
  handoff, open PR titles. A few hundred tokens.
- **Questions** = one `noul` per candidate entry — *"Is this knowledge needed by
  a session doing the work described in the state?"* — with explicit
  `criteria.true` / `criteria.false`.
- Parallel-and-in-isolation evaluation (§2.1) is exactly the independence
  property a reranker wants.

**Cost** [derived from vendor pricing]: 201k tokens × $0.042/M ≈ **$0.0084** for
the entire brain, in 4–8 fan-out calls to respect the 32k/call ceiling, ~500ms
wall clock. For comparison, the same rerank through Haiku is ≈$0.21 and several
seconds; through Opus ≈$0.62. **Cache keyed on `(branch, HEAD sha, handoff id)`**
makes the steady-state cost ~zero: same branch and sha → no calls. The cache is
derived state → `.vfkb/`, gitignored alongside `index-meta.json`.

**The payoff is not "better ordering."** It is that the budget stops being a
**type-tier lottery** — today a `fact` naming the exact file you are editing
loses to any `gotcha` about anything.

**Three constraints that belong in the RFC, not in a later post-mortem:**

1. **Do not sort by the probability.** §2.3's ordering result is explicit. Use
   the `noul` as an **admission gate into the candidate pool** and keep
   `heuristicCompare` as the orderer *within* it. ADR-0012's ratified tiering
   then survives untouched, and the model is used only where it is strong:
   binary, in-English, few-class.
2. **Make abstention explicit.** "Not relevant" must be a well-described `false`
   branch with a tuned threshold, or §2.3's cannot-abstain behaviour applies and
   everything scores as relevant.
3. **Fit calibration on vfkb's own entries.** ECE 0.071 is *familiar English*;
   this brain is dense in-house jargon ("declared-vs-runnable reconciliation",
   "the quiet-success trap"). 50–300 labels is the documented fix, and 458
   entries plus session records can produce them.

**Relationship to the gated S1 item:** orthogonal, not rival. S1's amended first
resort is **BM25 in `InMemoryIndex`**, and BM25 needs a query. At SessionStart
there is none. This addresses the case BM25 structurally cannot; S1 keeps
addressing the phrasing-miss case, in the order the amendment sets.

### 6.2 The capture gate that is switched off

`CLAUDE.md`: *"**PostToolUse auto-capture is intentionally OFF** — against the
committed brain it would flood `.vfkb` with tool-call noise."*

A built, working feature disabled for want of a filter. The missing component is
a cheap typed yes/no on a bounded state — *is this outcome durable knowledge or
transient noise?* — that must run on **every** PostToolUse, which is exactly why
an LLM call was never an option. ~200ms and ~$0.00004/judgment is the first
envelope that fits a hot path at all.

**And the risk is already contained by existing architecture — this is the best
placement in the system.** [ADR-0021](../adr/ADR-0021-auto-distill-and-curator.md)
forces every auto-distilled entry to `incoming` + `unverified` + agent-trust
(`src/distiller.ts:135`, with a deterministic test asserting it), and
`promoteIfCorroborated` requires **≥2 independent corroborating signals**
(`src/curator.ts:38,44`) before anything reaches the trusted set. A false
positive costs one unverified `incoming` entry that never promotes.
**Judgement on the hot path, deterministic containment behind it.**

Keep it **subtractive**: the distiller already acts only on `capture:error`-tagged
facts, so the model narrows an already-narrow deterministic candidate set and
never generates. Threshold high (≥0.9), because even `incoming` entries are
committed to the SoR.

Note the seam was anticipated — `src/distiller.ts:6`: *"an optional off-hot-path
LLM distiller slots behind the same `Distiller` seam."* A decision model is the
*filter* half of that, not the author half: it cannot write a gotcha.

### 6.3 Stop-nudge precision

`decideStop` fires on a **proxy**: `uncommittedWork && newDecisions === 0`. It
cannot tell whether a decision was *made*, so it fires on turns that made none.
The cost is on record in `src/stop-reminder.ts`: the B3 nudge *"fired on EVERY
stop for the rest of the session, forcing the agent to spend a turn declining
each time,"* which forced `NUDGE_COOLDOWN_TURNS = 10` (`:57`, operator ruling
2026-07-31). **The cooldown is a workaround for imprecision, not a fix.**

The real question is a textbook `noul`: *did this turn make a load-bearing choice
between alternatives that is not already recorded?* State = diff stat + commit
subjects + brain delta, ~1–2k tokens, on a hook that already spawns `git`.

**The fail-safe is already specified in the code** (`src/stop-reminder.ts:56`):
*"fail-open toward reminding, never toward silence."* A timeout therefore behaves
exactly as today, and ADR-0033's SessionEnd B2 floor still guarantees a committed
handoff regardless. **Nothing load-bearing rests on it** — which makes this the
right place to de-risk the client, key handling, timeout and degrade path before
touching the inject path.

### 6.4 Curation at 458 entries

- **Semantic dedup.** `findLexicalDuplicates` is exact-match-after-normalisation
  only, and its own comment defers the rest to the gated RFC-003 embeddings
  (`src/curator.ts:83`). A `noul` over a candidate pair — *"do these record the
  same lesson?"* — does semantic dedup with no embedding model, no index and no
  native dependency. It is **propose-only by construction**: `findLexicalDuplicates`
  returns pairs without acting, and `mergeDuplicate` is a separate explicit call,
  so the never-rewrite Brake in `curator.test.ts` is untouched.
- **Staleness is blind.** `isInjectable` (`src/engine.ts:388`) drops on
  `valid_until`, explicit `stale`/`expired` and supersession — all of which
  require someone to have *marked* it. Nothing notices that a `--plugin-dir`
  gotcha went obsolete when ADR-0051 superseded its premise. A `score` against a
  state carrying the current ADR index could **propose** expiry candidates for
  human confirmation.
- **Handoff sprawl.** **106** live entries carry the `handoff` tag (112 carry
  `handoff` or `next`), of which exactly **one** is ever pinned by ADR-0049
  Layer 0. The other 105 compete for the 10k budget as dead weight. *(Counted
  through `readAll()`; the injected context map reports 108 for the same brain —
  a discrepancy not chased here, and a reminder to count rather than quote.)*
  A `choice` routing `keep / archive-candidate / supersede-candidate` would make
  the `archive` zone useful. This is Track 9's Q0-hygiene queue's natural next
  step, and it is measured debt rather than speculation.

---

## 7. Explicitly rejected

Recorded so a later session does not re-derive them.

| Candidate | Why not |
|---|---|
| **RFC-041's declared-vs-runnable predicate** | §3. A sixth design *and* the #307 shape at once. The brain's standing instruction forbids a sixth design |
| **Any Brake** (tamper, review, admission, reproduction, durable-claim) | §3. No referent, no explanation, injectable, non-deterministic |
| **ADR-0052 review verdicts / adversarial review** | Cannot explain itself; a finding without a referent is unactionable — RFC-040's whole subject. Triaging *which files a reviewer reads* solves nothing at 3–4 files per PR |
| **ADR-0049's handoff pin** | The ADR deliberately made selection *"a filter, not an inference."* Newest-wins is almost always right; reversing a ratified decision for a marginal gain is not worth it. Attractive-looking and wrong |
| **S1 search robustness** | S1's named first resort is BM25 — free, offline, deterministic, and aimed at the actual phrasing-miss failure. A post-BM25 rerank of the top-50 is plausible *later*; the amendment's order is correct and should not be jumped |
| **Skill / agent routing** (the ecosystem's most popular pattern) | Nothing to solve. Three slash commands, all user-typed |
| **OpenAI Decisions API** | §2.2. No schema, no pricing, 403 on a standard key. Its one edge — images — is worthless to a text brain |
| **The `@typesafe-ai/sdk` dependency** | §9 |

---

## 8. Architectural precedents that already govern this

The useful discovery is that **no new architectural posture is required**. Two
ratified decisions already describe the shape.

**[ADR-0013](../adr/ADR-0013-no-hard-native-dep.md) — the seam.** It established
for the index exactly what a decision model needs: *"`Index` is a pluggable
interface"*; *"v1 default = pure-JS in-memory"*; *"`better-sqlite3` FTS5 is an
**OPTIONAL** backend behind the same interface, auto-detected … if absent the
engine **degrades gracefully** — it never hard-fails."* A `Reranker` seam with
`HeuristicReranker` (free, offline, default) and a decision-model implementation
(opt-in, keyed, network) is **the same decision shape, already accepted once**.

**[ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md) — the cost tier.**
Its governing principle: *"anything that runs automatically for every user must
be free to run; inference is opt-in and cheap by default; expensive only on
proven need."* Its layers were Layer 0 deterministic (engine, no model), Layer 1
Haiku-pinned skill, Layer 2 escalation on a named trigger. A decision model
inserts cleanly as **Layer 0.5** — ~25× cheaper than the Haiku skill, in-process
in ~500ms rather than an agent spawn, and *below* Layer 1 rather than replacing
it. Layer 0 stays deterministic and free.

**[ADR-0021](../adr/ADR-0021-auto-distill-and-curator.md) — the containment.**
§6.2 needs no new safety mechanism; the incoming-zone containment and the
≥2-corroboration promotion gate already bound the blast radius of a wrong
answer, and both are deterministically tested.

---

## 9. Cross-cutting constraints

**Offline / degradation is a hard requirement, not a nicety.** `CLAUDE.md`
records that this machine's `npm install` resolves against a corporate mirror →
**ENOTFOUND off-VPN**. A network dependency on the always-on inject path would
brick session start. Any implementation must degrade to the deterministic
reranker on timeout, 429/529, missing key or no network — the ADR-0013 posture
verbatim.

**Do not take the SDK.** It is one `POST` with a Bearer header and a JSON body,
and `fetch` is in Node 20. `package.json` keeps the engine at two runtime
dependencies (`@modelcontextprotocol/sdk`, `zod`) against a stated
"minimal deps (the engine itself is stdlib)" posture, and ADR-0013's whole point
is not inheriting other people's platform requirements. The SDK's main value is
TypeScript types that vfkb would write for its own seam anyway. ~60 lines keeps
the dependency count at zero.

**Data egress belongs in the Consequences of any ADR, not in a later surprise.**
The state would include git diffs, branch names and handoff text, sent to a
third party **on every session start**. Low risk for this public repo; a real
consideration for the factory's other projects, because vfkb is a *substrate*
that other repos adopt. The community pattern for this is already named — the
`jev-agent-switch` plugin strips secrets from pending tool inputs before
sending. Opt-in, per-project, documented.

**The DoD gate applies, and has a trap specific to this.**
[ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md)/
[ADR-0051](../adr/ADR-0051-delivery-honesty.md) bind the moment any of this
is user-facing: committed reproducible scenario, DEMONSTRATED ≥2/3, a can-fail
arm, every load-bearing claim observed not asserted. But **a scenario arm that
depends on a live third-party API is neither reproducible nor sandboxed** — that
is the `tool-gating` arc waiting to recur. The shape that works:

- **Reproducible arm** — recorded decision-model responses as committed fixtures.
  The pattern already exists in this repo (`scripts/fixtures/`,
  `scripts/build-admission-fixtures.mjs`).
- **Live calibration run** — recorded separately, as its own dated evidence
  artifact, never as a gate input.
- **Can-fail arm** — already templated by ADR-0049's own DoD: seed a brain where
  the needed entry falls below the budget cut under `heuristicCompare` (the
  reproduced 2026-07-09 failure), then assert the agent names the sentinel with
  the reranker **on** and misses it with the reranker **off**.
- **Isolation** — brain gotcha `fb712c13f39e`: the vfkb plugin is enabled at
  **user** scope on this machine, so it runs inside every `claude` sandbox an L4
  launches. Any scenario here must disable it per-sandbox and assert it stayed
  off.

**Evidence-gating holds.** §6.1, §6.3 and §6.4 rest on measurements already in
the repo (450 dropped entries; the cooldown incident; 106 handoffs;
exact-match-only dedup). §6.2's evidence is a feature deliberately switched off.
None of this requires the speculative-build exemption, which matters because
`CLAUDE.md` forbids building on spec.

---

## 10. Sequencing, if it is ever built

1. **Calibration spike first — a throwaway script, no production code.** 100–200
   labelled `(situation, entry, relevant?)` pairs drawn from the brain and
   session records; measure ECE, AUROC, and **separability on the hard cases
   specifically**. §2.2's critique is the reason the last clause is in bold: easy
   cases mask a confidence signal that has no discriminative power where it
   matters. Also re-run identical calls to measure the §2.3 repeat variance on
   our own data. If confidence does not separate correct from incorrect on vfkb's
   jargon, §6 collapses — for about a dollar and an afternoon. This is also the
   only honest route to "observed not asserted" for a probabilistic component.
2. **§6.3 (Stop nudge)** — smallest surface, existing fail-open, existing
   SessionEnd floor underneath, revert-checkable. De-risks the client.
3. **§6.1 (reranker behind an ADR-0013-shaped seam)** — the actual prize, with
   ADR-0049's scenario as the template.
4. **§6.4 (propose-only curation)** — containment is free because it only
   proposes.
5. **§6.2 (capture gate)** — last; it writes to the committed SoR, so it wants
   the most calibration confidence behind it.

A proposal would be **one RFC** for the `Reranker`/`Decider` seam with the
calibration spike as its own gate, naming §6.2–§6.4 as follow-ons rather than
bundling them.

---

## 11. Primary sources

Fetched 2026-10-03 unless noted.

**Vendor / reference**
- [TypeSafe AI](https://typesafe.ai/) — product page
- [TypeSafe API reference](https://docs.typesafe.ai/api.md) — endpoint, request/response schemas, error codes
- [TypeSafe docs](https://docs.typesafe.ai/) — primitives, atomic-question guidance
- [Pydantic AI — TypeSafe (Jev) provider](https://pydantic.dev/docs/ai/models/typesafe/) — limits, known weaknesses, threshold settings
- [Cloudflare Workers AI — Jev](https://developers.cloudflare.com/ai/models/typesafe/jev/)

**Encyclopaedic / overview**
- [Jev (AI model) — Wikipedia](https://en.wikipedia.org/wiki/Jev_(AI_model)) — RLCD, primitives, availability
- [How to use Jev in Node.js — Flavio Copes](https://flaviocopes.com/jev-nodejs/) — concrete SDK usage

**Independent evaluation / robustness**
- [awesome-typesafe-jev](https://github.com/AbdelStark/awesome-typesafe-jev) — five catalogued failure modes, abstention and routing studies, standing advice
- [awesome-jev-robustness](https://github.com/GautamTalksDev/awesome-jev-robustness) — injection, determinism, jaggedness, calibration audits
- [Jev after eight days of independent tests](https://dev.to/gde/jev-after-eight-days-of-independent-tests-level-with-mid-price-llms-behind-the-frontier-1kln) — accuracy, ECE, option-naming bias, clamping
- [jevbench](https://github.com/fstandhartinger/jevbench) · [Open-Jev benchmarks](https://zefan-cai.github.io/open-jev/benchmarks/)
- [Using TypeSafe's Jev for evals — Langfuse](https://langfuse.com/blog/2026-09-18-using-typesafes-jev-for-evals) — judge-agreement numbers, cannot-abstain, context rot
- [Using TypeSafe's Jev for evals — Datadog](https://www.datadoghq.com/blog/jev-evals-agent-observability/)

**OpenAI Decisions API**
- [OpenAI's Decisions API vs Jev — Firecrawl](https://www.firecrawl.dev/blog/openai-decisions-api-vs-jev) — comparison, availability status
- [OpenAI Decisions API explained — eesel](https://www.eesel.ai/blog/openai-decisions-api)
- [The OpenAI Decisions API needs a confidence you can trust](https://anth.us/blog/openai-decisions-api-preview/) — the 68%-at-99% and AUROC-0.51 findings

**Agent-integration patterns**
- [jev-claude-code](https://github.com/weiping/jev-claude-code) — PreToolUse permission gate, output ladder, subagent routing
- [gatekeeper](https://github.com/AgriciDaniel/gatekeeper) — rules in code, typed call from the model
- [jev-agent-switch](https://github.com/0xwhrari/jev-agent-switch) — secret-stripping before send

**vfkb internal**
- `src/engine.ts:41,388,402-433,633` · `src/read.ts:29,88,138` ·
  `src/curator.ts:38,44,83` · `src/distiller.ts:6,135` ·
  `src/stop-reminder.ts:56,57` · `scripts/admission-gate.mjs:18-22`
- ADR-0012, ADR-0013, ADR-0015, ADR-0021, ADR-0049, ADR-0050, ADR-0051, ADR-0052, ADR-0070
- Brain gotchas `1af189641750` (observed-red is a floor), `43c1af80effb` and
  `a01b84569d79` (the five defeated designs), `ed2f56c1d705` (the informative
  mutation), `fb712c13f39e` (plugin leaks into sandboxes)

---

## 12. Not verified

Stated so the gaps are not mistaken for findings.

- **No decision-model API has been called from this repo.** Every cost, latency,
  accuracy and calibration figure is a vendor or third-party measurement. None
  has been reproduced on vfkb's data. §10 step 1 exists for this reason.
- **Jev's architecture is unpublished** — no weights, no technical paper. "RLCD"
  and "non-autoregressive" are vendor descriptions; the suggestion of an
  open-weight base is [secondary] speculation.
- **TypeSafe's performance workflows are self-authored**, and the company itself
  says the reported gains are *"likely to sit at the high end of real-world
  results"*. The 193.6×/444.6× headline numbers are internal benchmarks.
- **The injection numbers conflict by three orders of magnitude** (0.09% vs
  61.4%) across independent audits. No injection figure here should be relied
  on; §3 does not depend on any of them being right.
- **Judge-agreement (91.5%) is agreement with another model**, not with humans
  or ground truth. Human-judge agreement was not reported.
- **The §6.1 cost figure is arithmetic on vendor pricing** (201k measured tokens
  × $0.042/M), not an invoice. Token counting differs between tokenizers, and
  state repeated across fan-out calls is not included.
- **The 32k/64k limits are vendor-stated and reported inconsistently** across
  sources; one write-up flags the conflict directly. Batch sizes must be computed
  from measured lengths, not assumed.
- **Nothing in §6 has an RFC, an ADR, a scenario or a line of code.** The honest
  status of every candidate here is *researched, not proposed*.
