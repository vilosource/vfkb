---
type: Proposal
title: "RFC-037: The pi face is built but undeliverable — pi grew a package system and vfkb has no presence in it"
description: "Research against pi 0.73.1 found the pi extension code broadly correct and the premise of its MCP bridge intact, while pi grew a full package/marketplace system (pi install npm:/git:, project-scoped .pi/settings.json, a public gallery) that vfkb has zero presence in. The only load path today is `pi -e /abs/path`, which is the ADR-0051 --plugin-dir trap exactly. Proposes a separate vfkb-pi-package repo mirroring vfkb-claude-plugin, with delivery — not capability — as milestone 1."
status: "Proposed"
timestamp: 2026-07-22
---

# RFC-037: The pi face is built but undeliverable

- **Status:** Proposed — needs operator ratification before any build
- **Relates:** [ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md) (the tiered
  parity model that defines what the pi face owes);
  [ADR-0045](../adr/ADR-0045-vfkb-claude-code-plugin.md) (the plugin split this mirrors);
  [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) /
  [ADR-0051](../adr/ADR-0051-delivery-honesty.md) (delivery is a capability and needs its own
  proof); [RFC-036](RFC-036-machine-produced-release-evidence.md) (the credential bottleneck
  this face escapes)
- **Brain:** research `16b8b6b018ea`; initiative shape `ae6feb81c738` (supersedes `d4864f7fa6de`)

## Context — what the research actually found

The pi face was last touched in the H4 era and has had no attention through the whole
Claude-Code-plugin cycle. The expected finding was a rotted extension chasing a moved API.
That is **not** what is there. All of the following was observed against the globally installed
`@mariozechner/pi-coding-agent@0.73.1`, its shipped `docs/`, and
`dist/core/extensions/types.d.ts` — not inferred:

- **No version drift.** npm latest **is** 0.73.1 — the exact version vfkb's contract was
  verified against and the version pinned in `scenarios/docker/pi.Dockerfile`.
- **The MCP bridge's premise holds.** pi still ships no built-in MCP, stated twice in-package:
  `docs/usage.md:275` and `README:470` ("No MCP. ... build an extension that adds MCP support").
- **Tier-C injection still works.** `convertToLlm()`'s `custom` branch still maps
  `role:"custom"` to a `role:"user"` message, which is the mechanism `pi-extension.ts` relies on.

So the code is not the problem. What moved underneath vfkb is **distribution**.

## The gap — pi grew a marketplace and vfkb is not in it

`docs/packages.md` documents a full Claude-Code-plugin-equivalent distribution system:

- `pi install npm:@scope/pkg@1.2.3` · `git:github.com/user/repo@v1` · local paths
- global `~/.pi/agent/settings.json` vs **project `.pi/settings.json`** — team-shareable, and
  **pi auto-installs missing packages on startup**
- a `pi` manifest key in `package.json` declaring `extensions` / `skills` / `prompts` / `themes`,
  plus convention directories
- `pi list | remove | update`, per-package resource filtering, scope dedup (project wins)
- a public gallery at `pi.dev/packages` keyed on the `pi-package` keyword

vfkb has nothing in any of it, and this is verifiable rather than impressionistic. `src/init.ts`
writes eight paths (`changes.push` call sites at `src/init.ts:149-305`): `.vfkb/entries.jsonl`,
`.vfkb/manifest.json`, the bootstrap file, `.mcp.json`, `.claude/settings.json`, `.gitignore`,
`.gitattributes`, `AGENTS.md` — of which the only **harness wiring** is Claude Code's. There is
no `.pi/settings.json` writer and no pi package reference. `src/doctor.ts` has **zero** pi
awareness (no occurrence of `pi-extension` or `.pi/`). The only way to load vfkb into pi today is:

```bash
pi -e /abs/path/to/vfkb/dist/pi-extension.js
```

### The one thing that *does* already reach pi

`vfkb init` writes `AGENTS.md`, and pi loads it: `dist/core/resource-loader.js:31` reads
`["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]`, and `docs/usage.md:95-97` documents
discovery from the project tree and `~/.pi/agent/AGENTS.md`. So a vfkb-initialised repo **already
gives pi a static, cold knowledge floor** with no extension installed at all.

That floor is real and should be stated honestly in the package README — but it is a *snapshot*,
not the auto-layer: no resume digest, no per-turn delta, no capture, no gating, no supersession.
Naming it matters because it is the correct **contrast arm** for the L4 in D4 — "vfkb installed"
must be shown to beat "AGENTS.md only", not merely to beat nothing.

