# RFC-010: Consumer integration & distribution contract — `vfkb init` / portable engine / `import` / `doctor`

- **Status:** **Accepted → [ADR-0030](../adr/ADR-0030-consumer-integration-and-distribution.md)** (2026-06-30; FR-2 bundle unknown spike-resolved before acceptance)
- **Date:** 2026-06-30
- **Deciders:** operator + Claude
- **Relates:** [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) (self-hosted design-brain —
  the wiring this generalizes), [ADR-0013](../adr/ADR-0013-no-hard-native-dep.md) (no hard native
  dep — bundling must honour it), [ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md) (the
  auto-layer being scaffolded), [ADR-0027](../adr/ADR-0027-stop-hook-decision-capture-reminder.md)
  (the `Stop` hook the scaffold writes), [ADR-0028](../adr/ADR-0028-sandbox-validate-auto-layer-wiring.md)
  (wiring smoke-gate — the DoD this extends self→consumer), [ADR-0029](../adr/ADR-0029-sandbox-proven-definition-of-done.md)
  (sandbox-proven DoD). Brain: fact `102a92f3` (the consumer-onboarding evidence).

## Context

vfkb runs **automatically** inside this repo because the Claude-Code integration is committed at the
root (`.mcp.json`, `.claude/settings.json`, the `.gitignore` stanza, the committed `.vfkb/`). That
wiring was hand-built **for this repo**, and it is written self-referentially — "this repo runs on
vfkb." vfkb's stated purpose, however, is to be the **per-project knowledge substrate that vfwb and
the agent fleet ground against** (CLAUDE.md; ADR-0028 anticipates the fleet *consuming* the repo).

The first real consumer — **vfwb** — tried to onboard and hit five concrete friction points. Today,
making a *non-self* repo a vfkb consumer is a **manual, undocumented, ~30-minute, copy-paste-hazardous
ritual**, and one step in it is **not portable at all**:

- **The wiring uses relative engine paths.** Verified 2026-06-30: `.mcp.json` runs
  `node dist/mcp-server.js` and all three hooks run `node dist/cli.js …`. These resolve **only when
  the process cwd is this engine repo**. A consumer repo has no `dist/` — it cannot run them. The
  three obvious fallbacks each break something:
  - **absolute path** → not portable across clones / containers / the fleet (ADR-0028 says the fleet
    consumes the repo);
  - **`npm link`** → the global bin may not be on the hook's **non-login `PATH`**;
  - **registry install** → vfkb is **not published**, and `npm install` here targets the corporate
    Nexus → **ENOTFOUND off-VPN** (brain gotcha).
- **`VFKB_DIR` / `VFKB_PROJECT` are hardcoded** inline at ~6 sites across the two files; onboarding
  means find-and-replace `vfkb`→`vfwb` in every one (copy-paste hazard).
- **No way to bring existing knowledge across.** vfwb already has a 67 KB mykb journal + in-repo
  ADRs; onboarding it means hand-writing dozens of `vfkb add` calls or hand-editing JSONL — which the
  PreToolUse write-gate is specifically designed to **prevent**.
- **No compatibility/health check.** The committed `entries.jsonl` envelope (ADR-0011) is coupled to
  engine version, but nothing records *which engine a brain targets*; a consumer can silently bind to a
  stale/incompatible engine. We already tripped a related failure: **two diverged vfkb clones** both
  reporting `0/0` vs origin (stale fetch / dual-clone drift).
- **No consumer-facing doc.** The convention lives in the operator's head and in chat, not on disk.

This is the substrate's **product surface for everyone but this repo**. It is a **new fork** and a
**standard-setting** decision (how *every* consumer integrates and how the engine is *distributed*),
so per process it is an RFC → ADR, ahead of any code, and re-ratifies the roadmap as a new Track.

## Decision (proposed)

Adopt a **consumer integration & distribution contract** with five functional requirements. They form
a **dependency-forced** chain — the priority labels (P0/P1) describe urgency, **not** build order; the
build order is set by what each FR consumes.

### FR-2 — Portable engine resolution (P0 — the blocker, built first)

Kill the hard-coded path with **one env indirection + a self-contained bundle**:

- **Wiring references `node "$VFKB_HOME/vfkb.mjs"`** (and `…/vfkb-mcp.mjs`). Each machine/container
  sets `VFKB_HOME` **once**; **zero machine paths in git**. This is the single indirection point — it
  removes the cwd assumption, the non-login-`PATH` fragility, and the unpublished-package problem at
  once.
