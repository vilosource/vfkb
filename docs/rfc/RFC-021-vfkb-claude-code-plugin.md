# RFC-021: vfkb as a Claude Code plugin — the primary distribution path for the Claude Code harness face

- **Status:** Proposed — Phase 0 verified 2026-07-07 (see Decision), pending operator ratification
- **Date:** 2026-07-07
- **Deciders:** operator + Claude
- **Relates:** [ADR-0030](../adr/ADR-0030-consumer-integration-and-distribution.md) (`vfkb init` /
  portable engine — the mechanism this becomes primary alongside, not a replacement for),
  [ADR-0035](../adr/ADR-0035-hooks-anchor-to-project-dir.md) (hook commands anchor to
  `${CLAUDE_PROJECT_DIR:-.}`, never implicit cwd — the exact discipline this RFC reuses for
  plugin-bundled hooks), [ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md) (cross-harness
  auto-layer — establishes the harness-face separation this RFC extends, not replaces),
  [RFC-020](RFC-020-layered-knowledge-capture-understand-publish.md) (OKF integration — explicitly
  sequenced *after* this RFC; its proposed `vfkb:okf` skill depends on the plugin scaffold this
  RFC builds; still on its own open [PR #71](https://github.com/vilosource/vfkb/pull/71) as of
  this writing — if this RFC merges first, that relative link 404s on `main` until #71 also lands)

## Context

vfkb today is "one engine + two harness faces (Claude Code hooks via `src/cli.ts`, the Pi
extension) + an MCP server" (`CLAUDE.md`), distributed for Claude Code via the npm package
(`@vilosource/vfkb`) plus a bespoke `vfkb init` step (RFC-010 → ADR-0030) that hand-writes
`.mcp.json` and `.claude/settings.json` hook entries into each consuming project, resolving
vfkb's pre-built, harness-agnostic engine bundles (`dist/bundles/vfkb.mjs`, `vfkb-mcp.mjs`) via
`$VFKB_BUNDLE_DIR`. This works, but every consumer repeats the same manual init step, and there is
no interactive, human-facing entry point beyond the raw CLI — a human today either runs `vfkb`
commands directly or asks an agent to do it via MCP tools built for agents, not for direct human use.

Separately, Claude Code has a native plugin/marketplace system this session verified directly
(not just from docs):

- A single plugin can ship multiple distinctly-namespaced skills — `skills/<name>/SKILL.md` →
  `/plugin-name:skill-name` (the pattern already visible in this session as
  `understand-anything:understand`, `understand-anything:understand-chat`).
- A plugin can bundle its own MCP server declaration, resolved via a `${CLAUDE_PLUGIN_ROOT}` path
  variable, **auto-registered on install** — no `.mcp.json` hand-editing.
- A plugin can bundle its own `hooks/hooks.json` (SessionStart, PreToolUse, Stop, SessionEnd,
  etc.), **auto-wired on install** — no `.claude/settings.json` hand-editing.
- A previously-reported gap in `$CLAUDE_PROJECT_DIR` propagation specifically inside
  plugin-provided hooks ([GitHub issue #9447](https://github.com/anthropics/claude-code/issues/9447))
  is **closed**, with a corroborating comment that it was fixed as of Claude Code v2.0.45; this
  environment runs v2.1.202. This session independently reproduced the fix first-party rather than
  trusting the issue thread alone — see the verified precondition below.

vfkb already has exactly the discipline this needs. ADR-0035 exists *because* `vfkb init`'s
original hook commands used CWD-relative paths and broke when a session's cwd left the repo root
— the fix was anchoring every hook command explicitly to `${CLAUDE_PROJECT_DIR:-.}`, never
implicit cwd. The same pattern applies directly here: a plugin-bundled hook resolves the *engine
code* from `${CLAUDE_PLUGIN_ROOT}` (where the plugin is installed) but must still resolve the
*data directory* (`VFKB_DATA_DIR`) from `${CLAUDE_PROJECT_DIR:-.}` (the project actually being
worked on) — two independent path roots that must not be conflated.

This repo already solved an analogous scoping problem once: the npm package's `package.json`
`"files": ["dist"]` field ensures `npm publish` ships only the built engine, never `src/`, `test/`,
`scenarios/`, or this repo's own `.vfkb/entries.jsonl` design brain. A Claude Code plugin needs the
equivalent guarantee, confirmed available — see the Decision's scoping requirement below.

This pattern is not Claude-Code-specific. **Google Antigravity** — a second, independently-built
coding harness (Go-based CLI + IDE, successor lineage to Gemini CLI) — converged on a nearly
identical plugin shape: "namespaced directory bundles containing skills, rules, lifecycle hooks,
and MCP server definitions" as one deployable unit, with its own documentation naming Cursor and
Claude Code as sharing the same idea. The operator has flagged Pi and Antigravity as future
harness targets (not built now, but designed for) — Antigravity's independent convergence on this
shape is evidence this is a genuine cross-harness packaging pattern, not a one-off worth
special-casing.

## Decision

Ship a `vfkb` Claude Code plugin from this repo, alongside the existing npm package — not a
separate repo — as the **primary, recommended** distribution path for the Claude Code harness
face. `.claude-plugin/marketplace.json` sits at the repo root (as is typical); its plugin entry's
`"source"` is scoped to a dedicated subdirectory containing `plugin.json`, the skill,
`hooks/hooks.json`, and the bundled MCP declaration (see the verified Scoping requirement below) —
never the repo root itself.

The plugin bundles exactly three things, all resolving vfkb's **existing** harness-agnostic
engine bundles — no new engine code:

1. A human-facing **skill** (+ slash commands; exact naming left to implementation) becoming the
   primary interactive entry point for a *human* working with vfkb directly (resume, add, search,
   etc.). The skill orchestrates calls into the existing CLI/MCP surface — it does not reimplement
   engine logic in prose.
2. A bundled **MCP server** declaration pointing at
   `${CLAUDE_PLUGIN_ROOT}/dist/bundles/vfkb-mcp.mjs`, auto-registered on install — the same 9 MCP
   tools as today, remaining the primary entry point for *agents*, with zero `.mcp.json`
   hand-editing.
3. A bundled `hooks/hooks.json` declaring SessionStart / PreToolUse / Stop / SessionEnd, pointing
   at `${CLAUDE_PLUGIN_ROOT}/dist/bundles/vfkb.mjs cli hook <sub>`, with `VFKB_DATA_DIR` built from
   `${CLAUDE_PROJECT_DIR:-.}` exactly per ADR-0035's existing discipline — auto-wired on install,
   with zero `.claude/settings.json` hand-editing.

**`vfkb init` (RFC-010/ADR-0030) is not retired.** It remains available as a fallback for
environments where installing a Claude Code plugin isn't possible or wanted — CI, scripted /
non-interactive environments, or a future harness with no plugin concept at all. The plugin
becomes the default *recommendation* for interactive Claude Code CLI users, not the only
supported path.

**Scoping requirement — VERIFIED 2026-07-07.** A marketplace's plugin entry can set `"source"` to
a subdirectory path (e.g. `"./plugin"`), not just the repo root. A live install test (a throwaway
marketplace + plugin, with sibling `test/`, `scenarios/`, and `.vfkb/entries.jsonl`-equivalent
files placed *outside* the sourced subdirectory) confirmed the installed cache
(`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`) contained **only** the scoped
subdirectory's files — none of the sibling content leaked in. No dedicated release branch/tag is
needed: the plugin manifest, skill, `hooks/hooks.json`, and a copy of `dist/bundles/*.mjs` can live
in a dedicated subdirectory of this same repo (exact path TBD at implementation time), with
`marketplace.json`'s `source` scoped to it — the same effective guarantee `"files": ["dist"]`
gives the npm package, achieved a different way.

**Explicit boundary (non-goal):** this RFC does not modify `src/engine.ts`, `src/storage.ts`,
`src/cli.ts`, or `src/mcp-server.ts`. It is packaging only, reusing exactly what
`npm run build:bundles` (ADR-0030) already produces. This is deliberate: keeping the shared engine
untouched is what makes a future Pi-native or Antigravity packaging effort "write a new thin
wrapper around the same bundles" rather than "redo this analysis."

**Precondition for acceptance — VERIFIED 2026-07-07, CLI v2.1.202** (not assumed from the closed
GitHub issue alone). A throwaway probe plugin (`--plugin-dir`, session-scoped, no persistent
install) with a bundled `SessionStart` hook and a bundled MCP server was run against a real
throwaway project directory. Result, with an important implementation detail the design must
follow exactly:

- **Hooks:** `${CLAUDE_PROJECT_DIR}` and `${CLAUDE_PLUGIN_ROOT}` both correctly resolve when
  referenced directly inside the hook's command string (Claude Code exports them into the shell
  environment the command runs in). Confirmed twice, consistent.
- **MCP servers:** `$CLAUDE_PROJECT_DIR` / `$CLAUDE_PLUGIN_ROOT` are **not** inherited as general
  process environment variables — a bundled MCP server process that reads them directly from its
  own environment will find them unset. **However**, when `${CLAUDE_PROJECT_DIR}` /
  `${CLAUDE_PLUGIN_ROOT}` are used as *template values inside the MCP server's own `"env"` field*
  in `.mcp.json` (e.g. `"VFKB_DATA_DIR": "${CLAUDE_PROJECT_DIR}/.vfkb"`), Claude Code substitutes
  the real value at config-resolution time before spawning the process, and it resolves correctly.

**Implication for Phase 1:** the bundled MCP server declaration must set `VFKB_DATA_DIR` via the
`env` field's own template substitution, not assume the running `vfkb-mcp.mjs` process can read
`$CLAUDE_PROJECT_DIR` itself. The bundled hook commands may continue to reference
`${CLAUDE_PROJECT_DIR:-.}` directly, per ADR-0035's existing pattern, unchanged.

## Alternatives Considered

- **Keep `vfkb init` as the only mechanism** — rejected as insufficient, not wrong: it works, but
  repeats a manual step per project and has no human-facing interactive surface beyond raw CLI
  commands; the ecosystem (Claude Code, Antigravity) is converging on plugin-based distribution as
  the smoother path.
- **Retire `vfkb init` immediately** — rejected/deferred: no evidence yet that CI, scripted, or
  non-interactive consumers are well served by plugin-only installation. Keep both; revisit
  retirement later if plugin adoption proves complete, per this repo's evidence-gated-builds rule.
- **Write new, plugin-specific engine/CLI/MCP code instead of reusing the existing bundles** —
  rejected: duplicates already-tested ADR-0030 infrastructure for no benefit, and would violate the
  harness-agnostic-core boundary this design exists to protect.
- **Design narrowly for Claude Code only, ignore Antigravity's parallel shape** — rejected:
  Antigravity independently converged on an almost identical plugin shape; designing with that
  portability in mind now is low-cost and pays off if a second harness plugin is ever built.
- **Source the plugin from the repo root with no scoping** — rejected: would ship this repo's full
  dev tree (tests, scenarios, internal design docs, `.vfkb/entries.jsonl`) to every plugin
  consumer. Phase 0 confirmed `marketplace.json`'s `source` field supports subdirectory scoping
  instead, so this is avoidable without a separate repo/branch.
- **Bundle this RFC together with RFC-020's OKF integration as one proposal** — rejected: they are
  separable concerns (this RFC is pure distribution/packaging; RFC-020 is a knowledge-management
  layering decision) that happen to have a one-way dependency (RFC-020's `vfkb:okf` skill needs
  this RFC's plugin scaffold to exist, not the reverse). Sequencing them as two independently
  reviewable documents matches this repo's existing practice (e.g. RFC-018/RFC-019 deliberately
  stayed separate despite sharing a seam).

## Definition of Done

- **Phase 0 — DONE, verified 2026-07-07 (CLI v2.1.202):**
  1. Live empirical probe: hooks resolve `${CLAUDE_PROJECT_DIR}`/`${CLAUDE_PLUGIN_ROOT}` directly;
     MCP servers need them template-substituted via the `.mcp.json` `env` field instead of reading
     inherited process env. See the Decision section for the full result.
  2. Install-scoping probe: `marketplace.json`'s `source` field scopes correctly to a subdirectory;
     confirmed no sibling files leak into the installed cache. See the Scoping requirement above.
- **Phase 1 (implementation, after acceptance):** build `.claude-plugin/marketplace.json` +
  `plugin.json` + the skill + `hooks/hooks.json` + the bundled MCP declaration, all resolving
  `${CLAUDE_PLUGIN_ROOT}`-relative paths into the existing `dist/bundles/*.mjs`. No engine changes.
  Plugin version updates reuse the existing `.vfkb/manifest.json` engine/schema-version
  compatibility contract (ADR-0030) unchanged — no new versioning scheme introduced for the
  plugin path.
- **Full testing regimen:** unit/integration coverage for any new glue code, plus an agent-driven
  L4 scenario (ADR-0022/0029) proving a plugin-installed vfkb behaves identically to an
  `vfkb init`-wired vfkb for a real session — a fresh sandbox installs only the plugin (no
  `vfkb init` run), and a live agent session demonstrates resume/capture/hook behavior matching
  today's `vfkb init`-wired L4 scenarios. Must be able to fail (a no-plugin contrast arm, or a
  deliberately-misconfigured plugin arm).
- **Dogfood before calling it done:** install the plugin on a real consumer before broader
  rollout. `okf-skill`'s own repo — which already runs vfkb via the current `vfkb init` mechanism
  — is a natural first real-world install target.

## Open Items

- Exact skill/slash-command naming and surface (one skill vs. several) — left to implementation,
  not blocking this RFC's shape.
- Whether/when `vfkb init` is ever fully retired for Claude Code specifically — deferred; revisit
  once plugin adoption is proven, not decided here.
- How a future Pi-native or Antigravity packaging would concretely reuse this design is out of
  scope to solve now. The Decision's "packaging-only, bundles-reused" boundary is meant to make
  that future work tractable, but Antigravity's hook model is more granular (`SessionContext` /
  `TurnContext` / `OperationContext`) than Claude Code's flatter per-event hooks — worth
  re-checking against Antigravity's actual manifest format if/when that work is ever attempted,
  not assumed to map 1:1.
- Whether a Node.js runtime can be assumed available in other future-harness environments —
  relevant only if/when a non-Claude-Code packaging is attempted; not resolved here.
- RFC-020 (OKF) stays sequenced strictly after this RFC per the operator's explicit
  prioritization; this RFC does not restate RFC-020's content, only the dependency direction.
