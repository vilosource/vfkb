# vfkb — Implementation Plan (v1, per-project tier)

> **STATUS: HISTORICAL — v1 DELIVERED (Phases 0–6, shipped 2026-06-25).** This is the
> build plan as authored (2026-06-01; §3 gate cleared 2026-06-03); all phases were
> delivered. For live state see [STATUS-AND-ROADMAP.md](STATUS-AND-ROADMAP.md) and
> [H4-DEVELOPMENT-ROADMAP.md](H4-DEVELOPMENT-ROADMAP.md). Build sequence for vfkb v1,
> implementing the locked design ([`DESIGN.md`](DESIGN.md) D1–D7) and decisions
> [`adr/`](adr/) **ADR-0001…0015**. Greenfield **TypeScript**, **mykb as a studied
> spike** (ADR-0002) — zero code inheritance.
> Design-first: §3's five gating decisions (D-A…D-E) are now **all locked** as
> ADR-0011…0015 → **the pre-implementation gate is cleared; Phase 0 is next.**
> Grounded against the live mykb repo (`~/GitHub/mykb` @ develop) and a verified
> Claude Code hook-surface check (D-E, 2026-06-03).

---

## 1. Scope & build discipline

- **v1 scope = the per-project tier only** (D2g). Deferred: global served tier,
  Context Map Glossary/Routing (ADR-0006), ACE curator, embedding rerank, graph
  backend, distinct RFC/constitution types.
- **Greenfield reimplementation** (ADR-0002): mykb is a behavioural **oracle** we
  run side-by-side to validate against, never a code source.
- **Process (a direct mykb lesson):** mykb's v1 retro found **parallel build agents
  corrupted shared state** (a test file committed to develop, revert + conflicts).
  → vfkb builds in **strict sequential phases** (or true git-worktree isolation),
  each with a **gate script** that must be green before the next.
- **Testing pyramid** (mykb-proven shape): broad TS unit/integration base (per
  module, temp-brain isolated) → thin integration band → a small, high-signal **L4
  acceptance harness that asserts on observable external effects, not agent
  self-report** (the kb-spike equivalent), run against **both** harnesses.
- **Deployment spike BEFORE acceptance tests** (mykb's single hardest lesson: the
  *loading/deployment path was the real risk, not the logic* — 5 failed attempts to
  get Pi to load the extension; native `better-sqlite3` had to compile in-container).

---

## 2. Lessons from mykb (the spike) — the record ADR-0002 promised

Per major choice: what mykb did → what it taught → what vfkb does differently.

