# RFC-015: A vfkb-native concurrency lock

- **Status:** **Accepted → [ADR-0040](../adr/ADR-0040-native-concurrency-lock.md)** (2026-07-06)
- **Date:** 2026-07-05 (DoD corrected 2026-07-05 after independent review — see below)
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
advisory lock scoped to one `VFKB_DATA_DIR`. **Mechanism constraint:** a real OS `flock`
would need a native binding, which [ADR-0013](../adr/ADR-0013-no-hard-native-dep.md) (no
hard native dep) forbids — so the realistic shape is a plain lockfile scheme (e.g.
exclusive-create via `O_EXCL`, with staleness detection for a crashed holder), not `flock`
itself. The exact retry/staleness policy is still an implementation choice, not locked by
this RFC, but the native-dep constraint is not optional and should shape it from the start.
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
`docs/V2-VISION.md` §3.5). **Correction from the original draft:** the storage layer is
entirely synchronous (`appendFileSync`/`readFileSync`), so N *in-process* writers on one
Node event loop cannot actually interleave their read-decide-append sequences — a test
built that way would pass whether or not the lock exists, which fails this repo's own
ADR-0029 rule ("a proof that can't fail proves nothing"). The TOCTOU gap only exists
*across processes*, so the test must force a real cross-process race:

- Spawn N real **child processes** (not in-process callbacks) against one temp brain dir,
  each performing a read-decide-append operation, orchestrated with a barrier/signal so
  their critical sections are forced to overlap in time rather than hoping OS scheduling
  happens to interleave them; **or**
- Add a test-only injectable pause inside the critical section (a hook the test can use to
  suspend execution between the read and the append) so a single test process can
  deterministically force two "logical" operations to interleave without needing real
  child processes.

Either way: assert no lost entries, no interleaved/corrupted lines, and no two operations
both acting on the same stale pre-write snapshot. **Must-fail arm:** the same test with the
lock disabled must actually fail (proves the test exercises the real race, not a
no-op).

## Open items

- Exact lock mechanism (flock vs. a lockfile-with-retry vs. something else) is an
  implementation detail to settle during the build, not this RFC.
- Whether `kb_add` itself (today a pure append, no read-decide step) needs to participate in
  the lock at all, or only the operations that already read before writing — current
  reasoning says no (an append needs no coordination), but this should be re-confirmed once
  RFC-017's contradiction-detection fields exist, since a future contradiction-aware
  `kb_add` *would* read before appending.
