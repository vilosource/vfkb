---
description: Adversarial pre-merge review of a v2 initiative branch against its governing ADR (the V2-ROADMAP review gate)
---

Run the v2 review gate on the current feature branch. Argument (optional): the initiative id
and ADR, e.g. `V2-2 ADR-0040`. If omitted, infer both from the branch name and
`docs/V2-ROADMAP.md`.

**Launch a subagent** (the review must be fresh eyes — do not review your own diff inline) with
this charge, and relay its findings verbatim before acting on them:

1. **Ground truth first.** Read the governing ADR (and its RFC for detail), then the full diff
   against `v2` (`git diff v2...HEAD`). Do not trust the PR description or commit messages —
   verify every claim they make against the code.
2. **ADR conformance.** Does the implementation do what the ADR *decided* — no more, no less?
   Flag scope creep and silent scope drops equally. Check the ADR's named constraints
   explicitly (e.g. ADR-0013 no-native-dep, D3d writes-land-first, no LLM on the write path).
3. **The proof can fail (ADR-0029).** Find the must-fail arm and check it actually exercises
   the failure: would the test pass if the feature were deleted? If yes, the proof proves
   nothing — that is a blocking finding. Check the RED-first claim against the test content.
4. **Repo protocol checks.** Hooks stay fail-open (never wedge the harness/turn); deterministic
   backstop over probabilistic gate; append-only storage semantics preserved
   (`materialize()` order-independence); no secrets; no AI attribution anywhere in commits.
5. **Correctness hunt.** Race conditions, error paths, reentrancy, cross-platform (the lock
   and fs code must not assume Linux-only primitives beyond what ADR-0013 allows), stale-state
   assumptions. Concrete failure scenarios only — "inputs X → wrong behavior Y".
6. **Honest verdict.** Findings ranked by severity, each with file:line and a concrete failure
   scenario. End with MERGE / FIX-FIRST / REDESIGN. "No findings" must state what was checked
   and ruled out, not just assert cleanliness.

After the subagent reports: fix blocking findings before merge (re-run the gate if the fix is
substantial), record the review outcome in the brain (`kb_add` fact, tags `v2,review`), and
note it in the merge PR. The gate is part of the V2-ROADMAP update protocol — a V2 initiative
is not DONE until its review gate has run.
