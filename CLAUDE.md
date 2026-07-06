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
- **`.mcp.json`** registers the **`vfkb` MCP server** via the committed bootstrap
  (`node .vfkb/bin/bootstrap.mjs mcp`, `VFKB_DATA_DIR=.vfkb`) → the 9 `mcp__vfkb__kb_*` tools.
- **`.claude/settings.json`** hooks (also via `.vfkb/bin/bootstrap.mjs cli hook …`):
  - **`SessionStart`** → injects the resume digest + knowledge bundle (continuity, automatic).
  - **`PreToolUse`** (Write/Edit/MultiEdit) → **gates direct writes to `.vfkb/`** (forces brain
    writes through the engine; normal code/doc edits pass through untouched).
  - **`Stop`** → the end-of-turn decision-capture reminder (ADR-0027).
  - **`SessionEnd`** → **auto-commits the brain** so `/exit` is safe-by-default (ADR-0033): commits
    **only** `.vfkb/entries.jsonl`, on the **current topic branch** (never `main` — it warns instead),
    pathspec-scoped (never sweeps your staged work), no push (GAP 2). It also writes a **B2 fallback
    handoff** (`fact` tagged `handoff,next,auto` enumerating the session's new entries) **only if you
    left none** (GAP 1) — so still prefer recording a real `handoff`/`next` fact by hand; the fallback
    is a floor, not a substitute. *(A higher-quality B1 Stop-hook nudge stays open — RFC-011 §B.)*
  - **`PostToolUse` auto-capture is intentionally OFF** — against the *committed* brain it would
    flood `.vfkb` with tool-call noise. Knowledge here is **deliberate** (`kb_add` / `vfkb add`).
- **This repo now dogfoods the consumer wiring (ADR-0030/0031/0032):** the auto-layer resolves the
  engine through **`$VFKB_BUNDLE_DIR`**, not a relative `dist/` path. So per machine, once:
  `npm run build:bundles` then `export VFKB_BUNDLE_DIR=$PWD/dist/bundles`. **If `VFKB_BUNDLE_DIR` is
  unset, SessionStart shows a "vfkb INACTIVE — set VFKB_BUNDLE_DIR" banner** (graceful, never blocks)
  — set it and restart the session. On first interactive `claude`, approve the MCP server + hooks once.
  (`dist/cli.js` from `npm run build` still works for manual CLI; the auto-layer uses the bundle.)

So prefer the **`mcp__vfkb__*` tools** in-session; the CLI (below) is the equivalent for scripting.

## ⚠️ How we track work HERE (read first)

- **Do NOT use mykb / the `kb` CLI / `~/.mykb`** in this repo. That operator workflow does **not**
  apply here.
- **vfkb tracks its own development by dogfooding its self-hosted design-brain `.vfkb/`** (ADR-0019),
  via the `vfkb` CLI against `VFKB_DATA_DIR=.vfkb`:
  - **Session START** — get the handoff:
    `VFKB_DATA_DIR=.vfkb VFKB_PROJECT=vfkb node dist/cli.js resume`
  - **During work** — record knowledge into the brain:
    - `VFKB_DATA_DIR=.vfkb node dist/cli.js add decision "…" --why "…" --role human`
    - `VFKB_DATA_DIR=.vfkb node dist/cli.js add fact|gotcha|pattern "…" --role human [--tags a,b]`
    - `VFKB_DATA_DIR=.vfkb node dist/cli.js add link "…" "<path-or-url>" --role human`
  - **Session END** — leave continuity, then commit the brain:
    `VFKB_DATA_DIR=.vfkb node dist/cli.js resume-note "what the next session should pick up"`
    then `git add .vfkb && git commit` (the brain ships **with** the repo — ADR-0019).
- Git is the source of truth; **only `.vfkb/entries.jsonl` is committed** — `.vfkb/.sessions/`,
  `.signals/`, `index-meta.json` are gitignored (derived/operational, ADR-0019). So **cross-clone
  continuity lives in committed entries + this CLAUDE.md**, not in `resume-note` (session records are
  local). Record durable handoff state as **entries** (e.g. a `fact` tagged `status`/`handoff`), which
  `vfkb resume`'s knowledge bundle surfaces in any clone.
- Ergonomic shortcut (optional): `alias vfkb='VFKB_DATA_DIR=.vfkb node ~/VFKB/vfkb/dist/cli.js'`, or
  `npm link` for a global `vfkb` / `vfkb-mcp`.

## Capturing decisions (standing rule — do this, don't defer)

vfkb is the project's memory, so **decisions must land in it**. There is **no automatic decision
capture** (the `PostToolUse` hook records tool calls, not conceptual choices, and is off here), so
this is a **deliberate discipline**:

- **When a load-bearing decision is made in a session, record it immediately** — prefer the MCP tool
  `mcp__vfkb__kb_add` with `type=decision`, the decision text, `why=<rationale>`, `role=human`
  (CLI equivalent: `vfkb add decision "…" --why "…" --role human`). Don't batch it to "later."
- **Architectural / standard-setting decisions also get an ADR** — `docs/adr/` (Nygard format,
  immutable, ADR-0001) — and link it into the brain (`kb_add type=link → docs/adr/ADR-XXXX-….md`).
  The ADR is the deterministic backstop; the `decision` entry makes it recallable via `kb_search`.
- **Before committing / ending a session:** check no decision went unrecorded, leave a `resume-note`
  for "what's next," then `git add .vfkb && git commit`.
- This is a **prose rule with no Brake** (vfkb's own lesson: an LLM may skip it). The reliable safety
  net is the committed ADR for anything significant; treat the `kb_add` capture as the habit.

## Build / test / run

- `npm run build` → `tsc` → `dist/` (no native modules). `pretest` runs `tsc` first.
- `npm test` → vitest (**95/95** at the 2026-06-28 rebrand). The **fast deterministic gate**.
- **Env caveat:** `npm install` is configured against the corporate Nexus
  (`nexus.optiscangroup.com`) → **ENOTFOUND off-VPN**. `node_modules` here was bootstrapped by
  copying from `~/GitHub/vfkb`. On VPN, a normal install works (or `--registry`).
- **CLI:** `node dist/cli.js <cmd>` — `add|list|search|query|map|context|context init|resume|`
  `resume-note|curate|distill|save|init|import|doctor|hook (session-start|pre-tool-use|post-tool-use|stop|session-end)`.
  Env: `VFKB_DATA_DIR` (brain/data dir; default `~/.vfkb`), `VFKB_PROJECT`, and `VFKB_BUNDLE_DIR`
  (the shared engine bundles — required by the auto-layer, see above). **`VFKB_DIR`/`VFKB_HOME` are
  deprecated aliases** (ADR-0032) — still honored. This repo's live auto-layer now uses the bootstrap +
  `$VFKB_BUNDLE_DIR` (dogfooding the consumer wiring).
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

## Definition of Done (capability level — ADR-0029)

- **A capability is not "done" until its real use-case is simulated end-to-end in a sandbox and
  observed to succeed.** This binds at the **epic / feature / main-group-of-tasks** level — **not**
  every change. Sub-tasks, refactors, comments, formatting, pure-doc edits are **exempt** (they ride
  the unit/integration inner gates).
- **The proof is an agent-driven L4 scenario** — *an e2e test, but driven by you to simulate the real
  use case* — exercising the capability as it'll actually be used (for vfkb, a real agent against the
  real surface), DEMONSTRATED per ADR-0022 (≥2/3). It **must be able to fail** (baseline/contrast/RED
  or a negative case) — *a proof that can't fail proves nothing* (this is what catches bugs, e.g. the
  decision-capture build found a tagless-entry crash + a sandbox repo-leak).
