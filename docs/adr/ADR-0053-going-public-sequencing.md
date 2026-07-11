---
type: Decision
title: "ADR-0053: Going public — the five-workstream sequencing (umbrella; accepts RFC-025)"
description: "The path from the public README (PR #113) to a dependable public project runs as five workstreams: W0 disclosure audit (gates the visibility flip), W1 test CI + hygiene, W2 release-please versioning, W3 npm delivery behind an install proof, W4 update awareness. W1–W4 land while private, order 027→028→029→030; W0 is operator-paced and is the only thing that blocks the flip."
status: "Accepted"
timestamp: 2026-07-11
---

# ADR-0053: Going public — the five-workstream sequencing

- **Status:** Accepted
- **Date:** 2026-07-11
- **RFC:** [RFC-025](../rfc/RFC-025-going-public-release-engineering.md) (accepted 2026-07-11;
  full context, constraints, and the cross-cutting rejected alternatives live there)
- **Relates:** the four child decisions this umbrella sequences —
  [ADR-0054](ADR-0054-pre-public-disclosure-gate.md) (W0),
  [ADR-0055](ADR-0055-public-ci-and-community-hygiene.md) (W1),
  [ADR-0056](ADR-0056-versioning-and-release-automation.md) (W2),
  [ADR-0057](ADR-0057-npm-delivery-channel.md) (W3),
  [ADR-0058](ADR-0058-update-awareness.md) (W4). Where a child refines a detail, the child
  governs.

## Context

PR #113 gave vfkb a public face (README + MIT). Everything else about the repo is still shaped
like a private workshop: CI never runs the test suite, there is no contribution surface, no
release has ever been cut, no install channel exists, and the entire history was written
private. RFC-025 held the full analysis; the decidable units were split into RFC-026..030 so
each could be ratified and built independently.

## Decision

1. The going-public effort is **five workstreams, each its own accepted decision** (ADR-0054..
   0058), built as independent PR chains.
2. **Build order: W1 → W2 → W3 → W4** (ADR-0055 → 0056 → 0057 → 0058), each consuming the
   previous one's output (required test check → release tag → published package → currency
   check against it). **W0 (ADR-0054) runs in parallel, operator-paced, and is the only
   workstream that gates the visibility flip** — the repo may be fully release-ready and still
   private until the audit closes.
3. House constraints bind all five: deterministic Brakes over prose, delivery honesty
   (ADR-0051) on every new channel, operator-reviewed releases, offline-first with no
   phone-home defaults.

## Consequences

- "Going public" acquires a checkable definition: ADR-0054's audit evidenced in the brain, plus
  whatever subset of ADR-0055..0058 the operator wants live at flip time (minimum: ADR-0055's
  test Brake, so the public repo never shows an unproven test claim).
- Cross-cutting alternatives (semantic-release, changesets, manual publishing, GitHub Packages,
  update-notifier-style auto-checks) were rejected once, in RFC-025, and are not re-litigated
  per child.
- The umbrella carries no implementation of its own; its acceptance is the sequencing ruling.
