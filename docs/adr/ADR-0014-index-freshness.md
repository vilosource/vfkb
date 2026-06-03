# ADR-0014: Index freshness = content-derived token + explicit rebuild, never mtime; regen is a guaranteed side-effect of every write

- **Status:** Accepted
- **Date:** 2026-06-03
- **Deciders:** operator (delegated "find the best solution") + Claude

## Context

mykb keyed index staleness on file **mtime**; IMPL-PLAN L8 records that **git ops
rewrite mtimes** (clone, checkout, pull, worktree) → mtime is an unreliable
freshness signal, a rebuild-reliability risk. vtfkb's brain is git-committed and
multi-harness: an in-memory index (ADR-0013) in one long-lived process (Pi
extension or MCP server) can be invalidated underneath it by a `git pull`, by
another harness's writer, or by the CLI. mykb L11 adds the invariant: **index regen
must be a guaranteed side-effect of any brain-mutating write**, never an optional
follow-up (mykb once left the manifest unregenerated → empty Tier-1).

ADR-0013 makes one thing cheap that mykb could not: the in-memory index rebuilds
from JSONL in well under the latency budget — so **erring toward rebuild costs
almost nothing**.

## Decision

Index freshness is **content-derived + explicit**, never mtime:

1. **Self-writes regen synchronously.** The engine is the sole writer (D4a); every
   entry-mutating write updates the in-memory index **and** the freshness token in
   the same operation — index/manifest regen is a **guaranteed side-effect**, never
   deferred (mykb L11).
2. **External changes detected by a content-derived token, not mtime.** The engine
   maintains a small `index-meta` (`{content_hash, entry_count, last_write}`) where
   `content_hash` is computed over entry **identity + content/`updated`** fields
   (never filesystem mtime). Readers compare the token cheaply before serving; on
   mismatch they rebuild from JSONL before answering. If `index-meta` is absent or
   inconsistent (e.g. after a `git pull` that changed JSONL but not the sidecar), a
   quick recompute over JSONL detects the drift → rebuild. (Exact digest scheme is a
   Phase-1 impl detail; the load-bearing rule is *content-derived, not mtime*.)
3. **Explicit rebuild is always available** (`rebuild`) as the deterministic escape
   hatch and the CI/test entry point.
4. **Conservative / rebuild-on-doubt.** Because the in-memory index is cheap to
   rebuild (ADR-0013), the reader rebuilds whenever freshness is uncertain rather
   than risk serving a stale index.

## Consequences

- **+** Survives git operations that rewrite mtimes (the documented L8 failure).
- **+** Index/manifest can never silently lag a write (L11 invariant enforced via
  the sole-writer side-effect).
- **+** Cheap rebuild (ADR-0013) makes the conservative policy affordable —
  correctness over micro-optimization.
- **−** A small `content_hash` must be computed on writes and compared on reads
  (bounded, cheap for a small brain).
- **−** A pathological "external write every read" pattern would rebuild each read;
  acceptable at per-project scale and detectable if it ever matters.

## Alternatives Considered

- **mtime-based staleness (mykb's approach).** Rejected: git ops rewrite mtimes →
  unreliable; the documented L8 debt.
- **Rebuild on every read unconditionally.** Rejected: needless work when nothing
  changed; the content-token comparison is far cheaper than a full rebuild and gives
  the same correctness.
- **Trust a monotonic write-counter alone (no content hash).** Rejected: a counter
  in a sidecar misses out-of-band JSONL changes (git pull, manual edit, another
  process) that don't bump the counter; a content-derived hash catches them.
