---
type: Decision
title: "ADR-0064: Durable capture — an untracked write-ahead journal closes the brain-loss window between write and commit (accepts RFC-034)"
description: "Every engine append is mirrored journal-first to the untracked <brain>/.journal/wal.jsonl; session-start runs a deterministic (id, updated)-pair line-union recovery that re-appends verbatim any line the tracked entries.jsonl lost, reporting restores in the injected digest. Prune keys on (id, updated) pairs at git HEAD (bare ids would reopen the loss window for retagged entries), classification is conservative (never prune on uncertainty), and a redaction escape hatch (vfkb journal purge + .journal/suppressed) keeps recovery from resurrecting scrubbed secrets. Commit-cadence designs rejected by name: parked ADR-0063 §4 records are uncommitted BY DESIGN and ADR-0033 forbids main commits. DoD = the RED-first L4 scenarios/brain-durability.mjs with a journal-disabled contrast arm."
status: "Accepted"
timestamp: 2026-07-18
---

# ADR-0064: Durable capture — write-ahead journal + deterministic recovery

- **Status:** Accepted
- **Date:** 2026-07-18 (operator ratification; RFC landed via PR #198 after a two-round
  adversarial review)
- **RFC:** [RFC-034](../rfc/RFC-034-durable-capture-journal.md) — the full specification,
  observed field-incident evidence (three independent losses), design constraints, rejected
  alternatives, and the redaction escape hatch live there.
- **Fixes on build:** [#175](https://github.com/vilosource/vfkb/issues/175)
- **Relates:** [ADR-0019](ADR-0019-self-hosted-design-brain.md) (the committed brain creates the
  window this closes); [ADR-0033](ADR-0033-session-end-continuity.md) (the far edge of the
  window, unchanged); [ADR-0040](ADR-0040-native-concurrency-lock.md) (recovery runs under the
  lock; plain appends stay lock-free); [ADR-0041](ADR-0041-entries-merge-union.md) +
  [ADR-0063](ADR-0063-cross-repo-brain-write.md) §4 (why commit cadence is the wrong axis);
  [ADR-0023](ADR-0023-scenario-contract-first.md) /
  [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md) (the DoD contract the named scenario
  serves).

## Decision

Accepted as specified in RFC-034 §1–§5: journal-first untracked mirror of every append;
`(id, updated)`-pair line-union recovery at session start (verbatim re-append, digest-borne
restore report); pair-keyed prune at git HEAD with never-prune-on-uncertainty classification;
`vfkb journal purge` + `.journal/suppressed` as the redaction escape hatch; no commit-cadence
change, no move of `entries.jsonl` out of git, no transcript mining.

## Status honesty (ADR-0050/0051)

**Decided, NOT yet built.** Build is scenario-contract-first: `scenarios/brain-durability.mjs`
written and observed RED before the implementation lands; DEMONSTRATED ≥2/3 with the
journal-disabled contrast arm observed failing. Until that record is committed, the only honest
status of the capability is "built, NOT yet verified" — and before the build, simply "decided".
