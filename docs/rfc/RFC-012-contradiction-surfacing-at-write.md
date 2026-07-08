---
type: RFC
title: "RFC-012: Deterministic contradiction surfacing at write time"
description: "Deterministic contradiction surfacing at write time — conflict candidates in the `kb_add` result, never blocking (Track 9 Q1)"
status: "**Accepted → ADR-0037** (2026-07-06; Track 9 Q1 — build is scenario-contract-first, RED before build)"
timestamp: 2026-07-02
---

# RFC-012: Deterministic contradiction surfacing at write time

- **Status:** **Accepted → [ADR-0037](../adr/ADR-0037-contradiction-surfacing-at-write.md)** (2026-07-06; Track 9 Q1 — build is scenario-contract-first, RED before build)
- **Date:** 2026-07-02
- **Deciders:** operator + Claude
- **Relates:** [H4-DEVELOPMENT-ROADMAP §3 Track 9](../H4-DEVELOPMENT-ROADMAP.md) (fork decision
  `97cd3c55`), [ADR-0004](../adr/ADR-0004-decision-entry-type.md) (supersede-only decisions),
  [ADR-0021](../adr/ADR-0021-auto-distill-and-curator.md) (`findLexicalDuplicates` — the seam this
  extends), [ADR-0023](../adr/ADR-0023-scenario-contract-first.md) (the DoD contract),
  [research/agent-memory-landscape-2026-07.md](../research/agent-memory-landscape-2026-07.md) §7 #1.

## Context

**The problem is memory maintenance, not memory capacity — and agents demonstrably don't do it
unprompted.** The June-2026 "Supersede" paper (arXiv:2606.27472) measured frontier models with
self-maintained memory dropping 92%→77% on current-value questions (68%→28% at 24× conversation
length), and found **more memory budget did not help** — the bottleneck is superseding stale values,
which models skip unless prompted. TOKI (arXiv:2606.06240) adds the design constraint: contradiction
handling must keep the **LLM judge off the critical write path**, or replay/audit consistency breaks.

**vfkb just lived this failure in its own brain.** Gotcha `91338268` ("`--why` is a no-op") was
*fixed* on 2026-06-30 (Track 7, `foldWhy`), but the gotcha entry stayed live-and-wrong until the
2026-07-02 FEATURES.md inventory happened to collide with it — two days of a verified✓operator entry
actively misinforming sessions. Nothing in the write path surfaced the conflict when the fix landed;
the standing "record + supersede" prose rule did not fire. That is exactly the class of failure
ADR-0021 §"a prose rule with no Brake gets ignored" predicts.

Today the only conflict machinery is `findLexicalDuplicates` (curator, ADR-0021): **exact**
normalized-text equality, propose-only, curate-time. Contradictions are near-misses by construction
— same topic, *different* claim — so exact matching can never catch them, and curate-time is too
late (the wrong entry has already been injected into sessions).

## Decision (proposed)

**On every explicit write (`kb_add` / `vfkb add`), run a deterministic lexical conflict check
against the live brain, and surface candidate contradictions in the write's result — without ever
blocking, delaying, or auto-superseding.**

1. **Detection — `findConflictCandidates(text, tags, type)` (engine, new).** Deterministic and
   lexical, extending the ADR-0021 seam: a candidate conflict is a **live** entry (not archive, not
   superseded, not expired) that (a) shares the same `type` **or** at least one tag, and (b) exceeds
   a distinct-stemmed-term overlap threshold with the new text (reusing `index-store`'s stemmer;
   threshold tuned by unit fixtures at build — starting point: ≥½ of the shorter text's distinct
   terms, minimum 3 shared terms). Exact-duplicate pairs remain `findLexicalDuplicates`' job; this
   catches the *near*-miss.
2. **Surfacing — in the add result, never in its way.** The write **always lands first**
   (D3d: writes land instantly, nothing queues — unchanged). Then the result message appends:
   `⚠ possible conflict with <id> "<first line>" — if this REPLACES it: kb_supersede (decision) /
   update or curate merge (fluid); if both are true, ignore.` MCP `kb_add` and CLI `add` both carry
   it; the agent acts in the same turn with its normal tools. **No LLM on the write path** (TOKI);
   **no interactive confirm** (MCP has none; a block would stall fleet writes).
3. **Passive capture is exempt.** `captureToolCall`/distill writes skip the check (they are volume
   paths with their own containment — ADR-0021; recurrence there is *corroboration*, not conflict).
4. **Curate-time sweep — `vfkb curate conflicts` (propose-only).** The same detector over the whole
   brain, listing candidate contradiction pairs for the operator/curator — the offline complement,
   mirroring `curate dups`.
5. **A Brake, honestly scoped.** Like ADR-0027's Stop-hook: lexical overlap ≠ semantic
   contradiction, so this is a *surfacing* heuristic, not a truth oracle. False positives cost one
   line of noise ("ignore if both are true"); false negatives leave us exactly where we are today.
   The deterministic backstop for significant knowledge remains supersede + ADRs.

## Definition of Done (ADR-0023/0029 — scenario-contract-first)

- **L4 `contradiction-surface`** (named here as the contract): the sandbox brain is seeded with an
  accepted entry ("the API base port is 8080"); the task hands the agent corrected information
  ("ops moved it to 9090 — make sure the project knowledge is right") **without mentioning
  supersede**. **vfkb arm:** the brain ends with **one live truth** (a supersession edge or updated
  fluid entry; the old value excluded from default search). **Contrast arm** (engine with the check
  disabled): two live contradictory entries. **Run RED on both harnesses before the build**;
  DEMONSTRATED ≥2/3 (ADR-0022).
- **Deterministic inner gate:** unit fixtures for `findConflictCandidates` — catches a same-tag
  near-miss rewording, ignores an unrelated same-length text, never flags archived/superseded
  entries, and never mutates anything (detector is read-only; the never-rewrite Brake stands).

## Consequences

- `kb_add` gains a read pass over the live brain (materialize + stem-overlap) — negligible at
  per-project scale (the MCP read tools already do the same); measured, not assumed, in the unit gate.
- The add result grows one warning line at most; the tool description documents it so agents expect it.
- The curator vocabulary grows a propose-only op; no schema change, no new entry type, no new deps.
- The biggest LLM-discipline gap in the trust model (stale entries outliving their truth) gets a
  mechanical nudge at the exact moment the fresh information is in-context.

## Alternatives considered

- **Status quo (prose rule + curate-time exact dups).** Just failed live (gotcha `91338268`);
  contradictions are never exact matches.
- **Block-and-confirm on conflict.** Violates D3d (writes land instantly, nothing queues), stalls
  autonomous writers, and MCP has no confirm channel. Rejected.
- **Auto-supersede on high overlap.** An LLM-free heuristic silently rewriting knowledge lineage —
  worse than the disease; supersession must stay a deliberate act. Rejected.
- **LLM contradiction judge at write time.** TOKI shows this breaks replay/audit consistency unless
  every judgment is logged; also adds a metered call to the hot path. Rejected (an *off-path* LLM
  sweep could later ride Q4's sleep-time slot if evidence demands).
- **Embedding-based semantic conflict detection.** Re-opens the S1 gate by the back door; the
  BM25-first amendment (Track 9) says lexical until evidence fails. Rejected for v1 of this feature.
