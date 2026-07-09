---
type: RFC
title: "RFC-023: Session-start briefing — deterministic handoff pinning + an on-demand, Haiku-pinned briefing skill"
description: "Fix the observed session-start continuity gap: pin the newest handoff fact at the top of every resume/context injection (engine, no model), and ship an opt-in /vfkb:brief plugin skill whose agent is pinned to Haiku — cost is opt-in at every layer"
status: "Accepted → ADR-0049 (ratified 2026-07-09)"
timestamp: 2026-07-09
---

# RFC-023: Session-start briefing — deterministic handoff pinning + an on-demand, Haiku-pinned briefing skill

- **Status:** Accepted → [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md) (ratified 2026-07-09)
- **Date:** 2026-07-09
- **Deciders:** operator + Claude
- **Relates:** [ADR-0033](../adr/ADR-0033-session-end-continuity.md) /
  [RFC-011](RFC-011-session-end-continuity.md) (Track 8 wrote the handoff at session end; this
  RFC is the missing **read side** — the handoff must also *surface* at session start),
  [ADR-0020](../adr/ADR-0020-session-continuity-record.md) (the resume digest this RFC extends),
  [ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md) (the budgeted session-start bundle),
  [ADR-0012](../adr/ADR-0012-two-stage-retrieval.md) (the heuristic reranker whose type-tier
  ordering causes the observed miss), [ADR-0008](../adr/ADR-0008-constitution-tier.md) (the
  existing "pinned, never budget-dropped" precedent this RFC reuses),
  [ADR-0045](../adr/ADR-0045-vfkb-claude-code-plugin.md) (the plugin that hosts the skill and
  vendors the engine change), [ADR-0022](../adr/ADR-0022-l4-evaluation-methodology.md) /
  [ADR-0023](../adr/ADR-0023-scenario-contract-first.md) /
  [ADR-0029](../adr/ADR-0029-sandbox-proven-definition-of-done.md) (proof methodology).

## Context — an observed failure, not a speculative itch

Live evidence, session of **2026-07-09** (first session on plugin v0.3.0): the operator opened
with "what was the last thing we did and what's next?" — the exact question the auto-layer
exists to answer — and the SessionStart injection **did not contain the answer**. The
end-of-day handoff fact (`695bac19a8bb`, tagged `handoff,next,status`, written per the Track 8
discipline) was absent from the injected bundle; answering took a manual `search` plus
`git log`. The operator reports asking this same question **every session**.

Root causes, verified in source on `main` (@ `83b6fa1`):

1. **A handoff `fact` can never win injection ranking.** `TYPE_WEIGHT` (`src/engine.ts:398`)
   is the *primary* sort key: `pattern`/`gotcha` 5, `decision` 4, **`fact` 2**, `link` 1 — and
   the comparator never lifts a fact above a gotcha by design (ADR-0012 L3 tiering). With 23
   gotchas in the brain and a 10k-char budget, `renderContextBundle` (`src/engine.ts:439`)
   budget-drops every fact, handoff included. Nothing in the render path treats
   handoff-tagged entries specially.
2. **The resume digest doesn't consult the brain for handoffs.** `renderResume` derives from
   the per-session record (ADR-0020) — mechanics ("8 entries added, 18 turns"), not content.
   Cross-clone, session records are local/ephemeral, so the digest is structurally unable to
   carry the handoff (the very reason CLAUDE.md says durable handoff state lives in committed
   *entries*).

