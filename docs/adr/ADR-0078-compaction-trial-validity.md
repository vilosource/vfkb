---
type: Decision
title: "ADR-0078: A compaction trial is valid only if a compaction actually happened (amends ADR-0077 clause 3)"
description: "The clause-3 probes for ADR-0077's compaction-survival L4 found four ways a trial looks real when it is not: a one-exchange /compact is a no-op; a failed compaction is reported as result:success; a refusal scores as a contrast miss; and host sleep (macOS maintenance sleep) stretches a trial across minutes of wall-clock time and drops connections. This ADR adds validity conditions (compacted by THIS manual /compact, no compaction error, engaged answer, answered in time with no host sleep) and run requirements (caffeinate, message pacing on results, stream to file). An invalid trial is never scored as a hit or a miss."
status: "Accepted"
timestamp: 2026-10-20
---

# ADR-0078: A compaction trial is valid only if a compaction actually happened

- **Status:** Accepted (2026-10-20, operator ruling; brain decision `a8a54a6ddd41`)
- **Date:** 2026-10-20
- **Amends:** [ADR-0077](ADR-0077-compaction-survival-guard.md) clause 3, the L4 specified in
  [RFC-042](../rfc/RFC-042-compaction-survival-guard.md) part 3. Per
  [ADR-0001](ADR-0001-record-decisions-as-adrs.md) a decided ADR is immutable, so the change is
  recorded here. Every other part of ADR-0077 stands, including Q1 (phased) and Q2 (every
  release).
- **Relates:**
  - [ADR-0051](ADR-0051-delivery-honesty.md) §3: the quiet-success trap. All three findings
    are instances of it.
  - [ADR-0022](ADR-0022-l4-evaluation-methodology.md): DEMONSTRATED ≥2/3.
  - [ADR-0070](ADR-0070-guards-that-can-fail.md): guards are seen red.
- **Evidence:** brain gotchas `ddf66cb9316f` (probe 1) and `89e4002fdf66` (probe 2), and
  this ADR's Context.

## Context

ADR-0077 clause 3 left two things unobserved. Before building the L4 they were probed on
2026-10-19 with `claude-haiku-4-5`, no tools (`--tools "" --strict-mcp-config`), the
omit-code-words `/compact` instructions, and one stream-json process per trial.

**Both assumptions hold:**

