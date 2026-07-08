---
type: Decision
title: "ADR-0044: A pluggable storage-backend interface; JSONL stays the shipped default (accepts RFC-019)"
description: "A pluggable storage-backend interface; JSONL stays the shipped default (accepts RFC-019)"
status: "Accepted"
timestamp: 2026-07-06
---

# ADR-0044: A pluggable storage-backend interface; JSONL stays the shipped default (accepts RFC-019)

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** operator + Claude
- **Accepts:** [RFC-019](../rfc/RFC-019-storage-backend-abstraction.md) (full hosted-vs-git
  history in `docs/V2-VISION.md` §3.4).
- **Relates:** [ADR-0019](ADR-0019-self-hosted-design-brain.md) (kept as the shipped default —
  this is a seam, not a reversal), [ADR-0043](ADR-0043-rebuildable-index-shape.md) (shares the
  seam), [ADR-0036](ADR-0036-v2-two-branch-strategy.md) (**builds on `v2`, sequenced last** among
  the core v2 initiatives).

## Context

Hosting the brain would fix write-coordination and staleness but reverses a principle ratified in
two repos (ADR-0019 here; vilonotes' "durable state lives only in this repo") and trades it for a
single point of failure, real auth, and the loss of git's implicit review-gate. Forcing that on
every consumer is wrong; permanently closing the door on a project that hits the pain hard enough
is also wrong.

## Decision

Define a storage-backend interface — the shape `storage.ts`/`engine.ts` already implicitly factor
behind (read/append/list-sessions/…) — that the engine calls through. **Ship exactly one
implementation in v2: JSONL-on-disk, matching ADR-0019 exactly — zero behavior change.** A second
(hosted) backend is explicitly **not** decided here: future, opt-in, project-by-project, built only
on a real ask (evidence-gated). Not a plugin *system* — a simple internal interface.

## Definition of Done

The full existing test suite passes **unchanged** against the abstracted interface (strict
no-behavior-change refactor contract); no new tests needed since no second backend ships.

## Consequences

- The door stays open without betting the default; ADR-0043's index work gets a clean seam instead
  of a bolt-on.
- **Sequenced last** among the core v2 initiatives so the interface is shaped by real experience
  from the lock (ADR-0040) and any index work — not designed speculatively.
- What a hosted backend would need (auth, staging/promotion review-gate) is left to whichever
  future RFC proposes building one.
