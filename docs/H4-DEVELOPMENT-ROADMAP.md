# vtfkb — H4 Development Roadmap (the active, in-repo frontier)

> **Type:** sequenced build plan for the H4 "robustness & quality" frontier. **Created:** 2026-06-25.
> **Re-ratified:** 2026-06-27 (added Track 5 dockerized L4 substrate + Track 4 Track-1 L4 coverage; ADR-0022).
> Sits under [STATUS-AND-ROADMAP](STATUS-AND-ROADMAP.md) §4 H4 (the broad north-star) and above
> the decisions ([docs/adr/](adr/)) + proposals ([docs/rfc/](rfc/)) it sequences. ADRs ratify the
> *decisions* (what to build); **this roadmap ratifies the *order* and is the standing authority to
> execute it** (§4) — proceed in sequence without per-step approval; stop only at the named gates. A
> "what's next?" question is a signal to update + re-ratify §4, not to ask.
> Scope is **in-repo only** (H0+H4); fleet/ingest integration (H2) and the global tier (H3) stay
> parked. Claims tagged **[done]**, **[accepted]**, **[proposed]**, **[designed]**, **[planned]**, **[external-blocked]**.

---

## 1. Where we are (status snapshot, 2026-06-25)

`main` is green (**87/87** unit). v1 (per-project tier) is shipped; **M1 (session-continuity Phase A)
shipped** (`ff61215`); **RFC-006 accepted → ADR-0021**; **M2a (curator safety foundation, `ee45289`) +
M2b (distiller + counters + corroborated promotion) shipped**; **M3 (session-continuity Phase B) shipped**
— the resume digest now folds the auto-distilled `incoming` lessons in, trust-labelled and derived.
**Track 1 (memory that carries itself) is complete.** Beyond that:

| Area | State |
|---|---|
| Search hardening | **[done]** relevance-primary (ADR-0016) + relevance floor (ADR-0017) + honest no-match (ADR-0018) |
| Self-hosted design-brain | **[done]** ADR-0019 — vtfkb dogfoods its own `.vtfkb/` (committed SoR + ADR/RFC link-index) |
| L4 cross-model eval | **[done, v1-only]** 5 harness/model records, 22 scenarios each (deepseek-v4-pro 22/22; 2 known divergences: `tool-gating`, `capture-recall`) — but the 22 **predate Track 1**: M1–M3 have **no** L4 coverage (audit 2026-06-27) → **Track 4** |
| L4 methodology | **[Track 5 done 2026-06-27]** ADR-0022 — dockerized pi (`vtfkb-l4-pi:dev`, 22/22) + claude (`vtfkb-l4-claude:dev`, 21/22 via Max-subscription OAuth) substrates both reproduce host baselines at N=3, no divergences → **Track 4** next |
| Track-1 L4 coverage | **[6 core done 2026-06-27]** all 6 Track-1 scenarios ✅ (pi 28/28, claude 27/28); exposed+fixed a pi resume gap, logged pi live-capture + corroborated-promotion-trust-render findings. **Track 4b:** role-precedence ✅, D-i `verified-only-filter` ✅, D-iii `promotion-relabel` ✅ (ADR-0024), D-iv `live-capture-result` ✅ (pi 3/3; claude failure-capture external-blocked); D-ii context-doc = autonomy ceiling (RFC + pause) |
| Dogfood smoke | **[done]** check 6 hardened — deterministic `tools/list` preflight (6a) + bounded LLM retry (6b) |
| **Session continuity** | **[DONE]** ADR-0020 / RFC-005 — M1 (`ff61215`) + M3 (resume digest folds distilled lessons, trust-labelled, derived) |
| Auto-distill / ACE curator | **[DONE]** RFC-006 → ADR-0021 — curator + never-rewrite Brake (`ee45289`, M2a) + distiller + counters + corroborated promotion (M2b) |
| Embedding reranker | **[proposed]** RFC-003 — evidence-gated, do **not** build speculatively |
| Per-turn injection on Claude Code | **[external-blocked]** ADR-0015 Tier C — waits on upstream hook fixes |

