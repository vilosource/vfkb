# CLAUDE.md — vfkb (ViloForge KnowledgeBase)

Guidance for Claude Code working in this repo. **Read this fully at session start**, then run
`vfkb resume` (below) — together they are your continuity (this is a fresh working location; the
harness auto-memory starts empty here **by design**).

## What vfkb is

**ViloForge KnowledgeBase (vfkb)** — the per-project knowledge substrate for the ViloForge software
factory; the memory engine that **vfwb (ViloForge WorkBench)** and the agent fleet ground against.
Greenfield **TypeScript**, **one engine + two harness faces** (Claude Code hooks via `src/cli.ts`;
Pi in-process extension `src/pi-extension.ts`) + an **MCP server** (9 tools) over an **append-only
JSONL brain**. Minimal deps (`@modelcontextprotocol/sdk` + `zod`; the engine itself is stdlib).

Repo: `git@github.com:vilosource/vfkb.git` (vilosource/vfkb). Dev working copy: `~/VFKB/vfkb`.

## vfkb is wired as this session's native auto-layer

This repo ships the Claude Code integration committed at the root, so a session here **runs on
vfkb automatically** (this is vfkb's actual product surface, not just a CLI):
- **`.mcp.json`** registers the **`vfkb` MCP server** (`node dist/mcp-server.js`, `VFKB_DIR=.vfkb`)
  → you have the 9 `mcp__vfkb__kb_*` tools (`kb_search`, `kb_context`, `kb_add`, `kb_resume`, …).
- **`.claude/settings.json`** hooks:
  - **`SessionStart`** → injects the resume digest + knowledge bundle (continuity, automatic).
  - **`PreToolUse`** (Write/Edit/MultiEdit) → **gates direct writes to `.vfkb/`** (forces brain
    writes through the engine; normal code/doc edits pass through untouched).
  - **`PostToolUse` auto-capture is intentionally OFF** — against the *committed* brain it would
    flood `.vfkb` with tool-call noise. Knowledge here is **deliberate** (`kb_add` / `vfkb add`).
- Requires a built `dist/` (`npm run build`). On first interactive `claude`, approve the project
  MCP server + hooks when prompted (once per machine).

So prefer the **`mcp__vfkb__*` tools** in-session; the CLI (below) is the equivalent for scripting.

## ⚠️ How we track work HERE (read first)

- **Do NOT use mykb / the `kb` CLI / `~/.mykb`** in this repo. That operator workflow does **not**
  apply here.
- **vfkb tracks its own development by dogfooding its self-hosted design-brain `.vfkb/`** (ADR-0019),
  via the `vfkb` CLI against `VFKB_DIR=.vfkb`:
  - **Session START** — get the handoff:
    `VFKB_DIR=.vfkb VFKB_PROJECT=vfkb node dist/cli.js resume`
  - **During work** — record knowledge into the brain:
    - `VFKB_DIR=.vfkb node dist/cli.js add decision "…" --why "…" --role human`
    - `VFKB_DIR=.vfkb node dist/cli.js add fact|gotcha|pattern "…" --role human [--tags a,b]`
    - `VFKB_DIR=.vfkb node dist/cli.js add link "…" "<path-or-url>" --role human`
  - **Session END** — leave continuity, then commit the brain:
    `VFKB_DIR=.vfkb node dist/cli.js resume-note "what the next session should pick up"`
    then `git add .vfkb && git commit` (the brain ships **with** the repo — ADR-0019).
- Git is the source of truth; **only `.vfkb/entries.jsonl` is committed** — `.vfkb/.sessions/`,
  `.signals/`, `index-meta.json` are gitignored (derived/operational, ADR-0019). So **cross-clone
  continuity lives in committed entries + this CLAUDE.md**, not in `resume-note` (session records are
  local). Record durable handoff state as **entries** (e.g. a `fact` tagged `status`/`handoff`), which
  `vfkb resume`'s knowledge bundle surfaces in any clone.
- Ergonomic shortcut (optional): `alias vfkb='VFKB_DIR=.vfkb node ~/VFKB/vfkb/dist/cli.js'`, or
  `npm link` for a global `vfkb` / `vfkb-mcp`.

## Build / test / run

- `npm run build` → `tsc` → `dist/` (no native modules). `pretest` runs `tsc` first.
- `npm test` → vitest (**95/95** at the 2026-06-28 rebrand). The **fast deterministic gate**.
- **Env caveat:** `npm install` is configured against the corporate Nexus
  (`nexus.optiscangroup.com`) → **ENOTFOUND off-VPN**. `node_modules` here was bootstrapped by
  copying from `~/GitHub/vfkb`. On VPN, a normal install works (or `--registry`).
- **CLI:** `node dist/cli.js <cmd>` — `add|list|search|query|map|context|context init|resume|`
  `resume-note|curate|distill|save|hook (session-start|pre-tool-use|post-tool-use)`. Env:
  `VFKB_DIR` (brain dir; default `~/.vfkb`), `VFKB_PROJECT`.
- **MCP server:** `node dist/mcp-server.js` — 9 tools: `kb_add` `kb_get` `kb_list` `kb_map`
  `kb_context` `kb_search` `kb_supersede` `kb_transition` `kb_resume`.

## L4 evaluation harness (ADR-0022)

- `scenarios/l4-purpose.mjs` — dockerized, reproducible, N=3, **dual-harness** (pi + claude). Images
  `vfkb-l4-pi:dev` + `vfkb-l4-claude:dev` (rebuild: `bash scenarios/docker/build.sh`;
  `docker build -t vfkb-l4-claude:dev -f scenarios/docker/claude.Dockerfile .`).
- Run pi: `VFKB_L4_HARNESS=pi VFKB_L4_PROVIDER=deepseek VFKB_L4_MODEL=deepseek-v4-pro
  [VFKB_L4_TRIALS=1] node scenarios/l4-purpose.mjs <id> [--no-record]` (needs `DEEPSEEK_TOKEN`).
- Run claude: `VFKB_L4_HARNESS=claude VFKB_L4_PROVIDER=claude-code VFKB_L4_MODEL=claude-haiku-4-5
  VFKB_L4_DOCKER_TIMEOUT=480000 …` (uses the Claude-Code Max-subscription OAuth, no API key).
- Records → `scenarios/records/<slug>__docker.{json,md}`; **≥2/3 trials = DEMONSTRATED** (ADR-0022).
  Run **one** docker agent run at a time.

## How we work — the ASDLC process

- **Decisions before code.** Significant decisions are **ADRs** (`docs/adr/`, Nygard format,
  **immutable** per ADR-0001 — supersede/amend, never edit a decided body). Proposals are **RFCs**
  (`docs/rfc/`) = "proposed decisions" that become ADRs on acceptance (ADR-0007/0009).
- **Scenario-contract-first for agent-observable features (ADR-0023).** The L4 purpose-demonstration
  scenario **is the Definition of Done**: name it in the ADR/RFC, write it as a contract, run it
  **RED before/with implementation** (RED on **every** harness = the per-harness delivery check),
  then green. Structural invariants stay deterministic unit tests — **no** scenario.
- **Testing pyramid.** Broad TS unit base (the fast red-green loop) → thin integration → the L4
  purpose harness (once-per-feature, live, metered). **Deterministic backstop > probabilistic gate** —
  enforce structural/guardrail rules with a deterministic test/Brake, not the LLM harness.
- **Roadmap-as-authority.** `docs/H4-DEVELOPMENT-ROADMAP.md` §4 is the execution authority — follow
  its order; a "what's next?" urge = a signal to update + re-ratify the roadmap, not to poll.
- **Evidence-gated builds.** Don't build speculatively — an RFC decides the *shape*; the *build*
  triggers on observed evidence or an explicit request.
- **VERIFIED = observed, not asserted.** Never relay a gate's/agent's "passed/verified" as fact
  without reading ground truth. Snapshot ≠ history.

## Commit rules

- **NO AI attribution in ANY commit** — never `Co-Authored-By: Claude/Anthropic`,
  `noreply@anthropic.com`, 🤖, or "Generated with Claude Code". (A global commit-msg hook enforces
  this; honor it — a blocked commit pushes nothing, so verify `git log` after committing.)
- Solo-dev repo: after green tests, commit to `main`, show the message, push to origin.

## Current state (2026-06-28)

- `main` rebranded **vtfkb → vfkb** (ADR-0026, commit `dc1525a`); 95/95 unit green; ADRs 0001–0026,
  RFCs 001–007.
- **v1 (per-project tier) COMPLETE** (Phases 0–6). **H4 COMPLETE:** Track 1 (session continuity +
  auto-distill/ACE curator, ADR-0020/0021), Track 5 (dockerized L4 substrate, ADR-0022), Track 4
  (6 core scenarios), Track 4b (D-i `verified`-filter; D-iii relabel-on-promotion, ADR-0024; D-iv pi
  live tool-result capture; D-ii context-doc + `kb_context`, ADR-0025). **In-repo H4 frontier is
  EXHAUSTED — no in-order build remains.** The next work is a **new fork → re-ratify the roadmap first**.
- **Gated (do NOT build on spec):** **S1** embedding reranker (RFC-003 — build only on a 2nd live
  phrasing-robustness miss *or* an explicit request); **P1** Claude-Code per-turn push (ADR-0015
  Tier C — external-blocked upstream). **Parked:** H2 fleet wiring, H3 global tier.
- **Open findings:** (1) Claude Code's PostToolUse hook does **not fire on a FAILED tool call** →
  live *failure*-capture is pi-only (external-block). (2) `tool-gating` (the brain-write block) is
  **flaky on the pi 0.73.1 substrate** — it holds only intermittently (guardrail-integrity issue,
  needs its own investigation; A/B-confirmed not a regression).

## Key files

- `src/storage.ts` (JSONL kernel; `brainDir = VFKB_DIR || ~/.vfkb`; context spine), `src/engine.ts`
  (filter/rerank/render; decision family; capture; `renderContext`; `setProvenanceStatus`),
  `src/read.ts` (query incl. the `verified` trust filter), `src/mcp-server.ts` (9 tools incl.
  `kb_context`), `src/cli.ts` (CLI + Claude-Code hooks), `src/pi-extension.ts` (Pi face;
  `tool_execution_end` result capture), `src/curator.ts` (`promote`/`promoteIfCorroborated`),
  `src/distiller.ts`.
- `docs/`: `DESIGN.md`, `FEATURES.md`, `STATUS-AND-ROADMAP.md` (north-star),
  `H4-DEVELOPMENT-ROADMAP.md` (execution authority), `adr/` (0001–0026), `rfc/` (001–007).
- `.vfkb/` — vfkb's self-hosted design brain. **Commit it.**

## vfwb relationship

**vfwb (ViloForge WorkBench)** — `github.com/vilosource/vfwb`, planning-phase — is the design/planning
workbench that grounds against vfkb: on ratification it pushes a lossy projection to the project's
`.vfkb/` dir (vfwb ADR-0003) and recalls from it. vfwb is a **separate repo, out of scope here**; its
maintainer repoints it to vfkb. (vfkb runs standalone; vfwb is an overlay, not a runtime dependency.)
