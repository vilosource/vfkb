---
type: Decision
title: "ADR-0060: Tag every plugin release `vfkb--v{version}` — durable version refs (unblocks the install-path delivery L4)"
description: "The vfkb-claude-plugin repo had zero git tags: releases were hand-cut plugin.json version bumps with no durable ref, so 'the previous release' was unresolvable (a hardcoded SHA rots) and features drifted onto a shipped version without a bump. Decision: adopt `claude plugin tag` — every release is bump-and-tag as one atomic step (`vfkb--v{version}` at the release commit), all shipped versions retro-tagged and pushed. This removes the RFC-024 §4 prerequisite for the install-path delivery proof and ends version drift."
status: "Accepted"
timestamp: 2026-07-16
---

# ADR-0060: Tag every plugin release `vfkb--v{version}`

- **Status:** Accepted (2026-07-16)
- **Date:** 2026-07-16
- **Relates:** [RFC-024](../rfc/RFC-024-staleness-detection-and-delivery-honesty.md) §4 (the
  `install-path` L4, whose stated prerequisite is *"`claude plugin tag` adopted, so 'the previous
  release' is resolvable"*); [ADR-0051](ADR-0051-delivery-honesty.md) (delivery is an
  unproven capability — this ADR is Phase 0 of earning the proof);
  [`install-path-L4-PLAN.md`](../install-path-L4-PLAN.md) §3 (the phase this executes);
  [ADR-0045](ADR-0045-vfkb-claude-code-plugin.md) (the plugin being versioned). Build repo:
  `vilosource/vfkb-claude-plugin`; ADRs live centrally here in vfkb.

## Context

The plugin repo had **zero git tags** (`git tag` empty, 2026-07-16). Per `RELEASING.md`, a release
was a hand-cut bump of `plugin/.claude-plugin/plugin.json`'s `version` plus a commit — no tag. Two
concrete failures followed:

1. **"The previous release" was unresolvable.** The `install-path` delivery L4 (RFC-024 §4) needs an
   `upgrade` arm — install release *N-1*, then `plugin update` to *N* — which requires *N-1* to be a
   durable, resolvable ref. Without tags the only handle is a commit SHA, which "rots at the next
   release" (RFC-024 §4). Ref-pinning itself already works (`marketplace add owner/repo@ref`); the
   missing piece was a **stable name** for each release.
2. **Version drift shipped silently.** `plugin.json` read `0.5.0` from its bump commit (`0fc7a88`) all
   the way to `HEAD`, but four commits landed *after* the bump under the same version — including a
   user-facing feature (the ADR-0059 INACTIVE guard, #16) and a whole L4 (`hooks-smoke`, #15).
   Features reached consumers with **no version to distinguish them**.

Investigation (2026-07-16, **observed**): `claude plugin tag [path]` exists and creates an **annotated
`{name}--v{version}` tag** at `HEAD`, validating that `plugin.json` and the enclosing
`marketplace.json` entry agree (`git tag -a vfkb--v0.5.0 -m "vfkb 0.5.0"`). A hermetic probe
(isolated `CLAUDE_CONFIG_DIR`) confirmed `claude plugin marketplace add
vilosource/vfkb-claude-plugin@vfkb--v0.4.0` clones at that ref and resolves `plugin.json` version
`0.4.0`, recording `{source:github, repo, ref:"vfkb--v0.4.0"}`. So a pushed tag **is** a resolvable
marketplace version.

## Decision

1. **Every plugin release is tagged `vfkb--v{version}` via `claude plugin tag`, at the same commit
   that bumps `plugin.json`.** Bump-and-tag is **one atomic release step**, not two — a version bump
   without its tag is a release-process defect. Push the tag to `origin` (github-source marketplaces
   resolve it).
2. **All shipped versions retro-tagged and pushed** (2026-07-16): `vfkb--v0.1.0` (`92a1bc1`),
   `v0.1.1` (`1b06eed`), `v0.2.0` (`8650e7e`), `v0.3.0` (`d00fa32`), `v0.4.0` (`79d2758`) at their
   bump commits, and `v0.5.0` at the current tip (`e7550fd`) via `claude plugin tag` — each verified
   so the tagged tree's `plugin.json` matches the tag name.
3. **The tag ref name is the full `vfkb--v{version}`** (CC-native format, not a bare `v{version}`);
   ref-pinning and the L4's upgrade arm use that exact name.
4. **This is Phase 0 of the `install-path` delivery proof** (`install-path-L4-PLAN.md`): it removes the
   only stated prerequisite. It does **not** itself prove delivery — `DELIVERY-STATUS.json` stays
   `unproven` until `scenarios/records/install-path.json` lands (ADR-0051 disclosure unchanged).

## Consequences

- **Positive:** every prior release is now an installable, ref-pinnable version; the `upgrade` arm is
  buildable (e.g. `v0.3.0` → `v0.4.0`, across which `/vfkb:brief` first appears). Going forward, a
  feature that ships without a bump+tag is a detectable process violation, not silent drift.
- **Accepted trade-off — the v0.5.0 retro-tag blesses existing drift.** Tagging `v0.5.0` at the
  current tip labels the guard (#16) and `hooks-smoke` (#15) as part of `0.5.0` rather than giving
  them their own version. We do **not** retro-renumber shipped history; the policy prevents *new*
  drift. (A future release cutting `v0.6.0` for post-`0.5.0` work is the clean path, out of scope
  here.)
- **`RELEASING.md` updated** in the plugin repo: the pre-tag checklist gains a `claude plugin tag
  plugin && …push` step, and the tag-format note.
- **Follow-on:** Phase 1 (`scenarios/install-path.mjs`, RED-verified) then Phase 2 (the metered run)
  per the plan. Cost is not a constraint (operator directive); the gate is harness correctness.
