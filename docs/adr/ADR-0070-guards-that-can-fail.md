---
type: Decision
title: "ADR-0070: Guards must be observed failing, by the author, before review — and escalation keys on fix-introduced findings, not round count"
description: "The 2026-07-26 retrospective found the machinery's residual risk has migrated from wrong code to wrong evidence: three vacuous guards were written in one session across unrelated code — a fixture whose slack hid the bug, call-site assertions satisfiable by a comment, and a replacement guard whose budget meant the branch it named never executed — each caught only by late, expensive adversarial review. Decides: source-text guards are banned (a guard drives the shipped entry point or it is not coverage); every new or changed guard ships with a mutation it was observed failing under, recorded in the review record's new required `mutations` field and enforced by the review gate; the review rubric opens with a guard audit; the autonomous-PR escalation trigger changes from three rounds to a round whose blocking findings were introduced by the previous round's fixes; and branch switches are never chained with mutations in one command, enforced by a PreToolUse hook."
status: "Accepted"
timestamp: 2026-07-26
---

# ADR-0070: Guards must be observed failing, by the author, before review

- **Status:** Accepted
- **Date:** 2026-07-26 (operator ratification of the machinery retrospective; brain `b1d1da9d71cc`)
- **Relates:** [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md) ("a proof that cannot
  fail proves nothing" — this ADR moves that test from reviewer habit to author obligation);
  [ADR-0052](ADR-0052-review-gate.md) (the review gate this extends);
  [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md)/[ADR-0051](ADR-0051-delivery-honesty.md)
  (unchanged — this governs the *inner* deterministic guards, not the L4 proofs)
- **Evidence:** one session, three vacuous guards in unrelated code, all caught only in review:
  a budget-test fixture whose line length left exactly enough slack to absorb the note it was
  supposed to catch (vfkb #200); call-site guards asserting over source text, defeated by a
  comment mentioning the function name (vfkb #256 round 1); and — after the first was pointed
  out — a replacement guard whose budget meant the branch it named never executed, surviving
  three independent gut-jobs of that branch (vfkb #258 review). Same arc: a four-round review
  whose round-2 and round-3 blockers were both introduced by the previous round's fixes, in the
  same suppressor mechanism (brain `916d87c4ed15`).

## Decision

1. **Source-text guards are banned.** A guard asserts against the *shipped entry point*: spawn
   the built binary with the production payload shape, drive the real handler through its real
   registration surface, or call the exported function the shipped call site calls. A test that
   greps source, or that exercises a mechanism through an entry point production does not take
   (an env override standing in for a stdin payload), is not coverage of that mechanism —
   regardless of whether it passes.
2. **Every new or changed guard ships with its observed-red mutation.** The author names the
   mutation (revert, gut-job, or bypass) under which the guard was *watched* failing, and records
   it in the review record's `mutations` field: `[{ "guard": "<test name>", "mutation":
   "<what was broken>", "observedRed": true }]`. An empty array is legal **only** with a
   `mutationsNote` saying why no guard changed (docs-only, records-only, refactor with existing
   coverage — named, not implied). The review gate enforces presence and shape; `observedRed`
   must be literally `true` — a mutation the guard did *not* catch is a finding, not a log entry.
   **Corollary, learned live:** a mutation that silently fails to apply is indistinguishable from
   a passing guard — assert the anchor text before substituting, and treat "mutation applied" as
   itself an observation.
3. **The review rubric opens with a guard audit.** Before reviewing the code, the reviewer asks
   of the diff's tests: *what mutation makes this red?* — and runs the cheapest one. This was the
   single most productive question of the retrospective's session, and it front-loads the check
   that catches the defect class the author is structurally worst at seeing.
4. **Escalation keys on fix-introduced findings, not round count.** The autonomous-PR flow
   escalates to the operator when a review round's blocking findings were *introduced by the
   previous round's fixes* — that is the distress signal (the mechanism is being churned blind),
   and it fires on round 2 when it should. Round count alone neither implies distress (a
   four-round arc can be honest convergence) nor waits for it. The three-round rule remains as a
   backstop ceiling for arcs that merely fail to converge.
5. **A branch switch is never chained with mutations in one command.** `git checkout`/`git
   switch` compounded with `&&`/`;`/`||` ran twice this session with a failed switch and a
   still-executing tail — once committing work under a wrong message on the wrong branch.
   Enforced by a PreToolUse hook (`scripts/hook-git-compound-guard.mjs`) that blocks the shape,
   not by intention. In a repo with a live brain, prefer worktrees over `git stash -u` — a stash
   swallowed two brain entries this session and only an id-level check of `entries.jsonl` caught
   it (the "check `.vfkb` before destructive git" rule, extended to stashes).

## Consequences

- The author cost is small and front-loaded: one mutation run per new guard, at the moment the
  guard is written, replacing the same check performed later by a reviewer at ~100× the tokens.
- The `mutations` field is testimony like the verdict field — the gate can verify shape, never
  that the run happened. Same posture as ADR-0052: the Brake makes skipping *loud* (a deliberate
  false statement under your name), not impossible.
- Legacy review records (recordVersion 1, no `mutations`) stay valid where they sit; the gate
  only ever validates the current head's record, so history does not retro-red.
- Deliberately **not** decided here, filed as issues instead: an ADR-citation resolver gate
  (every checkable claim cites a file/test that must exist) and the record-provenance sweep
  (`engineBuildHash` on every scenario record including RED baselines — touching all scenarios
  re-pins metered records, so it rides the next natural re-pin).
