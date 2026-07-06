# RFC-018: A rebuildable index — the read path stops re-scanning the whole log

- **Status:** **Accepted → [ADR-0043](../adr/ADR-0043-rebuildable-index-shape.md)** (2026-07-06;
  shape ratified, **build gated** — trigger settled in the ADR)
- **Date:** 2026-07-05 (evidence-gated 2026-07-05 after independent review — see below)
- **Deciders:** operator + Claude
- **Relates:** [ADR-0014](../adr/ADR-0014-index-freshness.md) (index freshness —
  content-hash trigger, not mtime, which this reuses), [RFC-019](RFC-019-storage-backend-abstraction.md)
  (storage backend abstraction — shares this seam), `docs/V2-VISION.md` §3.3

## Context

`readAll()` re-parses the entire `entries.jsonl` file, from scratch, on every single call
(verified this session — no in-process cache). This is *why* cross-session visibility is
already correct today (every call sees a fresh, current state, no stale cache) — but it's
also why the read path doesn't scale indefinitely.

**Evidence check, added after independent review:** this repo's own brain is **114
entries** today. No observed slowness, no benchmark showing real pain, no known consumer
even at 1,000 entries. Judged honestly against this repo's own evidence-gated-builds rule
(the same one RFC-003's embedding reranker is held to), this RFC's *build* is the weakest-
evidenced item in the v2 batch — RFC-014/015 "add more read traffic" is true but marginal
(a handful of extra lookups per turn, not a scaling driver on its own). This RFC now
**ratifies the shape, gates the build** on the same terms as RFC-003: don't build until a
real consumer hits observed slowness, or explicitly asks for it.

## Decision

Keep `entries.jsonl` as the single git-friendly, committed, append-only source of truth —
no change to ADR-0019. **Ratify the shape now:** a real rebuildable index, same philosophy
as today's `index-meta.json` cache (gitignored, derived, rebuilt from the log) but backed
by an actual queryable structure rather than a bare array re-parsed from the raw file on
every call. **Gate the build:** don't implement until a real consumer hits observed
slowness, or an explicit request — matching RFC-003's own gate.

**A real design tension, surfaced by independent review, to resolve before the build
starts (not before ratifying the shape):** the original draft proposed reusing
ADR-0014's content-hash staleness check to trigger index rebuilds. But `contentHash()` is
computed from `materialize()`'s output (`id@updated` pairs) — i.e. deciding whether the
index is stale still requires the full parse the index exists to avoid. Naively reusing
it verbatim would mean every read pays the full linear cost anyway, just to check
freshness. The more promising direction, not yet designed in detail: **incremental,
append-offset-based parsing** — since `entries.jsonl` is append-only, track the last
byte offset read, and on the next call parse only the bytes appended since then, folding
new records into an already-materialized in-memory structure instead of re-parsing from
byte zero. This sidesteps the content-hash tension entirely (no "is it stale" check needed
— just "is there anything past my last offset") and is the leading candidate mechanism,
though still an implementation detail to nail down at build time, not locked here.

## Alternatives Considered

- **A SQLite/FTS mirror** — mykb's own carried-forward lesson (`docs/DESIGN.md`'s "CARRY"
  list: "JSONL = source of truth + disposable SQLite/FTS5 mirror"). Not rejected — a
  candidate *implementation*, deliberately left open rather than locked into this RFC's
  text, since [ADR-0013](../adr/ADR-0013-no-hard-native-dep.md) (no hard native dep)
  constrains which SQLite binding, if any, is viable without reintroducing the deployment
  pain that ADR already avoided once. Weighed against the incremental-parsing direction
  above, a mirror is heavier machinery for a problem that a simpler offset-tracking scheme
  may fully solve — worth comparing concretely at build time, not pre-deciding now.
- **A full external search service** — rejected: same hosted-brain tradeoffs as the
  earlier hosted-vs-git discussion (single point of failure, real auth needed); out of
  scope for a local-file-first v2 (see RFC-019).
- **Reuse ADR-0014's content-hash check as-is for index staleness** — reconsidered per
  the tension above: it doesn't avoid the cost the index exists to eliminate. Superseded
  by the incremental-parsing direction in the Decision.
- **Do nothing until it's actually slow in practice** — **no longer rejected.** The
  original draft rejected this; independent review correctly called that out as the
  weakest-evidenced call in the batch (114 entries, no observed pain). This RFC now
  *adopts* this as the build gate, while still ratifying the shape now so the design
  exists when the evidence arrives.

## Definition of Done

Applies once the build is actually triggered (see gating above) — not a gate on accepting
this RFC's shape:

- A performance benchmark at a realistic scale (10,000+ entries) showing materially
  faster lookups than today's linear scan — sub-linear where the index structure allows it.
- Correctness parity: every existing read-path unit test passes unchanged against the new
  index (a refactor-safety contract, not a behavior change).

## Open items

- The concrete index data structure/backing store is an implementation decision for the
  build, not locked here — this RFC commits to "not a linear re-parse per call" and to an
  incremental, append-offset-based invalidation model instead of ADR-0014's content-hash
  check, nothing more specific.
- Whether the index needs to be aware of RFC-014's per-session attribution (e.g. "which
  entries did session X write") as a first-class query, or whether that's answerable by a
  simple filter over the existing structure — worth settling during the build once
  RFC-014 has landed and its actual query patterns are visible.
- **What counts as the triggering evidence** (a specific entry-count threshold? a reported
  latency complaint? a specific consumer's ask?) isn't defined here — should be settled
  before this RFC is accepted, the same way RFC-003's gate names concrete trigger
  conditions rather than leaving "slow in practice" undefined.
