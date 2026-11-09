---
type: RFC
title: "RFC-048: An Antigravity (agy) harness face — a user-scope agy plugin that vendors the engine, a committed per-repo opt-in, and a translating hook adapter"
description: "The operator is moving repos to Google's Antigravity CLI (agy), and vfkb only has Claude Code and Pi faces. A probe of agy 1.4.12 shows it can host every vfkb surface except a session-end event, but its hook contract differs from Claude Code's in ways that would break vfkb if ported naively: `{}` from a PreToolUse hook is a deny, a failing gate hook appears to deny, and the file-write tools are not named as documented. This RFC proposes a third face. A user-scope Antigravity plugin (vilosource/vfkb-agy-plugin, on the pi package's model) vendors the engine and carries the hooks, MCP server and skills. `vfkb init --harness agy` commits only a per-repo opt-in. `vfkb hook <event> --harness agy` translates agy's stdin/stdout around the unchanged engine. Session-end work splits into a per-turn brain commit at the idle Stop and a fallback handoff at the next SessionStart. The open questions were settled by a Fable brainstorm under the operator's delegation (2026-11-09)."
status: Proposed
timestamp: 2026-11-09
---

# RFC-048: An Antigravity (`agy`) harness face

- **Status:** Proposed.
- **Date:** 2026-11-09
- **Deciders:** operator + Claude. The open questions (§8) were settled by a Fable brainstorm
  agent under the operator's delegation of 2026-11-09 ("come up with the best answers using a
  fable subagent instead of asking me"), as RFC-047's were under ruling `54802539cda7`.
- **Scope set by the operator (2026-11-09):**
  - surface: the **`agy` CLI** only;
  - ambition: **"Full plugin"**;
  - delivery: **committed `.agents/` files**;
  - L4 auth: a **Gemini API key** the operator will provide.

  §8 Q1 records how the two delivery answers are reconciled.
- **Evidence:**
  - [`docs/research/probes/agy-hooks-2026-11-09/`](../research/probes/agy-hooks-2026-11-09/README.md):
    six single-prompt headless invocations of `agy` 1.4.12. **Every "observed" below refers to
    it, and is N=1 and single-turn.**
  - Brain `053e25c55997`: a research pass over agy's published docs. The pages are undated,
    and the probe contradicted several of their claims (§1.2). Claims marked "documented" come
    from there and were not observed.
