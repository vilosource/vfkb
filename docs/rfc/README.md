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
| [RFC-001](RFC-001-search-relevance-floor.md) | Explicit search applies a relative relevance floor | Proposed |
| [RFC-002](RFC-002-honest-no-match-contract.md) | Search reports an explicit, cause-distinguished no-match | Proposed |
| [RFC-003](RFC-003-embedding-accuracy-mode.md) | The EmbeddingReranker ships as an opt-in "accuracy mode" search tier | Proposed |

These three were drafted 2026-06-15 from a study of AnythingLLM (Mintplex Labs)
retrieval mechanics mapped onto vtfkb's substrate. All three **refine
[ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md)**'s search
behaviour and honour [ADR-0013](../adr/ADR-0013-no-hard-native-dep.md). They form one
chain: RFC-001 produces empty results, RFC-002 reports them honestly, RFC-003 later
supplies the normalized relevance signal RFC-001 lacks.
