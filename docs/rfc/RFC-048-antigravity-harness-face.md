---
type: RFC
title: "RFC-048: An Antigravity (agy) harness face — committed .agents/ wiring and a translating hook adapter"
description: "The operator is moving repos to Google's Antigravity CLI (agy), and vfkb only has Claude Code and Pi faces. A probe of agy 1.4.12 shows it can host every vfkb surface except a session-end event, but its hook contract differs from Claude Code's in ways that would break vfkb if wired naively: `{}` from a PreToolUse hook is a deny, a crashing hook fails closed, and the file-write tools are not named as documented. This RFC proposes a third face: `vfkb init --harness agy` writes committed `.agents/` files (MCP server, hooks, skills, AGENTS.md), and `vfkb hook <event> --harness agy` translates agy's stdin/stdout to the existing engine. Session-end work moves to the idle Stop. The Definition of Done is a dockerized agy L4 on a Gemini API key."
status: Proposed
timestamp: 2026-11-09
---

# RFC-048: An Antigravity (`agy`) harness face

- **Status:** Proposed.
- **Date:** 2026-11-09
- **Deciders:** operator + Claude.
- **Scope set by the operator (2026-11-09):**
  - surface: the **`agy` CLI** only;
  - ambition: the **full capability set** of the Claude Code plugin;
  - delivery: **committed `.agents/` files** in each repo;
  - L4 auth: a **Gemini API key** the operator will provide.
- **Evidence:**
  - [`docs/research/probes/agy-hooks-2026-11-09/`](../research/probes/agy-hooks-2026-11-09/README.md):
    six headless runs of `agy` 1.4.12. Every "observed" below refers to it.
  - Brain `053e25c55997`: a research pass over the published docs. The pages are undated, and
    the probe contradicted several of its claims; §1.2 lists them.
