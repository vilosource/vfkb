# vfkb — ViloForge KnowledgeBase

> Decision-grade, git-native memory for AI coding agents.
> *They remember what was said. vfkb remembers what your project decided — with rationale, lifecycle, and receipts.*

[![review-gate](https://github.com/vilosource/vfkb/actions/workflows/review-gate.yml/badge.svg)](https://github.com/vilosource/vfkb/actions/workflows/review-gate.yml)
[![test](https://github.com/vilosource/vfkb/actions/workflows/test.yml/badge.svg)](https://github.com/vilosource/vfkb/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](package.json)

vfkb is a **per-project knowledge substrate for coding agents**: an append-only JSONL brain
(`.vfkb/entries.jsonl`) that lives *inside your repo*, travels with every clone and branch, and is
injected into agent sessions automatically. One TypeScript engine — **zero runtime dependencies**
(Node stdlib; only the MCP server adds `@modelcontextprotocol/sdk` + `zod`) — exposed through
three faces: **Claude Code hooks**, an in-process **[Pi](https://github.com/earendil-works/pi)
extension**, and a **9-tool MCP server** any MCP client can pull from.

This repo dogfoods itself: [`.vfkb/`](.vfkb/) is vfkb's own committed brain — 200+ entries of the
decisions, gotchas and handoffs that built it.

---

## Contents

- [Why vfkb](#why-vfkb)
- [How it compares](#how-it-compares)
- [Install](#install)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Proving it works](#proving-it-works)
- [Key concepts](#key-concepts)
- [Requirements](#requirements)
- [Documentation](#documentation)
- [Project status](#project-status)
- [Lineage & acknowledgements](#lineage--acknowledgements)
- [License](#license)

---

## Why vfkb

AI coding agents start every session from zero. The architect that plans your payment system knows
nothing about your payment system. An executor discovers "money needs Postgres `NUMERIC`, not
float," fixes it, ships — and the next task makes the same mistake, because the lesson was never
written anywhere an agent will read. The human ends up being the only shared memory between
agents, which makes the human the bottleneck.

Most "AI memory" products attack this by remembering **conversations** — extract facts from chat,
embed them, retrieve them semantically. vfkb attacks a different problem: preserving a project's
**engineering judgment**. That demands properties conversation-recall systems don't have:

|                                                        | Chat history | `CLAUDE.md` / `AGENTS.md` | Hosted memory platforms | Vector RAG | **vfkb** |
|--------------------------------------------------------|:---:|:---:|:---:|:---:|:---:|
| Structured entries (type, tags, provenance)            | ✗ | ✗ | ~ | ~ | **✓** |
| Decision lifecycle (immutable, supersede-only, status)  | ✗ | ✗ | ✗ | ✗ | **✓** |
| Trust model: operator-verified ≠ agent-asserted         | ✗ | ✗ | ✗ | ✗ | **✓** |
| Stale / superseded knowledge filtered out at inject     | ✗ | ✗ | ~ | ✗ | **✓** |
| Git-native: diffable, branchable, reviewed in PRs       | ✗ | ✓ | ✗ | ✗ | **✓** |
| Auto-injected at session start (no retrieval round-trip)| ✗ | ✓ (always on) | ~ | ✗ | **✓** |
| Deterministic & offline — no embeddings, server, or API keys | ✓ | ✓ | ✗ | ✗ | **✓** |
| Says "no recorded entry" instead of guessing            | ✗ | ✗ | ✗ | ✗ | **✓** |

Two things follow from the git-native choice that no external memory store can offer:

1. **Memory rides code review.** Knowledge changes are diffs; a wrong "fact" is caught in a PR like
   a wrong line of code. Branches carry their own knowledge, and concurrent sessions merge
   conflict-free (`merge=union` on the append-only log, plus a cross-process lock).
2. **Memory has provenance you can audit.** Every entry records who wrote it (human / agent /
   import), whether it was verified, when it expires, and — for decisions — *why*, what it
   superseded, and its lifecycle status. Trust is **derived**, never self-declared.

## How it compares

Feature-level differences against the systems we studied, per their public docs as of mid-2026 —
these are good tools solving a *different* problem:

- **[mem0](https://github.com/mem0ai/mem0)** — a universal memory layer: an LLM extraction
  pipeline over conversations, stored in your choice of ~20 vector stores or a managed platform,
  retrieved semantically. Optimized for user/session personalization at scale. vfkb stores what a
  *human or agent deliberately recorded* about a *project* — no extraction step, no embeddings, no
  hosted service, and agent-written entries are explicitly second-class until verified.
- **[Zep / Graphiti](https://github.com/getzep/graphiti)** — a temporal knowledge graph where
  facts carry validity windows; strong at "what was true when." vfkb's validity is explicit rather
  than inferred (validity windows, `stale`/`expired` provenance, and supersede chains an operator
  can read as an ADR log), and it needs no graph service — the brain is a text file in your repo.
- **[Letta (MemGPT)](https://github.com/letta-ai/letta)** — an agent runtime with OS-style memory
  tiers managed by the agent itself. vfkb is the opposite shape: not a runtime, but a substrate
  *under* whatever harness you already run (Claude Code, Pi, anything speaking MCP).
- **[MemPalace](https://github.com/MemPalace/mempalace)** — local-first, verbatim conversation
  storage with scoped semantic search. Shares vfkb's local-first stance; differs on what's worth
  keeping (verbatim transcripts vs. curated, typed judgment) and on retrieval (embeddings vs.
  deterministic lexical search with an honest no-match).
- **`CLAUDE.md` / `AGENTS.md` files** — the right instinct (project knowledge in the repo), but
  flat prose: no types, no provenance, no lifecycle, no queries, always fully in context. vfkb
  *generates* an `AGENTS.md` projection from the brain (`vfkb export agents-md`) so you can have
  both.

## Install

### From npm

```bash
npm install -g @viloforge/vfkb

vfkb --version     # prints the installed version
vfkb init          # wire a repo: .vfkb/ brain + harness hooks
vfkb-mcp           # the MCP server (stdio)
```

Published as [`@viloforge/vfkb`](https://www.npmjs.com/package/@viloforge/vfkb) with
[provenance attestation](https://docs.npmjs.com/generating-provenance-statements) (SLSA v1,
built on GitHub Actions from this repo). The install path is delivery-proven, not assumed:
every release's [publish workflow](.github/workflows/publish.yml) ends in a canary job on a
fresh runner — no checkout, no cache — that installs the just-published version from the real
registry and content-asserts the CLI, `init` scaffolding, an add/list round-trip, and an MCP
initialize handshake ([v0.2.1 canary run](https://github.com/vilosource/vfkb/actions/runs/29197631539)).

### From source

```bash
git clone https://github.com/vilosource/vfkb.git
cd vfkb
npm install
npm run build      # tsc → dist/ (no native modules)
npm test           # vitest — 265 deterministic tests

node dist/cli.js --help          # the CLI
node dist/mcp-server.js          # the MCP server (stdio)
```

### As a Claude Code plugin (the auto-layer)

The [vfkb-claude-plugin](https://github.com/vilosource/vfkb-claude-plugin) bundles the engine,
MCP server, and hooks so a Claude Code session runs on vfkb automatically — session-start
injection, brain-write gating, end-of-turn decision reminders, and session-end auto-commit.
See that repo for install instructions and its current, mechanically-tracked
[delivery status](https://github.com/vilosource/vfkb-claude-plugin/blob/main/DELIVERY-STATUS.json).

### As an MCP server (any harness)

Point any MCP client at `dist/mcp-server.js` with `VFKB_DATA_DIR` set to the brain directory:

```json
{ "mcpServers": { "vfkb": { "command": "node", "args": ["dist/mcp-server.js"],
                            "env": { "VFKB_DATA_DIR": ".vfkb" } } } }
```

Nine tools: `kb_add` · `kb_get` · `kb_list` · `kb_map` · `kb_context` · `kb_search` ·
`kb_supersede` · `kb_transition` · `kb_resume`. For Pi there is also
`dist/pi-mcp-bridge.js`, an extension that gives Pi Claude-compatible MCP support
(`mcp__<server>__<tool>` naming).

## Quick start

```bash
alias vfkb='VFKB_DATA_DIR=.vfkb node /path/to/vfkb/dist/cli.js'

vfkb init                    # scaffold this repo as a vfkb consumer (.vfkb/ + wiring)

# Record knowledge — deliberate, typed, attributed
vfkb add fact "The API gateway strips the X-Request-Id header" --tag networking --role human
vfkb add gotcha "pgbouncer in transaction mode breaks LISTEN/NOTIFY" --tag database --role human
vfkb add decision "Use NUMERIC for money columns" \
  --why "float rounding lost cents in reconciliation" --role human
vfkb add link "Payment flow design" "docs/design/payments.md" --role human

# Query it
vfkb list --tag networking --limit 5     # newest 5 entries carrying the tag
vfkb search "money columns" --type decision --verified
vfkb map                                 # what knowledge exists, at a glance
vfkb context                             # the project context doc — an agent's first read

# Session continuity
vfkb resume                              # what the last session did + the live knowledge bundle
vfkb resume-note "next: wire the ALB target group"

# Lifecycle — decisions are immutable; supersede, never edit
vfkb supersede <id> "Use NUMERIC(19,4) for money columns" --why "scale fixed by audit" --role human

# Health + delivery
vfkb doctor                              # brain/engine/wiring diagnosis, incl. plugin staleness
vfkb save                                # commit the brain (it ships with your repo)
vfkb export agents-md                    # generate an AGENTS.md projection for non-vfkb tooling
```

Unknown or repeated flags **error loudly** — silent argument drops are treated as bugs here
(see [issue #95](https://github.com/vilosource/vfkb/issues/95) for the class this killed).

## How it works

### The entry envelope

The atomic unit is a typed entry: **fact**, **decision**, **gotcha**, **pattern**, or **link** —
with tags, a lifecycle **zone** (`incoming` → `established` → `archive`), **provenance**
(`verified` / `unverified` / `stale` / `expired`, plus a validity window), and an author role from
which **trust is derived** (operator / agent / import). Decisions additionally carry rationale
(`why`), a status (`proposed` → `accepted` → `deprecated` / `superseded`), optional
**constitutional** weight (always injected, leads every session), and supersede references — an
ADR log the engine can execute.

### The storage kernel

One append-only JSONL file, materialized last-write-wins with tombstones. No database, no
server, no native modules. `merge=union` in `.gitattributes` makes concurrent branch writes
merge conflict-free by construction; a cross-process lock serializes the read-decide-append
critical section for same-machine concurrency. The search index is derived and rebuildable —
the log is the only source of truth.

### Injection, not retrieval

At session start the harness face injects a **resume digest** (what the last session added,
superseded, captured — *recomputed from the brain*, never a stale summary) plus a **knowledge
bundle**: constitutional decisions first, then the pinned handoff, then relevance-filtered
entries. Stale, expired, superseded, and archived knowledge is filtered out *before* the agent
sees it. On-demand search is a deterministic two-stage lexical retriever with a relevance floor
and an honest empty result: `NO-MATCH` with a cause ("no recorded entry" vs. "all matches
stale"), because a memory that guesses is worse than no memory.

### Guardrails

- **Write-time no-secrets lint** — planted credentials are rejected at `add`, not found in review.
- **Tool gating** — the Claude Code `PreToolUse` hook denies direct edits to `.vfkb/`, forcing
  writes through the engine (and its lint, lock, and envelope validation).
- **Hooks fail open** — a malformed payload or crash never wedges the host session.
- **Session-end auto-commit** — the brain is committed on exit (topic branches only, pathspec-
  scoped, never `main`), so `/exit` doesn't lose the day's knowledge.

## Proving it works

Unit tests prove the modules; they cannot prove an agent *behaves better because of vfkb*. So
every user-facing capability ships behind an **agent-driven scenario harness** (L4): a real agent
(Pi/DeepSeek and Claude Code arms) runs in a dockerized sandbox against the real surface, scored
on **observable effects** — the agent's output or the brain's state, never self-report — and
always against a **contrast arm** (no memory, or a naive flat-dump memory) so the win is shown to
be *caused* by vfkb. A capability is DEMONSTRATED at ≥2/3 trials, and the records are committed
under [`scenarios/records/`](scenarios/records/). A proof that cannot fail proves nothing — every
harness carries an arm that can go red, and several have (that's how they earn trust).

The same standard applies to the project's own process: every implementation PR carries an
adversarial review record ([`reviews/`](reviews/)) verified by a deterministic CI gate, and the
project's Definition of Done ([ADR-0050](docs/adr/ADR-0050-l4-dod-constitutional-brake.md),
[ADR-0051](docs/adr/ADR-0051-delivery-honesty.md)) forbids calling anything "done" that hasn't
been *observed* working — a rule vfkb's own brain enforces on every session it boots.

## Key concepts

| Term | Meaning |
|------|---------|
| **Brain** | The per-project knowledge store — `.vfkb/entries.jsonl`, committed with the repo. |
| **Entry** | Atomic unit: fact, decision, gotcha, pattern, or link — typed, tagged, attributed. |
| **Decision family** | Immutable entries with lifecycle status and supersede chains; an executable ADR log. `proposed` decisions are RFCs. |
| **Constitutional** | A decision injected at the top of *every* session — the project's non-negotiables. |
| **Zone** | Lifecycle stage: `incoming` (unproven) → `established` (trusted set) → `archive`. |
| **Provenance** | Verification state (`verified`/`unverified`/`stale`/`expired`) + validity window + origin. |
| **Trust** | Derived from author role: operator / agent / import. Agents cannot self-promote. |
| **Handoff** | A tagged fact carrying session-to-session continuity; pinned in the resume render. |
| **Curator** | Deliberate promotion/archive/merge operations — deltas only, never text rewrites. |
| **L4 scenario** | An agent-driven, sandboxed, contrast-armed proof that a capability changes real agent behavior. |

## Requirements

- **Node.js ≥ 20**
- **git** (the brain rides your repo)
- No native modules, no database, no API keys. Runtime deps: `@modelcontextprotocol/sdk` + `zod`
  (MCP server only — the engine itself is stdlib).

## Documentation

- [`docs/DESIGN.md`](docs/DESIGN.md) — engineering design; [`docs/FEATURES.md`](docs/FEATURES.md)
  — the verified feature reference (every feature marked BUILT / PARTIAL / GATED).
- [`docs/adr/`](docs/adr/) — 52 architecture decision records (Nygard format, immutable);
  [`docs/rfc/`](docs/rfc/) — 24 RFCs. The project practices what it stores: decisions before code.
- [`docs/STATUS-AND-ROADMAP.md`](docs/STATUS-AND-ROADMAP.md) — north star;
  [`docs/H4-DEVELOPMENT-ROADMAP.md`](docs/H4-DEVELOPMENT-ROADMAP.md) — execution authority.

## Project status

**Alpha, used in anger daily.** The v1 per-project tier and the v2 storage/session backbone are
built and shipped; 265 deterministic tests plus the L4 scenario suite. vfkb develops itself on its
own brain (200+ committed entries) — every session that builds vfkb resumes from vfkb. Public API,
CLI surface, and storage schema may still move before 1.0. Part of the
[ViloForge](https://github.com/vilosource) ecosystem: [vfwb](https://github.com/vilosource/vfwb)
(the planning workbench that grounds against vfkb) is in design.

## Lineage & acknowledgements

vfkb is the third generation of one idea — *agents deserve a project memory with provenance*:

- **[OSB — OpenSecondBrain](https://github.com/vilosource/osb)** (Go) proved the knowledge model
  (facts/decisions/gotchas/patterns with provenance) on Claude Code via file conventions and
  adapter prompts.
- **[mykb](https://github.com/vilosource/mykb)** (TypeScript, [Pi](https://github.com/earendil-works/pi))
  proved mechanical enforcement: three-tier context delivery, tool gating, and the JSONL+SQLite
  hybrid — with storage prior art from
  [Engram](https://github.com/Gentleman-Programming/engram) and
  [Beads](https://github.com/gastownhall/beads).
- **vfkb** is the greenfield reimplementation for fleet use: pure-stdlib engine, harness-portable
  faces (hooks / extension / MCP), the decision family, derived trust, and the L4 evidence
  culture.

We also studied [MemPalace](https://github.com/MemPalace/mempalace) — its local-first,
zero-API-call stance is the right one, and vfkb shares it while betting on curated judgment over
verbatim recall. Thanks to Mario Zechner's [Pi](https://github.com/earendil-works/pi) for the
harness extensibility the Pi face builds on.

## License

[MIT](LICENSE) © vilosource
