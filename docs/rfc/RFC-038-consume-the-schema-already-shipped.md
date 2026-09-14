---
type: Proposal
title: "RFC-038: Specified, shipped, never read — the unconsumed-schema pattern and what wiring it would cost"
description: "A relayed thesis — vfkb repeatedly specifies a capability, ships the schema, and never wires the read path — checked against the tree at main. Two of the three claimed instances hold and are worse than claimed (provenance.origin's commit kind is never constructed at all, though ADR-0011 D4 lists it as v1-wired; recorded_invalid_at has no write site either, so it is dead in both directions). The third, read-time key extraction, is NOT an instance of the pattern and is argued separately as a third option for the gated S1/RFC-003 question. A fourth, unclaimed instance was found: refs.files/commit/related have a live read path in export.ts and no write path anywhere. Proposes wiring for I1 and I4, deletion-or-wiring as an open decision for I2, and for I3 only a queue-position amendment to a gated decision — no build. Nothing here is built; per ADR-0050 the only honest status for every instance below is unbuilt."
status: "Proposed — unratified"
timestamp: 2026-09-14
---

# RFC-038: Specified, shipped, never read

- **Status:** **PROPOSED, unratified.** Nothing in this RFC is built, and no decision below has
  been ratified. Per ADR-0007 this is a *proposed decision*; it becomes an ADR only on operator
  acceptance.
- **Date:** 2026-09-14
- **Deciders:** operator + Claude
- **Trigger:** the Apache Maka comparison
  (`docs/research/apache-maka-vs-vfkb-2026-09.md` §3b and §6 — **currently on branch
  `docs/maka-comparison`, commits `c107399` / `7d49b37`, not yet on `main`**). Its ranked learning
  list argues Maka's memory tier is ahead of vfkb on evidence pointers, consumed temporal
  modelling and write-time keys "not by having designed better, but by wiring what it designed."
  This RFC tests that claim against the tree rather than inheriting it.
- **Relates:** [ADR-0011](../adr/ADR-0011-envelope-richness.md) (the envelope that specified all
  the dormant fields, and whose D4 explicitly phased their consumption);
  [ADR-0005](../adr/ADR-0005-injection-filters-stale.md) (the injection gate that would consume
  the temporal fields); [ADR-0012](../adr/ADR-0012-two-stage-retrieval.md) /
  [ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md) /
  [RFC-003](RFC-003-embedding-accuracy-mode.md) (the gated retrieval question instance 3 touches);
  [ADR-0022](../adr/ADR-0022-l4-evaluation-methodology.md) /
  [ADR-0029](../adr/ADR-0029-sandbox-proven-definition-of-done.md) /
  [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) (what a proof must be);
  [#261](https://github.com/vilosource/vfkb/issues/261) (ADR claims must cite something
  checkable — the reason every claim below carries a `file:line`)

## Context — the claim, and how it was checked

The relayed thesis is that vfkb has a *behavioural* habit: it designs a capability, lands the
schema for it in `src/types.ts`, and then never builds the path that reads it back. Three
instances were named. Each was checked by establishing **write sites** and **read sites**
separately across `src/` — a field that is written and never read is dormant; a field that is
neither written nor read is dead; a field that is read but never written is a rendering path
that can never fire. Those three states turn out to be materially different problems, and the
original framing collapsed them.

**Verdict up front: two of the three named instances hold, and both are worse than claimed. One
does not hold and is a different kind of gap entirely. A fourth, unnamed instance exists.**

## The instances

### I1 — `provenance.origin`: HOLDS, and the `commit` kind is dead, not merely unread

ADR-0011 §Decision 2 adds `provenance.origin?` as a four-way discriminated union, and
ADR-0011 §Decision 4 puts **`commit` and `tool_call` origin capture on ingest and passive
capture** in the **v1-wires** column — not the deferred column.

- **Declared:** `src/types.ts:36-41` (the union), `src/types.ts:48` (the field).
- **Write sites (exhaustive, `grep -rn "origin:" src/`):** `src/engine.ts:123` (pass-through of
  `AddOpts.origin`, `src/engine.ts:80`); `src/engine.ts:835` (Tier-B passive capture);
  `src/distiller.ts:100` and `src/distiller.ts:138` (auto-distilled gotchas). **Every one of
  them constructs `kind:'tool_call'`.** The strings `kind: 'commit'`, `kind: 'message'` and
  `kind: 'manual'` occur nowhere in `src/` outside the type declaration itself.
