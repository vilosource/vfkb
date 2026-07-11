---
type: RFC
title: "RFC-031: Branch-aware brain visibility — entries stranded on topic branches stay recallable"
description: "The live index reads one working-tree file, but ADR-0033 and consumer close-the-loop discipline deliberately route entry lines onto topic branches — where get/search/supersede/contradicts cannot see them until merge. Proposal: git-union recall with provenance + dangling-edge writes."
status: Proposed
timestamp: 2026-07-11
---

# RFC-031: Branch-aware brain visibility — entries stranded on topic branches stay recallable

- **Status:** Proposed
- **Date:** 2026-07-11
- **Deciders:** operator + Claude
- **Relates:** [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) (brain is a
  committed in-repo file), [ADR-0033](../adr/ADR-0033-session-end-continuity.md)
  (SessionEnd auto-commits the brain **on the current topic branch, never main**),
  [ADR-0041](../adr/ADR-0041-entries-jsonl-merge-union.md) (`merge=union` — solved the
  merge-conflict half of the same underlying shape),
  [ADR-0037](../adr/ADR-0037-contradiction-surfacing-at-write.md) (the machinery this
  RFC's gap disables cross-branch), [RFC-013](RFC-013-cross-project-brain-query.md)
  (provenance-labeled recall from a store that isn't the bound one — the pattern this
  RFC reuses), [ADR-0014](../adr/ADR-0014-index-freshness.md),
  `docs/NOTES-multi-agent-concurrency-corner-cases.md` (#12: per-branch stale mental
  model), [RFC-019](RFC-019-storage-backend-abstraction.md) (where this feature sits:
  the JSONL-fs backend, not the backend contract)

## Context

### The incident (verified live, viloforge-infra, 2026-07-11)

Two agent sessions worked the same consumer repo on parallel tracks — one in the main
checkout, one in a git worktree on a PR branch. The worktree session called `kb_add`
(entry `70e4b2106558`, an ADR proposal record). The MCP server, launched with
`VFKB_DATA_DIR=".vfkb"` (relative — `brainDir()` in `src/storage.ts` returns the env
value verbatim, so it resolves against the server process's cwd), had bound the brain to
the **main checkout's** working file, so that is where the line landed.

Then close-the-loop discipline did exactly what it is supposed to do: the entry was
git-routed onto the PR branch it belonged to (commit `23b11cc` in that repo — "record
the ADR-0035 proposal decision in vfkb (close-the-loop)"), i.e. committed into the
worktree's copy of `entries.jsonl` and removed from the main checkout's working file.

Result, ~40 minutes after authoring: the **authoring session's own**
`kb_supersede 70e4b2106558` (a review had materially changed the recorded decision)
failed with `no such entry: 70e4b2106558`. So did `kb_get`. At that moment the repo
held two 131-line `entries.jsonl` files with **different tails** — the worktree's ends
with the workstation entry, the main checkout's with the other track's records — and no
live server instance could see both.

### Why this is systemic, not an edge case

Three deliberate designs jointly **guarantee** branch-resident entries:

1. **ADR-0019**: the brain is a git-committed file — git is the durability and
   distribution layer.
2. **ADR-0033**: the SessionEnd hook commits `entries.jsonl` **on the current topic
   branch and refuses main**. Every session that ends on a topic branch strands its
   new entries there until that branch merges.
3. **Consumer close-the-loop discipline** (viloforge-infra's constitution, and the
   pattern vfkb itself promotes): the record ships **in the same PR as the change it
   records**. Records are *supposed* to ride branches.

Meanwhile the read path assumes the opposite: the JSONL-fs backend materializes from
**one working-tree file**, and the write ops (`supersede`, `transition`,
`contradicts`) gate on an existence check against that same single file. The store has
**no git model at all** (verified: no git invocation anywhere in `src/`) — which was
the right simplicity call for the engine, but it means the moment git routing happens,
the entry falls out of the live brain:

- `kb_get`/`kb_search` cannot recall it — a parallel track makes decisions blind to
  in-flight knowledge (corner-case #12, now with teeth).
- `kb_supersede`/`kb_transition` **cannot correct it, even for its own author** — the
  window between "recorded on a branch" and "merged" is precisely when review feedback
  changes decisions (as it did in the incident).
- ADR-0037's contradiction machinery cannot draw edges to it, in exactly the situation
  (parallel tracks recording point-in-time facts) where contradictions are most likely.

ADR-0041 solved the *write-side* symptom of this shape (merge conflicts between
branch-resident appends). This RFC is the *read-side* twin: the union that ADR-0041
performs at merge time needs a runtime equivalent, so the brain is coherent **before**
merge, not only after.

### An adoption footnote discovered en route

The incident repo does not have ADR-0041's `.gitattributes` line at all
(`git check-attr merge .vfkb/entries.jsonl` → `unspecified`) and resolves the resulting
conflicts by hand ("entries.jsonl union" merge commits, three precedents). `vfkb init`
ships the attribute, but repos wired before it — or never re-inited — silently lack it.
`doctor` does not check for it.

## Decision (proposed)

Teach the **JSONL-fs backend** (this is deliberately a backend feature, not a
`StorageBackend` contract change — RFC-019) that its brain file may have git-resident
siblings, in three parts:

1. **Git-union recall.** When the brain dir sits inside a git repo, `readAll()` unions,
   deduped by id:
   - the bound working file (today's behavior — always authoritative for its own lines);
   - the same repo-relative file in **every other worktree** of the repo
     (`git worktree list --porcelain`);
   - the same path on **local branches ahead of the default branch**
     (`git show <branch>:.vfkb/entries.jsonl`), so entries survive even after their
     authoring worktree is removed.

   Entries found only outside the bound file carry provenance the way RFC-013's
   external hits do — labeled (`branch:<name>` / `worktree:<basename>`), never silently
   blended — and surface in `kb_get`, `kb_search`, the resume digest, and `kb_map`
   counts (e.g. "126 + 2 pending-merge"). Results cache keyed on the branch heads and
   file mtimes involved, so the git calls don't run on every read.

2. **Dangling-edge writes instead of a hard existence check.** `supersede`,
   `transition`, and `contradicts` targeting an id that is visible **only via the git
   union**: append the edge/status line to the **bound** working file as normal, and
   flag the result as cross-branch. Correctness holds for free: edges are themselves
   append-only lines, `materialize()` already joins by id across arbitrary line order,
   and the eventual merge union reunites edge and target — the same property ADR-0041
   already relies on. An id visible nowhere keeps today's hard `no such entry`.

3. **Doctor honesty.** Two new checks: (a) the consuming repo's `.gitattributes` lacks
   the ADR-0041 `merge=union` entry (the adoption gap above); (b) stranded
   branch-resident entries exist — report count and owning branches, so "your live
   brain is N entries behind its own branches" is visible instead of discovered via a
   failing supersede.

Explicitly **not** proposed: any cross-checkout or cross-branch *writes* (the bound
file remains the only thing the engine ever writes), any change to non-git backends,
and any attempt to read **remote-only** branches (the authoring machine is where
correction happens; see Limitations).

## Consequences

- **+** The authoring session can correct its own records during exactly the window
  (post-review, pre-merge) when corrections happen; the incident's failing
  `kb_supersede` becomes a flagged-but-successful write.
- **+** Parallel tracks recall each other's in-flight knowledge with honest provenance
  instead of working blind until merge — corner-case #12 shrinks from "hours of
  divergence" to "one read".
- **+** ADR-0037 contradiction surfacing regains its bite in the multi-track case.
- **−** git becomes a soft runtime dependency of recall in git-backed brains (it
  already is one for durability); mitigated by caching and by degrading gracefully to
  today's single-file behavior when git is absent or the dir isn't a repo.
- **−** Provenance-labeled hits can disappear locally when a merged branch is deleted —
  but their lines have by then landed on main, so durability is unchanged.
- **−** More surface in the backend: the union, the cache, and the provenance labels
  are all new code with concurrency corner cases of their own (a branch advancing
  mid-read is benign — same staleness class as ADR-0014 already accepts).

## Alternatives Considered

- **Bind the brain to the session's worktree** (resolve `VFKB_DATA_DIR` against
  `$CLAUDE_PROJECT_DIR` instead of server cwd). Fixes only the authoring session's
  self-correction, fragments recall per worktree, and makes two sessions in one
  checkout fight over binding. Worth doing *as well* someday for cwd-correctness, but
  it does not deliver cross-branch visibility — rejected as the primary fix.
- **Ban routing brain lines onto topic branches** (always commit entries straight to
  main). Directly contradicts ADR-0033's safe-by-default design and the consumer
  close-the-loop discipline that records ride the PR they belong to; also reintroduces
  the "knowledge merged before the change it describes" incoherence — rejected.
- **Discipline/documentation only** ("remember that branch entries are invisible").
  The incident was produced by the discipline's most careful path, not by sloppiness;
  a rule that says "your tools will lie to you, plan around it" is the anti-pattern
  this project exists to remove — rejected.
- **Central out-of-repo brain** (no git routing at all). Surrenders ADR-0019's
  committed-file property (review-gated knowledge, PR-scoped records, replayability);
  that trade is RFC-019 backend territory and far bigger than this gap — rejected here.

## Limitations

- The union sees **local** state only: other machines' unpushed branches stay
  invisible (unchanged from today), and remote-only branches are deliberately out of
  scope — fetching is a sync concern, not a read concern.
- Two sessions writing the **same** bound file concurrently is RFC-015's territory
  (locking), untouched here.
- Id collisions across branches with different content would union both lines and let
  `materialize()`'s existing last-write-wins/join semantics decide — same defensive
  posture ADR-0041 accepted (random 6-byte-hex ids make this vanishingly unlikely; a
  custom merge driver remains the place to catch it hard).
