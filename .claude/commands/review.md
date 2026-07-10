---
description: Adversarial pre-merge review of an implementation branch against its governing ADR/RFC (the review gate — ADR-0052)
---

Run the review gate on the current branch. Optional argument: the governing document(s),
e.g. `ADR-0051` or `docs/rfc/RFC-024-*.md`. If omitted, infer them from the branch name, the
commit messages, and the ADRs/RFCs the diff touches — and if the change has no governing
document, say so and stop: a review with no standard to review against is an opinion.

This replaces the old `v2-review` command, whose base ref (`git diff v2...HEAD`), authority
(`V2-ROADMAP.md`), and trigger (a v2 initiative branch) all dissolved when v2 shipped to `main`
on 2026-07-08. The rule outlived them — brain decision `1cf647f35571`, the operator's standing
request: *"after every major implementation launch a review agent."*

**Launch a subagent** — the review must be fresh eyes; do not review your own diff inline — with
this charge, and relay its findings verbatim before acting on them:

1. **Ground truth first.** Read the governing ADR/RFC, then the full diff against the merge-base
   with `main` (`git diff $(git merge-base origin/main HEAD)..HEAD`). Do **not** trust the PR
   description or the commit messages — verify every claim they make against the code. Authors
   routinely announce a property their code does not have.
2. **Conformance.** Does the implementation do what the ADR *decided* — no more, no less? Flag
   scope creep and silent scope drops equally. Check the named constraints explicitly.
3. **The proof can fail (ADR-0029).** Find the must-fail arm and check it actually exercises the
   failure: **would the test still pass if the feature were deleted?** If yes, the proof proves
   nothing — that is a blocking finding. Then go further: **revert each fix in isolation and
   confirm its own guard goes red.** A guard whose revert changes nothing tests nothing, and a
   guard shaped to miss its bug reads as coverage (pattern `2f14119266ef`).
4. **Repo protocols.** Hooks fail open; deterministic backstop over probabilistic gate;
   append-only storage semantics; no secrets; **no AI attribution** anywhere in the commits.
5. **Correctness hunt.** Concrete failure scenarios only — "inputs X → wrong behaviour Y", with
   `file:line`. Execute probes where you can; do not review by reading alone.
6. **Hunt false positives too.** A gate that blocks honest work is a defect, not caution. For any
   check the diff adds, find the legitimate input it wrongly rejects.
7. **Honest verdict.** Findings ranked by severity (`blocking` / `major` / `minor`), each with a
   concrete failure scenario. End with exactly one of **MERGE / FIX-FIRST / REDESIGN**. "No
   findings" must state what was checked and ruled out, not merely assert cleanliness.

After the subagent reports:

- Fix every `blocking` finding. Re-run the gate — a substantial fix earns a fresh review, against
  the new head sha.
- **File the record**: `reviews/<head-sha>.json` (schema: [`reviews/README.md`](../../reviews/README.md)).
  `scripts/review-gate.mjs` recomputes the verdict from the findings and fails CI if the record
  claims `MERGE` while carrying an unresolved `blocking` finding — the record's verdict is a
  claim; its findings are the evidence.
- Record the outcome in the brain (`kb_add` fact, tags `review`), and note it in the PR.

Only the operator may waive a `blocking` finding, and only on the record: set
`status: "accepted"` with `acceptedBy`. The gate rejects a waiver with no name on it.
