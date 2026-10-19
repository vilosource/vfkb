---
type: RFC
title: "RFC-042: The compaction re-injection exists by accident — make it a guarantee"
description: "v3 theme R2. The 2026-10-19 probe found that the shipped plugin already re-injects the Constitution, the pinned handoff and the knowledge bundle after a compaction. SessionStart fires again with source:\"compact\", the plugin's SessionStart hook has no matcher, and the engine never reads `source`. Nobody designed that, nothing tests it, and a tidy-looking matcher edit would silently delete it. This RFC proposes the guard: a deterministic Brake on the matcher, an engine unit test on the compact-source render, and an L4 that can actually fail, because /compact custom instructions close the summary-luck channel. Narrowing the re-injected payload is deferred until there is evidence it costs anything."
status: "Proposed"
timestamp: 2026-10-19
---

# RFC-042: The compaction re-injection exists by accident — make it a guarantee

- **Status:** Proposed
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
  - brain `b6060bb9705c` (the matcher semantics);
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

**The check must emulate Claude Code's matcher semantics, and those are not "a regex".**
They were probed on CLI 2.1.286 (brain `b6060bb9705c`, kit
`docs/v3/research/probes/compaction-2026-10-19/matcher-probe.sh`):

| Matcher | Fires on `compact`? | Mode |
|---|---|---|
| absent, `""`, `"*"` | yes | match-all |
| `"startup"`, `"startup\|resume"`, `"compa"`, `"Compact"` | **no** | **exact, case-sensitive, `\|`-separated list**, used when the matcher is only word characters and `\|` |
| `"startup\|compact"`, `"compact\|resume"` | yes | exact list |
| `"omp.ct"`, `"c.mpact"`, `"^compact$"`, `"comp.*"` | yes | **unanchored regex search**, used for anything else |

A naive `new RegExp(m).test("compact")` gets this wrong: it would accept `"compa"`, a matcher
that silently drops compaction. The Brake implements both modes.

The exact boundary of "word characters", for example whether `-` keeps a matcher in exact
mode, was **not** probed. Until it is, the Brake accepts only three kinds of matcher:
- one that is absent, `""` or `"*"`;
- an exact-mode matcher, made of `[A-Za-z0-9_|]` only, whose `|`-list contains `compact`.

**Anything else is rejected, even a regex that does match `compact`.** It fails closed on
the unprobed region, with a message saying so. The shipped plugin has no matcher, so this
costs nothing today.

- **Selftest, observed red first (ADR-0070 §1).** A baseline matching the shipped
  `hooks.json` (no matcher) stays green.
  - **Red:** `"startup"`, `"startup|resume"`, `"resume"`, `"compa"`, `"Compact"`, and the
    session-start entry removed.
  - **Green:** absent, `""`, `"*"`, `"startup|compact"`, `"compact"`.
  - Regex-mode matchers such as `"c.mpact"` go red under the fail-closed rule, and the
    message must name the rule. That case is in the selftest too, so the fail-closed
    behaviour is itself observed.
- **It is a structural invariant, so it is a deterministic check (CLAUDE.md, testing
  pyramid).** It is not an LLM gate.
- **The semantics table is pinned to a CLI version.** The Brake pins the CLI already
  (R6 pins 2.1.286). A pin bump re-runs the matcher probe kit before the bump merges, so a
  semantics change shows up as a red rather than as a silently wrong emulation.

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
- **The session-record path needs no change.** `SessionState.load` keys on `session_id`, and
  that is unchanged across a compaction (observed). A compaction therefore updates the same
  session record and does not open a new one.

### 3. L4: `scenarios/compaction-survival.mjs`, in the plugin repo

This goes in the plugin repo because the behaviour under test is the shipped wiring, the
same reasoning that put `hooks-smoke` there. It loads the plugin through the real
marketplace path, as `hooks-smoke` does, not `--plugin-dir`.

- **Brain:** a sandbox brain with one constitutional decision and one pinned handoff, each
  carrying its own unguessable sentinel.
- **Each trial is one `--input-format stream-json` process:**
  1. a startup turn;
  2. `/compact` with the omit-code-words instructions;
  3. a turn that asks for both sentinels.

  It must be a single process, because every `--resume` fires `SessionStart(resume)` and
  would re-inject between the compaction and the question.
- **The arms:**
  - **compacted:** the plugin as shipped;
  - **contrast:** the identical sandbox, but with `hooks.json`'s SessionStart matched to
    `startup`. Applied to an installed copy, this is the single variable.
- **Predicate:** a content assertion over the output (ADR-0051 §3). A trial is **positive**
  only if all three of these hold:
  1. *emission:* the stream's `hook_response SessionStart:compact` carries both sentinels;
  2. *no-leak:* `PostCompact.compact_summary`, captured by a logging hook, carries
     **neither** sentinel;
  3. *receipt:* the agent's final answer names both.

  A trial whose summary leaked is scored **invalid**, not positive. A run that cannot produce
  three valid trials in the attempt budget is a red, not a pass.
- **Contrast arm:** must be 0/3 on receipt, with summaries that did not leak.
- **DEMONSTRATED:** ≥2/3 compacted arm and 0/3 contrast, per ADR-0022, in a committed record
  `scenarios/records/compaction-survival.json`. It joins the gate's `REQUIRED` list, so every
  release re-pins it.

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
3. **Part 3:** `scenarios/records/compaction-survival.json` is DEMONSTRATED (compacted ≥2/3
   valid trials, contrast 0/3), version-bound, and required by the release gate.
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
