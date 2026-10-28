# Harness-turn probe: 2026-10-27, Claude Code CLI 2.1.292

This is the Tier-0 probe that ADR-0084 §2.6 asks for (vfkb#385). It also answers ADR-0080 §5 Q4 for v3 R1, which uses the same handler. It answers three questions:

1. Does `UserPromptSubmit` fire for each kind of harness turn?
2. What does the start of the `prompt` field look like for each kind?
3. What does `vfkb hook user-prompt-submit` cost in wall time on this repo's brain?

## Kit

- **`ups-log.sh`**: a UserPromptSubmit hook that appends its stdin to `$PROBE_LOG` and prints nothing, so it cannot affect the agent.
- **`run.sh`** (metered, uses `claude-haiku-4-5`, costs a few cents): drives every kind a headless `claude -p` can produce. It writes raw logs to `./out/`; do not commit them, because they hold local paths and session ids. `observed.json` is the committed digest of those logs.
- **`latency.mjs`** (free, no model): times the real hook, N=10 cold and N=10 same-key. It checks each call's stdout, so a hook that exits early cannot pass as fast. Its output is in `latency.out`.

## 1–2. Fires and prompt heads (`observed.json`)

| Turn kind | Fires? | `prompt` starts with | Skipped by `isHarnessPrompt` |
|---|---|---|---|
| `-p` prompt | yes, 1 | the typed text | no (correct: it is typed) |
| `--resume` prompt | yes, 1 | the typed text | no (correct) |
| background Bash task completing | **yes, a 2nd fire** | `<task-notification>\n<task-id>…` | **yes** |
| background subagent hand-back | **yes, a 2nd fire** | `<task-notification>\n<task-id>…` | **yes** |
| cross-session message | not observed | — | (`Another Claude session sent a message:` is on the allowlist, unverified) |
| cron / `/loop` tick | not observed | — | — |
| queued prompt | not observed | — | — |
| usage-limit reset | not observed | — | (`Your claude.ai usage limit has reset` is on the allowlist, unverified) |

The payload keys were the same in every fire: `cwd, hook_event_name, permission_mode, prompt, prompt_id, session_id, transcript_path`. No field marks a turn as harness-generated, so the start of the prompt is the only signal available.

**Not observed** means `run.sh` could not produce that kind. Cross-session messages, cron and `/loop` ticks, queued prompts and usage-limit resets all need the interactive TUI or a real limit event. They are left unverified rather than guessed. The two allowlist entries that this probe did not reproduce rest on RFC-047 brainstorm E's tally of local transcripts, which is also UNVERIFIED. `<task-notification>` is **observed** for both background tasks and subagent hand-backs, and that lead-in accounts for 1,353 of the 1,377 system-origin turns in the tally.

**Consequence for the design:** UserPromptSubmit fires on these harness re-invocations under the parent's session id. The column-0 `<task-notification>` skip in `src/harness-prompt.ts` therefore carries real weight: it stops the line from riding a turn the user never typed.

## 3. Latency (`latency.out`)

The brain is 1,347,849 bytes, using `dist/cli.js` at the #385 build.

| Path | p50 | p95 | max |
|---|---|---|---|
| cold (full gather) | 322 ms | 370 ms | 370 ms |
| same key (steady state) | 126 ms | 139 ms | 139 ms |

Both paths sit well inside the handler's own 2 s budget (decide step Q12) and the harness default of 30 s. Under the Q12 rule this does not justify a `timeout` field in the plugin's `hooks.json`.