**Under ADR-0051 clause 1, `pi -e <path>` is the `--plugin-dir` trap verbatim.** It loads an extension from
a source tree and bypasses package resolution, settings scope, the install cache, and startup
discovery. It proves a **capability** and says nothing about **delivery**. The pi face is in
exactly the state the Claude plugin was in when the operator ruled on it — with the difference
that nobody has yet claimed otherwise, so no disclosure has been violated.

### What this is *not*

The Claude side's delivery debt is **paid**, and this RFC does not rest on it being open.
`vfkb-claude-plugin/scenarios/records/install-path.json` is DEMONSTRATED and version-bound to
plugin `0.12.0` (fresh 3/3 `present+treeVerified`; upgrade 3/3
`absentBefore→presentAfter+treeVerifiedAfter`; contrast 3/3 observed failing with the literal
`"Unknown command: /vfkb:brief"`), and `DELIVERY-STATUS.json` reads `"delivery": "proven"`.
An earlier draft of the initiative decision claimed otherwise; it was corrected on the record
(`d4864f7fa6de` → `ae6feb81c738`) rather than quietly fixed.

## Capability surface vfkb currently forgoes

The real `ExtensionAPI` (`dist/core/extensions/types.d.ts:783-937`) exposes **29 events and 22
methods**. `pi-extension.ts` uses **7 events**; `pi-mcp-bridge.ts` uses **one method**
(`registerTool`). The handler signature is `(event, ctx)`; vfkb declares `(...args: unknown[])`
and never touches `ctx`, so `ctx.ui`, `ctx.sessionManager`, `ctx.signal`,
`ctx.getContextUsage()` and `ctx.compact()` are entirely unused.

Unused API that maps directly onto capabilities vfkb **already ships on the Claude side**:

| pi API | vfkb equivalent it would serve |
|---|---|
| `pi.registerCommand()` | slash commands — the analogue of the plugin's `/vfkb:brief`; pi has none |
| `resources_discover` | contribute skill/prompt paths — the analogue of plugin-bundled skills |
| `session_before_compact` / `session_compact` | memory at compaction — squarely vfkb's domain, unexploited on **both** faces |
| `pi.appendEntry()` | persist extension state *in* the session, where vfkb rolls its own `.sessions/` |
| `BeforeAgentStartEventResult.message` | a first-class injection channel, cleaner than today's systemPrompt string concat |

This table is the backlog, not this milestone. See D2.

## Two latent defects found while reading

Both are recorded so they are not rediscovered, and neither blocks milestone 1:

1. **A stale comment asserting a falsehood.** `pi-extension.ts:92-96` states *"a blocked write
   never reaches `tool_execution_end`."* Brain gotcha `33d7dcc47598` proved that **false** on
   0.73.1 — pi emits `tool_execution_end` for calls blocked at `tool_call`, which is what caused
   the `tool-gating` false-RED. The code was fixed; the comment still lies.
2. **An under-specified custom message.** The `context` handler returns
   `{role:'custom', content}`, but `CustomMessage` (`dist/core/messages.d.ts`) requires
   `customType`, `display` **and** `timestamp`. `convertToLlm` reads only `content`/`timestamp`,
   so the LLM path survives the omission — session persistence and TUI rendering may not. This
   is a **probe**, not a known bug; it must be observed before it is asserted either way.

## Ecosystem context

> **UNVERIFIED — sourced, not observed.** Everything in this section comes from a
> `pi.dev/packages` gallery fetch and a web search on 2026-07-22. No package below was
> installed, read, or audited. Treat these as leads to check, not as findings. They inform
> D3's framing; they must not be load-bearing for any build without a first-hand look.

- Community MCP adapters appear to exist — `pi-mcp-adapter`, `pi-mcp-extension`,
  `@0xkobold/pi-mcp`, `tickernelz/pi-mcp-tools`. If that holds, "keep our bridge or depend on
  one" is a real decision (D3) rather than a foregone one.
- **`pi-hermes-memory`** (gallery blurb: "persistent memory with SQLite FTS5 search") appears to
  occupy the memory niche. If so, vfkb's differentiator is not storage but the typed, attributed,
  decision-family brain with supersession and a DoD culture — worth stating in the package README
  rather than assuming it reads as obvious.

