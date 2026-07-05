# RFC-018: A rebuildable index — the read path stops re-scanning the whole log

- **Status:** Proposed
- **Date:** 2026-07-05
- **Deciders:** operator + Claude
- **Relates:** [ADR-0014](../adr/ADR-0014-index-freshness.md) (index freshness —
  content-hash trigger, not mtime, which this reuses), [RFC-019](RFC-019-storage-backend-abstraction.md)
  (storage backend abstraction — shares this seam), `docs/V2-VISION.md` §3.3

## Context

`readAll()` re-parses the entire `entries.jsonl` file, from scratch, on every single call
(verified this session — no in-process cache). This is *why* cross-session visibility is
already correct today (every call sees a fresh, current state, no stale cache) — but it's
also why the read path doesn't scale. Fine at hundreds of entries; a real cost at tens of
thousands, and v2 itself adds more read traffic on top: RFC-014's session registry lookups
and RFC-015's lock-holder logging both mean more calls into the engine, not fewer.

## Decision

Keep `entries.jsonl` as the single git-friendly, committed, append-only source of truth —
no change to ADR-0019. Add a real rebuildable index: same philosophy as today's
`index-meta.json` cache (gitignored, derived, rebuilt from the log) but backed by an
actual queryable structure, incrementally updated on append, rather than a bare array
re-parsed from the raw file on every call. Rebuild/invalidation triggers reuse ADR-0014's
existing content-hash-based staleness detection (already chosen specifically because git
operations rewrite mtimes, making mtime-based staleness unreliable) — extended to cover
the new index, not just the manifest step it protects today.

## Alternatives Considered

- **A SQLite/FTS mirror** — mykb's own carried-forward lesson (`docs/DESIGN.md`'s "CARRY"
  list: "JSONL = source of truth + disposable SQLite/FTS5 mirror"). Not rejected — a
  strong candidate *implementation*, deliberately left open rather than locked into this
  RFC's text, since [ADR-0013](../adr/ADR-0013-no-hard-native-dep.md) (no hard native dep)
  constrains which SQLite binding, if any, is viable without reintroducing the deployment
  pain that ADR already avoided once.
- **A full external search service** — rejected: same hosted-brain tradeoffs as the
  earlier hosted-vs-git discussion (single point of failure, real auth needed); out of
  scope for a local-file-first v2 (see RFC-019).
- **Do nothing until it's actually slow in practice** — rejected: this is foundational to
  the *other* v2 initiatives' read traffic (RFC-014/015), better fixed before their
  overhead compounds on top of an already-linear read path, not after.

## Definition of Done

- A performance benchmark at a realistic scale (10,000+ entries) showing materially
  faster lookups than today's linear scan — sub-linear where the index structure allows it.
- Correctness parity: every existing read-path unit test passes unchanged against the new
  index (a refactor-safety contract, not a behavior change).

## Open items

- The concrete index data structure/backing store is an implementation decision for the
  build, not locked here — this RFC commits to "not a linear re-parse per call" and to
  reusing ADR-0014's staleness model, nothing more specific.
- Whether the index needs to be aware of RFC-014's per-session attribution (e.g. "which
  entries did session X write") as a first-class query, or whether that's answerable by a
  simple filter over the existing structure — worth settling during the build once
  RFC-014 has landed and its actual query patterns are visible.