- **Relates:**
  - [ADR-0030](../adr/ADR-0030-consumer-integration-and-distribution.md) /
    [ADR-0032](../adr/ADR-0032-env-var-rename-data-dir-bundle-dir.md): `vfkb init` and `$VFKB_BUNDLE_DIR`, which this
    RFC extends.
  - [ADR-0045](../adr/ADR-0045-vfkb-claude-code-plugin.md): the Claude Code plugin, whose
    capability set is the target.
  - [ADR-0033](../adr/ADR-0033-session-end-continuity.md) /
    [ADR-0086](../adr/ADR-0086-sessionend-floor-mechanics.md): the session-end floor, which has
    no agy event.
  - [ADR-0027](../adr/ADR-0027-stop-hook-decision-capture-reminder.md) /
    [ADR-0084](../adr/ADR-0084-handoff-nudge-next-prompt.md): the Stop and prompt nudges.
  - [ADR-0077](../adr/ADR-0077-compaction-survival-guard.md): compaction survival.
  - [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) /
    [ADR-0051](../adr/ADR-0051-delivery-honesty.md): the Definition of Done and delivery
    honesty.
  - `src/gating.ts` (#151): the write gate's scope.

## 1. Context

### 1.1 What vfkb needs from a harness, and what agy has

vfkb plugs into an agent at six points. The Claude Code face uses all six; the Pi face uses
its in-process equivalents (`src/pi-extension.ts`).

| vfkb need | Claude Code | agy 1.4.12 (observed unless marked) |
|---|---|---|
| MCP tools (`kb_*`) | plugin `.mcp.json` | `.agents/mcp_config.json`. vfkb's real server worked with absolute paths; calls go through a `call_mcp_tool` meta-tool. |
| Context at session start | `SessionStart` → `additionalContext` | `SessionStart` → `{"injectSteps":[{"systemMessage":{"systemMessage":"…"}}]}`. The flat string form the docs also show did **not** inject. |
| Gate direct `.vfkb/` writes | `PreToolUse` deny on `Write`/`Edit`/`MultiEdit` | `PreToolUse` with a **required-looking `{matcher, hooks}` wrapper**; tools `write_file {Path, Content}` and `edit_file {Path, Target, Replacement}`; deny = `{"decision":"deny","reason":…}`. |
| End-of-turn nudge | `Stop` → `decision:block` + `stop_hook_active` loop guard | `Stop` → `{"decision":"continue","reason":…}` works. **No re-entry flag**; payload has `executionNum`, `fullyIdle`, `terminationReason`. |
| Prompt-time line (ADR-0084) | `UserPromptSubmit` | No such event. `PreInvocation` fires once per model call with `invocationNum` (0 = first call of the turn). Injection from it is **untested**. |
| Session end (commit brain, B2 floor) | `SessionEnd` | **No event.** Naming one is silently ignored. |
| Tool-result capture | `PostToolUse` (not on failed calls) | `PostToolUse` with `toolCall` and `error`. The docs and changelog say it fires on failed calls too (**not observed**). |
| Skills (`/vfkb:brief`, `/vfkb:handoff`) | plugin skills + Haiku-pinned subagents | `.agents/skills/<name>/SKILL.md` → `/<name>` works in `agy -p`. Model pinning per skill: **unknown**. |

### 1.2 The contract traps (why a naive port breaks)

These are the findings that shape the design. Each would silently break vfkb in an agy repo.

1. **`{}` is a deny.** A `PreToolUse` hook that prints `{}` blocks the call with an empty
   reason. Empty stdout allows. vfkb's `hook pre-tool-use` prints `{}` on allow
   (`src/cli.ts`), so wired as-is it would **block every file write in the repo**.
2. **A crashing gate fails closed.** A `PreToolUse` hook that exits 1 blocks the call. The
   build-plugins docs say non-zero exits are ignored. So a missing `$VFKB_BUNDLE_DIR` or a
   broken engine would also block every write. (A `SessionStart` hook that exits 1 does not
   stop the session.)
3. **Documented tool names are wrong for the CLI.** The docs list `write_to_file`,
   `replace_file_content` and `multi_replace_file_content`. The CLI's tools are `write_file`
   and `edit_file`. A matcher written from the docs never fires, and the gate is silently
   absent.
4. **Flat handlers never fire on tool events.** Without the `{matcher, hooks}` wrapper,
   `PreToolUse`/`PostToolUse` handlers are silently ignored.
5. **Exit 0 and `"status":"SUCCESS"` on every run**, including runs where every write was
   denied. This is ADR-0051's quiet-success trap: an L4 here must assert on content.

`agy plugin import claude` exists, but importing the vfkb Claude Code plugin would carry
Claude-shaped hooks into a contract where trap 1 applies. That is untested and should not be
recommended (§6).

## 2. Principles the design is held to

- **One engine.** The agy face is a translation layer in `src/`, like the Pi face. No
  behaviour forks: the same `renderResume`, `isBrainWrite`, `decideStop` and `runSessionEnd`
  decide; only the I/O shape differs.
- **Never wedge the harness**, adapted to agy's contract. On every error path the agy
  `pre-tool-use` adapter must print **nothing** and exit 0. That includes a malformed payload,
  a missing engine and a thrown exception. A deterministic test pins each path.
- **No machine paths in git** (ADR-0030 FR-2). Committed files reach the engine through
  `$VFKB_BUNDLE_DIR`.
- **Observed, not documented.** Matchers and payload readers are written against the probe
  record, and accept the documented names as well.

## 3. Proposal

### 3.1 `vfkb init --harness agy`

`init` gains a harness option. `--harness agy` writes, idempotently:

| File | Content |
|---|---|
| `.agents/mcp_config.json` | server `vfkb`, launched through a `sh -c` wrapper that resolves `$VFKB_BUNDLE_DIR` and sets `VFKB_DATA_DIR` to the workspace's `.vfkb` (§3.4) |
| `.agents/hooks.json` | one named group `vfkb` with `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop` (§3.2) |
| `.agents/skills/vfkb-brief/SKILL.md`, `.agents/skills/vfkb-handoff/SKILL.md` | the plugin's `brief` and `handoff` skills, rewritten to run inline (§3.5) |
| `AGENTS.md` snippet | the existing "how we track work here" text |
| `.gitignore` stanza, empty `.vfkb/entries.jsonl` | as today |

`--harness claude` stays the default and is unchanged. One repo may carry both wirings. They
share the brain, and the engine's lock ([ADR-0040](../adr/ADR-0040-native-concurrency-lock.md)) already serializes writers.

### 3.2 `vfkb hook <event> --harness agy`

The existing hook subcommands gain a `--harness agy` flag. It selects an input reader and an
output writer around the unchanged decision code.

| agy event (matcher) | vfkb handler | Reads | Writes |
|---|---|---|---|
| `SessionStart` | `session-start` | `conversationId` as the session id | `{"injectSteps":[{"systemMessage":{"systemMessage": <resume render>}}]}` |
| `PreToolUse` (`write_file\|edit_file\|write_to_file\|replace_file_content\|multi_replace_file_content`) | `pre-tool-use` | `toolCall.name`, `toolCall.args.{Path,TargetFile}` | deny → `{"decision":"deny","reason":GATING_REASON}`; **allow → no output** |
| `PostToolUse` (`*`), **not wired by default** | `post-tool-use` | `toolCall`, `error` | no output |
| `Stop` | `stop` (+ §3.3) | `fullyIdle`, `executionNum`, `terminationReason` | nudge → `{"decision":"continue","reason":<reminder>}`; else no output |

`PostToolUse` capture follows the Claude Code init, which does not wire it (`src/init.ts` has
no post-tool-use entry), so `init --harness agy` leaves it out too. The adapter exists so a
repo can opt in.

Engine changes this needs:
- `isBrainWrite` learns the agy tool names and the `Path`/`TargetFile` keys (`src/gating.ts`).
- The Stop loop guard: agy sends no `stop_hook_active`. The adapter records "nudged in this
  turn" on the session record and allows the next Stop of the same turn. Whether
  `executionNum` can key that turn is probe P-3.
- The committed hook command never calls `node` directly. It goes through a wrapper that
  prints nothing and exits 0 when the engine file is missing (trap 2):
  `sh -c '[ -f "$VFKB_BUNDLE_DIR/vfkb.mjs" ] && exec node "$VFKB_BUNDLE_DIR/vfkb.mjs" hook pre-tool-use --harness agy; exit 0'`.
  The `exec` matters: once the engine starts, its own fail-safe paths decide.

**Compaction (ADR-0077).** agy has no observed equivalent of `SessionStart` with
`source:"compact"`. Whether agy compacts at all, and what fires if it does, is probe P-4.
Until then the agy face makes no compaction-survival claim.

### 3.3 Session end without a `SessionEnd` event

agy cannot tell vfkb that a session ended. The proposal:

- **Brain commit at the idle Stop.** When `Stop` arrives with `fullyIdle: true`, run the
  session-end commit (`runSessionEnd`'s commit half, ADR-0033/0086). It commits only
  `.vfkb/entries.jsonl`, only on a topic branch, pathspec-scoped, no push, and only if the
  file changed. The effect is one brain commit per turn that changed the brain, instead of one
  per session. The cost ADR-0086 measured (~725 ms on a 30.8k-line brain, cited, not
  re-measured here) fits the 30 s default hook timeout the docs give (documented, not
  observed).
- **B2 fallback handoff at the next `SessionStart`.** The "write a handoff only if none was
  left" floor cannot run per turn without spamming. It runs at the start of the *next*
  session, for the previous conversation's entries, and is then committed by the next idle
  Stop.

The B2 move is the one real behaviour change for agy users: a session abandoned mid-turn gets
its floor handoff when the next session starts, not when it ends. Open question Q2 asks
whether that is acceptable.

### 3.4 MCP

The committed server entry must reach both the engine and the right brain with no machine
paths. The probe established that absolute paths work. It did not establish that a `${VAR}`
in `args` is expanded or that the server's cwd is the workspace (run 5). The proposal is a
wrapper:

```json
{ "mcpServers": { "vfkb": {
  "command": "sh",
  "args": ["-c", "VFKB_DATA_DIR=\"${VFKB_DATA_DIR:-$PWD/.vfkb}\" exec node \"$VFKB_BUNDLE_DIR/vfkb-mcp.mjs\""]
} } }
```

This is correct only if the server's cwd is the workspace root. That is probe P-1, and it
gates Phase 1: if the cwd is not the workspace, the brain would resolve elsewhere. The
documented `cwd` field is the fallback.

### 3.5 Skills

`/vfkb-brief` and `/vfkb-handoff` are written as agy skills. The Claude Code plugin runs
`brief` on a Haiku-pinned subagent ([ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md)). agy's skill frontmatter has no known model
pin, so the agy skills run inline on the session's model. That is a cost difference, not a
capability gap. The names drop the plugin's `vfkb:` namespace, because agy has none for
workspace skills.

### 3.6 Tool-name drift

Trap 3 will recur: the docs and the CLI already disagree. Two guards:
- **Deterministic:** a unit test feeds `isBrainWrite` the exact payloads recorded in the
  probe, for both observed and documented names.
- **Detection:** `vfkb doctor --harness agy` reads `agy --version` and warns when it is newer
  than the last version the L4 ran on. That version goes in the L4 record.

## 4. Phases

| Phase | Builds | Gate to start |
|---|---|---|
| 0 — probes | P-1 MCP server cwd + `${VAR}` expansion · P-2 an interactive session (no `--dangerously-skip-permissions`): do workspace hooks need trust approval? · P-3 `executionNum` semantics across a `continue` · P-4 compaction · P-5 `GEMINI_API_KEY` + `modelProvider:gemini` inside Docker | this RFC accepted |
| 1 — floor and gate | `init --harness agy` (MCP, `SessionStart`, `PreToolUse`, skills, AGENTS.md), `isBrainWrite` names, the fail-safe wrapper, the L4 (§5) | P-1, P-2, P-5 |
| 2 — continuity | idle-Stop brain commit, B2 at next `SessionStart`, the Stop decision nudge with its loop guard, the opt-in `PostToolUse` adapter | Phase 1 DEMONSTRATED, P-3 |
| 3 — prompt line | ADR-0084's handoff line through `PreInvocation` (`invocationNum` 0), if injection works there | a probe of `PreInvocation` injection |

## 5. Definition of Done (ADR-0050/0051)

The face is agent-facing, so its proof is a sandboxed, agent-driven L4, DEMONSTRATED ≥2/3,
with a contrast arm that can fail.

**Scenario:** `scenarios/agy-face.mjs` (new), dockerized, `agy -p --output-format json`,
`GEMINI_API_KEY`, N=3. Each trial runs `vfkb init --harness agy` in a fresh repo, seeds the
brain with a handoff fact carrying a random sentinel, and then:

| Arm | Wired | Contrast (no `init`) |
|---|---|---|
| Injection | the agent names the sentinel without a tool call | it cannot |
| Gate | a `write_file` to `.vfkb/entries.jsonl` is denied and the brain is still valid JSONL with the sentinel line (the structural predicate from #150) | the write lands |
| Allow path | a `write_file` to an ordinary file succeeds (catches trap 1) | succeeds |
| MCP | `kb_add` of a second sentinel lands in `.vfkb/entries.jsonl` | no `kb_*` tool |
| Skill | `/vfkb-brief` output contains the seeded sentinel | unknown command |

Every predicate is a **content assertion over files or the response text**. Exit status and
`status` are inadmissible (trap 5). The model in use is read from the hook payload's
`modelName` and recorded. **RED first:** the scenario is committed and run before the adapter
exists, and must fail on the wired arm.

**Delivery.** The scenario installs through `vfkb init --harness agy` from the engine under
test, which is the real delivery path for committed wiring. Until it runs against a
**released** engine, every handoff and release note must say the agy face's delivery is
unproven (ADR-0051).

## 6. Alternatives considered

- **An Antigravity plugin** (`.antigravity-plugin/plugin.json`, installed with
  `agy plugin install`). It is a natural later step, since plugin hooks do load in the CLI.
  Rejected for the first build: the operator chose committed files, which reach every clone
  with no per-user install, and a plugin would need its own repo, release gate and delivery
  proof. The capability set is identical, so a plugin can wrap this face later without a
  redesign.
- **`agy plugin import claude`** on the existing vfkb plugin. Rejected: its hooks speak
  Claude Code's contract, and trap 1 makes that actively harmful. It is untested whether
  import converts or drops them.
- **MCP + AGENTS.md only.** Rejected as the target, though it is Phase 1's floor if hooks
  prove unworkable: no injection means no automatic continuity, and the brain gate is the
  only protection against direct writes.
- **A separate agy-specific CLI** (`vfkb agy-hook …`). Rejected for a flag on the existing
  subcommands, which keeps one dispatch table and one fail-open policy.

## 7. Consequences

- vfkb gains a third face. Every change to a hook's decision code now has three I/O shapes to
  keep working. That is mitigated by keeping decisions in shared functions, as the Pi face
  already does.
- agy repos get one brain commit per brain-changing turn, and the B2 floor one session late.
- The gate in agy repos fails safe (a missing engine disables it) rather than closed (a
  missing engine blocks all writes). That matches the Claude Code face's posture, and
  `doctor` reports the missing engine.
- The agy face's version coupling is tighter than Claude Code's: agy's docs already lag its
  CLI, and the L4 is the only proof that a given `agy` version still works.

## 8. Open questions

1. **"Full plugin" with committed delivery.** This RFC reads the operator's "full plugin"
   answer as *the full capability set*, delivered as committed files. Is that right, or is an
   installable Antigravity plugin wanted in the first build too?
2. **The B2 floor one session late** (§3.3): acceptable, or should it also run at the idle
   Stop when the brain gained no handoff this turn?
3. **The idle-Stop commit:** one brain commit per changing turn. Acceptable, or should commits
   be coalesced, e.g. only when the turn count since the last commit passes a threshold?
4. **Which repos first?** The L4 proves the face in a sandbox. Naming the first real repos
   lets the operator watch it in use.
