# Probe: does a UserPromptSubmit `systemMessage` render to the user?

**Issue:** [vfkb#408](https://github.com/vilosource/vfkb/issues/408) (child of [#389](https://github.com/vilosource/vfkb/issues/389); decides how [#395](https://github.com/vilosource/vfkb/issues/395) is routed).
**Kind:** Tier-0 probe of an external contract (ADR-0029 §5). It is not an agent-driven L4, and it is not part of `npm test`.
**Run:** 2026-10-30, Claude Code **2.1.292** (from both `claude --version` and the stream-json `init` event), model `claude-haiku-4-5-20251001`, macOS arm64, node v22.23.2, `launchctl managername` = `Background`. Each cell ran 3 trials, 27 trials in all, one claude at a time.
**Shape:** the same as arm F of [`../sessionend-budget-2026-10-27/`](../sessionend-budget-2026-10-27/README.md): a marker hook, N=3, the CLI version recorded, and content assertions only (ADR-0051 clause 3). Exit codes are never read.

## Verdict

| Surface | `systemMessage` | Contrast (`additionalContext` only) | Void |
|---|---|---|---|
| **Interactive TUI** (arm T) | **renders**, 6/6 (3 `sm` + 3 `sm+ac`), as the line `UserPromptSubmit says: <marker>` directly under the user's prompt, before the reply | absent 3/3 | 0/9 |
| **`claude -p`, text output** (arm P) | **does not render**, 0/6 in stdout and 0/6 in stderr | absent 3/3 | 0/9 |
| **`claude -p --output-format stream-json --verbose`** (arm P) | **emitted on stdout as a `system`/`informational` event**, 6/6. It is a structured event, so it reaches the user only if the consumer chooses to display it | absent 3/3 | 0/9 |

The model never repeated either marker in its reply (0/27; the reply was `pineapple` every time). So every hit above comes from the harness, not from the model relaying the text.

**Routing (brain `88a019587878`):** the result is **positive for the interactive surface**, which is where ADR-0033's default-branch and detached-HEAD warning has to reach a person. That sends #395 to a redesign on the UserPromptSubmit `systemMessage`, under a new ADR. On `claude -p` text output the message is invisible. A headless run has no person watching, so that surface needs no warning; but the new ADR has to say this rather than claim that the warning shows everywhere.

## Method

- `ups-hook.mjs` is wired as the only `UserPromptSubmit` hook in a sandbox project's `.claude/settings.json`. It has three modes:
  - `sm`: `{"systemMessage": SM}`.
  - `sm+ac`: the same plus `hookSpecificOutput.additionalContext = AC`, which is the shape #395 would ship.
  - `ac`: `additionalContext = AC` only. This is the **contrast**.

  `SM` and `AC` are fresh per trial (`VFKBSM`/`VFKBAC` plus 8 random hex), and neither appears in the prompt.
- **Control:** before it prints, the hook writes `marks/fired-<n>.json`. If no side file exists, the trial is **VOID**, not negative. Two other conditions also make a trial void: the TUI never reached its input prompt, or the model never replied. Every trial (27/27) had exactly one hook run and a reply, so no trial was void.
- **Arm P:** `claude -p "Reply with exactly one word: pineapple" --model claude-haiku-4-5-20251001 --strict-mcp-config`, run once with `--output-format text` and once with `--output-format stream-json --verbose`. `--include-hook-events` was not passed. The probe greps for the marker in stdout and stderr. For stream-json it also records which event types carried the marker.
- **Arm T:** the TUI runs inside a detached GNU `screen` session (`/usr/bin/screen` 4.00.03; tmux is not installed on this machine) at 200x50, with `defscrollback 20000` and a raw pty log (`-L`). The driver works in this order:
  1. It waits until the rendered buffer shows the footer hint `? for shortcuts`, so the input prompt is live and no onboarding or trust dialog is in the way.
  2. It types the prompt with `screen -X stuff`, then sends Enter.
  3. It waits until the sandbox transcript records the end of the turn (`stop_reason: end_turn` or `turn_duration`).
  4. It waits another 6 s, then captures the **rendered buffer including scrollback** (`hardcopy -h`, saved as `out/t-*.screen.txt`) before `/exit`.

  The marker is then grepped in three places: that buffer, the same buffer with line breaks removed (guarding against a wrapped marker), and the raw pty log with ANSI codes stripped. In all 6 positive trials it was found in all three.
- **The model's own text** is read from the sandbox transcript (`<config>/projects/*/*.jsonl`). A marker found there would be classed `relayed-by-model`, not `RENDERS`. That never happened.
- **Sandbox:** each trial gets a fresh temporary `HOME` and `CLAUDE_CONFIG_DIR`. The config's `.claude.json` is pre-seeded with `hasCompletedOnboarding`, the theme, and the project's `hasTrustDialogAccepted`, so the TUI ran entirely in the sandbox and the fallback to `--settings` on the real profile was not needed. The child env drops every inherited `CLAUDE*`, `ANTHROPIC*`, `VFKB_*` and `KB_*` variable. The operator's real profile and session history were not touched.

## No Keychain

The approach is copied from vfkb-claude-plugin#71 (`scenarios/auth.mjs`):

- The probe's own node process reads the access token once with `/usr/bin/security find-generic-password -s "Claude Code-credentials-<sha256($CLAUDE_CONFIG_DIR)[:8]>" -w`. A read does not prompt.
- The probe refuses to start if the token expires in under 60 minutes. That refusal fired once during this work: the token had 25 minutes left, so the run waited for the live session to refresh it.
- Every spawned claude gets the token as `CLAUDE_CODE_OAUTH_TOKEN`, plus a `security` shim first on `PATH`. The shim logs only `<subcommand>|<service>` and exits 44.

**Shim result:** 54 attempts, all `find-generic-password`, which is 2 reads per trial: `Claude Code-credentials-<sandbox hash>` and `Claude Code-<sandbox hash>`. **0 refused writes** (`out/shim-attempts.txt`). The token is never printed or written. Every captured text is passed through a redactor, and the committed files were grepped for `sk-ant-` before committing; the only hit is the redactor's own regex in `probe.mjs`.

## Trial table

`RENDERS` means the marker was in user-visible output and not in the model's text. `absent` means it was not found in any captured channel.

| Surface | Mode | Trial 1 | Trial 2 | Trial 3 | Channels hit |
|---|---|---|---|---|---|
| p-text | sm | absent | absent | absent | none |
| p-text | sm+ac | SM absent, AC absent | absent, absent | absent, absent | none |
| p-text | ac (contrast) | absent | absent | absent | none |
| p-json | sm | RENDERS | RENDERS | RENDERS | stdout, event `system/informational` |
| p-json | sm+ac | SM RENDERS, AC absent | RENDERS, absent | RENDERS, absent | stdout `system/informational` (SM only) |
| p-json | ac (contrast) | absent | absent | absent | none |
| t | sm | RENDERS | RENDERS | RENDERS | screen, screen with line breaks removed, raw pty |
| t | sm+ac | SM RENDERS, AC absent | RENDERS, absent | RENDERS, absent | screen, screen with line breaks removed, raw pty (SM only) |
| t | ac (contrast) | absent | absent | absent | none |

The raw per-trial rows are in `out/results.json`, which also holds `meta`: the CLI version, the model, the minutes left on the token, the platform, and the shim summary.

**The assertion can fail.** On the TUI and on stream-json, the same grep finds `SM` and does not find `AC` in the same run (`sm+ac`), and does not find `AC` when `AC` is the only marker (`ac`). Both markers reached the transcript on disk (`smInTranscript`/`acInTranscript` in the rows), so the hook delivered both; only the `systemMessage` was shown. On p-text every cell is absent, so on that surface the contrast does not discriminate by itself. The negative result there rests on the control: the hook ran, emitted the marker, and the marker was stored in the transcript, yet it was not printed.

## Not observed, or inferred

- **The rendered glyphs.** `screen` 4.00.03's `hardcopy` mangles multi-byte characters into `�` in `out/t-*.screen.txt`, so the line's prefix glyph and any icon were not observed. The ASCII text, including `UserPromptSubmit says: <marker>`, is intact.
- **Wording, styling, persistence.** The probe asserts presence only. It did not check colour, dimming, or whether the line survives a redraw such as `/clear` or a resize. The TUI in the probe ran in `screen` with `TERM=xterm-256color`; Terminal.app, iTerm, VS Code and herdr panes were not run.
- **Other prompts and turns.** Every trial was a one-turn session with a short prompt. A long prompt, or a turn that runs tools, was not exercised. The probe assumes the line still renders when the turn is long, but did not observe it.
- **`--include-hook-events`** was not passed. The `system`/`informational` event appears without it.
- **The real vfkb hook.** The marker hook stood in for vfkb's UPS hook. Whether the plugin-provided UPS hook (`--plugin-dir` or an installed plugin) renders the same way was not run; this probe used a project-settings hook.
- **Other CLI versions.** Only 2.1.292 was run.

## Files

- `probe.mjs`: the harness (arms P and T, the control, the contrast, the no-Keychain shim). It writes `out/`.
- `ups-hook.mjs`: the marker hook.
- `out/results.json`: every trial row, plus `meta`.
- `out/t-*.screen.txt`: the rendered TUI buffer with scrollback for each T trial, captured before `/exit`. They are saved **compacted**: trailing whitespace is trimmed and empty lines are dropped, because `hardcopy -h` pads about 20,000 empty scrollback lines. The probe's assertions ran on the full buffer. The committed copies were compacted after the run with the same transform that `probe.mjs` now applies (`compact()`). Re-grepping them gives the marker `VFKBSM…` in all 6 `sm`/`sm+ac` files and `VFKBAC…` in none.
- `out/shim-attempts.txt`: what the `security` shim saw.

To reproduce (27 short haiku turns, one claude at a time, about 12 minutes):

```sh
node docs/research/probes/ups-systemmessage-2026-10-30/probe.mjs
# narrow it: PROBE_TRIALS=1 PROBE_ARMS=t:sm,p-json node .../probe.mjs
```

It needs `CLAUDE_CONFIG_DIR` set to a logged-in profile whose Keychain token has at least 60 minutes left, plus `/usr/bin/screen` for arm T.
