---
type: Decision
title: "ADR-0086: SessionEnd's floor mechanics: git add only where it changes the outcome, one meta write after the commit (amends ADR-0033 §3 and ADR-0014)"
description: "To cut SessionEnd's whole-brain work, runSessionEnd runs git add only for an untracked, deleted or renamed brain, and writes index meta once per run, after the commit, instead of per append. The guarantees are unchanged: pre-staged files are never swept in, a staged deletion or rename is never committed, and any run that wrote to the brain refreshes meta."
status: "Accepted"
timestamp: 2026-11-06
---

# ADR-0086: SessionEnd's floor mechanics

- **Status:** Accepted (2026-11-06)
- **Tracking:** [vfkb#448](https://github.com/vilosource/vfkb/issues/448), under
  [vfkb#389](https://github.com/vilosource/vfkb/issues/389).
- **Amends:**
  - [ADR-0033](ADR-0033-session-end-continuity.md) §3, which prescribes `git add -- entries.jsonl`
    then `git commit -o`: the **mechanism**, not the guarantee.
  - [ADR-0014](ADR-0014-index-freshness.md), which makes meta regeneration a side-effect of every
    write: a batch writer may defer it to one write after the batch.

## Context

Claude Code gives SessionEnd hooks 1.5 s by default, and a run that passes it loses its commit
([vfkb#384](https://github.com/vilosource/vfkb/issues/384)). Profiles under
`docs/research/probes/sessionend-floor-2026-11-04/` showed two whole-brain materializations for
index meta per run. Measured in review on a brain of about 13 MB (N=7 medians): `git add` then
`commit -o` took 127 ms, `commit -o` alone 93 ms.

## Decision

1. **`git add` runs only when the brain's status starts with `??` or `D`** (after trimming), which
   includes a rename away: under the single-file pathspec a rename reports as a deletion. For any
   other status, `git commit -o -- <path>` takes the work-tree file itself.
   - Keeping the add for a staged deletion is required. `git add` fails on a path gone from both
     index and work tree, and that failure is what keeps a staged `git rm` or `git mv` out of the
     auto-commit. Review of the first version observed `commit -o` alone committing the deletion.
2. **Index meta is written once per SessionEnd, after the commit,** and only if the run wrote to
   the brain or a brain write threw (it may have written first), or the commit threw after a write. The commit is the floor; meta is
   derived. A meta write cut off by the budget leaves stale meta, the same state a `git pull`
   leaves, and the next engine write refreshes it.
3. `newEntriesSinceHead` reads ids from each line's prefix and parses only lines not in HEAD.

## Consequences

- ADR-0033's guarantees stand, and tests pin them: no pre-staged file is swept in, and a staged
  deletion or rename is never committed.
- Outcomes that differ from `git add` + `commit -o`, all observed in review (41 shapes, real git),
  none losing data:
  - For a tracked brain, the index is no longer touched before a commit that fails: a rejecting
    hook, a merge or cherry-pick in progress, `UU`, `UD`, `AD`. (The add marked a conflict resolved,
    and the commit then failed anyway.) Untracked and `D` paths still go through the add, and stay
    staged on failure.
  - A tracked brain that is also gitignored (the add staged it, then failed) or outside a sparse
    cone (the add refused) now commits.
  - A pre-commit hook that reads the main index instead of `GIT_INDEX_FILE` sees it without the
    brain's staged change.
- Accepted: a committed line that starts like an engine line and ends in `}` but is not valid JSON
  (two torn appends merged) counts its first id as known. The new-entry count can be one low; the
  commit still lands.
- `vfkb doctor`'s SessionEnd marker closes after the meta write, so a run cut off there can read as
  unfinished although its commit landed.
- SessionEnd's cost still grows linearly with the brain. Nothing here removes that.