- **Ship `vfkb` and `vfkb-mcp` as single-file `esbuild` bundles.** The README already aspires to
  "drops into any node container, zero runtime deps"; make that **literally** true for the MCP server
  too, which currently still needs `@modelcontextprotocol/sdk` + `zod`. A bundle is **`npx`-able from a
  git ref** and **vendorable** for air-gapped / fleet use. Bundling must continue to honour ADR-0013
  (no hard native dep).
- **Dogfood it:** migrate **this repo's own** `.mcp.json` / `.claude/settings.json` to the
  `$VFKB_HOME` form, so the self-host path and the consumer path are the **same** wiring (the
  reference repo proves portability instead of being the one special case).
- **Technical unknown to spike before the ADR:** confirm `@modelcontextprotocol/sdk` + `zod` bundle
  cleanly into a single runnable `vfkb-mcp.mjs`. This is the one real risk in the fork.

### FR-1 — `vfkb init [project-name]` (P1 — built second; consumes FR-2's wiring template)

Run **inside the target repo**; **idempotent**. It:

- writes `.mcp.json` + `.claude/settings.json` (`SessionStart` / `PreToolUse`-gate / `Stop`) using the
  **`$VFKB_HOME` form** from FR-2, with `VFKB_PROJECT` **defaulted from the directory name** (override
  via the arg);
- appends the **`.gitignore` stanza** (`.vfkb/index-meta.json`, `.vfkb/.sessions/`, `.vfkb/.signals/`)
  — matching ADR-0019's committed/derived split;
- creates **`.vfkb/entries.jsonl`** (empty brain);
- drops a **parameterized "how we track work HERE" `CLAUDE.md` / `AGENTS.md` snippet** — the generic
  form of this repo's §"How we track work HERE" + the "Capturing decisions" standing rule, with the
  project name filled in;
- **prints the one manual step** that cannot be automated: approve the project MCP server + hooks on
  the first interactive `claude` (once per machine).

Turns a 30-minute error-prone ritual into one command, and makes the convention **executable instead
of tribal**.

### FR-4 — Brain↔engine version stamp + `vfkb doctor` (P1 — built third; validates FR-1/FR-2 output)

- **Stamp** `schema_version` + `engine_commit` into a **`.vfkb/manifest.json`** (alongside / superseding
  the role of `index-meta.json` for this purpose) so a brain records the engine it targets.
- **`vfkb doctor`** checks: brain↔engine **compat**; wiring **present** & `VFKB_PROJECT` **correct**;
  MCP/hooks **approved**; and **warns on multiple working copies with diverging committed brains** (the
  dual-clone drift hazard already observed). Catches the exact two failure modes already tripped,
  before they corrupt a brain.

### FR-3 — `vfkb import` (P1 — built fourth; independent of FR-1/2/4)

Make "migrate a project to vfkb" a **real verb**, not a clean-slate restart:

- `--from-mykb <workspace|area>` → map mykb entries/journal into vfkb envelopes (decisions→decisions,
  etc.), provenance stamped **`imported`**;
- `--from-adr docs/adr/` → auto-create a **`link`** entry per ADR (exactly what vfkb's own first entry
  is);
- `--from-markdown <file>` → attach a historical doc as a **referenced source**.

All imports route through the engine (honouring the write-gate), stamped `role=import` / provenance
`imported`.

### FR-5 — Consumer-onboarding doc + the contract ADR (P1, cheap — doc built last; ADR framed first)

- A short **`docs/CONSUMER-ONBOARDING.md`** — what FR-1 automates, written down for humans (built
  **after** FR-1 so it documents the real command).
- Formalize this contract as a vfkb **ADR** ("consumer integration & distribution contract") — vfwb
  adopting it is a standard-setting decision. The **ADR is framed first** (decisions before code); it
  may spawn sub-ADRs (e.g. a distribution/bundling ADR distinct from the onboarding ADR).

### Build order (dependency-forced)

```
ADR (FR-5 framing)  →  FR-2 (portable engine + bundles)  →  FR-1 (vfkb init)
   →  FR-4 (manifest + doctor)  →  FR-3 (import)  →  CONSUMER-ONBOARDING.md (FR-5 doc)
```

