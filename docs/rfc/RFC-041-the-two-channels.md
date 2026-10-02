---
type: RFC
title: "RFC-041: No task name may enter the comparison — what three defeated designs establish about the tamper detector"
description: "tamper-check answers 'did this change make the suite smaller or quieter' by comparing task NAMES. Three designs have now been defeated on that step: name-counting across the two channels (broken by the vitest 5 bump, #329), presence at a location (#330 round 1), and a location join with a name-disagreement amnesty (#330 round 2, which let a NEWLY ADDED .skip through). This RFC's own first draft proposed a fourth — declared-vs-declared across refs, matched by name — and its adversarial review killed that too: collectTests builds a separate worktree and collector process PER REF, so a name built from Date.now() diverges across refs on a docs-only diff, and the same attack transfers. The contribution is therefore the CONSTRAINT, not a mechanism: no task name may enter any comparison, cross-channel or cross-ref, because the party being checked writes the name expression. A leading name-free candidate is specified with its one known open gap, and the mechanism is deliberately left unsettled rather than becoming a fifth design written in the same session that produced three failures."
status: "Proposed"
timestamp: 2026-10-02
---

# RFC-041: No task name may enter the comparison

- **Status:** Proposed — **HELD. Round 2 returned REDESIGN and ADR-0070 §4 fired a SECOND time on
  this arc. The constraint below is wrong in both directions on measurement, and the candidate is
  the FIFTH defeated design. Awaiting an operator ruling; no replacement is proposed here.**
- **Date:** 2026-10-02
- **Deciders:** operator + Claude
- **Relates:** [ADR-0075](../adr/ADR-0075-the-software-factory.md) (the tamper-detection clause —
  the one naming *"a deleted test, an added `.skip` and a `|| true`"*, ADR-0075:62) and
  [RFC-039](RFC-039-the-software-factory.md) D8 — the detector this re-specifies ·
  [ADR-0052](../adr/ADR-0052-review-gate.md):68 — *"A gate that blocks honest work is a defect, not
  caution"* · [ADR-0070](../adr/ADR-0070-guards-that-can-fail.md) §2 (mutation log), §4 (the
  escalation that produced this RFC) · brain gotcha `43c1af80effb`
- **Supersedes in practice:** PR #330, both of its designs
- **Blocks:** #329 (dependabot vitest `^5.0.2`) until the mechanism is settled *and built*

## What this RFC's first draft got wrong

The first draft proposed moving the skip question to **declared-vs-declared across refs, matched by
name**, and argued it was sound because *"both inventories are produced by the same runtime
collector, so a computed name evaluates the same way at both refs."*

**That claim is false, and this document's own alternative D refuted it two sections later.**
`collectTests` creates a **separate `mkdtempSync` worktree** (`tamper-check.mjs:122`) and a
**separate `node --eval` collector process** (`:220`) **per ref** — two worktrees, two processes,
two wall-clock times. Observed against a **docs-only** diff, with no test touched:

```
BASE declared names: ["stable","victim 1790923632902","where K7EX0I"]
HEAD declared names: ["stable","victim 1790923633900","where LhdaK3"]
=> 2 of 3 declared names DIFFER across refs
```

The adversarial review then showed the #330 round-2 attack **transfers intact**: with
`` it(`victim ${Date.now()}`) ``, skipping it, padding the file with one junk test and un-skipping a
base `.skip` for the run credit, the draft's design **PASSED a newly added `.skip`** on vitest 4.1.11
*and* 5.0.2, where `main` BLOCKs and names the test. The draft also claimed its rule was *"how the
existing cross-ref comparison already works"* — also false: `main` tries two `moved`
routes first (`tamper-check.mjs:365-366`) and only then reports `deleted` (`:367`). A missing name
alone is not sufficient for a finding, which is the point; an earlier version of this sentence
overstated it to *"main never reports a missing name as a finding"*, which is false — a `git rm` does
yield `[tests-removed]`.

That is a **fourth** defeated design, and it is why this RFC no longer proposes a mechanism.

## The setup

`scripts/tamper-check.mjs` answers *did this change make the test suite smaller or quieter?* from two
observations per ref:

1. **RUNNABLE** — `vitest list`, run through a wrapper that intercepts the project's own `npm test`,
   so it reflects the **resolved test command**: positional filters, `-t`, `--exclude`, `--project`,
   and `vitest.config` includes/excludes (`tamper-check.mjs:157`).
2. **DECLARED** — a collect-only `createVitest` pass over direct specifications, which
   **deliberately bypasses** that config so a newly narrowed `exclude` cannot hide a task (`:220`).

Every design so far has reconciled these, or their cross-ref images, **by task name**.

## The root cause (verified, and the one part of this RFC that survived review intact)