- **Relates:**
  - [ADR-0066](../adr/ADR-0066-pi-package-delivery.md): the pi package, a git-installed
    package that vendors the engine. It is the precedent this RFC follows for engine delivery.
  - [ADR-0045](../adr/ADR-0045-vfkb-claude-code-plugin.md): the Claude Code plugin, whose
    capability set is the target.
  - [ADR-0030](../adr/ADR-0030-consumer-integration-and-distribution.md) /
    [ADR-0032](../adr/ADR-0032-env-var-rename-data-dir-bundle-dir.md): `vfkb init` and
    `$VFKB_BUNDLE_DIR`, which this face does **not** use (§6).
  - [ADR-0033](../adr/ADR-0033-session-end-continuity.md) /
    [ADR-0086](../adr/ADR-0086-sessionend-floor-mechanics.md) /
    [ADR-0083](../adr/ADR-0083-background-curation.md): the session-end floor, its mechanics,
    and the curation that rides it. There is no agy event for any of them.
  - [ADR-0027](../adr/ADR-0027-stop-hook-decision-capture-reminder.md) /
    [ADR-0084](../adr/ADR-0084-handoff-nudge-next-prompt.md): the Stop and prompt nudges.
  - [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md): the handoff pin and the
    Haiku-pinned `/vfkb:brief`.
  - [ADR-0077](../adr/ADR-0077-compaction-survival-guard.md): compaction survival.
  - [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) /
    [ADR-0051](../adr/ADR-0051-delivery-honesty.md): the Definition of Done and delivery
    honesty.
  - `src/gating.ts` (#151): the write gate's scope.

## 1. Context

### 1.1 What vfkb needs from a harness, and what agy has

| vfkb need | Claude Code | agy 1.4.12 |
|---|---|---|
| MCP tools (`kb_*`) | plugin `.mcp.json` | **Observed:** `.agents/mcp_config.json` with vfkb's real server and absolute paths; `kb_add` landed and `kb_search` returned it. A `${VAR}` in `args` did not bring the server up (run 5, cause not isolated). |
| Context at session start | `SessionStart` → `additionalContext` | **Observed:** `{"injectSteps":[{"systemMessage":{"systemMessage":"…"}}]}` injects. The flat string form, which the docs also show, did not. |
| Gate direct `.vfkb/` writes | `PreToolUse` deny on `Write`/`Edit`/`MultiEdit` | **Observed:** tools `write_file {Path, Content}` and `edit_file {Path, Target, Replacement}`, registered as `{"matcher": …, "hooks": [...]}`; deny = `{"decision":"deny","reason":…}`. `Path` was absolute in every run. |
| End-of-turn nudge | `Stop` → `decision:block` + `stop_hook_active` loop guard | **Observed:** `Stop` → `{"decision":"continue","reason":…}` re-prompted once. The payload has `executionNum`, `fullyIdle`, `terminationReason`, and no re-entry flag. |
| Prompt-time line (ADR-0084) | `UserPromptSubmit` | **Documented:** no such event. **Observed:** `PreInvocation` fires once per model call with `invocationNum`. Whether it resets per turn, and whether it can inject, are unobserved. |
| Session end (commit, B2 floor, curation) | `SessionEnd` | **Documented:** no event. **Observed:** naming `SessionEnd` in `hooks.json` was silently ignored. |
| Tool-result capture | `PostToolUse` (not on failed calls) | **Observed:** fires with `toolCall` and `error`. **Documented** (changelog): fires on failed calls too. |
| Skills (`/vfkb:brief`, `/vfkb:handoff`) | plugin skills, `brief` on a Haiku-pinned subagent (ADR-0049) | **Observed:** a `.agents/skills/<name>/SKILL.md` ran as `/<name>` in `agy -p`. Plugin skills and per-skill model pinning: unobserved. |
| Packaging | plugin, marketplace, version cache | **Documented:** plugins with `hooks.json`, `mcp_config.json`, skills and rules; `agy plugin install <github-url>`; plugin hooks load in the CLI; `${PLUGIN_ROOT}` in plugin hook commands (also in the CLI changelog). None of it observed. |

### 1.2 The contract traps (why a naive port breaks)

1. **`{}` is a deny** (observed). A `PreToolUse` hook printing `{}` blocked the call with an
   empty reason; empty stdout allowed it. vfkb's `hook pre-tool-use` prints `{}` on allow
   (`src/cli.ts`), so wired as-is it would block every file write.
2. **A failing gate hook appears to deny** (observed, confounded). A hook that printed deny
   JSON and then exited 1 blocked the call with an error naming the exit status. An exit 1
   with empty stdout was not tested. The build-plugins docs say non-zero exits are ignored.
   The design assumes the worst case: any non-zero exit denies. A `SessionStart` hook that
   exited 1 did not stop the session (observed).
3. **The documented tool names are wrong for the CLI** (observed). The docs list
   `write_to_file`, `replace_file_content` and `multi_replace_file_content`; the CLI's tools
   are `write_file` and `edit_file`. A docs-based matcher never fires, and the gate is silently
   absent.
4. **Tool-event handlers need the `{matcher, hooks}` wrapper** (observed in run 1, where the
   flat handlers lacked both the wrapper and a matcher, so which omission mattered is not
   separated). Either way, the handlers were silently ignored.
5. **Exit 0 and `"status":"SUCCESS"` on every run**, including runs where every write was
   denied (observed). This is ADR-0051's quiet-success trap: an L4 here must assert on content.

`agy plugin import claude` exists, but importing the vfkb Claude Code plugin would carry
Claude-shaped hooks into a contract where trap 1 applies. That is untested, and should not be
recommended (§6).

### 1.3 The target repos

Read from disk on 2026-11-09. `~/.gemini/antigravity-cli/cache/last_conversations.json` shows
agy has run in two OneIO workdirs, `~/OneIO-Workdir/sre-workdir/tf-estate-workdir` and
`…/aws-agent-core-workdir`, as well as `~/OneIO-Workdir-Dev` and `~/GitHub/vfkb`.

Three facts about those workdirs constrain the design:
- **They are on `main`** and commit their brains there with their own machinery (e.g.
  `vfkb: handoff (12), …`).
- **Their `AGENTS.md` is released from `OneIO-Workdir-Dev`** (`release: AGENTS.md from
  OneIO-Workdir-Dev 6575e66`), so a snippet written into it by `init` would be overwritten.
- **None has `.agents/`.**

On this machine, `~/.vfkb-bundles` does not exist and `$VFKB_BUNDLE_DIR` is unset, so there
is no per-machine engine for committed wiring to find. The only engine copies are inside the
Claude Code plugin caches, at version-specific paths.

The operator's user-level `~/.gemini/config/hooks.json` already holds a `herdr` group
(`PreInvocation`).

## 2. Principles the design is held to

- **One engine.** The agy face is a translation layer in `src/`. Decisions stay in the shared
  functions (`renderResume`, `isBrainWrite`, `decideStop`, and the session-end pieces of §3.4),
  and only the I/O shape differs. Today the Pi face shares `renderResume` and `isBrainWrite`
  but not `decideStop` or `runSessionEnd`. The agy face is the first to need the session-end
  logic outside Claude Code, which is why §3.4 splits it.
- **Never wedge the harness**, under agy's contract. On every failure path a hook prints
  **nothing** and exits 0. That includes a malformed payload, a missing or crashing engine, an
  engine that predates the agy face, and a workspace with no brain. The guarantee lives in a
  small output filter in front of the engine (§3.3), because an engine that crashes at import
  time or predates `--harness agy` cannot enforce it from inside. Each path is pinned by a
  deterministic test.
- **No machine paths in git and no per-machine env var.** The engine is reached through the
  plugin's `${PLUGIN_ROOT}` (ADR-0066's lesson: a hand-set `$VFKB_BUNDLE_DIR` is a prose rule
  that does not get followed; on this machine it was never set).