| # | mykb did | Taught | vfkb does |
|---|---|---|---|
| L1 | Entry had only `created`/`updated`; free-text provenance | Retrofitting temporal/trust was the **biggest v2 debt** | **Rich envelope from schema v1** — but *which* richness is a decision (§3, D-A) |
| L2 | Single-stage **area** word-overlap scoring; entries dumped in **load order** | Core retrieval-quality decay; "lost in the middle" | **Entry-level relevance, signal threaded through to selection** (rerank — §3, D-B) |
| L3 | Flat `- text #tags` render through one `renderEntryLine()` | **Stark FQDN incident** — AI used a stale hostname though the FQDN was in context; flat render + load-order budget dropped the *newest* (corrected) entry | **Structured, tier-specific rendering** (type/zone/provenance visible, patterns+gotchas first, composite entries); token estimate decoupled from render (ADR-0005/0006) |
| L4 | One global `.active` workspace pointer | **Concurrent sessions silently clobber** each other | **Per-session isolation via `KB_SESSION_ID`** from day one, under the brain dir (survives container restart), not `/tmp` |
| L5 | No auto-recall of recent work | **Recency injection dominates "feels like memory"** (pi-mem counter-example) | **Journal/recency auto-inject at session start** = a first-class D7a input |
| L6 | `better-sqlite3` native dep compiled in-container | Deployment pain; pi-mem shows 460 LOC no-native-dep works | **No hard native-dep coupling; a no-SQLite read path** (decision — §3, D-C) |
| L7 | Pi type stubs hand-written, **wrong** (`before_agent_start` params; `event.tool`) | Re-deriving harness contracts burned time; the `context` bug silently dropped injection for weeks | **Validate harness type stubs against the real harness; copy working spike patterns verbatim** |
| L8 | mtime-based index staleness | **git ops rewrite mtimes** → rebuild reliability risk | **Content-hash / explicit rebuild trigger**, not mtime (§3, D-D) |
| L9 | Auto-area-creation | **Area sprawl** (typos become permanent areas) | Per-project brain is **flat** (D2e) — sidesteps it; tag governance noted |
| **L10** | **Explicit non-decision: NO MCP server** (hooks + CLI + file exports only — kills an OWASP class) | Right for a **single-user, single-harness** tool | **vfkb DIVERGES: MCP *is* adopted** (D5a) — because the fleet is **multi-harness** (Pi + Claude Code) and MCP is the only common surface. The OWASP memory-poisoning concern mykb raised is instead mitigated by **tool-gating (D7c) + no-secrets lint (D6e) + trust gradient (D3d) + the injection filter (ADR-0005)**. *This is the one place vfkb deliberately does not follow mykb's lesson; the multi-harness premise changes the calculus.* |
| L11 | Manifest not regenerated on auto-create → empty Tier-1 | Index regen must be a **guaranteed side-effect** of any area-mutating write | Engine (sole writer, D4a) owns manifest/index regen invariantly |
| L12 | Curator rewrote whole entries | Move to **ACE deltas** (counters, patches) | Curation deferred; when built, **deltas not rewrites** (§7) |

**Carry forward (validated by mykb, keep):** JSONL = source of truth + disposable
SQLite/FTS5 mirror; one storage interface per concern (swappable backends);
**no auto-summarization of journals** (agent writes them explicitly — avoids OSB's
low-quality auto-summary); cheap frontmatter/manifest scan for indexing (no LLM);
bottom-up build order (types → storage → … → adapters).

---

## 3. Decisions this plan surfaced — ALL LOCKED (ADR-0011…0015, 2026-06-03)

