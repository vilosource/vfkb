---
type: Decision
title: "ADR-0072: The INACTIVE guard resolves the SESSION's config dir, not ~/.claude (amends ADR-0059)"
description: "ADR-0059 specifies the guard cross-checks ~/.claude/plugins/installed_plugins.json. Claude Code relocates its entire config dir via $CLAUDE_CONFIG_DIR, so under a wrapper launcher the guard read a registry the session was not using and bannered INACTIVE for a genuinely installed plugin — crying wolf over the healthy state it exists to distinguish. Decision: resolve $CLAUDE_CONFIG_DIR, else ~/.claude. Records that the fix is NOT yet at the delivery surface and that ADR-0059's L4 is structurally blind to this class."
status: "Accepted"
timestamp: 2026-09-13
---

# ADR-0072: The INACTIVE guard resolves the SESSION's config dir, not `~/.claude`

- **Status:** Accepted (2026-09-13, maintainer ratification)
- **Date:** 2026-09-13
- **Amends:** [ADR-0059](ADR-0059-inactive-signal-guard.md) — narrows Decision §1's
  `~/.claude/plugins/installed_plugins.json` to `<config-dir>/plugins/installed_plugins.json`.
  ADR-0059's body is **not edited** ([ADR-0001](ADR-0001-record-decisions-as-adrs.md)); only its
  status-pointer line records the amendment. The mechanism ADR-0059 decided — compare the
  project's `enabledPlugins` DECLARATION against Claude Code's FULFILLMENT registry, fail open,
  banner on a miss — is unchanged. Only the path used to LOCATE that registry changes.
- **Relates:** [ADR-0045](ADR-0045-vfkb-claude-code-plugin.md) (plugin wiring),
  [ADR-0070](ADR-0070-guards-that-can-fail.md) (the proof discipline this was caught by),
  [ADR-0071](ADR-0071-consumer-wiring-hardening.md) (the consumer wiring surface);
  brain decision `0305224042fe` (the same deviation, recorded at fix time);
  gotcha `cedbbfe22325`; vfkb#279 (the fix), vfkb#280 (the gate gap it exposed).

## Context

Claude Code relocates its **entire** config directory via `$CLAUDE_CONFIG_DIR` — `plugins/`
included. Every wrapper launcher on the maintainer's machine does exactly that; verified by
reading them, each carrying `export CLAUDE_CONFIG_DIR=…` on line 9:

| launcher | config dir |
|---|---|
| `cldp` | `~/.claude-cldp` |
| `cldw` | `~/.claude-cldw` |
| `cldo` | `~/.claude-oneio` |

ADR-0059 §1 specifies the literal `~/.claude/plugins/installed_plugins.json`, and the shipped
guard read exactly that. Under any of these launchers it therefore inspected a registry the
session was **not** using. A plugin installed, enabled and live read as absent, and the guard
bannered `vfkb INACTIVE` — then told the operator to run an install that had already succeeded.

This is worse than a missing signal. The guard's whole purpose is to distinguish "vfkb is not
running" from "vfkb is running"; here it **cried wolf over the healthy state**, and under a
wrapper launcher the banner was unsilenceable. A smoke alarm with no off switch gets removed.

Observed 2026-09-11: `claude plugin install vfkb@vfkb` succeeded (user scope, v0.18.0, recorded
in `~/.claude-cldp/plugins/installed_plugins.json`) and the banner kept firing.

The lesson was already in this codebase. `src/doctor.ts`'s `claudeConfigDir()` carries it with the
rationale attached — *"Claude Code relocates its ENTIRE config dir via CLAUDE_CONFIG_DIR,
`plugins/` included … observed 2026-07-09"*. The guard, written four months later, did not apply
it. This is a missed application of a known lesson, not a new discovery.

## Decision

1. **Resolve the session's config dir**: `$CLAUDE_CONFIG_DIR` when set, else `~/.claude`. Same
   semantics as `src/doctor.ts:88`, deliberately, so the two cannot drift again.
2. **ADR-0059 is otherwise unchanged.** Engine-free (Node stdlib only), fail-open on every path,
   the banner contract byte-identical, and the known limitation (installed-but-*unapproved* may be
   invisible) still stands.
3. **Record, do not edit.** ADR-0059's decided body keeps its original text per ADR-0001. This ADR
   is the record of the deviation; ADR-0059 gains only a status-pointer line.

