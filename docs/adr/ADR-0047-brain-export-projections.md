---
type: Decision
title: "ADR-0047: Brain export projections — one deterministic engine, two render targets (accepts RFC-022)"
description: "Track 9 Q3 decided: `vfkb export agents-md` + `vfkb export okf`, a pure-function-of-the-brain projection with the ADR-0046 ratchet enforced by RED-first Brakes; build on operator request"
status: "Accepted"
timestamp: 2026-07-08
---

# ADR-0047: Brain export projections — one deterministic engine, two render targets (accepts RFC-022)

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** operator + Claude
- **Accepts:** [RFC-022](../rfc/RFC-022-brain-export-projections.md) (drafted and adversarially
  reviewed 2026-07-08; two blocker-level internal contradictions found by the review —
  `log.md`'s regeneration-history dependence, and the as-of determinism claim disguised as
  renderer reuse — were re-decided before acceptance; the RFC carries the full design)
- **Relates:** [ADR-0046](ADR-0046-layered-knowledge-capture-understand-publish.md) (whose
  Phase 1 this decides, and whose trust ratchet the OKF target enforces),
  [ADR-0008](ADR-0008-constitution-tier.md) / [ADR-0006](ADR-0006-context-map.md) /
  [ADR-0025](ADR-0025-project-context-doc-and-kb-context.md) (shared section derivations),
  [ADR-0005](ADR-0005-injection-filters-stale.md) (live injection keeps including labeled
  unverified entries — publishing is a stricter, separate trust boundary),
  [ADR-0013](ADR-0013-no-hard-native-dep.md) (why the unit-gate conformance checker is a TS
  port, not a Python dependency), [ADR-0022](ADR-0022-l4-evaluation-methodology.md) /
  [ADR-0023](ADR-0023-scenario-contract-first.md) / [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md)
  (proof methodology binding the DoD)

## Context

Track 9 Q3 ("AGENTS.md export projection") was the queued interop slot; ADR-0046 widened it to
also emit an OKF v0.1 bundle and gated its own Phase 1 on Q3 being drafted. RFC-022 is that
draft. The engine owns every needed section derivation (`deriveConstitution`, `buildContextMap`,
the context spine) but no file-emitting render layer, and its existing renderers are
deliberately wrong for publishing: `renderContextBundle` includes unverified-labeled entries
(ADR-0005) and hardcodes the wall clock; `renderContext` renders no fact/gotcha/pattern
knowledge at all.

## Decision

Accept RFC-022. The decided shape, in brief (the RFC is normative for detail):

1. **`vfkb export <target> [--out <path>]`** — a CLI verb, two render targets, one projection
   core. Generated-marked, regenerate-on-demand, never auto-committed.
2. **Determinism contract:** output is a pure function of the brain's content — no wall clock
   (`asOf = max(entry.updated)`, threaded through the render/filter path as an acknowledged
   engine change; live injection keeps the wall-clock default), no reads of previously emitted
   output (the output tree is rewritten every run via a **scoped sweep** — only
   generated-marker files are deleted, and a non-empty `--out` dir with no generated files is
   refused, never destroyed), total stable ordering (explicit `id` tiebreak beyond
   `heuristicCompare`), filenames a pure function of entry id alone.
3. **`agents-md` target:** Constitution + Context Map + verified knowledge + context spine, in
   one budgeted `AGENTS.md`, via a new export renderer sharing the section derivations but
   applying the export predicate; the map section is an **export variant** (live-session
   affordances stripped; counts/tags computed over the published subset only, so unpublished
   entries leak nothing).
4. **`okf` target:** an OKF v0.1 bundle (`.okf/`) — per-type directories, `index.md`
   progressive disclosure, per-entry `<id>.md` docs with spec-mapped frontmatter, and a
   `log.md` derived from the brain's **raw record history** (`readRecords()`-level — the
   materialized LWW view alone cannot prove an entry was ever publish-grade; a departure is a
   raw record that satisfied the export predicate whose current state no longer does),
   satisfying the ratchet's no-silent-deletion rule without breaking determinism. `decisions/`
   exports **all** ratchet-eligible decision entries (self-contained bundle; no improvised
   "has an ADR file" predicate — the envelope carries no such signal).
5. **The export predicate (ADR-0046's ratchet, fully enumerated in RFC-022) binds both
   targets:** `verified` provenance ∧ (decision family ⇒ `accepted`; superseded/`deprecated`
   never) ∧ `zone !== 'archive'` ∧ validity window open at `asOf`. Every clause — including
   the archived-but-verified and expired-window cases — is exercised by the negative test.
6. **No new interactive surface:** no `vfkb:okf` skill, no MCP export tool — the export is an
   operator/scripted act; an MCP surface waits for observed in-session demand.

## Consequences

- **Build stays gated** on operator request or named evidence (Track 9's standing pattern,
  ADR-0037/0038). Accepting this ADR ships no code.
- **When built, the DoD is** (RFC-022 §Definition of Done, binding): the RED-first unit gate —
  byte-determinism incl. the stale-generated-files sweep and the non-generated-dir refusal
  case, as-of clock-independence, the all-clause negative export-predicate test
  (`unverified`/`stale`/`expired`, `proposed`/`superseded`/`deprecated`, archived-but-verified,
  expired-window; both targets), the `log.md` raw-record history test, TS-ported OKF
  conformance checks, AGENTS.md structure — plus a green `validate_okf.py --strict` cross-check
  recorded in the delivering PR, plus the two L4 scenarios (`agents-md-cold-agent`,
  `okf-bundle-cold-agent`; dockerized, N=3, ≥2/3, contrast arms, RED first, one docker run at a
  time).
- The `asOf` threading slightly widens engine render signatures (backward-compatible optional
  parameter; live behavior unchanged).
- ADR-0046's Phase 1 gate ("Track 9 Q3 drafted") is now satisfied; its Phase 2 remains gated
  on drift-pain evidence.
- Consumers get both exports through the plugin's vendored CLI (ADR-0045) with no per-project
  work; committing the generated output (e.g. `AGENTS.md` for cold agents) is each consumer's
  deliberate act.

## Alternatives considered

Recorded in RFC-022: separate per-target builds (rejected — ADR-0046 decided one engine);
hook-driven auto-regeneration (rejected — the Q3 contract says on-demand, never auto-committed);
an MCP export tool now (deferred — no observed need); shipping the Python validator in the unit
gate (rejected — ADR-0013 spirit); wall-clock as-of with an override flag (rejected —
determinism by construction beats determinism by discipline).
