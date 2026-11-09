# Probe: what Antigravity's `agy` CLI actually does with a vfkb-shaped wiring

**Feeds:** [RFC-048](../../../rfc/RFC-048-antigravity-harness-face.md).
**Date:** 2026-11-09. **CLI:** `agy` 1.4.12 (macOS, at `~/.local/bin/agy`).
**Model:** `gemini-3.8-flash-high` (the CLI's default; reported in every hook payload's `modelName`).
**Account:** the operator's signed-in `agy` login (keyring), not an API key.

Six headless runs (`agy -p … --output-format json --dangerously-skip-permissions`), each in a
fresh throwaway git repo under the session scratchpad, with a committed-style
`.agents/hooks.json` and/or `.agents/mcp_config.json`. Every hook ran a small node script that
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
| 1 | Do project hooks load, and which events fire? | `.agents/hooks.json`, one named group, all 6 documented events + `SessionEnd`, every handler a flat `{type,command,timeout}` | `SessionStart` ×1, `PreInvocation`/`PostInvocation` ×15 each (one pair per model call), `Stop` ×1. **`PreToolUse`/`PostToolUse` never fired** (flat handlers, no `matcher`). No `SessionEnd`, and no error for naming it. No trust prompt. |
| 1 | Does `{"injectSteps":[{"systemMessage":"…"}]}` inject at SessionStart? | — | **No.** The agent said it was given no codeword. |
| 2 | Nested injection shape | `{"injectSteps":[{"systemMessage":{"systemMessage":"…"}}]}` | **Yes.** The agent named the codeword. |
| 2 | Stop `continue` | First Stop returns `{"decision":"continue","reason":"…TANGERINE"}`, later Stops `{}` | **Yes.** The agent ended its reply with TANGERINE; `Stop` fired twice. No native re-entry flag in the payload, so the probe guarded with a flag file. |
| 2 | Gate with the documented tool names | `PreToolUse` `{matcher:"write_to_file\|replace_file_content\|multi_replace_file_content"}` | **Never fired.** `PostToolUse` (`matcher:"*"`) logged the real tool name: **`write_file`**, args `{Path, Content}`. The `.vfkb/` write went through. |
| 3 | Gate with the real tool names | `matcher:"write_file\|edit_file\|…"` returning `{"decision":"deny","reason":"vfkb gate: …"}` for a path under `.vfkb/` | **Denied.** Tool error text: `tool call denied by pre-tool hook: vfkb gate: write via kb_add`. `edit_file` args are `{Path, Target, Replacement}`. |
| 3 | A gate hook that crashes | prints deny JSON, then `exit 1` | **Denied** (fails *closed*): `JSON hook "jsonhook__probe_PreToolUse_2_0" failed: command failed: exit status 1`. The build-plugins page says non-zero exits are ignored (fail open). |
| 3 | Shell bypass | `run_command` `echo hacked > .vfkb/shell.txt` | Not seen by the write gate (expected; `run_command` args are `{CommandLine, WaitMsBeforeAsync, toolSummary}`). Same scope limit as `src/gating.ts`. |
| 4 | Project MCP server | `.agents/mcp_config.json`, `vfkb` server = `node <abs path>/vfkb-mcp.mjs` (plugin 0.24.0's vendored bundle), `VFKB_DATA_DIR=<abs path>/.vfkb` | **Works.** The agent called `kb_add` then `kb_search` through a `call_mcp_tool` meta-tool on server `vfkb`; the entry landed in the probe brain. |
| 4 | Project skill as a slash command | `.agents/skills/vfkb-probe/SKILL.md` | **Works.** `agy -p "/vfkb-probe"` returned the skill's sentinel. |
| 5 | PreToolUse **allow** shapes | `write_file` hook prints `{}` / prints nothing | **`{}` is a DENY** (`tool call denied by pre-tool hook:` with an empty reason). **Empty stdout allows.** `{"decision":"allow"}` allows (runs 3–4). |
| 5 | SessionStart hook that exits 1 | — | The session continued normally. |
| 5 | `${VAR}` in MCP `args`, relative `VFKB_DATA_DIR` | `args:["${PROBE_BUNDLE}/vfkb-mcp.mjs"]`, `env:{VFKB_DATA_DIR:".vfkb"}`, `PROBE_BUNDLE` exported in the launching shell | **The server never registered** ("kb_add is not available"). Not isolated: either `${VAR}` is not expanded in workspace MCP args, or the server failed for another reason. No `.vfkb/` was created. |

All six runs exited 0 with `"status":"SUCCESS"`, including runs where every gated write was
denied. The exit status says nothing about whether the wiring worked.

## Payload shapes seen (stdin)

- Common to every event: `conversationId`, `workspacePaths`, `transcriptPath`,
  `artifactDirectoryPath`, `modelName`, `lastUserInput`.
- `PreInvocation`/`PostInvocation`: `invocationNum` (0 on the first model call of the turn),
  `initialNumSteps`.
- `PreToolUse`/`PostToolUse`: `toolCall: {name, args}`, `stepIdx`; `PostToolUse` adds `error`.
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
