---
type: Decision
title: "ADR-0055: Public CI and community hygiene (accepts RFC-027)"
description: "test.yml (npm ci + build + vitest, Node 20/22/24, SHA-pinned actions) becomes a required status check beside review-gate — proven by an observed can-fail arm (a deliberately red commit blocking a PR). Dependabot grouped monthly. CONTRIBUTING/SECURITY/CoC/templates/CODEOWNERS document the house rules a stranger cannot guess: maintainers run the review gate on external PRs, and no AI attribution in commits."
status: "Accepted"
timestamp: 2026-07-11
---

# ADR-0055: Public CI and community hygiene

- **Status:** Accepted
- **Date:** 2026-07-11
- **RFC:** [RFC-027](../rfc/RFC-027-public-ci-and-community-hygiene.md) (accepted 2026-07-11;
  file-by-file specification and rejected alternatives live there)
- **Relates:** [ADR-0053](ADR-0053-going-public-sequencing.md) (umbrella; W1, first in build
  order); [ADR-0052](ADR-0052-review-gate.md) (the existing required check this one joins);
  [ADR-0056](ADR-0056-versioning-and-release-automation.md) (consumes the Conventional-Commit
  discipline CONTRIBUTING documents).

## Context

`review-gate.yml` is the only CI. The README's "265 deterministic tests" claim has never been
executed by CI — a suite-breaking PR goes red only on a contributor's machine. And the repo's
genuinely unusual conventions (review-gate records, decisions-before-code, the L4 DoD, no AI
attribution) are undocumented, which to an outsider reads as hostility rather than rigor.

## Decision

1. **`test.yml`**: `npm ci && npm run build && npm test` on `pull_request` and push to `main`,
   Node **20/22/24** matrix, actions **SHA-pinned**; becomes a **required status check**. The
   Brake is proven by observation: the implementing PR shows the matrix green **and** a
   deliberately red commit observed blocking, then reverted (the can-fail arm). The README
   badge lands only after the first green run on `main`.
2. **`dependabot.yml`**: npm + github-actions ecosystems, grouped, monthly; security advisories
   remain immediate; nothing auto-merges.
3. **Hygiene files**: `CONTRIBUTING.md` (branch→PR only; Conventional Commits; **no AI
   attribution**, enforcement hook named; the DoD question; and the outsider-critical policy —
   **external contributors do not file `reviews/<sha>.json`; a maintainer runs the gate on
   their PR**), `SECURITY.md` (private vulnerability reporting; latest 0.x supported),
   `CODE_OF_CONDUCT.md` (Contributor Covenant), issue templates + a PR template carrying the
   DoD and plugin-re-vendor questions, `CODEOWNERS` (`* @vilosource`).

## Consequences

- Merge latency +1–2 minutes; a flaky test now blocks merges and gets fixed or quarantined by
  decision, not ignored.
- The no-AI-attribution rule becomes public policy rather than private convention.
- Coverage gates, eslint/prettier, weekly dependabot, and required commitlint are rejected or
  deferred in RFC-027 (evidence-gated), and are not implied by this acceptance.
