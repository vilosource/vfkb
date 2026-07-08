# vfkb — Features

> **The verified feature reference.** What vfkb is and what it actually does today,
> grounded in the shipped code (`src/`), the accepted ADRs (0001–0035), and the
> L4 evaluation harness. Companion to the engineering design
> [`DESIGN.md`](DESIGN.md) and the live state in
> [`STATUS-AND-ROADMAP.md`](STATUS-AND-ROADMAP.md).
>
> **Status (2026-07-02):** the v1 per-project tier is **built and shipped**, the H4
> in-repo frontier on top of it is **complete**, and the consumer
> distribution/onboarding story (ADR-0030–0032) plus session-end continuity
> (ADR-0033–0035) have landed. Every feature below states whether it is **BUILT**,
> **PARTIAL** (built on one face, not the other), or **DESIGNED / GATED** (not
> built — deliberately). This document replaces the 2026-06 product brief; the
> problem statement (§1) and the before/after story (§5) carry over because they
> are still the point.

---

## 1. The problem

**ViloForge already has a software factory that works.** Give the execution
engine a high-quality spec and it returns verified code with near-zero rework.
The factory's own hard-won lesson: *"Invest in spec quality, not executor
sophistication."* And a good spec is only good because whoever wrote it *had the
context* — the domain, the prior decisions, the gotcha that bit the last person
who touched this module. Today that context lives in exactly one place: **a
human's head.**

That creates three compounding failures at fleet scale:

- **Every agent starts generic.** The architect that plans your payment system
  knows nothing about your payment system.
- **Hard-won lessons evaporate.** An executor discovers "money needs Postgres
  `NUMERIC`, not float," fixes it, ships — and the next task makes the same
  mistake, because the lesson was never written anywhere an agent will read.
- **The human is the only shared memory** between agents, so the human is the
  bottleneck and an unattended fleet starves.

You can buy a better model. You cannot buy *your project's accumulated
judgment.* **vfkb is where that judgment lives.**

> **One line:** *vfkb turns one-shot agents into a team with a memory.*

---

## 2. What vfkb is (one paragraph)

vfkb is a **per-project, git-native knowledge substrate for coding agents**:
zero-runtime-dependency TypeScript (Node stdlib; the MCP face alone adds
`@modelcontextprotocol/sdk` + `zod`) over an **append-only JSONL log**
(`.vfkb/entries.jsonl`) that materializes last-write-wins with tombstones — so
concurrent branches merge union-safe by construction. One shared engine is
exposed through **two harness faces** (Claude Code hooks + CLI; an in-process Pi
extension) plus a **9-tool MCP server** as the cross-harness pull floor. On the
kernel it layers a **decision-family lifecycle** (ADR-grade, immutable,
supersede-only), a **derived trust model** (operator / agent / import), a
**stale-filtering auto-injection layer**, a **lexical two-stage retriever** with
a relevance floor and an honest no-match contract, **session continuity**
(derived resume digests, stop-hook nudges, session-end auto-commit), an
**auto-distill + ACE curator** pipeline, and a **consumer distribution story**
(`init` / `import` / `doctor` + portable single-file bundles).

---

## 3. Features at a glance