- **Four clauses for every proof form:** isolated from the live/dogfooded system · observed not
  asserted · before declaring done · capable of failing.
- **Proof fits the capability:** agent-facing → agent-driven L4 (default); auto-layer wiring → the
  smoke-gate (ADR-0028); external contract → a Tier-0 probe; structural invariants → unit tests (the
  inner gate, not the capability success criterion). Canonical example: `scenarios/decision-capture.mjs`.

## Commit rules

- **NO AI attribution in ANY commit** — never `Co-Authored-By: Claude/Anthropic`,
  `noreply@anthropic.com`, 🤖, or "Generated with Claude Code". (A global commit-msg hook enforces
  this; honor it — a blocked commit pushes nothing, so verify `git log` after committing.)
- **Always work on a branch — NEVER commit or push directly to `main`.** Every change (code *and*
  docs, incl. RFCs/ADRs) lands on a topic branch and is delivered as a **PR** for the operator to read
  on GitHub. **Definition of Done = the branch is mergeable to `main`** (green tests, review-ready).
- **Always report clickable GitHub URLs after a push** — the **PR URL** plus a `blob` URL for each
  added/changed file the operator will review (RFCs/ADRs especially). Repo: `vilosource/vfkb`.
- **Default (interactive): open the PR and stop for review** — the operator reads it on GitHub and
  merges. **The solo-dev self-merge latitude applies ONLY when the operator explicitly calls out
  autonomous mode** — and even then it stays branch → PR → merge (after green/DoD), never a
  direct-to-`main` commit.

