---
type: RFC
title: "RFC-041: No task name may enter the comparison — what three defeated designs establish about the tamper detector"
description: "tamper-check answers 'did this change make the suite smaller or quieter' by comparing task NAMES. Three designs have now been defeated on that step: name-counting across the two channels (broken by the vitest 5 bump, #329), presence at a location (#330 round 1), and a location join with a name-disagreement amnesty (#330 round 2, which let a NEWLY ADDED .skip through). This RFC's own first draft proposed a fourth — declared-vs-declared across refs, matched by name — and its adversarial review killed that too: collectTests builds a separate worktree and collector process PER REF, so a name built from Date.now() diverges across refs on a docs-only diff, and the same attack transfers. The contribution is therefore the CONSTRAINT, not a mechanism: no task name may enter any comparison, cross-channel or cross-ref, because the party being checked writes the name expression. A leading name-free candidate is specified with its one known open gap, and the mechanism is deliberately left unsettled rather than becoming a fifth design written in the same session that produced three failures."
status: "Proposed"
timestamp: 2026-10-02
---

# RFC-041: No task name may enter the comparison

- **Status:** Proposed — **the constraint is the proposal; the mechanism is deliberately open**
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
existing cross-ref comparison already works"* — also false: `main` never reports a missing name as a
finding, routing every vanished task through `moved` first (`tamper-check.mjs:365-366`).

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

## Leading candidate (name-free), and its known open gap

Offered as the direction to develop, **not as a settled mechanism**.

**C1 — skips, name-free.** Per file (rename-normalised by git, as `main` already does), compare the
**count of declared tasks whose `mode` is `skip`/`todo`**, base versus head. An increase is the
finding. A newly added `.skip` raises it by one; a rename, a title change, a computed name, a junk
pad and a move between files all leave it unchanged. Counting per *file* also means a skip credit
cannot be transferred between files, which is what the round-6 laundering relied on.

**C2 — narrowing, name-free.** Per file, compare the **delta between declared and runnable counts**,
base versus head — i.e. `main`'s declared-vs-runnable question, aggregated to a count instead of a
name identity, and still **within a ref** so cross-ref divergence cannot reach it. This closes the
count-neutral `-t` attack the first draft would have lost: base `declared 4 / list 4` ⇒ delta 0; head
with one test filtered out and one junk test added ⇒ `declared 5 / list 4` ⇒ delta 1. **Per file, not
per location** — per-location keys false-BLOCK on inserting a single comment line at the top of a
file, which is the most ordinary edit there is (**measured by the adversarial review** on a
per-location variant; `main` itself PASSes that edit).

**C1 and C2 are DERIVED, not yet observed.** The arithmetic above is reasoning over verified channel
behaviour, not an executed probe — no implementation of C1/C2 exists. Every claim about what they
catch or pass is therefore a **hypothesis the build must test**, which is what the Definition of Done
below exists to force. This is stated because the three designs before this one also looked correct
until they were probed.

**C2 requires a normalizer, and alternative B supplies it.** On vitest 5 the declared channel reports
N generated cases where `list` reports one row, so a raw delta would false-BLOCK an honestly added
`it.each` case (derived from the verified channel counts `list=614 / declared=650`, not probed). Vitest exposes a **structural** signal — `task.each === true`, and
`task.suite.each === true` walking ancestors for `describe.each`, **verified present and identical on
4.1.11 and 5.0.2** — so generated tasks collapse to their call site before counting. This is the
sound use of that signal: a **normalizer**, not an amnesty. It is structural rather than
name-derived, and collapsing cannot hide a skip, because a skipped generated block drops out of
`list` entirely and raises the C1 skip count.

**THE KNOWN OPEN GAP, unresolved: the same-file skip swap.** Un-skip a dead test and skip a live one
*in the same file*. C1's per-file skip count is unchanged, C2's delta is unchanged, and the run
channel nets to zero. `main` catches this today by name. Any purely name-free design loses it. Three
possible resolutions, none adopted here:
 (a) accept and document it in the script's "WHAT IT DELIBERATELY DOES NOT CATCH" list;
 (b) use names **only where they are provably static** — a name is static iff the `list` and
     `declared` spellings agree *at the same location within one ref*, which is a within-ref check,
     though it does not discriminate on vitest 4 where `list` interpolates;
 (c) a per-location skip count, guarded against line drift.
**Resolving this is a precondition for the ADR**, not an implementation detail.

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
- The same-file skip swap, pending the open gap above.

## Definition of Done

Per ADR-0029 clause 5 and ADR-0070's own scope, the proof form for a **structural invariant / Brake**
is the deterministic selftest with can-fail arms, **not** an agent-driven L4 — the selftest *is* the
inner gate, and this RFC exists because that gate fired.

1. **NO REGRESSION: every one of the ~44 arms already pinned in
   `scripts/tamper-check.selftest.mjs` still holds, on vitest 4.1.11 AND 5.0.2.** Each was pinned
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
   line at the top of a test file.
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

- **#330 will be closed as superseded** once this is accepted. Its branch
  (`fix/tamper-check-vitest5-generated-names`) **must not be deleted**: it carries the only copy of
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
