---
type: Decision
title: "ADR-0056: Versioning and release automation via release-please (accepts RFC-028)"
description: "release-please maintains a standing, reviewable release PR (version bump + CHANGELOG from the Conventional Commits the repo already writes); the operator's merge cuts the tag + GitHub Release; nothing publishes from it (ADR-0057 owns that). 0.x semver stated honestly; 1.0 criteria recorded, not decided; commitlint non-required until a mislabel is observed. Proof = the first observed release cycle."
status: "Accepted"
timestamp: 2026-07-11
---

# ADR-0056: Versioning and release automation via release-please

- **Status:** Accepted
- **Date:** 2026-07-11
- **RFC:** [RFC-028](../rfc/RFC-028-versioning-and-release-automation.md) (accepted 2026-07-11;
  mechanism detail and the rejected alternatives — semantic-release, changesets, manual
  publish — live there)
- **Relates:** [ADR-0053](ADR-0053-going-public-sequencing.md) (umbrella; W2);
  [ADR-0055](ADR-0055-public-ci-and-community-hygiene.md) (documents the commit convention
  this makes load-bearing); [ADR-0057](ADR-0057-npm-delivery-channel.md) (triggered by the tag
  this produces); [ADR-0051](ADR-0051-delivery-honesty.md) (release notes are a disclosure
  surface while plugin delivery stays unproven).

## Context

`0.1.0` since inception: no tags, no CHANGELOG, no Releases — nothing a consumer can pin or
diff. The house constitution constrains the mechanism: the operator reviews releases, `main`
stays protected, and the release artifact must be readable before it exists. The repo's commit
history already follows Conventional Commit prefixes as de-facto style.

## Decision

1. **Semver, 0.x honest**: MINOR may break (BREAKING markers surfaced in the CHANGELOG), PATCH
   is fixes-only. **1.0 criteria recorded now, decided by a future RFC**: storage schema, CLI
   surface, MCP tool set frozen; install proven on both channels.
2. **release-please** (`googleapis/release-please-action`, SHA-pinned) in release-PR +
   github-release mode: a **standing release PR** carries exactly the version bump and the
   generated CHANGELOG section; merging it — an operator act behind normal branch protection —
   creates the `vX.Y.Z` tag and GitHub Release. **No publishing from this workflow.**
3. **Conventional Commits become load-bearing**; commitlint runs **non-required** and is
   promoted only on observed drift (a mislabel actually producing a wrong bump/changelog line —
   the release-PR review is the first-line catch).
4. While plugin delivery remains unproven (ADR-0051), any release note mentioning the plugin
   carries the disclosure.

**Proof:** the first observed cycle — release PR reviewed and merged, tag + Release existing,
CHANGELOG matching the merged commits — named as the implementing PR's DoD (a `chore:`-only
`0.1.1` canary is acceptable). YAML read ≠ mechanism proven.

## Consequences

- A wrong commit type now has blast radius (wrong bump/changelog), caught in the release PR
  review — which is precisely why the release is a PR.
- The standing release PR becomes a first-class "what would ship" view.
- GitHub Releases become the canonical announcement channel (consumed by ADR-0058).
- The house `review:` commit type is unknown to the convention and correctly ignored by the
  changelog.
