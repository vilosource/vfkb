---
type: RFC
title: "RFC-042: The compaction re-injection exists by accident — make it a guarantee"
description: "v3 theme R2. The 2026-10-19 probe found that the shipped plugin already re-injects the Constitution, the pinned handoff and the knowledge bundle after a compaction. SessionStart fires again with source:\"compact\", the plugin's SessionStart hook has no matcher, and the engine never reads `source`. Nobody designed that, nothing tests it, and a tidy-looking matcher edit would silently delete it. This RFC proposes the guard: a deterministic Brake on the matcher, an engine unit test on the compact-source render, and an L4 that can actually fail, because /compact custom instructions close the summary-luck channel. Narrowing the re-injected payload is deferred until there is evidence it costs anything."
status: "Accepted → ADR-0077 (2026-10-19)"
timestamp: 2026-10-19
---

# RFC-042: The compaction re-injection exists by accident — make it a guarantee

- **Status:** **Accepted 2026-10-19 → [ADR-0077](../adr/ADR-0077-compaction-survival-guard.md)**, as recommended: Q1 phased, Q2 every release.
- **Date:** 2026-10-19
- **Deciders:** operator + Claude
- **Theme:** v3 PRD §6 **R2** ("Survive compaction"), which Ruling 4 places after R5/R6.
- **Relates:**
  - [ADR-0008](../adr/ADR-0008-constitution-tier.md) (the Constitution always leads) and
    [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md) (the handoff pin is never
    budget-dropped). These are the two guarantees that a compaction would otherwise end.
  - [ADR-0045](../adr/ADR-0045-vfkb-claude-code-plugin.md): the plugin owns the wiring.
  - [ADR-0048](../adr/ADR-0048-retire-wiring-smoke-gate.md): wiring validation lives in the
    plugin repo.
  - [ADR-0023](../adr/ADR-0023-scenario-contract-first.md),
    [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) and
    [ADR-0051](../adr/ADR-0051-delivery-honesty.md) §3: the L4 contract and the content
    assertion it must use.
  - [ADR-0070](../adr/ADR-0070-guards-that-can-fail.md): a guard is trusted only once it has
    been seen red.
- **Evidence:**
  - brain `26887a51ef91` (the matcher shapes, correcting `b6060bb9705c`) and `c276f42c1f2f`
    (a no-tools trial still re-injects);
  - harness survey [§7b](../v3/research/claude-code-harness-2026-10.md);
  - the probe kit in
    [`docs/v3/research/probes/compaction-2026-10-19/`](../v3/research/probes/compaction-2026-10-19/);
  - brain `1b10486b07c6` (the finding), `58b04a6c2989` (the custom-instructions lever) and
    `c937f9a07265` (the handoff).

## Context

The PRD drafted R2 as a build. It assumed nothing re-injects vfkb's context after a
compaction, and it named `PostCompact` as the place to add re-injection. The probe found
otherwise. Every claim below was observed on CLI 2.1.286 with `claude-haiku-4-5`.

1. **Compaction fires `PreCompact`, then `SessionStart` with `source:"compact"`, then
   `PostCompact`.** Timed hooks confirmed they run strictly in that order.
   `SessionStart(compact)` runs after the summary has been written.
2. **What `SessionStart(compact)` injects reaches the post-compaction context.**
3. **The shipped plugin (0.20.1) already re-injects.** Its `hooks.json` SessionStart entry has
   no `matcher`, so it fires on `startup|resume|clear|compact`. The `hook session-start`
   handler, in both `src/cli.ts` and the vendored bundle, reads only `session_id` and never
   `source`. So the full resume render is re-emitted after compaction: the digest, the
   Constitution, the pinned handoff and the ranked bundle. The trace shows it:
   `hook_response SessionStart:compact` carries the constitutional sentinel.
4. **Without the re-injection, survival is luck.** Across the 2026-10-19 runs:

| Arm | Recalled after compaction |
|---|---|
| shipped plugin | 3/3. Re-injection carried the sentinel every time; 1 run isolates receipt |
| plugin with `matcher:"startup"` | 1/2. The miss happened even though the summary contained the sentinel |
| synthetic startup-only | 0/3 |
| control, no `/compact` | 2/2 |

5. **`/compact <instructions>` closes the luck channel.** Instructing the summariser to omit
   code words left `compact_summary` without the sentinel in both arms. The shipped plugin
   then recalled it via re-injection, and the startup-only copy said `NONE`. That was N=1 per
   arm (brain `58b04a6c2989`).

**The problem is therefore not a missing capability. It is an unguarded one.** The most
natural tidy-up of `hooks.json` adds a matcher such as `"startup|resume"`. That would delete
ADR-0008's and ADR-0049's post-compaction coverage. CI would stay green, every L4 on record
would still pass, and no consumer would see an error. The defect would only show as an agent
in a long session that has quietly lost its Constitution.

