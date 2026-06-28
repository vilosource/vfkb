# vtfkb — Design

> **STATUS: IN-DESIGN (2026-05-31; revised 2026-06-01).** Focused design for the
> vtfkb knowledge substrate (foundation #3 of the VFSF Ingest Cycle). Builds on the
> provisional brainstorm [`vfsf-ingest-and-vtfkb-DESIGN.md`](vfsf-ingest-and-vtfkb-DESIGN.md).
> Decisions are recorded in §5 as they lock. Roadmap: `vtaskforge/docs/ROADMAP.md`.
>
> **2026-06-01 revision (operator):** D6a reversed **Python → TypeScript** and a
> new **D7 — automatic context-injection + passive capture (per-harness)** added
> as a must-have, after grounding against the live mykb↔Pi extension. Rationale in
> those sections. This also reframes the "new product vs evolve mykb" premise — see
> the note at the end of §5/D6a.

---

## 1. What vtfkb is

The shared, multi-agent **knowledge-of-record** for the ViloForge Software
Factory. A **TypeScript** product — realistically an **evolution of mykb** rather
than a from-scratch rewrite (D6a; mykb is the proven base). Two
deployment modes: **per-project** (repo-local `.vtfkb/`) and **global** (central
cross-project tier). Agents (architect, PM, executor, judge) read it via a `kb`
engine; humans read it *through* an agent. Git is the synchronization substrate.

## 2. The mykb reference — carry / drop / add (grounded 2026-05-31)

Grounded against real mykb source (`src/core/types.ts`, `store.ts`, `db.ts`,
`cli.ts`) and live `~/.mykb` entries.

**CARRY (faithfully — the proven kernel):**
- `KnowledgeEntry` base: `id` (8-char nanoid), `type`, `text`, `tags[]`,
  `provenance{status,date,source,detail}`, `zone`, `created`, `updated`.
- Types: `fact`, `decision`(+`why`/`rejected`/`context`), `gotcha`(+`failed`/
  `resolution`), `pattern`, `link`(+`url`).
- JSONL append-per-type + tombstone records for deletes.
- SQLite denormalized `entries` table + FTS5 (`entries_fts`); `rebuild` from JSONL.
- Zones `incoming → active → established → archive`; `verify`/`promote`/`archive`.

**DROP:**
- The entire **workspace** layer (`workspace.json`, `journal.jsonl`,
  `continuity.md`, `.active`, `work`/`wsa` commands). Per-project instance *is*
  the scope.
- Single-central-brain assumption (one `~/.mykb`) → per-project + global.
- Free-text `provenance.source` as the only authorship → structured author.

**ADD (the novel delta — where the real design work is):**
- **`author`** on every entry: `{role: architect|pm|executor|judge|human|init,
  agent_id}` — multi-agent attribution.
- **`refs`** / linkage: `task_id` (vtf), `commit`/`branch`, `file[]`, related
  entry ids — knowledge ↔ work ↔ code.
- **Topology**: per-project repo-local brain + global central brain (§ decision).
- **Git-native**: `.gitattributes *.jsonl merge=union`; origin-split write rules;
  deterministic index rebuild.
- **MCP** as the cross-harness query/write baseline (D5a) **+ the per-harness
  auto-injection/capture layer carried over from mykb** (D7) — both, not either/or.
- **A second harness adapter (Claude Code hooks)** alongside mykb's Pi extension —
  the fleet is multi-harness (D7c).
- **promote-to-global** operation.

## 3. Design question set & attack order (hardest/most-gating first)

1. **Scope boundary** — what vtfkb owns vs vtf vs bridge/repo. *(decision D1)*
2. **Structural model & topology** — per-project brain shape + global tier + how
   mykb's "area" concept maps; resolves brainstorm fork #1 (git-repo vs API).
   *(D2)*
3. **Entry schema delta** — author, refs/linkage, zones in a multi-agent world.
   *(D3)*
4. **Write & concurrency mechanics** — git ops per role, merge=union, index
   rebuild, architect-to-`main` sync. *(D4)*
5. **Read & query interface** — MCP tool surface + thin CLI; unified
   project+global query; search/relevance. *(D5)*
6. **Runtime / deployment** — `kb` binary in agent image + controller VM, MCP
   registration, `MYKB_DIR` wiring (two sites). *(D6)*

## 4. Open forks (from brainstorm §8, to resolve here)

- Global-tier transport: shared **git brain repo** vs **vtf-served API** (→ D2).
- Project-context shape: typed entries (leaning) vs single requirements doc (→ D3).
- Fully-onboarded project schema field-by-field (the #1↔#2 contract).
- `.vtfkb/` dir name. (Language resolved: TypeScript — D6a.)
- Whether architect-to-`main` design writes get a lightweight review gate (→ D4).

## 5. Decisions (locked)

### D1 — Scope boundary (vtfkb ↔ vtf ↔ runtime ↔ repo) — LOCKED 2026-05-31

**Guiding principle — content vs lifecycle:** any artifact with both a durable
-knowledge aspect and a workflow-state aspect splits — **content → vtfkb,
state → vtf.**

| Owner | Holds |
|---|---|
| **vtfkb** (knowledge) | facts · decisions · gotchas · patterns · links; the first-class **project context doc**; **links/index to `docs/`** (the docs themselves are repo files); distilled **requirements content**; judge-**learned knowledge**; distilled **knowledge handover**; (global) cross-project knowledge |
| **vtf** (work-state) | Project · Workplan · Milestone · Task · Review · Event · Note · **Idea** + their lifecycle; **SDD specs**; `ProjectVariable` + secret refs (C.3); `AgentLock` · `SessionRecord`; **work-state handover** |
| **bridge / runtime** | raw **conversation transcripts** (Pi JSONL); materialized `.vafi/context.md` (ephemeral) |
| **repo** | the **code** (and physically hosts `.vtfkb/` + `docs/`) |

**Constraints (locked):**
1. **Reference direction is one-way: vtfkb → vtf** (string refs, no FK). vtf
   **never** references a vtfkb entry id — keeps vtf product-agnostic.
2. **No secrets in the brain.** It is git-committed (low-trust). Knowledge +
   secret *references* only; secrets stay in vtf `ProjectVariable`/Vault. (Needs
   a write-time lint guardrail — D-later.)
3. **Knowledge audit = git history** (role-attributed commits). vtfkb does NOT
   copy vtf's `Event` model.
4. **`docs/` integrate via the `link` primitive** (extended to repo-relative
   paths). vtfkb owns the *links/index*, not the file content.
5. **Excluded from vtfkb:** raw conversation transcripts (bridge/vtf own them).
   vtfkb stores only the *distilled* knowledge extracted from a conversation.

**Deferred from D1:** global-tier-vs-Viloforge-KB-Product-#4 (→ D2);
multi-repo brain location (→ #1 schema / D2); provenance/verification + `incoming`
zone (→ D3); tombstone × `merge=union` (→ D4); context-doc ≈ `CLAUDE.md` overlap.

### D2 — Structural model & topology — LOCKED 2026-05-31

**One product family, one engine, one format** (JSONL + SQLite/FTS5 + git), two
scopes via two storage adapters (local-fs / remote-API):

- **D2a — Global tier = "Viloforge KB" (Product #4)**, the *same* vtfkb
  engine/format. Not a separate KB.
- **D2b — Transport (corrects brainstorm "vtf-served"):** per-project brain is
  **git-repo-local** (no service); the global tier is **vtfkb-served** (vtfkb is
  its own product — vtf does not serve knowledge): a **git repo = system-of-record
  + a thin index/search service exposing REST + MCP (agents) + web UI (humans)**.
- **D2c — 1:1 project ↔ main repo; the brain is SINGLE-HOMED** in the main repo
  (`<main-repo>/.vtfkb`). Projects MAY span multiple code repos, but there is
  exactly ONE brain, always in the main repo; secondary repos use it. **No
  per-repo brains.** (Decouples brain from code location.)
- **D2d — Access asymmetry:** project knowledge read **locally** (from the
  main-repo clone); global knowledge read via **MCP/API query** (relevance-matched,
  never full-clone). The MCP layer **unifies** both into one `kb` interface.
- **D2e — Area model:** per-project brain is **flat** (tags for sub-topics;
  project = implicit scope). mykb's **`area`** concept lives in the **global
  tier** (org knowledge-domains). Per-project areas = optional later extension.
- **D2f — Promotion:** deliberate, **gated project → global** git merge
  (attributed, reviewable). Never automatic.
- **D2g — v1 scope:** build the **per-project tier only** (engine + MCP + git, no
  service). The global served tier (Viloforge KB) is **designed-now-built-later**.

**Consequences forwarded:** uniform engine writer-path + origin-split-as-
optimization (→ D4); every agent mounts the main-repo brain regardless of code
repo (→ D6).

### D3 — Entry schema delta — LOCKED 2026-05-31

**Base (carry verbatim from mykb):** `id` (nanoid) · `type` · `text` · `tags[]`
· `zone` · `created` · `updated` · `provenance{status,date,source,detail}`.

- **D3a — `author` (new):** `{role: architect|pm|executor|judge|human|init,
  id}` = *who wrote it*. `provenance.source` retained but re-scoped to *where the
  knowledge came from* (external evidence). Both earn their place.
- **D3b — `refs` (new):** `{task_id?, workplan_id?, commit?, branch?, files?[],
  related?:[entryId], supersedes?:entryId}`. Outward refs to vtf are **one-way,
  string, no FK** (per D1); `related`/`supersedes` are intra-brain links.
- **D3c — Keep mykb's 5 types** (`fact·decision·gotcha·pattern·link`).
  **Requirements are work-DEFINITION, not knowledge** → vtf/ingest (#2) side
  (the one-way-ref test proves it: a vtfkb `requirement` would force vtf→vtfkb
  refs). vtfkb captures the durable *residue* (domain facts, decisions+why,
  gotchas, patterns). **`handover` is emergent** (task-ref'd entries + the
  context doc), not a type.
  **REFINED 2026-06-01 (still 5 types — sub-roles via status/flag/tag, NOT new
  types):** the `decision` type gains a status lifecycle + is ADR-grade
  ([ADR-0004](adr/ADR-0004-decision-is-adr-grade.md)); an **RFC** = a
  `proposed` decision ([ADR-0007](adr/ADR-0007-rfc-is-proposed-decision.md));
  a **constitutional rule** = a `constitutional`-flagged decision
  ([ADR-0008](adr/ADR-0008-constitution-tier.md)); **Product Vision
  heuristics** = `vision`-tagged `pattern`s
  ([ADR-0010](adr/ADR-0010-product-vision.md)).
- **D3d — Trust model = GRADIENT, not a write-gate.** Writes land in `active`
  **immediately, labeled** (`author` + `provenance.status`; agent default
  **`unverified`**) — no curation queue. Reads return the trust signal; consuming
  agents **weigh** it and may **filter `verified`-only**. `verified` is flipped
  by an **independent** signal (judge / passing test / 2nd agent / human), never
  the author. `established` = promoted/durable. `incoming` = narrow lane for
  low-confidence **bulk/auto-harvested** only. **Correction is self-healing:**
  `refs.supersedes` + `archive` the wrong entry (preserved as record). Mirrors
  mykb + the verification-first discipline.
- **D3e — Per-type status semantics — PARTIALLY RESOLVED 2026-06-01.** The
  **decision family** now has explicit lifecycle semantics (`proposed → accepted →
  deprecated | superseded`) per [ADR-0004](adr/ADR-0004-decision-is-adr-grade.md);
  the **fluid types** keep mykb's uniform empirical `verified/unverified` status.
  Remaining nuance refined later.

### D4 — Write & concurrency mechanics — LOCKED 2026-05-31

- **D4a — Engine is the sole writer-path.** Agents call `kb`; the engine appends
  to `<type>.jsonl`, commits to the main-repo brain (attributed to `author.role`),
  pushes. No agent does raw git on the brain.
- **D4b — Commit landing (origin-split = engine-applied optimization):**
  architect → brain `main` directly (pull--rebase first); executor/judge **in the
  main repo** → write rides the **code task-branch**, merges with the deliverable
  (causal consistency); executor/judge in a **secondary repo** → engine commits
  to the main-repo brain **directly**. Agents never reason about which case.
- **D4c — Concurrency:** `.gitattributes *.jsonl merge=union` (appends never
  conflict) · **tombstone-wins** on rebuild regardless of merge order · push race →
  pull-rebase-retry. Deletes/edits **architect-mediated**; executors only append.
  **Update semantics are now per-family (REFINED by [ADR-0004](adr/ADR-0004-decision-is-adr-grade.md)):**
  the **decision family** (`decision`/RFC/constitutional) is **immutable —
  supersede-only** (never `last-write-wins`); the **fluid types**
  (`fact`/`gotcha`/`pattern`/`link`) keep **append-newer-version, last-write-wins
  by `updated`**. The engine stamps the human ADR ordinal at merge-to-`main`
  ([ADR-0009](adr/ADR-0009-decision-identity-and-numbering.md)).
- **D4d — Commit granularity:** batch **per logical operation** (not per entry);
  engine owns granularity.
- **D4e — No review gate on local writes.** Architect writes are gated by the
  human in the chat; agent writes by **trust-labeling** (D3d). The heavier review
  lives only at **promotion to the global tier** (D2f). One gradient: ungated
  local writes → gated global promotion.

### D5 — Read & query interface — LOCKED 2026-05-31

- **D5a — MCP is the portable cross-harness query/write baseline (not the whole
  interface).** The fleet is **multi-harness** (FACTUAL: architect = Pi pod;
  executor/judge = Claude Code CLI subprocess — `vafi/src/controller/invoker.py`),
  and MCP is the one surface both speak. **As shipped, the 9 tools are:** `kb_search`
  (filter incl. `verified` trust) · `kb_list` · `kb_get` · `kb_map` (the derived
  Context Map — Index/Topology, [ADR-0006](adr/ADR-0006-context-map.md)) · `kb_context`
  (the assembled project context doc, [ADR-0025](adr/ADR-0025-project-context-doc-and-kb-context.md)) ·
  `kb_add` · `kb_supersede` · `kb_transition` (decision-status lifecycle) · `kb_resume`
  (session continuity, [ADR-0020](adr/ADR-0020-session-continuity-record.md)). (The
  early design sketched mykb-mirrored names — `kb_match`/`kb_load`/`kb_verify`/`kb_promote`
  — finalized to the above at implementation.) Thin CLI wraps the same engine
  (humans/scripts/debug). **But MCP is pull-only** — it cannot inject context or
  observe the conversation; the high-value *automatic* layer is **D7**, additive on
  top of this baseline.
- **D5b — Unified project+global query (D2d made invisible):** one `kb_search`
  hits local project brain (fs) + global tier (API), returns **one ranked set,
  each result labeled scope + trust + author**. Cross-scope rank = **project-first
  then global**; FTS-ranked within scope.
- **D5c — Read filters:** `provenance.status` (e.g. verified-only), `zone`,
  `type`, `tags`, `author.role` — serves the D3d trust gradient.
- **D5d — Human reads:** project = agent-mediated (D1); global = web UI (D2b).

### D6 — Runtime & deployment — LOCKED 2026-05-31

- **D6a — Language = TypeScript; layered packaging (REVISED 2026-06-01, was
  Python).** One TS **engine** (storage/index/git/scoring — mykb's proven kernel)
  with three faces over it: (1) an **MCP server** (cross-harness query/write
  baseline, D5a); (2) a **thin CLI** (humans/scripts/debug); (3) the **per-harness
  auto-layer** (D7). *Why TS over Python/Go:* the Pi auto-injection extension is
  itself a JS module, so **only TS lets the Pi extension and the engine be one
  in-process codebase** — which is exactly what makes mykb's integration deep;
  Python or Go would force the extension to shell out and lose that. The original
  "Python = platform stack alignment / no Node in pods" reasoning was outweighed:
  vtfkb is a separate product/repo (need not match the Django orchestration
  stack), and "no Node" argued against TS without favoring Python over Go anyway.
  TS keeps the door open to **evolving mykb** rather than rewriting it (see note).
- **D6b — Two wiring sites:** architect pod (register kb MCP in `pi_config.py`;
  `MYKB_DIR → <cloned main-repo>/.vtfkb`) and controller VM (executor/judge;
  `MYKB_DIR → <workdir>/.vtfkb`; secondary-repo tasks also fetch the main-repo
  brain).
- **D6c — Write creds reuse existing repo creds** (architect SSH keys; controller
  clone/push). No new cred system.
- **D6d — Global-tier access** via its MCP/REST endpoint (remote-API adapter);
  **deferred to the later slice** (v1 = per-project only).
- **D6e — No-secrets guardrail:** write-time lint in the engine `add` path
  (high-entropy / known-token patterns → warn/block) — enforces D1 constraint #2.

### D7 — Automatic context-injection + passive capture (per-harness) — LOCKED 2026-06-01

**Must-have, on par with mykb's signature capability.** MCP (D5a) is pull-only;
the value that makes mykb feel like memory is *push*: relevant knowledge appears
without the agent asking, and signals are captured without an explicit "save."
vtfkb must do the same. Because this hooks each harness's agent loop, it is
**inherently per-harness, sharing one engine:**

- **D7a — Auto context-injection.** At session start / per turn, score the
  conversation's signals against the brain and inject a relevant-knowledge block
  (mirrors mykb's `before_agent_start` + `context` hooks; `kb_context` loads the
  project context doc). Inject the **stable** project-context block at
  **session-start** (cache-friendly — Pi's `before_agent_start` sets an
  ephemeral-cached system prompt), and reserve per-turn injection for
  signal-driven deltas (the per-turn `context` hook **invalidates the
  conversation cache** every fire — a real cost; FACTUAL from mykb
  `journal-auto-inject-DESIGN.md`).
  **What is injected (REFINED 2026-06-01):** the session-start block is the derived
  **Context Map** (Index/Topology, [ADR-0006](adr/ADR-0006-context-map.md))
  + the **Agent Constitution** (always-on, derived from `constitutional` decisions,
  [ADR-0008](adr/ADR-0008-constitution-tier.md)) + `vision`/`heuristic`
  patterns ([ADR-0010](adr/ADR-0010-product-vision.md)). The injector
  **MUST exclude known-stale entries** (status `superseded`/`deprecated`,
  `zone=archive`) and **injects `unverified` entries trust-labelled**, never
  filtered for being unverified ([ADR-0005](adr/ADR-0005-injection-filters-stale.md)).
- **D7b — Passive signal capture.** Observe user input + tool calls/results to
  drive relevance scoring (mykb's `input`/`tool_call`/`tool_result` hooks). Future:
  auto-distill capture (low-confidence → `incoming` zone, D3d) — v1 may keep
  capture signal-only and leave knowledge-writes explicit.
- **D7c — Two harness adapters over one engine:** **Pi** → an in-process **TS
  extension** (the D6a reason — engine + extension share a codebase, as mykb does
  today); **Claude Code** → its **hooks** (`SessionStart`/`UserPromptSubmit` to
  inject, `Pre/PostToolUse` to capture) shelling to the engine CLI/MCP. Tool-gating
  to protect the brain files (mykb's `tool_call` gate) rides the same adapters.
- **D7d — Engine-shared, surface-thin:** scoring, rendering, token-budgeting, and
  state live in the **engine**; each adapter is a thin shim. Adding a third harness
  = a new shim, no engine change.

---

## 6. Status

Core decisions LOCKED: **D1–D5 (2026-05-31); D6 revised + D7 added (2026-06-01);
ADR-0004…0010 accepted (2026-06-01, from the ASDLC mine).** The vtfkb model,
topology, schema, write/concurrency, read, runtime (**TypeScript**, layered), and
the **automatic per-harness context/capture** layer are nailed down for **v1
(per-project tier)**. **Deferred / next:** the fully-onboarded **project schema**
(the #1↔#2 contract — now in `project-onboarding-schema-DESIGN.md`); the **global
"Viloforge KB" served tier** (later slice); the Context Map **Glossary + Routing
Table** layers (ADR-0006, global-tier); D7b auto-distill capture depth; a distinct
RFC/constitution type only if the marker model proves insufficient (ADR-0007/0008).

**"New product vs evolve mykb" — RESOLVED (2026-06-01, [ADR-0002](adr/ADR-0002-greenfield-reimplementation.md)).**
vtfkb is a **greenfield TypeScript reimplementation** with **mykb as a studied
spike** (reference/oracle only, zero code inheritance) — the OSB→mykb→vtfkb
lineage applied: carry the *lessons*, not the code. Not fork, not evolve-in-place.
The **"Lessons from mykb (the spike)"** record now lives in §2 of the
[IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md) (per major choice: what mykb
did, what it taught, what vtfkb does differently). That plan (2026-06-01) sequences
the gated v1 build and surfaced five gating decisions **D-A…D-E** (envelope
richness, two-stage rerank, native-dep policy, index-freshness trigger, Claude Code
auto-layer feasibility) — **all now locked as ADR-0011…0015 (2026-06-03)**; the
pre-implementation gate is cleared and Phase 0 is next.

**Decision record:** the authoritative, immutable decisions now live in
[`vtfkb-adr/`](adr/) (ADR format, per ADR-0001). The `Dn` decisions above are
the narrative form; where an ADR refines or supersedes one, **the ADR wins.**
Reconciliation map (2026-06-01 ASDLC-mine wave):

| ADR | Refines / supersedes |
|---|---|
| [ADR-0002](adr/ADR-0002-greenfield-reimplementation.md) greenfield reimpl | §1 "new product", the evolve-vs-greenfield note |
| [ADR-0003](adr/ADR-0003-language-typescript.md) TypeScript | D6a |
| [ADR-0004](adr/ADR-0004-decision-is-adr-grade.md) ADR-grade decision | D3c, D3e, **D4c** (decision family immutable) |
| [ADR-0005](adr/ADR-0005-injection-filters-stale.md) injection filter | D7a, D5c |
| [ADR-0006](adr/ADR-0006-context-map.md) Context Map | D5a (`kb_map`), D7a |
| [ADR-0007](adr/ADR-0007-rfc-is-proposed-decision.md) RFC = proposed decision | D3c |
| [ADR-0008](adr/ADR-0008-constitution-tier.md) Constitution tier | D3c, D7a |
| [ADR-0009](adr/ADR-0009-decision-identity-and-numbering.md) nanoid + ordinal-at-merge | D3b, D4a/D4c |
| [ADR-0010](adr/ADR-0010-product-vision.md) Product Vision | D3c, D7a, D-O8 (onboarding) |
| [ADR-0011](adr/ADR-0011-envelope-richness.md) envelope richness (D-A) | **D3a/D3b** (adds `validity` + `provenance.origin`; trust derived from `author`+`provenance.status`) |
| [ADR-0012](adr/ADR-0012-two-stage-retrieval.md) two-stage retrieval (D-B) | D5a, D7a (Heuristic reranker default; soft sort vs ADR-0005 hard filter) |
| [ADR-0013](adr/ADR-0013-no-hard-native-dep.md) no hard native dep (D-C) | D6a (pluggable `Index`; pure-JS in-memory default, SQLite/FTS5 optional) |
| [ADR-0014](adr/ADR-0014-index-freshness.md) index freshness (D-D) | D4a (content-derived token + explicit rebuild, never mtime) |
| [ADR-0015](adr/ADR-0015-cross-harness-auto-layer.md) cross-harness auto-layer (D-E) | **D7/D7a/D7b/D7c** (tiered parity; Tier C per-turn push Pi-only; 10k-char session-start budget) |
</content>
