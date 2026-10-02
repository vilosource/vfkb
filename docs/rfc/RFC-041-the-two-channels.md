---
type: RFC
title: "RFC-041: The two channels — stop asking a static parse and a runtime collection to agree on a task name"
description: "tamper-check answers one question through two channels: `vitest list` (what the resolved test command RUNS) and a collect-only pass (what the file DECLARES). It reconciles them by task NAME. The vitest 5 bump (#329) showed that reconciliation is unsound, and two attempts to repair it (#330, rounds 1 and 2) both produced a defeatable Brake — the second one let a NEWLY ADDED .skip through, the exact shape the detector exists to catch. The root cause is not vitest 5 and not `.each`: v5's list channel is a STATIC PARSE that reports a name expression's unevaluated source text, while the declared channel is a RUNTIME COLLECTION that reports its evaluated value. No rule built on comparing those two names can be sound, because the party being checked writes the name expression. This RFC moves the skip question to DECLARED-VS-DECLARED ACROSS REFS, where `mode` is authoritative and there is only one channel, and leaves the list channel answering narrowing at NAME-FREE granularity."
status: "Proposed"
timestamp: 2026-10-02
---

# RFC-041: The two channels

- **Status:** Proposed
- **Date:** 2026-10-02
- **Deciders:** operator + Claude
- **Relates:** [ADR-0075](../adr/ADR-0075-the-software-factory.md) clause 3 and
  [RFC-039](RFC-039-the-software-factory.md) D8 — the tamper detector this re-specifies ·
  [ADR-0052](../adr/ADR-0052-review-gate.md) — the honest-work clause that makes a false BLOCK a
  defect · [ADR-0070](../adr/ADR-0070-guards-that-can-fail.md) §2 (mutation log) and §4 (the
  escalation that produced this RFC) · brain gotcha `43c1af80effb` (the two-round arc)
- **Supersedes in practice:** PR #330, both of its designs
- **Blocks:** #329 (dependabot vitest `^5.0.2`) until built

## Why this RFC exists

`scripts/tamper-check.mjs` asks one question — *did this change make the test suite smaller or
quieter?* — and answers it from two observations at each ref:

1. **RUNNABLE** — `vitest list`, run through a wrapper that intercepts the project's own
   `npm test`, so it reflects the **resolved test command**: positional filters, `-t`,
   `--exclude`, `--project`, and `vitest.config` includes/excludes (`tamper-check.mjs:157`).
2. **DECLARED** — a collect-only `createVitest` pass over direct specifications, which
   **deliberately bypasses** that config so a newly narrowed `exclude` cannot hide a task
   (`tamper-check.mjs:220`).

`disabledCounts` then decides, per declared task, whether it still runs — by **comparing task
names across those two channels**. That is the unsound step, and everything below follows from it.

## What was observed

Dependabot's vitest 5 bump (#329) is green on `test (20|22|24)` — the unit suite is fully
vitest-5 clean — and red **only** on `review-gate`, where exactly the two generated-name
**honest-work** arms of the detector's own selftest go BLOCK while every attack arm holds. The
defect was in the gate, not the tests, and the selftest's can-fail arm is what surfaced it.

Two repairs were attempted on #330. Both were adversarially reviewed; both failed.

| attempt | rule | how it failed |
|---|---|---|
| round 1 (`afdae91`) | runnability = **presence** of any list row at the task's `file:line:column` | `describe.each` puts several *differently-named* tasks at ONE location, so a `-t` narrowing that dropped one left the **sibling vouching for it** |
| round 2 (`01b6812`) | per location, **by name**, with an amnesty for a list row whose name the declared channel lacks | the amnesty fires on **name disagreement**, which the checked party controls — see below |

Round 2's defeat, verified end to end against three engines on vitest 4.1.11 (the version `main`
pins). The two channels run in **different processes**, so `npm_lifecycle_event` alone diverges
them, with no `.each` anywhere:

```js
for (const n of [1, 2]) (n === 2 ? it.skip : it)(
  n === 1 ? `probe ${process.env.npm_lifecycle_event}` : 'victim', () => {…});
```

`list` sees `probe test`; `declared` sees `probe undefined`. The unmatched row amnesties the
sibling, and a **newly added `.skip`** — the shape ADR-0075 clause 3 / RFC-039 D8 names verbatim —
goes unreported:

```
origin/main 101c61a   BLOCK   TAMPER [tests-disabled] test/a.test.ts › victim
01b6812               PASS    "tamper-check PASSED — the suite was not weakened"
```

