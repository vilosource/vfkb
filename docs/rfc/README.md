# vfkb — Requests for Comment (RFCs)

An **RFC is a `proposed` decision** ([ADR-0007](../adr/ADR-0007-rfc-is-proposed-decision.md)):
a pre-decision proposal with an open comment period, written in the same
[Nygard format](https://asdlc.io/concepts/architecture-decision-record/) as an ADR
(Title/ID · Status · Context · Decision · Consequences · Alternatives Considered).

On **acceptance** an RFC becomes an ADR and is assigned its ADR ordinal **at
merge-to-`main`** ([ADR-0009](../adr/ADR-0009-decision-identity-and-numbering.md)).
RFCs therefore carry a local `RFC-NNN` sequence number, **not** an ADR ordinal,
until then — the ordinal is deliberately withheld until the decision is earned.

**Lifecycle:** `RFC-NNN (Proposed)` → accepted → `ADR-XXXX` (ordinal stamped at
merge) | withdrawn / closed. One RFC may spawn several ADRs. Comments are
role-attributed; options under discussion live in the RFC's Decision/text.

| RFC | Title | Status |
|---|---|---|
| [RFC-001](RFC-001-search-relevance-floor.md) | Explicit search applies a relative relevance floor | Accepted → [ADR-0017](../adr/ADR-0017-search-relevance-floor.md) |
| [RFC-002](RFC-002-honest-no-match-contract.md) | Search reports an explicit, cause-distinguished no-match | Accepted → [ADR-0018](../adr/ADR-0018-honest-no-match-contract.md) |
| [RFC-003](RFC-003-embedding-accuracy-mode.md) | The EmbeddingReranker ships as an opt-in "accuracy mode" search tier | Proposed |
| [RFC-004](RFC-004-self-hosted-design-brain.md) | vfkb self-hosts its own design-brain (commit `.vfkb/`; ADRs link-not-copy) | Accepted → [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) |
| [RFC-005](RFC-005-session-continuity-record.md) | Session continuity = a derived, append-only knowledge-continuity record (vfkb's half of the vtf/vfkb seam) | Accepted → [ADR-0020](../adr/ADR-0020-session-continuity-record.md) |
| [RFC-006](RFC-006-auto-distill-and-curator.md) | Auto-distill + ACE curator — capture distils to `incoming`; curation is deltas + counters, never rewrites | Accepted → [ADR-0021](../adr/ADR-0021-auto-distill-and-curator.md) |
| [RFC-007](RFC-007-project-context-doc-and-kb-context.md) | The project context doc + `kb_context` — an assembled "agent's first read" (authored spine + derived sections) | Accepted → [ADR-0025](../adr/ADR-0025-project-context-doc-and-kb-context.md) |
| [RFC-008](RFC-008-decision-capture-reminder.md) | Reliable decision capture — a conditional end-of-turn (Stop-hook) reminder | Proposed (WIP) |
| [RFC-009](RFC-009-l4-harness-and-platform-probes.md) | L4 harness & platform probes | Proposed |
| [RFC-010](RFC-010-consumer-integration-and-distribution.md) | Consumer integration & distribution contract — `vfkb init` / portable engine / `import` / `doctor` | Accepted → [ADR-0030](../adr/ADR-0030-consumer-integration-and-distribution.md) |
| [RFC-011](RFC-011-session-end-continuity.md) | Session-end continuity — safe-by-default `/exit` (SessionEnd auto-commit + handoff floor) | Accepted → [ADR-0033](../adr/ADR-0033-session-end-continuity.md) (GAP 2 + B2 floor; B1 open) |
| [RFC-012](RFC-012-contradiction-surfacing-at-write.md) | Deterministic contradiction surfacing at write time — conflict candidates in the `kb_add` result, never blocking (Track 9 Q1) | Accepted → [ADR-0037](../adr/ADR-0037-contradiction-surfacing-at-write.md) |
| [RFC-013](RFC-013-cross-project-brain-query.md) | Cross-project brain query — read-only, provenance-labeled recall from a registered sibling project's `.vfkb` (links registry + `kb_query_external`) | Accepted → [ADR-0038](../adr/ADR-0038-cross-project-brain-query.md) |
| [RFC-014](RFC-014-session-backbone.md) | v2 — Session backbone: real session identity from hook stdin, widened for entry attribution | Accepted → [ADR-0039](../adr/ADR-0039-session-backbone.md) |
| [RFC-015](RFC-015-native-concurrency-lock.md) | v2 — A vfkb-native concurrency lock, scoped to the read-decide-append critical section | Accepted → [ADR-0040](../adr/ADR-0040-native-concurrency-lock.md) |
| [RFC-016](RFC-016-entries-jsonl-merge-driver.md) | v2 — `entries.jsonl` stops guaranteeing a merge conflict on every second branch (v1: `merge=union`, pending a GitHub server-side check) | Accepted → [ADR-0041](../adr/ADR-0041-entries-jsonl-merge-union.md) |
| [RFC-017](RFC-017-schema-honesty.md) | v2 — Schema honesty: a structural `why` field, full envelope validation, structural contradiction/supersede fields | Accepted → [ADR-0042](../adr/ADR-0042-schema-honesty.md) |
| [RFC-018](RFC-018-rebuildable-index.md) | v2 — A rebuildable index (shape ratified, build evidence-gated); `entries.jsonl` stays the source of truth | Accepted → [ADR-0043](../adr/ADR-0043-rebuildable-index-shape.md) (shape; build gated) |
| [RFC-019](RFC-019-storage-backend-abstraction.md) | v2 — A pluggable storage-backend interface; JSONL stays the shipped default | Accepted → [ADR-0044](../adr/ADR-0044-storage-backend-abstraction.md) |
| [RFC-021](RFC-021-vfkb-claude-code-plugin.md) | vfkb as a Claude Code plugin — primary distribution for the Claude Code harness face, `vfkb init` kept as fallback | Proposed (Phase 0 verified 2026-07-07; pending ratification) |

RFC-014..019 are the first batch of [ADR-0036](../adr/ADR-0036-v2-two-branch-strategy.md)'s
v2 fork (`docs/V2-VISION.md`) — all accepted 2026-07-06 (→ ADR-0039..0044); each **builds on the
`v2` branch**, in roadmap order (RFC-014 first — RFC-015/016 depend on it; RFC-018's build stays
evidence-gated per ADR-0043; RFC-019 is sequenced last).

RFC-001..003 were drafted 2026-06-15 from a study of AnythingLLM (Mintplex Labs)
retrieval mechanics mapped onto vfkb's substrate. All three **refine
[ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md)**'s search
behaviour and honour [ADR-0013](../adr/ADR-0013-no-hard-native-dep.md). They form one
chain: RFC-001 produces empty results, RFC-002 reports them honestly, RFC-003 later
supplies the normalized relevance signal RFC-001 lacks.

RFC-004 (2026-06-25) is independent of that chain: it applies the locked per-project-tier
design ([D2c](../DESIGN.md)) and the docs-via-`link` rule ([D1 constraint 4](../DESIGN.md))
to vfkb's *own* repo, so the substrate dogfoods itself.

RFC-005 (2026-06-25) is an H4 enhancement: it makes session continuity a *derived,
append-only* record (vfkb's knowledge half of the [D1](../DESIGN.md) vtf/vfkb seam),
replacing mykb's forgettable/stale hand-written handoff slot. Composes with
[D7b](../DESIGN.md) auto-distill and [ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md)
Tier-A injection.
