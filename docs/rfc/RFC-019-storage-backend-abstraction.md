---
type: RFC
title: "RFC-019: A pluggable storage-backend interface"
description: "v2 — A pluggable storage-backend interface; JSONL stays the shipped default"
status: "**Accepted → ADR-0044** (2026-07-06)"
timestamp: 2026-07-05
---

# RFC-019: A pluggable storage-backend interface

- **Status:** **Accepted → [ADR-0044](../adr/ADR-0044-storage-backend-abstraction.md)** (2026-07-06)
- **Date:** 2026-07-05
- **Deciders:** operator + Claude
- **Relates:** [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) (self-hosted design
  brain — this RFC keeps that as the shipped default, not a reversal), [RFC-018](RFC-018-rebuildable-index.md)
  (shares this seam), `docs/V2-VISION.md` §3.4

## Context

An earlier session discussion asked directly: would hosting the brain (agents access it
only via MCP, no local git-committed file) fix vfkb's concurrency problems? The answer,
worked through in `docs/V2-VISION.md` §3.4: **partially, and at a real cost.** It cleanly
fixes write-time coordination (RFC-015's TOCTOU gap) and cross-session staleness, but it
**reverses a principle already ratified in two repos** — vfkb's own ADR-0019 ("the brain
ships with the repo") and vilonotes' `AGENTS.md` ("durable state lives only in this repo,
no shared volumes, no second source of truth") — and trades them for a single point of
failure, a real need for auth, and the loss of git's implicit review-gate (an entry is
only "real" once its PR merges).

Forcing that tradeoff on every vfkb-consuming project isn't right. Neither is closing the
door on it permanently for a project that's actually hit the pain hard enough to accept
the tradeoffs.

## Decision

Define a storage-backend interface — the same shape `storage.ts`/`engine.ts` already
implicitly factor the JSONL implementation behind (read/append/list-sessions/etc.) — that
the engine calls through, rather than assuming a local file directly. Ship exactly one
implementation in v2: JSONL-on-disk, matching ADR-0019 exactly, zero behavior change for
every existing consumer. **This RFC is an abstraction seam, not a decision to build a
second (hosted) backend now** — that stays a future, opt-in, project-by-project choice,
built only if a real project asks for it (this repo's own evidence-gated-builds rule).

## Alternatives Considered

- **Build a hosted backend now, alongside the interface** — rejected: no concrete project
  has asked for it yet; building it speculatively contradicts the evidence-gated-builds
  rule this repo already follows (`CLAUDE.md`: "Don't build speculatively — an RFC decides
  the shape; the build triggers on observed evidence or an explicit request").
- **Skip the abstraction, hard-code JSONL forever** — rejected: closes the door on any
  future opt-in without a disruptive rewrite later, and RFC-018's index work benefits from
  the same clean seam existing now rather than being bolted on afterward.
- **Make the abstraction a full plugin system (third-party backends, dynamic loading)** —
  rejected as premature: a simple internal interface with one implementation is enough to
  prove the seam is in the right place; a plugin *system* is speculative machinery with no
  current consumer.

## Definition of Done

The full existing test suite (155/155 as of this RFC's revision — corrected from a stale
"95/95" in the original draft, caught by independent review) passes **unchanged** against
the abstracted interface — a strict "no behavior change" refactor contract. No test edits
beyond what the refactor mechanically requires (e.g. import paths), and no new test is
needed to prove this RFC's own scope, since it deliberately ships no second backend to
test against yet.

## Open items

- **Fair question raised by independent review:** is a seam with exactly one
  implementation worth a standalone RFC, versus folding into RFC-018's refactor (they
  already explicitly share this seam)? Leaning toward keeping them separate — the
  hosted-vs-git tradeoff has enough recorded history (`docs/V2-VISION.md` §3.4) to be
  worth its own citable decision independent of whether/when RFC-018 actually builds —
  but not pre-decided; reasonable to merge them if that turns out cleaner at review time.
- The interface's exact method surface should be shaped by real experience from RFC-015
  (lock) and RFC-018 (index) — sequenced last among the core v2 initiatives specifically
  so it isn't designed speculatively ahead of the code that will actually use it.
- What a future hosted backend would need to support (auth model, staging/promotion to
  simulate git's review-gate) is explicitly not decided here — left for whichever RFC
  proposes building one, if that ever happens.
