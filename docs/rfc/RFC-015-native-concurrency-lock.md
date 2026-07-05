# RFC-015: A vfkb-native concurrency lock

- **Status:** Proposed
- **Date:** 2026-07-05
- **Deciders:** operator + Claude
- **Relates:** [RFC-014](RFC-014-session-backbone.md) (session identity this lock logs
  against), `docs/NOTES-multi-agent-concurrency-corner-cases.md` (corner case #7, the TOCTOU
  gap), `docs/V2-VISION.md` §2.3/§3.1

## Context

Two independent processes each doing read-decide-append against `entries.jsonl` (e.g. two
concurrent `kb_supersede` calls, or a future contradiction check that reads the current
state before deciding whether to flag a conflict) can each act on a stale snapshot — the
classic TOCTOU gap. `appendFileSync` is safe at the byte level (verified this session — a
single write() call per line, no corruption), but nothing coordinates the *read-then-decide*
part across processes.

This isn't hypothetical: while stress-testing `docs/V2-VISION.md` against vilonotes'
real kagent-hosted researcher, we found it had **already hand-rolled a workaround** —
`_turn_lock = asyncio.Lock()` in `researcher/run.py`, serializing *entire user-facing turns*
(LLM inference time included) purely to protect the filesystem, because vfkb itself offers
no finer-grained protection. That's a real cost: every session sharing that pod queues
behind full turn latency, not just the moment vfkb's brain is actually touched.

## Decision

vfkb owns a lock primitive scoped to the actual read-decide-append critical section of any
engine operation that reads state before writing (`kb_supersede`, `kb_transition`, and any
future contradiction check) — **not** exposed as something callers must remember to acquire,
but held internally by the engine around just that critical section. Implemented as a local
advisory lock scoped to one `VFKB_DATA_DIR` (mechanism — e.g. an OS-level `flock` on a
lockfile under the brain dir — is an implementation choice, not locked by this RFC).
Session-aware once RFC-014 lands: log which `session_id` holds/held the lock, so contention
is observable rather than silent.

This gives any harness author (a kagent runtime, a CI job, a future multi-agent fleet) the
same protection vilonotes had to discover and hand-roll itself — for free, and scoped far
tighter than a whole-turn mutex.

## Alternatives Considered

- **Leave locking to each harness author** — rejected; evidenced by vilonotes independently
  reinventing a *coarser* version of exactly this (a whole-turn lock instead of a
  filesystem-critical-section lock).
- **A distributed lock service** — rejected: reintroduces the hosted-brain tradeoffs (single
  point of failure, needs real auth) the earlier hosted-vs-git discussion explicitly avoided;
  out of scope for a local-file-first v2 (see RFC-019).
- **Advisory lock is optional / opt-in per caller** — rejected: an optional safety mechanism
  is exactly the kind of thing that gets skipped under time pressure (the same "prose rule
  with no Brake gets ignored" lesson ADR-0021 already learned about this codebase). The
  engine should hold it internally, not ask callers to remember.

## Definition of Done

A first-class concurrent-writer test in the unit/L4 pyramid (flagged as missing in
`docs/V2-VISION.md` §3.5): spawn N in-process writers against one temp brain dir performing
overlapping read-decide-append operations, assert no lost entries, no interleaved/corrupted
lines, and no two writers both acting on the same stale pre-write snapshot. Deterministic,
not timing-dependent (structure the test to force the race, not hope for it).

## Open items

- Exact lock mechanism (flock vs. a lockfile-with-retry vs. something else) is an
  implementation detail to settle during the build, not this RFC.
- Whether `kb_add` itself (today a pure append, no read-decide step) needs to participate in
  the lock at all, or only the operations that already read before writing — current
  reasoning says no (an append needs no coordination), but this should be re-confirmed once
  RFC-017's contradiction-detection fields exist, since a future contradiction-aware
  `kb_add` *would* read before appending.
