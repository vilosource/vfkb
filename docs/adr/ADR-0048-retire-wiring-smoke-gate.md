---
type: Decision
title: "ADR-0048: Retire the in-repo wiring smoke gate (supersedes ADR-0028)"
description: "scenarios/wiring-smoke.mjs is retired — its premise (validate this repo's candidate settings.json before promotion) ended with the ADR-0045 plugin migration; host-level plugin-wiring validation is deferred to the plugin repo (tracked), not silently dropped"
status: "Accepted"
timestamp: 2026-07-08
---

# ADR-0048: Retire the in-repo wiring smoke gate (supersedes ADR-0028)

- **Status:** Accepted
- **Date:** 2026-07-08
- **Supersedes:** [ADR-0028](ADR-0028-sandbox-validate-auto-layer-wiring.md) (the in-repo gate
  mandate; see "What survives" below for the principle's disposition)
- **Relates:** [ADR-0045](ADR-0045-vfkb-claude-code-plugin.md) (the plugin migration that ended
  the gate's premise), [ADR-0027](ADR-0027-stop-hook-decision-capture-reminder.md) (the Stop
  wiring the gate originally validated), issue
  [vfkb#82](https://github.com/vilosource/vfkb/issues/82) (the staleness finding),
  [vfkb-claude-plugin#6](https://github.com/vilosource/vfkb-claude-plugin/issues/6) (the
  relocated check — see that issue for its state; it has since been closed)

## Context

ADR-0028 mandated a repeatable smoke gate (`scenarios/wiring-smoke.mjs`) that drove real
`claude` turns against the **candidate `.claude/settings.json`** in a throwaway sandbox before
promoting hook-wiring changes to this repo's live config. Its premise ended with the ADR-0045
plugin migration (PR #75): the live `.claude/settings.json` now contains plugin marketplace
config and **no hooks at all** — the wiring lives in vfkb-claude-plugin's `hooks.json`. Found
during the PR #79 review (issue #82): `candidateSettings()` now merges a synthetic Stop hook
into plugin config, producing something that is neither the live wiring nor anything we would
promote, and a sandbox run would carry `enabledPlugins` into an unapproved throwaway session.

The gate also validates nothing else this repo still ships: it reads the *live settings file*,
not the `vfkb init` fallback emission — so post-migration it has **no unique live coverage
left**. (What related coverage exists elsewhere, stated precisely: `consumer-onboarding` L4
exercises the init fallback's **SessionStart** grounding end-to-end; `decision-capture` L4
proves Stop-hook **capture behavior** against its own synthetic settings. Neither host-validates
a candidate settings file — that was this gate's unique job, and that job no longer exists
here.)

## Decision

1. **Retire the gate:** delete `scenarios/wiring-smoke.mjs`. A gate that can only validate a
   configuration nobody runs is worse than no gate — it misleads on green and blocks on red for
   the wrong reasons.
2. **Sweep the operational references** so no live document instructs running the deleted file:
   `docs/RUNBOOK-claude-code-integration.md` §8 (the promotion instruction), RFC-009 item 6 and
   the H4 roadmap D7-wire entry (historical ✅ markers gain a retirement note; decided bodies
   are otherwise untouched).
3. **Re-home the principle — honestly labeled as deferred, not done:** the ADR-0028 principle
   (wiring is sandbox-validated by real `claude` turns before it goes live) now correctly
   belongs where the live wiring lives: vfkb-claude-plugin's release flow. **That check does
   not exist yet.** The v0.2.0 vendored-copy verification was a one-off manual step, not a
   repeatable release gate. It is tracked as
   [vfkb-claude-plugin#6](https://github.com/vilosource/vfkb-claude-plugin/issues/6); until it
   lands, host-level validation of the plugin's `hooks.json` is an acknowledged gap. This ADR
   retires a stale gate; it does not claim the replacement is built.

## Why supersede, not amend

ADR-0028's operative decision **is the in-repo gate** — "validate the candidate settings.json
in a sandbox before promoting it live in this repo." That mandate is withdrawn entirely: there
is no candidate settings.json to promote here anymore, and no in-repo gate remains. Per the
ADR-0001 lifecycle rules, *amend* is for a decision that still holds with changed scope or
evidence; *supersede* is for replacement. Since the relocated check is deferred (tracked, not
built), claiming the original "still holds, relocated" would overstate — supersession is the
honest label. The underlying *principle* survives as this ADR's §Decision-3 commitment.

## Consequences

- `scenarios/wiring-smoke.mjs` is gone; ADR-0028's status gains the one-line
  `Superseded by ADR-0048` pointer (the only permitted edit to a decided ADR).
- Until vfkb-claude-plugin#6 lands, plugin `hooks.json` changes reach consumers with unit-level
  and manual verification only — a known, tracked gap, no longer masked by a green-but-
  meaningless gate here.
- Repos on the `vfkb init` fallback keep their existing coverage (init emission unit tests +
  the `consumer-onboarding` L4's SessionStart grounding); if fallback hook wiring ever needs
  host-level candidate validation again, that is a new, deliberate decision — not a revival of
  this gate by default.
