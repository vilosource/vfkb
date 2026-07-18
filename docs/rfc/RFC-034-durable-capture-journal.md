---
type: RFC
title: "RFC-034: Durable capture — an untracked write-ahead journal closes the brain-loss window between write and commit"
description: "Every engine append is mirrored to an untracked journal inside the brain dir; a deterministic (id, updated)-pair line-union recovery at session start re-appends any journaled line the tracked entries.jsonl has lost. Kills the observed failure class (checkout --/reset --hard/stash destroying uncommitted knowledge) without touching commit cadence — per-write auto-commit is rejected by name because parked-on-main cross-repo records are uncommitted BY DESIGN (ADR-0063 §4) and commit cadence is entangled with the never-commit-on-main discipline (ADR-0033)."
status: "Proposed"
timestamp: 2026-07-18
---

# RFC-034: Durable capture — write-ahead journal + deterministic recovery

- **Status:** Proposed
- **Date:** 2026-07-18
- **Deciders:** operator + Claude
- **Fixes:** [#175](https://github.com/vilosource/vfkb/issues/175) (brain-loss window; routed
  from the ViloForge ASDLC method repo, OI consuming-project retrospective tee-up 6, half 1 of 2)
- **Relates:** [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) (the brain is a committed
  artifact — the constraint that creates the window this RFC closes);
  [ADR-0033](../adr/ADR-0033-session-end-continuity.md) (session-end auto-commit — the far edge
  of the window, deliberately unchanged here); [ADR-0040](../adr/ADR-0040-native-concurrency-lock.md)
  (the lock recovery must hold); [ADR-0041](../adr/ADR-0041-entries-merge-union.md) (merge=union —
  and its server-side gap, gotcha `3e7f95de56b4`, which argues *against* commit-cadence designs);
  [ADR-0063](../adr/ADR-0063-cross-repo-brain-write.md) §4 (visitor records park uncommitted on
  the target's `main` by design — any auto-commit cadence would violate it).

## Context — the observed failure class

The engine's documented instruction is *capture load-bearing knowledge immediately*. The
durability of that capture, however, is session-end-scoped at best: between an append and the
next brain commit, an entry exists only as an **uncommitted modification to a tracked file** —
the least durable state git offers. Any `git checkout -- <path>`, `reset --hard`, stash mishap,
worktree refresh, or crash inside that window silently destroys ratified knowledge.

This is not hypothetical. Three independent field incidents, all observed:

1. **OpenIntegrations (2026-07-15, the routing incident):** a worktree worker's careless
   `git checkout --` destroyed **five uncommitted entries**; recovered only because their text
   happened to survive in a conversation buffer.
2. **vfkb-claude-plugin (2026-07-17, gotcha `e3199efc468e`):** a `git reset --hard` in a consumer
   tree discarded two parked cross-repo record lines; recovered only because the originating
   session's transcript held the verbatim write — a recovery source that exists by luck, not
   design.
3. **vilonotes researcher pod (gotcha `6e4a9c68f202`):** the next session's
   `git reset --hard origin/<branch>` destroys the previous session's live `kb_add` writes
   *systemically*; the backend's own docstring admits the loss window is bounded, not eliminated.

The sharpening irony of ADR-0063: cross-repo records are *delivered* uncommitted and park on the
target's `main` until that repo's own next topic-branch brain commit — correct by design, and
exactly the state incident 2 destroyed. The design that makes delivery clean widens the window.

## Decision (proposed)

### §1 Journal every append

Every engine mutation that appends a line to `entries.jsonl` (add, supersede, transition,
update — the full append surface, enumerated at build time from the storage seam) **also appends
the identical JSONL line** to an **untracked journal**: `<brain>/.journal/wal.jsonl`.

- `.journal/` joins `.sessions/`, `.signals/`, `index-meta.json` in the gitignore set
  (`vfkb init` writes it; `vfkb doctor` checks it). **Untracked is the whole point**: `git
  checkout --`, `reset --hard`, and stash operate on tracked state and leave the journal alive.
  This is the property no commit-cadence design has.
- **Journal-first ordering.** The mirror line is appended to the journal *before* the primary
  append. A crash between the two leaves an extra journal line that recovery treats as a lost
  entry and restores — benign, because recovery is idempotent. The reverse order would leave a
  crash window in which the primary landed unprotected.
- The journal write is a **fail-open safety net with a loud edge**: if it fails (permissions,
  disk), the primary append still proceeds and the failure is surfaced in-band (see §2's
  reporting channel). The safety net must never make capture itself less reliable.
- **No new locking.** Plain appends are lock-free today (only the read-decide-append ops —
  update, supersede, transition, restamp — run under the ADR-0040 `withExclusive`) and stay
  that way: the journal mirror is safe unlocked because O_APPEND line writes don't interleave
  within a line and §2's recovery is order-independent (a line-level union, not a merge).

### §2 Deterministic recovery at session start

`recoverFromJournal()` — run automatically by the `session-start` hook (before the resume
digest renders), and exposed via `vfkb doctor` as a report line.

**The data model this must respect:** `entries.jsonl` is an **append-only LWW log** — nothing
in the engine rewrites lines in place; `updateEntry` and friends append a *new revision line*
per id and `materialize()` keeps newest-per-id at read time. Recovery is therefore a
**line-level diff keyed on the `(id, updated)` pair**, not on bare ids:

- Every journaled `(id, updated)` line absent from `entries.jsonl` is re-appended **verbatim** —
  byte-identical, lossless including intermediate revision lines (contrast: incident 2's
  transcript recovery had to mint a new id and annotate the restoration; journal recovery makes
  the loss invisible because nothing is lost).
- Idempotent, runs under the ADR-0040 lock (recovery *is* a read-decide-append op), and
  **reports in-band when it restores anything**: the restore note rides the injected resume
  digest that renders immediately after it (`restored N journaled entr(y/ies) lost from
  entries.jsonl — likely a destructive git operation; see RFC-034`) — hook stderr is not
  reliably surfaced to the operator, so the digest is the loud channel. A silent heal would
  hide the operator's near-miss from them.

### §3 Journal pruning (the GC that keeps §1 O(session))

Unpruned, the journal is an unbounded shadow copy. At recovery time (same pass, same lock):

- **Git brains** (the committed-brain norm, ADR-0019): drop journal lines whose **`(id, updated)`
  pair** exists in `git HEAD:entries.jsonl` — *committed is durable*; the journal only ever
  carries the uncommitted window. Pruning on **bare ids would reopen the loss window this RFC
  exists to close**: entry X committed at HEAD, then retagged/tombstoned in-session, would have
  its uncommitted revision line pruned (id present at HEAD) and a subsequent `reset --hard`
  would destroy it unrecoverably. Same key as §2, everywhere.
- **Non-git brains** (`~/.vfkb` default-dir tier): drop lines whose `(id, updated)` pair is
  present in `entries.jsonl` itself — the file is the only durability there, and the journal's
  job reduces to crash recovery.
- **Classification is conservative:** a brain is a git brain iff `git rev-parse
  --is-inside-work-tree` succeeds for its repo dir; if the HEAD read then fails for any reason
  (unborn branch in a freshly-init'd repo, detached/corrupt state), **prune nothing** that
  pass — never prune on uncertainty, since misclassifying into the non-git branch would prune
  precisely the uncommitted lines the journal protects.

### §4 The redaction escape hatch (the one flow recovery must not fight)

No *engine* flow removes lines from `entries.jsonl` (delete is an additive tombstone; curate
appends deltas; distill/import append) — so recovery conflicts with nothing the engine does.
The one legitimate line-removal flow is **manual secret redaction** (hand-edit plus history
rewrite after a leaked credential), and an unaware journal fights it twice: it retains a
plaintext copy in an untracked file no scrub playbook covers, and recovery re-appends the
redacted line **every session start, forever** (its pair is never at HEAD, so never pruned).
Therefore:

- `vfkb journal purge --id <id>` (and `--all`): removes matching lines from the journal and
  records the pair in `.journal/suppressed` — a pair listed there is never recovered again.
  Engine-written, like everything else in the brain dir.
- **Scrub-playbook rule:** any redaction of `entries.jsonl` MUST include the matching
  `journal purge` — documented where the redaction procedure lives (the ADR-0054 audit lineage),
  and `vfkb doctor` warns when a suppressed pair still exists in the journal file.

### §5 What this RFC deliberately does not do

- **No commit-cadence change.** Per-write or per-N-write auto-commits are **rejected**: (a) the
  session-end hook must never commit on `main` (ADR-0033), and mid-session the branch is often
  `main` — exactly when parked ADR-0063 §4 visitor records *must stay uncommitted*; (b) commit
  cadence multiplies the ADR-0041 server-side union gap (gotcha `3e7f95de56b4`: GitHub's merge
  button does not run the union driver, so brain-writing branches conflict pairwise); (c) a
  commit is a *publication* decision the operator owns, not a durability mechanism.
- **No move of `entries.jsonl` out of git.** ADR-0019 stands: the brain ships with its repo.
- **No transcript mining.** Transcript recovery (incident 2) remains the forensic last resort,
  not a designed path.

## Alternatives considered

Per-write/per-N auto-commit and moving `entries.jsonl` out of git — both rejected in §5 with
reasons; OS-level backup (Time Machine/btrfs snapshots) rejected as not portable and not
engine-owned; committing the journal itself rejected as circular (a tracked journal dies by the
same `reset --hard`).

## Consequences

- Every append costs a second small write; the journal is bounded by §3's prune to the
  uncommitted window (typically a session's worth of lines).
- The brain dir gains a second plaintext copy of uncommitted knowledge — inert for git, but
  **secret-scrub procedures must cover `.journal/`** (§4; the suppression file is the
  mechanical half of that rule).
- A destroyed-and-recovered brain becomes a *reported near-miss* instead of a silent loss —
  the operator learns their git habit bit them, which is itself the behavioral fix.

## Definition of Done (ADR-0050 — this is agent-observable, so a full L4)

Named scenario: `scenarios/brain-durability.mjs` (this repo), RED-first:

- **Wired arm:** sandboxed git repo with a live brain; a real agent session writes entries
  through the real surface; the harness then destroys the uncommitted tracked state
  (`git checkout -- .vfkb/entries.jsonl`); a **fresh session-start** must surface the destroyed
  entries again (observed in the injected bundle / `kb_list`, ids identical to the originals).
- **Contrast arm (can fail):** identical flow with the journal disabled — the entries must be
  observably gone. A recovery that cannot be seen failing proves nothing.
- Structural invariants (`(id, updated)`-pair line union, prune-at-HEAD-by-pair, fail-open
  journal write, lock held) are deterministic unit tests — the inner gate, per the testing
  pyramid.

## Rollout

Engine change → lands on `main` behind the normal PR + ADR-0052 review gate → delivered to
consumers by the ADR-0062 automation (re-vendor PR, four plugin L4 re-pins, release). The
vilonotes pod (incident 3) additionally needs its backend's `reset --hard` to move to
`checkout`-preserving semantics or run recovery first — out of scope here, tracked in that repo.
