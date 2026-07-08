---
type: Decision
title: "ADR-0041: `entries.jsonl` merges via `merge=union` (accepts RFC-016, v1 shape)"
description: "`entries.jsonl` merges via built-in `merge=union`; custom driver deferred (accepts RFC-016 as revised)"
status: "Accepted"
timestamp: 2026-07-06
---

# ADR-0041: `entries.jsonl` merges via `merge=union` (accepts RFC-016, v1 shape)

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** operator + Claude
- **Accepts:** [RFC-016](../rfc/RFC-016-entries-jsonl-merge-driver.md) **as revised**: the v1 fix
  is git's built-in `merge=union`; the custom driver is an explicitly-not-decided future
  refinement. The RFC's Limitations section is part of the decision.
- **Relates:** [ADR-0019](ADR-0019-self-hosted-design-brain.md) (the committed brain whose merge
  shape this fixes), [ADR-0036](ADR-0036-v2-two-branch-strategy.md) (**builds on `v2`**),
  NOTES corner cases #8/#9.

## Context

Empirically verified (and re-confirmed live on 2026-07-06, when **every doc PR in the #25–#30
merge batch conflicted on `entries.jsonl` exactly as predicted**): two branches appending to the
same JSONL tail from a common ancestor always conflict. The correct resolution is always union —
`materialize()` collapses the log by id keeping the newest `updated`, so file order and incidental
duplication carry no semantic weight ("Order-independent in `updated` → merge=union safe",
`src/storage.ts`). Today the guaranteed conflict stops every automated flow and invites
silent-data-loss hand resolutions (`-X theirs`).

## Decision

**v1:** ship a `.gitattributes` entry marking `.vfkb/entries.jsonl` as `merge=union` — built-in,
no external command, no per-clone installation. A custom merge driver (dedup-by-id at merge time,
timestamp-ordered output, defensive same-id-different-content conflict) remains a possible later
refinement, **not** decided here — and it can never run on GitHub's server-side merge anyway
(driver commands are local git config).

## Definition of Done (both arms required)

1. **Local:** re-run the RFC's own two-branch test with the attribute — clean merge, both entries
   present. **Must-fail arm:** without the attribute, it still conflicts.
2. **GitHub server-side (unverified, flagged in the RFC):** open a real test PR with a
   deliberately conflicting append and observe whether GitHub's merge computation honors
   `merge=union`. If it does not, the follow-up decision in RFC-016's Open items (accept the
   trivially-resolvable gap vs. a local-merge-and-push workflow) gets made then — not pre-decided.

## Consequences

- The all-doc-PRs-conflict tax observed in this repo's own flow disappears for local merges
  immediately; the GitHub-path answer is an empirical output of the DoD.
- Duplicate lines a union merge can produce are already harmless at read time
  (`materialize()` dedups); the 2026-07-06 batch also validated the manual equivalent
  (union + newest-`updated` wins) against a real proposed/accepted duplicate pair.
- **Builds on `v2`** (a `.gitattributes` + tests change riding the v2 storage work).
