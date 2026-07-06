# ADR-0037: Deterministic contradiction surfacing at write time (accepts RFC-012)

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** operator + Claude
- **Accepts:** [RFC-012](../rfc/RFC-012-contradiction-surfacing-at-write.md) (full analysis,
  evidence, and alternatives live there — this ADR records the decision).
- **Relates:** [ADR-0004](ADR-0004-decision-entry-type.md) (supersede-only decisions),
  [ADR-0021](ADR-0021-auto-distill-and-curator.md) (`findLexicalDuplicates`, the seam this extends;
  the "prose rule with no Brake gets ignored" lesson this mechanizes),
  [ADR-0023](ADR-0023-scenario-contract-first.md) (the DoD contract), roadmap §3 Track 9 Q1.

## Context

Memory maintenance — superseding stale facts — is the demonstrated bottleneck of agent memory
(arXiv:2606.27472), and vfkb lived it in its own brain: gotcha `91338268` stayed live-and-wrong for
two days after its subject was fixed, actively misinforming sessions. The only conflict machinery
today (`findLexicalDuplicates`) is exact-match and curate-time; contradictions are near-misses by
construction and need surfacing at write time. Full context in RFC-012.

## Decision

On every explicit write (`kb_add` / `vfkb add`), run a **deterministic lexical conflict check**
against the live brain and surface candidate contradictions **in the write's result** — never
blocking, delaying, or auto-superseding:

1. `findConflictCandidates(text, tags, type)` — live entries sharing type-or-tag with
   distinct-stemmed-term overlap over a threshold (extends the ADR-0021 seam; thresholds tuned by
   unit fixtures at build).
2. The write always lands first (D3d unchanged); the result appends
   `⚠ possible conflict with <id> — kb_supersede / update / ignore`. No LLM on the write path;
   no interactive confirm.
3. Passive capture (`captureToolCall`/distill) is exempt.
4. `vfkb curate conflicts` — the same detector as a propose-only curate-time sweep.

This is a surfacing heuristic (a Brake), not a truth oracle — the deterministic backstop for
significant knowledge remains supersede + ADRs.

## Definition of Done

Scenario-contract-first (ADR-0023/0029): **L4 `contradiction-surface`** — seeded stale fact,
corrected info handed to the agent without mentioning supersede; vfkb arm ends with one live truth,
contrast arm accumulates contradictory duplicates; **run RED on both harnesses before the build**,
DEMONSTRATED ≥2/3. Plus deterministic unit fixtures for the detector (read-only, never mutates).

## Consequences

- `kb_add` gains a read pass over the live brain (negligible at per-project scale; measured in the
  unit gate). The add result grows at most one warning line.
- The biggest LLM-discipline gap in the trust model (stale entries outliving their truth) gets a
  mechanical nudge at the exact moment the fresh information is in-context.
- Once RFC-017's structural `contradicts` field exists ([ADR-0042](ADR-0042-schema-honesty.md)),
  the detector reads/writes real references instead of prose.
