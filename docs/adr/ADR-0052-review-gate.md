---
type: Decision
title: "ADR-0052: The adversarial review of every implementation change is mechanically enforced"
description: "The standing rule 'after every major implementation launch a review agent' was skipped on four PRs in one day, because the command that carried it was scoped to a branch topology that had dissolved. The rule is restated independent of topology, and enforced by a CI Brake: a PR touching implementation paths fails without a review record bound to its head sha, whose verdict the gate recomputes from its own findings."
status: "Accepted"
timestamp: 2026-07-10
---

# ADR-0052: The adversarial review of every implementation change is mechanically enforced

- **Status:** Accepted (operator ruling, 2026-07-10)
- **Date:** 2026-07-10
- **Supersedes:** the `v2-review` project command (`.claude/commands/v2-review.md`), replaced by
  `.claude/commands/review.md`
- **Relates:** [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md) (a prose rule with no Brake gets
  skipped), [ADR-0051](ADR-0051-delivery-honesty.md) (the same architecture: verify committed
  evidence in CI, never trust prose), [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md)
  (a proof that cannot fail proves nothing), [ADR-0036](ADR-0036-v2-two-branch-strategy.md)
  (the branch topology this command was scoped to), brain decision `1cf647f35571`

## Context — the rule did not fail; it became inapplicable

On 2026-07-06 the operator asked for a standing practice: *"after every major implementation launch
a review agent."* It was recorded as an accepted decision (`1cf647f35571`) and implemented as a
project command, `.claude/commands/v2-review.md` — an adversarial, fresh-eyes subagent with a
six-point rubric, wired into the V2-ROADMAP update protocol.

