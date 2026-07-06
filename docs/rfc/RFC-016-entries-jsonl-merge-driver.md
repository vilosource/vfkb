# RFC-016: `entries.jsonl` stops guaranteeing a merge conflict on every second branch

- **Status:** **Accepted → [ADR-0041](../adr/ADR-0041-entries-jsonl-merge-union.md)** (2026-07-06;
  v1 = `merge=union`; the GitHub server-side check stays part of the build's Done bar)
- **Date:** 2026-07-05 (revised 2026-07-05 after independent review — see Limitations below)
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

**v1 (this RFC, revised):** ship a `.gitattributes` entry marking `.vfkb/entries.jsonl` as
`merge=union` — git's built-in union driver, no external command, no per-clone
installation step. See Limitations below for why this is sufficient given how
`materialize()` already tolerates arbitrary order and duplication, and for the real
open question about whether it even needs to apply outside local merges.

**Possible future refinement (not this RFC's v1, not blocking it):** a custom driver that
additionally (1) dedupes by `id` rather than relying on `materialize()` to do it at read
time, (2) orders the merged result deterministically by each entry's own `created`
timestamp for cleaner diffs, and (3) falls back to a real conflict if an id collision has
genuinely different content on each side (defensive — should not happen given random
6-byte-hex ids, but a custom driver could catch it explicitly where union cannot). Worth
building only if the cosmetic/defensive value is judged worth maintaining an external
script — not decided here.

## Limitations (added after independent review — read before accepting)

Two things the original draft got wrong or overstated:

1. **`merge=union` is not "insufficient" — `storage.ts`'s own design already tolerates
   it.** `materialize()`'s comment says it plainly: *"Order-independent in `updated` →
   merge=union safe."* Because `materialize()` collapses the append log by id (keeping
   the newest `updated`) regardless of file order, a plain union merge — arbitrary line
   order, possible duplicate lines — already produces a **correct** live entry set today;
   file order and incidental duplication carry no semantic weight. So the custom driver's
   real value over the free, built-in `merge=union` is narrower than first framed: it
   avoids the conflict marker appearing at all (union does that too, for free, with zero
   installation), plus two genuine extras — deterministic file *diffs* (cosmetic, but
   real for anyone reading `git log -p` on this file) and a defensive same-id-different-
   content check (a real correctness backstop, even if unlikely given random 6-byte-hex
   ids). Whether that's worth a custom driver over just shipping `merge=union` — one
   `.gitattributes` line, no installation step, no external command to maintain — is a
   real open question, not a foregone conclusion. **This RFC now proposes `merge=union`
   as the v1 fix**, with the custom driver's extra guarantees (dedup-by-id, timestamp
   ordering, the defensive check) as a possible v2-of-v2 refinement, not a blocker to
   shipping the simple version first.
2. **A custom merge driver cannot run on GitHub's server-side PR merge — this repo's
   actual merge path.** `.gitattributes` only maps a path pattern to a driver *name*; the
   driver *command* itself is registered via local `git config merge.<name>.driver
   "<command>"`, which is not part of the repository and is never seen by GitHub's
   merge-computation service. So a custom driver only ever helps a **local** `git merge`
   (e.g. a maintainer merging and pushing directly) — it does nothing for a PR merged via
   the GitHub UI/API, which is how every PR in this repo actually lands. Whether GitHub's
   server-side merge computation honors the *built-in* `merge=union` attribute at all is
   **not verified here either** — flagged as unverified, not asserted true. Given this,
   `merge=union` alone may not close the gap on the primary merge path regardless; this
   needs an empirical check (open a real test PR with a deliberately conflicting
   `entries.jsonl` append and see what GitHub's merge button actually does) before this
   RFC can claim the guaranteed-conflict problem is solved end-to-end.

## Alternatives Considered

- **Git's built-in `merge=union`** — no longer rejected (see Limitations #1); now the
  proposed v1 fix. Originally dismissed for not guaranteeing dedup/ordering, which turned
  out to not matter given `materialize()`'s own order-independence.
- **Always resolve conflicts by hand** (status quo) — rejected: this is exactly the
  guaranteed-conflict problem motivating the RFC, and hand resolution is where the
  silent-data-loss risk (careless `-X theirs`) actually lives.
- **A rebase-only workflow to avoid the conflict shape entirely** — rejected: doesn't fit
  this repo's own branch-then-PR-merge workflow, and doesn't help consumers who don't
  rebase; the fix should work regardless of merge vs. rebase.
- **Require local-merge-and-push instead of the GitHub merge button**, to make the driver
  actually apply — not rejected, but not adopted either; a real workflow change with its
  own cost (loses GitHub's PR-merge UI/audit trail), only worth it if the empirical check
  in Limitations #2 confirms the server-side path is genuinely unfixable otherwise.

## Definition of Done

Re-run this RFC's own empirical test (two branches append from a common ancestor) with
`merge=union` configured, via a **local** `git merge` — must now succeed cleanly with both
entries present, no conflict markers (dedup/ordering not asserted, since union doesn't
guarantee either — only "no conflict, no data loss" is the claim for v1). **Must-fail
arm:** the same test without the attribute configured must still conflict. **Separately,
before this RFC can be considered to have closed the real-world problem:** the GitHub
server-side check from Limitations #2 — open an actual test PR with a conflicting append
and observe whether the merge button honors `merge=union` or still blocks. This second
check is part of the Done bar, not optional follow-up, since the local-only case doesn't
represent how this repo actually merges PRs.

## Open items

- Whether the driver should also detect and warn on (not silently merge) two entries that
  look like near-duplicates of the same knowledge (different ids, very similar text) —
  tempting, but likely belongs with RFC-012's contradiction work rather than this RFC's
  narrower merge-mechanics scope. Left out here deliberately.
- If the GitHub server-side check in the DoD comes back negative (union not honored
  there either), this RFC needs a follow-up decision: accept the gap (conflicts still
  happen on GitHub-merged PRs, just resolved trivially by hand since union already makes
  the *right* resolution obvious), or invest in the local-merge-and-push workflow change.
  Not pre-decided here.