| Feature | Status | What it gives you |
|---|---|---|
| Git-native brain in the repo | **BUILT** | Knowledge versioned *with* the code; branches, merges, and clones with it. No external service. (ADR-0013/0019) |
| Conflict-free concurrent writes | **BUILT** | Append-only + LWW materialize + tombstones → `merge=union` is safe by construction. |
| Typed entries + decision family | **BUILT** | `fact / gotcha / pattern / link` are fluid; `decision` is ADR-grade — immutable, supersede-only, with proposed→accepted lifecycle, constitutional flag, ADR ordinals. (ADR-0004/0007/0008/0009) |
| Multi-agent attribution + derived trust | **BUILT** | Seven author roles; trust (`operator / agent / import`) is *derived*, never stored; verified is earned by an independent signal. |
| Auto-injection with stale filtering | **BUILT** | Session-start resume digest + budgeted context bundle; archive/superseded/expired entries are hard-gated out; unverified is injected but labeled. (ADR-0005/0015/0020) |
| Passive capture of tool activity | **PARTIAL** | Built and shipped on the **Pi face** (`tool_execution_end`, with real results + error status). **Not wired on Claude Code** — deliberate for the dogfooded brain; the hook exists (`hook post-tool-use`) but `init`/settings don't register it. |
| Lexical two-stage retrieval | **BUILT** | Stemmed term-overlap scoring (no embeddings, no IDF), heuristic rerank (type tier → trust → recency), relevance floor (RFC-001), honest no-match diagnosis (RFC-002). |
| `verified`-only trust filter | **BUILT** | Readers can restrict to independently verified knowledge. (H4 D-i) |
| Project context doc + `kb_context` | **BUILT** | An authored `context.md` spine stitched with derived sections — the agent's first read. (ADR-0025) |
| Session continuity | **BUILT** | Derived (never-stale) resume digests; Stop-hook decision-capture + handoff nudges; SessionEnd auto-commit of the brain + fallback handoff floor. (ADR-0020/0027/0033/0034) |
| Auto-distill + ACE curator | **BUILT** | Captured errors → candidate gotchas (contained in incoming/unverified); recurrence corroborates; ≥2 helpful signals or a human promotes and re-stamps `verified`. Curator never rewrites text (structural Brake). (ADR-0021/0024) |
| No-secrets write lint | **BUILT** | High-signal secret patterns blocked at the front door; the git-committed brain holds knowledge and secret *references* only. |
| Brain write-gating | **BUILT** | Direct file-writes into `.vfkb/` are denied at the harness level; all writes go through the engine. |
| Consumer onboarding + portable bundles | **BUILT** | `vfkb init` scaffolds a consumer repo (hooks, MCP, bootstrap, gitignore); `import` migrates mykb/ADR/markdown; `doctor` diagnoses wiring; esbuild single-file bundles (`vfkb.mjs`, `vfkb-mcp.mjs`) resolve via `$VFKB_BUNDLE_DIR`. (ADR-0030/0031/0032/0035) |
| L4 purpose-evaluation harness | **BUILT** | Dockerized, contrast-based, multi-trial, dual-harness (Claude Code + Pi) scenarios driving *real agents*; ≥2/3 = DEMONSTRATED; the Definition of Done for agent-observable features. (ADR-0022/0023/0029) |
| One search across project + org tiers | **DESIGNED** | Not built. `query()` reads the single local brain only. (D5b/D2d) |
| Global "ViloForge KB" tier + promotion | **DESIGNED** | Not built. Only the per-project tier exists. (D2a/D2f/D2g) |
| Embedding/semantic reranker | **GATED** | RFC-003 Proposed — build only on a second live phrasing-robustness miss or explicit request. |
| SQLite/FTS5 index backend | **DESIGNED** | The `KbIndex` interface is pluggable (ADR-0013); v1 always uses the pure-JS in-memory index. |

---

## 4. The features, by area

### 4.1 Storage & data model (the kernel)

- **Append-only JSONL** (`entries.jsonl`): every record is a `KnowledgeEntry` or
  a tombstone. `appendRecord` is the only writer and regenerates the
  `index-meta.json` freshness sidecar on every write.
- **Materialize = last-write-wins by `updated`** per id, order-independent —
  which is exactly what makes `merge=union` safe across N agents on N branches.
- **Freshness is content-derived** (sha256 over sorted `id@updated`), never
  mtime (ADR-0014). The index is rebuilt automatically on hash mismatch.
- **The entry envelope** (types.ts): `id`, `type`, `text`, `tags[]`, `zone`
  (`incoming | established | archive`), `author.role` (7 roles:
  `architect | pm | executor | judge | human | init | import`), `refs`
  (task / commit / branch / files / related / supersedes), `provenance`
  (status + a structured, re-verifiable `origin`: commit / message / tool_call
  / manual — ADR-0011), bi-temporal `validity` (`valid_from`, `valid_until`;
  `recorded_invalid_at` is stored-but-not-yet-consumed), and for decisions:
  `status`, `constitutional`, `adr_no`.