## Consequences

**Positive.** The guard now answers for the session that is actually running. Wrapper-launched
sessions — the maintainer's default — get a truthful signal instead of a permanent false alarm.

**The fix is NOT yet at the delivery surface.** Verified 2026-09-13 against the marketplace clone
at plugin v0.18.0 (`7bd534d`): `vilosource/vfkb-claude-plugin` ships **two** copies of the guard,
`templates/vfkb-guard.mjs` (what a newly onboarded consumer receives) and `.claude/vfkb-guard.mjs`
(the plugin repo's own dogfooded copy). Both are **byte-identical to vfkb's pre-fix guard**
(md5 `aeeca64fc5b50006f8a5a6d5c1f27c92`) and both still read `~/.claude` unconditionally.

So the fix reaches only consumers who fetch the guard from this repo's `main`, the path
`docs/CONSUMER-ONBOARDING.md:61` prescribes. **Consumers onboarded through the plugin's own
template still receive the defective guard.** This is a delivery gap of exactly the shape
ADR-0051 §2 says must be stated rather than left silent — so it is stated here, and tracked
cross-repo, rather than implied fixed by this ADR's existence.

**ADR-0059's L4 cannot detect this class.** `scenarios/inactive-signal.mjs` varies only `HOME`
(`env: authEnv({ ...process.env, HOME: home })`) and never sets or clears `CLAUDE_CONFIG_DIR`.
Two consequences, both verified by reading `scenarios/auth.mjs:72-82`:
- In deepseek mode `authEnv` strips every `/^(ANTHROPIC|CLAUDE)/i` key, so `CLAUDE_CONFIG_DIR` is
  removed and the guard falls back to the sandbox `HOME`. The scenario passes **either way** —
  pre-fix and post-fix guards are indistinguishable to it. It was never a can-fail arm for this.
- In **oauth mode** `authEnv` returns `baseEnv` unchanged, so an ambient `CLAUDE_CONFIG_DIR`
  **survives into the sandbox**. Run from a wrapper session, the post-fix guard then reads the
  real machine registry instead of the sandbox `HOME`, and the absent arm — which expects a
  banner — would see the really-installed plugin and stay silent. *(Reasoned from the code, not
  executed: running the L4 needs the plugin repo's harness. Marked **UNVERIFIED** as a live
  result; the env-handling asymmetry it rests on is verified.)*

The plugin's deterministic inner gate does not close the gap either: `scenarios/guard-branches.test.mjs`
contains **zero** occurrences of `CLAUDE_CONFIG_DIR` (verified by grep), despite covering the
guard's other structural branches including symlinks.

**Follow-ups this ADR deliberately does not perform** (cross-repo, and a release surface):
1. Port the fix to both `vilosource/vfkb-claude-plugin` guard copies.
2. Pin `CLAUDE_CONFIG_DIR` explicitly in `scenarios/inactive-signal.mjs` (to the sandbox, or
   deleted) so the harness stops inheriting the host's, in oauth mode especially.
3. Add `CLAUDE_CONFIG_DIR` branches to `scenarios/guard-branches.test.mjs` — the deterministic
   backstop, per this repo's standing preference for a Brake over a probabilistic gate.

**Negative / accepted.** Reading an undocumented Claude Code env var alongside an undocumented
registry file widens the surface a Claude Code change could move. Bounded the same way ADR-0059
bounds it: the guard fails open, so drift degrades to "the banner goes quiet," never "sessions
break."

## Proof

Defect fix to an existing capability, so it rides the deterministic inner gate rather than a new
L4 (ADR-0029's sub-task exemption; the ADR-0052 review of #279 concurred over two rounds).

- **Observed against real live state, not asserted.** With `vfkb@vfkb` installed at user scope
  under `~/.claude-cldp`: the pre-fix guard prints the banner; the post-fix guard is silent.
- **The Brake can fail.** `test/vfkb-guard.test.ts` (8 tests) executes the real guard as a
  subprocess against synthetic config dirs — the same entry point production uses — including the
  can-fail arm (declared but installed nowhere still banners). Every guard has an observed-red
  mutation, re-run independently by the reviewer (record
  `reviews/1ff2f499b2007759068b6dae095b10204fb06917.json`).
- **Honest gap:** that Brake lives in **this** repo. Until follow-up 3 lands, the plugin's shipped
  copies have no equivalent coverage.
