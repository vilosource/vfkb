---
type: Decision
title: "ADR-0066: The pi face ships as a package, not a path — delivery before capability (accepts RFC-037)"
description: "Research against pi 0.73.1 found the pi extension code broadly correct and its MCP bridge's founding premise intact, while pi grew a full package system vfkb has zero presence in. The only load path is `pi -e /abs/path`, which is the ADR-0051 --plugin-dir trap exactly: it proves capability and says nothing about delivery. Decides a separate vfkb-pi-package repo mirroring vfkb-claude-plugin, git-only distribution, vfkb's own MCP bridge kept, and an install-path L4 whose contrast arm is AGENTS.md-only so vfkb must beat its own cold floor rather than beat nothing. Milestone 1 is delivery; the extension code is unchanged."
status: "Accepted"
timestamp: 2026-07-23
---

# ADR-0066: The pi face ships as a package, not a path

- **Status:** Accepted
- **Date:** 2026-07-23 (operator ratification, in two sittings — D1/D2 on 2026-07-22,
  D3/D4/D5 and distribution on 2026-07-23)
- **RFC:** [RFC-037](../rfc/RFC-037-pi-face-delivery.md) — the full research, the
  capability-surface table, the ecosystem survey (explicitly **UNVERIFIED** and deliberately
  not load-bearing), and the two latent defects live there.
- **Relates:** [ADR-0015](ADR-0015-cross-harness-auto-layer.md) (the tiered parity model
  defining what the pi face owes); [ADR-0045](ADR-0045-vfkb-claude-code-plugin.md) (the
  plugin split this mirrors); [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md) /
  [ADR-0051](ADR-0051-delivery-honesty.md) (delivery is a capability and needs its own
  proof); [RFC-036](../rfc/RFC-036-machine-produced-release-evidence.md) (the credential
  bottleneck this face escapes)
- **Brain:** research `16b8b6b018ea` (counts corrected by `e739953d3dff`); initiative shape
  `ae6feb81c738` (supersedes `d4864f7fa6de`); D3/D4/D5 `7729b402ef10`; distribution
  `203f506ad695`

## Context

vfkb has had a pi face since ADR-0015 — `src/pi-extension.ts` (injection, capture, gating)
and `src/pi-mcp-bridge.ts` (the `kb_*` tools, since pi ships no MCP of its own). A 2026-07-22
research pass against the installed `@mariozechner/pi-coding-agent@0.73.1` **inverted the
expected shape of the problem**:

**The code is not rotted.** npm latest *is* 0.73.1 — the exact version vfkb's contract was
verified against and the version pinned in `scenarios/docker/pi.Dockerfile`. pi still ships no
built-in MCP (`docs/usage.md:275`, `README:470`), so the bridge's founding premise holds.
`convertToLlm()`'s `"custom"` branch still maps `role:"custom"` to a user message, so Tier-C
delta injection is intact.

**What moved is distribution.** pi grew a full package system — `pi install npm:`/`git:`,
project-scoped `.pi/settings.json` that is team-shareable and auto-installs missing packages
at startup, a `pi` manifest key in `package.json`, convention dirs, and a public gallery keyed
on the `pi-package` keyword. It is the structural twin of the Claude Code plugin marketplace
that ADR-0045 was built for. **vfkb has zero presence in it:** `src/init.ts` writes eight
paths, of which the only harness wiring is Claude Code's, and `src/doctor.ts` contains no
occurrence of `pi-extension` or `.pi/`.

The sole way to load vfkb into pi today is `pi -e /abs/path`. Under ADR-0051 clause 1 that is
the `--plugin-dir` trap verbatim: it proves a **capability** and says nothing about its
**delivery**. This is the same gap ADR-0051 was written about, in a second harness.

## Decision

**The pi face ships as an installable package. Milestone 1 delivers delivery, not capability.**

### 1. A separate repo — `vfkb-pi-package`