- **Observed, not documented.** Matchers and payload readers are written against the probe
  record, and also accept the documented names.

## 3. Proposal

### 3.1 Two artifacts: a user-scope plugin and a committed opt-in

**`vilosource/vfkb-agy-plugin`** is a new repo modelled on `vfkb-pi-package` (ADR-0066). It
holds:
- vendored `vfkb.mjs` and `vfkb-mcp.mjs`;
- `hooks.json`, `mcp_config.json`, and the `vfkb-brief` and `vfkb-handoff` skills;
- its own release gate and `DELIVERY-STATUS.json`, as the Claude Code plugin has (ADR-0051).

It is installed once per machine with `agy plugin install <github-url>`. Plugin and engine
release together, so the engine a hook runs is always one that knows `--harness agy`.

**`vfkb init --harness agy`** writes the per-repo opt-in, idempotently:

| File | Content |
|---|---|
| `.agents/rules/vfkb.md` | the "how we track work here" instructions, written for agy. They go in a rules file rather than `AGENTS.md`, because the target workdirs' `AGENTS.md` is released from a template repo and would overwrite the snippet. **Documented:** rule files need `trigger` frontmatter or they are dropped. |
| `.gitignore` stanza, empty `.vfkb/entries.jsonl` | as today |

The brain's presence is the opt-in. A user-scope plugin's hooks run in every agy session on
the machine, so each one first resolves the brain as `workspacePaths[0] + "/.vfkb"`. If no
`entries.jsonl` is there, the hook prints nothing. This also closes the review's B3: the
brain is taken from the payload, never from `$PWD` or the `~/.vfkb` default.

