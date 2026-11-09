# Probe: what Antigravity's `agy` CLI actually does with a vfkb-shaped wiring

**Feeds:** [RFC-048](../../../rfc/RFC-048-antigravity-harness-face.md).
**Date:** 2026-11-09. **CLI:** `agy` at `~/.local/bin/agy` (macOS). **Run 1 ran on 1.4.12;
runs 2–5 ran on 1.5.3.** agy updated itself in the background during run 1. Its log
(`~/.gemini/antigravity-cli/log/cli-20261109_113404.log`) records `Spawned background update
process`, and the replaced binary was kept as `~/.local/bin/agy.1794216844509870000.old`. The
version for each run is read from that run's agy log. A review found this; the first version
of this record said 1.4.12 throughout.

**Version confound.** Two comparisons below set a run-1 result (1.4.12) against a later run
(1.5.3): flat vs. wrapped tool handlers, and flat vs. nested `SessionStart` injection. Each
difference may come from the config, from the version, or from both.
**Model:** `gemini-3.8-flash-high` (the CLI's default; reported in every hook payload's `modelName`).
**Account:** the operator's signed-in `agy` login (keyring), not an API key.

Six headless `agy -p … --output-format json --dangerously-skip-permissions` invocations,
numbered 1–5 below (run 4 made two: one MCP prompt, one skill prompt). Each ran in a fresh
throwaway git repo under the session scratchpad, with a committed-style `.agents/hooks.json`
and/or `.agents/mcp_config.json`. **Every invocation was a single prompt, so nothing here
observes behaviour across turns.** Every hook ran a small node script that
logged its stdin and printed a chosen response. The two scripts are kept here
([`probe-hook.mjs`](probe-hook.mjs), [`probe-allow-shapes.mjs`](probe-allow-shapes.mjs)).

**What this is and is not.** It is a set of N=1 observations of one CLI version, on one model,
on one OS, all under `--dangerously-skip-permissions`. It is evidence for an RFC's *shape*. It
is **not** an L4 and proves no capability (ADR-0050).

## Why it was run

A research pass over the published docs (brain `053e25c55997`) produced an integration map.
The docs carry no dates or versions. The first run below contradicted two of the doc-derived
claims, so every load-bearing claim was re-checked against the CLI.

## Results