## Decision (proposed)

Four parts. Parts 1 and 2 are deterministic and cheap. Part 3 is the capability proof. Part 4
is a deliberate deferral.

### 1. Plugin Brake: SessionStart must cover `compact`

Add a check to vfkb-claude-plugin's `release-gate.yml`, next to the R6 wiring Brake. Every
SessionStart hook entry that runs `hook session-start` must **fire on `source:"compact"`**,
as Claude Code itself decides that.

**The check does not try to emulate Claude Code's matcher semantics, because they are
not fully known.** Two probes on CLI 2.1.286 (brain `26887a51ef91`, which corrects
`b6060bb9705c`; kit `docs/v3/research/probes/compaction-2026-10-19/matcher-probe.sh`)
established this much. The PR #350 reviewer independently reproduced every row except
`"startup, compact"`, which only the author's run covers. `"compact"` alone was observed in
review round 2.

| Matcher | Fires on `compact`? |
|---|---|
| absent, `""`, `"*"` | yes, every source |
| `"startup\|compact"`, `"compact\|resume"`, `"compact"` | yes |
| `"startup \| compact"`, `"compact,startup"`, `"startup, compact"`, `"compact "`, `" compact"` | **yes.** `,` also separates items and whitespace around items is trimmed; the first three fire on `startup` too |
| `"startup"`, `"startup\|resume"`, `"compa"`, `"compac"`, `"Compact"`, `"comp-act"`, `"startup\|compa"` | **no.** Items are exact and case-sensitive, not substrings |
| `"omp.ct"`, `"c.mpact"`, `"^compact$"`, `"comp.*"`, `"compact\\b"`, `"[c]ompact"` | yes, as an unanchored regex search |

**What is not established is the rule for when a matcher is read as a list versus a
regex.** A naive `new RegExp(m).test("compact")` would accept `"compa"`, which drops
compaction. A naive list split would reject `"omp.ct"`. Either emulation would be guessing.

**So the Brake allowlists observed shapes and fails closed on everything else.** It
accepts a session-start entry only if one of these holds:
- its matcher is absent, `""` or `"*"`;
- its matcher is made only of `[A-Za-z0-9_|]`, and its `|`-separated items include the
  exact string `compact`.

Everything else is rejected with a message naming this rule. That includes matchers that
really do cover compact, such as `"startup, compact"` or `"c.mpact"`. **That trade gives
false reds and never false greens.** The shipped plugin has no matcher, so it costs nothing
today.

Two more conditions apply:
- **There must be at least one identified session-start entry.** If none is found, the
  Brake goes red. That way a wrapper script or an unusual command spelling that hides the
  entry fails closed instead of passing silently.
- **Gating on `source` inside the command,** for example an inline `case` or a wrapper
  script, is invisible to the Brake. That case belongs to the part 3 L4, and the
  Consequences section says so.

- **Selftest, observed red first (ADR-0070 §1).** A baseline matching the shipped
  `hooks.json` (no matcher) stays green.
  - **Red:** `"startup"`, `"startup|resume"`, `"resume"`, `"compa"`, `"Compact"`,
    `"startup|compa"`, and the session-start entry removed.
  - **Green:** absent, `""`, `"*"`, `"startup|compact"`, `"compact"`, `"compact|"`.
  - **Red under the fail-closed rule,** with a message naming it: `"c.mpact"` and
    `"startup, compact"`. The selftest includes these, so the fail-closed behaviour is
    itself observed.
- **It is a structural invariant, so it is a deterministic check (CLAUDE.md, testing
  pyramid).** It is not an LLM gate.
- **The observed shapes are pinned to a CLI version, and a Brake enforces that.** The
  plugin commits `scenarios/records/matcher-semantics.json`. It holds the matcher probe's
  **raw output** and the CLI version it ran on. The Brake re-parses that raw output rather
  than reading a summary, though it still cannot prove the probe was re-run rather than the
  version string edited by hand. That residual rests on review. The Brake fails if that `cliVersion` differs from
  the pinned CLI in `release-gate.yml`. So a CLI pin bump cannot merge without re-running the
  probe. The Brake also asserts that the record still shows its allowlisted shapes behaving
  as allowlisted. Without that, "re-run the probe on a pin bump" would be a prose rule.

### 2. Engine: the render does not depend on `source`, and a test says so

Keep the handler's behaviour, which emits the same render for every source. Then make it
deliberate:

- **A unit test** (`test/hook.test.ts` or a new `test/compaction.test.ts`). It feeds
  `hook session-start` a payload carrying `source:"compact"`, plus the same payload with
  `source:"startup"`, against a brain with a constitutional decision and a pinned handoff.
  It asserts that both outputs contain the Constitution section and the handoff pin. It also
  asserts that the compact output is not weaker than the startup output: the same pinned
  sections, in the same leading order.
- **A comment at the handler** naming this RFC/ADR, so the next person to touch it knows that
  ignoring `source` is load-bearing.
- **One known difference is harmless.** `healBrain` is latched per session id, so a
  restore note emitted at startup is not re-emitted after a compaction. The pinned sections
  are unaffected. The test compares those sections, not the whole output.
- **The session-record path needs no change.** `SessionState.load` keys on `session_id`, and
  that is unchanged across a compaction (observed). A compaction therefore updates the same
  session record and does not open a new one.

### 3. L4: `scenarios/compaction-survival.mjs`, in the plugin repo

This goes in the plugin repo because the behaviour under test is the shipped wiring, the
same reasoning that put `hooks-smoke` there. It loads the plugin through the real
marketplace path, not `--plugin-dir`.

- **Brain:** a sandbox brain with one constitutional decision and one pinned handoff, each
  carrying its own unguessable sentinel.
- **Each trial is one `--input-format stream-json` process,** run with
  **`--tools "" --strict-mcp-config`**:
  1. a startup turn;
  2. `/compact` with the omit-code-words instructions;
  3. a turn that asks for both sentinels.

  It must be **one process** because every `--resume` fires `SessionStart(resume)` and
  would re-inject between the compaction and the question. It must have **no tools and no
  MCP**, or the agent could satisfy receipt by reading the brain itself through `kb_*` or
  `Read`. Observed: with `tools: []` and `mcp_servers: []` the plugin's hooks still fire and
  re-inject, and no tool call was made (brain `c276f42c1f2f`).
- **The arms, with one variable: the bytes of `hooks.json`.**
  - **compacted:** a marketplace install of the checkout under test.
  - **contrast:** a marketplace install of a **temp copy** of that checkout, whose only
    difference is SessionStart `"matcher":"startup"`.

  Directory-source installs copy into the plugin cache, as the reviewer observed with
  `installPath …/cache/vfkb/vfkb/<version>`. So editing an installed copy in place is not
  used: whether Claude Code honours or re-syncs such an edit is unprobed. The scenario
  asserts the byte difference between the two installed `hooks.json` files before running.
- **The logging hooks must print nothing beyond `{}`.** Observed by the reviewer: the
  `PreCompact` and `PostCompact` hooks' stdout is replayed into the post-compaction
  conversation inside `<local-command-stdout>`. A logger that echoed its stdin would turn the
  observation hook into a second injection path.
- **Per-trial booleans,** each a content assertion over the output (ADR-0051 §3), all
  written to the record so the gate can recompute every verdict:
  1. `emitted`: `hook_response SessionStart:compact` carries both sentinels;
  2. `noLeak`: `PostCompact.compact_summary`, captured by a logging hook, carries
     **neither** sentinel. Matching is **normalised**: lower-cased and stripped of
     non-alphanumerics, so paraphrases such as `kumquat 8812` or split halves still count
     as a leak. A summary containing the numeric half of either sentinel is also a leak;
  3. `noToolUse`: there is no `tool_use` block after `compact_boundary`;
  4. `received`: the agent's final answer names both sentinels.
- **Validity, recomputed by the gate rather than filtered by the scenario.** A trial is
  *valid* only if `noLeak` and `noToolUse` both hold. Every attempt is recorded, invalid ones
  included, with `attempts` capped (proposed: 6 per arm).
- **Verdicts,** computed over valid trials only:
  - **compacted** is positive when `emitted ∧ received`;
  - **contrast** is positive when `received` alone. Its hits must be exactly **0**. The
    contrast uses `received` alone because reusing the full predicate would score 0 by
    construction, since `emitted` is false there, and then the contrast could never fail.
- **DEMONSTRATED** needs all of these, in a committed record
  `scenarios/records/compaction-survival.json`:
  - at least 3 valid trials per arm;
  - compacted positives ≥ `ceil(2n/3)` over **all** `n` valid trials, not the first three;
  - contrast hits = 0 over all its valid trials;
  - `attempts ≤ cap` and `attempts == trials.length`.

  **What the gate cannot see:** it can recompute everything in the record, but not an
  attempt that the scenario dropped before writing the record. "Every attempt recorded" is
  therefore a property of the scenario's code. It rests on review of that code, not on the
  gate.