`vfkb doctor --harness agy` reports a repo that has opted in on a machine with no plugin.

### 3.2 `vfkb hook <event> --harness agy`

The existing hook subcommands gain a `--harness agy` flag. It selects an input reader and an
output writer around the unchanged decision code.

| agy event (matcher) | vfkb handler | Reads | Writes |
|---|---|---|---|
| `SessionStart` | `session-start` (+ §3.4 floor) | `conversationId` (session id), `workspacePaths` | `{"injectSteps":[{"systemMessage":{"systemMessage": <resume render>}}]}` |
| `PreToolUse` (`write_file\|edit_file\|write_to_file\|replace_file_content\|multi_replace_file_content`) | `pre-tool-use` | `toolCall.name`, `toolCall.args.Path` (observed); `TargetFile` (documented only) | deny → `{"decision":"deny","reason":GATING_REASON}`; **allow → no output** |
| `Stop` | `stop` (+ §3.4 commit) | `fullyIdle`, `executionNum`, `terminationReason` | nudge → `{"decision":"continue","reason":<reminder>}`; else no output |
| `PostToolUse` (`*`), **not wired by default** | `post-tool-use` | `toolCall`, `error` | no output |

`PostToolUse` capture follows the Claude Code init, which does not wire it (`src/init.ts` has
no post-tool-use entry). The adapter exists so a repo can opt in later.

Engine changes this needs:
- `isBrainWrite` learns the agy tool names and the `Path`/`TargetFile` keys (`src/gating.ts`).
- **The Stop loop guard.** agy sends no `stop_hook_active`. The adapter allows at most one
  `continue` per turn and skips `bumpTurn()` on the Stop that follows its own `continue`.
  Otherwise ADR-0084's turn gates would double-count. Defining "a turn" needs P-3, so the
  Stop nudge is a Phase 2 item, not Phase 1.

**Compaction (ADR-0077).** agy has no observed equivalent of `SessionStart` with
`source:"compact"`. Whether agy compacts, and what fires if it does, is P-4. Until then the
agy face makes no compaction-survival claim.

### 3.3 The output filter

Every hook command in the plugin's `hooks.json` runs the engine **without `exec`**, behind a
filter:

```sh
out=$(node "${PLUGIN_ROOT}/dist/bundles/vfkb.mjs" hook pre-tool-use --harness agy 2>/dev/null)
case "$out" in *'"decision":"deny"'*) printf '%s' "$out" ;; esac
exit 0
```

- `pre-tool-use` passes output through only when it contains a deny.
- `stop` passes output through only when it contains `"decision":"continue"`.
- `session-start` passes output through only when it contains `"injectSteps"`.
- Anything else prints nothing: `{}`, a banner, empty output, any non-zero exit, a missing
  `node`.

This closes the review's B1 and B2. A unit test drives the filter with each case: deny, `{}`,
empty, garbage, exit 1, exit 127.

Whether `${PLUGIN_ROOT}` expands inside plugin hook commands and MCP `args` is probe P-0.

### 3.4 Session end without a `SessionEnd` event

`runSessionEnd` (`src/session-end.ts`) currently does four things in one try block:
- the B2 decision, whose input `fresh` is the entries new since `HEAD`;
- ADR-0083 auto-curation;
- `writeAutoHandoff`;
- the pathspec-scoped commit.

It is split into `commitBrain`, `floorDecision` + `writeAutoHandoff`, and `curate`. The Claude
Code path recomposes them unchanged, and tests pin that.

The agy face then uses the pieces separately:

