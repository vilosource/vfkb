---
type: Decision
title: "ADR-0049: Session-start briefing — deterministic handoff pinning + an on-demand, Haiku-pinned briefing skill"
description: "The newest injectable handoff/next-tagged entry is pinned, never budget-dropped, at the top of the session-start renders (engine, no model); an opt-in /vfkb:brief plugin skill on a Haiku-pinned agent provides enriched synthesis; model escalation is gated on an observed, recorded miss"
status: "Accepted"
timestamp: 2026-07-09
---

# ADR-0049: Session-start briefing — deterministic handoff pinning + an on-demand, Haiku-pinned briefing skill

- **Status:** Accepted
- **Date:** 2026-07-09
- **RFC:** [RFC-023](../rfc/RFC-023-session-start-briefing.md) (accepted 2026-07-09; full
  context, verified root causes, and rejected alternatives live there)
- **Relates:** [ADR-0033](ADR-0033-session-end-continuity.md) (Track 8 — the write side this
  ADR gives a read side), [ADR-0020](ADR-0020-session-continuity-record.md) (the resume render
  extended here), [ADR-0008](ADR-0008-constitution-tier.md) (the pinned-section precedent
  reused), [ADR-0012](ADR-0012-two-stage-retrieval.md) (the reranker left intact),
  [ADR-0045](ADR-0045-vfkb-claude-code-plugin.md) (distribution path; hosts the Layer 1 skill),
  issues [#95](https://github.com/vilosource/vfkb/issues/95) /
  [#96](https://github.com/vilosource/vfkb/issues/96) (the observed failure)

## Context

Live failure, 2026-07-09 (issue #96): the end-of-day handoff fact — written per the Track 8
discipline precisely so the next session starts grounded — never surfaced in the SessionStart
injection. `TYPE_WEIGHT` tiers `fact` below every gotcha/pattern and decision by design
(ADR-0012), so with 23 gotchas in the brain the 10k budget drops all facts; nothing in the
render path treats handoff-tagged entries specially, and the resume digest (ADR-0020) derives
from local session records that structurally cannot carry a cross-clone handoff. Track 8
writes the handoff reliably; no layer reliably read it back. RFC-023 holds the full analysis.

## Decision

Three layers, governed by one principle: **anything that runs automatically for every user
must be free to run; inference is opt-in and cheap by default; expensive only on proven need.**

1. **Layer 0 — deterministic handoff pinning (engine, this repo).** The session-start renders
   pin the newest injectable `handoff`- or `next`-tagged entry in a dedicated `## Last handoff`
   section — after the Constitution, before the ranked bundle — **never budget-dropped**,
   extending the ADR-0008 "Constitution always leads" precedent to continuity. Selection is a
   filter (newest-by-`updated` among `isInjectable` survivors carrying the tag), not an
   inference. No new entry type, no schema change; the ADR-0012 tiering is untouched for the
   ranked remainder. Implemented in `renderContextBundle`, which both `vfkb resume` /
   `kb_resume` and the context-block face compose — one change point covers every surface.
   Ships to consumers via the ADR-0045 loop (re-vendor → plugin release).
2. **Layer 1 — `/vfkb:brief` skill (vfkb-claude-plugin repo), opt-in, Haiku-pinned.** A plugin
   skill spawning a subagent whose definition pins `model: haiku` in frontmatter. The prompt is
   a checklist (pinned handoff → `git log` since its timestamp → flag commits touching its
   named next-steps → `gh` queue state if available → templated brief), degrading gracefully
   offline. **The model choice is a decided default**: the L4 Claude arm already demonstrated
   31/32 on `claude-haiku-4-5` against harder tasks; the work is retrieval + restatement
   (expensive-write/cheap-read); the failure mode is a briefing the operator reads, not a gate
   that acts; metered (non-Max) consumers pay the cheapest tier. Never wired to SessionStart.
3. **Layer 2 — escalation gated on a named trigger.** Bump the agent's model one tier only
   when a Haiku brief is *observed* to miss a discrepancy that mattered, recorded as a
   `gotcha`; the bump is a superseding decision, never silent drift.

## Definition of Done (ADR-0023 / ADR-0029)

`scenarios/session-start-briefing.mjs` — host-level `claude -p` sandbox (the
decision-capture / agents-md-cold-agent pattern): a seeded brain whose handoff fact names an
unguessable sentinel next-step, plus enough high-tier entries to overflow the 10k budget (the
observed failure shape); the agent receives the **real render** as its only context and must
name the sentinel. Contrast arm (the can-fail half): the same render from a brain whose
handoff is absent — must miss. **RED against the unmodified engine is the recorded baseline**
(reproducing the 2026-07-09 live miss), then green. The scenario runs on `claude-haiku-4-5`,
so the same run is the Layer 1 model-adequacy proof. The render string is harness-independent
(the artifact under test is engine output, not hook wiring), so the host-level single-harness
form fits the capability; structural invariants (pin survives budget pressure, newest-wins,
superseded/archived handoffs excluded) are deterministic unit tests.

## Consequences

- Session start answers "what's next" in every clone, on every **session-start** surface
  (`resume` / `kb_resume` / context-block / the SessionStart hook), at zero marginal cost;
  Track 8's write discipline finally pays out automatically at read time. `kb_context` /
  `vfkb context` (ADR-0025, the on-demand project doc) is deliberately not a pin surface.
- The pinned section is **bounded** (truncated at a cap, naming the entry id for `kb_get`):
  unlike the short curated Constitution, a handoff is free text and may be machine-generated
  (the ADR-0033 B2 fallback), so it must not unbound the budgeted render. A constitutional
  handoff-tagged decision is not pinned twice — the Constitution section already leads.
- The injected bundle spends ~one line of its budget on the pinned section when a handoff
  exists; ranked entries yield exactly that much room — accepted, the handoff is worth more
  at session start than the marginal ranked entry.
- The plugin gains its first skill + pinned-model agent, establishing the recorded pattern for
  cost-tiered plugin capabilities (Layer 1 lands in vfkb-claude-plugin's flow, tracked there).
- A brain with no handoff-tagged entries renders exactly as before — the section is omitted,
  not empty.