The run channel is no obstacle: it is paid off with the documented round-6 laundering — un-skip a
base `.skip` to buy the credit, add a junk test to hold the per-file count.

The same remedy also **cost honest work**: a *placeholder-free* `it.each` title yields, on vitest 5,
one list row whose name is identical to the N declared names, so cardinality invents N−1 disabled
tasks and an honestly added case is reported as a weakening *while the run line reads
`3 → 4 passed`*. That regression was introduced by round 1's fix relative to the artifact round 1
reviewed, which is the literal **ADR-0070 §4** trigger, and is why this is an RFC instead of a
third patch.

Amnesty blast radius on vfkb's real suite: **0 of 650** tasks on vitest 4.1.11, **66 of 650 at 30
locations** on vitest 5.0.2.

## The root cause, stated precisely

It is not vitest 5, and it is not `.each`. Measured on the same fixture, both runners:

| construct | `list` (runnable) on v4 | `list` on v5 | `declared` (both) |
|---|---|---|---|
| `it.each([1,2])('case %s')` | `case 1`, `case 2` | **`case %s`** — one row | `case 1`, `case 2` |
| `it.each([1,2])('noplaceholder')` | `noplaceholder` ×2 | `noplaceholder` ×1 | `noplaceholder` ×2 |
| `` it(`tpl ${sfx}`) `` | `tpl lit` | **`tpl ${sfx}`** | `tpl lit` |

The third row is decisive, because a template literal is not `.each` at all. **Vitest 5's `list`
is a static parse that reports the name expression's unevaluated source text; the declared channel
is a runtime collection that reports its evaluated value.** `.each` patterns were merely the most
visible instance.

Therefore **no rule that compares a task name across these two channels can be sound**, because
the name expression is written by the party being checked. This is the same structural lesson that
killed three successive hand-written scanners and the `Tamper-Waiver:` trailer: *free input the
checked party controls is not evidence*.

## Proposal

**Never ask the two channels to agree on a task name.** Split the question by what each channel can
authoritatively answer.

### 1. The skip/disable question moves to DECLARED-VS-DECLARED across refs

A declared task carries `mode` (`run` / `skip` / `todo`) from Vitest itself. Compare the declared
channel at base against the declared channel at head, matched by name **within the same channel**:
a task that was `run` at base and is `skip`/`todo` at head, or that vanished from the declared set,
is the finding. There is **one** channel, so the disagreement this RFC is about cannot arise.

Two properties make this sound, and both are already true of the current code:

- **Cross-ref name matching within one channel is legitimate.** Both inventories are produced by
  the *same* runtime collector, so a computed name evaluates the same way at both refs. This is
  also how the existing cross-ref comparison already works, and why it must stay keyed by name
  rather than by location: line numbers shift whenever anything *above* a test is edited.
- **Both refs are collected with the SAME installed Vitest.** `collectTests` borrows
  `node_modules` from the `repo` argument (`tamper-check.mjs:116-137`), so even on a PR that bumps
  Vitest itself, base and head are observed through one engine. A version bump therefore cannot
  manufacture a difference — which matters, because #329 *is* such a PR.

### 2. The narrowing question stays with `list`, at NAME-FREE granularity

Config `exclude`/`include`, `-t`, positional filters and `--project` are invisible to the declared
channel by design, so the list channel must still answer them — but only questions that need no
name identity: **per-file (and per-location) counts of collected rows, base versus head.** A drop
not accounted for by declared-channel deletions is narrowing. Counting rows is immune to the
static/runtime divergence because it never compares a name to a name.

### 3. The run channel is unchanged

`runCounts` and its three columns (`passed` / `failed` / `skipped`) stay exactly as they are. They
are the only observation that sees a runtime `ctx.skip()` or a `setupFiles` shutdown, and they
remain the backstop for count-neutral narrowing.

### 4. What this explicitly does NOT close

Stated here because a gate that overstates its reach is read as coverage it does not have:

- **On vitest 5, a `-t` matching the UNINTERPOLATED name of a generated block** (`-t "case %s"`)
  keeps the row while no case runs. One row cannot report how many cases it stands for, so no
  design in this RFC closes it. Verified **pre-existing** — `origin/main` misses it identically.
  Only the run channel sees it, and the run channel can be paid off with skip credits.
- Sub-file narrowing held count-neutral by added junk. Mitigated, not closed, by per-file counting
  plus the run channel — unchanged from today.

## Alternatives considered

