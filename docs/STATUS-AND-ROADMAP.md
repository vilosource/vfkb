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
Caveats **[verified]**: (a) the records are against older shas, not HEAD; (b) one
scenario — `guardrail:tool-gating` — is undemonstrated on 4/5 records.

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

### H0 — Close v1 cleanly *(cheap, low-risk, do anytime)*
Make "v1 done" *provable*, not asserted.
- Refresh the L4 matrix against HEAD; **demonstrate `guardrail:tool-gating`** on the
  Claude harness or formally accept it as a Pi-only/hook-limited gap with rationale.
- Secondary findings from the live turn: a guard against **corpus self-pollution**
  (PostToolUse capturing `Tool … invoked` as facts), and **de-dupe** seeded entries.
- Correct the "BM25-lite" comment (it is unnormalized term-overlap).

### H1 — Ratify the next milestone *(the gating move — design only, no code)*
**This is the single most load-bearing step, and it is the answer to "what do we work
on next."** vtfkb's downstream value (the whole Ingest Cycle) is blocked on a design
that is still **[provisional]**:
- Promote `vfsf-ingest-and-vtfkb-DESIGN.md` from **BRAINSTORMING → a FINAL, ratified
  design** (it explicitly "authorizes no implementation" today).
- **Reconcile it with the locked ADRs** — it is *stale*: it still assumes **Python**
  and an undecided dir name, both settled since (TypeScript, ADR-0002/0003). Every
  "(provisional)" decision in its §11 must be re-walked against ADR-0011…0016.
- Resolve its open forks (§8): global-tier transport (git-repo vs served-API),
  project-context shape (typed entries vs single evolving doc), the project schema
  fields, per-branch vs canonical brain sync + the architect-on-`main` review gate.

### H2 — Ingest integration *(the critical path to platform value — needs H1)*
vtfkb is "the substrate the ingest agents stand on." Wire it in:
- **#1 Project onboarding** — greenfield wizard / brownfield `/init` writes the project
  context doc + brain skeleton (needs the H1 project schema, the #1↔#2 contract).
- **#2 Live-fleet wiring** — `kb` binary in the agent image + MCP registration in the
  architect pod **and** the controller's executor/judge path; per-entry role
  attribution + vtf task-ID linkage. *Asset: the merged **devops-kb spike** already
  dogfooded exactly this containerization (image + MCP + session hooks + role gate) —
  reuse it.*
- **Methodologies** — architect structured-capture (JTBD→domain→spec-by-example),
  executor read-brain/append-gotchas, judge record-review-knowledge.

### H3 — Global served tier *(Product #4 proper — after H2 proves per-project)*
The vtfkb-served global instance (REST + MCP + web UI), project→global gated
promotion, and the Context Map Glossary/Routing layers. Same engine, new service.

### H4 — Robustness & quality enhancements *(evidence-gated, parallelizable)*
Embedding reranker (when phrasing-robustness is needed — ADR-0016 G1), ACE
curator/auto-distill, per-turn CC injection parity, session-continuity tier.

---

## 5. Critical path & the first step

```
H1 (ratify ingest design)  ──►  H2 (onboarding + fleet wiring)  ──►  H3 (global tier)
        ▲                                                              ▲
   blocks everything                                              needs H2 proof
        │
   H0 (close v1 cleanly) and H4 (enhancements) run independently, anytime
```

**First step: H1.** Not a code task — a *design ratification*. Until the ingest design
is FINAL and reconciled with the TS ADRs, H2/H3 cannot be sequenced honestly, and the
"loose tracks" problem (no parent milestone) recurs. Everything else is either cheap
cleanup (H0) or evidence-gated enhancement (H4).

---

## 6. Open decisions blocking H1 (operator calls)

1. **Global-tier transport** — git-repo-as-system-of-record vs a vtf-served API. (Forks the whole global tier.)
2. **Project-context shape** — discrete typed entries (mykb model) vs a single evolving doc.
3. **Project schema** — the exact fields of the onboarding→ingest contract.
4. **Brain sync model** — per-branch vs canonical `main`, and the architect-write review gate.
5. **Confirm reconciliation** — accept that the ingest design's Python/dir-name assumptions are superseded by ADR-0002/0003.

---

## 7. Provenance
Grounded against: the platform strategy + research roadmap, `docs/DESIGN.md`,
`docs/FEATURES.md`, `docs/IMPLEMENTATION-PLAN.md`, `docs/adr/` (0001–0016),
`vfsf-ingest-and-vtfkb-DESIGN.md` (brainstorming), and the verified 2026-06-06
devops-kb live dogfood. Status/verification facts are observed this session; the
ingest-cycle framing is brainstorming-grade until H1.