- **At the idle Stop** (`fullyIdle: true`; if P-3 shows it is unreliable,
  `terminationReason == "NO_TOOL_CALL"`):
  - Append the ids of entries added during this conversation to a local, gitignored record
    `.vfkb/.sessions/agy-<conversationId>.json`. "Added during" means created after this
    conversation's `SessionStart`. With two live conversations in one repo, attribution is
    approximate; that is accepted.
  - Then run `commitBrain`. As today it is topic branches only, pathspec-scoped, no push, and
    only if the file changed, so there is one commit per brain-changing turn.
  - On `main` or a detached HEAD it does nothing and prints nothing: agy's Stop has no silent
    message channel, and any output re-prompts. `doctor --harness agy` reports it. **In the
    target workdirs, which are on `main`, this never commits**; their own machinery does.
- **At `SessionStart`**, before the render:
  - For every *finished* prior agy conversation in this repo, run `floorDecision` +
    `writeAutoHandoff` over the ids its record lists. "Finished" means the record is not the
    current conversation's and its last Stop is older than 30 minutes.
  - Then run `curate` once. Curation never runs per turn.

**The consequence**, stated in §7 too: ADR-0033's "a fresh clone always gets a committed
pointer" becomes a pointer lag. Between the last idle Stop of one session and the start of
the next on that machine, the entries are committed (per turn, on topic branches), but the
fallback handoff is not yet written. vfkb never pushes, so a teammate sees exactly what the
operator pushed.

### 3.5 MCP and skills

The plugin's `mcp_config.json` starts the vendored `vfkb-mcp.mjs` through `${PLUGIN_ROOT}`.
The MCP server needs the repo's brain, and agy does not pass `workspacePaths` to it. P-0
therefore also observes the server's cwd and env. The documented `cwd` field is the fallback
if the cwd is not the workspace.

`/vfkb-brief` and `/vfkb-handoff` are plugin skills. agy's skill frontmatter has no known model
pin, so `brief` runs inline on the session's model rather than on ADR-0049's Haiku. That is a
cost difference, not a capability gap.

### 3.6 Tool-name drift

The docs and the CLI already disagree (trap 3), and the disagreement will recur. Two guards:
- **Deterministic:** a unit test feeds `isBrainWrite` the exact payloads recorded in the
  probe, for both the observed and the documented names.
- **Detection:** the L4 record stores `agy --version`, and `vfkb doctor --harness agy` warns
  when the installed CLI is newer than the version the plugin was last proven on.

## 4. Phases

| Phase | Builds | Gate to start |
|---|---|---|
| 0 — probes | **P-0** a plugin installed with `agy plugin install <git-url>` loads its hooks, MCP and skills in the CLI; `${PLUGIN_ROOT}` expands in hook commands and MCP `args`; the MCP server's cwd/env · **P-1** an exit 1 with empty stdout from a `PreToolUse` hook (deny or allow?) · **P-2** an interactive session with no `--dangerously-skip-permissions`: do plugin hooks need approval, and do they coexist with the user's `herdr` group? · **P-3** an interactive multi-turn session: `invocationNum`, `executionNum` and `fullyIdle` across turns and across a `continue` · **P-4** compaction · **P-5** `GEMINI_API_KEY` + `modelProvider:gemini` in Docker · **P-6** can a project-scope plugin under `<repo>/.agents/plugins/` be a committed reference rather than a vendored tree? · **P-7** can a headless run restrict tools (so the L4 can withhold `run_command`)? · **P-8** do `.agents/rules/` files with `trigger` frontmatter load? | this RFC accepted |
| 1 — delivery, then floor and gate | the plugin repo and its release gate; the engine changes of §3.2/§3.3; `init --harness agy`; the L4 of §5, install-path arm first | P-0, P-1, P-2, P-5, P-8 |
| 2 — continuity | the `runSessionEnd` split, the idle-Stop commit and session record, the floor and curation at `SessionStart`, the Stop nudge with its loop guard | Phase 1 DEMONSTRATED, P-3 |
| 3 — prompt line | ADR-0084's handoff line through `PreInvocation`, if injection works there | a probe of `PreInvocation` injection |