On 2026-07-08, v2 shipped to `main` (PR #86). The command's three anchors dissolved with it:

- its **base ref** was `git diff v2...HEAD`. With v2 fully merged, that diff no longer describes the
  change under review. Run against PR #104 it would have handed a reviewer **99 files for a 5-file
  change**;
- its **authority** was `docs/V2-ROADMAP.md`, a tracker for a fork that had shipped;
- its **trigger** was "a v2 initiative branch, before its merge into `v2`" — a workflow that no
  longer existed.

On 2026-07-09 the agent self-merged four PRs, two of them substantial implementations, running no
review. This was not disobedience. The rule's preconditions could never be met again, so there was
nothing to skip. **A rule whose preconditions can silently stop existing is weaker than prose** —
prose at least still reads as a rule.

Run retroactively on those merges, the review found, in nine rounds, **fifteen real defects the
author had not found**: six false-greens that defeated ADR-0051's *"the violation is silence"*
(the mandated disclosure passed while hidden in an HTML comment, a code fence, `<script>`,
`<details>`, an unterminated fence, and — one blockquote or one list-marker deep — all of them
again); a single-trial record passing as DEMONSTRATED, which is exactly the failure ADR-0050 was
written to stop, sailing through the Brake written to stop it; seven false-REDs that would have
blocked honest releases; and a critical case where setting one field turned the entire delivery
Brake off. Twice, a committed selftest case passed while the defect it named was live.

The author had watched his own gate go red 18 times and believed it worked.

## Decision

### 1. The rule is restated independent of branch topology

**Every change to implementation paths gets an adversarial, fresh-eyes review before merge.** Not
"every v2 initiative." Implementation paths are `src/`, `test/`, `scenarios/`, `scripts/`,
`.claude/commands/`, `.github/workflows/`, and `reviews/OPERATORS`. Exempt: `docs/`, `.vfkb/`,
`README.md`, `CLAUDE.md`, the review records themselves (`reviews/<sha>.json`, `reviews/README.md`),
and **`scenarios/records/`** — the same carve-out ADR-0029 makes for pure-doc edits and sub-tasks.

`scenarios/records/` is exempt deliberately: committing L4 evidence *is* the project's DoD workflow
(ADR-0022/0029), and forcing an adversarial code review onto a PR that adds nothing but a scenario
record would block honest work. A gate that blocks honest work is a defect, not caution.

The command is `.claude/commands/review.md`. Its base ref is the merge-base with `main`; its
authority is the change's own governing ADR/RFC, named explicitly or inferred, and *a change with no
governing document stops the review* — a review with no standard to review against is an opinion.

### 2. It is enforced by a deterministic CI Brake

`scripts/review-gate.mjs` fails a PR that touches implementation paths and carries no
`reviews/<sha>.json` for the code being merged. The record is bound to the sha that was **reviewed**;
because filing it changes the head sha, the gate accepts a record whose sha is HEAD, or HEAD with
trailing commits stripped when those commits add *nothing but review records*. A commit touching code
after the review invalidates it.

**A merge commit is never stripped.** `git show --name-only` prints nothing for a merge, so
`[].every(isReviewRecord)` is vacuously true; the first version of this walked straight through
merges down the first-parent line until it found some *other* pull request's review record, and
passed a merge of entirely unreviewed code. An empty file list now stops the walk, and so does a
second parent. (The same vacuous-truth bug — a predicate over an empty set — had already appeared in
the release gate's contrast arm. It is worth knowing that this class recurs.)

CI must also check out the pull request's **real head sha**. GitHub's `pull_request` event checks out
a synthetic merge ref by default, whose sha is server-generated and whose second parent carries the
reviewed commit — so a correctly filed record would never be found and every honest PR would be
red-lighted.

### 3. The verdict is recomputed, never read

The record's `verdict` is a **claim**; its `findings` are the **evidence**. The gate derives the
verdict — an unresolved `blocking` finding derives `FIX-FIRST` — and a record may not assert `MERGE`
while carrying one. (The reverse is *not* an error: a reviewer may honestly return `FIX-FIRST` over
`major` findings alone, and `REDESIGN` must be recordable at all. An earlier draft failed those as a
"mismatch", which would have red-lighted a correct review.)

A `blocking` finding may be waived, but only by an operator named in **`reviews/OPERATORS`** — a
committed allowlist, itself an implementation path, so an agent cannot add itself to it. An earlier
version accepted any truthy `acceptedBy`, which meant the author could waive their own blocker with
`acceptedBy: "me"` while this ADR claimed only the operator could. That was prose asserting a
property the code lacked; it was caught by the first review this gate ever received.

`FIX-FIRST` and `REDESIGN` block the merge; the fix lands as a new commit and earns a fresh review
against the new head sha. Otherwise the verdict is advisory, and we are back to prose.

This is the same architecture as ADR-0051's release gate, and it is the same lesson: a record that
asserts its own verdict is not evidence (RFC-024 §2a).

### 4. What this Brake does not do — stated, not implied

**It cannot prove a review happened.** An author determined to lie can hand-write the JSON. This is
deliberate. The failure actually observed was **omission under end-of-chain momentum**, not forgery,
and CLAUDE.md's evidence-gated rule forbids building for a defect nobody has seen. What the Brake
changes is that skipping a review is no longer *silent*: it now requires a deliberate false
statement, committed under your name.

**It cannot check that the review was any good.** The rubric is the standard; the gate enforces only
that a record exists, binds to this diff, and does not contradict itself.

Recording these limits in the ADR is not throat-clearing. ADR-0050 was written with a defect in its
own text — it prescribed `--plugin-dir` as "the real surface a user will use" — and that defect made
a real gap invisible, because everyone had complied. A Brake described as stronger than it is
produces exactly that.

## Consequences

- Every implementation PR costs one review cycle. Given fifteen defects in one day's work, that cost
  is the product working as specified, not overhead to optimise away.
- `review-gate` becomes a required status check on `main`. As with the plugin's `release-gate`,
  `enforce_admins` is `false`: the Brake binds agents and remains advisory for the operator.
- The `v2` branch (0 commits ahead of `main`, 63 behind) is deleted. While it exists it invites
  another command to be written against a topology that has ended.
- A reviewer that returns `MERGE` on its first pass deserves scrutiny, not relief. The nine-round
  history is the calibration: the first pass found two false-greens in a gate already believed sound.

## Alternatives considered

- **Widen the command's scope and leave it as prose.** Rejected. The scope wording was not why the
  rule was skipped; the absence of enforcement was. Widening a rule nobody is stopped from ignoring
  reruns the experiment expecting a different result — which is the exact reasoning ADR-0050 records.
- **A `PreToolUse` hook blocking `gh pr merge`.** Rejected: it binds the agent but not the merge
  button, it lands in `.claude/settings.json` where `doctor` flags it as double wiring (ADR-0045),
  and it leaves no committed artifact.
- **Require a signed/attested review, or a second GitHub account's approval.** Rejected as building
  anti-forgery machinery for a defect never observed. Revisit if a review record is ever falsified.
- **Let `FIX-FIRST` be advisory, with findings addressed in the same PR.** Rejected: a verdict that
  cannot block is prose wearing a JSON schema.