Under owner `vilosource`, repo-local git identity on the GitHub noreply address, mirroring
`vilosource/vfkb-claude-plugin`: vendored engine bundles, its own release-gate and
`DELIVERY-STATUS.json`, installed via `pi install`.

*Rejected:* an in-repo `pi/` subdir published as its own npm package (avoids a third repo and
vendoring drift, but diverges from the ADR-0045 precedent and couples pi releases to vfkb's
cadence); and a `pi` manifest key on vfkb's own `package.json` so `pi install npm:vfkb` works
(cheapest, but ships the whole engine + CLI + MCP server to pi users and lets pi's
`peerDependencies` rules for `@mariozechner/*` constrain vfkb's dependency graph).

*Also rejected:* the name **`vfkb-pi-plugin`**. The operator named it first and then ruled
against it when both names in his message were put back to him as an explicit either/or. The
chosen name matches **pi's own vocabulary** — pi calls these *packages*. This is recorded
because "the operator said plugin" is a true quote of a superseded instruction, and a session
reading only that sentence would rename the repo wrongly.

### 2. Distribution is git-only, for now

Milestone 1 ships as `pi install git:github.com/vilosource/vfkb-pi-package`. `npm:` — and with
it `pi.dev` gallery presence — is a separate, later call, held behind RFC-037's non-goal that
gallery publication is an **outward publish** needing its own decision.

This is cheap to reverse, and the reason is verified rather than assumed: pi treats `npm:`,
`git:`, raw URLs and filesystem paths as interchangeable **source types** accepted by the same
`pi install` and the same settings schema (`docs/packages.md:50`), and runs `npm install` for
the package's dependencies whichever source it came from (`:164`). Publishing to npm later
changes the source URL, not the package's shape.

### 3. vfkb keeps its own MCP bridge

`src/pi-mcp-bridge.ts` stays. The operator ratified this **conditionally** — keep ours *"unless
it is a huge set of tasks to make it work in pi"* — and **the condition was evaluated, not
assumed, and does not bind.** The bridge already works in pi and needs zero porting: 106
self-contained lines, loaded like any pi extension, calling one `ExtensionAPI` method
(`registerTool` at `pi-mcp-bridge.ts:105`), and already exercised in the dockerized L4 pi arm —
`scenarios/l4-purpose.mjs:246` pushes `'-e', bridgePath` and `:247` sets `VFKB_MCP_CONFIG`,
reached by ten `mcp: true` run sites covering `kb_resume`, `kb_search`, `kb_map`, `kb_context`
and `kb_add`.

*Rejected:* adopting a community MCP adapter. It moves vfkb's trust boundary under pi's own
`docs/packages.md:20` full-system-access warning, in exchange for deleting 106 lines that
already work and are already sandbox-exercised. (The surveyed alternatives are **UNVERIFIED** —
one gallery fetch, one web search, nothing installed or audited — and are deliberately not
load-bearing on this decision.)

### 4. The install-path L4 — and the configuration nothing has proven

Port `vfkb-claude-plugin`'s proven three-arm structure rather than inventing one: **fresh**,
**upgrade** (absent → present), and **contrast** as the can-fail arm.

**The contrast arm is "AGENTS.md only", not "nothing."** `vfkb init` already writes `AGENTS.md`
(`src/init.ts:295-305`) and pi genuinely loads it (`dist/core/resource-loader.js:31` reads
`["AGENTS.md","AGENTS.MD","CLAUDE.md","CLAUDE.MD"]`), so vfkb must be shown to beat its own
**cold floor** rather than merely to beat nothing. The predicate must be **observed failing**
via a content assertion over the output — ADR-0051 clause 3: exit status and error flags are
not admissible evidence.

**Wherever an arm has vfkb installed, it must load both extensions simultaneously** — the
injection extension *and* the MCP bridge, with `VFKB_MCP_CONFIG` set. This covers the **fresh**
arm and the **post-upgrade** half of the upgrade arm. It emphatically does **not** mean "every
arm": the contrast arm has vfkb absent by design, and the pre-upgrade half must observe the
capability absent. Requiring both extensions there would load the very thing those arms exist
to do without, turning the can-fail arm into one that cannot fail.

The reason this clause exists at all is a finding from the D3 verification: **the two
extensions have never been co-loaded in any proof vfkb owns.** In `scenarios/l4-purpose.mjs`
they sit in mutually exclusive branches — `:245` `if (mcp)` loads only the bridge, and only the
`:248` `else` reaches `:261`'s extension load. Every green pi record to date exercised one or
the other. A real install produces both at once: a configuration with **zero** sandbox
evidence. A silent partial install — injection working, tools absent — is precisely the
delivery failure class ADR-0051 exists to catch.

### 5. Scope

`vfkb init` gains pi wiring (`.pi/settings.json`, and the MCP config the bridge needs or it is
inert); `vfkb doctor` gains pi awareness. **The extension code stays as-is.**

*Rejected:* parity-first (slash commands via `registerCommand`, skills via
`resources_discover`) and pi-native-first (`session_before_compact` memory-at-compaction).
Both defer installability, and neither closes the gap that actually exists. They are milestone
2 — real work, explicitly deferred, catalogued in RFC-037's capability table.

## Consequences

**Good.** The pi face becomes installable by someone who is not the author — the thing it has
never been. The delivery-proof machinery transfers wholesale from `vfkb-claude-plugin`
(`release-gate.mjs`, `DELIVERY-STATUS.json`, version-bound records) instead of being
reinvented. And the pi arm **sidesteps RFC-036's credential blocker entirely**: the Claude
scenarios read `~/.claude/.credentials.json` and have no API-key path at all, which is why
those records can only be produced by hand on the operator's machine; the pi arm runs on
`DEEPSEEK_TOKEN`, already injected by `scenarios/docker/pi.Dockerfile`. So the pi face can have
**machine-produced release evidence from day one**, and in doing so becomes the working
demonstration that RFC-036's automation argument is sound.

**Bad.** A third repo to keep in step, with the vendoring drift ADR-0045 already lives with.
pi moves fast (0.61 → 0.73 in a few months), so a package pinned against a stub-typed API
re-incurs the mykb L7 failure on every pi release — the reason `pi.Dockerfile`'s pin and the
`peerDependencies "*"` convention both matter.

**Unchanged.** No engine change. No capability is declared done or shipped by this ADR: per
ADR-0050 the pi package is **not delivered** until its install-path L4 record exists, and per
ADR-0051 clause 2 that status must be stated, not merely implied, in every release note and
handoff until it does.

## Notes on how this decision was reached

Two load-bearing errors were caught in this initiative, both only by reading ground truth —
neither by any tool reporting a failure:

1. The initiative's first shape decision (`d4864f7fa6de`) argued that the Claude side still
   owed an install-path L4. **False** — `vfkb-claude-plugin/scenarios/records/install-path.json`
   is DEMONSTRATED and version-bound to plugin 0.12.0, and `DELIVERY-STATUS.json` reads
   `"delivery":"proven"`. Superseded by `ae6feb81c738` with the argument rebuilt on verified
   ground rather than quietly patched.
2. The research entry's API counts were wrong in three of four places — pi's `ExtensionAPI` is
   **29 events / 22 methods**, and vfkb uses **7 events / 1 method**, not the 30/~30/6/0
   recorded. Root cause: a 51-line grep read as "~30 and ~30"; it is 29 `on()` overloads plus
   22 methods. Corrected by `e739953d3dff`. No conclusion changed — the gap is still large and
   the initiative is still packaging, not porting.

Recorded here because the pattern is worth more to a later session than either finding: in this
initiative, every error that mattered was invisible until someone opened the file.
