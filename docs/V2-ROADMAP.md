# vfkb v2 — Development Roadmap

> **Type:** sequenced build plan + live status tracker for the v2 fork. **Created:** 2026-07-06
> (all six v2 RFCs accepted that day → ADR-0039..0044, plus the Track 9 acceptances ADR-0037/0038).
> **Authority:** sits under [H4-DEVELOPMENT-ROADMAP](H4-DEVELOPMENT-ROADMAP.md) §4 (which names the
> v2 fork the active frontier) and above the accepted decisions it sequences. Same protocol as the
> H4 roadmap: **this doc ratifies the order and tracks the work; a deviation (order change, scope
> change, blocker, new initiative) means update + re-ratify this doc — never build ad hoc.**
> **Branch discipline ([ADR-0036](adr/ADR-0036-v2-two-branch-strategy.md)):** every initiative
> below branches **from `v2`** and PRs **into `v2`**. Docs — including every status update to this
> file — land on `main` via the normal PR flow and sync to `v2`.

## Status legend

`NOT STARTED` · `IN PROGRESS` · `BLOCKED (reason)` · `DONE` (DoD **observed**, per ADR-0029 — never
asserted) · `GATED (trigger)`

## Ratified order (2026-07-06)

| # | Initiative | Decision | Status | DoD gate |
|---|---|---|---|---|
| V2-1 | Session backbone | [ADR-0039](adr/ADR-0039-session-backbone.md) ← RFC-014 | **DONE** (2026-07-06, `v2` PR #49 — DoD observed) | L4 two-session scenario + must-fail arm |
| V2-2 | Native concurrency lock | [ADR-0040](adr/ADR-0040-native-concurrency-lock.md) ← RFC-015 | **NOT STARTED — next** | cross-process race test + must-fail arm |
| V2-3 | `entries.jsonl` merge=union | [ADR-0041](adr/ADR-0041-entries-jsonl-merge-union.md) ← RFC-016 | NOT STARTED | local two-branch test + must-fail arm **+ GitHub server-side check** |
| V2-4 | Schema honesty | [ADR-0042](adr/ADR-0042-schema-honesty.md) ← RFC-017 | NOT STARTED | unit gates (structural invariant) |
| V2-5 | Rebuildable index | [ADR-0043](adr/ADR-0043-rebuildable-index-shape.md) ← RFC-018 | **GATED** | trigger in the ADR: observed consumer slowness / a real brain ≥10k entries / explicit request |
| V2-6 | Storage-backend seam | [ADR-0044](adr/ADR-0044-storage-backend-abstraction.md) ← RFC-019 | NOT STARTED — **sequenced last** | full existing suite passes unchanged |

## Per-initiative notes

### V2-1 — Session backbone (ADR-0039) — ✅ DONE 2026-07-06 (`v2` PR #49)

- Shipped exactly the accepted scope: hooks read `session_id` from their own stdin
  (`effectiveSessionId()`; `KB_SESSION_ID` overrides); `SessionData` gained
  `agentRole`/`agentLabel`/`branch`/`pid`; `KnowledgeEntry.session_id` stamped by `addEntry`
  (explicit opt or env); `SessionState.records()` documented as the concurrent-session registry.
- **DoD observed:** unit contract `test/session-backbone.test.ts` run **RED first** (8/10 failed
  pre-fix) → 167/167 green. L4 `scenarios/session-backbone.mjs` (real `claude -p`,
  `KB_SESSION_ID` unset): **fixed arm 11/11** — two sessions + one `--resume` turn against one
  brain → two isolated records, turn accumulation across the resume, captures stamped with the
  right session id; **baseline arm** vs the pre-fix dist showed fully ephemeral state (can-fail
  proven). Brain fact `12f87e6a2b05` (on `v2`).
- Honest limitation carried forward: the MCP server has no per-call harness id, so MCP `kb_add`
  writes stamp `session_id` only when the env override is set — revisit if per-call identity
  becomes available upstream.

### V2-2 — Concurrency lock (ADR-0040) — after V2-1

- Engine-internal advisory lock around read-decide-append (`kb_supersede`, `kb_transition`);
  lockfile scheme (`O_EXCL` + staleness), **not** `flock` (ADR-0013). Logs holder `session_id`
  (needs V2-1).
- The DoD test must force a **real cross-process** overlap (child processes with a barrier, or an
  injectable pause) — in-process callbacks cannot race on a synchronous storage layer; a test built
  that way passes with or without the lock (ADR-0029: a proof that can't fail proves nothing).
- Build-time open item: whether a future contradiction-aware `kb_add` (ADR-0037) joins the lock.

### V2-3 — merge=union (ADR-0041)

- One `.gitattributes` line + tests. **The load-bearing unknown:** whether GitHub's server-side PR
  merge honors `merge=union` — unverified, and it is this repo's actual merge path. The empirical
  check (a deliberately conflicting test PR observed against the merge button) is **part of the
  Done bar**, not follow-up. If negative → the follow-up decision in RFC-016's Open items (accept
  the trivially-resolvable gap vs. local-merge-and-push) gets made then.

### V2-4 — Schema honesty (ADR-0042)

- Structural `why` (additive to `foldWhy`), whole-envelope read-boundary validation (zod),
  structural `contradicts`. Unit-gated only. Envelope change → v2 branch (breaking allowed).
- Build-time call to make: malformed-entry surfacing shape (lean visible, not silent).

### V2-5 — Rebuildable index (ADR-0043) — GATED, not in the build order until triggered

- Shape ratified (incremental append-offset parsing, not content-hash staleness); **do not build**
  until the ADR's trigger fires. When it does, insert it into this order by re-ratifying this doc.

### V2-6 — Storage seam (ADR-0044) — deliberately last

- The interface is shaped by real experience from V2-2 (and V2-5 if triggered) — not designed
  speculatively. Strict no-behavior-change refactor; JSONL stays the only shipped backend.

## Parallel v1 queue (not v2 — built on `main`, tracked in the H4 roadmap)

[ADR-0037](adr/ADR-0037-contradiction-surfacing-at-write.md) (contradiction surfacing) and
[ADR-0038](adr/ADR-0038-cross-project-brain-query.md) (cross-project query) are accepted and build
**on `main`** (v1-compatible), scenario-contract-first, on operator request/evidence — see
[H4-DEVELOPMENT-ROADMAP §3 Track 9](H4-DEVELOPMENT-ROADMAP.md). Listed here only so one doc shows
everything accepted-but-unbuilt.

## Watch items (from the 2026-07-06 concurrency audit, brain fact `b8c2d3b13e27`)

1. **GitHub server-side `merge=union`** — the single most load-bearing unknown in the
   multi-agent-on-branches story; resolved by V2-3's DoD check.
2. **Cross-branch live visibility (corner case #12)** — the known residual gap no accepted RFC
   covers: two agents on diverged branches get no signal until merge + sweep. V2-6's seam is the
   deliberate door to the stronger (hosted) fix; a future RFC takes this slot only when concurrent
   dev-agent fleets are actually on the table.
3. **Post-merge contradiction sweep** — ADR-0037's detector is write/sweep-time, not merge-time;
   a post-merge `curate conflicts` step (CI/hook) is the obvious small follow-up, candidate for
   the same future RFC as #2.

## Update protocol

- **Status flips:** when an initiative's PR merges into `v2` with its DoD observed, flip its row to
  DONE in the same working session (docs PR to `main` → routine sync to `v2`) and record the
  completion in the brain.
- **Deviations:** any order/scope change or blocker → update this doc + a brain `decision` entry;
  standard-setting changes also get an ADR (supersede/amend, never edit a decided body — ADR-0001).
- **Exit criterion:** all non-gated initiatives DONE → the v2 ship decision (merge `v2`→`main` as
  one reviewed merge, or promote `v2` to be the new `main`) per ADR-0036 — deliberately not chosen
  yet.
