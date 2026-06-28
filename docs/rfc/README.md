# vtfkb — Requests for Comment (RFCs)

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
| [RFC-004](RFC-004-self-hosted-design-brain.md) | vtfkb self-hosts its own design-brain (commit `.vtfkb/`; ADRs link-not-copy) | Accepted → [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) |
| [RFC-005](RFC-005-session-continuity-record.md) | Session continuity = a derived, append-only knowledge-continuity record (vtfkb's half of the vtf/vtfkb seam) | Accepted → [ADR-0020](../adr/ADR-0020-session-continuity-record.md) |
| [RFC-006](RFC-006-auto-distill-and-curator.md) | Auto-distill + ACE curator — capture distils to `incoming`; curation is deltas + counters, never rewrites | Accepted → [ADR-0021](../adr/ADR-0021-auto-distill-and-curator.md) |
| [RFC-007](RFC-007-project-context-doc-and-kb-context.md) | The project context doc + `kb_context` — an assembled "agent's first read" (authored spine + derived sections) | Accepted → [ADR-0025](../adr/ADR-0025-project-context-doc-and-kb-context.md) |

RFC-001..003 were drafted 2026-06-15 from a study of AnythingLLM (Mintplex Labs)
retrieval mechanics mapped onto vtfkb's substrate. All three **refine
[ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md)**'s search
behaviour and honour [ADR-0013](../adr/ADR-0013-no-hard-native-dep.md). They form one
chain: RFC-001 produces empty results, RFC-002 reports them honestly, RFC-003 later
supplies the normalized relevance signal RFC-001 lacks.

RFC-004 (2026-06-25) is independent of that chain: it applies the locked per-project-tier
design ([D2c](../DESIGN.md)) and the docs-via-`link` rule ([D1 constraint 4](../DESIGN.md))
to vtfkb's *own* repo, so the substrate dogfoods itself.

RFC-005 (2026-06-25) is an H4 enhancement: it makes session continuity a *derived,
append-only* record (vtfkb's knowledge half of the [D1](../DESIGN.md) vtf/vtfkb seam),
replacing mykb's forgettable/stale hand-written handoff slot. Composes with
[D7b](../DESIGN.md) auto-distill and [ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md)
Tier-A injection.
