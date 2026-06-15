# RFC-002: Search reports an explicit, cause-distinguished no-match

- **Status:** Proposed
- **Date:** 2026-06-15
- **Deciders:** operator + Claude (proposed — comment period open)
- **Refines (on acceptance):** [ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md).
  **Depends on** [RFC-001](RFC-001-search-relevance-floor.md) (the floor that produces an
  empty result).

## Context

The devops-kb live failure (2026-06-06) had **two** halves: the agent gave a confident
**wrong** answer *and* asserted "no recorded entry" when the entry existed. RFC-001 stops
weak matches from surfacing — but that creates the second-half question directly: when a
search returns nothing, **what does the tool return, and how does the agent know which
kind of nothing it is?**

Today `kb_search` returns a list; an empty list is **ambiguous** across three distinct
causes:

1. **No entry matched the query** (lexical miss — the wording wasn't there).
2. **The brain has no entry on the topic at all** (genuinely nothing recorded).
3. **Matches existed but the ADR-0005 hard gate removed them** (all were
   stale / superseded / archived / past `valid_until`).

These mean very different things to an agent and to the operator, yet collapse to the
same `[]`. An agent that cannot tell (1) from (2) is exactly the agent that says "no
recorded entry" and then answers from model priors as if that were recorded knowledge.

**External corroboration.** AnythingLLM's **Query mode** answers *only* from documents and
returns an explicit refusal ("no relevant documentation") on zero hits, versus **Chat
mode** which blends model knowledge with documents. The explicit refusal is what keeps the
agent honest about provenance. vtfkb is push-injection rather than chat — but its **MCP
pull tools are precisely a query-mode surface**, and they currently lack query mode's
honest-refusal contract.

## Decision

1. **Cause-distinguished empty result.** When a search yields no results, `kb_search`
   returns a structured, machine-distinguishable outcome — not a bare `[]` — carrying
   *which* of the three causes applies: `no_match` (lexical/floor), `empty_topic`
   (nothing in-scope before filtering), or `all_filtered` (candidates existed but the
   ADR-0005 gate removed them; include how many and why-class, e.g. `superseded` /
   `stale`). The cause is derived deterministically from the pipeline stages already in
   `read.query` (pre-filter candidate count vs post-filter vs post-floor).
2. **A "best sub-floor" hint, explicitly labelled.** On `no_match`, the result *may*
   carry the single highest-scoring candidate that fell **below RFC-001's floor**, marked
   unambiguously as *low-confidence / below threshold* and **never** mixed into the
   primary result set. This converts "silently dropped near-miss" into "a near-miss
   exists, here it is, treat it as weak."
3. **Agent-facing contract.** The MCP tool description (and the
   [ADR-0006](../adr/ADR-0006-context-map.md) `kb_map` "pull more" hint) states the
   contract plainly: an explicit `no_match` / `empty_topic` means **no recorded entry was
   found** — it does **not** license presenting a model-prior answer as recorded
   knowledge; and it suggests reformulating or (later) escalating to accuracy mode
   ([RFC-003](RFC-003-embedding-accuracy-mode.md)).
4. **Engine returns structured truth; the harness/agent does the speaking.** The engine
   does **not** synthesise a natural-language "no recorded entry" string — it returns the
   structured outcome; the contract tells the agent how to interpret it. This keeps the
   guard **deterministic** (a reporting contract), not a probabilistic behavioural gate —
   consistent with vtfkb's "deterministic backstop over probabilistic gate" principle.

## Consequences

- **+** Removes the ambiguity the live bug lived in: the agent can now distinguish
  "nothing recorded" from "everything I had went stale" from "your phrasing missed".
- **+** `all_filtered` is a genuine operator signal — queries that hit it are surfacing
  knowledge that has gone stale/superseded and may need attention.
- **+** The labelled sub-floor hint preserves a near-miss without re-admitting it as an
  answer (the failure RFC-001 guards against).
- **−** The MCP response gains shape (an envelope, not a plain array). Accepted — the
  richer contract is the deliverable; an array-reading client still works if results stay
  an envelope field.
- **−** The sub-floor hint risks re-tempting the agent with a weak match; mitigated by
  the explicit low-confidence label and its exclusion from the primary set.

## Alternatives Considered

- **Return bare `[]` on no match (status quo).** Rejected — ambiguous across three
  causes; the live bug lived in that ambiguity.
- **One undifferentiated "no results" flag.** Rejected — collapses the operator-relevant
  `all_filtered` (stale knowledge) into the benign `empty_topic`; the distinction is the
  point.
- **Engine emits a natural-language refusal.** Rejected — that is the agent/harness's job;
  the engine returns structured truth, the contract governs the words. Keeps the engine
  face-agnostic (Pi / Claude Code / MCP all consume the same structure).

## Related

[RFC-001](RFC-001-search-relevance-floor.md) (the floor that produces empty),
[ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md),
[ADR-0005](../adr/ADR-0005-injection-filters-stale.md) (the hard gate behind the
`all_filtered` cause), [ADR-0006](../adr/ADR-0006-context-map.md) (`kb_map` hint surface),
[RFC-003](RFC-003-embedding-accuracy-mode.md) (the escalation the contract points to).
Code: `src/read.ts` (`query`), `src/mcp-server.ts` (`kb_search`). Evidence: devops-kb live
turn 2026-06-06 ("no recorded entry" + confident wrong answer); AnythingLLM Query-mode
refusal.