| Probe | Arm | Result |
|---|---|---|
| CLI **2.1.220** (the CI evidence leg's pin), `--plugin-dir` | shipped | compacted, re-injected, summary clean, agent recalled |
| | startup-matcher | compacted, nothing re-injected, summary clean, agent said NONE |
| 2.1.220, **marketplace install** (sandboxed HOME, `marketplace add` + `install`) | shipped | compacted, re-injected, summary clean, 0 tool uses, agent recalled |
| | startup-matcher (a temp-copy source; the installed `hooks.json` carries the matcher) | **no valid trial under this ADR.** One run was a no-op, one compaction failed, and the one that compacted ended in a refusal ("I can't help with that request") |

So no CLI pin bump is needed. The re-injection path is observed working under a real
marketplace install. The marketplace **contrast** arm has not yet produced a trial this ADR
would count; its counterpart under `--plugin-dir` has. All counts are N=1 per arm. These are
observations, not rates.

**But three quiet-success shapes turned up. ADR-0077 clause 3 as accepted would score each
one:**

1. **A no-op compaction.** With one exchange before `/compact`, 2.1.220 answers "Not enough
   messages to compact." `PreCompact` fires, but there is no `SessionStart(compact)`, no
   `PostCompact` and no `compact_boundary`. The startup injection is still in context, so the
   agent "recalls" the sentinel in **either** arm.
2. **A failed compaction reported as success.** A mid-response API disconnect produced
   `result: success` with the text "Error during compaction: API Error: Connection closed
   mid-response." There was no boundary, and the agent then recalled the sentinel from the
   never-compacted context. In the contrast arm that is a *hit*, which turns the verdict red
   for the wrong reason.
3. **A refusal scores as a contrast miss.** The only compacted marketplace contrast trial
   ended with "I can't help with that request." Scored on `received` alone, that is a clean
   contrast miss, the outcome the contrast exists to show, without the agent ever reporting
   what it knew.
4. **Host sleep.** The probes ran on a laptop in macOS maintenance sleep. `pmset -g log` shows
   DarkWake every 4–5 minutes, and the session's message timestamps match those wakes to
   within seconds: messages read at 19:07:31, 19:12:45, 19:17:18 and 19:21:50 EEST against
   DarkWakes at 19:07:29, 19:12:42, 19:17:18 and 19:21:41. Each message paced 25–70 s apart
   arrived about 4.5 minutes apart. A "906 s" single-turn run was wall-clock time across one
   sleep (19:42:08 → 19:57:10); it exited normally (exit 0), so it did **not** "ignore
   SIGTERM". The mid-response disconnect in shape 2, and an earlier `ENOTFOUND`, are
   **plausibly** sleep as well. That is likely but not established, so it is labelled here
   rather than asserted. A wall-clock timeout cannot be interpreted across sleep.

The noLeak and noToolUse conditions catch none of these. ADR-0077's per-trial booleans
assume a compaction happened, an engaged answer, and a machine that stays awake.

## Decision

### Validity

A trial is **valid** only if **all** of these hold. RFC-042's two conditions stay:

1. `noLeak`: `PostCompact.compact_summary` does not carry either sentinel (normalised match,
   per RFC-042).
2. `noToolUse`: no `tool_use` appears after `compact_boundary`.

These are new:

3. **`compacted`:** a `compact_boundary` with `compact_metadata.trigger == "manual"` is
   observed **between** the `/compact` input and its result. An earlier auto-compaction does
   not count. `noLeak` reads the `PostCompact` of **that** compaction.
4. **`compactionOk`:** the `/compact` result text does not contain `Error during compaction`.
   This is a second line behind `compacted`. It is a literal string, so it would break if the
   CLI rewords the message, and `compacted` is the condition that matters.
5. **`engaged`:** the final answer, lower-cased and stripped of non-alphanumerics, is one of
   the trial's sentinels or `none`. A refusal or any other answer is invalid in **both** arms.
6. **`answered`:** the final question produced a `result` before the hard timeout. The number
   of `result` events equals the number of messages sent, so no turn was merged or answered
   out of order.
7. **`awake`:** the host did not sleep during the trial. Wall-clock and monotonic time
   (`Date.now()` against `process.hrtime`) agree to within a small tolerance, proposed at 5 s.

Two more rules apply to validity:

- **An invalid trial is never scored as a hit or a miss in either arm.** It is recorded in
  full, with each boolean, and the gate recomputes its validity.
- **ADR-0077's DEMONSTRATED rule is unchanged,** but it is computed over *valid* trials: at
  least 3 valid trials per arm, compacted ≥ ceil(2n/3), contrast hits = 0, every attempt
  recorded, and the attempts cap.

### Run requirements

- **Run under `caffeinate -i`** (or an equivalent on another host), so idle sleep cannot
  occur. `awake` detects it if it happens anyway.
- **Send each message only after the previous `result` arrives.** No fixed sleeps. At least 3
  real exchanges come before `/compact`, so a compaction is possible at all.
- **The stream is written to a file as it arrives,** and each trial runs under a hard timeout
  measured in monotonic time. On expiry the process group is killed and the trial is scored
  from the file.

### Gate

The scenario-specific `release-gate.mjs` rule from ADR-0077 recomputes validity from all
seven booleans. Its selftest must be observed red when the trial counts as valid while any
one of these is false: `compacted`, `compactionOk`, `engaged`, `answered`, `awake`. It must
also be observed red on a contrast "hit" that came from an invalid trial.

## Consequences

- **Transient failures cost attempts, not verdicts.** Host sleep, network drops and
  refusals produce invalid trials and may exhaust the attempts cap, which is a red. They do
  not produce a false hit.
  ADR-0077 named the cap at 6 per arm, and that may need raising if invalid trials are common.
  That is a separate decision, made on evidence.
- **The "exit hang" was host sleep, not a CLI defect.** It was first misread as the CLI
  ignoring SIGTERM. The PR #356 review found the sleep/wake correlation and this ADR's author
  confirmed it in `pmset -g log`. The correction is recorded in brain `89e4002fdf66`'s
  follow-up.
- **Auto-compaction (`trigger: "auto"`) remains unobserved,** as ADR-0077 states.
