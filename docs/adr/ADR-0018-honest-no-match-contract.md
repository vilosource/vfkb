# ADR-0018: Search reports a cause-distinguished, honest no-match (amends ADR-0016)

- **Status:** Accepted
- **Date:** 2026-06-15
- **Deciders:** operator + Claude
- **Origin:** [RFC-002](../rfc/RFC-002-honest-no-match-contract.md) (accepted on implementation).
- **Builds on:** [ADR-0017](ADR-0017-search-relevance-floor.md) (the relevance floor that
  produces the empty result this ADR explains).
- **Amends:** [ADR-0016](ADR-0016-search-ranking-and-embedding-revisit.md) — refines the
  read/search contract; does not change its ranking decision.

## Context

The devops-kb live failure (2026-06-06) had two halves: a confident **wrong** answer
*and* a "no recorded entry" claim when the entry existed. ADR-0017 stopped weak matches
from surfacing; that sharpened the second-half question: when a search returns nothing,
**what is returned, and how does the agent know which kind of nothing it is?**

`kb_search` returned a bare `(no matches)` / `query()` returned `[]`. An empty result is
ambiguous across three causes that mean very different things:

1. **no_match** — lexical hits existed but none cleared the relevance floor (a near-miss).
2. **empty_topic** — nothing recorded shares any wording (genuinely nothing).
3. **all_filtered** — matches existed but the ADR-0005 gate / D5c filters removed them all
   (e.g. everything on the topic is stale or superseded).

Collapsing all three to `[]` is exactly what lets an agent say "no recorded entry" and
then answer from model priors as if that were recorded knowledge.

External corroboration: AnythingLLM's **Query mode** answers only from documents and
returns an explicit refusal on zero hits (vs Chat mode, which blends). vfkb's MCP pull
tools are that same query-mode surface and lacked the honest-refusal contract.

## Decision

1. **Cause-distinguished empty result.** A new `queryExplained()` returns
   `{ results, diagnosis? }`; `diagnosis` is present **only** when `results` is empty and
   carries `reason: 'empty_topic' | 'no_match' | 'all_filtered'`, derived deterministically
   from the pipeline stage counts (scored vs floored vs filtered) — never a heuristic.
   `query()` keeps its plain `KnowledgeEntry[]` contract (delegates to the same pipeline).
2. **Filter-reason tally.** Each candidate the filter drops is counted by `DropReason`
   (`type/zone/role/tags/status/superseded/stale`), so `all_filtered` reports *why* — and
   a `stale`/`superseded` count is surfaced as the operator signal "the recorded knowledge
   here is out of date" (with `include_stale`/`include_superseded` to inspect).
3. **Labelled below-floor hint.** On `no_match`, `diagnosis.belowFloor` carries the single
   best candidate that fell below the floor, with its `matched/queryTerms`, marked
   **low-confidence** and kept **out** of `results` — so a near-miss is reported, never
   silently lost and never mixed into answers.
4. **Agent contract at the faces.** `kb_search`'s description and its empty-result text
   state plainly: an empty result means *no recorded entry was found — not a licence to
   present model-prior knowledge as recorded*. The CLI prints a `NO-MATCH <reason>` line
   instead of silence.
5. **Engine returns structured truth; the face speaks it.** The engine emits the
   structured diagnosis; the MCP/CLI face renders the words and the contract. A
   deterministic reporting contract, not a behavioural gate (vfkb's "deterministic
   backstop over probabilistic gate").

*Implemented and tested* (this commit): `src/read.ts` (`queryExplained`, `SearchDiagnosis`,
the reason tally), `src/mcp-server.ts` (`renderNoMatch` + contract in the tool
description), `src/cli.ts` (`NO-MATCH` line), 4 tests in `test/read.test.ts`, and a
deterministic in-container check (`spike/dogfood-smoke.sh` #8).

## Consequences

- **+** Removes the ambiguity the live bug lived in: "nothing recorded" vs "everything I
  had went stale" vs "your wording missed" are now distinct.
- **+** `all_filtered` with a stale/superseded count is a real operator signal that
  recorded knowledge has gone out of date.
- **+** The labelled below-floor hint preserves a near-miss without re-admitting it as an
  answer (the failure ADR-0017 guards).
- **−** `queryExplained` adds a return shape alongside `query()`. Accepted — `query()` is
  untouched, both share one pipeline, no caller breaks.
- **−** The below-floor hint risks re-tempting the agent with a weak match; mitigated by
  the explicit low-confidence label and its exclusion from `results`.
- **Neutral:** ranking, the floor, and the ADR-0005 gate are unchanged; ADR-0016 gains a
  second "Amended by" pointer (ADR-0017, ADR-0018).

## Alternatives Considered

- **Keep returning bare `[]` / `(no matches)`.** Rejected — ambiguous across three causes;
  the live bug lived in that ambiguity.
- **One undifferentiated "no results" flag.** Rejected — collapses the operator-relevant
  `all_filtered` (stale knowledge) into the benign `empty_topic`.
- **Engine emits a natural-language refusal.** Rejected — that is the face's job; the engine
  returns structured truth so every face (Pi / Claude Code / MCP / CLI) renders one source
  of truth its own way.
- **Change `query()`'s return type.** Rejected — needless ripple; `queryExplained` is
  additive and `query()` delegates to it.

## Related

[ADR-0016](ADR-0016-search-ranking-and-embedding-revisit.md) (search contract — amended),
[ADR-0017](ADR-0017-search-relevance-floor.md) (the floor that produces the empty result),
[ADR-0005](ADR-0005-injection-filters-stale.md) (the hard gate behind `all_filtered`),
[RFC-003](../rfc/RFC-003-embedding-accuracy-mode.md) (a normalized signal will sharpen
`no_match` later). Code: `src/read.ts`, `src/mcp-server.ts`, `src/cli.ts`; tests
`test/read.test.ts`. Evidence: devops-kb live turn 2026-06-06; AnythingLLM Query-mode
refusal.