- **The context spine** (`context.md`) is an authored Markdown file in the brain
  — deliberately *not* a JSONL entry, so the curator's never-rewrite Brake
  doesn't apply and it can be freely edited (ADR-0025).

### 4.2 Capture

- **Deliberate capture** — `kb_add` (MCP) / `vfkb add` (CLI). Rationale for
  decisions is passed as `why` and **folded into the entry text as a `"Why: …"`
  line** (`foldWhy`, engine.ts) — the envelope has no structured `why` field.
  Zone and provenance default by trust: operator → established/verified;
  agent → incoming/unverified. A new `decision` defaults to `status=proposed`
  (an RFC, per ADR-0007). *Known gap:* `kb_supersede` / `supersede` accept no
  `why` — a superseding decision carries rationale only if written inline.
- **Passive capture** (`captureToolCall`) — records tool activity as `fact`s
  tagged `captured` with a `tool_call` origin and a bounded outcome
  classification; skips vfkb's own tools (self-pollution guard); fails silent.
  **Live on the Pi face only** (with real tool results and authoritative
  error status). On Claude Code the `post-tool-use` hook exists but is
  **intentionally not wired** in this repo or by `init` — against a committed
  brain it would flood the log with tool-call noise, and Claude Code's
  PostToolUse hook doesn't fire on failed calls anyway (external limitation).
- **No-secrets lint** (`secrets.ts`) — named high-signal patterns (private key
  blocks, AWS/GitHub/Slack/GCP/Azure tokens, bearer/assigned-secret shapes).
  Explicit adds throw; passive capture swallows the error.
- **Write-gating** (`gating.ts`) — the PreToolUse hook (Claude Code) and
  `tool_call` (Pi) deny harness file-writes targeting the brain directory,
  forcing all writes through the engine.

### 4.3 Retrieval

- **Two-stage** (ADR-0012/0016): Stage 1 lexical candidates (top 200), Stage 2
  rerank — **relevance-primary for explicit search**, pure heuristic order for
  listing/injection.
- **Scoring is deliberately lexical**: stemmed term-overlap over text + tags
  (light suffix stemmer), no IDF, no length normalization, **no embeddings**.
  The heuristic reranker tiers by type (pattern/gotcha > decision > fact >
  link), then trust (operator +3, verified +1), then recency.
- **Relevance floor** (RFC-001/ADR-0017): candidates matching under ⅓ of
  distinct query terms are dropped — a wrong-but-confident result is worse than
  an honest miss.
- **Honest no-match** (RFC-002/ADR-0018): empty results are *diagnosed* —
  `empty_topic` vs `no_match` vs `all_filtered`, with per-reason counts and a
  near-miss hint — and the MCP rendering tells the agent explicitly not to
  answer from model priors.
- **Filters** (D5c): type / zone / status / tags (ALL) / author-role /
  `verifiedOnly` / stale / superseded / limit.
- **Injection gate** (`isInjectable`, ADR-0005): archive, superseded,
  deprecated, stale, and expired entries never auto-inject; unverified entries
  *do* inject, labeled — trust is a gradient the reader weighs, not a gate.

### 4.4 Curation & lifecycle

- **Decision family**: `supersede()` adds an edge (the old entry is never
  edited), `transitionDecision()` moves proposed→accepted→deprecated (and
  refuses text changes), effective status folds supersession, `adr_no` ordinals
  stamp at merge-to-main, and the **Constitution** derives from accepted +
  constitutional + non-superseded decisions (ADR-0008).
- **ACE curator** (`curator.ts`): deltas + counters, **never rewrites entry
  text** (a structural Brake enforced by unit tests, not a prose rule).
  Operations: promote (incoming→established), archive, merge-duplicate,
  propose-only lexical duplicate detection.