After Phase 1, the dogfood order is: `tf-estate-workdir`, then `aws-agent-core-workdir`, then
the wiring carried into `OneIO-Workdir-Dev`'s template so it reaches every workdir (§8 Q4).
Phase 2's commit path cannot be dogfooded in those `main`-branch workdirs; `~/GitHub/vfkb`
(topic branches) is its dogfood repo.

## 5. Definition of Done (ADR-0050/0051)

The face is agent-facing, so its proof is a sandboxed, agent-driven L4, DEMONSTRATED ≥2/3,
with a contrast arm that can fail.

**Phase 1: `scenarios/agy-face.mjs`** (new). Dockerized, `agy -p --output-format stream-json`,
`GEMINI_API_KEY`, N=3.

Each trial:
1. Uses a sandbox `HOME`, so the operator's `~/.gemini` is never touched.
2. Installs the plugin **from its git URL** at the ref under test. A load from a local
   directory is inadmissible: ADR-0051 clause 1, the `--plugin-dir` lesson.
3. Runs `vfkb init --harness agy` in a fresh repo.
4. Seeds the brain with a handoff fact carrying a random sentinel.

| Arm | Wired (plugin + opt-in) | Contrast |
|---|---|---|
| Install path | `agy plugin list` names the plugin at the ref's version, and the wired arms below pass | — |
| Injection | the agent names the sentinel, and the stream shows **no tool call before the answer** (otherwise it could read the seeded brain) | plugin installed, no opt-in: it cannot name it without a tool call |
| Gate | a `write_file` to `.vfkb/entries.jsonl` is denied, with the deny in the stream, and the brain is still valid JSONL containing the sentinel line (#150's structural predicate) | no plugin: the write lands |
| Allow path | a `write_file` to an ordinary file succeeds (catches trap 1) | succeeds |
| Old engine | the same allow-path write with the plugin's bundle swapped for 0.24.0's (which predates `--harness agy`) still succeeds (catches B1) | — |
| MCP | `kb_add` of a second sentinel lands in `.vfkb/entries.jsonl` | no plugin: no `kb_*` tool |
| Skill | `/vfkb-brief` output starts with a nonce that exists only in the plugin's `SKILL.md`, and names the seeded sentinel | no plugin: no nonce |

- **Content only.** Every predicate is a content assertion over files or the event stream.
  Exit status and `status` are inadmissible (trap 5).
- **Model.** The model in use is read from hook payloads' `modelName` and recorded with
  `agy --version`.
- **Shell bypass.** If P-7 shows tools cannot be restricted, a trial whose agent touches
  `.vfkb/` through `run_command` is scored a **miss** for the gate arm. That is the
  conservative reading of the #151 scope limit.
- **RED first.** The scenario is committed and run before the adapter exists, and must fail on
  the wired arms.

**Phase 2: `scenarios/agy-continuity.mjs`** (new, ADR-0023). A two-conversation run in a
topic-branch repo:
- conversation A adds entries and leaves no handoff, ends idle, and is aged past the
  finished-rule;
- conversation B's `SessionStart` must write exactly one `auto` handoff naming A's entries;
- the brain commit from A's idle Stop must be in `git log`.

The contrast is the same run on `main`: no commit, and the handoff still written. A
default-branch arm asserts that Stop printed nothing.

**Delivery honesty.** The plugin repo carries a `DELIVERY-STATUS.json` and a release-gate
Brake, as `vfkb-claude-plugin` does. The install-path arm is that delivery proof. Until it is
DEMONSTRATED against a released plugin, every release note and handoff says the agy face's
delivery is unproven.

## 6. Alternatives considered

- **Committed hooks with the engine found through `$VFKB_BUNDLE_DIR`** (this RFC's first
  draft). Rejected:
  - On this machine the variable is unset and no bundle dir exists, the prose-rule failure
    ADR-0066 retired for pi.
  - Every repo would also run whatever engine that machine happened to have, which is the
    version skew behind review finding B1.
- **The engine vendored into each repo.** Rejected: 2.3 MB per upgrade (`vfkb.mjs` 918 KB +
  `vfkb-mcp.mjs` 1.37 MB) in every workdir's history, plus per-repo version skew, plus a
  conflict with the template repo that owns those workdirs' agent files.
- **A project-scope plugin** under `<repo>/.agents/plugins/`. Deferred to P-6. If it can be a
  committed reference, as pi's `.pi/settings.json` is, the opt-in becomes self-installing for
  teammates. If it means a vendored tree, it has the vendoring problem above.
- **`agy plugin import claude`** on the existing vfkb plugin. Rejected: its hooks speak Claude
  Code's contract, and trap 1 makes that harmful.
- **MCP + instructions only.** Rejected as the target. It remains the fallback if hooks prove
  unworkable, but there is no injection, so no automatic continuity.
- **A separate agy-specific CLI** (`vfkb agy-hook …`). Rejected in favour of a flag on the
  existing subcommands: one dispatch table, one fail-safe policy.

## 7. Consequences

- **A fourth repo to keep in step:** vfkb, the Claude Code plugin, the pi package, and now
  the agy plugin, with the vendoring drift ADR-0045 and ADR-0066 already live with. Each
  engine release now has three vendoring targets.
- **Three I/O shapes per hook decision.** Mitigated by keeping decisions in shared functions;
  the `runSessionEnd` split serves both the Claude and agy faces.
- **The fallback handoff lags by one session** on agy (§3.4). In `main`-branch workdirs, the
  per-turn commit never happens; their own machinery commits.
- **The gate fails safe**: a broken plugin disables it rather than blocking all writes. This
  matches the Claude Code face's posture, and `doctor` reports it.
- **Tight coupling to agy's CLI version.** Its docs already lag it, and the L4 is the only
  proof that a given `agy` version still works.

## 8. Settled questions

Settled 2026-11-09 by a Fable brainstorm under the operator's delegation. The first Q1 answer
assumed a per-machine bundle dir; that was checked, found absent, and Q1 was re-settled.

1. **"Full plugin" with committed delivery.** Settled: "full plugin" is read literally. A
   user-scope Antigravity plugin carries the engine, hooks, MCP server and skills. "Committed
   `.agents/` files" is what each repo carries: the opt-in of §3.1. Why:
   - The engine has to come from somewhere per machine, and the plugin is the only option
     without a prose rule or 2.3 MB per repo (§6).
   - Plugin and engine releasing together removes the version skew behind B1.
2. **The B2 floor one session late.** Settled: B2 does not run at the idle Stop. It runs at
   the next `SessionStart`, for each finished prior conversation, over the ids that
   conversation's session record lists. Curation moves to the same point, once per session
   start. Why:
   - Per-turn B2 would write an `auto` handoff on every turn that added knowledge without a
     handoff.
   - The HEAD-delta input cannot work once the brain is committed per turn (review finding
     B4).
3. **The idle-Stop commit.** Settled: one pathspec-scoped commit per brain-changing turn, on
   topic branches only, with no coalescing and no output on `main`. Why:
   - Coalescing makes a deterministic floor probabilistic to save history that squash-merge
     erases anyway.
   - Per-turn commits protect against the agent's own `checkout`/`stash` later in the same
     session (the 2026-07-26 stash that swallowed two entries).
4. **Which repos first.** Settled: `tf-estate-workdir`, then `aws-agent-core-workdir`, then
   the template in `OneIO-Workdir-Dev`. Why:
   - agy has already run in both workdirs; both have live brains (60 and 285 entries, read
     2026-11-09), and both are the operator's own.
   - The fact that would change the pick is which workdirs the operator's herdr panes launch
     `agy` in; that was not read.
