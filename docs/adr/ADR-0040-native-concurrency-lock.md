---
type: Decision
title: "ADR-0040: A vfkb-native concurrency lock for read-decide-append (accepts RFC-015)"
description: "A vfkb-native advisory lock scoped to the read-decide-append critical section (accepts RFC-015)"
status: "Accepted"
timestamp: 2026-07-06
---

# ADR-0040: A vfkb-native concurrency lock for read-decide-append (accepts RFC-015)

- **Status:** Accepted
- **Date:** 2026-07-06
- **Deciders:** operator + Claude
- **Accepts:** [RFC-015](../rfc/RFC-015-native-concurrency-lock.md) (full analysis lives there).
- **Relates:** [ADR-0039](ADR-0039-session-backbone.md) (session identity the lock logs against —
  build after it), [ADR-0013](ADR-0013-no-hard-native-dep.md) (no native dep — rules out real
  `flock`), [ADR-0036](ADR-0036-v2-two-branch-strategy.md) (**builds on the `v2` branch**),
  NOTES corner case #7 (the TOCTOU gap).

## Context

Two processes each doing read-decide-append against `entries.jsonl` (concurrent `kb_supersede`,
`kb_transition`, a future contradiction-aware add) can act on stale snapshots — TOCTOU.
`appendFileSync` is byte-safe (verified), but nothing coordinates read-then-decide across
processes. Not hypothetical: vilonotes' kagent pod **hand-rolled a whole-turn `asyncio.Lock()`**
(LLM inference time included) purely to protect the filesystem, because vfkb offers nothing
finer-grained.

## Decision

vfkb owns an advisory lock scoped to the **read-decide-append critical section** of engine
operations that read state before writing — held **internally by the engine**, never something
callers must remember to acquire. Scoped to one `VFKB_DATA_DIR`. **Mechanism constraint:**
ADR-0013 forbids the native binding a real `flock` needs, so the realistic shape is a lockfile
scheme (exclusive-create via `O_EXCL` + staleness detection for a crashed holder); exact
retry/staleness policy is a build-time choice. Session-aware once ADR-0039 lands: log which
`session_id` holds/held the lock so contention is observable.

## Definition of Done

A concurrent-writer test that **can actually fail** (per ADR-0029): the storage layer is fully
synchronous, so in-process callbacks cannot race — the test must force a real cross-process
overlap (N child processes with a barrier) **or** use a test-only injectable pause inside the
critical section. Assert no lost entries, no corrupted lines, no two operations acting on the same
stale snapshot. **Must-fail arm:** the same test with the lock disabled must fail.

## Consequences

- Any harness author (kagent runtime, CI job, agent fleet) gets the protection vilonotes had to
  invent, for free, scoped far tighter than a whole-turn mutex.
- Pure appends (`kb_add` today) stay uncoordinated (no read-decide step) — to re-confirm once
  ADR-0037's contradiction check makes adds read-before-append.
- **Builds on `v2`, after ADR-0039** (the session backbone it logs against).