- **Read sites (exhaustive):** `src/distiller.ts:38` and `src/distiller.ts:70` — both inside the
  distiller, both narrowing on `kind === 'tool_call'` to recover which tool failed.
- **Not read anywhere else:** not in the reranker or injection gate (`src/engine.ts:387-414`),
  not in search (`src/read.ts`), not in either render line (`src/mcp-server.ts:43`,
  `src/cli.ts:356`, `src/cli.ts:567`), not in the projections (`src/export.ts`), not in
  `src/doctor.ts`.
- **Not exposed:** absent from `kb_add`'s `inputSchema` (`src/mcp-server.ts:214-230`) and from
  the CLI `add` flag table (`src/cli.ts:162-172`). There is no surface on which a human or an
  agent can record where a claim came from.
- **Not even validated:** `src/validate.ts:54` types it `z.unknown().optional()`, so a malformed
  origin survives the normalizer that exists precisely to keep foreign entries well-formed.

The relayed claim was "written, never read." The accurate claim is narrower and sharper:
**`tool_call` is written and read (by one consumer, for one purpose); the other three kinds are
inert type declarations.** The one kind ADR-0011 justified the whole field with — "*re-verifiable*
provenance (commit+sha+path+line from ingest)" — has no producer.

**What this costs today, concretely.** A `verified` decision in `.vfkb/entries.jsonl` carries a
trust glyph (`src/engine.ts:439`) and passes the `--verified` filter (`src/read.ts:116`), but
carries no machine-followable pointer to what makes it true. An agent asked "where did this come
from?" can only re-read the prose. `vfkb export okf` emits a `# Citations` block
(`src/export.ts:321-328`) that never contains a source reference. And `docs/FEATURES.md:107`
describes the envelope as carrying "a structured, re-verifiable `origin`: commit / message /
tool_call / manual" in a document that bills itself as a verified feature reference — three
quarters of that sentence is unreachable from any surface a user has.

### I2 — `recorded_invalid_at`: HOLDS, and it is dead in both directions

- **Declared:** `src/types.ts:66`, with the comment "stored-but-not-consumed in v1"; accepted as
  a cost in ADR-0011 §Consequences ("lands as a stored-but-unused field in v1").
- **Write sites: none.** `addEntry` constructs `validity: { valid_from, valid_until }` only
  (`src/engine.ts:125`). No other code path assigns it.
- **Read sites: none.** The injection gate reads `valid_until` (`src/engine.ts:397`) and nothing
  else from `Validity`; `src/export.ts:383-385` reads `valid_until` for its retirement reason.
  The only other mention is the passthrough schema at `src/validate.ts:61`.

So the field is not "stored but not read" — **it is never stored.** There is no data behind it
to consume, which changes the economics of the fix: wiring a reader is not a small change on top
of existing data, it is building a writer *and* a reader *and* a surface, for a capability whose
own roadmap entry is gated on "the first real as-of query need"
(`docs/H4-DEVELOPMENT-ROADMAP.md:392-394`) — a trigger that has not fired.

**What this costs today:** nothing operational. It costs documentation honesty —
`docs/FEATURES.md:109` and `docs/FEATURES.md:289` both describe it as stored-awaiting-consumption,
which is a more generous account than the code supports. This is the instance where the honest
answer may be deletion, argued in *Rejected alternatives* below.

### I3 — read-time key extraction: TRUE AS A FACT, NOT AN INSTANCE OF THIS PATTERN

The factual half checks out. `InMemoryIndex.rebuild()` (`src/index-store.ts:66-69`) materializes
entries and a content hash and **stores no token structure at all**; `searchScored`
(`src/index-store.ts:93-113`) re-runs `tokenize()` over `entry.text + tags` for every entry on
every query, and `tokenize` applies a five-suffix stemmer (`src/index-store.ts:36-50`) whose own
comment concedes it cannot resolve `running`/`runs`. There is no inverted index and no stored
per-entry key set. `KnowledgeEntry` (`src/types.ts:69-94`) has no `keys` field.

