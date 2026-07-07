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
| V2-2 | Native concurrency lock | [ADR-0040](adr/ADR-0040-native-concurrency-lock.md) ← RFC-015 | **DONE** (2026-07-06, `v2` PR #55 — DoD observed, review gate run) | cross-process race test + must-fail arm |
| V2-3 | `entries.jsonl` merge=union | [ADR-0041](adr/ADR-0041-entries-jsonl-merge-union.md) ← RFC-016 | **DONE** (2026-07-06, `v2` PR #58 — both DoD arms observed, gate: MERGE) | local two-branch test + must-fail arm **+ GitHub server-side check** |
| V2-4 | Schema honesty | [ADR-0042](adr/ADR-0042-schema-honesty.md) ← RFC-017 | **DONE** (2026-07-06, `v2` PR #61 — RED-first proof, gate: MERGE w/ tracked conditions) | unit gates (structural invariant) |
| V2-5 | Rebuildable index | [ADR-0043](adr/ADR-0043-rebuildable-index-shape.md) ← RFC-018 | **GATED** | trigger in the ADR: observed consumer slowness / a real brain ≥10k entries / explicit request |
| V2-6 | Storage-backend seam | [ADR-0044](adr/ADR-0044-storage-backend-abstraction.md) ← RFC-019 | **DONE** (2026-07-06, `v2` PR #64 — suite unchanged, gate: MERGE) | full existing suite passes unchanged |

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

### V2-2 — Concurrency lock (ADR-0040) — ✅ DONE 2026-07-06 (`v2` PR #55)

- Shipped: `src/lock.ts` — engine-internal advisory lock at `<brain>/.lock` (O_EXCL, ADR-0013:
  no flock) around `supersede`/`transitionDecision`/`updateEntry`/`setProvenanceStatus`;
  session-aware holder file; dead-pid/10s staleness (mtime fallback, confirm-before-break,
  **owner-token-checked release**); 5s bounded acquisition then fail-open; re-entrancy depth
  guard. `supersede()` now rejects an already-superseded target — concurrent supersedes can no
  longer fork a lineage.
- **DoD observed:** real cross-process race (3 children, time barrier, injectable pause between
  read and append): locked arm exactly 1 winner; must-fail arm ≥2 winners with the lock disabled.
  172/172 green, stable across repeats.
- **Review gate (first run):** verdict FIX-FIRST — the reviewer *demonstrated* a release-without-
  ownership bug (a >10s holder freed the waiter's fresh lock → overlapping writers) plus 4 more
  findings; all fixed pre-merge (owner token + regression test, EPERM=alive, a stale-test that can
  actually fail, `.lock` gitignored, CI timing). Record: brain `8ec78f0e201a`.
- Build-time open item carried: whether a future contradiction-aware `kb_add` (ADR-0037) joins the
  lock. Also noted: composite curator ops take the lock per-step, not per-composite (outside
  ADR-0040 scope).

### V2-3 — merge=union (ADR-0041) — ✅ DONE 2026-07-06 (`v2` PR #58)

- Shipped: `.gitattributes` → `.vfkb/entries.jsonl merge=union` + `test/merge-union.test.ts`
  (RFC-016's own reproduction, both arms: clean union with the attribute; the must-fail arm still
  conflicts without it, asserting a real `UU` on the brain file).
- **The load-bearing unknown, ANSWERED empirically** (throwaway probe repo, created+deleted;
  decision `6d328f607e82`): **GitHub's server-side PR merge does NOT honor `merge=union`** —
  CONFLICTING even with the attribute committed. **Workaround observed end-to-end:** a local
  `git merge <base>` on the PR branch auto-unions (no manual resolution) and pushing flips the PR
  to MERGEABLE. Disposition: accept the GitHub gap, keep the PR audit trail; conflicting brain PRs
  get the one-command local merge.
- **Review gate: MERGE** (reviewer verified the proof fails when the attribute is deleted, and
  that the probe record leads with the negative result). Follow-up noted: **`vfkb init` does not
  yet emit the attribute for consumer repos** — consumer brains keep the guaranteed-conflict shape;
  candidate small addition when consumer wiring is next touched.

### V2-4 — Schema honesty (ADR-0042) — ✅ DONE 2026-07-06 (`v2` PR #61)

- Shipped all three decided items: structural `why` additive to `foldWhy`; whole-envelope
  read-boundary validation (`src/validate.ts`, zod looseObject + per-field defaults; corrupt JSONL
  lines tolerated; no-usable-id records excluded and **visibly counted** in the map render — the
  "lean visible" call was made visible); structural `refs.contradicts` (CLI `--contradicts`, MCP
  param, ⚔-surfaced on read lines). Proof RED-first (7/9 failed pre-fix, reviewer reproduced);
  184/184 green.
- **Review gate: MERGE with tracked conditions** (gotcha `ffd04537d350`): (1) **declare
  `zod ^4.0` before any npm publish** — v4-only API, currently transitive via the MCP SDK whose
  range permits v3; deferred offline (lock refresh needs VPN). (2) Read-boundary defaults persist
  into stored values on the next edit of a legacy/foreign entry (documented, deliberate);
  (3) unknown entry types coerce to `fact` — revisit before any v3 types; (4) ADR-0043's future
  index benchmark must baseline against post-0042 code (zod adds ~2x to the linear scan —
  measured, sub-ms at real scale); (5) CLAUDE.md's "engine is stdlib" line is stale.

### V2-5 — Rebuildable index (ADR-0043) — GATED, not in the build order until triggered

- Shape ratified (incremental append-offset parsing, not content-hash staleness); **do not build**
  until the ADR's trigger fires. When it does, insert it into this order by re-ratifying this doc.

### V2-6 — Storage seam (ADR-0044) — ✅ DONE 2026-07-06 (`v2` PR #64)

- Shipped: `src/backend.ts` — the `StorageBackend` interface (records / spine / meta / session
  records / `withExclusive` / location) + the one JSONL implementation; `storage.ts` became
  backend-agnostic policy; sessions and the ADR-0040 exclusive section ride the seam;
  `setStorageBackend` is the opt-in door. Git-layer consumers stay file-based by design.
- **DoD observed:** the full pre-existing suite passed **unchanged** (zero test edits, reviewer
  verified) — 189/189 with the new seam-proof tests (an injected in-memory backend receives
  engine traffic incl. its own `withExclusive`; the seam can fail if bypassed).
- **Review gate: MERGE**, findings folded in. Known seam hole documented: `counters.ts`
  (.signals telemetry) stays direct-fs until a second backend first needs it.

---

## ⚑ State of the fork (2026-07-06): all non-gated initiatives DONE

V2-1..V2-4 and V2-6 are built, review-gated, and merged into `v2`; V2-5 stays gated on its
trigger. **Per the exit criterion below, the next decision is the ADR-0036 ship decision —
an operator call, not an autonomous one:** merge `v2`→`main` as one reviewed merge, or promote
`v2` to be the new `main`.

**Targeted L4 regression: ALL GREEN (2026-07-06, claude harness, brain fact `a53ca3a1e945`).**
Image `vfkb-l4-claude:v2` built from `v2` (fresh in-container install resolved zod 4.4.3 —
the dependency worry passes live). Dockerized, N=3 each, `--no-record` (`:dev` records stay
pinned to v1): `stale-supersession` / `knowledge-delivery` / `capture-recall` /
`continuity-resume` / `mcp-pull` — **5/5 DEMONSTRATED, 3/3 trials each**. Host, from the v2
worktree: `decision-capture` **3/3 vs 0/3**, `session-end-handoff` **3/3 vs 0/3**,
`session-backbone` **3× 11/11** (now at the ADR-0022 bar on claude). The changed surfaces —
supersession+lock, capture, session continuity, Stop, SessionEnd — all hold.

**Remaining before ship** (deliberately not covered by the targeted pass): the **pi harness
arm** (needs `DEEPSEEK_TOKEN`; pi-extension touches the refactored SessionState/storage), the
other ~28 purpose scenarios (full honest re-pin), a live-bundle smoke of the v2 auto-layer,
the zod declaration (gotcha `ffd04537d350`, needs VPN), the `vfkb init` union attribute for
consumers, and a `$VFKB_BUNDLE_DIR` rebuild from v2 at ship time.

**Pre-ship update (2026-07-07): checklist closed out except two items.** The operator chose
the ship shape — **merge `v2`→`main`** (not promote) — and the list above resolved:
`main`→`v2` sync landed (PR #79, bringing the ADR-0045 plugin migration + `defaultProject()`;
the two src conflicts hand-resolved as unions, and `.vfkb/entries.jsonl` auto-unioned — V2-3
observed working in anger); live-bundle smoke **GATE PASS** (consumer-onboarding gate, bundles
built from the ship-candidate tree, both arms); `vfkb init` now emits the ADR-0041 union
attribute (PR #80, RED-first); `zod ^4.4.3` declared as a direct dependency (PR #81, lockfile
refreshed on VPN); and the **pi harness arm ALL GREEN** — image `vfkb-l4-pi:v2` built from the
ship candidate, 5/5 scenarios DEMONSTRATED 3/3 each, every contrast arm failing as designed
(brain fact `5e572a49acaf`) — both harnesses now hold on v2. `v2` suite: **199/199**.
GitHub's server-side union gap bit twice during this pass and the ADR-0041 local-merge
workaround cleared it both times. Filed en route: #82 (`wiring-smoke.mjs` is stale
post-plugin-migration). **Still open before the ship PR:** the full ~28-scenario re-pin
(operator to schedule or explicitly waive) and the ship-time `$VFKB_BUNDLE_DIR` bundle
rebuild + plugin re-vendor (ADR-0045 dev-loop).

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

- **Review gate (added 2026-07-06, operator-requested):** after every major implementation and
  **before its merge into `v2`**, launch an independent review agent via the `/v2-review`
  project command (`.claude/commands/v2-review.md`) — adversarial, fresh-eyes, checking ADR
  conformance, that the proof can fail (ADR-0029), repo protocols, and correctness. Blocking
  findings are fixed before merge; the outcome is recorded in the brain and noted in the PR.
  An initiative is not DONE until its gate has run.
- **Status flips:** when an initiative's PR merges into `v2` with its DoD observed, flip its row to
  DONE in the same working session (docs PR to `main` → routine sync to `v2`) and record the
  completion in the brain.
- **Deviations:** any order/scope change or blocker → update this doc + a brain `decision` entry;
  standard-setting changes also get an ADR (supersede/amend, never edit a decided body — ADR-0001).
- **Exit criterion:** all non-gated initiatives DONE → the v2 ship decision (merge `v2`→`main` as
  one reviewed merge, or promote `v2` to be the new `main`) per ADR-0036 — deliberately not chosen
  yet.
