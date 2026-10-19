---
type: Decision
title: "ADR-0077: The compaction re-injection is a guarantee, not an accident"
description: "Accepts RFC-042 (v3 theme R2). The shipped plugin re-injects the Constitution, the pinned handoff and the bundle after a compaction only because its SessionStart hook has no matcher and the engine ignores `source`. This ADR makes that a guarantee: a fail-closed matcher Brake in the plugin repo, an engine unit test that the pinned sections do not depend on `source`, and the compaction-survival L4. The L4 record is phased in: it becomes required only once a first DEMONSTRATED record exists. After that it is re-pinned on every release. Narrowing the re-injected payload is deferred."
status: "Accepted"
timestamp: 2026-10-19
---

# ADR-0077: The compaction re-injection is a guarantee, not an accident

- **Status:** Accepted (2026-10-19, operator ratification). Brain decision `b11eab62644c`.
- **Build status:** nothing is built at acceptance. Once clauses 1 and 2 land, the status
  is *built, NOT yet verified* until clause 3's record is DEMONSTRATED. Progress is tracked
  in the v3 PRD §6 R2, not here.
- **Date:** 2026-10-19
- **Accepts:** [RFC-042](../rfc/RFC-042-compaction-survival-guard.md), as written at `9306f18`.
  The RFC holds the evidence, the matcher table, the full L4 specification and the
  alternatives. This ADR records the decision and the operator's answers to its two open
  questions.
- **Relates:**
  - [ADR-0008](ADR-0008-constitution-tier.md) and
    [ADR-0049](ADR-0049-session-start-handoff-pinning.md): the two guarantees this extends
    past a compaction.
  - [ADR-0045](ADR-0045-vfkb-claude-code-plugin.md) and
    [ADR-0048](ADR-0048-retire-wiring-smoke-gate.md): wiring belongs to the plugin repo.
  - [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md) and
    [ADR-0051](ADR-0051-delivery-honesty.md): the DoD and the content assertion rule.
  - [ADR-0067](ADR-0067-hybrid-credential-model.md) D5: the phasing precedent.
  - [ADR-0070](ADR-0070-guards-that-can-fail.md): guards must be seen red.

## Context

The v3 harness probe on 2026-10-19 (survey §7b; brain `1b10486b07c6`) found two things.

**What Claude Code does on compaction.** It fires `PreCompact`, then `SessionStart` with
`source:"compact"`, then `PostCompact`, and the SessionStart injection reaches the
post-compaction context.

**What the shipped plugin does.** It re-injects its full resume render there, but only
because its SessionStart hook has no matcher and the `hook session-start` handler never reads
`source`. Nothing tests it, and a tidy matcher such as `"startup|resume"` would silently end
the Constitution's and the pinned handoff's coverage after a compaction.

**Without re-injection, survival is up to the summariser.** In the startup-only arms run
without summary instructions, the sentinel was lost in 4 of 5 runs: 3 of 3 synthetic and
1 of 2 with the real plugin. That includes one run where the summary contained the sentinel
and the agent still did not use it.

## Decision

1. **Plugin Brake (RFC-042 part 1).** vfkb-claude-plugin's `release-gate.yml` gains a
   deterministic check on every session-start SessionStart entry. Each must have one of:
   - a matcher that is absent, `""` or `"*"`;
   - a matcher made only of `[A-Za-z0-9_|]` whose `|`-items include the exact string
     `compact`.

   **Everything else fails closed,** because Claude Code's matcher semantics are only
   partly known: false reds are accepted and false greens are not. At least one
   session-start entry must be identified. The observed matcher shapes are pinned to the
   CLI version through a committed `matcher-semantics.json` holding raw probe output, which
   the Brake re-parses. **The Brake fails when that record's `cliVersion` differs from the CLI
   pinned in `release-gate.yml`.** Its selftest must be observed red on every red case
   RFC-042 lists, and green on every green one.

2. **Engine test (RFC-042 part 2).** A unit test asserts that `hook session-start` emits the
   same pinned sections, the Constitution and the handoff pin in the same leading order, for
   `source:"compact"` as for `source:"startup"`. A comment at the handler names this ADR,
   making the fact that it ignores `source` load-bearing. The test must be observed red
   against a deliberately source-gated handler.

3. **L4 (RFC-042 part 3).** `scenarios/compaction-survival.mjs` lives in the plugin repo and
   runs as specified in RFC-042:
   - a real marketplace install;
   - one stream-json process per trial, with `--tools "" --strict-mcp-config`;
   - `/compact` with omit-code-words instructions;
   - per-trial `emitted`, `noLeak`, `noToolUse` and `received`, with validity recomputed by
     the gate;
   - a contrast arm scored on `received` only, which must have 0 hits;
   - a scenario-specific `release-gate.mjs` rule with selftest reds.

4. **Narrowing is deferred.** The full resume render keeps being re-injected. Revisit only on
   a measured cost.

### The operator's answers to RFC-042's open questions

- **Q1 — PHASED.** The `compaction-survival` record is **not** in `REQUIRED` when clauses 1
  and 2 ship. It joins `REQUIRED` in the same PR that commits the first DEMONSTRATED record.
  From then on, a release without a valid, version-bound record is red. This follows the
  ADR-0067 D5 precedent. It lets the two cheap deterministic guards ship without waiting on
  the metered L4. Until the record lands, R2's status is *built, NOT yet verified*.
  **The same-PR rule is enforced, not prose.** The gate goes red if a committed
  `compaction-survival` record is DEMONSTRATED but the scenario is not in `REQUIRED`. Like
  every gate rule here, it must be seen red in the gate's selftest: a fixture with a
  DEMONSTRATED record and the scenario left out of `REQUIRED`.
- **Q2 — EVERY RELEASE.** Once required, the record is re-pinned on every release. That
  costs at least six metered sessions (3 valid trials × 2 arms) and up to twelve at the
  attempts cap, on the CI or laptop leg. **No conditional re-pin rule is added.** Such
  a rule would need its own trigger (any `plugin/hooks/**` or engine change), and that
  trigger would itself need guarding.

## Consequences

- **A matcher that drops `compact` becomes a CI red** that names this ADR. Until now it was a
  silent loss.
- **R2's capability becomes provable,** and the proof can fail.
- **Releases cost 6–12 more metered sessions** once the record is required.
- **Phasing has no forcing event for the first record.** Nothing makes the first
  DEMONSTRATED record get produced. ADR-0067 D5 tied its phase to its own deliverable;
  this ADR does not. If clause 3 stalls, for example because `/compact` turns out not to
  work under a marketplace install, the record stays optional indefinitely.
  ADR-0051 still holds R2 at *built, NOT yet verified* for that whole time, and the R2
  status in the PRD and the handoff are where that shows. This is an accepted risk of the
  operator's Q1 ruling, named so that it decays visibly rather than silently.
- **Auto-compaction (`trigger:"auto"`) remains `[docs]`-only.** Every observation used
  `/compact`. Release notes citing the record must say "manual compaction".
- **`/compact` in stream-json under a marketplace install has not yet been observed.**
  Building clause 3 probes it first. If it does not work, clause 3 needs a different trial
  shape, and that change comes back as an amendment, not a silent edit.
- **Gating on `source` inside the command** (an inline `case` or a wrapper script) is
  invisible to clause 1. Only clause 3 catches it. Phasing therefore leaves a window in which
  that particular regression is unguarded. The window is named here so it is a choice, not a
  surprise.