## v2 development — branch discipline (ADR-0036)

**`main` is the released v1 — it never receives v2 work.** v2 (`docs/V2-VISION.md`,
breaking changes explicitly allowed) develops on a dedicated long-lived **`v2`** branch:

- Every v2 initiative branches **from `v2`** and PRs **back into `v2`** — never into
  `main`. Same branch → PR → review discipline as above, just retargeted.
- `main` keeps receiving v1 patches/fixes exactly as before this ADR; merge `main` into
  `v2` after every such fix (not batched) so the two branches never diverge far enough
  for reconciliation to become its own project.
- **Exception: docs.** RFCs, ADRs, and vision/notes docs (incl. `V2-VISION.md` itself)
  are non-breaking and keep landing on `main` via the normal PR flow — writing about a
  decision isn't building it. The rule that matters is **v2 *code* never lands on `main`
  until v2 ships**.
- `v2` gets the **same branch protection as `main`** — no direct pushes, PR required.

Before starting any v2-initiative code (not docs), confirm you're branching from `v2`,
not `main`. Full rationale: [ADR-0036](docs/adr/ADR-0036-v2-two-branch-strategy.md).

## Current state (2026-06-28)

- `main` rebranded **vtfkb → vfkb** (ADR-0026, commit `dc1525a`); 95/95 unit green; ADRs 0001–0026,
  RFCs 001–007.
- **v1 (per-project tier) COMPLETE** (Phases 0–6). **H4 COMPLETE:** Track 1 (session continuity +
  auto-distill/ACE curator, ADR-0020/0021), Track 5 (dockerized L4 substrate, ADR-0022), Track 4
  (6 core scenarios), Track 4b (D-i `verified`-filter; D-iii relabel-on-promotion, ADR-0024; D-iv pi
  live tool-result capture; D-ii context-doc + `kb_context`, ADR-0025). **In-repo H4 frontier is
  EXHAUSTED — no in-order build remains.** The next work is a **new fork → re-ratify the roadmap first**.
  **That fork has started (2026-07-05):** `docs/V2-VISION.md` is the pre-RFC brainstorm,
  `docs/NOTES-multi-agent-concurrency-corner-cases.md` grounds it, and
  [ADR-0036](docs/adr/ADR-0036-v2-two-branch-strategy.md) sets the branch discipline (see the
  "v2 development" section above).
- **Gated (do NOT build on spec):** **S1** embedding reranker (RFC-003 — build only on a 2nd live
  phrasing-robustness miss *or* an explicit request); **P1** Claude-Code per-turn push (ADR-0015
  Tier C — external-blocked upstream). **Parked:** H2 fleet wiring, H3 global tier.
- **Open findings:** (1) Claude Code's PostToolUse hook does **not fire on a FAILED tool call** →
  live *failure*-capture is pi-only (external-block). (2) `tool-gating` (the brain-write block) is
  **flaky on the pi 0.73.1 substrate** — it holds only intermittently (guardrail-integrity issue,
  needs its own investigation; A/B-confirmed not a regression).

## Key files

- `src/storage.ts` (JSONL kernel; `brainDir = VFKB_DATA_DIR || ~/.vfkb`; context spine), `src/engine.ts`
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