What *is* verified in-package is the thing that makes D3 matter at all: pi's own
`docs/packages.md:20` warns that packages "run with full system access. Extensions execute
arbitrary code." Adopting any third-party adapter moves vfkb's trust boundary.

## Decisions

### D1 — Where the pi package lives — **RATIFIED 2026-07-22: separate repo**

A **`vfkb-pi-package`** repo mirroring `vilosource/vfkb-claude-plugin`: vendors built engine
bundles, carries its own release-gate + `DELIVERY-STATUS.json`, installs via
`pi install git:` / `npm:`.

Rejected: an in-repo `pi/` subdir published as its own npm package (avoids a third repo and
vendoring drift, but diverges from the ADR-0045 precedent and couples pi releases to vfkb's
cadence); and adding a `pi` manifest key to vfkb's own `package.json` so `pi install npm:vfkb`
works directly (cheapest, but ships the whole engine + CLI + MCP server to pi users and lets
pi's `peerDependencies` rules for `@mariozechner/*` constrain vfkb's dependency graph).

The decisive factor is that the separate-repo shape makes the ADR-0051 delivery-proof machinery
transfer **wholesale** — `release-gate.mjs`, `DELIVERY-STATUS.json`, version-bound records —
instead of being reinvented.

### D2 — What milestone 1 delivers — **RATIFIED 2026-07-22: delivery, not capability**

Ship the package; wire `.pi/settings.json` in `vfkb init`; teach `vfkb doctor` about pi; build a
pi install-path L4. **The extension code stays as-is.**

Rejected: parity-first (slash commands, `resources_discover` skills, the two defects above) and
pi-native-first (`session_before_compact` memory-at-compaction, the thing ADR-0015 already calls
Pi-only). Both defer installability, and neither closes the gap that actually exists.

### D3 — Keep vfkb's MCP bridge, or depend on a community adapter? — **OPEN**

`pi-mcp-bridge.ts` was written when it was the only option; it now appears to have several
alternatives (see the UNVERIFIED section above — none audited). Keeping it means owning 106 lines
and a connect-per-call design already tuned for a real footgun (a persistent connection made
`pi -p` hang, per the file's own header). Depending on one means inheriting an unaudited
third-party extension into vfkb's trust boundary, under pi's own full-system-access warning.

**Recommendation: keep ours, and say why in the README.** The bridge is small, working, and
sandbox-proven across the whole L4 pi arm. This is a judgement to ratify, not a default to drift
into.

### D4 — What the pi install-path L4 must prove — **OPEN, proposed below**

Port the plugin's proven three-arm structure rather than inventing one:

- **fresh** — `pi install` the package into a sandboxed `HOME`, then observe a real agent session
  receiving injected brain content it could not otherwise know.
- **upgrade** — install an older release, observe the capability **absent**, upgrade, observe it
  **present**. This is the arm that catches packaging and upgrade corruption.
- **contrast** — the can-fail arm. With the capability stripped, the predicate must be **observed
  failing**, with a content assertion over the output (ADR-0051 clause 3: exit status and error
  flags are not admissible).

**The strategic prize:** this proof is CI-automatable from day one. RFC-036 §D1 verifies that the
Claude scenarios read `~/.claude/.credentials.json`, **throw** without a `claudeAiOauth` block,
and have **no API-key path in the code at all** — which is precisely why the four plugin records
can only be produced by hand on the operator's machine. The pi arm instead runs on
`DEEPSEEK_TOKEN`, a plain API key already injected at run time by
`scenarios/docker/pi.Dockerfile`. So the pi face can have machine-produced release evidence
**without waiting on RFC-036's trust-model ratification** — and in doing so becomes the working
demonstration that RFC-036's automation argument is sound.

## Non-goals

- Any change to the engine. This milestone is packaging, wiring, doctoring and proving.
- The capability backlog in the table above — real work, explicitly deferred to milestone 2.
- Publishing to the `pi.dev` gallery. That is an outward publish and needs its own call.

## Open questions for the operator

1. **D3** — keep vfkb's MCP bridge, or adopt a community adapter?
2. **Repo name** — `vfkb-pi-package`, `vfkb-pi`, or `pi-vfkb`? (Gallery listings *appear* to
   favour a `pi-*` prefix, but that is an impression from the same unverified fetch, not a
   documented convention — `docs/packages.md` mandates only the `pi-package` **keyword**, which
   is verified.)
3. **npm or git-only** — the plugin ships via a git marketplace; pi supports both. `npm:` gets
   gallery presence, and gallery presence is an outward publish.
