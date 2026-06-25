# vtfkb — Status & Roadmap

> **Type:** living north-star (status + sequenced roadmap). **Updated:** 2026-06-06.
> This is the *middle* layer of the doc stack — the one you stand on day-to-day:
> **platform strategy** (`viloforge-product-strategy-STRATEGY.md`, top) → **this doc**
> → **decisions** (`docs/adr/`, immutable) + **build plan** (`docs/IMPLEMENTATION-PLAN.md`).
> It is *not* a decision record: when it sequences work it proposes; ADRs ratify.
> Claims are tagged **[verified <date>]** (observed this session), **[designed]**
> (locked in an ADR/DESIGN), or **[provisional]** (brainstorming-grade, not ratified).

---

## 1. Where vtfkb sits (the one-paragraph north-star)

vtfkb is two things at once:

1. **The engine for Product #4 — "Viloforge KB" (Organizational Memory)** — one of the
   four ViloForge products (IngestEngine · ExecutionEngine · VAFI · **Viloforge KB**).
   v1 ships the **per-project tier only**; the global served tier *is* Product #4
   proper and is designed-now-built-later (DESIGN D2a/D2g). **[designed]**
2. **The shared memory the other three products' agents stand on.** Per the platform
   strategy flywheel: *KB feeds IngestEngine (the PM/architect have domain context) →
   IngestEngine feeds ExecutionEngine (high-quality specs) → ExecutionEngine feeds KB
   back (decisions/gotchas extracted) → KB feeds the next session.* The factory's
   output quality **compounds instead of resetting to generic every task.** **[designed]**

> One line (FEATURES §1): *vtfkb turns one-shot agents into a team with a memory.*

This matters because the platform's proven bottleneck is **spec quality, not executor
sophistication** (97.6% first-attempt with precise specs vs 81% without). Spec quality
comes from context; context is what vtfkb supplies. vtfkb is the front-half lever.

---

## 2. Status — what is true today **[verified 2026-06-06]**

**v1 (the per-project tier) is built, green, and now hardened by a live dogfood.**

- Repo `vilosource/vtfkb` `main` @ `bd90217`; package `0.1.0`; `tsc` clean; **52/52 tests**.
- Greenfield **TypeScript**, mykb as a studied oracle (ADR-0002/0003) — zero code inheritance.
- IMPLEMENTATION-PLAN Phases 0–6 delivered.

### Feature surface shipped (per-project tier)
| Capability | Notes |
|---|---|
| 5 entry types (fact/decision/gotcha/pattern/link) | RFC/constitution/vision via status/flag/tag, not new types (ADR-0007/0008/0010) |
| Rich envelope | validity window + structured provenance origin; trust **derived** from role (ADR-0011) |
| Storage | append-only JSONL (source of truth) + `merge=union`; tombstones; deterministic rebuild |
| Index | pure-JS in-memory default; SQLite/FTS5 optional, graceful-degrade (ADR-0013); content-hash freshness, never mtime (ADR-0014) |
| Decision family | immutable, supersede-only; ADR ordinal stamped at merge-to-`main` (ADR-0004/0009) |
| Read/retrieval | two-stage; **search now relevance-primary** + light stemming (ADR-0016, this session) |
| MCP server | ~11 scoped tools (`kb_search`/`kb_context`/`kb_add`/`kb_map`/…) — the cross-harness pull baseline |
| Auto-layer faces | Pi in-process extension **and** Claude Code hooks; session-start injection (Tier A, 10k budget, ADR-0015) |
| Guardrails | no-secrets write-time lint; Bash mutation tool-gating |
| Project context doc | first-class, `kb_context` |

### Acceptance (L4)
5 harness/model records, **20–22 of 22 scenarios demonstrated** (Pi + Claude Code).
Caveats **[verified]**: (a) the records are against older shas, not HEAD; (b) the one
L4-undemonstrated scenario — `guardrail:tool-gating` — is **deterministically
backstopped** by a unit test (`gating.ts:isBrainWrite` + `guardrails.test.ts`), so the
gap is a probabilistic-harness artifact, not a real hole (*deterministic backstop >
probabilistic gate*). A full paid L4 re-run against HEAD is therefore **deferred as
low-value**: every engine behavior the matrix exercises is unit-tested at HEAD (55/55).