The lessons exposed five decision-grade questions. All are now **locked as ADRs**
(walked one-by-one; D-A by operator pick, D-B…D-E by operator-delegated "find the
best solution" + a verified Claude Code hook-surface check for D-E). Per ADR-0001
the ADRs are the authoritative record; the summaries below point into them.

- **D-A — Entry envelope richness (gated Phase 1) → [ADR-0011](adr/ADR-0011-envelope-richness.md).**
  **LOCKED:** adopt the two *genuine* gaps — bi-temporal **validity window**
  (`valid_from`/`valid_until`, `recorded_invalid_at` stored-not-consumed) +
  structured **`provenance.origin`** union (commit/message/tool_call/manual);
  **derive** trust from `author.role`+`provenance.status` (no new field;
  `superseded_by` stays as `refs.supersedes`). v1 wires `valid_until` exclusion into
  ADR-0005 + commit/tool_call origin capture; defers audit queries + embeddings.
- **D-B — Retrieval: two-stage rerank (gated Phase 3) → [ADR-0012](adr/ADR-0012-two-stage-retrieval.md).**
  **LOCKED:** pluggable `EntryReranker` pipeline; ship Noop + **Heuristic (default)**;
  Stage-1 BM25 candidate-narrowing built but **pass-through at the flat/small
  per-project scale** (activates above a `candidate_k` threshold); Embedding reranker
  stubbed/deferred. Reranker = soft sort; ADR-0005 filter = hard gate (no duplicated
  exclusion).
- **D-C — Storage runtime: native-dep policy (gated Phase 1) → [ADR-0013](adr/ADR-0013-no-hard-native-dep.md).**
  **LOCKED:** **no hard native dependency.** Pluggable `Index`; v1 default = pure-JS
  in-memory (JSONL-scan + BM25), rebuilt in long-lived processes; `better-sqlite3`
  FTS5 is an **optional auto-detected backend**, graceful-degrade if absent. JSONL
  stays source of truth. Kills the four-image native-compile pain.
- **D-D — Index freshness trigger (gated Phase 1) → [ADR-0014](adr/ADR-0014-index-freshness.md).**
  **LOCKED:** **content-derived token + explicit rebuild, never mtime.** Regen is a
  guaranteed side-effect of every engine write (sole-writer, L11); readers compare
  the token and **rebuild-on-doubt** (cheap per ADR-0013).
- **D-E — Claude Code auto-layer feasibility (gated Phase 5) → [ADR-0015](adr/ADR-0015-cross-harness-auto-layer.md).**
  **LOCKED (evidence-based, hook surface verified 2026-06-03):** tiered parity —
  **Tier A** session-start injection (full parity, `SessionStart.additionalContext`,
  stable+cached); **Tier B** passive capture (full parity, `PostToolUse` reliable);
  **Tier C** per-turn signal-driven push **Pi-only** (Claude Code `UserPromptSubmit`
  documented-unreliable+cache-inefficient → degrades to MCP-pull). New constraint:
  session-start bundle budgeted to Claude Code's **10k-char** cap. Phase 0 spike
  **retained but narrowed** to attention/cache/budget (see §8).

---

## 4. Architecture — the TypeScript engine + faces

```
                ┌───────────────────────────── one TS engine ─────────────────────────────┐
  faces ▶       │  storage(JSONL+tombstones) · index(pure-JS default/FTS5 opt) · scoring/rerank ·│
                │  rendering(tiered) · entry-schema(envelope, decision family) · git(save/   │
                │  push/merge=union, adr_no-at-merge) · no-secrets lint · config/init        │
                └───────────────────────────────────────────────────────────────────────────┘
   MCP server (kb_* + kb_map)   |   thin CLI (humans/scripts/debug)   |   per-harness auto-layer
        cross-harness baseline  |                                     |   Pi: in-process TS extension
                                                                      |   Claude Code: hooks → engine CLI/MCP
```
Modules to reimplement (informed by mykb's `src/core` map, *not* copied): entry
schema/types, storage (append-only JSONL + tombstones), index + deterministic
rebuild, scoring/rerank, tiered render, config/init, manifest/area, git ops, save.

---

## 5. Phased build (sequential, TDD, each gated)

**Phase 0 — De-risk: deployment + cross-harness auto-layer spike** *(hardest unknown first)*
Prove the *path*, not the logic: source → bundle → container → **both** the Pi
extension and the Claude Code hooks load, and the brain is writable. D-E's hook
surface is already verified (ADR-0015); this spike is **narrowed** to the three
things the docs don't settle — **attention** (does the `SessionStart`
`<system-reminder>` block actually get *used* — assert by external effect, not
self-report), **cache cost** (session-start block over a long session), and
**budget fit** (the Tier-A bundle within Claude Code's 10k-char cap). *Gate:* a
trivial fact injected by the engine appears **and is used** in **both** harnesses; a
tool-call is captured in both; the bundle fits the cap. (Attacks mykb's L7/§1.)

**Phase 1 — Storage kernel** *(needs D-A, D-C, D-D)*
Entry envelope (decided schema: `id` nanoid · `type` · `text` · `tags` · `zone` ·
`author` · `refs` · `provenance{…,origin?}` · `validity{valid_from,valid_until?,
recorded_invalid_at?}` · `created`/`updated` — ADR-0011); append-only JSONL +
tombstones; deterministic rebuild (content-derived trigger, never mtime — ADR-0014);
**pure-JS in-memory index default, SQLite/FTS5 optional auto-detected backend**
(ADR-0013). *Gate:* round-trip + rebuild + merge=union union tests (concurrent
appends never conflict); zero-native-dep load.

**Phase 2 — Entry types + the decision family**
5 types (fact/decision/gotcha/pattern/link). Decision family
(decision/RFC/constitutional) **immutable, supersede-only + status lifecycle**
(ADR-0004/0007/0008); fluid types editable last-write-wins; `constitutional` flag
(ADR-0008); `vision`-tagged patterns (ADR-0010); **`adr_no` stamped at
merge-to-`main`** (ADR-0009). *Gate:* immutability/supersede tests; ordinal-at-merge
monotonicity; constitutional aggregation.

**Phase 3 — Read layer** *(needs D-B)*
Search (FTS5/BM25 + rerank per D-B); derived **`kb_map`** Context Map / Index-Topology
(ADR-0006); read filters `status`/`zone`/`type`/`tags`/`author.role` (D5c); tiered
structured rendering (L3). *Gate:* retrieval-quality tests incl. the Stark-FQDN
characterization (newest/corrected entry wins; stale excluded).

**Phase 4 — MCP server**
The ~10 tools + `kb_map`, tight surface (≤~10, scoped schemas — ASDLC MCP
discipline). *Gate:* protocol-level e2e (the test mykb never had).

**Phase 5 — Per-harness auto-layer (D7)** *(feasibility from Phase 0)*
Session-start injection = Context Map + Agent Constitution + `vision` patterns +
journal-recency (L5), cache-friendly; per-turn signal-driven deltas; **injection
filter** (ADR-0005: exclude superseded/deprecated/archived; inject unverified
labelled); passive capture; tool-gating (L10 mitigation); **session isolation via
`KB_SESSION_ID`** (L4). Pi = in-process TS extension; Claude Code = hooks. *Gate:*
L4 scenarios asserting injected facts appear, gating blocks brain edits, stale is
excluded — in **both** harnesses, asserting external effects.

**Phase 6 — Guardrails + git lifecycle**
No-secrets write-time lint (D6e); `save`/`saveAndPush`; promotion-to-global **stub**
(tier deferred). *Gate:* lint blocks a planted secret; save commits attributed by
role.

---

## 6. Testing strategy

Unit (per module, temp-brain) → integration → **L4 acceptance** (BATS/scenario
harness, both harnesses, external-effect assertions). **Characterization E2E before
any behaviour change** (house rule). Run mykb as an **oracle** for parity checks on
retrieval/injection where behaviour should match. Deployment (Phase 0) is tested
before acceptance.

---

## 7. Deferred (explicitly not v1, recorded so it isn't lost)

Global served "Viloforge KB" tier + promotion (D2f/D6d); Context Map **Glossary +
Routing Table** (ADR-0006); **ACE curator** (counters, deltas-not-rewrites, L12);
embedding reranker (D-B may stub it); graph/bi-temporal *backend* (envelope fields
may land in D-A, the backend does not); distinct RFC/constitution *types*
(ADR-0007/0008 revisit); D7b auto-distill capture depth.

---

## 8. Risks & spikes (front-loaded)

1. **Claude Code auto-layer parity (D-E)** — *largely resolved* by ADR-0015's
   verified hook-surface check: session-start inject (Tier A) + capture (Tier B) are
   parity-feasible; only per-turn *push* (Tier C) is Pi-only (Claude Code degrades to
   MCP-pull). Residual risk = the narrowed Phase 0 spike (attention/cache/budget).
2. **Deployment/loading path** — mykb's worst pain; Phase 0 owns it.
3. **merge=union + `adr_no`-at-merge** — verify the serialized-main assumption holds
   under the real origin-split write flow (D4b).
4. **Index freshness across git ops** (D-D) — content-hash beats mtime.
5. **Cross-provider injection behaviour** — mykb only validated on z.ai/GLM; verify
   `<vfkb-context>` lands on the production models (Claude, Pi's models).

---

## 9. Critical path & first step

vfkb is the **critical path** for the whole Ingest Cycle (onboarding #2 and ingest
#3 both depend on it). The Phase-1/3/5-gating decisions **D-A…D-E are now locked**
(ADR-0011…0015, 2026-06-03) → the pre-implementation gate is cleared. **First step:**
the **narrowed Phase 0 spike** (deployment + the ADR-0015 attention/cache/budget
questions). Phases 1–2 (storage kernel + decision family) are the lowest-risk,
mykb-proven core and proceed immediately after Phase 0.