| construct | `list` on v4 | `list` on v5 | `declared` (both) |
|---|---|---|---|
| `it.each([1,2])('case %s')` | `case 1`, `case 2` | **`case %s`** — one row | `case 1`, `case 2` |
| `it.each([1,2])('noplaceholder')` | `noplaceholder` ×2 | `noplaceholder` ×1 | `noplaceholder` ×2 |
| `` it(`tpl ${sfx}`) `` | `tpl lit` | **`tpl ${sfx}`** | `tpl lit` |

The third row is decisive, because a template literal is **not `.each` at all**. **Vitest 5's `list`
is a static parse that reports the name expression's unevaluated source text; the declared channel is
a runtime collection that reports its evaluated value.** `.each` was merely the most visible instance.

## The constraint this RFC proposes

> **No task name may enter any comparison the detector's verdict rests on — not across the two
> channels, and not across refs.**

A task name is an **expression written by the party being checked**. It can be made to differ between
any two observations: across channels by the static/runtime split or by process state
(`npm_lifecycle_event`), and across refs by wall-clock time, `process.cwd()`, the temp worktree path,
`Math.random()` or the pid. Brain gotcha `43c1af80effb` already states the general rule —
*"a reconciliation rule whose trigger the checked party can manufacture is not a Brake"* — and the
error in three of the four designs was scoping it to *cross-channel* comparison.

The four defeats, each reproduced end to end:

| design | where names entered | how it died |
|---|---|---|
| `main` today | declared vs runnable, per `file::name`, **within a ref** | vitest 5's static/runtime split ⇒ false BLOCK on honest generated-name work (#329) |
| #330 round 1 `afdae91` | presence at a location (names dropped entirely) | `describe.each` puts differently-named tasks at ONE location ⇒ a sibling vouches for a silenced task |
| #330 round 2 `01b6812` | amnesty when a list row's name is unmatched | amnesty trigger is attacker-written ⇒ **a newly added `.skip` PASSES** |
| this RFC's first draft | declared vs declared, **across refs**, by name | names diverge across refs ⇒ **a newly added `.skip` PASSES** |

Note the symmetry of the last two: moving the comparison from cross-channel to cross-ref moved the
lever from `npm_lifecycle_event` to `Date.now()` and made it *worse*, because two refs are two
worktrees at two times whereas the two channels were at least one ref.

## The fifth defeated design: C1+C2 (name-free counts) — struck

This section previously proposed a candidate. **Round 2 implemented it and measured it against the
committed 44-arm selftest on both runners. It is defeated.** It is recorded as evidence, not a proposal.

The design was: **C1** — per file, compare the count of declared tasks whose `mode` is `skip`/`todo`;
**C2** — per file, compare the declared-minus-runnable count delta, within a ref, with `task.each` /
`task.suite.each` collapsing generated tasks to their call site as a **normalizer**.

| what was measured | result |
|---|---|
| `main`, 44-arm selftest | **44/44 on v4**, **42/44 on v5** (the two v5 reds are the honest-work arms that make #329 red; every attack arm holds) |
| C1+C2, strict | **43/44 on v4** — loses the pinned attack arm *"count-neutral swap: delete a real file, add junk tests"* (`selftest:89`) |
| C1+C2, plus the per-file collected-count deletion rule | **43/44** — arm 89 goes green, but *"moving a test between two test files"* (`selftest:116`) goes RED, and **DoD item 3 requires it to PASS** |

Three defects, each structural rather than an artifact of the implementation:

1. **Neither C1 nor C2 answers "did a test disappear."** Both only compare declared against runnable
   *within* a file. `main` answers deletion at `tamper-check.mjs:358-367`. Under C1+C2 a plain
   `git rm` contributes `no longer collected 0` from the collection half and blocks only via the run
   channel — which a junk pad neutralises.
2. **The constraint and the no-regression DoD clause are jointly unsatisfiable.** Cross-file
   move-versus-deletion disambiguation needs an *identity*; `main` uses the vanished task's NAME
   across files (`:365`), which is exactly what the constraint forbids. The constraint removes the
   only identity in the detector, supplies no replacement, and the DoD then requires the behaviour
   that identity buys.
3. **The normalizer is blind to loop-generated tests, so C2 does not fix #329 for vfkb's own suite.**
   `vitest list` rows carry only `{name, file, location}` — **no `each` flag on that channel at all**
   (observed). A plain-`for`-loop test has `task.each === undefined` and no `each` suite ancestor,
   identically on 4.1.11 and 5.0.2, and on v5 such a site still collapses to ONE list row carrying
   unevaluated source. vfkb has **two such live sites** — `src/hook-stdin-failopen.test.ts:153` and
   `test/realpath-git-paths.test.ts:345`, both template literals inside loops. Observed on the real
   suite: `test/realpath-git-paths.test.ts` reports **list=18 declared=18 on v4** but **list=15
   declared=18 on v5**. Extending either list is ordinary honest work that C2 would BLOCK on v5 — the
   exact defect class RFC-041 exists to remove.

Defect 3 is the sharpest self-refutation: this document's own root-cause table says a template literal
is *"not `.each` at all"* and that `.each` was *"merely the most visible instance"* — then selects
`.each` as the normalizer.

## The constraint is wrong in BOTH directions (round 2, measured)

- **Too strong.** It bans a comparison that is sound and load-bearing, at measured cost: defect 2.
  This document's own open-gap resolution (b) then proposed *"use names only where they are provably
  static"*, contradicting the absolute sentence two sections earlier.
- **Too weak.** It is silent on the two keys the candidate actually rested on. **Per-file counts** are
  manufacturable by the checked party — precisely what the cited gotcha `43c1af80effb` forbids
  (*"a reconciliation rule whose trigger the checked party can manufacture is not a Brake"*); the
  constraint quotes that to kill names and exempts counts without argument. And **`location`**: the
  same gotcha's title reads *"CANNOT BE RECONCILED BY TASK NAME **OR BY LOCATION**"*, and this
  document dropped the location half when quoting it, then used location as C2's collapse key. That
  use is defensible — within a ref, immune to line drift — but the document rejects per-location keys
  for a reason that does not apply to the use it makes of them, and never says so.

Round 2's proposed direction, recorded for the operator and **not adopted here**: restate the rule as
an **admissibility test over comparison keys** — a key is admissible only if attested *outside the
checked party's collection-time control* (git for paths, the structural task graph for `mode` and
`each`), with names admissible only under a within-ref staticness proof. That is a different
proposal, not an edit to this one.