**But this is the opposite shape of I1/I2.** There is no specified-and-unconsumed capability
here: there is no schema, no ADR promising keys, nothing declared and abandoned. Retrieval was
deliberately designed as read-time term overlap (ADR-0012's two-stage model; ADR-0013's refusal
of a hard native dep), and it *works* — it is wired end to end, which is exactly what I1 and I2
are not.

Presenting I3 as a third instance of "specified but unconsumed" would be overclaiming, and this
repo has an open issue about overclaiming in exactly this way ([#261]). **This RFC declines to
count it.** It is a genuine Maka-derived opportunity and is proposed separately in D4, on
different grounds and under a different gate.

### I4 — `refs.*`: the mirror image, unclaimed, and it makes the pattern real

`Refs` (`src/types.ts:51-59`) declares `task_id`, `workplan_id`, `commit`, `branch`, `files`,
`related`, `supersedes`, `contradicts`.

- **Write sites:** `src/engine.ts:112-118` — **`supersedes` and `contradicts` only.** No code
  path anywhere in `src/` assigns `task_id`, `workplan_id`, `commit`, `branch`, `files` or
  `related`; `task_id` and `workplan_id` appear nowhere outside `src/types.ts:52-53`. Neither
  `kb_add` (`src/mcp-server.ts:214-230`) nor `vfkb add` (`src/cli.ts:162-172`) exposes any of
  them. `src/validate.ts:41-47` validates only the two written fields.
- **Read sites:** `src/export.ts:322` (`related`), `:326` (`files`), `:327` (`commit`) — a live,
  shipped `# Citations` renderer in the OKF projection, guarded by `?? []` and `if`, that
  **cannot fire on any entry this engine has ever written.**

This is the same defect with the halves swapped: I1 is a write path with no reader, I4 is a
reader with no write path. It matters for the argument because it is the instance nobody was
looking for, found by walking the envelope field by field rather than by checking a thesis.

**What this costs today:** `vfkb export agents-md` / `export okf` — the projections whose whole
point is to be read by a cold agent (`scenarios/okf-bundle-cold-agent.mjs`,
`scenarios/agents-md-cold-agent.mjs`) — emit entries with no citations, and there is no way to
give them any. `docs/FEATURES.md:105-107` lists `refs (task / commit / branch / files / related
/ supersedes)` as part of the envelope without noting that six of seven are unreachable.

### Adjacent, noted not argued

`provenance.source` and `provenance.detail` (`src/types.ts:45-46`) — ADR-0011 §Decision 2 keeps
free-text `source` as "the fallback" for `origin`. Neither is written or read anywhere in `src/`
(only declared at `src/validate.ts:52-53`). Same family as I1; folded into D1 rather than counted
separately, because the fallback is dead for the same reason the primary is.

## Is this one pattern or four unrelated gaps?

The honest answer is **one pattern covering I1, I2 and I4, and not covering I3.**

What I1, I2 and I4 share is not a topic — it is a *seam*. In all three, the envelope
(`src/types.ts`) is richer than the surfaces (`src/cli.ts`, `src/mcp-server.ts`) and the
consumers (`src/engine.ts`, `src/read.ts`, `src/export.ts`), and in all three the gap survived
because **no test can fail for an unused field.** The unit suite asserts behaviour over data
that exists; a field with no producer generates no behaviour to assert. The type checker is
satisfied by a declaration. `src/validate.ts` is deliberately lenient (`looseObject`, `.catch`)
so foreign entries survive, which also means an unpopulated field never trips it. There is no
deterministic Brake that can observe the absence, which is precisely the failure mode ADR-0070
is about — a guard that cannot fail is not a guard, and here there is not even a guard.

Two corroborating details argue this is behavioural rather than coincidental. First, ADR-0011
§Decision 4 *named the phasing* ("schema-now / consume-later") and put `commit` origin in the
v1-wires column; the phasing was honoured for `valid_until` (`src/engine.ts:397`) and silently
not honoured for `origin`'s `commit` kind — so the mechanism failed on the half nobody wrote a
test for. Second, when `vfkb broadcast` needed to record *where a cross-repo record came from*,
it did not use `provenance.origin` — it folded a project name into the entry **text** as a
string marker (`src/broadcast.ts:71`, `:87`). A live feature needing exactly the dormant field's
semantics reached past it, because the field had no write surface to reach.

I3 is excluded because its gap has the opposite cause: not an unwatched seam but a deliberate,
ratified design choice that is fully wired.

## Decisions this RFC asks the operator to make

Ordering note: D1 and D5 are independent; D2 is a choose-one; D3 depends on nothing; D4 proposes
no build at all. None of them is urgent, and this RFC does not argue that any of them should
pre-empt the roadmap's ratified order (`docs/H4-DEVELOPMENT-ROADMAP.md` §4).

### D1 — `provenance.origin`: expose it, render it, or leave it dormant

**Proposed: expose and render, in that order, as one small feature.** Roughly what it touches:

1. A write surface — `origin` on `kb_add` (`src/mcp-server.ts:214-230`) and `--origin-*` flags on
   `vfkb add` (`src/cli.ts:162-172`), both feeding the `AddOpts.origin` that
   `src/engine.ts:123` already honours. No engine change.
2. Real validation — replace `z.unknown()` at `src/validate.ts:54` with the discriminated union,
   so a malformed origin is normalized rather than carried.
3. A read path — the origin on the render line (`src/mcp-server.ts:43`), and as a citation in
   `src/export.ts:321-328`.

**The guarantee must be stated weakly and openly.** Maka can make its evidence pointer a foreign
key because it owns a durable event table; vfkb has no transcript, so `{kind:'commit', repo, sha,
path, line}` is a string whose referent nothing can check. This RFC proposes **validating the
shape and documenting that the referent is unverifiable** — not implying a guarantee the
substrate cannot make, and explicitly **not** proposing an event store to back one.

Open sub-question for the operator: whether `verified` provenance should *require* an origin.
That is a Brake, and a Brake that rejects writes is a different risk class from a field that
renders — this RFC proposes it be decided separately, after the surface exists and there is data
about how often an origin is actually available at write time.

### D2 — `recorded_invalid_at`: wire it, or delete it (choose one)

**Proposed: decide, do not defer again.** The field has now been "consume-later" since ADR-0011
with no producer. Both branches are cheap; leaving it in its current state is the only option
this RFC argues against, because a schema field that has never held a value is a claim the
documentation keeps repeating (`docs/FEATURES.md:109`, `:289`).

- **Wire** = a write surface, a clause in `isInjectable` (`src/engine.ts:387-399`) treating
  record-time invalidation distinctly from world-time `valid_until`, and an as-of query in
  `src/read.ts`. This is gated work: `docs/H4-DEVELOPMENT-ROADMAP.md:392-394` names the trigger
  as "the first real as-of query need," which has not been observed. Building it now would
  violate the evidence-gated-build rule.
- **Delete** = remove `src/types.ts:66`, keep the passthrough at `src/validate.ts:61` so any
  entry that ever carried one is not corrupted, and amend `docs/FEATURES.md` §6. The gate entry
  stays in the ledger; if the trigger ever fires, re-adding a field to an append-only JSONL
  envelope is additive and cheap — which was ADR-0011's own argument for adding it early, and
  cuts equally the other way.

**This RFC's recommendation is delete**, on the ground that ADR-0011's stated benefit ("kills
the retrofit debt at the source ... only their *consumption* is phased") did not materialize:
there is nothing stored to retrofit from, so the field bought no migration head start, only a
standing documentation claim.

### D3 — `refs.*`: give the citation renderer something to render

**Proposed: expose `files`, `commit` and `related` on the write surfaces** (`kb_add`,
`vfkb add`), add them to the `refs` construction at `src/engine.ts:112-118`, and validate them
at `src/validate.ts:41-47`. The read path already exists and is already exercised by the
cold-agent export scenarios. **Proposed: delete `task_id` and `workplan_id`** — they name a vtf
task model that does not exist in this repo and have no consumer to serve.

D3 is the cheapest of the three and has the clearest payoff, because the function it feeds is
already shipped and already exercised end to end — `scenarios/okf-bundle-cold-agent.mjs:57` runs
`vfkb export okf` and hands the bundle to a cold agent. What is *not* exercised, and cannot be,
is `okfDoc`'s citations branch: no entry the engine can write reaches it.

### D4 — write-time keys, and the fact that this touches a *gated* decision

The roadmap's gated ledger carries a ratified amendment reading **"S1 gate AMENDED — BM25 first,
embeddings second"** (`docs/H4-DEVELOPMENT-ROADMAP.md:387-391`), with
RFC-003 embeddings demoted to second resort. That amendment considered two options. Write-time
typed key extraction is a **third** that it never weighed: semantic work paid once at write,
retrieval by distinct-key overlap, no service, no round-trip, the deterministic subset staying
deterministic.

**This RFC proposes no build here.** It proposes only that the operator consider whether the
gated ledger should be re-ratified to name three candidate resorts instead of two. Two points of
discipline apply and are stated rather than assumed:

- **Amending a gated decision is itself a decision.** The S1 amendment was ratified; changing its
  candidate set is not editorial and should be an explicit operator ruling, not a side effect of
  accepting this RFC's other clauses.
- **The S1 trigger has not fired.** It is "a 2nd live phrasing-robustness miss, or an explicit
  request." One phrasing miss is recorded in the tree — the devops-kb live turn that motivated
  the stemmer (`src/index-store.ts:31-35`); whether it is the *first* of the two the gate counts
  is UNVERIFIED here, and is the operator's to say. Building on
  the strength of a survey of another project would be precisely the speculative build the
  evidence-gated rule forbids — and the corroboration Maka provides is that *embeddings were the
  wrong first resort*, which the ledger already concluded independently.

### D5 — the structural fix: make the seam observable

Every instance above survived because nothing can fail on an unpopulated field. **Proposed: a
deterministic envelope-coverage check** — a unit test (or a `scripts/` lint in the family of
`adr-lint.mjs`) that enumerates the optional fields of `KnowledgeEntry` and asserts, for each,
that a write site and a read site exist, with an explicit allowlist for fields deliberately left
dormant. A newly declared field then either gets wired or gets an entry in the allowlist naming
the ADR that defers it — which is the deterministic backstop this repo prefers over prose, and
the only clause here that prevents a fifth instance.

## Rejected alternatives

- **Delete all of it — `origin`, `recorded_invalid_at`, the unwritten `refs`.** The strongest
  counter-proposal, and the right answer for I2 (see D2). Rejected for I1 and I4 because both
  have a *live consumer already in the tree*: the distiller genuinely reads `origin`
  (`src/distiller.ts:38`, `:70`), and the OKF citation renderer genuinely reads `refs`
  (`src/export.ts:321-328`). Deleting those would mean deleting shipped behaviour, not dead
  weight. The asymmetry is the whole reason D2 splits from D1/D3.
- **Build the evidence FK properly — an event store the origin can point into.** This is what
  makes Maka's `memory_item_sources` a real guarantee. Rejected: it is a substrate change of a
  different order (a durable transcript table, a retention policy, and a size profile
  incompatible with a repo-committed JSONL brain), proposed off the back of a source reading of
  another project with **no behavioural observation** of it — the research note says so itself in
  its §8. The honest adoption is the weak, shape-validated, openly-uncheckable string in D1.
- **One combined "envelope completion" epic covering all four instances.** Rejected: it would
  bundle a deletion (D2), two small wirings (D1, D3) and an amendment to a gated decision (D4)
  into a single ratification, which is exactly the shape that lets a contested clause ride in on
  an uncontested one. They are separable and are proposed separately.
- **Treat this as documentation debt and fix `docs/FEATURES.md` only.** Rejected as the primary
  response — it would make the docs honest while leaving the citation renderer permanently
  unreachable — but the doc amendments are a *consequence* of whichever of D1/D2/D3 are ratified,
  and are in scope for each.
- **Wire it all now, since it is small.** Rejected on the evidence-gated-build rule. I2
  specifically has a named, unfired trigger; "small" is not a trigger.

## Proof obligation per instance (ADR-0029 / ADR-0050)

Each clause below names what would have to be *observed* before the corresponding work could be
called anything other than unbuilt, and how it could fail. None of these proofs exists today.

- **D1 (`origin` exposed + rendered) — agent-observable, so a full L4.** A scenario in which a
  cold agent is given a brain containing one entry whose `origin` is a `commit` kind, and is
  asked what makes that claim true; the predicate is a **content assertion** that the answer
  contains the sha (ADR-0051 §3 — exit status is not admissible, and "I don't know" is a
  successful run without the capability). **Can-fail arm:** the identical brain with `origin`
  stripped, which must *not* produce the sha. Inner gate: deterministic unit tests that
  `kb_add`/`vfkb add` round-trip each of the four kinds through `src/engine.ts:123` into
  `entries.jsonl`, and that `src/validate.ts` now rejects-and-normalizes a malformed origin (the
  can-fail case being a malformed origin that survives today).
- **D2, delete branch — deterministic only, no scenario.** A test asserting that a legacy entry
  carrying `recorded_invalid_at` still materializes and still injects after the field is removed
  from the type (forward-compat through `looseObject`). It can fail: a strict-schema regression
  would drop the key, which is the only real risk deletion carries.
- **D2, wire branch — deterministic gate clause.** An entry whose `recorded_invalid_at` is in the
  past is excluded by `isInjectable`; the **can-fail arm** is the byte-identical entry without
  the field, which must still inject. A gate clause that excludes both proves nothing.
- **D3 (`refs` write surface) — deterministic, riding the existing export scenarios.** A test
  that an entry written with `files`/`commit` produces a populated `# Citations` block from
  `src/export.ts:321-328`, with the **can-fail arm** an entry with no refs, which must produce no
  `# Citations` heading at all. The cold-agent export scenarios
  (`scenarios/okf-bundle-cold-agent.mjs`) then carry the capability-level claim, since the
  citations are for an agent to read.
- **D4 (write-time keys) — a bench, and the bench is the trigger evidence.** If the operator ever
  unsealed this, the proof would be a committed fixed corpus of query/entry phrasing pairs scored
  against the current read-time stemmer as the baseline; write-time keys must beat that baseline
  to be adopted. **It can fail by not beating it** — which is the point, and is also why the
  bench must be built before the implementation rather than after.
- **D5 (envelope-coverage check) — it must be observed failing first (ADR-0070 §1).** The check
  is only credible if it is run against the tree *as it stands today* and observed to flag I1,
  I2 and I4 before any of them is wired or allowlisted. A coverage check first seen green proves
  nothing.

## Explicitly not in scope

- **No event store, no transcript table, no durable source-of-record for evidence.** D1's origin
  is an uncheckable string by design.
- **No retrieval change.** D4 proposes a queue-position amendment, not an implementation; the
  index (`src/index-store.ts`), the RFC-001 relevance floor and the RFC-002 no-match contract are
  untouched by everything here.
- **No envelope-breaking change.** Every proposal is additive except D2's deletion and D3's
  removal of `task_id`/`workplan_id`, all three of which are of never-written fields and none of
  which alters an existing line in `entries.jsonl`.
- **No change to the trust model, the decision lifecycle, the injection filter's existing
  clauses, or ADR-0011's derived-trust decision.**
- **No claim about Maka's runtime.** The trigger note was read from source and explicitly records
  (§8) that Maka was never built or run. Nothing in this RFC rests on Maka behaving as described.

## Open questions for the operator

1. **D2 — delete or wire?** This RFC recommends delete and argues it above, but the gated-ledger
   entry at `docs/H4-DEVELOPMENT-ROADMAP.md:392-394` is the operator's, and deleting the field
   while keeping the gate is a deliberate combination that needs saying out loud.
2. **D1 — should `verified` provenance require an origin?** A write-rejecting Brake, deliberately
   split out of D1 above.
3. **D4 — does the S1 gated ledger get re-ratified to three candidate resorts?** And if so, does
   that change the *order*, or only the candidate set?
4. **Sequencing.** D3 is the cheapest and has the only already-shipped reader. Is there any
   reason it should not go first, independent of the rest?
5. **Does D5 belong in this RFC at all**, or is an envelope-coverage Brake a standalone proposal?
   It is the clause with the longest reach and the least to do with any individual field.
