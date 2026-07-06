# Notes — corner cases when multiple dev agents work on one project concurrently

**Status:** discussion notes only — nothing decided, no RFC yet. Captured so the analysis
isn't lost before it's needed. If this turns into a proposal it should become its own RFC
(sibling to RFC-012/RFC-013 under Track 9), not be retrofitted into this doc.

**Scope:** *dev* agents (e.g. multiple Claude Code sessions/instances) building/maintaining
a project concurrently — git branches, PRs, the shared `.vfkb` brain, hook gating, identity.
Not about a product supporting concurrent *end-user* sessions (that's a separate, unrelated
question — vilonotes has its own in-repo design sketch for that, decision `ca9494a55213`).

**Origin:** prompted by planning ahead for a fleet of agents working on a project like
[vilonotes](https://github.com/vilosource/vilonotes), which already dogfoods vfkb the same
way this repo does (`.vfkb` committed, MCP-only writes, branch+PR workflow, solo-dev
self-merge latitude per its `AGENTS.md`).

## Verified fact this analysis leans on

Two branches independently appending a line to the tail of a JSONL file, from a common
ancestor, **do** produce a git merge conflict on the second merge — both diffs anchor to
the same last-line context, so git's 3-way merge treats them as competing edits at the same
location. Confirmed empirically (not assumed) with a throwaway repo:

```
git init; commit 3 lines to entries.jsonl
branch A: append one line, commit
branch B (from the same base): append a different line, commit
merge A into integrate  -> clean
merge B into integrate  -> CONFLICT (content): Merge conflict in entries.jsonl
```

This matters because `.vfkb/entries.jsonl` is exactly this shape (append-only, git-committed),
and it's the reason several of the corner cases below are guaranteed, not hypothetical.

## Corner cases

Two topologies fail differently: agents sharing one working directory (worse — file/process
level races), vs. agents in separate clones/worktrees each on their own branch (git/merge
level races). A third bucket is GitHub/infra-level, independent of topology.

| # | Issue | Where | Notes |
|---|-------|-------|-------|
| 1 | Silent file stomping — two agents editing the same source file with no lock | Shared working dir (code) | Edit/Write tools have no cross-process lock; a concurrent external writer's change can be silently discarded |
| 2 | `git index.lock` contention when two agents run git commands concurrently | Shared working dir | Well-known git behavior: second command fails with `Unable to create '.git/index.lock'` |
| 3 | SessionEnd auto-commit is fire-and-forget, exit code ignored — a lost git-lock race fails silently | Shared working dir | Verified at CLI v2.1.196: SessionEnd cannot block, its exit code is ignored — a failed brain commit here produces no visible error |
| 4 | Branch switching underfoot changes files mid-edit for the other agent | Shared working dir | |
| 5 | Port/process collisions when both agents run the same dev/verify process | Shared working dir | |
| 6 | Two MCP server processes both writing `entries.jsonl` | Shared working dir (brain) | Actually **safe** mechanically: writes use `appendFileSync` (atomic single-line writes), reads (`readAll()`) hit disk fresh every call — no stale in-process cache. Verified by reading `src/storage.ts`/`src/engine.ts`. |
| 7 | TOCTOU race: read-then-decide-then-append (`kb_supersede`, a future contradiction check) can miss a concurrent write | Brain, any topology | Two agents can independently supersede the same entry, or record contradicting decisions back-to-back, with neither call seeing the other's not-yet-flushed write |
| 8 | `.vfkb/entries.jsonl` merge conflict on every second PR that touches the tail since a common ancestor | Separate clones/branches (brain) | **Verified**, see above — trivial to resolve ("keep both lines") but it *will* stop an automated/self-merge flow |
| 9 | Careless conflict resolution (`-X theirs`, blind `--ours`) silently drops one agent's knowledge entry | Separate clones/branches (brain) | Follows from #8; the risk is who resolves it — an agent under "merge it yourself" latitude, not a human reviewer |
| 10 | Prose-doc merge conflicts on singleton files acting as execution authority (e.g. a roadmap or plan doc's status table) | Separate clones/branches (docs) | Worse than #8 — not append-only, no clean line-concatenation shape |
| 11 | Branch-name collisions (freeform `feat/…` naming, not agent-unique) | Separate clones/branches | |
| 12 | Stale mental model — each agent's session-start resume digest reflects the brain only as of its own branch point | Separate clones/branches (brain) | Two agents can work for hours and make contradicting design calls with no live signal between them |
| 13 | Same git identity for every agent — no attribution trail in `git blame`/`log` for who did what | Separate clones/branches | Makes postmortems harder when one agent's merge stomps another's change |
| 14 | PR-merge-order races on overlapping code files; careless self-merge can revert an earlier agent's hunk | GitHub-level, any topology | Same failure shape as #9 but for ordinary code, not the brain |
| 15 | Concurrent redeploys of a single-replica service racing on the same rollout | Infra-level | Specific to projects with a shared-workspace deployment model (vilonotes' researcher pod is one example, per its own recorded design-sketch finding) |

## Would a hosted brain (agents access it only via MCP, no local git-committed file) fix this?

Explored as a follow-up "what if" — not a proposal, just the tradeoff as currently understood.

**Fixes cleanly:** #6 (moot, only one server), #7 (a real service can do compare-and-swap /
serializable transactions — local file-append processes fundamentally can't coordinate this
way), #8 and #9 (no per-branch file left to merge), #12 (everyone reads the same live state
instead of "as of my last branch point").

**Untouched:** #1–5, #10, #11, #13, #14, #15 — all properties of git-based collaborative
*coding*, not of how the brain is stored. Hosting the brain doesn't make code merge/lock/port
problems go away.

**New problems introduced:**
- Single point of failure — every `kb_add`/`kb_search` now depends on a service being up;
  today an agent works fully offline against a local file.
- Needs real auth/multi-tenancy where local file permissions + the PreToolUse write-gate
  hook used to suffice for free.
- Bigger blast radius — a bad entry is visible to every agent immediately instead of scoped
  to one branch until its PR merges.
- Loses git's implicit review gate (an entry is only "real" once its PR merges). A hosted
  service agents write to directly needs to reinvent that (branch-scoped staging + promotion
  on merge) or reintroduces the same reconciliation problem server-side instead of git-side.
- **It reverses a principle already ratified in both repos**: vfkb's
  [ADR-0019](adr/ADR-0019-self-hosted-design-brain.md) ("the brain ships with the repo") and
  vilonotes' `AGENTS.md` ("durable state lives only in this repo — no shared volumes, no
  second source of truth"). A hosted brain is by definition a second source of truth git no
  longer fully captures — this would need its own ADR amendment before being built on, not a
  quiet architecture swap.

## Relevance to the current roadmap

Adjacent to Track 9 (RFC-012 deterministic contradiction surfacing at write time, RFC-013
cross-project brain query) but distinct from both: RFC-012 is about *detecting* contradictions
once written; RFC-013 is about *read-only* recall from a sibling project. This doc's #7/#12
are about *write-time coordination* and *live visibility* **within one project's own brain**
across concurrently-branching agents — a gap neither existing RFC currently covers. Worth a
Track 9 slot on the next roadmap re-ratification if this becomes real (i.e. the moment actual
concurrent dev-agent fleets on one project are on the table, not before).