## Why the mechanism is deliberately left open

Four designs have been defeated, three of them written in the session that produced this document.
ADR-0070 §4 exists because iterating a guard under end-of-chain momentum produces exactly this
pattern, and its escalation already fired once on #330. Writing a fifth design here and declaring it
sound would be the same failure one level up: the honest output of this session is the **constraint**
plus a verified **problem characterisation**, which is what the next design must satisfy and what no
previous attempt had.

## Alternatives considered

**A. Presence at a location** (#330 round 1). Rejected — differently-named tasks share a location.

**B. Structural `.each`-ness as an amnesty.** Rejected *as an amnesty* — a template-literal name has
no such signal, so it still needs a name-cardinality clause. **Promoted to a normalizer in C2**,
which is its sound use.

**C. Pin Vitest to `^4` indefinitely.** Rejected as the primary path, but it is genuinely free today:
`main` on vitest 4 has the two channels agreeing 650/650, zero unmatched rows, and every selftest arm
green. The cost is that the trigger stops being ours — a Node support drop, an advisory, or a
transitive dependency turns this into an emergency rewrite of a Brake under time pressure.

**D. Make the two channels run in the same process.** Rejected — closes one lever, not the class.

**E. Declared-vs-declared across refs, by name** — this RFC's first draft. Rejected on the evidence
above. Recorded because it is the most natural-looking idea in the space and it is unsound.

## What no design in this space closes

Stated because a gate that overstates its reach is read as coverage it does not have:

- On vitest 5, a `-t` matching the **uninterpolated** name of a generated block (`-t "case %s"`)
  keeps the list row while no case runs; one row cannot report how many cases it stands for.
  Verified **pre-existing** — `main` misses it identically. **UNVERIFIED** whether it is exploitable
  past the run channel end to end: the collection half is confirmed, but the one attempt to build the
  full attack was caught by `[more-tests-skipped]`.
- **The credit-laundering family is broader than first stated, and two members defeat `main` TODAY**
  (round 2, observed on both runners): un-skip a dead test *and* convert a live test in the same file
  to a runtime `ctx.skip()` ⇒ `main` PASSes (its pinned arm `selftest:142` covers only the variant
  where the base skip becomes a *failure*, which the `failed` column sees); and delete one generated
  `it.each` case while padding with one junk test in the same file ⇒ `main` PASSes. **Pre-existing in
  `main`**, not introduced by any draft here, but listed because a future design would otherwise be
  credited with reach it does not have.
- On **vitest 4**, `main` false-BLOCKs a **docs-only** diff whenever a test name is computed
  non-deterministically (round 2, observed: `[tests-disabled]` on 2 tasks with `collected 4 → 4`). So
  alternative C is free only for the suite *as written today*.

## Definition of Done

Per ADR-0029 clause 5 and ADR-0070's own scope, the proof form for a **structural invariant / Brake**
is the deterministic selftest with can-fail arms, **not** an agent-driven L4 — the selftest *is* the
inner gate, and this RFC exists because that gate fired.

1. **NO REGRESSION: every one of the 44 arms pinned in `scripts/tamper-check.selftest.mjs` still
   holds, on vitest 4.1.11 AND 5.0.2.** Baselines, measured: `main` is **44/44 on v4** and **42/44 on
   v5**, where the two v5 reds are *"renaming generated it.each cases without disabling them"* and
   *"changing a generated template-literal name without disabling it"* — the honest-work arms the
   redesign must turn **green**, with every attack arm still holding. Each was pinned
   because it defeated a previous version. This clause is load-bearing and its absence from this
   RFC's first draft was a review finding: the draft's own DoD would not have caught any of the three
   defeats found in it.
2. **Every attack from this arc lands as a committed arm**, each observed RED first under a named
   mutation with the anchor verified applied (ADR-0070 §2): the `npm_lifecycle_event` manufactured
   divergence; the `Date.now()` **cross-ref** divergence; the `describe.each` same-location `-t`;
   the count-neutral `-t`-plus-junk narrowing.
3. **Honest-work arms that must PASS**, on both runners: a title rename in place and to something
   unrelated; a test moved **between two test files**; a placeholder-free `it.each` with an added
   case; a template-literal rename; the two vitest-5 generated-name renames; inserting a comment
   line at the top of a test file; **an added LOOP-generated case** and an added `describe.each` case
   (the loop case is the one honest arm round 2 measured RED against the struck candidate).
4. **A config-`exclude` arm that blocks by DETECTION, not by failing closed.** The existing pin
   writes `exclude: ['test/b.test.ts']`, which replaces vitest's default exclude so `node_modules`
   gets collected and collection dies — it blocks for the wrong reason, and C2 moves the
   config-exclude question onto a mechanism that pin does not exercise. Reproduced: that spelling
   yields *"vitest could not collect tests at the head"*, whereas
   `exclude: ['**/node_modules/**','**/dist/**','test/b.test.ts']` yields a real `[tests-disabled]`
   plus `[fewer-tests-ran]` finding.
5. **Content assertions over output**, not exit codes, wherever a failure presents as a successful
   run that merely lacks the finding (the quiet-success trap, ADR-0051 §3).
6. **No arm listed in the mutations log unless observed red.** A guard that stays green under its
   mutation is a finding, not a log entry.
7. **The same-file skip swap is resolved or explicitly documented** before the ADR.
8. **#329 rebases onto the result and is OBSERVED green on its own CI** — currently an expectation
   only.

## Consequences

- **#330 will be closed as superseded** once this is accepted. The **remote** branch
  `origin/fix/tamper-check-vitest5-generated-names` **must not be deleted** (the record lives there,
  not on `origin/main`): it carries the only copy of
  `reviews/01b681230bf76f9ef8c999afba1f3de7d34c8e8b.json`.
- **#329 stays blocked** until the mechanism is settled and built.
- One non-behavioural gain from #330 is worth porting regardless: the newly documented pre-existing
  `-t`-on-an-uninterpolated-name hole in the script's own "does not catch" list.
- Brain gotcha `43c1af80effb` notes that #330's head catches a same-location `-t` attack on vitest 5
  where `main` is blind, and asks for that gain to survive any redesign. Whether C2 preserves it is
  **UNVERIFIED** and must be checked during the build.
- On acceptance this becomes an **ADR** stating the constraint and the settled mechanism; ADR-0075's
  tamper clause keeps its *intent* and gains a re-specified mechanism.

## Provenance of claims this RFC cannot source from a committed record

Everything in **The root cause**, **the constraint's defeat table** and **What this RFC's first draft
got wrong** was executed on 2026-10-01/02 against `origin/main` 101c61a, `afdae91` and `01b6812`, on
both vitest 4.1.11 and 5.0.2, driving `main()` end to end over synthesized git fixtures. Three
corrections are on the record rather than silently fixed:

- The `0 of 650` / `66 of 650` figures were re-derived after an initial miscount: `collectTests`
  borrows `node_modules` from its `repo` argument, so a first measurement labelled "vitest 5" had in
  fact run vitest 4 — the tell was `list=650 declared=650`, the v4 signature of agreeing channels.
- The first draft cited `tamper-check.mjs:176`/`:238`/`:122-140`; those line numbers came from the
  #330 branch, where added comments had shifted them, and are corrected here against `main`.
- The first draft reported only one attribution of the placeholder-free false BLOCK. The committed
  record (R2-M1) says **both** hold: introduced by #330 round 1 relative to the artifact round 1
  reviewed, **and** pre-existing on `origin/main` under vitest 5 (independently re-verified: `main`
  on v5 BLOCKs that shape; on v4 it PASSes). The escalation framing rests on the first; the second is
  equally true and was omitted.
