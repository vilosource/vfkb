---
type: RFC
title: "RFC-017: Schema honesty — a structural `why` field, full envelope validation, structural contradiction/supersede fields"
description: "v2 — Schema honesty: a structural `why` field, full envelope validation, structural contradiction/supersede fields"
status: "**Accepted → ADR-0042** (2026-07-06)"
timestamp: 2026-07-05
---

# RFC-017: Schema honesty — a structural `why` field, full envelope validation, structural contradiction/supersede fields

- **Status:** **Accepted → [ADR-0042](../adr/ADR-0042-schema-honesty.md)** (2026-07-06)
- **Date:** 2026-07-05 (context corrected 2026-07-05 after independent review — see note below)
- **Deciders:** operator + Claude
- **Relates:** [ADR-0011](../adr/ADR-0011-envelope-richness.md) (envelope richness this
  extends), [RFC-012](RFC-012-contradiction-surfacing-at-write.md) (contradiction
  surfacing — this RFC gives it a structural hook instead of text-sniffing),
  `docs/V2-VISION.md` §3.2

> **Correction:** the first draft of this RFC claimed `--why` was a live, silent no-op.
> An independent review caught that this was already fixed on 2026-06-30 (commit
> `5ff56fc`, gotcha `91338268`) — five days before this RFC's original draft — and the
> claim was written from a stale memory without re-checking current code. Acknowledged
> directly rather than defended; the section below reflects verified current behavior.
> The underlying decision (item 1) still stands, just reframed: it was never "fix a
> no-op," it's "promote an already-working convention to a structural field."

## Context

Two separate, independently verified, silent gaps remain in the current envelope (a
third, originally claimed here, turned out to already be fixed — see the correction
above and item 1 below):

1. **`why` persists today, but only as folded prose, not as a structural field.**
   `AddOpts.why`, `foldWhy()` (`src/engine.ts`), the CLI's `--why` flag, and the MCP
   tool's `why` param all exist and work correctly today — rationale genuinely survives
   CLI → MCP → storage as a `"Why: …"` line appended to `text`. What's still missing:
   `KnowledgeEntry` itself has **no structural `why` field** — the rationale is only
   recoverable by pattern-matching a `"Why:"` line out of prose, not as its own
   queryable/renderable value. That's a real, narrower gap than the original draft
   claimed, but a real one: anything that wants to *display* rationale separately from
   the entry body, or search on it specifically, can't today.
2. **Only `tags` got a defensive read-boundary default**, after a tagless entry crashed
   `index-store.ts` (`entry.tags.join(' ')` assuming presence). Other optional fields
   (e.g. `validity.valid_until`) are still unguarded — any externally-projected entry
   (e.g. vfwb's lossy projection into a consumer's `.vfkb`, which bypasses vfkb's own
   write path) missing a different field can crash a different read path the same way.
3. **Contradiction/supersede relationships are inferred from prose.** `supersedes` exists
   structurally (ADR-0004), but nothing marks "this entry contradicts that one" as
   anything other than words in `text` — RFC-012's contradiction surfacing has no
   structural field to write to or read from.

## Decision

1. **Add a real `why?: string` field** to the decision-family envelope itself, alongside
   the existing folded-text convention (`foldWhy` keeps working for anything reading
   `text` directly — this is additive, not a replacement). `AddOpts.why`, the CLI's
   `--why`, and the MCP tool's `why` param already thread a value in today; this RFC adds
   the one missing piece — a structural home for that value so it's independently
   queryable/renderable, not just recoverable by pattern-matching `text`.
2. **Validate the whole envelope at the read boundary**, not just `tags` — a schema parse
   (zod, already a dependency) on load, covering every optional field. Malformed/missing
   fields get safe, documented defaults; entries that fail validation entirely are
   surfaced as a distinct, clearly-tagged state rather than crashing the caller.
3. **Add a structural `contradicts?: string[]` field**, alongside the existing
   `supersedes`, so a future contradiction detector (RFC-012) reads/writes real references
   instead of parsing prose for them.

## Alternatives Considered

- **Keep folding `why` into `text` by convention only, add no structural field** (status
  quo) — rejected, but on narrower grounds than the original draft claimed: the
  convention already works correctly, this isn't fixing broken behavior. Rejected because
  a text-only convention can't be rendered/searched/validated independently of the entry
  body, which matters more once RFC-018's index and RFC-012's contradiction surfacing
  both want to reason about rationale as its own value.
- **Validate only at write time, not read time** — rejected: doesn't protect against
  entries that entered `.vfkb` outside vfkb's own write path (external projections,
  hand-edited legacy entries, a future storage backend per RFC-019 with different
  guarantees) — the read boundary is the one place that sees every entry regardless of
  origin.
- **A full schema-migration/versioning system** — out of scope here; bigger than the
  immediate gap. Worth its own future RFC if/when schema changes become frequent enough
  to need it; v1's history (envelope richness landed once, ADR-0011) doesn't show that
  pressure yet.

## Definition of Done

Unit tests (structural invariant, not agent-observable behavior — no L4 scenario needed):

- A `why` value lands in the new structural field (not just folded into `text`) and
  survives CLI → MCP → storage → read intact; the existing `foldWhy` text-convention path
  keeps passing unchanged (no regression to today's working behavior).
- A deliberately malformed entry (missing `tags`, missing `validity` fields, or other
  gaps) no longer crashes any read path — assert a safe default or a clearly-tagged
  malformed state instead.
- A decision entry can carry a `contradicts` reference, and `kb_get`/`kb_search` surface
  it in their output.

## Open items

- Exact shape of the "malformed entry" surfaced state (silently defaulted vs. a visible
  marker in search results) is a build-time call, not locked here — should lean toward
  visible, per this repo's own verification-first instincts, but needs a concrete design
  during implementation.
