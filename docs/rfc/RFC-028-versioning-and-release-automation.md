---
type: RFC
title: "RFC-028: Versioning and release automation — release-please; the release becomes a reviewable PR; Conventional Commits become load-bearing"
description: "Version 0.1.0 has never moved; there are no tags, no CHANGELOG, no releases. This RFC adopts release-please: it parses the Conventional Commit history the repo already writes and maintains a standing release PR (version bump + CHANGELOG) whose merge — an operator act on a readable diff — cuts the tag and GitHub Release. 0.x semver stated honestly; 1.0 criteria recorded now, decided in a future RFC. Rejected: semantic-release (no human gate), changesets (monorepo ceremony), manual local publish (no provenance + the off-VPN Nexus trap)."
status: "Proposed"
timestamp: 2026-07-11
---

# RFC-028: Versioning and release automation

- **Status:** Proposed
- **Date:** 2026-07-11
- **Deciders:** operator + Claude
- **Relates:** [RFC-025](RFC-025-going-public-release-engineering.md) (umbrella, W2);
  [RFC-029](RFC-029-npm-delivery-channel.md) — consumes the tag/Release this RFC produces;
  [ADR-0051](../adr/ADR-0051-delivery-honesty.md) — release notes are a disclosure surface.

## Context

The repo has disciplined history (`fix:` / `feat:` / `docs:` / `chore:` / `review:` prefixes are
the de-facto house style) but no release mechanics at all: `0.1.0` since inception, zero tags,
no CHANGELOG, nothing a consumer can pin or diff. Every candidate mechanism must satisfy the
house constitution: **the operator reviews releases** (nothing ships because a robot decided
to), `main` stays protected, and the release artifact must be *readable before it exists*.

## Decision (proposed)

1. **Semver, 0.x stated honestly.** Until 1.0: MINOR may break (documented in the CHANGELOG
   under a **BREAKING** heading derived from `!`/`BREAKING CHANGE:` commit markers), PATCH is
   fixes-only. **1.0 criteria are recorded now, decided later** (a future RFC): storage schema,
   CLI surface, and MCP tool set frozen; install proven on both channels (RFC-029's npm proof +
   the plugin install L4 when its upstream blocker clears, RFC-024 §4).
2. **release-please** (the `googleapis/release-please-action` workflow, SHA-pinned) in
   `release-pr` + `github-release` mode:
   - It maintains a **standing release PR** containing exactly two things: the version bump and
     the generated `CHANGELOG.md` section. That PR is the release, reviewable like any other.
   - Merging it (operator act, behind the same branch protection as everything else) creates
     the `vX.Y.Z` tag and the GitHub Release with the changelog as its notes.
   - Nothing publishes from this workflow — publishing is RFC-029's job, triggered by the tag.
3. **Conventional Commits become load-bearing.** Documented in CONTRIBUTING.md (RFC-027). A
   commitlint check runs on PRs as **non-required** first; promotion to required is
   **evidence-gated** on a mislabeled commit actually producing a wrong version bump or
   changelog entry (house rule: build the Brake when the failure is observed, and the release
   PR review is itself the first-line catch).
4. **Release notes disclosure duty**: while the plugin's delivery remains unproven (ADR-0051),
   any vfkb release note that *mentions the plugin* carries the disclosure. The npm channel gets
   its own proof before its first release (RFC-029), so it never enters the unproven state.

**Proof shape:** the mechanism is proven by its first observed cycle, on the record — the first
release-please PR reviewed and merged, the tag and GitHub Release observed existing, the
CHANGELOG section matching the merged commits. That first cycle is named as the DoD of the
implementing PR (a `chore:`-only dry-run release `0.1.1` is acceptable as the canary). A
release automation "proven" by reading its YAML is asserted, not observed.

## Consequences

- A wrong commit type now has a blast radius (wrong bump / changelog line) — caught in the
  release PR review, which is precisely why the release is a PR.
- The standing release PR is always visible: "what would ship if I merged this" becomes a
  first-class view of the repo.
- GitHub Releases become the canonical announcement channel (consumed by RFC-030).
- The `review:`-prefixed house commit type is unknown to the conventional spec; release-please
  ignores unknown types by default — acceptable (review records never belong in a changelog).

## Alternatives considered

- **semantic-release**: rejected — publishes on push with no human gate; fights branch
  protection; optimizes away a failure mode (forgetting to release) that the standing PR solves
  while preserving review.
- **changesets**: rejected — per-PR changeset files are ceremony designed for multi-package
  repos; this is one package with disciplined commit messages.
- **Manual `npm version` + tag by hand**: rejected — no generated changelog, no standing
  reviewable artifact, bus-factor of one, and local publishing is a known trap in this
  environment (corporate Nexus, `ENOTFOUND` off-VPN).
