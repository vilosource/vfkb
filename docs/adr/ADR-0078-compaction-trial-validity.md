---
type: Decision
title: "ADR-0078: A compaction trial is valid only if a compaction actually happened (amends ADR-0077 clause 3)"
description: "The clause-3 probes for ADR-0077's compaction-survival L4 found three ways a trial looks real when it is not. A one-exchange conversation makes /compact a no-op. A mid-response API failure is reported as result:success with nothing compacted. And the CLI can hang on exit after a valid final answer. In the first two cases the startup context is never removed, so either arm 'recalls' the sentinel; under ADR-0077 as accepted that scores as a real result. This ADR adds three validity conditions (compacted, no compaction error, answered before a hard timeout) and three run requirements. An invalid trial is never scored as a hit or a miss."
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
| | startup-matcher (a temp-copy source; the installed `hooks.json` carries the matcher) | compacted, nothing re-injected, summary clean, agent did not produce the sentinel (it refused) |

So no CLI pin bump is needed, and the trial shape works under a real marketplace install. All
counts are N=1 per arm. These are observations, not rates.

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
3. **A hang on exit after a valid answer.** The process sometimes fails to exit after its final
   result. One single-turn run took 906 s and ignored SIGTERM; an identical run exited in 4 s.
   This was intermittent, on a day with a flaky network, and the cause is not established.
   A trial that times out after its final answer has real content. One that times out before
   the answer has none.

The noLeak and noToolUse conditions do not catch any of these. ADR-0077's per-trial booleans
all assume a compaction happened.

## Decision

### Validity

A trial is **valid** only if **all** of these hold. RFC-042's two conditions stay:

1. `noLeak`: `PostCompact.compact_summary` does not carry either sentinel (normalised match,
   per RFC-042).
2. `noToolUse`: no `tool_use` appears after `compact_boundary`.

Three are new:

3. **`compacted`:** at least one `compact_boundary` is observed in the stream **before** the
   final question's result.
4. **`compactionOk`:** the `/compact` turn's result text does not contain
   `Error during compaction`.
5. **`answered`:** the final question produced a `result` event before the hard timeout.

Two more rules apply to validity:

- **An invalid trial is never scored as a hit or a miss in either arm.** It is recorded in
  full, with each boolean, and the gate recomputes its validity.
- **ADR-0077's DEMONSTRATED rule is unchanged,** but it is computed over *valid* trials: at
  least 3 valid trials per arm, compacted ≥ ceil(2n/3), contrast hits = 0, every attempt
  recorded, and the attempts cap.

### Run requirements

- **At least 3 real exchanges come before `/compact`,** so a compaction is possible at all.
- **The stream is written to a file as it arrives,** not buffered in the parent. A process
  that hangs **after** its final result therefore remains scoreable.
- **Each trial runs under a hard timeout.** On expiry the **process group** is killed: SIGTERM
  alone was observed to be ignored. The trial is then scored from the captured file. It is
  valid only if `answered` holds, so a kill before the final result is invalid.

### Gate

The scenario-specific `release-gate.mjs` rule from ADR-0077 recomputes validity from all five
booleans. Its selftest must be observed red on four fixtures:

- a trial with `compacted: false` that is counted as valid;
- a trial with `compactionOk: false` that is counted as valid;
- a trial with `answered: false` that is counted as valid;
- a contrast "hit" that came from an invalid trial.

## Consequences

- **Network flakiness costs attempts, not verdicts.** An unstable afternoon produces invalid
  trials and may exhaust the attempts cap, which is a red. It does not produce a false hit.
  ADR-0077 named the cap at 6 per arm, and that may need raising if invalid trials are common.
  That is a separate decision, made on evidence.
- **The exit hang is unexplained.** The rule makes it harmless to the verdict. It does not
  diagnose it, and if it is a CLI defect it may be worth reporting upstream.
- **Auto-compaction (`trigger: "auto"`) remains unobserved,** as ADR-0077 states.