**A. Location join with an amnesty keyed on name disagreement** (#330 round 2). **Rejected** — the
amnesty trigger is attacker-controllable in one line, evidence above. This is the proposal this RFC
replaces, and it is recorded because it looks correct right up until it is probed.

**B. Amnesty keyed on STRUCTURAL `.each`-ness.** Vitest exposes a real, version-stable signal:
`task.each === true` for `it.each`, and `task.suite.each === true` walking ancestors for
`describe.each` — verified present and identical on 4.1.11 and 5.0.2. Keying the amnesty on that
closes both the round-2 bypass (the attack needs a *non*-`.each` task amnestied, and it no longer
would be) and the placeholder-free false BLOCK. **Not chosen**, because a template-literal name has
no such signal — it is a plain `it` with a computed name — so it still needs a separate
name-cardinality clause, i.e. it still rests on the comparison this RFC is retiring. **Recorded as
the cheap fallback** if §1 stalls: it is a smaller change that preserves the current architecture,
and it would want its own adversarial round on the cardinality clause.

**C. Pin Vitest to `^4` indefinitely.** **Rejected as the primary path.** It is genuinely free
today — `main` on vitest 4 has the two channels agreeing 650/650, zero amnesties, every selftest arm
green, and no false BLOCK on the shape that breaks under v5. The cost is that the trigger stops
being ours: a Node support drop, an advisory, or a transitive dependency turns this into an
emergency rewrite of a Brake under time pressure, which is the worst condition for this file.

**D. Make the two channels run in the same process** so `npm_lifecycle_event` matches.
**Rejected** — it closes one lever, not the class. A name built from `Math.random()` or `Date.now()`
diverges regardless.

## Definition of Done

Per ADR-0029 / ADR-0050, the proof form for a **structural invariant / Brake** is the deterministic
selftest with can-fail arms, **not** an agent-driven L4 — the selftest *is* the inner gate, and this
whole RFC exists because that gate fired. Specifically:

1. **Every attack from this arc lands as a committed selftest arm**, each observed RED first under a
   named mutation with the anchor verified applied (ADR-0070 §2):
   - the manufactured-divergence **newly added `.skip`** (`npm_lifecycle_event`), which is the one
     that matters most — it is the shape D8 names;
   - the `describe.each` same-location `-t` narrowing;
   - a placeholder-free `it.each` with an honestly added case → must **PASS**;
   - a template-literal honest rename → must **PASS**;
   - the two vitest-5 generated-name honest renames → must **PASS**.
2. **The selftest must be green on vitest 4.1.11 AND 5.0.2**, and the attack arms must be observed
   BLOCKING on both. A fix verified on one runner is not verified.
3. **Arms whose predicate is a content assertion over the output**, not an exit code, wherever the
   failure presents as a successful run that merely lacks the finding (ADR-0051 §3, the
   quiet-success trap). The round-2 live arm is the precedent: it passes on v5 while naming a test
   that ran.
4. **No arm may be listed in the mutations log unless it was observed red.** A guard that stays
   green under its mutation is a finding, not a log entry.
5. **#329 rebases onto the result and goes green on its own CI** — observed, not predicted. That it
   would is currently an expectation only.

## Consequences

- **#330 is closed as superseded.** Its evidence survives in brain gotcha `43c1af80effb`, in
  `reviews/01b681230bf76f9ef8c999afba1f3de7d34c8e8b.json` on its branch (which must not be deleted),
  and in this RFC. One non-behavioural gain from it is worth porting regardless: the newly
  documented pre-existing `-t`-on-an-uninterpolated-name hole in the script's own
  "WHAT IT DELIBERATELY DOES NOT CATCH" list.
- **#329 stays blocked** until this is built. It cannot merge while the Brake false-BLOCKs honest
  generated-name work.
- The detector gets **simpler**, not more clever: one fewer cross-channel inference, and the two
  channels each answer only what they can authoritatively answer.
- On acceptance this becomes an **ADR** re-specifying ADR-0075 clause 3's mechanism (the clause's
  *intent* is unchanged), plus a build tracker issue.

## Provenance of claims this RFC cannot source from a committed record

Everything in **What was observed** and **The root cause** was executed in-session on 2026-10-01
against three engines (`origin/main` 101c61a, `afdae91`, `01b6812`) on both vitest 4.1.11 and
5.0.2, driving `main()` end to end over synthesized git fixtures. The `0 of 650` / `66 of 650`
figures were re-derived after an initial miscount: `collectTests` borrows `node_modules` from its
`repo` argument, so a first measurement labelled "vitest 5" had in fact run vitest 4 — the tell was
`list=650 declared=650`, i.e. the channels agreeing, which is the v4 signature. The structural
`.each` signal in alternative B was probed directly through `createVitest` on both runners.
