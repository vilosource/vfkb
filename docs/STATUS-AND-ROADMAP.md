# vtfkb — Status & Roadmap

> **Type:** living north-star (status + sequenced roadmap). **Updated:** 2026-06-28.
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

## 2. Status — what is true today **[verified 2026-06-25; fully refreshed 2026-06-28 — Track 4b complete]**

> For the *current* in-repo frontier and the live build order, **[H4-DEVELOPMENT-ROADMAP](H4-DEVELOPMENT-ROADMAP.md)
> is the authority** (this north-star is refreshed less often). As of 2026-06-28: Track 1 ✅, Track 5
> (dockerized L4 substrate) ✅, Track 4 core ✅ (6 Track-1 L4 scenarios), and **Track 4b COMPLETE** —
> D-i `verified`-filter, D-iii relabel-on-promotion (ADR-0024), D-iv pi live-capture, D-ii context-doc +
> `kb_context` (ADR-0025) all shipped. ADR-0022/0023/0024/0025 ratified. **The in-repo H4 frontier is
> EXHAUSTED** (only S1/P1 remain, gated).

**v1 (the per-project tier) is built, green, hardened by a live dogfood, and now self-hosting; the H4 frontier on top of it is complete.**

- Repo `vilosource/vtfkb` `main` @ `0e75823`; package `0.1.0`; `tsc` clean; **95/95 tests**.
- Greenfield **TypeScript**, mykb as a studied oracle (ADR-0002/0003) — zero code inheritance.
- IMPLEMENTATION-PLAN Phases 0–6 delivered.
- **Decisions ADR-0001–0023** ratified; **RFC-001–006** drafted (001/002/004/005/006 accepted;
  003 proposed + evidence-gated). vtfkb now **dogfoods its own brain** (ADR-0019).

### Feature surface shipped (per-project tier)
| Capability | Notes |
|---|---|
| 5 entry types (fact/decision/gotcha/pattern/link) | RFC/constitution/vision via status/flag/tag, not new types (ADR-0007/0008/0010) |
| Rich envelope | validity window + structured provenance origin; trust **derived** from role (ADR-0011) |
| Storage | append-only JSONL (source of truth) + `merge=union`; tombstones; deterministic rebuild |
| Index | pure-JS in-memory default; SQLite/FTS5 optional, graceful-degrade (ADR-0013); content-hash freshness, never mtime (ADR-0014) |
| Decision family | immutable, supersede-only; ADR ordinal stamped at merge-to-`main` (ADR-0004/0009) |
| Read/retrieval | two-stage; **relevance-primary** + light stemming (ADR-0016) + distinct-term **relevance floor** (ADR-0017) + cause-distinguished **honest no-match** (ADR-0018) |
| MCP server | 9 scoped tools (`kb_add`/`kb_get`/`kb_list`/`kb_map`/`kb_context`/`kb_search`/`kb_supersede`/`kb_transition`/`kb_resume`) — the cross-harness pull baseline (deterministic `tools/list` backstop) |
| Auto-layer faces | Pi in-process extension **and** Claude Code hooks; session-start injection (Tier A, 10k budget, ADR-0015) |
| Guardrails | no-secrets write-time lint; Bash mutation tool-gating |
| Session continuity | append-only per-session record + derived **resume render** (`resume`/`resume-note` CLI + `kb_resume`); auto-distill → trust-labelled lessons in the digest (ADR-0020/0021) |
| Project context doc | **SHIPPED 2026-06-28** (Track-4b D-ii / ADR-0025 ← RFC-007): the assembled per-project **context document** — authored spine (`<brain>/context.md`) + derived Constitution/Map/decisions — read on demand via the `kb_context` MCP tool + CLI `vtfkb context` (FEATURES §3.7 / D-O8). `kb-context-first-read` pi/claude 3/3 |
| Self-hosted design-brain | vtfkb dogfoods its own per-project tier — committed `.vtfkb/` (ADR-0019): ADR/RFC link-index + native gotchas/patterns |

