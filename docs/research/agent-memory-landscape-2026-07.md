# Agent Memory Landscape — July 2026

> **Research survey.** The top agent-memory products and techniques as of
> 2026-07-02, compared against vfkb, ending with ranked adoption candidates.
> Successor to the April-2026 mykb-era market comparison; companion to
> [`FEATURES.md`](../FEATURES.md) (the verified vfkb feature reference this
> comparison is grounded in).
>
> **Verification discipline (per the repo's verification-first protocol):**
> vendor pages and GitHub repos were fetched live on 2026-07-02; arXiv abstracts
> were fetched directly. Anything seen only on a vendor's own page is marked
> **[vendor claim]**; anything from press/blogs/trackers is **[secondary]**.
> **All benchmark numbers in this space are self-reported and the flagship
> benchmark (LoCoMo) is contested** — see §6. Star counts are approximate
> as-read on 2026-07-02.

---

## 1. What we're comparing against

vfkb (see [`FEATURES.md`](../FEATURES.md)): per-project, **git-committed,
append-only JSONL** brain; **typed entries** (fact / decision / gotcha /
pattern / link) with an ADR-grade immutable decision family; **derived trust**
(operator / agent / import) with a verified-only filter and
supersede-not-delete; **lexical retrieval, no embeddings** (relevance floor +
honest no-match); auto-injection with stale filtering; session continuity
(resume digests, stop-hook nudges, session-end auto-commit); ACE-style curator
+ auto-distill; MCP + Claude Code hooks + Pi extension; L4 contrast-based
evaluation harness.

---

## 2. The top 5 products (July 2026)

Selected by OSS footprint (23k–60k GitHub stars), verified funding, and active
2026 releases. Runners-up in §2.6.

### 2.1 Mem0 — the market-share leader

OSS core (Apache-2.0, ~60k stars, mem0ai/mem0) + hosted platform; $24M
seed+Series A (Oct 2025, TechCrunch); AWS picked it as memory provider for its
Agent SDK **[vendor claim]**. Architecture: LLM extraction of atomic facts into
a pluggable **vector DB + optional entity graph + KV**; an April-2026 rewrite
moved to "single-pass **ADD-only** extraction" (history kept, not mutated
in-place) with **multi-signal retrieval: semantic + BM25 + entity matching,
fused** **[vendor blog, 2026-07-01]**. Scopes: user / session / agent.
SDKs (Py/Node), self-host Docker, MCP, agent-skills for Claude Code / Cursor /
Codex. Pricing: free → $249/mo Pro (mem0.ai/pricing, verified). Benchmarks
**[vendor claims]**: LoCoMo 92.5, LongMemEval 94.4, BEAM-1M 64.1 — its 2025
LoCoMo SOTA claim was formally disputed by Zep (§6).

### 2.2 Zep / Graphiti — the temporal knowledge graph

Graphiti (OSS Apache-2.0, ~28k stars, getzep/graphiti, v0.29.2 Jun 2026) +
commercial Zep platform (now positioned "context engineering platform").
Architecture: **temporal knowledge graph** (Neo4j/FalkorDB/Neptune) with a
**bi-temporal model** — every edge carries event-time AND ingestion-time with
validity intervals; contradicted facts are **invalidated, never deleted**
(arXiv:2501.13956, Jan 2025). Retrieval: embeddings + BM25 + graph traversal,
**no LLM at query time** (sub-second; 156ms at 1M-edge scale **[vendor
claim]**). Official MCP server. Pricing: free → $3,750/yr Flex Plus +
enterprise (verified). Best-in-class temporal-validity/supersedence story of
the five; capital-light (~$2.3M tracked) vs Mem0.

### 2.3 Letta (ex-MemGPT) — converging on vfkb's design

Berkeley spinout ($10M seed, Felicis, 2024); OSS Apache-2.0 (~24k stars) +
letta-code (~2.8k stars, v0.27.20 Jul 1 2026). MemGPT heritage: the agent
self-manages memory like an OS (in-context blocks = RAM, archival = disk) —
plus **sleep-time compute** (arXiv:2504.13171): background agents consolidate
memory during idle time. **The big 2026 story:** on 2026-03-16 Letta announced
its "next phase" (verified, letta.com/blog/our-next-phase) — sunsetting
server-side memory tools in favor of **"context repositories" / MemFS:
git-backed, version-controlled memory files edited with plain filesystem
tools**, optional GitHub sync. A direct, well-funded convergence on vfkb's
thesis (files in git, agent-editable), arrived at from the opposite
(runtime-first) direction. June 2026 research direction: meta-RL-trained
"memory models" that emit token-space memories (context repos / AGENTS.md).

### 2.4 Cognee — the graph+vector memory platform

Berlin; OSS Apache-2.0 (~26.5k stars, topoteretes/cognee, v1.2.2 Jun 2026) +
cloud; $7.5M seed (Pebblebed, official announcement). **ECL pipeline
(Extract–Cognify–Load)**: documents/chats → knowledge graph + embeddings with
ontology generation; 2026 simplification to a **single-Postgres backend**
(graph + pgvector + sessions in one instance). Operations:
`remember / recall / forget / improve`. Official MCP server **and a Claude
Code plugin** capturing prompts/tool traces across sessions — directly aimed
at coding-agent memory. Temporal validity/supersedence is weak vs Zep.
Pricing: OSS free; cloud $2.50/1M tokens (verified). BEAM claims are hedged by
their own repo as "directional" **[vendor claim]**.

### 2.5 Supermemory — the fast-moving context-engineering API

SF; ~$2.6–3M seed Oct 2025 (TechCrunch; angel Jeff Dean). OSS engine now MIT
(~28k stars) incl. a locally runnable memory engine, MCP server, and Claude
Code/OpenCode plugins. Proprietary "vector graph engine with ontology-aware
edges," hybrid vector + keyword retrieval, multimodal connectors, user
profiles — internals unpublished **[vendor claims]**. Ships a drop-in backend
for **Anthropic's Claude memory tool**, and a hosted MCP server. Pricing: free
→ $399/mo + enterprise (verified). Weakest published memory-model semantics
(temporal validity/supersedence undocumented) of the five; self-refereed
benchmarks ("MemoryBench").

### 2.6 Runners-up

- **Cloudflare Agent Memory** (blog.cloudflare.com, 2026-04-17, verified;
  private beta) — Durable Objects + SQLite + Vectorize; **4 typed memory
  kinds (Facts/Events/Instructions/Tasks), supersession chains, a
  verification-against-transcript pass**, 5-channel RRF retrieval; explicitly
  targets coding agents. Excluded only for beta status — **the most vfkb-like
  memory semantics of any entrant; watch it.**
- **MemOS (MemTensor)** — ~10k stars; "MemCube" units carrying content +
  provenance/versioning/governance metadata; memory as a schedulable resource.
  Smaller Western mindshare.
- **Anthropic memory tool** (`memory_20250818`, GA on the Messages API,
  verified) — fully **client-side and file-based** (`/memories` dir with
  file-op commands). A platform capability, not a product — but it validates
  files as the substrate at the model-provider level.
- **LangMem** (LangChain) — ~1.5k stars, a LangGraph accessory, excluded on
  adoption. **OpenAI ChatGPT memory** — major June-2026 rebuild (temporal
  revision of memories, "background dreaming" **[secondary]**) but consumer
  product only, no developer memory API found.

---

## 3. Comparison matrix (vfkb included)

| | **Mem0** | **Zep/Graphiti** | **Letta** | **Cognee** | **Supermemory** | **vfkb** |
|---|---|---|---|---|---|---|
| Storage substrate | Vector DB + graph + KV | Temporal KG (graph DB) | Postgres → **git-backed files (MemFS)** | Postgres graph + pgvector | Proprietary vector-graph | **Append-only JSONL in the repo** |
| Memory formation | LLM ADD-only extraction | LLM extraction → bi-temporal edges | Agent self-edits; sleep-time consolidation | ECL pipeline + ontology | Ingestion + profiles (unpublished) | Deliberate `kb_add` + Pi passive capture + deterministic distill |
| Retrieval | Semantic + BM25 + entity, fused | Embeddings + BM25 + graph, no query-time LLM | Agent-driven paging (file/tool ops) | Auto-routed vector + graph modes | Vector + keyword | **Lexical two-stage + heuristic rerank; floor + honest no-match; no embeddings** |
| Typed memory model | Scopes (user/session/agent) | Entities/relations/facts | Blocks + archival | Graph + session cache | Docs/facts/profiles | **fact/decision/gotcha/pattern/link + ADR-grade decision family** |
| Temporal / supersedence | ADD-only history [vendor] | **Bi-temporal validity, invalidation** | Git history of files | Weak | Weak | Supersede-not-delete + validity window (bi-temporal field stored, unconsumed) |
| Provenance / trust | Agent facts first-class | Provenance to source episodes | Git blame | "Truth subspace" (unverified) | Not documented | **7 author roles, derived trust, operator-verified filter, re-verifiable origin** |
| Git/file-native | No | No | **Yes (since 2026-03)** | No | No | **Yes — by design, since inception** |
| MCP | Yes | Yes | Partial (tools) | Yes + Claude Code plugin | Yes + plugins | Yes (9 tools) |
| Eval methodology | LoCoMo/LongMemEval/BEAM self-scores | Self + disputed LoCoMo war | Letta Leaderboard | BEAM (self-hedged) | Self-refereed MemoryBench | **L4 contrast-based, multi-trial, can-fail, dual-harness** |
| OSS / price | Apache-2.0; →$249/mo | Apache-2.0 core; →$3,750/yr | Apache-2.0 | Apache-2.0; $2.50/1M tok | MIT engine; →$399/mo | OSS, zero-dep |

**Where vfkb stands out:** (1) the only system designed git-native from
inception — knowledge is *causally consistent with code* (a gotcha merges with
the change that taught it), which no DB-backed competitor can offer; (2) the
richest trust/provenance model (roles + derived trust + independent
verification + immutable decisions); (3) the only one whose evaluation
methodology is contrast-based and designed to be able to fail, in a field
whose benchmarks are adversarial marketing (§6).

**Where the field is ahead:** (1) hybrid retrieval — everyone fuses
lexical + semantic + graph signals; vfkb is deliberately lexical-only (the
evidence in §5.2 says that's more defensible than it sounds, with BM25 as the
cheap upgrade); (2) automated consolidation — Mem0's ADD/UPDATE/NOOP decision
at write time and Letta's sleep-time compute are more automated than vfkb's
curator; (3) cross-session *user*-scoped memory — out of vfkb's scope by
design (per-project substrate).

---

## 4. Techniques survey (state of the art, mid-2026)

### 4.1 Temporal knowledge graphs
Zep/Graphiti (arXiv:2501.13956): four timestamps per edge (system-time +
world-time pairs); contradiction → invalidation, never deletion. **TOKI**
(arXiv:2606.06240, Jun 2026, verified) formalizes write-time contradiction
policies (LWW / evidence-weighted / await-confirmation) as bi-temporal
operators with audit rows, and shows an LLM judge on the write path breaks
replay consistency unless its outputs are logged. *vfkb note:* append-only +
`kb_supersede` already is invalidation-not-deletion; the delta is consuming
the bi-temporal split (world-time vs record-time) already half-present in the
envelope.

### 4.2 Consolidation pipelines
**Mem0** (arXiv:2504.19413): extract → compare vs existing → ADD/UPDATE/
DELETE/NOOP. **Sleep-time compute** (arXiv:2504.13171 + Letta docs): a second
agent rewrites memory during idle time — ~5× less test-time compute for equal
accuracy, up to +13–18% accuracy **[paper claims]**. **A-MEM**
(arXiv:2502.12110, NeurIPS 2025): Zettelkasten-style notes whose addition
triggers "memory evolution" updating linked older notes. *vfkb note:* the
curator/distiller is this family; missing pieces are a write-time NOOP/UPDATE
check and a scheduled offline pass.

### 4.3 Agentic context engineering (ACE)
arXiv:2510.04618 (ICLR 2026, verified): Generator → Reflector → Curator
producing typed **delta items with helpful/harmful counters**, merged
deterministically. Names the two failure modes vfkb's Brakes already guard:
**brevity bias** and **context collapse** (iterative monolithic rewrites erode
knowledge — hence never-rewrite). **Context rot** (Chroma, Jul 2025): across
18 models, reliability degrades with input length even on trivial tasks —
motivates small, curated injections over long dumps. *vfkb note:* vfkb already
has the counter stream (`.signals/counters.jsonl`); the un-adopted part is
feeding helped/misled signals from the injection path itself.

### 4.4 Hierarchical / OS-inspired memory
MemGPT (arXiv:2310.08560) paging; MemOS (arXiv:2507.03724) "memory as a
schedulable resource," MemCube units carrying provenance/governance metadata.
*vfkb note:* the cheap adoptable insight is a hard-capped always-loaded index
+ on-demand detail (Claude Code's own MEMORY.md 200-line/25KB rule).

### 4.5 Taxonomies
CoALA (arXiv:2309.02427): episodic / semantic / procedural. 2026 surveys
(arXiv:2512.13564; arXiv:2603.07670; arXiv:2605.06716) converge on a
**Storage → Reflection → Experience** evolution ladder. *vfkb note:* fact ↔
semantic, gotcha/pattern ↔ experiential/procedural, session records ↔
episodic; the ladder is a clean frame for the distiller's job.

### 4.6 Retrieval & benchmarks
2026 benchmarking (arXiv:2604.01733): hybrid + cross-encoder rerank beats all
single-stage — but **BM25 alone beat text-embedding-3-large dense retrieval on
most metrics** in that setting. **LongMemEval-V2** (arXiv:2605.12493, May
2026, verified): 5 abilities including **workflow knowledge, environment
gotchas, premise awareness** — and its file-based-memory-plus-coding-agent
variant scored **72.5% vs 48.5%** for the embedding-RAG variant. LoCoMo is
contested (§6); LongMemEval(-V2) and BEAM are the 2026 benchmarks of record.

### 4.7 Forgetting, hygiene, contradiction
**"Supersede" paper** (arXiv:2606.27472, Jun 2026, verified): agents with
self-maintained memory drop 92%→77% on current-value questions (68%→28% at
24× length); **more memory budget did not help — maintenance (superseding
stale values) is the bottleneck, and models don't do it unprompted.** 2026
governance work (SSGM, arXiv:2603.11768 **[secondary]**) argues staleness /
contradiction / forgetting-quality must be evaluated jointly; security surveys
note recency/frequency retention can keep adversarial entries alive.
*vfkb note:* this is the empirical justification for explicit `kb_supersede`
+ operator verification — and for surfacing candidate contradictions
deterministically instead of trusting the agent to notice.

### 4.8 Coding-agent memory practices
Claude Code (official docs, fetched): CLAUDE.md hierarchy + auto-memory
(MEMORY.md index hard-capped at 200 lines/25KB, topic files on demand); docs
explicitly say memory is context, not enforcement — use hooks for guarantees
(vfkb's "deterministic backstop > probabilistic gate," independently arrived
at). **AGENTS.md**: 60k+ repos, read by Codex/Cursor/Copilot/Devin/Gemini CLI,
donated to the Linux Foundation's **Agentic AI Foundation (Dec 2025)**
alongside MCP. Cursor Memories (user-approves-before-save) and Windsurf
memories both **recommend promoting auto-memories into version-controlled
files** — i.e., the industry converged on vfkb's core thesis: plain,
repo-committed, human-auditable files, with auto-generated memory as a
lower-trust tier promoted deliberately.

---

## 5. What 2026 validates about vfkb's bets

1. **Files-in-git is winning, not quaint.** Letta pivoted to git-backed MemFS
   (Mar 2026); Anthropic's memory tool is client-side files; every coding
   harness recommends promoting memories into version-controlled markdown;
   AGENTS.md became a Linux Foundation standard.
2. **Lexical-first retrieval is defensible.** BM25 beat dense embeddings in a
   2026 head-to-head; LongMemEval-V2's file-search agent beat embedding-RAG
   72.5% vs 48.5%. Keeping RFC-003 (embeddings) gated remains the right call —
   and the upgrade path is BM25 + optional LLM rerank, not vectors.
3. **Explicit supersedence + independent verification is the hard part, and
   vfkb does it.** The Supersede paper shows maintenance is the bottleneck;
   Zep/TOKI show invalidation-not-deletion is the right semantics; Cloudflare
   built typed entries + supersession chains + verification into its new
   service. vfkb had all three before they were fashionable.
4. **Trust tiers are converging on vfkb's model.** Cursor gates auto-memories
   behind user approval; Windsurf calls auto-memories lower-trust; vfkb's
   incoming/unverified → verified-by-independent-signal gradient is the same
   idea, more principled.
5. **"Deterministic backstop > probabilistic gate" is now official Anthropic
   guidance** (memory is context, hooks are enforcement) — vfkb's Brake
   philosophy, independently confirmed.

---

## 6. Benchmark caveat

Treat every leaderboard number in this space as marketing until reproduced:
Zep publicly attacked Mem0's LoCoMo SOTA claim as miscalculated; Zep's own
corrected figure (75.14%) was re-disputed down to 58.44% (getzep/zep-papers
issue #5); a Continua audit found ~6.4% of LoCoMo's answer key wrong; and
LoCoMo conversations (16–26k tokens) now fit in a single context window.
Supermemory referees its own benchmark. This is precisely why vfkb's L4
methodology (contrast baselines, multi-trial, must-be-able-to-fail,
ADR-0022/0029) matters: it is the only evaluation posture in this survey
designed to catch its own product failing.

---

## 7. Adoption candidates for vfkb (ranked)

Per the repo's evidence-gated process these are *proposals* — each significant
one should become an RFC before building; none should be built on spec.

| # | Candidate | Source of evidence | Cost / fit | Suggested gate |
|---|---|---|---|---|
| 1 | **Deterministic contradiction surfacing at write/curate time** — on `kb_add`, lexical near-duplicate/conflict check (shared tags + high token overlap) → prompt "supersede or NOOP?" | Supersede paper (2606.27472): agents don't maintain memory unprompted; TOKI: keep the LLM judge off the write path | Small; pure-lexical, extends `findLexicalDuplicates`; converts vfkb's biggest LLM-discipline risk into a Brake | RFC; L4 scenario = agent updates a stale fact it otherwise misses |
| 2 | **Injection-path helpful/harmful feedback** — let the agent/operator signal "this injected entry helped/misled"; curator demotes chronically unhelpful entries | ACE (ICLR 2026) counters; context rot (keep injections salient) | Small; counter stream + `curate signal` already exist — the missing piece is wiring signals from the injection/resume path | RFC; measurable via existing counters |
| 3 | **AGENTS.md / CLAUDE.md export projection** — `vfkb context --agents-md` emitting a distilled, committed projection of the brain | AGENTS.md = LF standard, 60k+ repos, read by every major harness | Small-medium; a render target over existing `renderContext`; makes the brain useful to non-Claude/Pi agents with zero integration | RFC; negative case = projection drift vs brain |
| 4 | **Sleep-time distillation pass** — run distill/curate offline on a schedule (post-merge hook / nightly / SessionEnd) instead of only in-session | Letta sleep-time compute (2504.13171): amortized consolidation; each brain commit is a natural checkpoint | Small; the distiller is deterministic already — this is scheduling, not new capability | Could ride ADR-0033's SessionEnd machinery |
| 5 | **Consume the bi-temporal fields** — read `recorded_invalid_at` / validity world-time vs record-time; "as-of" queries over the committed brain | Zep/Graphiti; TOKI operator algebra | Small; schema already stores it (schema-now/consume-later was the plan) | Evidence: first real need for an as-of query |
| 6 | **Hard load-cap Brake on injection** — enforce the resume/bundle budget as a deterministic cap with explicit truncation labeling | Context rot; Claude Code's own 200-line/25KB MEMORY.md rule | Trivial; `renderContextBundle` already budgets — make the cap a tested invariant | Unit test (structural) |
| 7 | **BM25 scoring as the retrieval upgrade** (still no embeddings) — replace raw term-count with BM25 over text+tags; optional top-k LLM rerank later | arXiv:2604.01733 (BM25 > dense in 2026 head-to-head); LongMemEval-V2 file-search win | ~stdlib-sized change inside `InMemoryIndex`; preserves determinism + zero-dep | Same gate as RFC-003: a live relevance miss — but this is the *first* resort, embeddings the second |
| 8 | **Storage→Reflection→Experience promotion ladder** — make explicit that episodic captures graduate into abstracted `pattern` entries, with `link` edges to what they generalize (A-MEM-style evolution, append-only) | 2026 surveys (2605.06716); A-MEM | Medium; mostly curator policy + convention, minimal schema | RFC when distilled-capture volume justifies it |

**Deliberately not adopted:** vector/graph databases as substrate (breaks
git-native causal consistency — the core differentiator); LLM-mediated write
paths (TOKI shows they break auditability; vfkb's deterministic-merge stance
is ahead here); user-scoped cross-project memory (out of scope — per-project
by design, the global tier is parked as H3).

---

## 8. Primary sources

Products: github.com/mem0ai/mem0 · mem0.ai/blog/state-of-ai-agent-memory-2026 ·
github.com/getzep/graphiti · arXiv:2501.13956 · letta.com/blog/our-next-phase ·
github.com/letta-ai/letta-code · github.com/topoteretes/cognee ·
github.com/supermemoryai/supermemory · blog.cloudflare.com/introducing-agent-memory ·
platform.claude.com docs (memory tool) · agents.md · Linux Foundation AAIF
announcement (Dec 2025).
Techniques: arXiv:2510.04618 (ACE) · 2504.13171 (sleep-time) · 2504.19413
(Mem0) · 2502.12110 (A-MEM) · 2606.06240 (TOKI) · 2606.27472 (Supersede) ·
2605.12493 (LongMemEval-V2) · 2604.01733 (retrieval benchmark) · 2309.02427
(CoALA) · 2605.06716 / 2512.13564 / 2603.07670 (2025–26 surveys) ·
research.trychroma.com/context-rot · code.claude.com/docs/en/memory.
Benchmark disputes: blog.getzep.com "Lies, damn lies…" ·
github.com/getzep/zep-papers issue #5 · blog.continua.ai LoCoMo audit.
