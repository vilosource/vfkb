---
type: RFC
title: "RFC-027: Public CI and community hygiene — the test suite becomes a required Brake; the contribution surface gets documented"
description: "CI currently proves only the review gate; the 265-test suite never runs on a PR. This RFC adds test.yml as a required check (Node 20/22/24, SHA-pinned actions), dependabot, and the hygiene files a public repo is judged by — with CONTRIBUTING.md stating the house rules a stranger cannot guess: maintainers run the review gate on external PRs, ADR/RFC-first, the L4 DoD, and the no-AI-attribution commit rule."
status: "Proposed"
timestamp: 2026-07-11
---

# RFC-027: Public CI and community hygiene

- **Status:** Proposed
- **Date:** 2026-07-11
- **Deciders:** operator + Claude
- **Relates:** [RFC-025](RFC-025-going-public-release-engineering.md) (umbrella, W1);
  [ADR-0052](../adr/ADR-0052-review-gate.md) — the review gate stays required; this RFC adds the
  test Brake *beside* it and defines how external contributors interact with the gate.

## Context

- `review-gate.yml` is the only workflow. The README (PR #113) cites "265 deterministic tests",
  but no CI run has ever executed them — a PR that breaks the suite goes red only on the
  contributor's machine, if there.
- The repo has none of the files that tell a stranger how to participate: no CONTRIBUTING.md,
  SECURITY.md, code of conduct, issue/PR templates, or CODEOWNERS. This repo's conventions are
  *unusual* (review-gate records, decisions-before-code, L4 DoD, no AI attribution) — undocumented,
  they read as hostility; documented, they are the pitch.
- Dependencies are two runtime packages plus dev tooling, currently updated never.

## Decision (proposed)

Three PRs, independent of all other workstreams:

1. **`test.yml`** — on `pull_request` and push to `main`: `npm ci && npm run build && npm test`,
   Node **20 / 22 / 24** matrix, all actions **SHA-pinned**. Becomes a **required status check**
   next to `review-gate`. The Brake principle (deterministic backstop over probabilistic gate)
   applied to the suite itself: green tests stop being an assertion in a README and become a
   condition of merge. The README badge for it is added only after the first green run on `main`
   (observed, then claimed).
2. **`dependabot.yml`** — npm + github-actions ecosystems, **grouped**, monthly. Security
   advisories still arrive immediately (GitHub default). Dependabot PRs ride the same
   test-required protection; nothing auto-merges.
3. **Hygiene files** (one PR):
   - `CONTRIBUTING.md` — the contract with strangers: topic branch → PR (never `main`);
     Conventional Commits (load-bearing once RFC-028 lands); **no AI attribution in commits**
     (stated as a hard rule with the enforcement hook named); decisions-before-code (ADR/RFC
     pointers); the DoD question ("structural invariant → deterministic tests; user-facing
     capability → L4"); and the review-gate policy for outsiders: **external contributors are
     NOT expected to produce `reviews/<sha>.json` — a maintainer runs the adversarial gate on
     their PR and files the record**. Without that sentence the gate reads as an impossible
     entry bar.
   - `SECURITY.md` — GitHub private vulnerability reporting; supported versions = latest 0.x.
   - `CODE_OF_CONDUCT.md` — Contributor Covenant (mykb precedent).
   - `.github/ISSUE_TEMPLATE/` (bug, feature) + `PULL_REQUEST_TEMPLATE.md` (asks the DoD
     question and the "does the plugin need a re-vendor?" question from RFC-025 W3.5).
   - `CODEOWNERS` — `* @vilosource`.

**Proof shape (ADR-0029 "proof fits the capability"):** CI wiring is validated by observation in
CI itself — the PR adding `test.yml` must show the matrix green, and one deliberately red commit
(a failing test pushed to the PR branch, then reverted) observed blocking — the can-fail arm,
recorded in the PR. Hygiene files are prose; their only invariant (links resolve) rides the
docs-link check habit, no scenario.

## Consequences

- Merge latency grows ~1–2 minutes per PR (build + 265 tests × 3 Node versions in parallel).
- A flaky test now blocks merges — flakes get fixed or quarantined *by decision*, not ignored.
- CODEOWNERS + templates create review obligations for the operator on every external PR;
  acceptable at current scale, revisit if volume warrants.
- The no-AI-attribution rule becomes public-facing policy rather than private convention.

## Alternatives considered

- **Coverage gates / eslint / prettier in the same move**: rejected — separate decisions, and
  evidence-gated (no observed defect class they would have caught); `tsc` strictness + vitest is
  the current floor.
- **Weekly dependabot**: rejected for noise; monthly + immediate security advisories covers the
  actual risk.
- **Making commitlint required now**: deferred to RFC-028's evidence gate (promote only if
  mislabeled commits are actually observed).