### Acceptance (L4)
**Current coverage = the dockerized Track 4 / 4b records (ADR-0022)** — reproducible, N=3,
dual-harness; `scenarios/records/{deepseek-v4-pro,claude-haiku-4-5}__docker.{json,md}` (≈33
scenarios each, the Track-1 + Track-4b purpose-demonstrations). The earlier **v1 acceptance**
was 5 host records of 22 scenarios (deepseek-v4-pro 22/22; rest 20–21/22). Caveat
**[updated 2026-06-28]**: `guardrail:tool-gating`'s **path-matching is deterministically
backstopped** (`gating.ts:isBrainWrite` + `guardrails.test.ts`), but the **live block
*enforcement* is FLAKY on the current pi 0.73.1 substrate** — the gated arm holds only
intermittently (the block fires some trials, not all; A/B-confirmed it is not a code
regression). This is a genuine **guardrail-integrity finding**, not mere model-quirk — see
[H4-DEVELOPMENT-ROADMAP](H4-DEVELOPMENT-ROADMAP.md) §4 findings; needs its own investigation.
Every engine behavior is unit-tested at HEAD (**95/95**).

### Hardening — 2026-06-06 (the dogfood that found the search bug) **[verified 2026-06-06]**
- The **devops-kb live dogfood** (vtfkb as a real DevOps agent's operating memory)
  exposed a v1 retrieval bug: `query()` reused the *injection* reranker for explicit
  *search*, discarding relevance → a held answer buried ~rank 90 → the agent gave a
  confident **wrong** answer. Fixed (relevance-primary + stemming; `2acad3e`/`f28f107`),
  regression-guarded, and **ADR-0016** records it.
- The Phase-3 "retrieval-quality gate" had passed only because its fixtures were too
  small to expose scale ranking — now closed by a scale regression test.
- **Claude-face live turn is now fully observed green** (gate ✓ injection ✓ recall ✓);
  the agent recalled the seeded gotcha on its first natural query and cited it by id.

### Since 2026-06-06 **[verified 2026-06-25]**
- **Search hardened further:** relevance **floor** (ADR-0017, RFC-001) drops 1-of-many
  noise; **honest no-match** (ADR-0018, RFC-002) reports `empty_topic`/`no_match`/`all_filtered`.
- **Self-hosted design-brain (ADR-0019, RFC-004):** vtfkb commits its own `.vtfkb/` and
  dogfoods the per-project tier on itself; ADRs stay markdown SoR, the brain links to them.
- **Dogfood check-6 flake hardened:** deterministic in-image `tools/list` preflight (6a) +
  bounded LLM retry (6b) — proven green on host and in the `vtfkb-dogfood` image.
- **Session-continuity Phase A shipped (ADR-0020, RFC-005; M1 `ff61215`):** the derived,
  append-only continuity record (`resume`/`resume-note`/`kb_resume`) — proven it **cannot go stale**.
- **Auto-distill / ACE — RFC-006 → ADR-0021; M2a + M2b shipped:** M2a (`ee45289`) = the ACE curator
  safety foundation (delta-only ops + never-rewrite Brake + quality regression); **M2b** = the deterministic
  distiller (a captured failure → a candidate gotcha, `incoming`-only **containment Brake**) + the append-only
  counter stream (aggregated at read) + **corroborated promotion** (auto-distill alone can't mint trusted
  knowledge).
- **Session-continuity Phase B shipped (M3):** the resume digest now folds the session's auto-distilled
  `incoming` lessons in — **trust-labelled** (`⚠agent`, "verify before trusting") with corroboration counts,
  and **derived** so it can't go stale (a promoted/archived lesson drops out on the next render). This
  closes **Track 1 — "memory that carries itself" — end-to-end.**
- **L4 confirmed complete** (the earlier "16/22 in-progress" was a stale status line, now
  corrected — itself the motivating evidence for ADR-0020).

---

## 3. What v1 deliberately did NOT build (deferred, but designed)

| Deferred item | Where designed | Trigger to build |
|---|---|---|
| Global served "Viloforge KB" tier (REST+MCP+web UI) + project→global promotion | DESIGN D2a/D2f/D2g | after per-project integration proves out (§4 H3) |
| Context Map Glossary + Routing Table | ADR-0006 | with the global tier |
| Embedding/semantic reranker | ADR-0012/0016 → **RFC-003 (shape locked, Proposed)** | **evidence-gated**: build on a 2nd live phrasing miss or explicit request — not on spec |
| ACE curator / auto-distill capture | DESIGN D7b → **RFC-006 → ADR-0021** | **M2a + M2b shipped** (curator + Brake; distiller incoming-only + counters + corroborated promotion); deltas-not-rewrites (IMPL-PLAN L12) |
| Per-turn injection parity on Claude Code (Tier C) | ADR-0015 | **external-blocked**: Pi-only today; build when upstream `UserPromptSubmit` bugs are fixed |
| Distinct RFC/constitution entry types | ADR-0007/0008 | only if the marker model proves insufficient |
| Fully-onboarded project schema (the #1↔#2 contract) | DESIGN §6 / separate doc | parked with H2 (fleet/ingest) |
| Session-continuity record | **ADR-0020 / RFC-005 (Accepted)** | **DONE** — Phase A (M1 `ff61215`) + Phase B (M3: resume digest folds distilled lessons, trust-labelled, derived) |

---

## 4. Roadmap — sequenced by unresolved-risk, gated

> Design-first discipline: sequence by hardest *unknown*, not by ease. v1 (the proven
> mykb-shaped core) is done; the unknowns are now downstream — in **integration** and
> in a **ratified next design**.

### H0 — Close v1 cleanly *(DONE — 2026-06-25)*
Make "v1 done" *provable*, not asserted.
- ✅ **`tool-gating`** — closed without a paid rerun: it's deterministically unit-tested
  (see §2 Acceptance). Full L4 refresh deferred as low-value (every behavior unit-tested
  at HEAD).
- ✅ **Corpus self-pollution** — fixed (`31f4266`): Tier-B capture now skips vtfkb's own
  `kb_*`/`mcp__vtfkb__*` tools; regression-tested.
- ✅ **"BM25-lite" comments** — corrected to "stemmed term-overlap (no IDF/length-norm)".
- ✅ **Self-hosted design-brain** (ADR-0019) — vtfkb commits its own `.vtfkb/` and dogfoods
  the per-project tier on itself.
- ✅ **Dogfood check-6 flake** — hardened (deterministic `tools/list` preflight + bounded
  LLM retry), proven in-image.
- ✅ **L4 eval confirmed complete** — the "in-progress" was a stale status line, now corrected.
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
> session-continuity **Phase A shipped** (ADR-0020, M1 `ff61215`), auto-distill/ACE **accepted**
> (RFC-006 → ADR-0021) with **M2a + M2b shipped** (`ee45289` + distiller/counters/corroborated promotion).
> **M3 shipped** (resume digest folds the auto-distilled lessons in) — **Track 1 (memory that carries
> itself) is complete.** Remaining items are gated/blocked only: embedding reranker (RFC-003) stays
> evidence-gated; Claude Code per-turn parity stays upstream-blocked.

---

## 5. Critical path & the first step

```
   IN SCOPE (vtfkb repo)            │   OUT OF SCOPE for now (vafi / vtaskforge)
   H0 (close v1 cleanly)            │   H2 (fleet + ingest integration)
   H4 (enhancements)               ─┼─► picked up when fleet integration is in scope
   H3 design-readiness (in-repo)    │   (design is locked + ready; build is parked)
```

**Active frontier: H4 — in-repo.** H0 is **closed** (§4); H1 (reconcile) is ~done; H2
(fleet/ingest integration into vafi+vtaskforge) and H3 (global tier) stay **parked** —
H2's one vtfkb-side prerequisite (`VTFKB_ROLE` attribution) already shipped (`860cab8`).
So the active vtfkb work is **H4, sequenced in
[H4-DEVELOPMENT-ROADMAP](H4-DEVELOPMENT-ROADMAP.md)**: **Track 1 (continuity → auto-distill) is complete**
(M1 + M2a + M2b + M3 shipped); the only remaining items — the embedding reranker (RFC-003) and Claude Code
per-turn parity — stay gated/blocked and are not built on spec.

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
`docs/FEATURES.md`, `docs/IMPLEMENTATION-PLAN.md`, `docs/H4-DEVELOPMENT-ROADMAP.md`,
`docs/adr/` (0001–0025) + `docs/rfc/` (001–007), the locked
`project-onboarding-schema-DESIGN.md` (D-O1–O8) + `IngestEngine/*` (2026-04-05),
`vfsf-ingest-and-vtfkb-DESIGN.md` (superseded brainstorm), the verified vafi/vtaskforge
current state, and the 2026-06-06 devops-kb live dogfood. The §7 ledger reflects a
four-reader reconciliation done 2026-06-06; the §2 status / §4 horizon facts are
observed on 2026-06-28 (`main` @ `0e75823`, 95/95 green; Track 4b complete, H4 frontier exhausted).