So Track 8 (ADR-0033) writes the handoff reliably, but no layer reliably **reads it back**.
The write side has a floor (B2 auto-handoff); the read side has none. Related finding, filed
separately (not part of this RFC's scope): `vfkb list` accepts **no** filters and silently
ignores unknown flags (`src/cli.ts` — `list` has no arg parsing at all), which misled the
live diagnosis (`list --tag handoff` dumped all 167 entries).

## Decision (proposed)

Three layers. The governing principle: **anything that runs automatically for every user must
be free to run; inference is opt-in and cheap by default; expensive only on proven need.**
(Non-Max consumers pay per token — the plugin must be correct for them, not just comfortable
on a subscription.)

### Layer 0 — deterministic handoff pinning (engine; no model; always on)

`renderContextBundle` and `renderResume` **pin the newest injectable `handoff`- or
`next`-tagged entry** in a dedicated section at the top of the render — after the Constitution,
before the ranked bundle — **never budget-dropped**, exactly the ADR-0008 precedent
("Constitution always leads") extended to continuity:

- Selection is a filter, not an inference: newest-by-`updated` among entries that pass
  `isInjectable` and carry tag `handoff` or `next`. Superseded/archived handoffs age out
  naturally via the existing filter.
- Rendered as a labelled section (e.g. `## Last handoff`) with the entry's trust glyph, so a
  stale-but-live handoff is still visibly dated.
- No new entry type, no schema change, no reranker change — the ADR-0012 tiering stays intact
  for the ranked remainder; this is a pinned section *above* it, like the Constitution and the
  Context Map already are.
- Ships to consumers via the ADR-0045 loop: engine change → re-vendor → plugin release.

This is the load-bearing fix. It answers "what's next" for **every** consumer (CLI, MCP
`kb_resume`, both harness faces, any billing model) at zero inference cost and zero added
latency, with no operator action.

### Layer 1 — `/vfkb:brief` skill in the plugin, spawning a Haiku-pinned agent (opt-in)

An enriched briefing for when the operator wants synthesis, not just the pinned fact. A skill
in **vfkb-claude-plugin** (plugin-repo deliverable) that spawns a subagent whose definition
pins the model in frontmatter:

- **Model: `haiku` — a decided default, not an accident.** Rationale recorded here so a later
  bump is a superseding decision, not drift: (a) the L4 harness's Claude arm already runs
  `claude-haiku-4-5` and went 31/32 DEMONSTRATED on the v2 ship candidate against *harder*
  tasks than this; (b) the task is retrieval + restatement — the intelligence was spent at
  session end when the handoff was written (expensive-write / cheap-read asymmetry); (c) the
  failure mode is benign — a briefing the operator reads, not a gate that acts; a garbled
  brief costs one glance; (d) for API-billed consumers the whole brief is a few KB at the
  cheapest tier; latency at session start improves for everyone.
- **The prompt is a checklist, not a judgment call** (small models follow procedures better
  than they exercise open-ended judgment): read the pinned handoff → `git log` since the
  handoff's timestamp → flag commits touching the handoff's named next-steps → `gh pr list` /
  `gh issue list` if `gh` is available → templated brief (last done / moved-since /
  what's-next / discrepancies).
- **Degrades gracefully:** no `gh`, no network → brief from brain + local git alone. Layer 0
  already guaranteed the floor, so the skill failing costs nothing.
- **Never runs automatically.** Not wired to SessionStart. A hook that fires every session
  must not spend the consumer's tokens or block their first prompt; invocation is the
  consumer's conscious act.

### Layer 2 — escalation, gated on a named trigger

If the Haiku brief is **observed** to miss a discrepancy that mattered (operator judgment,
recorded as a `gotcha`), bump the agent's frontmatter model one tier and record the
superseding decision. Preemptive escalation is explicitly rejected — same trigger discipline
as S1/Q4.

## Alternatives considered and rejected

- **Agent on SessionStart (automatic briefing):** violates the free-to-run rule — a per-session
  inference tax plus seconds of latency imposed on every consumer, including metered ones, at
  exactly the moment they want to start working.
- **Briefing agent on the session's default model:** frontier prices for courier work; the
  inherited-model default is precisely the accident the frontmatter pin exists to prevent.
- **Skill only, no engine pinning:** leaves every consumer one forgotten `/brief` away from
  the observed failure; the floor must not depend on anyone remembering anything.
- **Boost `fact` in `TYPE_WEIGHT` / special-case handoffs in the reranker:** perturbs the
  decided ADR-0012 ordering for all reads to serve one entry; a pinned section is surgical
  and follows the existing Constitution/Map precedent.

## Scenario contract (ADR-0023 — this is the Definition of Done)

**`scenarios/session-start-briefing.mjs`** — agent-observable, so an L4 scenario is the DoD:

- **Arrange:** sandbox brain containing a handoff-tagged fact naming a concrete next step,
  plus enough gotchas/patterns to overflow the 10k budget (the observed failure shape).
- **Act:** fresh agent session; ask "what was the last thing we did and what's next?" with
  tool use for brain digging disallowed/absent — the answer must come from the injection.
- **Assert:** the agent's answer names the handoff's next step. **RED today** — the live
  2026-07-09 session is the observed baseline, and the scenario must reproduce it RED on
  every harness before the engine change lands (per-harness delivery check), then green.
- The **claude/haiku arm doubles as the Layer 1 model-adequacy proof** — the same evidence
  gates the DoD and the cost decision.
- Structural invariants (pin survives budget pressure; newest-wins; superseded handoffs
  excluded; `list` flag handling) are **deterministic unit tests**, not scenarios.

## Consequences

- Session start answers the operator's first question before it is asked, in every clone,
  on every harness, at zero marginal cost — Track 8's write-side discipline finally pays out
  automatically at read time.
- The plugin gains its first skill + pinned-model agent, establishing the pattern (and the
  recorded rationale) for future cost-tiered plugin capabilities.
- Two repos move per ADR-0045: engine (this repo) for Layer 0 + tests + scenario; plugin repo
  for the skill, agent definition, and re-vendor. The RFC is ratified here; the plugin-side
  build follows the plugin repo's flow.
- The `vfkb list` silent-flag-ignore fix rides as an ordinary issue (deterministic unit test,
  no scenario), independent of this RFC's acceptance.