**New fork (2026-06-27 L4 coverage audit).** Track 1's features shipped with their **deterministic unit
backstops** (`resume.test.ts` / `curator.test.ts` / `distiller.test.ts`) — those *are* the gate (principle
#4), so Track 1 is correctly *shipped*. What is missing is the **L4 purpose-demonstration**: no scenario
yet proves *a real agent behaves better because of* resume / auto-distill — for a product whose entire pitch
is "memory that carries itself across sessions." The same audit found the L4 *harness itself* is
non-reproducible (host-installed agents, unpinned models) and leak-controlled by fragile denylists, with no
ADR of record. Decision: re-platform the harness first (**Track 5**, [ADR-0022](adr/ADR-0022-l4-evaluation-methodology.md))
— a reproducible, sandboxed, multi-trial substrate that also re-records the existing 22 cleanly — then add
the Track-1 scenarios on it (**Track 4**). Sequenced below, ratified in §4.

---

## 2. The dependency picture (why order matters)

```
  ADR-0019 self-hosted brain ──┐ (every enhancement below dogfoods here first)
                               │
  ADR-0020 session-continuity ─┤
     Phase A: record + resume render ── ✅ DONE (M1, ff61215)
     Phase B: auto-distilled knowledge ── ✅ DONE (M3) — consumes ▼
                                                   D7b auto-distill / ACE  (RFC-006 → ADR-0021; M2a ✅ + M2b ✅ DONE)
                                                      └─ curator = deltas-not-rewrites (IMPL-PLAN L12); distiller = incoming-only containment

  RFC-003 embedding reranker ── independent track, EVIDENCE-GATED (2nd phrasing miss | explicit ask)

  ADR-0015 Tier-C per-turn push on Claude Code ── EXTERNAL-BLOCKED (watch upstream)

  ADR-0022 L4 methodology ── Track 5 dockerized substrate ──► Track 4 Track-1 L4 scenarios
     (substrate re-records the existing 22 as its deterministic backstop, THEN the new
      cross-session scenarios run on it; ADR-0020/0021 are the features those scenarios assert)
```

Three facts drive the sequence:
1. **Session-continuity Phase B *depends on* auto-distill (D7b).** Phase A (the record + resume
   render) does not — so Phase A ships now, and auto-distill is the natural *next* design+build,
   which then unlocks Phase B. *(Track 1 — done.)*
2. **Embeddings and Tier-C parity are independent of the continuity/distill line** — embeddings is
   gated on evidence, Tier-C on an upstream fix. Neither blocks anything; neither is built on spec.
3. **Track 4 (Track-1 L4 scenarios) runs best on Track 5's substrate.** The scenarios are
   harness-agnostic and *could* be added to the host harness, but they are **cross-session** — exactly
   what benefits from the dockerized, reproducible multi-session substrate — so Track 5 lands first and
   Track 4 is recorded on it. The two are otherwise orthogonal (the scenarios don't change the engine;
   the substrate doesn't change a scenario's assertion).

---

## 3. Sequenced plan

### Track 1 — Memory that carries itself (continuity → auto-distill)  *(primary line)*

**M1. Session-continuity Phase A — `[DONE 2026-06-25, ff61215]`** (ADR-0020)
Append-only per-session record (`SessionState` extended) + derived digest (added/superseded
re-derived from the brain window; injected/captured/turns from the record; note/signals labelled
ASSERTED) + the Tier-A **resume render** + `resume`/`resume-note` CLI + `kb_resume` MCP tool (8 tools).
- ✅ Dogfooded on vtfkb's own brain (ADR-0019); ✅ resume obeys ADR-0005 + the 10k budget.
- ✅ Gate met: `test/resume.test.ts` proves the digest **cannot go stale** (a mutated brain
  re-derives a different digest from the SAME record) — the deterministic P2 backstop. **69/69 green.**

**M2 = ACE auto-distill (RFC-006 → ADR-0021), split into two build slices:**

**M2a. Curator safety foundation — `[DONE 2026-06-25, ee45289]`**
The load-bearing safety half (built first because it is *why* this was ADR'd). `src/curator.ts`:
delta-only, text-preserving ops — `promote` (incoming→established), `archive`, `mergeDuplicate`
(archive loser + auditable tag), `findLexicalDuplicates` (proposes, never acts); decisions stay
supersede/transition-only.
- ✅ Gate met: **the structural Brake** (`test/curator.test.ts`) asserts every op leaves entry text
  **byte-identical** — any in-place rewrite fails the build (L12 can't sneak in via prose). Plus a
  **retrieval-quality regression** (a dedup pass keeps the answer surfacing, drops only the duplicate).
  CLI `curate`; dogfooded on vtfkb's own brain. **76/76 green.**

**M2b. Distiller write-side + counters — `[DONE]`** (`src/distiller.ts`, `src/counters.ts`, +`promoteIfCorroborated`)
The deterministic `Distiller` (a captured **failure** → a candidate gotcha written **only** to
`incoming`/unverified/agent-trust — containment) behind a `Distiller` seam an optional off-hot-path LLM
distiller can later fill; the **append-only counter/signal stream** (aggregated at read) that drives
corroborated promotion. **Recurrence = corroboration:** re-distilling the same error *signature* records a
counter signal on the existing candidate instead of duplicating it.
- *Gate — MET:* distiller writes only to `incoming`/unverified/agent (a deterministic **containment Brake**,
  `test/distiller.test.ts`); counters never mutate an entry (append-only test — entry text+`updated` byte-stable);
  promotion needs ≥`PROMOTION_THRESHOLD` net corroborating signals (`promoteIfCorroborated` refuses below it —
  "auto-distill alone cannot mint trusted knowledge"); 84/84 green; dogfooded on `.vtfkb` (clean no-op, no
  pollution) + full loop proven in a temp brain. The build trigger was the operator go-ahead (2026-06-25).
- *Sub-decisions settled (2026-06-25):* **(a) counter storage = operational/gitignored** at
  `<brain>/.signals/counters.jsonl`, mirroring `.sessions` — the durable effect (promotion) lands in the
  committed `entries.jsonl` SoR, so raw tallies stay append-only agent-trust telemetry (survive restart, not
  clone); keeps the brain the single committed SoR. **(b) `tool_result` retention = minimal bounded outcome**
  — capture now classifies each call ok/error (`classifyToolOutcome`) and keeps a ≤120-char summary
  (`capture:ok|error` tag + `→ <summary>`); structured signals (isError/exit/stderr) are authoritative,
  enough for a deterministic error→gotcha distiller without storing full results; the no-secrets lint covers it.

**M3. Session-continuity Phase B — `[DONE]`** (`renderResumeDigest`, `test/resume.test.ts`)
The resume digest now gains the real learned lessons, not just counts: the auto-distilled `incoming`
candidates of the session window are folded in (`distilledLessons` — tag `distilled`, still incoming),
**trust-labelled** (`⚠agent`, "candidates, verify before trusting") with their corroboration count
(M2b counters, aggregated at read). To keep the window honest, `distill` now advances the session
record (`lastAt`) so freshly-distilled lessons fall inside `[startedAt, lastAt]`.
- *Gate — MET:* the digest surfaces distilled `incoming` lessons trust-labelled; the M1 "cannot go
  stale" property still holds — the section is **derived** from the live brain, so a lesson later
  promoted (zone≠incoming) or archived drops out on the next render (anti-stale test). 87/87 green;
  dogfooded — full capture→distill→next-session-resume loop in a temp brain; the real `.vtfkb` honestly
  omits the section (no distilled lessons there).

### Track 2 — Search robustness (embeddings)  *(parallel, evidence-gated)*

**S1. Embedding reranker — `[proposed, GATED]`** (RFC-003)
Opt-in "accuracy mode" on explicit search; in-memory vectors (no vector DB at per-project scale);
embedder optional/auto-detected/graceful-degrade (ADR-0013); **forbidden on the injection path**.
- *Build trigger (unchanged):* a **2nd** observed live phrasing-robustness miss **or** an explicit
  operator request. The design (shape) is already locked in RFC-003 — only the build is gated.
- *Do not build on spec.* Keep the `selectIndex()` seam warm; nothing else until the trigger fires.

### Track 3 — Cross-harness parity  *(watch, not build)*

**P1. Per-turn push on Claude Code — `[external-blocked]`** (ADR-0015 Tier C)
Claude Code degrades to MCP-pull today because `UserPromptSubmit` is documented-unreliable +
cache-inefficient. *Action: periodically re-check the upstream hook bugs; build a Tier-C push (a
new ADR superseding the Tier-C clause) only when they are fixed.* No work until then.

### Track 5 — L4 methodology: dockerized harnesses  *(COMPLETE — T5a ✅ + T5b ✅, 2026-06-27)*  ([ADR-0022](adr/ADR-0022-l4-evaluation-methodology.md))

Re-platform the L4 harness onto **pinned, self-contained containers** (operator decision 2026-06-27:
self-contained docker images, not the `vfa` orchestrator). The contrast methodology (`vtfkb` vs
`naive`/`none`) and the observable-effects rule are **unchanged**; this changes only *where* the agent runs.
Builds before Track 4 so the new cross-session scenarios get a reproducible, sandboxed home and the existing
22 are re-recorded cleanly. Two slices:

**T5a. pi-coding image + dockerized runner + multi-trial — `[done 2026-06-27]`** *(the proven path first)*
`scenarios/docker/pi.Dockerfile` (node + pinned `pi` 0.73.1 + baked `dist` + a deepseek-only `models.json`
whose `apiKey` names `DEEPSEEK_TOKEN`, injected at run time); `run()` ported so the pi harness `docker run`s
this image instead of host `pi`; brain bind-mounted **uid-matched** (`--user $(id -u):$(id -g)`, `HOME` set)
so the agent's writes persist to the host mount; cross-session via threaded `KB_SESSION_ID` + shared mount
(the kb-spike pattern). **N=3 multi-trial** added (demonstrated = contrast holds ≥2/3); record schema extended
with **image digest + per-scenario trial pass-rate**; `compare.mjs` renders pass-rate. Dockerized runs record
to a distinct `__docker` slug so the host baseline is never clobbered. `PI_MODE=host` remains an escape hatch.
- *Gate (deterministic backstop, P2) — **MET**:* all **22 scenarios reproduced in-container** on
  `vtfkb-l4-pi:dev` (digest `sha256:09f2ff94…`) at N=3, **22/22 demonstrated**, matching the known-good host
  pi record (deepseek-v4-pro 22/22) with **no divergences** (only `tool-gating` at 2/3, genuine model
  flakiness the trials absorb). The gate caught a real port bug — `tool-gating` embedded the *host* brain path
  in its prompt; fixed via `agentBrain()` to use the container `/brain`. Write-through proven: `capture-recall`
  3/3 (in-container tool call → host-mounted `entries.jsonl` → recalled by a second container; uid gotcha
  closed, not assumed). 87/87 unit tests still green.

**T5b. claude-code image — `[done 2026-06-27]`**
`scenarios/docker/claude.Dockerfile` (node:20-slim + pinned `@anthropic-ai/claude-code` 2.1.195 + baked
`dist`) → `vtfkb-l4-claude:dev`. The claude harness `run()` ported to `docker run` (mirrors the pi port:
uid-matched `/brain` mount, container-path `claudeSettings`/`mcpConfig`, `__docker` slug, N=3, `agentBrain()`
for `tool-gating`; `VTFKB_L4_CLAUDE_MODE=host` escape hatch).
- *Auth — RESOLVED (operator decision 2026-06-27):* use the **Claude Code Max subscription OAuth**, not an
  `ANTHROPIC_API_KEY` (none set on this host). The harness mounts a **per-run throwaway copy** of
  `~/.claude/.credentials.json`'s `claudeAiOauth` block at `/work/.claude` (`mcpOAuth` dropped — privacy;
  never the live host file). **Verified** working headless in-container (`claude -p` → reply). See
  [ADR-0022](adr/ADR-0022-l4-evaluation-methodology.md) #8.
- *Denylist re-scoped (ADR-0022 #9):* `--strict-mcp-config`/empty-MCP are pure host-MCP no-ops in the sandbox
  (kept for parity); `FS_DENY` is the **test-validity tool-gate** (stops the agent reading the mounted
  `/brain` instead of injected context — the claude analogue of pi's `--no-tools`) and is **retained**.
- *No-leak check — PASSED:* deterministic filesystem probe of the container (observed, not asserted): no host
  home, no host `~/.pi`/`~/.azure`, `~/.claude.json` `mcpServers` empty, mounted credential carries only
  `claudeAiOauth`.
- *Gate — MET:* `vtfkb-l4-claude:dev` (digest `sha256:b65b9204…`) reproduced the host baseline **exactly at
  N=3 — 21/22 demonstrated**, with `tool-gating` the sole non-demonstration on *both* substrates (the
  documented haiku model divergence, not a substrate effect); `compare.mjs` reports **no divergences**. The
  gate surfaced a real substrate effect — the multi-step MCP scenarios (kb_map→kb_search) exceeded the host
  175 s budget under container + MCP-boot overhead → fixed with a `DOCKER_TIMEOUT` (300 s); both then
  reproduced (mcp-pull 3/3, mcp-map-navigation 2/3). 87/87 unit green.

### Track 4 — L4 coverage for Track 1  *(6 core scenarios ✅ COMPLETE 2026-06-27; Track 4b partials remain)*  (ADR-0020 / ADR-0021)

The agent-level **purpose-demonstration** the audit found missing: prove a real agent behaves better
*because of* Track 1. Each scenario keeps the `vtfkb`-vs-baseline contrast and asserts on observable effects.
**Scope note:** the curator never-rewrite Brake + append-only counters are *structural invariants* — they
stay **deterministic unit tests** (ADR-0021 §5; principle #4); L4 only exercises agent-observable behavior.

**Finding (2026-06-27, surfaced by building `continuity-resume`):** the **pi extension** injected only the
live bundle at session start, *not* the resume render — so ADR-0020 pt 5 (the Resume render as the Tier-A
session-start injection) was **undelivered on the pi harness** (the claude `hook session-start` already did
it). Fixed: `pi-extension` `before_agent_start` now injects `renderResume` (parity). Full pi re-validation
after the change: **23/23 at N=3** on the rebuilt image (`vtfkb-l4-pi:dev` `sha256:bdd2dfd2…`) — no
regression. This is Track 4 doing its job: a purpose-demonstration scenario exposed a real delivery gap.

| Scenario | Asserts (ADR) | Shape | Status |
|---|---|---|---|
| `continuity-resume` | ADR-0020 resume render | s1 leaves a resume-note (unguessable token, the one thing only the operator knows); **s2** surfaces it via the resume render and states the next task; `none` can't. *(cross-session)* | **✅ pi 3/3, claude 3/3** |
| `resume-reflects-correction` | ADR-0020 "cannot go stale" | a decision is superseded between s1→s2; s2 resume surfaces the **corrected** value, the naive baseline replays the stale one. *(cross-session)* | **✅ pi 3/3, claude 3/3** |
| `kb-resume-mcp` | ADR-0020 §5 MCP floor | agent pulls continuity via the `kb_resume` MCP tool (parity with `mcp-pull`). | **✅ pi 3/3, claude 2/3** |
| `auto-distill-recall` | ADR-0021 §1 + ADR-0020 M3 | s1: a captured tool **failure** → distill → candidate gotcha; **s2** resume surfaces the distilled lesson; `none` doesn't. *(the headline M2b→M3 loop)* | **✅ pi 3/3, claude 3/3** |
| `distill-trust-label` | ADR-0021 §1 containment | trust gradient: the same lesson is delivered as a CANDIDATE when auto-distilled vs ESTABLISHED when human-authored; the agent distinguishes them. | **✅ pi 3/3, claude 3/3** |
| `corroborated-promotion` | ADR-0021 §4 | net ≥2 corroborations → promotion to established **succeeds**; below threshold **refused**. *(deterministic — see finding)* | **✅ pi 3/3, claude 3/3** |

**Finding (2026-06-27, surfaced by `corroborated-promotion`):** promotion elevates the **zone**
(`incoming`→`established`) but **not** the agent-visible trust presentation — the entry keeps its `⚠agent`
glyph + "(unverified)" text (trust is role-derived; the role stays `executor`). So an agent **cannot observe**
the trust elevation (a promoted and an unpromoted distilled lesson both read as a candidate). ADR-0021 §4's
"delivered as trusted" is therefore **zone-deep only**. The scenario asserts the real, observable §4 behavior
at the **deterministic gate** (net ≥2 promotes; <2 refused) rather than as a (non-separating) agent contrast.
*Recommendation (deferred, needs a decision):* on promotion, also relabel trust (or render zone in the glyph)
so the elevation is agent-visible — otherwise corroborated promotion has no agent-observable effect.

- *Gate:* each scenario `demonstrated` on ≥2/3 trials on **both** images (pi + claude — auth is wired);
  recorded into `scenarios/records/__docker`. Dogfood the continuity scenarios against vtfkb's own brain
  shape (ADR-0019). `continuity-resume` met it: **pi 3/3, claude 3/3** (records carry image digest + N=3).
- *Harness additions for cross-session (2026-06-27):* `KB_SESSION_ID` is now threaded into the **claude**
  docker run (was pi-only) so `SessionState` persists a record across containers; a scenario sets a prior
  session's note host-side via `vtfkb resume-note` (`KB_SESSION_ID=s1`), and seeds a captured tool failure
  via the real `hook post-tool-use` CLI (harness-agnostic capture seam).
- *Finding (2026-06-27, surfaced by `auto-distill-recall`):* the **pi live extension** captures tool calls at
  the `tool_call` event — *before* execution, so **without the result** → every live pi capture is classified
  `capture:ok`, never `capture:error`. So a pi *live* session cannot auto-distill a failure (the claude
  `PostToolUse` hook has the result and can). The scenario sidesteps this by driving the real `post-tool-use`
  capture hook with a synthetic failure (the distill + recall are real on both). **Fix (deferred, needs pi's
  post-execution event API verified):** capture on a pi post-tool event that carries the result. Logged; not
  blocking — distinct from the resume gap, which was a one-line fix.

**Track 4b — close the v1 partials — `[scenario-first, in progress]`** (applies [ADR-0023](adr/ADR-0023-scenario-contract-first.md))
The audit flagged three *partial* v1 gaps. Per ADR-0023 each was contract-grounded **before** any code (check
the mechanism exists) — which immediately split them into one delivered + two genuinely-unbuilt:

| Scenario | FEATURES § | Mechanism check | Status |
|---|---|---|---|
| `role-precedence` | §3.3 attribution-as-precedence | `rerank`/`withinTierScore` weights operator-trust +3, verified +1 → **delivered** | **✅ pi 3/3, claude 3/3** |
| `verified-only-filter` | §3.6 trust gradient | `kb_search` had no provenance-`verified` filter → **now built** (`verified` param on `kb_search` + `--verified` CLI + `verifiedOnly` in the engine, filters `provenance.status === 'verified'`); RED-first confirmed on both harnesses, then green | **✅ D-i DONE: pi 2/3, claude 2/3** |
| `kb-context-first-read` | §3.7 context doc | **no `kb_context` MCP tool** and no authored context-document feature (only the entry-bundle injection exists) → unbuilt | **🔴 GAP — needs a feature (context-doc + `kb_context`), likely its own RFC/ADR (D-ii, ceiling)** |
| `promotion-relabel` | §3.6 + ADR-0021 §4 | corroborated promotion was zone-only → **now built** (D-iii/ADR-0024): `promoteIfCorroborated` re-stamps `provenance.status='verified'` (agent-observable via D-i's verified filter); distiller drops "(unverified)" from new text | **✅ D-iii DONE: pi 2/3, claude 2/3** |
| `live-capture-result` | ADR-0021 capture | pi captured at `tool_call` (no result) → couldn't auto-distill a LIVE failure → **now built** (D-iv): `pi.on('tool_execution_end')` captures WITH result+isError; `hook post-tool-use` reads claude's `tool_response` | **✅ D-iv DONE: pi 3/3** (claude failure-capture external-blocked — gated to pi) |

Scenario-first did its job: 2 of 3 "partials" are genuinely unbuilt, surfaced *before* writing a scenario
against a non-existent mechanism. `role-precedence` (the delivered one) is recorded; the two gaps are RED
contracts pending an operator decision on whether/when to build (the `verified` filter is small and in-scope
for §3.6; the context-doc is a larger feature). Not Track-1-blocking.

---

## 4. Ratified order + execution protocol

**Order (re-ratified 2026-06-27):**
`M1 ✅ → RFC-006 ✅ → M2a ✅ → M2b ✅ → M3 ✅` (**Track 1 complete**)
`→ ADR-0022 ✅ → T5a ✅ → T5b ✅ → Track 4 (6 core ✅) → ADR-0023 ✅ → Track 4b (role-precedence ✅ → D-i verified-filter ✅ → D-iii relabel-on-promotion ✅ → D-iv pi-capture-results ✅ → **D-ii context-doc (autonomy CEILING — RFC + pause)**)`.
**D-i, D-iii, D-iv are DONE** (2026-06-27): D-i `verified`-filter green (pi/claude 2/3); D-iii
relabel-on-promotion green (`promotion-relabel` pi/claude 2/3, ADR-0024); D-iv pi live tool-result capture
green (`live-capture-result` pi 3/3; claude live-failure-capture EXTERNAL-BLOCKED — see finding). The **active
build is now D-ii — the autonomy CEILING** (context-doc + `kb_context`): draft an RFC and PAUSE for operator
review before any code. The remaining gaps are sequenced by cost/dependency (small
finding-closers first; D-ii is RFC-gated and last); each is built scenario-first (ADR-0023). Track 4's 6 core
scenarios are complete (pi 28/28, claude 27/28). **S1** (embedding reranker) and
**P1** (Claude Code per-turn push) remain the two **gated/blocked** tracks — built only if their triggers
fire. One build in flight at a time; each behind an accepted ADR.

*Fork-resolution note (2026-06-27):* the 2026-06-27 L4 coverage audit surfaced a genuine new fork (Track 1
shipped with unit backstops but no L4 purpose-demonstration; the L4 harness itself is non-reproducible). Per
the protocol this re-ratifies the roadmap rather than acting ad hoc. Operator settled the build shape this
session: **driver = self-contained docker images** (not the `vfa` orchestrator); **sequencing = Track 5
substrate before Track 4 scenarios**. The methodology decision is recorded as
[ADR-0022](adr/ADR-0022-l4-evaluation-methodology.md) (Accepted) — its "shape" was decided by these fork
answers, analogous to the M2 operator-cleared gate. One open prereq (claude-code container auth) is deferred
to T5b per SOP, not gating T5a.

*Gate-resolution note (2026-06-25):* the M2 *build* is evidence-gated (D7b — write-volume bottleneck),
which conflicted with the bare order. Resolved: an **explicit operator go-ahead** is a valid trigger
(the same escape hatch S1 carries), and the operator gave it — so M2 builds now, non-speculatively.

**This order is a standing authorization, not a menu.** For in-repo vtfkb development, this roadmap
*is* the decision — proceed through it in order **without per-step approval**. Do **not** ask "what's
next" or "M1 or M2"; the next action is whatever this section names. The decision points are the
**gates** listed per milestone in §3 (and the explicit triggers for S1/P1) — those, not "what's
next," are where judgment is applied.

**Stop and re-ratify the roadmap (don't just ask ad hoc) only when:**
1. a milestone **gate fails** (report the failure + proposed fix, then resume),
2. a **gated item trips** (a 2nd phrasing miss → S1; upstream hook fix → P1),
3. a **blocker or new fork appears** that this roadmap does not already decide.

In all three cases the response is the same: **update this roadmap and re-ratify it**, then continue
— never leave the next step to an ad-hoc question. (Scope: in-repo `vtfkb` only; vafi/vtaskforge
work stays out-of-scope/HITL per H2.)

### ▶ Current action — **Track 4b / D-ii: context-doc + `kb_context` (AUTONOMY CEILING — RFC + pause)** (scenario-first, ADR-0023) — *lower priority*
**Track 1 complete** (M1–M3; 87/87). **Track 5 complete** (2026-06-27): both dockerized substrates reproduce
their host baselines at N=3 (T5a pi `vtfkb-l4-pi:dev` 22/22; T5b claude `vtfkb-l4-claude:dev` 21/22 via
Max-subscription OAuth, no API key). **Track 4 core COMPLETE** (2026-06-27) — all 6 Track-1 scenarios, pi
28/28, claude 27/28 (`tool-gating` the known haiku divergence):
- `continuity-resume` (pi 3/3, claude 3/3) — surfaced + fixed a real ADR-0020 delivery gap (pi wasn't
  injecting the resume render; now does — full pi re-validation 23/23 on `sha256:bdd2dfd2…`).
- `resume-reflects-correction` (3/3, 3/3) — anti-stale across a session boundary.
- `kb-resume-mcp` (3/3, 2/3) — continuity on the MCP-pull floor via `kb_resume`.
- `auto-distill-recall` (3/3, 3/3) — the headline M2b→M3 loop; logged a pi live-capture-result gap.
- `distill-trust-label` (3/3, 3/3) — trust gradient distilled→CANDIDATE vs human→ESTABLISHED.
- `corroborated-promotion` (3/3, 3/3) — deterministic §4 gate; logged the promotion-trust-render finding.

**Track 4b** is scenario-first (ADR-0023). Contract-grounding the three partials *before* code split them:
`role-precedence` (§3.3) is **delivered** (rerank weights trust) — scenario done, pi/claude 3/3.
`verified-only-filter` (§3.6) and `kb-context-first-read` (§3.7) are **genuinely unbuilt** (no `verified`
query filter; no `kb_context`/context-doc) — RED contracts that need a build decision (see §3 Track-4b table).
None is Track-1-blocking. **Ratified follow-on order (operator, 2026-06-27)** — these were open decisions;
the operator chose D-i next, so they are now sequenced here (the roadmap, not an ad-hoc poll, carries the
order — §5 P8/roadmap-as-authority). Built scenario-first, lower priority than anything Track-1:
- **D-i — `✅ DONE` (2026-06-27)** built the `verified`/trust filter for `kb_search` (`verified` MCP param +
  `--verified` CLI + `verifiedOnly` in the engine, filters `provenance.status === 'verified'`; drop classified
  as `provenance` in the RFC-002 diagnosis). Scenario-first: `verified-only-filter` written + run RED on both
  harnesses (pi leaked both tokens; claude reported "no verified filter parameter") **before** the build, then
  green — pi 2/3, claude 2/3 (`__docker` records). +2 unit tests (89/89). No new ADR (in-scope for §3.6).
- **D-iii — `✅ DONE` (2026-06-27, ADR-0024 self-ratified — operator glance pending)** relabel trust on
  corroborated promotion so ADR-0021 §4's elevation is agent-visible. Built the decided shape:
  `promoteIfCorroborated` now also re-stamps `provenance.status = 'verified'` via a new metadata-only engine
  primitive `setProvenanceStatus` (text byte-identical → never-rewrite Brake intact), AND the distiller no
  longer bakes "(unverified)" into new candidate text (trust carried by the glyph, so a later relabel doesn't
  contradict the prose). Scenario-first: `promotion-relabel` (observed through D-i's `verified` filter — a
  promoted lesson enters the verified-only view, an unpromoted one stays excluded) written + run RED on both
  harnesses (promoted → `NONE`) **before** the build, then green — pi 2/3, claude 2/3. +2 unit assertions
  (90/90). The deterministic `corroborated-promotion` scenario stays as the §4 zone/refusal gate.
- **D-iv — `✅ DONE` (2026-06-27)** capture tool *results* on pi for live auto-distill. pi 0.73.1 exposes
  `ToolExecutionEndEvent { toolCallId, toolName, result, isError }` — wired `pi.on('tool_execution_end')` →
  `captureToolCall` WITH the result (correlating `tool_execution_start` args by `toolCallId` to keep the
  input; gating stays at `tool_call`, the pre-execution block). Scenario-first: `live-capture-result` run RED
  on pi (capture at `tool_call` had no result → classified ok → no candidate) **before** the wiring, then
  green — **pi 3/3**. Also fixed a latent claude capture bug: `hook post-tool-use` now reads Claude Code's
  `tool_response` field (it sends results there, NOT `tool_result`) — locked by `test/hook.test.ts` (92/92).
  **FINDING (external-blocked, like P1):** Claude Code's PostToolUse hook does **not fire on a FAILED tool
  call** (verified 2026-06-27 — a failing `cat` produced no hook payload; a successful one did), so live
  *failure*-capture is undeliverable on the claude harness. `live-capture-result` is therefore **harness-gated
  to pi** (skipped on claude; the gate is a runner feature). The `tool_response` fix still delivers live
  capture of *successful* tool results on claude.
- **D-ii — `[active]`, AUTONOMY CEILING** build the context-doc + `kb_context` feature (FEATURES §3.7 / D-O8).
  Genuinely new feature with real design choices (where the doc is authored, stored, seeded, rendered; authored
  vs assembled-from-derived; inject-vs-on-demand). **Procedure: draft the RFC, then PAUSE for operator review
  before any code** — this is the *one* designed stop in the autonomous run. (NB: STATUS §2 over-claims this as
  shipped — it is not; corrected there.)

**Findings logged this run (2026-06-27, in-repo Track-4b):**
1. **claude PostToolUse no-fire-on-failure** (above) — external-blocked; live failure-capture is pi-only.
2. **`tool-gating` is FLAKY on the current pi/model substrate** — gated arm (brain-write block) holds only
   intermittently (pre-D-iv image 1/3, D-iv image 0/3; the gate *does* fire — one trial passed "brain
   intact"). The gate code is unchanged and the A/B confirms it is **NOT** a D-iv regression. Likely the pi
   write reaches `/brain` by a path the `tool_call` gate doesn't see, or the block return isn't always
   honored by pi 0.73.1. **Guardrail integrity issue — needs its own investigation (re-ratify before fixing).**

> **Autonomy boundary (for an unattended run):** D-i → D-iii → D-iv proceed without operator input (shapes
> pre-decided above; D-iii self-ratifies a short ADR, flagged for a glance; D-iv verifies-then-builds-or-skips).
> The run **pauses at D-ii** by design — draft the RFC and bring it back. After D-ii, the in-repo H4 frontier
> is exhausted; S1/P1 stay gated (triggers in §4 / Track 2–3); H2/H3 are parked. No other stop is expected.

The two still-gated tracks are unchanged and NOT built on spec:
- **S1 (embedding reranker, RFC-003)** — build *only* on a **2nd** live phrasing-robustness miss **or** an
  explicit operator request. Keep the `selectIndex()` seam warm; nothing else.
- **P1 (Claude Code per-turn push, ADR-0015 Tier C)** — **external-blocked**; watch upstream `UserPromptSubmit`
  hook bugs, build (a new ADR) only when fixed.

(H2 fleet/ingest + H3 global tier remain parked, out of scope for in-repo work.)

*Milestones for the record:* **M1** = derived append-only continuity record + resume render (6/6 DoD).
**M2a** = curator deltas-only ops + the structural Brake (text byte-identical) + retrieval-quality
regression. **M2b** = deterministic distiller (failure→candidate gotcha, `incoming`-only containment Brake)
+ append-only counter stream (aggregated at read) + corroborated promotion (`promoteIfCorroborated`);
capture now retains a bounded ok/error outcome. **M3** = the resume digest folds the session's auto-distilled
`incoming` lessons in, trust-labelled + derived (anti-stale holds). All dogfooded on vtfkb's own brain; each
behind an accepted ADR (0020 / 0021).

---

## 5. Standing principles (what keeps it coherent)

These are the invariants every item above must honour — they are *why* the plan hangs together:

1. **Decisions before code.** Every build sits behind an Accepted ADR (ADR-0001/0004/0007). An RFC
   decides the *shape*; the build is mechanical once accepted ("runbook complete before execute").
2. **Evidence-gated, never speculative.** Gated items (S1) stay gated until real evidence or an
   explicit ask. Deciding the shape early ≠ building early.
3. **Dogfood each enhancement on vtfkb's own brain** (ADR-0019) before claiming it works.
4. **Deterministic backstop > probabilistic gate** (P2). Every probabilistic check (LLM, L4) gets a
   deterministic unit/wire-level backstop; that backstop is the real gate.
5. **Derived-not-dictated; deltas-not-rewrites; no native dep on the hot path.** The three standing
   constraints behind ADR-0020, M2, and ADR-0013 respectively.
6. **Verified vs asserted.** Report observed-vs-asserted in artifacts and status; a stale assertion
   outliving the truth is the failure ADR-0020 exists to kill (2026-06-25 stale-L4 incident).
7. **One build in flight; report the diff before merging.** No overlapping long runs; surface what a
   change does (and whether it deploys/triggers) before landing it.
8. **Scenario-contract-first for agent-observable behaviour** ([ADR-0023](adr/ADR-0023-scenario-contract-first.md)).
   The L4 purpose-demonstration scenario is part of the DoD — named in the ADR/RFC, written as a contract, and
   run **RED before implementation** (a red run proves it exercises the real path *on every harness*). The
   deterministic unit test stays the fast inner gate (P2); the scenario is the once-per-feature purpose gate.
   Structural invariants get **no** scenario — they stay unit tests (ADR-0022 #7). This is the process the
   2026-06-27 Track-4 build's three after-the-fact delivery findings argue for.

---

## 6. Provenance
Grounded in [STATUS-AND-ROADMAP](STATUS-AND-ROADMAP.md) §3–4, [DESIGN](DESIGN.md) (D1 seam, D7b),
[IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md) (L12 deltas-not-rewrites), ADRs
0001/0004/0005/0011/0012/0013/0014/0015/0016/0017/0018/0019/0020/0021/**0022**/**0023**, RFC-003/005/006, and the
2026-06-25 session (L4-eval ground-truthing, ADR-0019 build, check-6 hardening, RFC-005 acceptance →
ADR-0020, M1 build `ff61215`, RFC-006 → ADR-0021 + M2a curator `ee45289`).
**2026-06-27 re-ratification:** the L4 coverage audit (Track 1 had unit backstops but no L4 demonstration;
the host harness is non-reproducible + leak-controlled by denylist + had no ADR of record) → new
[ADR-0022](adr/ADR-0022-l4-evaluation-methodology.md) (dockerized, reproducible, multi-trial, contrast-
preserving, dual-harness) + **Track 5** (dockerized substrate) → **Track 4** (Track-1 L4 scenarios). Driver
+ sequencing forks settled by the operator this session; grounded additionally in mykb's `scripts/spike/`
kb-spike container harness (patterns borrowed, the `vfa` dependency rejected) and the host-harness
leak-control comments (`scenarios/l4-purpose.mjs` lines 94–102).