- **Corroborated promotion** (ADR-0021/0024): auto-distilled knowledge needs
  **≥2 net helpful signals or a human** to promote — and promotion re-stamps
  `provenance=verified` so the elevation is *agent-observable* (the ✓ glyph and
  the `verified` filter see it).
- **Auto-distill** (`distiller.ts`): deterministic — captured `capture:error`
  facts become candidate gotchas in incoming/unverified; recurrence of the same
  error signature *corroborates* (a helpful signal) instead of duplicating.
- **Signals** live in an append-only, gitignored counter stream
  (`.signals/counters.jsonl`) — helpful/harmful tallies aggregate at read time
  and never mutate entries.

### 4.5 Session continuity

- **Derived resume digests** (ADR-0020): the SessionStart hook injects a
  prior-session digest plus a live budgeted context bundle (Constitution + Map
  always lead and are never dropped; 10k budget). Digests are *recomputed from
  the live brain*, so they cannot go stale.
- **Stop-hook nudges** (`stop-reminder.ts`): (1) a decision-capture reminder
  when there's uncommitted src/docs work but zero new decisions since HEAD
  (ADR-0027); (2) a handoff nudge when ≥3 new entries but no handoff/next entry
  (ADR-0034). Both use git-HEAD-delta signals (no session state needed) and the
  native `stop_hook_active` loop guard.
- **SessionEnd auto-commit** (ADR-0033): commits *only* `entries.jsonl`,
  pathspec-scoped, on the current topic branch — never on main/master/detached
  (warns instead), never pushes. If the session left no handoff, it writes a
  deterministic **B2 fallback handoff** first — a floor, not a substitute for a
  real handoff entry.
- **Per-session records** (`.sessions/`, gitignored) are keyed by
  `KB_SESSION_ID` and ephemeral when it's unset — which is why durable
  continuity lives in *committed entries*, not session state.

### 4.6 Harness integrations (one engine, two faces + MCP)

- **Claude Code** (via `cli.ts hook …`): SessionStart (resume inject),
  PreToolUse (brain write-gate), Stop (nudges), SessionEnd (auto-commit).
  Hooks anchor to `${CLAUDE_PROJECT_DIR:-.}` so they survive `cd` away from the
  repo root (ADR-0035).
- **Pi extension** (`pi-extension.ts`, ADR-0015): tiered parity —
  `before_agent_start` (Tier-A bundle), `context` (Tier-C per-turn delta,
  Pi-only), `tool_execution_start/end` (Tier-B passive capture *with results*),
  `tool_call` (gate), `session_shutdown` (git save). A Pi↔MCP bridge gives Pi
  client-side MCP capability.
- **MCP server** — the 9-tool cross-harness floor: `kb_search`, `kb_list`,
  `kb_get`, `kb_map`, `kb_context`, `kb_add`, `kb_supersede`, `kb_transition`,
  `kb_resume`. `VFKB_ROLE` lets the harness stamp attribution over
  model-supplied roles.

### 4.7 CLI surface

`add · init · import (--from-mykb | --from-adr | --from-markdown) · doctor ·
list · search/query (type/tag/zone/status/role/verified/stale/superseded
filters) · map · context / context init · context-block · resume · resume-note ·
curate (dups/promote/promote-auto/archive/merge/signal) · distill · supersede ·
save · hook (session-start/post-tool-use/stop/session-end/pre-tool-use)`.
Env: `VFKB_DATA_DIR` (canonical; `VFKB_DIR`/`VFKB_HOME` are deprecated aliases —
ADR-0032), `VFKB_PROJECT`, `VFKB_BUNDLE_DIR` (required by the auto-layer).

### 4.8 Evaluation harness (how "done" is proven)

- **L4 purpose scenarios** (`scenarios/l4-purpose.mjs`, 37 scenario ids):
  dockerized, reproducible, multi-trial (N=3, ≥2/3 = DEMONSTRATED), dual-harness
  (Claude Code + Pi), and **contrast-based** — every scenario runs against a
  baseline (`naive`/`none`/`no-gating`/`no-mcp`) so the proof *can fail*
  (ADR-0022/0029). Live and metered; deliberately not part of `npm test`.