### Definition of Done (ADR-0029)

The capability is **agent-facing**, so its proof is an **agent-driven L4 / sandbox scenario** that
**must be able to fail**, extending the wiring smoke-gate (ADR-0028) **self → consumer**:

1. run `vfkb init <name>` in a **throwaway, empty consumer repo** (isolated from the live system);
2. set `VFKB_HOME` to the bundle dir;
3. launch a **real agent turn** in that repo and **observe** (not assert): `SessionStart` injects the
   resume/knowledge bundle · the `PreToolUse` gate **blocks** a direct `.vfkb/` write · the MCP `kb_*`
   tools **resolve and answer** · a `kb_add` lands in the new brain;
4. **contrast** (the must-fail arm): the same turn in a repo **without** `vfkb init` shows none of it.

`vfkb doctor` (FR-4) gets a **deterministic** unit/Tier-0 backstop (compat + dual-clone drift), per the
"deterministic backstop > probabilistic gate" rule — it is not left to the L4 harness.

## Consequences

- **Positive:** vfwb (and the fleet) can run vfkb **anywhere but the author's laptop** — this is the
  actual blocker FR-2 removes. Onboarding becomes one command. Existing knowledge migrates instead of
  being abandoned. Two known corruption modes get a guard. The self repo stops being a special case
  (it dogfoods the same `$VFKB_HOME` wiring).
- **Negative / cost:** a build/bundle step enters the release path (esbuild for `vfkb` + `vfkb-mcp`);
  `VFKB_HOME` is a new per-machine setup step (documented, one-time); `manifest.json` adds a derived
  file to the `.vfkb/` contract.
- **Risk:** the MCP-server bundle (SDK + zod into one file) is unproven — **spike before the ADR**. If
  it can't bundle cleanly, FR-2 falls back to a vendored-`node_modules` bundle dir under `$VFKB_HOME`
  (still portable, just not single-file).

## Alternatives considered

- **Status quo (hand-wire each consumer).** Rejected — the documented evidence: ~30 min, undocumented,
  copy-paste-hazardous, and **non-portable** (FR-2's relative paths simply don't run in a consumer
  repo).
- **Absolute engine path in committed wiring.** Rejected — breaks across clones / containers / the
  fleet; bakes a machine path into git.
- **`npm link` / global bin.** Rejected as the primary mechanism — global bin may be absent from the
  hook's non-login `PATH` (fragile, machine-dependent).
- **Publish to a registry.** Rejected for now — vfkb is unpublished and the corporate Nexus is
  ENOTFOUND off-VPN; a git-ref-`npx`-able bundle (FR-2) avoids the registry dependency. (Publishing
  later is compatible with the bundle, not a substitute for it.)
- **Hand-write `vfkb add` calls / edit JSONL to migrate knowledge.** Rejected — defeats the write-gate
  and doesn't scale; FR-3 `import` is the verb.

## Open items

1. ~~**Spike FR-2's MCP bundle**~~ — **RESOLVED (2026-06-30, observed).** `esbuild 0.21.5
   --bundle --platform=node --format=esm` produces a single **1.1 MB** `vfkb-mcp.mjs` with
   `@modelcontextprotocol/sdk` + `zod` inlined and **zero externals**; run from a dir with **no
   `node_modules`** it completed the MCP `initialize` handshake and `tools/list` advertised **all 9
   `kb_*` tools`. So the single-file bundle is feasible — **no vendored-bundle-dir fallback needed**;
   `cli.ts` bundles the same way for `vfkb.mjs`. (Brain: fact `8c547ae0`.) The ADR is no longer
   blocked on this unknown.
2. **`manifest.json` vs `index-meta.json`** — decide whether the version stamp extends the existing
   derived `index-meta.json` or gets its own committed/derived split (it must not become a hand-edited
   committed file that drifts).
3. **mykb→vfkb mapping fidelity** (FR-3) — confirm the journal/area model maps cleanly onto vfkb
   envelopes; decide what is dropped (lossy projection, like vfwb's own).
4. **`VFKB_HOME` bootstrap UX** — where the bundle lives by default and how `vfkb init` points a fresh
   machine at it (the one step `init` can only *print*).
5. **Accept → ADR(s)** and re-ratify `docs/H4-DEVELOPMENT-ROADMAP.md` with **Track 7: Consumer
   Distribution & Onboarding** before building.
