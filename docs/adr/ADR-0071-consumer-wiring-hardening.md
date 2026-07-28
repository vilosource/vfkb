---
type: Decision
title: "ADR-0071: Consumer wiring hardens against vfkb's own drift — generic process hooks move into the plugin, consumer settings.json is sourced from a dedicated template, and the bootstrap skill is versioned"
description: "Found 2026-07-28: the vfkb-new-project skill and docs/CONSUMER-ONBOARDING.md both instruct copying vfkb's own .claude/settings.json byte-for-byte into a new consumer repo. That file has since grown two PreToolUse hooks (git-compound-guard, durable-claim-check) that are vfkb-repo-local dogfooding scripts with no vfkb-specific logic — copying them into a consumer breaks every Bash/Write/Edit call in that repo from session one. Decides: both hooks move into vfkb-claude-plugin as bundled hooks (vfkb-claude-plugin#50); consumer settings.json is assembled from a small, version-controlled, Brake-tested template (docs/templates/consumer-settings.json) instead of vfkb's own dogfooded file; and the vfkb-new-project skill is moved under version control in this repo, symlinked into ~/.claude/commands, so it can no longer drift silently from the wiring it depends on."
status: "Accepted"
timestamp: 2026-07-28
---

# ADR-0071: Consumer wiring hardens against vfkb's own drift

- **Status:** Accepted
- **Date:** 2026-07-28
- **Relates:** [ADR-0045](ADR-0045-vfkb-claude-code-plugin.md) (the plugin is the canonical consumer
  mechanism this hardens); [ADR-0059](ADR-0059-inactive-signal-guard.md) (the one hook that stays a
  committed consumer file, unchanged by this decision); [ADR-0070](ADR-0070-guards-that-can-fail.md)
  (the guard whose own settings.json entry is what exposed this)
- **Evidence:** the operator asked to bootstrap a new project via the `vfkb-new-project` skill
  (`~/.claude/commands/vfkb-new-project.md`, last touched 2026-07-14) and asked first whether the
  skill had been kept in sync with vfkb development. It had not. `docs/CONSUMER-ONBOARDING.md` and
  the skill both instruct: fetch `.claude/settings.json` from vfkb `main` and commit it verbatim.
  vfkb's own `.claude/settings.json` on `main` has since grown two `PreToolUse` hooks —
  `scripts/hook-git-compound-guard.mjs` (2026-07-26, ADR-0070 §5) and
  `scripts/hook-durable-claim-check.mjs` (2026-07-18, issue #213) — that reference scripts which
  exist only in vfkb's own repo. Read directly: neither hook contains vfkb-specific logic;
  `git-compound-guard.mjs` is 100% generic, `durable-claim-check.mjs` is generic apart from path
  conventions (`docs/adr|rfc/`, `reviews/`, `CLAUDE.md`) already shared ViloForge-wide. A fresh
  consumer copying vfkb's `settings.json` verbatim would get `PreToolUse` hooks pointing at
  nonexistent files — erroring on its first `Bash`/`Write`/`Edit` call.

## Decision

1. **Generic process hooks move into vfkb-claude-plugin, not hand-copied by consumers.**
   `git-compound-guard.mjs` and `durable-claim-check.mjs` ship as `plugin/hooks/*.mjs`, wired into
   the plugin's own `hooks.json` (vfkb-claude-plugin#50, v0.14.0) — every consumer gets them via
   the normal plugin install/update path, the same way the plugin already delivers the resume
   hook, the `.vfkb/` write gate, the Stop reminder, and the SessionEnd auto-commit. This is not a
   new pattern; it is applying the plugin's own existing pattern to two hooks that had been left
   outside it only because they were authored inside vfkb's own dogfooding loop.
2. **`vfkb-guard.mjs` is the one exception, and stays exactly as it is.** Per ADR-0059, its entire
   job is detecting that the plugin *did not load* — a guard shipped by the plugin cannot run in
   exactly the case it exists to catch. It remains a committed consumer file, fetched from
   `templates/vfkb-guard.mjs` in vfkb-claude-plugin (unchanged by this ADR).
3. **Consumer `settings.json` is assembled from a dedicated, minimal template — never raw-copied
   from vfkb's own file again.** `docs/templates/consumer-settings.json` in this repo contains only
   the three consumer-relevant keys (`extraKnownMarketplaces.vfkb`, `enabledPlugins["vfkb@vfkb"]`,
   the `SessionStart` guard hook). A unit test (`test/consumer-settings-template.test.ts`) asserts
   it never grows a hook command referencing a `scripts/` path — the specific shape of this defect
   — so vfkb's own settings.json can keep evolving for vfkb's own dogfooding needs without silently
   becoming the thing new consumers copy.
4. **The `vfkb-new-project` skill is brought under version control.** It now lives at
   `.claude/commands/vfkb-new-project.md` in this repo, with `~/.claude/commands/vfkb-new-project.md`
   a symlink to it. A change to the consumer-wiring shape and the skill that assembles it now land
   in the same repo, reviewable together, instead of one being a dotfile invisible to the other.

## Consequences

- The bug this ADR fixes (skill/doc instructing a raw copy of an evolving dogfooded file) cannot
  recur in the same shape: the template is the only thing either the skill or
  `CONSUMER-ONBOARDING.md` point at, and it is Brake-tested to stay minimal.
- vfkb's own `.claude/settings.json` is unchanged by this ADR — it keeps its local
  `scripts/hook-git-compound-guard.mjs` / `scripts/hook-durable-claim-check.mjs` wiring for this
  repo's own dogfooding. Once vfkb-claude-plugin#50 ships and this repo's plugin install picks up
  the new version, the two local hook entries become redundant with the plugin-delivered ones;
  removing them is deliberately **not done in this PR** (this repo is the source both hooks were
  authored in, and de-duplicating live guard coverage on the same PR that relocates it is
  unnecessary risk to this repo's own tooling) — filed as a fast-follow.
- Not decided here, filed as [vfkb-claude-plugin#51](https://github.com/vilosource/vfkb-claude-plugin/issues/51)
  instead: a live-turn L4 observable proving `git-compound-guard`/`durable-claim-check` fire through
  the real installed-plugin path (today's proof is the deterministic branch tests, ported from this
  repo's own selftests, plus the packaging/JSON-parse checks — matching the bar this repo's own
  `durable-claim-check` has always had, which never had a live-turn proof either).