- **Scenario-contract-first** (ADR-0023): for agent-observable features the L4
  scenario *is* the Definition of Done — named in the ADR/RFC, run RED before
  implementation, then green. Structural invariants stay deterministic unit
  tests (the fast 95+-test vitest gate).
- Dedicated proofs exist for decision-capture, session-end handoff, and consumer
  onboarding. (The candidate-wiring smoke gate of ADR-0028 was retired 2026-07-08 —
  ADR-0048; its premise ended with the plugin migration.)

### 4.9 Distribution & consumer onboarding (ADR-0030–0032, 0035)

- **`vfkb init`** idempotently scaffolds a consumer repo: empty brain,
  version-stamped manifest, committed `bootstrap.mjs`, `.mcp.json`, hooked
  `.claude/settings.json`, gitignore stanza, `AGENTS.md` snippet. Never
  clobbers an existing brain.
- **`vfkb import`** migrates lossily (role=`import`, tagged `imported`) from
  mykb areas, ADR directories, or arbitrary markdown.
- **`vfkb doctor`** diagnoses engine identity, brain↔engine schema
  compatibility, bundle-dir resolution, deprecated aliases, and hook/MCP wiring.
- **Portable bundles**: two self-contained ESM files (`vfkb.mjs` zero-dep CLI;
  `vfkb-mcp.mjs` with the SDK inlined), resolved via `$VFKB_BUNDLE_DIR` through
  a committed bootstrap that degrades gracefully (a banner, never a block) when
  unset (ADR-0031).

---

## 5. What it unlocks — before/after

**Task: "build a payment system."**

- The **architect** plans it *with* the project's context doc and prior
  decisions in hand, and records the design and the *why* to `main`.
- An **executor** discovers money needs Postgres `NUMERIC` not float, and
  writes that gotcha next to the code on its branch.
- The **judge** approves; the branch merges → **code and gotcha land on `main`
  together** — the causal-consistency guarantee generic memory stores can't
  make.
- The **next task** branches from the new `main` and inherits both. The mistake
  is never repeated.

Repeated across thousands of tasks, that difference is the product: **a factory
whose output quality compounds instead of resetting to generic every time.**

---

## 6. Deliberately not built (and why)

| Item | State | Gate |
|---|---|---|
| Embedding/semantic reranker | RFC-003 Proposed | A second live phrasing-robustness miss, or an explicit request. Retrieval stays lexical until evidence demands otherwise. |
| SQLite/FTS5 index backend | Designed (ADR-0013) | The pluggable `KbIndex` seam exists; the pure-JS index is sufficient at current brain sizes. |
| Global org tier + unified cross-scope search | Designed (D2a/D2f/D2g, D5b) | Parked as H3 — per-project tier first. |
| Claude Code per-turn push (Tier C) | ADR-0015 | External-blocked upstream (no per-turn injection hook). |
| Claude Code live *failure* capture | — | External-blocked: PostToolUse doesn't fire on failed tool calls. |
| `recorded_invalid_at` consumption | Schema-now, consume-later | Bi-temporal invalidation recording is stored but not yet read. |
| Fleet wiring (H2) / platform probes (RFC-009) | Parked / Proposed | Evidence-gated. |

---

## 7. Lineage

mykb — the proven single-user predecessor — contributed the kernel idea (JSONL +
git, the five entry types, relevance scoring, and the automatic Pi
injection/capture layer). vfkb is a **greenfield TypeScript reimplementation**
(ADR-0002/0003) that carries the proven core and adds what a *factory* needs:
role attribution, a derived trust model, the ADR-grade decision family, the
cross-harness MCP surface, the Claude Code face, the L4 evaluation methodology,
and the consumer distribution story. mykb remains a studied spike, not a
dependency; a lossy `import --from-mykb` path exists for its data.
