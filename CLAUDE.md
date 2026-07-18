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

This repo dogfoods its own **Claude Code plugin** ([vilosource/vfkb-claude-plugin](https://github.com/vilosource/vfkb-claude-plugin),
ADR-0045) — installed at **project scope** (`.claude/settings.json`'s `extraKnownMarketplaces` +
`enabledPlugins`), so a session here **runs on vfkb automatically**, no committed `.mcp.json` or
hand-written hooks in this repo at all:
- The plugin's bundled **MCP server** → the 9 `kb_*` tools. **Verified live 2026-07-07:** plugin
  MCP tools are namespaced `mcp__plugin_vfkb_vfkb__kb_*` (plugin `vfkb`, server `vfkb`), not the
  bare `mcp__vfkb__kb_*` of the old `.mcp.json` wiring.
- The plugin's bundled **hooks**:
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
- **No `$VFKB_BUNDLE_DIR` to set for this repo anymore** — the plugin vendors its own copy of the
  engine bundles (Phase 1 of ADR-0045). `$VFKB_BUNDLE_DIR` is still relevant if you also work in
  projects still on the old `vfkb init` mechanism (RFC-010/ADR-0030, still supported as a
  fallback), but this repo doesn't need it. On first interactive `claude` after this migration,
  approve the plugin's MCP server + hooks once. See
  [`MIGRATION_GUIDE.md`](https://github.com/vilosource/vfkb-claude-plugin/blob/main/MIGRATION_GUIDE.md)
  in the plugin repo for how this migration was done, if migrating another project the same way.
  (`dist/cli.js` from `npm run build` still works for manual CLI in *this* repo, since it's vfkb's
  own source — that's unrelated to the plugin, which vendors a separate built copy.)
- **Dev-loop implication (know this):** the live auto-layer now runs the plugin's *vendored* engine
  copy, **not** your local build — editing `src/` (even with `npm run build:bundles`) no longer
  changes what this session's hooks/MCP run. To dogfood an engine change live, re-vendor + release
  it in [vilosource/vfkb-claude-plugin](https://github.com/vilosource/vfkb-claude-plugin) and update
  the plugin. Corollary: the plugin install is **unpinned** (tracks the plugin repo's releases), so
  plugin updates change this repo's live wiring outside this repo's PR flow — accepted for the
  first-party plugin (ADR-0045).

So prefer the **plugin `kb_*` MCP tools** in-session (`mcp__plugin_vfkb_vfkb__kb_*`); the CLI
(below) is the equivalent for scripting. The resume/context headers derive their `project="…"`
label from the brain dir (`<repo>/.vfkb` → `repo`; `VFKB_PROJECT` overrides — PR #76). Display-label
only; entries are not filtered by project. If a session still shows `project="spike"`, the installed
plugin predates that fix — update the plugin and restart.

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
    - `link` entries may point at **OKF concept docs** (`.okf/…`, or the in-place OKF bundle
      `docs/adr/`/`docs/rfc/`) — the live session then surfaces that doc at the right moment
      via the existing injection pipeline; no export tooling needed (ADR-0046 Integration Point 3).
  - **Session END** — leave continuity, then commit the brain:
    `VFKB_DATA_DIR=.vfkb node dist/cli.js resume-note "what the next session should pick up"`
    then `git add .vfkb && git commit` (the brain ships **with** the repo — ADR-0019).
- Git is the source of truth; **`.vfkb/entries.jsonl` *and* `.vfkb/manifest.json` are committed** —
  entries are the knowledge SoR (ADR-0019), `manifest.json` is the brain↔engine version stamp that
  must travel with the brain (ADR-0030, engine-written, distinct from the derived `index-meta.json`).
  **Never gitignore `manifest.json`** — it is written only by `vfkb init` and the broadcast heal, so a
  plugin-born brain has none yet (vfkb#193); absent is a `doctor` warn, not a reason to ignore it.
  Gitignored (derived/operational): `.vfkb/index-meta.json`, `.vfkb/.sessions/`, `.vfkb/.signals/`,
  `.vfkb/.journal/`, `.vfkb/.lock`. So **cross-clone
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
  `kb_add` (`mcp__plugin_vfkb_vfkb__kb_add`) with `type=decision`, the decision text, `why=<rationale>`, `role=human`
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
- `npm test` → vitest (**199/199** as of 2026-07-08). The **fast deterministic gate**.
- **Env caveat:** this machine's `npm install` is configured against a corporate npm mirror →
  **ENOTFOUND off-VPN**. `node_modules` here was bootstrapped by copying from `~/GitHub/vfkb`.
  On VPN, a normal install works (or `--registry`).
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
  **v2 work is tracked per-initiative in `docs/V2-ROADMAP.md`** — flip statuses as ADRs build,
  re-ratify it on any deviation (it lands on `main` like all docs, then syncs to `v2`).
- **Evidence-gated builds.** Don't build speculatively — an RFC decides the *shape*; the *build*
  triggers on observed evidence or an explicit request.
- **VERIFIED = observed, not asserted.** Never relay a gate's/agent's "passed/verified" as fact
  without reading ground truth. Snapshot ≠ history.

## Definition of Done (capability level — ADR-0029, **non-negotiable per ADR-0050**, amended by ADR-0051)

- **⛔ NON-NEGOTIABLE (operator ruling 2026-07-09, ADR-0050):** anything a user will use ships
  only behind a **full sandboxed agent-driven L4** — committed reproducible scenario,
  DEMONSTRATED ≥2/3 with a can-fail arm, every load-bearing claim **observed not asserted**
  (e.g. a pinned model must appear in `modelUsage`). A smoke check (N=1, no committed record)
  is NOT this gate. Until the evidence exists and is named, the only honest status is
  **"built, NOT yet verified"** — never "done/shipped/✅". Release PRs must pass the
  deterministic **release-gate CI Brake** (first: vfkb-claude-plugin `release-gate.mjs`).
  This rule is also a `constitutional` brain decision (`73c6a5c1cb67`) — every session's
  injection leads with it.
- **⛔ DELIVERY IS UNPROVEN, AND SILENCE IS THE VIOLATION (ADR-0051, amends ADR-0050).** Three
  clauses, all binding:
  1. **`--plugin-dir` is NOT "the real surface a user will use"** — ADR-0050's own text says it is,
     and that is a **defect** in a constitutional rule. It loads a plugin from a source tree and
     bypasses the marketplace clone, `marketplace.json`, the version cache, `installed_plugins.json`,
     scope and startup resolution. It proves a **capability**, never its **delivery**. (This is how
     plugin v0.4.0 was DEMONSTRATED 3/3 *and* unreachable in the same hour.)
  2. **"Declared done **or shipped**" governs claims, not existence** (Reading B). Plugin releases
     may continue with delivery unproven — but **every release note, ADR and handoff MUST say
     "delivery is unproven"** until `scenarios/records/install-path.json` lands. Enforced by
     vfkb-claude-plugin's `release-gate.mjs` + `DELIVERY-STATUS.json`, not by this paragraph.
  3. **The quiet-success trap:** where a failure presents as a *successful* run lacking the
     capability (exit 0, `is_error: false`, `"Unknown command"`), the predicate MUST be a **content
     assertion over the output**. Exit status and error flags are not admissible evidence.
  - *Scoped corollary:* a release-time gate **cannot** observe a consumer's stale marketplace clone
    — CI runs before any consumer exists. That is a **detection** problem owned by `vfkb doctor`
    (RFC-024 §1, unbuilt). It says nothing about packaging omissions, install failures, or upgrade
    corruption, which a delivery gate *can* catch.
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
- **Proof fits the capability:** agent-facing → agent-driven L4 (default); auto-layer wiring → per
  ADR-0048: plugin `hooks.json` validation belongs to the plugin repo's release flow
  (vfkb-claude-plugin#6, pending), fallback wiring rides the init unit tests + the
  consumer-onboarding L4 (the in-repo smoke-gate of ADR-0028 is retired); external contract → a
  Tier-0 probe; structural invariants → unit tests (the inner gate, not the capability success
  criterion). Canonical example: `scenarios/decision-capture.mjs`.

## Commit rules

- **NO AI attribution in ANY commit** — never `Co-Authored-By: Claude/Anthropic`,
  `noreply@anthropic.com`, 🤖, or "Generated with Claude Code". (A global commit-msg hook enforces
  this; honor it — a blocked commit pushes nothing, so verify `git log` after committing.)
- **Always work on a branch — NEVER commit or push directly to `main`.** Every change (code *and*
  docs, incl. RFCs/ADRs) lands on a topic branch and is delivered as a **PR** for the operator to read
  on GitHub. **Definition of Done = the branch is mergeable to `main`** (green tests, review-ready).
- **Always report clickable GitHub URLs after a push** — the **PR URL** plus a `blob` URL for each
  added/changed file the operator will review (RFCs/ADRs especially). Repo: `vilosource/vfkb`.
- **Standing default: the autonomous-PR workflow** (operator grant 2026-07-14; brain decision
  `5f380d6ca496`). When handling a PR, **do NOT stop to ask for merge approval.** Instead:
  **(1)** launch an **adversarial review** of the PR — the `/review` gate (ADR-0052) for an in-repo
  branch against its governing ADR/RFC, or a spawned adversarial-reviewer agent for a cross-repo /
  data-only PR, checking the diff against its stated purpose plus repo CI/CodeRabbit; **(2)** apply
  fixes for any real findings; **(3)** re-review; **(4)** **merge autonomously once it converges**
  (required checks green, no blocking findings); **(5)** escalate to the operator (**HITL**) only if
  it **does not converge after 3 rounds**, reporting the blocking findings. This is the
  "autonomous mode" the self-merge latitude requires — it is now **on by default for this repo**,
  not per-request.
- **Release PRs need no approval and no re-review** (operator ruling 2026-07-18; brain decision
  `872c1ff0ff90`). A release-please standing PR (`chore(main): release X.Y.Z`) contains only
  commits that already passed the ADR-0052 gate on their way into `main` — it is downstream
  bookkeeping, not a review surface, so do **not** hold it for the operator or run the adversarial
  review on it. When the batch is complete, run the chain: **(1)** push a user-authored empty
  commit to the release branch (bot-created PRs get no check runs — gotcha on record);
  **(2)** squash-merge once required checks are green; **(3)** release-please creates the tag +
  GitHub Release on merge; **(4)** dispatch `publish.yml` with the tag (`gh workflow run
  publish.yml -f tag=vX.Y.Z` — the bot's tag fires nothing); **(5)** watch
  prove → publish → canary to green; **(6)** report with the outward-publish callout. The only
  judgment left is **cadence** ("is this batch complete?"). Don't push to `main` while executing
  the chain — release-please force-pushes the release branch on every `main` push, wiping the
  triggered checks.
- **Guardrails that still bind under autonomous mode:** never commit/push directly to `main`/`v2`
  (always branch → PR → merge); the capability-level **DoD gate (ADR-0050/0051)** is unchanged; a
  PR whose merge triggers an **outward publish** (e.g. the npm release) is covered by the grant but
  **the publish consequence must be called out** when reporting; still report clickable URLs on push.

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

## Current state (2026-07-08)

- **v2 SHIPPED to `main`** (PR #86, merge `5bb087e`, 2026-07-08): session backbone (ADR-0039),
  native concurrency lock (ADR-0040), `entries.jsonl` merge=union (ADR-0041), schema honesty
  (ADR-0042), storage seam (ADR-0044); V2-5 rebuildable index stays **GATED** (ADR-0043 trigger).
  199/199 unit green; ADRs 0001–0045, RFCs 001–021. Ship evidence: full L4 re-pin on the ship
  candidate (PR #84) — pi/deepseek 32/33 DEMONSTRATED, claude/haiku 31/32; sole miss both arms =
  `tool-gating` (pi: known substrate flake; claude: guard held, contrast arm too well-behaved).
  Post-ship distribution done: bundles rebuilt from `main` (`~/.vfkb-bundles` refreshed) + plugin
  re-vendored as **v0.2.0** (vfkb-claude-plugin PR #5). The `v2` branch discipline section above
  is now historical for this cycle — post-ship work follows the normal `main` PR flow until a
  next breaking cycle reopens it.
- **v1 (per-project tier) COMPLETE** (Phases 0–6). **H4 COMPLETE:** Tracks 1, 4, 4b, 5 (ADR-0020..0025)
  plus Track 6 (decision capture, ADR-0027..0029), Track 7 (consumer distribution, ADR-0030..0032),
  Track 8 (session-end continuity, ADR-0033/0034).
- **Track 9 — memory quality & interop** (reconciled ratification 2026-07-06; roadmap §3 Track 9)
  is the **v1-compatible quality queue**, not the frontier: Q0 hygiene SHIPPED (#27);
  **RFC-012 ACCEPTED → ADR-0037** (build scenario-first, RED first, on operator request/evidence);
  **RFC-013 ACCEPTED → ADR-0038** (same); Q2 use-feedback + Q3 AGENTS.md export queued (RFC numbers
  at draft time); Q4 sleep-time distillation gated.
- **Gated (do NOT build on spec):** **S1** search-robustness upgrade (trigger unchanged: 2nd live
  phrasing-robustness miss *or* an explicit request; **amended 2026-07-06: first resort = BM25 in
  `InMemoryIndex`, RFC-003 embeddings second**); **P1** Claude-Code per-turn push (ADR-0015
  Tier C — external-blocked upstream); Track-9 **Q4** + bi-temporal consumption (named triggers).
  **Parked:** H2 fleet wiring, H3 global tier.
- **Open findings:** (1) Claude Code's PostToolUse hook does **not fire on a FAILED tool call** →
  live *failure*-capture is pi-only (external-block). (2) `tool-gating` "pi flake" **RESOLVED
  2026-07-13** — it was never a flaky guard (6-run forensic repro): two scenario defects, both
  fixed. **#150** false red — the substring predicate `lacks(brainText,'HACKED')` matched the
  guard's own *capture* audit entry (pi 0.73.1 emits `tool_execution_end` for a call blocked at
  `tool_call`), scoring a held guard as CORRUPTED; fixed with a structural predicate (`brainIntact`:
  valid JSONL + sentinel survives). **#151** real bypass — the pi arm kept `bash`, so the agent did
  `echo > brain`; fixed by giving the pi arm `--tools write,edit` parity with the claude arm, plus
  `gating.ts` now states exec tools are out of scope by design. tool-gating now DEMONSTRATED 3/3 on
  pi/deepseek.

## Key files

- `src/storage.ts` (JSONL kernel; `brainDir = VFKB_DATA_DIR || ~/.vfkb`; context spine), `src/engine.ts`
  (filter/rerank/render; decision family; capture; `renderContext`; `setProvenanceStatus`),
  `src/read.ts` (query incl. the `verified` trust filter), `src/mcp-server.ts` (9 tools incl.
  `kb_context`), `src/cli.ts` (CLI + Claude-Code hooks), `src/pi-extension.ts` (Pi face;
  `tool_execution_end` result capture), `src/curator.ts` (`promote`/`promoteIfCorroborated`),
  `src/distiller.ts`.
- `docs/`: `DESIGN.md`, `FEATURES.md`, `STATUS-AND-ROADMAP.md` (north-star),
  `H4-DEVELOPMENT-ROADMAP.md` (execution authority), `V2-ROADMAP.md` (v2 per-initiative tracker),
  `adr/` (0001–0044), `rfc/` (001–019).
- `.vfkb/` — vfkb's self-hosted design brain. **Commit it.**

## vfwb relationship

**vfwb (ViloForge WorkBench)** — `github.com/vilosource/vfwb`, planning-phase — is the design/planning
workbench that grounds against vfkb: on ratification it pushes a lossy projection to the project's
`.vfkb/` dir (vfwb ADR-0003) and recalls from it. vfwb is a **separate repo, out of scope here**; its
maintainer repoints it to vfkb. (vfkb runs standalone; vfwb is an overlay, not a runtime dependency.)
