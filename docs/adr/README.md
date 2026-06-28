# vtfkb — Architecture Decision Records

Immutable records of significant vtfkb architecture decisions, in
[Nygard ADR format](https://asdlc.io/concepts/architecture-decision-record/)
(Title/ID · Status · Context · Decision · Consequences · Alternatives Considered).

**Rules (per ADR-0001):**
- One decision per file; **immutable** — never edit a decided ADR's body. Record a
  follow-on as a **new** ADR: to **replace** it, `Superseded by ADR-XXXX`; to
  **refine** it without replacing (the original still holds, evidence or scope
  changed), `Amended by ADR-XXXX`. The only permitted edit to a decided ADR is this
  one-line status pointer.
- Status lifecycle: `Proposed → Accepted → Amended by ADR-XXXX | Deprecated | Superseded by ADR-XXXX`.
- This log is the **authoritative decision record**; `vtfkb-DESIGN.md` is the
  narrative that points into it. The narrative's locked `Dn`/`D-On` decisions
  migrate here over time.

| ID | Title | Status |
|---|---|---|
| [ADR-0001](ADR-0001-record-decisions-as-adrs.md) | Record vtfkb architecture decisions as immutable ADRs | Accepted |
| [ADR-0002](ADR-0002-greenfield-reimplementation.md) | vtfkb is a greenfield reimplementation; mykb is a studied spike | Accepted |
| [ADR-0003](ADR-0003-language-typescript.md) | Implementation language = TypeScript | Accepted |
| [ADR-0004](ADR-0004-decision-is-adr-grade.md) | `decision` is a first-class, ADR-grade entry type in vtfkb | Accepted |
| [ADR-0005](ADR-0005-injection-filters-stale.md) | Auto-injection filters known-stale entries; injects unverified (labeled) | Accepted |
| [ADR-0006](ADR-0006-context-map.md) | Context Map — a derived navigational artifact (v1 = Index/Topology) | Accepted |
| [ADR-0007](ADR-0007-rfc-is-proposed-decision.md) | RFCs are `proposed` decisions, not a new entry type | Accepted |
| [ADR-0008](ADR-0008-constitution-tier.md) | Constitutional rules = flagged decisions + a derived Constitution | Accepted |
| [ADR-0009](ADR-0009-decision-identity-and-numbering.md) | Decision identity = nanoid; ADR ordinal assigned at merge-to-`main` | Accepted |
| [ADR-0010](ADR-0010-product-vision.md) | Product Vision = context-doc narrative + heuristic `pattern`s (no new type) | Accepted |
| [ADR-0011](ADR-0011-envelope-richness.md) | Envelope v1 adopts validity window + structured provenance origin; trust is derived (D-A) | Accepted |
| [ADR-0012](ADR-0012-two-stage-retrieval.md) | Two-stage retrieval; v1 ships Heuristic reranker (default); Stage-1 narrowing right-sized for per-project (D-B) | Accepted (Amended by ADR-0016) |
| [ADR-0013](ADR-0013-no-hard-native-dep.md) | No hard native dep; pluggable `Index`, pure-JS in-memory default, SQLite/FTS5 optional (D-C) | Accepted |
| [ADR-0014](ADR-0014-index-freshness.md) | Index freshness = content-derived token + explicit rebuild, never mtime (D-D) | Accepted |
| [ADR-0015](ADR-0015-cross-harness-auto-layer.md) | Cross-harness auto-layer = tiered parity; per-turn push Pi-only on Claude Code; narrowed Phase 0 spike (D-E) | Accepted |
| [ADR-0016](ADR-0016-search-ranking-and-embedding-revisit.md) | Explicit search is relevance-primary; EmbeddingReranker un-deferred to Planned-pending-verification (amends ADR-0012) | Accepted (Amended by ADR-0017, ADR-0018) |
| [ADR-0017](ADR-0017-search-relevance-floor.md) | Explicit search applies a relative relevance floor (distinct query-term ratio; default 1/3); amends ADR-0016 | Accepted |
| [ADR-0018](ADR-0018-honest-no-match-contract.md) | Search reports a cause-distinguished honest no-match (empty_topic/no_match/all_filtered); amends ADR-0016 | Accepted |
| [ADR-0019](ADR-0019-self-hosted-design-brain.md) | vtfkb self-hosts its own design-brain (commit `.vtfkb/`; ADRs link-not-copy); applies D2c + D1.4 to vtfkb's repo | Accepted |
| [ADR-0020](ADR-0020-session-continuity-record.md) | Session continuity = a derived, append-only knowledge-continuity record (vtfkb's half of the vtf/vtfkb seam) | Accepted (build sequenced) |
| [ADR-0021](ADR-0021-auto-distill-and-curator.md) | Auto-distill + ACE curator — capture distils to `incoming`; curation is deltas + counters, never rewrites | Accepted (Amended by ADR-0024) |
| [ADR-0022](ADR-0022-l4-evaluation-methodology.md) | L4 evaluation methodology = dockerized, reproducible, contrast-based, multi-trial, dual-harness (self-contained images) | Accepted (build sequenced) |
| [ADR-0023](ADR-0023-scenario-contract-first.md) | Agent-observable features are scenario-contract-first — the L4 scenario is the DoD, run RED before implementation (invariants stay unit tests) | Accepted |
| [ADR-0024](ADR-0024-relabel-trust-on-promotion.md) | Corroborated promotion re-stamps provenance verified (trust elevation is agent-observable); distiller stops baking "(unverified)" into text | Accepted |
| [ADR-0025](ADR-0025-project-context-doc-and-kb-context.md) | The project context doc + `kb_context` — an assembled "agent's first read" (authored spine + derived Constitution/Map/decisions), read on demand | Accepted |
