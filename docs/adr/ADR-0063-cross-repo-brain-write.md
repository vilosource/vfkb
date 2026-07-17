---
type: Decision
title: "ADR-0063: Cross-repo brain write — a cross-repo operation reads the target's brain first, then leaves one deliberate `cross-repo` record in it, delivered via a second pinned section (accepts RFC-033)"
description: "When a session in repo A deliberately changes repo B's observable state, it first consults B's brain (the ADR-0038 read side), then writes exactly one cross-repo record fact into B's brain through the engine — tagged `cross-repo` and NEVER `handoff`/`next` (the resident's ADR-0049 continuity pin is not the visitor's channel; the motivating sweep's handoff-tagged entries hijacked all eleven target pins before being retagged). Delivery is a second bounded pinned section (`## Cross-repo operations`), an engine render feature shipped together with `vfkb broadcast`; until it ships, v1 delivery is disclosed best-effort. Write-never-commit; arrives unverified; MCP-side targeting, auto-broadcast, and any global store rejected by name. DoD = the three-arm L4 `cross-repo-record` (unpressured v1 arm, RED-first pressured delivery arm, sentinel-keyed contrast arm)."
status: "Accepted"
timestamp: 2026-07-17
---

# ADR-0063: Cross-repo brain write — operation record broadcast

- **Status:** Accepted
- **Date:** 2026-07-17
- **RFC:** [RFC-033](../rfc/RFC-033-cross-repo-brain-write.md) (accepted 2026-07-17 after two
  independent review cycles; the full specification, evidence trail, and rejected alternatives
  live there)
- **Relates:** [ADR-0038](ADR-0038-cross-project-brain-query.md) (the read side this
  complements); [ADR-0049](ADR-0049-session-start-handoff-pinning.md) (the handoff pin the
  convention must not hijack — and the mechanics the new pin reuses);
  [ADR-0033](ADR-0033-session-end-continuity.md) (commit semantics leaned on);
  [ADR-0019](ADR-0019-self-hosted-design-brain.md) (the committed brain is the delivery
  vehicle); [ADR-0040](ADR-0040-native-concurrency-lock.md) (concurrent-append safety);
  [ADR-0011](ADR-0011-envelope-richness.md) (`ProvenanceOrigin`, deferred extension);
  [ADR-0023](ADR-0023-scenario-contract-first.md) / [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md)
  (the DoD contract).

## Context

The 2026-07-17 plugin-0.6.0 consumer sweep changed eleven sibling repos' observable state from a
session running in vfkb. Both halves of the case for a standing discipline were observed live:
without brain-side records the targets' next sessions meet altered wiring with no recallable
explanation, and the `viloforge-wiki` collision (a redundant, conflicting migration PR) happened
precisely because prior cross-repo work was recorded nowhere a visitor recalls from. The write
capability already exists (`VFKB_DATA_DIR` + the engine CLI); what was missing was the
discipline, the provenance convention, the ergonomics — and, found by independent review, the
delivery decision: the sweep's records were initially tagged `handoff` and **hijacked the
ADR-0049 continuity pin in all eleven targets** (remediated by engine retag the same day).

## Decision

1. **The convention.** A session that deliberately changes another repo's observable state
   **first consults that repo's brain** (ADR-0038 read side; CLI read today), then **leaves
   exactly one `fact` in it, through the engine** — what was done, where it landed, what was
   verified, what the target still needs to do. Tagged **`cross-repo`** (plus operation tags),
   **never `handoff`/`next`**; text opens with a **`CROSS-REPO <operation> (<date>, from
   <origin>)`** marker. Read-only visits leave no record.
2. **Delivery.** The Tier-A bundle grows a **second bounded pinned section,
   `## Cross-repo operations`** — newest injectable `cross-repo`-tagged entry, ADR-0049
   mechanics (selection-is-a-filter, char cap, truncate-with-id), rendered after
   `## Last handoff`. Resident continuity and visitor records each get one guaranteed slot;
   neither evicts the other. **Until the pin ships, v1 delivery is best-effort** (ranked facts
   drop first) — disclosed, never assumed.
3. **Transport.** v1 (now): `VFKB_DATA_DIR=<target>/.vfkb <engine> add fact … --tag cross-repo`.
   v2 (build): **`vfkb broadcast "<text>" --to <dir>,…`** — stamps tag/marker/date, refuses
   schema-incompatible targets and targets with no `.vfkb/manifest.json` (**v1 and `broadcast`
   alike** must not write to a no-brain target — never bootstrap a wire-less brain), and reports
   per-target success **and commit posture** ("written; uncommitted; target parked on `main`").
4. **Write, never commit.** The entry rides the target's own brain-commit discipline
   (ADR-0033). No `--commit` flag. The uncommitted window (silently erasable in the target's
   working tree) is accepted with eyes open.
5. **Trust & provenance.** Records arrive agent-authored, **unverified**; the target promotes.
   Structural `ProvenanceOrigin { kind: 'project' }` is deferred — trigger: the first need to
   *filter or gate* on cross-repo origin.
6. **Rejected by name:** MCP-side targeting (session tools stay bolted to the local brain);
   auto-broadcast (deliberate-capture doctrine); delivering via the resident's `handoff` pin
   (observed to evict continuity and suppress the ADR-0033 B2 floor); any shared/global store.
7. **Definition of Done** (ADR-0023/0050): L4 **`cross-repo-record`**, three arms keyed on an
   unguessable sentinel with git kept uninformative — the **unpressured v1 arm** (green =
   convention done at its claimed strength), the **pressured delivery arm** (seeded budget
   overflow; expected RED until the §2 pin ships — the pin/`broadcast` build's evidence gate),
   and the **contrast arm** (no record → no sentinel). Until the relevant arm's committed
   DEMONSTRATED record exists, each capability's honest status is *built, NOT yet verified*.

## Consequences

- Cross-repo operations become recallable where their effects live, in any clone, with no new
  tier, service, or schema change; the wiki-collision class shrinks from both directions
  (read-before-operate + the left record).
- v1 remains a prose rule with no Brake (named, accepted); the brain-write PreToolUse gate also
  guards only the session's *own* brain — extending it to any `*/.vfkb/entries.jsonl` is
  deferred with the trigger *first observed hand-edit of a foreign brain*.
- The pin and `broadcast` are a small engine build gated RED-first by the delivery arm; until
  built, cross-repo records in mature brains may not surface at session start — v1's disclosed
  limit.
