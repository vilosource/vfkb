---
type: RFC
title: "RFC-022: Brain export projections — one deterministic engine, two render targets (AGENTS.md + OKF bundle)"
description: "Track 9 Q3 — `vfkb export agents-md` + `vfkb export okf` as deterministic, generated-marked, never-auto-committed projections of the brain, sharing one engine; the OKF target enforces the ADR-0046 trust ratchet"
status: "Accepted → ADR-0047 (ratified 2026-07-08)"
timestamp: 2026-07-08
---

# RFC-022: Brain export projections — one deterministic engine, two render targets (AGENTS.md + OKF bundle)

- **Status:** Accepted → [ADR-0047](../adr/ADR-0047-brain-export-projections.md) (ratified 2026-07-08, after two adversarial review rounds)
- **Date:** 2026-07-08
- **Deciders:** operator + Claude
- **Relates:** [ADR-0046](../adr/ADR-0046-layered-knowledge-capture-understand-publish.md) (the
  layering decision whose Phase 1 this RFC drafts — it pre-decided "two render targets, one
  deterministic-projection engine" and the trust ratchet this RFC operationalizes),
  [RFC-020](RFC-020-layered-knowledge-capture-understand-publish.md) (whose two open items —
  fold-or-split, and the `vfkb:okf` skill question — this RFC settles),
  `docs/H4-DEVELOPMENT-ROADMAP.md` Track 9 Q3 (the queued slot this RFC fills; Q3's scope was
  widened by ADR-0046), [ADR-0008](../adr/ADR-0008-constitution-tier.md) /
  [ADR-0006](../adr/ADR-0006-context-map.md) / [ADR-0025](../adr/ADR-0025-project-context-doc-and-kb-context.md)
  (the derived sections the AGENTS.md target reuses), [ADR-0022](../adr/ADR-0022-l4-evaluation-methodology.md) /
  [ADR-0023](../adr/ADR-0023-scenario-contract-first.md) / [ADR-0029](../adr/ADR-0029-sandbox-proven-definition-of-done.md)
  (the proof methodology the DoD follows), [ADR-0013](../adr/ADR-0013-no-hard-native-dep.md)
  (no-native-dep rule that shapes the conformance-checker decision),
  [vilosource/okf-skill](https://github.com/vilosource/okf-skill) (OKF v0.1 spec + `validate_okf.py`)

## Context

Track 9 Q3 has been queued since the 2026-07-06 reconciled ratification: emit a distilled,
deterministic projection of the brain as `AGENTS.md` — the LF-standard file read by every major
harness — so a **cold agent with no vfkb integration** still grounds on the project's knowledge.
ADR-0046 then widened the slot: the same projection work must also emit an **OKF v0.1 bundle**
(`.okf/`) — individually addressable, typed concept docs for a reader who wants *one* thing, not
the whole brain — gated by the one-way trust ratchet. ADR-0046's Phase 1 explicitly gates on
"Track 9 Q3 being drafted"; this RFC is that draft. It fills the Q3 slot with its number assigned
at draft time, per the roadmap's numbering rule.

The engine already owns every section both targets need — `deriveConstitution()` (ADR-0008),
`buildContextMap()`/`renderContextMap()` (ADR-0006), the context spine + `renderContext()`
(ADR-0025), `isInjectable()`/`rerank()`/`effectiveStatus()`/`supersededIds()` (all
`src/engine.ts`, verified on `main` @ `43b9444`). What is missing is a *file-emitting render
layer* over them, and a determinism contract strong enough to unit-test byte-for-byte.

## Decision

Build **`vfkb export <target> [--out <path>]`** — a CLI verb on the engine with two render
targets sharing one projection core. Generated-marked, regenerate-on-demand, **never
auto-committed** (committing the output is the consumer's deliberate act; for AGENTS.md that
commit is exactly how a cold agent later sees it).

### The shared projection core

- **Input:** the brain via `readAll()` + the existing derivation helpers; the ratchet filters
  (`provenance.status`, decision `effectiveStatus()`, `supersededIds()`) applied per target.
- **Determinism contract (the load-bearing engineering rule):** the output is a **pure function
  of the brain's content** — no wall clock, no environment, no randomness, **no dependence on
  previously emitted output** (the export rewrites its output tree every run; a fresh clone and
  a long-lived working copy emit byte-identical bundles from the same brain). **The sweep is
  scoped, not a blind `rm -rf`:** the export deletes only files carrying the generated marker
  (plus the reserved `index.md`/`log.md` it owns), and **refuses to run** into a non-empty
  `--out` directory containing no generated-marker files — `vfkb export okf --out docs` must
  hard-fail, not destroy hand-written content; this guard changes nothing about determinism,
  since foreign files were never part of the emitted tree's contract. Three further
  consequences:
  - The projection's "as-of" moment is **`max(entry.updated)` across the brain**, not `new
    Date()`. **This requires an acknowledged engine change, not just reuse:** the current
    renderers hardcode the wall clock (`renderContextBundle` computes `today = nowIso()`
    internally; `renderContext` calls `isInjectable` with the default date), so the build
    threads an optional `asOf` parameter through the render/filter path (`isInjectable`
    already accepts one; the renderers must pass it). Live-injection behavior is unchanged
    (default stays `nowIso()`); only the export supplies `asOf = max(updated)`.
  - Ordering is total and stable: sections in fixed order; entries within a section ordered by
    the export's own comparator — `heuristicCompare` (tier, then `updated` desc) **wrapped with
    an explicit `id`-ascending final tiebreak**, which `heuristicCompare` alone does not
    provide (same-millisecond writes exist; V8 sort stability is not a contract).
  - File naming is a pure function of the entry **id alone** (see Target 2) — never of entry
    text, which is editable (`updateEntry`) and would orphan previously emitted filenames.
- **Generated marker:** every emitted file carries a marker (`<!-- generated by vfkb export
  <target>; regenerate, do not hand-edit -->` in the markdown body — for OKF docs this comment
  MUST sit *after* the closing `---` of the frontmatter block, which the spec's validator
  requires at byte 0 of the file; the OKF frontmatter additionally carries `generated_by: vfkb
  export okf`, an extra field OKF consumers tolerate by spec).

### Target 1 — `vfkb export agents-md` (whole-brain digest for a cold agent)

One `AGENTS.md` file (default `--out AGENTS.md`, repo root): the Q3 contract — Constitution
(always leads, ADR-0008) + Context Map (ADR-0006) + established/`verified` knowledge + the
context spine (ADR-0025). **This is a new export renderer, not a reuse of `renderContextBundle`
or `renderContext` as-is** — neither existing renderer can produce it: `renderContextBundle`
filters by `isInjectable`, which *deliberately* includes unverified entries labeled (ADR-0005 —
correct for live injection, wrong for publishing), and `renderContext` renders only
decisions/links/map/constitution/spine with no fact/gotcha/pattern knowledge section at all.
The export renderer **shares the section derivations** (`deriveConstitution`, the
`buildContextMap` data, the spine read) and the `renderContextBundle` *budgeting shape* (an
export-sized budget; a cold-agent digest, not a dump), but applies the same **export predicate**
as the OKF target (the four-clause list in Target 2), checked by the same negative test. The
Context Map section is an **export variant** of the map render, not `renderContextMap`
verbatim: the live render emits `<vfkb-map>` session tags, a "pull more: search …" affordance a
no-vfkb cold agent cannot use, a malformed-records warning, and whole-brain counts/top-tags
computed over *everything* including unverified/proposed entries. The export variant strips the
live affordances and computes its counts/tags **over the published subset only** — otherwise
tag strings and counts of unpublished entries leak through the very filter the ratchet imposes.
ADR-0005's include-unverified-labeled rule is untouched for live injection; publishing is a
different trust boundary.

### Target 2 — `vfkb export okf` (addressable OKF v0.1 bundle)

Emits `.okf/` (default `--out .okf`):

- **Layout:** one top-level directory per exported `EntryType` (`facts/`, `gotchas/`,
  `patterns/`, `decisions/`); a root `index.md` and per-directory `index.md` listing each doc
  with its one-line description (OKF's progressive-disclosure contract); a root `log.md` (see
  below). The output tree is **emptied and rewritten every run** — no stale files from prior
  generations can linger, and no run reads what a previous run wrote.
- **`log.md` is a pure function of the brain, not of regeneration history — and its source is
  the RAW RECORD LOG, not the materialized view.** The materialized `readAll()` is LWW with
  tombstones: a `verified→stale` re-stamp shows only the final state, and a tombstoned entry
  vanishes entirely — the materialized view alone cannot prove an entry *was ever*
  publish-grade, which is the exact silent deletion `log.md` exists to prevent. So the
  departure set is defined over the append-only raw records (`readRecords()`-level history):
  **an entry departs iff some raw record of it satisfies the export predicate below while its
  current materialized state (or absence, for tombstones) does not.** `log.md` renders that set
  chronologically (by the `updated` of the record that ended eligibility), recomputed
  identically on every run from any clone. Entries that were never publish-grade never appear.
  This satisfies the ratchet's no-silent-deletion rule *without* diffing against previously
  emitted output, which would have made the bundle a function of local regeneration history and
  broken the determinism contract outright.
- **The export predicate (ADR-0046's ratchet, fully enumerated — this is the complete,
  implementer-binding clause list):** an entry exports iff
  (1) `provenance.status === 'verified'`;
  (2) for decision-family entries, `effectiveStatus === 'accepted'` — superseded and
  `deprecated` never export;
  (3) `zone !== 'archive'` — demotion removes an entry from the published view even though
  archiving does not touch its provenance field;
  (4) its validity window (when set) is open at `asOf` — the same expiry semantics
  `isInjectable` applies, evaluated at `asOf`, not the wall clock.
  (`stale`/`expired` provenance already fails clause 1.) The negative test seeds **every**
  clause, including an archived-but-still-`verified` entry (see DoD). Graphify output is not an
  input at all (Understand layer never feeds Publish mechanically).
- **`decisions/` exports ALL ratchet-eligible decision-family entries — no ADR-file exclusion.**
  The entry envelope carries no "has an ADR file" signal (`adr_no` is stamped on all live
  decisions by `stampOrdinals` regardless of whether a `docs/adr/` file exists), so any
  exclusion predicate would be improvised and non-deterministic across implementers. Instead:
  the generated bundle is **self-contained** (a consumer of `.okf/` alone needs no `docs/adr/`),
  and each decision doc's `# Citations` links to its ADR file when the brain records one (a
  `link` entry / ref) — duplication with the in-place bundle is accepted and documented, not
  avoided by a guess.
- **Per-concept doc:** filename **`<id>.md`** — a pure function of the immutable entry id, so
  text edits (`updateEntry` is LWW on fluid types) never orphan a previously emitted filename.
  The human-readable name lives in frontmatter, not the filename. Frontmatter: `type` ← vfkb
  `EntryType` (spec: producer-chosen), `title` ← first sentence (clamped), `description` ←
  first sentence, `tags` ← entry tags as a YAML list, `timestamp` ← the entry's own `updated`
  (a real recorded value — the spec's anti-fabrication rule), `resource` only when the entry is
  a `link` type with a URL (never fabricated). Body: the entry text verbatim (including the
  folded `Why:` line), with entry refs rendered under `# Citations` as bundle-root-relative
  links where the target is in-bundle, plain repo-relative paths otherwise.

### What this RFC settles from RFC-020's open items

- **Fold, not split:** both targets are this one RFC/build — one engine, one DoD pattern, as
  ADR-0046 anticipated.
- **No `vfkb:okf` skill:** hand-authoring/validation stays with the okf-skill plugin; the
  export is a CLI verb. No MCP `kb_export` tool either, for now — exporting is an
  operator/scripted act, not an in-session recall need; add one only on observed in-session
  demand (evidence-gated, consistent with the house rule).
- **Conformance checking (shaped by ADR-0013's no-native/minimal-deps rule):** the unit gate
  gets a small **TypeScript port of `validate_okf.py`'s checks** (frontmatter present/parseable,
  `type` non-empty, strict-tier fields) as a test helper — no Python dependency in `npm test`.
  The delivering PR additionally records a green run of the **original `validate_okf.py
  --strict`** against a generated bundle as the independent cross-check.

## Alternatives considered

- **Two separate builds (AGENTS.md now, OKF later)** — rejected: ADR-0046 already decided one
  shared engine; separating re-creates the drift the layering decision exists to prevent, and
  the marginal cost of the second target over the shared core is small.
- **Auto-regeneration (SessionEnd hook / PostToolUse)** — rejected: the Q3 contract is
  explicit ("regenerate-on-demand, never auto-committed"); auto-emitted generated files drift
  silently and inflate every brain write into a file churn. On-demand keeps the publish act
  deliberate, matching the Publish layer's write model (ADR-0046).
- **MCP `kb_export` tool now** — deferred (see above): no observed in-session need; the CLI
  verb reaches every consumer via the plugin's vendored bundle (ADR-0045).
- **Ship the Python validator as the unit gate** — rejected: adds a Python+pyyaml dependency to
  `npm test` (ADR-0013 spirit: no hard non-JS deps in the gate). The TS port is ~100 lines of
  test-only code; the original stays the independent cross-check in the delivering PR.
- **Wall-clock "as-of" with a `--as-of` override** — rejected as the default: determinism by
  construction (max `updated`) beats determinism by discipline; a flag invites untested paths.

## Definition of Done (build gated — on operator request or named evidence, per house rule)

Accepting this RFC decides the shape; the build triggers on operator request (Track 9's
standing pattern, ADR-0037/0038). When built:

1. **Unit gate, RED first:** (a) byte-determinism — two runs over the same brain produce
   identical trees, **including one run into an output dir carrying generated files from an
   older, different brain state** (stale generated files are swept; proves the rewrite rule,
   not just idempotence) — plus the **refusal case**: a non-empty `--out` dir with no
   generated-marker files hard-fails and deletes nothing; (b) as-of purity — output independent
   of system clock (an entry whose validity window closes between `max(updated)` and the wall
   clock must still export; this test is what forces the `asOf` threading through the
   renderers); (c) **the negative export-predicate test** — a brain seeded with a violation of
   **every clause**: `unverified`/`stale`/`expired` facts, `proposed`/`superseded`/`deprecated`
   decisions, an **archived-but-`verified`** entry, and a `verified` entry whose validity
   window closed before `asOf` — exports **none** of them (both targets); (d) OKF conformance
   via the TS checker port over a generated bundle; (e) AGENTS.md structure (marker,
   Constitution-leads ordering, export-variant map with published-subset-only counts, budget
   respected); (f) **`log.md` history test** — a `verified` entry re-stamped `stale` and a
   tombstoned formerly-published entry both appear in `log.md` (raw-record derivation), while a
   never-published entry does not.
2. **Independent cross-check:** `validate_okf.py --strict` green on a generated bundle,
   recorded in the delivering PR.
3. **L4 scenarios (ADR-0022/0023/0029 — dockerized, N=3, ≥2/3, can fail, RED before
   implementation):** `agents-md-cold-agent` — a naive arm (no MCP, no hooks) given only the
   exported AGENTS.md answers a seeded project question the no-file contrast arm misses;
   `okf-bundle-cold-agent` — same design over the `.okf/` bundle, with the seeded question
   answerable only via `index.md` progressive disclosure. One docker run at a time.

## Open items

- Export budget size for `agents-md` (the `SESSION_BUDGET_CHARS` shape at what multiple) —
  build-time tuning, bounded by the L4 scenario's pass/fail.
- Exact `log.md` rendering granularity (one line per departed entry vs. grouped by
  supersession event) — build-time choice; the determinism requirement (pure function of brain
  content) is decided here and not negotiable at build time.