**This needs a gate change, and it is part of this RFC.** Today `release-gate.mjs`'s
`verdict()` accepts a contrast with up to `floor(trials/3)` hits, and it has no notion of
validity. Part 3 therefore adds a scenario-specific rule for `compaction-survival`. That
rule recomputes validity from the per-trial booleans, requires contrast hits = 0, and
requires ≥3 valid trials per arm. The gate's selftest gains cases where each of these goes
red. The record joins `REQUIRED`, subject to Q1.

### 4. Narrowing: deferred, evidence-gated

The original R2 text wanted to re-inject only the Constitution, the pinned handoff and
cross-repo context, not the whole bundle. **This RFC does not propose that.**

- **Narrowing is a cost choice, not a correctness fix.** The full render is at most
  `SESSION_BUDGET_CHARS` (10,000 chars). It lands right after a compaction has freed far more
  than that.
- **Narrowing needs the handler to read `source`.** That is exactly the coupling part 2 makes
  deliberate, and it would turn a source-agnostic render into a source-dependent one.
- **Trigger to revisit:** a measured case where post-compaction re-injection costs a session
  something observable, such as a second compaction triggered sooner or a budget complaint.

## Consequences

- **The tidy-up becomes a red, not a silent regression.** Part 1 makes a matcher that drops
  `compact` fail CI with a message that names this RFC.
- **The guarantee becomes provable, not asserted.** Part 3 is the first L4 in either repo
  whose can-fail arm is a compaction.
- **Each release re-pins one more record.** `compaction-survival` costs about six metered
  sessions per release on the CI leg (DeepSeek) or the laptop leg.
- **Part 3 is the only defence against gating on `source` inside the command,** such as an
  inline `case` or a wrapper script under `plugin/hooks/`. Part 1 cannot see it. If Q2 picks
  conditional re-pinning, the trigger must therefore be *any* change under
  `plugin/hooks/**` or to the vendored engine, not just `hooks.json`.
- **Still unverified:** `/compact` in a stream-json process under a **marketplace**
  install. Every observation so far used `--plugin-dir`. Building part 3 probes it first.
- **Auto-compaction (`trigger:"auto"`) stays unproven.** Every observation here used
  `/compact`. The docs say `SessionStart(compact)` fires for both, but that is `[docs]` only.
  The L4 records `trigger:"manual"`, and any release note citing it must say so. Proving
  `auto` needs a session large enough to auto-compact, a separate and more expensive probe,
  and is out of scope here.
- **The PRD's R2 problem statement is superseded.** R2 becomes "guard what exists". The PRD
  R2 banner already says this; ratifying this RFC makes it binding.

## Alternatives considered

- **Re-inject from `PostCompact`, the PRD's original plan.** Rejected.
  - It would be a second injection path for something `SessionStart(compact)` already does.
  - The event order puts `PostCompact` after `SessionStart(compact)`, so it would duplicate
    the content.
  - `PostCompact` stays useful for *observing* what the summary kept, which is how part 3
    uses it.
- **Leave it alone; it works.** Rejected. Behaviour that is untested, undocumented and one
  edit away from disappearing does not meet "VERIFIED = observed". It is exactly the
  prose-rule-without-a-Brake shape this repo keeps paying for.
- **A recall-only L4.** Rejected on evidence. Its contrast arm passed in 1 of 2 observed runs,
  through the summary. A proof that cannot fail proves nothing (ADR-0029).
- **A `hook_response`-only L4.** Rejected. It proves the content was emitted, not that the
  agent received it.
- **Narrow now (part 4).** Deferred, for the reasons in part 4.

## Definition of Done

Capability level, per ADR-0050/0051:

1. **Part 1** is merged in vfkb-claude-plugin. Its selftest was observed red on every case
   listed, with output quoted in the PR.
2. **Part 2** is merged in vfkb, the unit test was observed red against a deliberately
   source-gated handler, and the engine is re-vendored into the plugin.
3. **Part 3:** the gate's new `compaction-survival` rule has been observed red on each
   failure mode. `scenarios/records/compaction-survival.json` is DEMONSTRATED under that
   rule (≥3 valid trials per arm, compacted ≥2/3, contrast 0/3, every attempt recorded),
   version-bound, and required by the release gate.
4. **Until 3 lands,** the honest status of R2 is *"built, NOT yet verified"*, whatever parts 1
   and 2 say.

## Open questions for the operator

- **Q1.** Should part 3's record be **required** from the release that ships parts 1 and 2,
  or **phased**, meaning it is required only once a first DEMONSTRATED record exists? This is
  the same choice ADR-0067 made with its provenance flag.
- **Q2.** Is about six extra metered sessions per release acceptable, or should
  `compaction-survival` re-pin only when `hooks.json` or the session-start render changes?
  The second option would need a new gate rule, and it trades cost against "every release is
  proven".