| # | Question | Config | Observed |
|---|---|---|---|
| 1 | Do project hooks load, and which events fire? | `.agents/hooks.json`, one named group, all 6 documented events + `SessionEnd`, every handler a flat `{type,command,timeout}` | `SessionStart` ×1, `PreInvocation`/`PostInvocation` ×15 each (one pair per model call), `Stop` ×1. **`PreToolUse`/`PostToolUse` never fired.** Their handlers lacked both the `{matcher, hooks}` wrapper and a `matcher`, so which omission caused it is not separated. No `SessionEnd`, and no error for naming it. No trust prompt. |
| 1 | Does `{"injectSteps":[{"systemMessage":"…"}]}` inject at SessionStart? | — | **No.** The agent said it was given no codeword. |
| 2 | Nested injection shape | `{"injectSteps":[{"systemMessage":{"systemMessage":"…"}}]}` | **Yes.** The agent named the codeword. |
| 2 | Stop `continue` | First Stop returns `{"decision":"continue","reason":"…TANGERINE"}`, later Stops `{}` | **Yes.** The agent ended its reply with TANGERINE; `Stop` fired twice. No native re-entry flag in the payload, so the probe guarded with a flag file. |
| 2 | Gate with the documented tool names | `PreToolUse` `{matcher:"write_to_file\|replace_file_content\|multi_replace_file_content"}` | **Never fired.** `PostToolUse` (`matcher:"*"`) logged the real tool name: **`write_file`**, args `{Path, Content}`. The `.vfkb/` write went through. |
| 3 | Gate with the real tool names | `matcher:"write_file\|edit_file\|…"` returning `{"decision":"deny","reason":"vfkb gate: …"}` for a path under `.vfkb/` | **Denied.** Tool error text: `tool call denied by pre-tool hook: vfkb gate: write via kb_add`. `edit_file` args are `{Path, Target, Replacement}`. |
| 3 | A gate hook that crashes | prints deny JSON, then `exit 1` | **Denied**: `JSON hook "jsonhook__probe_PreToolUse_2_0" failed: command failed: exit status 1`. The error names the exit status, but the hook had also printed deny JSON, so this is **confounded**: an exit 1 with empty stdout was not tested. The build-plugins page says non-zero exits are ignored (fail open). |
| 3 | Shell bypass | `run_command` `echo hacked > .vfkb/shell.txt` | Not seen by the write gate (expected; `run_command` args are `{CommandLine, WaitMsBeforeAsync, toolSummary}`). Same scope limit as `src/gating.ts`. |
| 4 | Project MCP server | `.agents/mcp_config.json`, `vfkb` server = `node <abs path>/vfkb-mcp.mjs` (plugin 0.24.0's vendored bundle), `VFKB_DATA_DIR=<abs path>/.vfkb` | **Works.** The entry landed in the probe brain, and `kb_search` returned it. The agent *said* it called them through a `call_mcp_tool` meta-tool; that name is the agent's report, not logged. |
| 4 | Project skill as a slash command | `.agents/skills/vfkb-probe/SKILL.md` | **Works.** `agy -p "/vfkb-probe"` returned the skill's sentinel. |
| 5 | PreToolUse **allow** shapes | `write_file` hook prints `{}` / prints nothing | **`{}` is a DENY** (`tool call denied by pre-tool hook:` with an empty reason). **Empty stdout allows.** `{"decision":"allow"}` allows (runs 3–4). |
| 5 | SessionStart hook that exits 1 | — | The session continued normally. |
| 5 | `${VAR}` in MCP `args`, relative `VFKB_DATA_DIR` | `args:["${PROBE_BUNDLE}/vfkb-mcp.mjs"]`, `env:{VFKB_DATA_DIR:".vfkb"}`, `PROBE_BUNDLE` exported in the launching shell | **The server never registered** ("kb_add is not available"). Not isolated: either `${VAR}` is not expanded in workspace MCP args, or the server failed for another reason. No `.vfkb/` was created. |

All six runs exited 0 with `"status":"SUCCESS"`, including runs where every gated write was
denied. The exit status says nothing about whether the wiring worked.

## Configs used

Commands are abbreviated as `H <event> <mode>` for `node <scratch>/probe-*.mjs <event> <log> …`.

- **Run 1:** `{"probe": {"<Event>": [{"type":"command","command":"H <Event>","timeout":10}], …}}`
  for all seven event names, flat.
- **Run 2:** `{"probe": {"SessionStart": [H], "PreToolUse": [{"matcher":"write_to_file|replace_file_content|multi_replace_file_content","hooks":[H gate]}, {"matcher":"write_to_file","hooks":[H crash]}, {"matcher":"run_command","hooks":[H log]}], "PostToolUse": [{"matcher":"*","hooks":[H]}], "Stop": [H]}}`
- **Run 3:** `PreToolUse`: `{"matcher":"*"}` → log; `{"matcher":"write_file|edit_file|replace_file_content|multi_replace_file_content|write_to_file"}` → gate; `{"matcher":"write_file"}` → crash. `PostToolUse`: `{"matcher":"*"}`.
- **Run 4:** no hooks. `.agents/mcp_config.json` = `{"mcpServers":{"vfkb":{"command":"node","args":["<abs>/vfkb-mcp.mjs"],"env":{"VFKB_DATA_DIR":"<abs>/.vfkb"}}}}`, plus `.agents/skills/vfkb-probe/SKILL.md`.
- **Run 5:** `SessionStart` (exits 1), `PreToolUse` `{"matcher":"write_file"}` → [`probe-allow-shapes.mjs`](probe-allow-shapes.mjs); `.agents/mcp_config.json` with `"args":["${PROBE_BUNDLE}/vfkb-mcp.mjs"]` and `"env":{"VFKB_DATA_DIR":".vfkb"}`.

## Payload shapes seen (stdin)

- Common to every event: `conversationId`, `workspacePaths`, `transcriptPath`,
  `artifactDirectoryPath`, `modelName`, `lastUserInput`.
- `PreInvocation`/`PostInvocation`: `invocationNum` (0 on the first model call of the run;
  whether it resets per turn is unobserved, since every run was one prompt), `initialNumSteps`.
- `PreToolUse`/`PostToolUse`: `toolCall: {name, args}`, `stepIdx`; `PostToolUse` adds `error`.
  In every logged `write_file`/`edit_file` call (runs 2, 3 and 5), `args.Path` was an absolute
  path, although the prompts named the files relatively.
- `Stop`: `executionNum`, `terminationReason` (seen: `NO_TOOL_CALL`), `fullyIdle`, `error`.

Session transcripts are written under `~/.gemini/antigravity-cli/brain/<conversationId>/`.

## Not covered

- Any run *without* `--dangerously-skip-permissions` (so: whether workspace hooks need trust
  approval in an interactive session).
- The Antigravity app and IDE.
- Hook timeouts.
- Whether a PreToolUse hook sees MCP calls as `call_mcp_tool` (inferred from the agent's own
  report in run 4, not logged).
- `GEMINI_API_KEY` auth and Docker.
