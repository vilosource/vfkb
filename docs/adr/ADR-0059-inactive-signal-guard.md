---
type: Decision
title: "ADR-0059: Restore the 'vfkb INACTIVE' signal under plugin wiring — a deterministic, engine-free repo-side guard (accepts RFC-032)"
description: "The ADR-0045 plugin migration removed the bootstrap's actionable INACTIVE banner; the plugin cannot warn when it is not running, so a session in a plugin-wired repo silently loses continuity, gating, and capture. Decision: ship a committed, engine-free SessionStart guard that compares the project's enabledPlugins declaration against ~/.claude/plugins/installed_plugins.json fulfillment and banners on a miss (fail-open), plus a prose tripwire and an upstream ask. Proven by a named agent-driven L4 with a can-fail arm."
status: "Accepted"
timestamp: 2026-07-13
---

# ADR-0059: Restore the "vfkb INACTIVE" signal under plugin wiring

- **Status:** Accepted (2026-07-13, maintainer ratification)
- **Date:** 2026-07-13
- **RFC:** [RFC-032](../rfc/RFC-032-inactive-signal-under-plugin-wiring.md) (accepted 2026-07-13;
  the full candidate-direction analysis, the known limitation, and rejected alternatives live
  there)
- **Relates:** [ADR-0045](ADR-0045-claude-code-plugin.md) (the migration that removed the
  bootstrap banner — the regression this repairs); gotcha `fde3f0e52e61` (PR #75 review finding
  that first named the gap); vfkb-claude-plugin#4 (the tracked issue);
  [ADR-0048](ADR-0048-retire-wiring-smoke-gate.md) (its hooks-smoke successor proves the wiring
  *works when loaded* — this ADR is the complementary "notice when it is *not* loaded");
  [RFC-024](../rfc/RFC-024-staleness-detection-and-delivery-honesty.md) §1 (declared-vs-actual
  drift, the same detection shape); [ADR-0022](ADR-0022-l4-purpose-evaluation.md) /
  [ADR-0029](ADR-0029-dod-e2e-purpose-proof.md) (the proof discipline).

## Context

Before ADR-0045 every consumer committed its own wiring, and `bootstrap.mjs` emitted a loud
`vfkb INACTIVE — set VFKB_BUNDLE_DIR` banner when the engine was unresolvable. Under the plugin
the wiring lives *inside* the plugin — which is not running when it is absent — so an
uninstalled / never-fulfilled / unapproved plugin means a session runs with no continuity
injection, no brain-write gate, no capture, and **no banner**. Silent degradation of exactly the
class ADR-0051 names. Observed 2026-07-13: 8 repos declare the plugin in project
`.claude/settings.json`, but `~/.claude/plugins/installed_plugins.json` records a fulfilled
`vfkb@vfkb` for only one `projectPath` — declaration and fulfillment live in different places,
and only their combination means "the next session actually runs vfkb."

## Decision

1. **Ship a committed, engine-free repo-side guard** (`.claude/vfkb-guard.mjs`, Node stdlib only —
   it must not depend on the engine whose absence it detects), wired as a `SessionStart` hook in
   the same project `.claude/settings.json` that declares the plugin. It reads the project's
   `enabledPlugins` declaration and cross-checks `~/.claude/plugins/installed_plugins.json` for a
   `vfkb@vfkb` fulfillment (user scope, or project scope whose `projectPath` matches this repo);
   on a miss it prints a `vfkb INACTIVE` banner with the remedy and exits 0. **It fails open on any
   read/parse error** — a broken guard must never block a session.
2. **A prose tripwire** rides in the shipped `vfkb:how-we-track-work` section: if the `kb_*` MCP
   tools are absent, the agent says so and stops. Layer 2, not the mechanism.
3. **File an upstream feature request** (Claude Code: surface enabled-but-unloaded project
   plugins at session start). If it ships, the guard retires the way the bootstrap banner did.
4. **Accepted trade-off:** this reintroduces a small, static, engine-free repo-side wiring
   footprint that ADR-0045 had removed — the one job that cannot be delegated to the thing that
   might be missing. It reads Claude Code's undocumented `installed_plugins.json`; the guard fails
   open and its L4 re-pins on plugin releases, bounding a format drift to "the banner goes quiet,"
   never "sessions break."

**Known limitation (carried from RFC-032, not hidden):** the installed-but-*unapproved* state may
be invisible to the guard (approval state lives outside `installed_plugins.json`; headless `-p`
runs executed hooks with no approval step, so approval semantics differ by session type). The
guard decisively covers uninstalled / never-fulfilled / wrong-project — the modes actually
observed. Approval-state detection is a build-time investigation item; if undetectable, the banner
text says so.

## Proof (Definition of Done — ADR-0023/0029)

`scenarios/inactive-signal.mjs` in vfkb-claude-plugin, reusing the hooks-smoke sandbox harness
(sandboxed HOME, real `claude -p`): **positive arm** — sandbox with the guard + declaration, plugin
*not* installed → a turn observes the `vfkb INACTIVE` banner (content assertion on its unguessable
phrasing); **contrast arm** — identical sandbox, plugin installed → banner absent AND vfkb live
(sentinel resume-injection observed). DEMONSTRATED ≥2/3 (ADR-0022), record committed and registered
in the plugin release gate's `REQUIRED`. The guard sweeps into the machine's consumer repos only
after the L4 is green.
