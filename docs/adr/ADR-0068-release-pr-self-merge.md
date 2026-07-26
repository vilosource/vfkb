---
type: Decision
title: "ADR-0068: A green release PR merges itself — the last manual step of the release chain closes (accepts plugin #25)"
description: "Once a release PR is green — version Brake satisfied, all four L4 records version-bound, tree-bound, provenanced and DEMONSTRATED, release gate passed — merging it is bookkeeping, not judgment: the decision was made in review and the evidence is committed. The operator ruled 2026-07-25 that such a PR may merge itself. The mechanism is GitHub's native auto-merge enabled by the vouch job, so BRANCH PROTECTION remains the enforcement and a red PR visibly does not merge; the human override is unchanged (close, label hold, or disable auto-merge)."
status: "Accepted"
timestamp: 2026-07-26
---

# ADR-0068: A green release PR merges itself

- **Status:** Accepted
- **Date:** 2026-07-26 (operator ruling 2026-07-25: *"I agree, a green release PR can merge itself"*)
- **Closes:** [vfkb-claude-plugin#25](https://github.com/vilosource/vfkb-claude-plugin/issues/25);
  completes the [#26](https://github.com/vilosource/vfkb-claude-plugin/issues/26) umbrella
- **Relates:** [ADR-0067](ADR-0067-hybrid-credential-model.md) (machine-produced evidence — the
  precondition #25 names: *"there is nothing safe to auto-merge until the PR is machine-produced
  and machine-proven"*); [ADR-0060](ADR-0060-plugin-release-tagging.md)/[ADR-0061](ADR-0061-plugin-release-version-automation.md)
  (the bump-and-tag Brakes this rides on); [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md)/
  [ADR-0051](ADR-0051-delivery-honesty.md) (unchanged — this changes who presses merge, never what
  counts as proof)
- **Brain:** ratification `fdebc8bd20cd`

## Context

The plugin release chain is automated end to end except for one keystroke. A release PR arrives
already carrying: a version bump the Brake refuses to skip (ADR-0061), four L4 records that are
version-bound, tree-bound, provenanced and recomputed-DEMONSTRATED by the gate (ADR-0067 D5), a
green release gate, and — on merge — a tag CI creates by itself (ADR-0060). Every judgment call
happened upstream, in review. What remained was a human clicking merge on a PR whose greenness was
already machine-derived, which is not oversight; it is latency wearing oversight's clothes.

ADR-0067 removed the precondition #25 was blocked on: the evidence is now machine-produced and
machine-vouched, so the PR is no longer trusting a human's word about a run on their laptop.

## Decision

**A release PR merges itself when every required check is green.** Specifically:

1. **Mechanism: GitHub native auto-merge**, enabled by the `vouch` job after it commits the
   machine-produced records. Not a bot pressing merge; not a workflow calling
   `gh pr merge` on its own judgment. The distinction is the whole safety argument —
   **branch protection stays the enforcement**. Auto-merge merges only when the branch's required
   checks pass, so a red PR *cannot* merge, and the thing deciding is the same protection rule that
   already guards `main` (observed: it rejected the vouch job's own direct push to `main`).
2. **What must be green:** exactly the repo's required checks — today `release-gate`, which
   transitively enforces the version Brake, the four records' verdicts/tree-binding/provenance,
   packaging, and delivery honesty. This ADR deliberately does **not** enumerate a second list;
   two lists drift, and the one that matters is the one GitHub enforces.
3. **What blocks:** anything that keeps a required check from going green; a `hold` label; draft
   status; or a requested change under review rules. Auto-merge is *enabled*, never forced —
   `--auto` is a standing intent, not an override.
4. **Who can override:** the operator, at any time and without ceremony — remove the label's
   opposite, close the PR, or `gh pr merge --disable-auto`. No ADR amendment needed to stop a
   single merge; that is the point of putting the switch on the PR rather than in code.
5. **Scope: release PRs.** A PR whose content is the release artifact (version bump, vendored
   engine, re-pinned records). Ordinary feature PRs are unchanged and still go through the
   ADR-0052 review gate before a human or the autonomous-PR flow merges them.

## Consequences

- The chain closes: engine change → re-vendor PR → evidence produced and vouched in CI → gates
  green → **merged** → tagged → consumers `plugin update`. No step waits on a person.
- The failure mode this introduces is a *bad release merging faster*, not a bad release merging
  that otherwise would not have: every gate that could have caught it still runs, and still blocks.
  What is lost is the incidental pause in which a human might have noticed something no gate
  checks. The mitigation is that the same pause is available on demand (the `hold` label), and that
  the laptop leg of ADR-0067 remains the periodic full-fidelity check.
- **Quiet-success watch (ADR-0051 clause 3):** "auto-merge enabled" must never be reported as
  "merged". They are different states, and a PR sitting with auto-merge enabled and a check that
  never reports looks identical to success in a summary. Any tooling that enables auto-merge must
  report the state it actually observed, and the release wrapper must distinguish
  *merged* from *queued to merge*.
- **Self-merge DOES touch tagging, and an earlier draft of this ADR said otherwise.** Review of the
  implementation (plugin #48) established that GitHub does not run `push:`-triggered workflows for a
  push made with the repository's `GITHUB_TOKEN` — which is what a CI auto-merge is. So
  `release-tag.yml`, whose only trigger was `push: main`, would never have run for a self-merged
  release: merged, untagged, every job green. The correction is part of the decision, not a footnote
  to it — the vouch job dispatches the tag workflow explicitly after a merge and then **asserts the
  tag exists on `origin`** (a content assertion; a green job is not evidence a ref was created). The
  laptop leg was never affected: an operator's own token triggers the workflow normally.
- **Scope is enforced by branch name, not by intent.** `release-gate` — the sole required check —
  runs on every pull request, so an unscoped auto-merge step would have merged *any* PR whose
  evidence run was dispatched, bypassing the ADR-0052 review gate (a process step, not a required
  check). The vouch job therefore queues only `release/*`, `re-vendor/*` and `repin/*` branches.
