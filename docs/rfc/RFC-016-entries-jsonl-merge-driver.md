# RFC-016: A git merge driver for `entries.jsonl`

- **Status:** Proposed
- **Date:** 2026-07-05
- **Deciders:** operator + Claude
- **Relates:** [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) (the brain ships
  inside the repo, committed), `docs/NOTES-multi-agent-concurrency-corner-cases.md`
  (corner cases #8/#9), `docs/V2-VISION.md` §3.1

## Context

Verified empirically this session, not assumed: two branches independently appending a
line to the tail of a JSONL file, from a common ancestor, **do** produce a git merge
conflict — both diffs anchor to the same last-line context, so git's 3-way merge treats
them as competing edits at the same location.

```
git init; commit 3 lines to entries.jsonl
branch A: append one line, commit
branch B (from the same base): append a different line, commit
merge A into integrate  -> clean
merge B into integrate  -> CONFLICT (content): Merge conflict in entries.jsonl
```

Since `.vfkb/entries.jsonl` is exactly this shape (append-only, git-committed), **every
second branch that merges after another has already appended since their common ancestor
will conflict** — guaranteed, not occasional. The resolution is always the same
("keep both lines"), which makes it a mechanical, automatable problem rather than a real
editorial conflict — but today it stops an automated or self-merge flow every time, and
under a "merge it yourself, no reviewers required" solo-dev latitude (this repo's own
convention, and vilonotes' `AGENTS.md`), a careless resolution (`-X theirs`, blind
`--ours`) can silently drop one side's knowledge entry with no error.

## Decision

Ship a `.gitattributes` entry for `.vfkb/entries.jsonl` pointing at a custom merge driver
(installed by `vfkb init` for consumers, and via a `git config` step documented in
onboarding), which:

1. Parses both sides' versions as JSONL.
2. Unions the entries by `id` (exact-duplicate entries — same id appearing on both sides
   after a rebase/cherry-pick — are deduped, not doubled).
3. Orders the merged result deterministically by each entry's own `created` timestamp
   (not by which branch happened to merge first, and not by arrival order at merge time) —
   so the resulting file is stable regardless of merge direction.
4. **Falls back to a real conflict** if either side's content isn't valid JSONL, or if an
   id collision has genuinely different content on each side (should not happen given
   random 6-byte-hex ids, but defensive — never silently pick a "winner" between two
   different entries claiming the same id).

## Alternatives Considered

- **Git's built-in `merge=union`** — rejected as the whole solution: plain line-union
  doesn't dedupe by id and doesn't guarantee timestamp ordering, so the merged file's
  order becomes an accident of merge mechanics rather than a stable property. (It may be
  a useful low-level primitive the driver script builds on — not excluded as an
  implementation detail, just not sufficient on its own.)
- **Always resolve conflicts by hand** (status quo) — rejected: this is exactly the
  guaranteed-conflict problem motivating the RFC, and hand resolution is where the
  silent-data-loss risk (careless `-X theirs`) actually lives.
- **A rebase-only workflow to avoid the conflict shape entirely** — rejected: doesn't fit
  this repo's own branch-then-PR-merge workflow, and doesn't help consumers who don't
  rebase; the fix should work regardless of merge vs. rebase.

## Definition of Done

Re-run this RFC's own empirical test (two branches append from a common ancestor) with the
merge driver installed: the second merge must now succeed cleanly, with both entries
present, in timestamp order, no conflict markers. **Must-fail arm:** the same test without
the driver installed must still conflict (proves the test isn't vacuous).

## Open items

- Whether the driver should also detect and warn on (not silently merge) two entries that
  look like near-duplicates of the same knowledge (different ids, very similar text) —
  tempting, but likely belongs with RFC-012's contradiction work rather than this RFC's
  narrower merge-mechanics scope. Left out here deliberately.