### This session's hardening **[verified 2026-06-06]**
- The **devops-kb live dogfood** (vtfkb as a real DevOps agent's operating memory)
  exposed a v1 retrieval bug: `query()` reused the *injection* reranker for explicit
  *search*, discarding relevance → a held answer buried ~rank 90 → the agent gave a
  confident **wrong** answer. Fixed (relevance-primary + stemming; `2acad3e`/`f28f107`),
  regression-guarded, and **ADR-0016** records it.
- The Phase-3 "retrieval-quality gate" had passed only because its fixtures were too
  small to expose scale ranking — now closed by a scale regression test.
- **Claude-face live turn is now fully observed green** (gate ✓ injection ✓ recall ✓);
  the agent recalled the seeded gotcha on its first natural query and cited it by id.

---

## 3. What v1 deliberately did NOT build (deferred, but designed)

| Deferred item | Where designed | Trigger to build |
|---|---|---|
| Global served "Viloforge KB" tier (REST+MCP+web UI) + project→global promotion | DESIGN D2a/D2f/D2g | after per-project integration proves out (§4 H3) |
| Context Map Glossary + Routing Table | ADR-0006 | with the global tier |
| Embedding/semantic reranker | ADR-0012/0016 | **evidence-gated**: G1 passed → deferred as robustness; revisit when phrasing-robustness is needed |
| ACE curator / auto-distill capture | DESIGN D7b | when explicit-write volume becomes the bottleneck |
| Per-turn injection parity on Claude Code (Tier C) | ADR-0015 | Pi-only today; revisit when CC hooks allow |
| Distinct RFC/constitution entry types | ADR-0007/0008 | only if the marker model proves insufficient |
| Fully-onboarded project schema (the #1↔#2 contract) | DESIGN §6 / separate doc | **H1 (next), see below** |
| Session-continuity tier | open thread | unscoped |

---

## 4. Roadmap — sequenced by unresolved-risk, gated

> Design-first discipline: sequence by hardest *unknown*, not by ease. v1 (the proven
> mykb-shaped core) is done; the unknowns are now downstream — in **integration** and
> in a **ratified next design**.

### H0 — Close v1 cleanly *(mostly DONE 2026-06-06)*
Make "v1 done" *provable*, not asserted.
- ✅ **`tool-gating`** — closed without a paid rerun: it's deterministically unit-tested
  (see §2 Acceptance). Full L4 refresh deferred as low-value (every behavior unit-tested
  at HEAD).
- ✅ **Corpus self-pollution** — fixed (`31f4266`): Tier-B capture now skips vtfkb's own
  `kb_*`/`mcp__vtfkb__*` tools; regression-tested.
- ✅ **"BM25-lite" comments** — corrected to "stemmed term-overlap (no IDF/length-norm)".
- ⬜ **De-dupe seeded entries** — remaining, but it's *spike seed data* (the devops-kb
  `migrate-seed`), not vtfkb core; defer or handle in the spike, not here.

### H1 — Reconcile the design set *(mostly DONE — see correction)*
**[corrected 2026-06-06 after deep grounding]** The earlier draft of this section
claimed the ingest design was still brainstorming-grade with 5 open forks. That was
**wrong** — it read the 2026-05-31 brainstorming doc's self-described forks without
checking they'd since been closed. Verified: **every fork is already resolved in newer
locked docs** (see §8 ledger). The ingest-cycle design is **ratified**, distributed
across `vtfkb-DESIGN` (D1–D7), `project-onboarding-schema-DESIGN` (D-O1–O8, the #1↔#2
contract), `IngestEngine/*` (the pipeline), and ADRs 0001–0016.

H1's *real*, much smaller residue:
- **Supersede the stale brainstorming doc** (`vfsf-ingest-and-vtfkb-DESIGN.md`) — point
  it at the locked set; flag that its "Python" is superseded by TypeScript (ADR-0002/0003).
  *(done this session — banner added.)*
- **Index the locked set** into one coherent map so it's navigable as a whole (§8).
- **Genuinely-open design residue** (small): the kb-**write** methodology specifics
  (how architect/executor/judge *capture* into vtfkb — the execution-side `architect.md`/
  `executor.md`/`judge.md` already exist in vafi but don't write knowledge yet).

### H2 — Ingest integration *(OUT OF SCOPE for current vtfkb development — 2026-06-06)*
> **Scope note (2026-06-06):** integration into **vafi / vtaskforge is out of scope for
> vtfkb development at this time.** vtfkb work stays inside the `vtfkb` repo. The plan
> below is kept as the *designed-and-ready* target for when fleet integration is picked
> up; only the **vtfkb-side** residue (already done — see H2a step 1) belonged here.
> The active vtfkb frontier is **H0** + **H4** (both in-repo). Embedding `VTFKB_ROLE`
> attribution (the one vtfkb-side prerequisite) shipped (`860cab8`).

vtfkb is "the substrate the ingest agents stand on." The design is ready; the work is
implementation. Verified current state (2026-06-06): vafi has **zero** kb wiring (only
C4 diagrams reference it); vtaskforge has **zero** ingest models. So two tracks:

- **H2a — Wire vtfkb into the live fleet *(smallest, highest-leverage; do first)*.**
  The attachment points are known and narrow: add `vtfkb` alongside `vtf`/`cxdb` in
  `vafi/config/bridge-roles.yaml` (`mcp_tools`), thread `VF_VTFKB_MCP_URL`/token in
  `src/bridge/pi_session.py:build_pi_env`, and register it in both faces via
  `images/agent/entrypoint.sh` + `pi_config.py`. Seed the brain at onboarding;
  per-entry role attribution + vtf task-ID linkage. *Asset: the merged **devops-kb
  spike** already dogfooded exactly this (image + MCP + session hooks + role gate).*
- **H2b — Onboarding + ingest engine *(larger; designed-not-built)*.** Build project
  `/init` (the locked `project-onboarding-schema-DESIGN` D-O1–O8: `onboarding_status`
  draft→onboarding→ready, the human ready-gate D-O6, seed `author.role=init` + the
  D-O8 context-doc skeleton) and the IngestEngine pipeline (designed 2026-04-05:
  Full/Standard/Express, Pre-Architect + Pre-Execution gates, PM elicitation). This is
  where the *missing front half* gets built; it spans vtaskforge + vafi, not just vtfkb.
- **Methodology residue (the H1 leftover):** teach architect/executor/judge to *write*
  knowledge (read-brain + append-gotchas + record-review), extending vafi's existing
  `methodologies/*.md`.

### H3 — Global served tier *(Product #4 proper — after H2 proves per-project)*
The vtfkb-served global instance (REST + MCP + web UI), project→global gated
promotion, and the Context Map Glossary/Routing layers. Same engine, new service.

### H4 — Robustness & quality enhancements *(evidence-gated, parallelizable)*
Embedding reranker (when phrasing-robustness is needed — ADR-0016 G1), ACE
curator/auto-distill, per-turn CC injection parity, session-continuity tier.

> **Sequenced in [H4-DEVELOPMENT-ROADMAP](H4-DEVELOPMENT-ROADMAP.md) (2026-06-25).** Progress since
> this doc: search hardened (ADR-0017/0018), self-hosted design-brain shipped (ADR-0019),
> session-continuity **accepted** (ADR-0020 / RFC-005, build next). Build order: continuity Phase A
> → RFC-006 for auto-distill/ACE → that build → continuity Phase B; embedding reranker (RFC-003)
> stays evidence-gated; Claude Code per-turn parity stays upstream-blocked.

---

## 5. Critical path & the first step

```
   IN SCOPE (vtfkb repo)            │   OUT OF SCOPE for now (vafi / vtaskforge)
   H0 (close v1 cleanly)            │   H2 (fleet + ingest integration)
   H4 (enhancements)               ─┼─► picked up when fleet integration is in scope
   H3 design-readiness (in-repo)    │   (design is locked + ready; build is parked)
```

**Active frontier: H0 and H4 — both in-repo.** H1 (reconcile) is ~done; H2 (fleet/ingest
integration into vafi+vtaskforge) is **out of scope for current vtfkb development**
(2026-06-06) — its one vtfkb-side prerequisite (`VTFKB_ROLE` attribution) already shipped.
So the next concrete vtfkb work is the cheap, low-risk **H0** cleanups (L4 refresh +
`tool-gating`, corpus self-pollution guard, dedup seeds) and, as wanted, **H4**
enhancements (e.g. the ADR-0016 embedding reranker when phrasing-robustness is needed).

---

## 6. Open decisions — RESOLVED (the earlier "5 forks" were stale)

The earlier draft listed 5 "open decisions blocking H1." Deep grounding (2026-06-06)
found **all are already settled** in newer locked docs — they were the *brainstorming
doc's* forks, closed since by `vtfkb-DESIGN` D1–D7 and `project-onboarding-schema-DESIGN`:

| Was-listed-as-open | Actually |
|---|---|
| Global-tier transport (git vs API) | **Resolved** — DESIGN D2b: per-project git-local; global = git SoR + vtfkb-served REST/MCP/web UI (deferred to H3) |
| Project-context shape | **Resolved** — DESIGN D3c: 5 entry types; the context doc is first-class (not a type); requirements are vtf-side |
| Project schema fields | **Locked** — `project-onboarding-schema-DESIGN` C1–C6 / D-O1–O8 |
| Brain sync + review gate | **Resolved** — DESIGN D4b/D4e: architect→`main` (pull-rebase); review only at global promotion |
| Python/dir-name | **Settled** — TypeScript (ADR-0002/0003); `.vtfkb/` (D2c) |

**No design decision is blocking.** The only genuinely-open *design* residue is the
kb-write methodology (H1 leftover, folded into H2). Everything else is build.

---

## 7. Ingest-cycle design ledger (the locked set H1 indexes)

| Stage / concern | Authoritative source | Status | Build |
|---|---|---|---|
| vtfkb engine (per-project tier) | `vtfkb-DESIGN` D1–D7 + ADRs 0001–0016 | locked | ✅ v1 built |
| Entry schema / envelope | ADR-0011 + DESIGN D3 | locked | ✅ built |
| #1↔#2 onboarding contract | `project-onboarding-schema-DESIGN` C1–C6 / D-O1–O8 | locked | ❌ unbuilt |
| Project `/init` (greenfield + brownfield) | same (D-O2 state machine, D-O6 ready-gate) | locked | ❌ unbuilt |
| Ingest pipeline (Full/Standard/Express) | `IngestEngine/pipeline-paths-DESIGN` | designed (2026-04-05) | ❌ unbuilt (vtaskforge has 0 ingest models) |
| Gates (Pre-Architect, Pre-Execution) | `IngestEngine/gates-DESIGN` | designed | ❌ unbuilt |
| PM elicitation (JTBD→DDD→spec→validate) | `IngestEngine/pm-elicitation-DESIGN` | designed | ❌ unbuilt |
| Architect decomposition → SDD specs | `IngestEngine/architect-decomposition-DESIGN` | designed | ⚠️ architect pod exists; SDD spec is free-form markdown today |
| Fleet kb wiring (MCP register, seed, attribution) | this doc H2a + the devops-kb spike | — | ❌ unbuilt (0 today) |
| kb-write methodology | (open residue) | partial | ❌ vafi `methodologies/*.md` exist but don't write knowledge |
| Global served tier | DESIGN D2a/D2b/D2g, ADR-0006 | locked | ❌ deferred (H3) |

> **`vfsf-ingest-and-vtfkb-DESIGN.md` is superseded** by the rows above; it remains as
> the originating brainstorm only. Its "Python" assumption is void (TypeScript).

---

## 8. Provenance
Grounded against: the platform strategy + research roadmap, `docs/DESIGN.md`,
`docs/FEATURES.md`, `docs/IMPLEMENTATION-PLAN.md`, `docs/adr/` (0001–0016),
the locked `project-onboarding-schema-DESIGN.md` (D-O1–O8) + `IngestEngine/*`
(2026-04-05), `vfsf-ingest-and-vtfkb-DESIGN.md` (superseded brainstorm), the
verified vafi/vtaskforge current state, and the 2026-06-06 devops-kb live dogfood.
The §7 ledger reflects a four-reader reconciliation done 2026-06-06; status/
verification facts are observed this session.
