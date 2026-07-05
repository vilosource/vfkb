# RFC-017: Schema honesty — a real `why` field, full envelope validation, structural contradiction/supersede fields

- **Status:** Proposed
- **Date:** 2026-07-05
- **Deciders:** operator + Claude
- **Relates:** [ADR-0011](../adr/ADR-0011-envelope-richness.md) (envelope richness this
  extends), [RFC-012](RFC-012-contradiction-surfacing-at-write.md) (contradiction
  surfacing — this RFC gives it a structural hook instead of text-sniffing),
  `docs/V2-VISION.md` §3.2

## Context

Three separate, independently verified, silent gaps in the current envelope:

1. **`--why` is a documented no-op.** `cli.ts`'s `cleanText()` strips `--flag value` pairs
   (including `--why`) before `addEntry` ever sees them; `AddOpts` has no `why` field;
   `KnowledgeEntry` has no `why` field; `mcp-server.ts`'s `kb_add` has no `why` param
   either. Rationale only survives today if the caller folds it into `text` by hand.
   CLAUDE.md and the ADR/RFC docs show `--why`/`why=` as if it persists — it doesn't.
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

1. **Add a real `why?: string` field** to the decision-family envelope. Thread it through
   `AddOpts`, the CLI (`--why`), and the MCP tool (`why` param per its existing schema
   description — the tool description already promises `why` is "rationale; folded into
   the text as a 'Why: ...' line," which this RFC makes literally true instead of
   accidentally true only when a caller manually duplicates it).
2. **Validate the whole envelope at the read boundary**, not just `tags` — a schema parse
   (zod, already a dependency) on load, covering every optional field. Malformed/missing
   fields get safe, documented defaults; entries that fail validation entirely are
   surfaced as a distinct, clearly-tagged state rather than crashing the caller.
3. **Add a structural `contradicts?: string[]` field**, alongside the existing
   `supersedes`, so a future contradiction detector (RFC-012) reads/writes real references
   instead of parsing prose for them.

## Alternatives Considered

- **Keep folding `why` into `text` by convention** (status quo) — rejected: it's exactly
  the silent gap being fixed, and the MCP tool's own schema description already claims
  behavior that doesn't exist.
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

- A `why` value survives CLI → MCP → storage → read intact.
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
