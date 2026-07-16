---
type: Decision
title: "ADR-0061: Enforce bump-and-tag mechanically — a version Brake plus tag-on-merge (release-please rejected)"
description: "ADR-0060 made bump-and-tag 'one atomic release step' and left both halves to the operator's hands, where both were skipped: templates/vfkb-guard.mjs shipped into an already-released 0.5.0. Prose cannot enforce atomicity. Decision: a deterministic PR Brake (a shipped version is immutable — if plugin/ or templates/ differs from what vfkb--v{version} shipped, bump) plus a tag-on-merge workflow that removes the tag step from human hands. release-please rejected on three source-verified grounds: it cannot parse back the vfkb--v{version} tag it would emit, chore-only re-vendors cut no release, and its force-pushed release PR would clobber the metered L4 records the release gate requires."
status: "Accepted"
timestamp: 2026-07-16
---

# ADR-0061: Enforce bump-and-tag mechanically — a version Brake plus tag-on-merge

- **Status:** Accepted (2026-07-16)
- **Date:** 2026-07-16
- **Relates:** [ADR-0060](ADR-0060-plugin-release-tagging.md) (adopted the `vfkb--v{version}` tag and
  declared bump-and-tag atomic — **this ADR supplies the enforcement it lacked, and corrects one of
  its factual claims**); [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md) (a prose DoD rule gets
  skipped, a Brake cannot — the principle this applies); [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md)
  (a proof that cannot fail proves nothing — why the Brake ships with negative checks);
  [ADR-0056](ADR-0056-versioning-and-release-automation.md) (release-please, the right answer for the
  **engine** repo and the wrong one here — see Alternatives);
  [ADR-0051](ADR-0051-delivery-honesty.md) (delivery stays unproven; untouched by this ADR);
  [ADR-0045](ADR-0045-vfkb-claude-code-plugin.md) (the plugin being versioned).
  Build repo: `vilosource/vfkb-claude-plugin`; ADRs live centrally here in vfkb.

## Context

ADR-0060 adopted `claude plugin tag` and ruled that **bump-and-tag is one atomic release step**. It
then left both halves to be typed by hand. An atomicity guarantee that depends on someone remembering
two commands is not a guarantee; it is a hope. ADR-0050 already settled what to do about that in this
house — *"prose DoD rules get skipped; the Brake cannot be"* — and the rule was skipped within days of
being written.

**What actually drifted (observed 2026-07-16, and this corrects ADR-0060).** ADR-0060 states that
`0.5.0` shipped "a user-facing feature (the ADR-0059 INACTIVE guard, #16) and a whole L4
(`hooks-smoke`, #15)". Reading the four commits between the `0.5.0` bump (`0fc7a88`) and the tip
(`e7550fd`):

| commit | touched | consumer-facing? |
| --- | --- | --- |
| `e7550fd` #16 INACTIVE guard | `templates/vfkb-guard.mjs`, `scenarios/`, `.github/`, docs | **yes — `templates/`** |
| `f569e1d` #15 hooks-smoke L4 | `scenarios/`, `RELEASING.md` | no |
| `f825a5b` #14 wiring migration | `.claude/`, `.mcp.json`, `AGENTS.md` | no (this repo's own wiring) |
| `60f6aa4` #13 brain record | `.vfkb/entries.jsonl` | no |

**Not one of them touched `plugin/`.** The real drift is a single file — `templates/vfkb-guard.mjs`,
which consumers **copy and commit** (ADR-0059) — landing in an already-released `0.5.0`. The
`hooks-smoke` L4 changed no byte a consumer receives and was never drift.

This correction is the whole design. The obvious Brake — "if `plugin/**` changed, require a bump" —
would have been **green on the very commit that motivated it**. A Brake that misses the bug it was
written for is decoration, and the only reason we know this one doesn't is that the diff was read
instead of the ADR's summary of it.

## Decision

### 1. The invariant: a shipped version is immutable

> If the consumer-facing surface differs from what `vfkb--v{version}` already shipped, then `version`
> is stale and MUST be bumped.

Stated against **the tag**, not the merge-base. A merge-base check asks *"did this PR change the
surface?"* — a question about a diff, which answers "no" for a PR landing onto an already-drifted
`main`. This asks *"does the artifact match the version it claims?"* — a question about the artifact a
consumer installs. It therefore holds on any checkout, in any order, with no PR context.

### 2. The consumer-facing surface is `plugin/` and `templates/`

`plugin/` is what `claude plugin install` resolves; `templates/` is `vfkb-guard.mjs`, which consumers
commit. Nothing else: `scenarios/` is proof machinery, `.github/` is CI, `*.md` is prose, `.vfkb/` is
this repo's own brain — none change a shipped byte. Requiring a bump (and **three metered L4 re-runs**)
to land a test would make the Brake something people route around, and per the table above `scenarios/`
was never the problem. The list is a declaration of record: an entry naming a path that exists on
neither side goes **red** rather than silently checking nothing (ADR-0029 anti-vacuity).

### 3. Two mechanisms, one per skippable half

- **`scenarios/version-bump.mjs`** (every PR, deterministic, no LLM/auth/network beyond git) — the
  bump becomes unskippable. It ships with **`version-bump.selftest.mjs`**: eleven cases on real git
  repos in a tmpdir, each observed going the way it must, including a **replay of the actual 0.5.0
  drift**. It fails **closed**: a checkout carrying no `vfkb--v*` tags at all is reported as missing
  tag data rather than treated as "nothing released yet" — otherwise the Actions default (shallow,
  tagless) would make every version look unreleased and the Brake pass vacuously, silently, in the
  one configuration it exists to police.
- **`.github/workflows/release-tag.yml`** (merge to `main`) — the tag becomes unskippable by leaving
  human hands entirely: a version on `main` without its tag gets one, at that commit, after the
  deterministic gates re-run green. This is safe to automate precisely because the tag is **not a
  decision** — it is a mechanical consequence of a version reaching `main`, and the decision (which
  version, on what evidence) was reviewed in the PR.

Together the loop closes: a surface change forces a bump; a bump always gets its tag; the next surface
change diffs against that tag. `claude plugin tag` remains the local equivalent and is no longer part
of the release procedure.

### 4. It stays out of `release-gate.mjs`

That gate is pure-filesystem by construction (*"No LLM, no auth, no network"*), which is why it can be
selftested against synthetic trees. This check needs git history and tags. It ships as its own Brake
rather than costing the release gate the property that makes it trustworthy.

### 5. No skip label

Per ADR-0050, a Brake that can be waved through is prose. If the Brake is wrong, fix the Brake and add
the case to its selftest. The Brake never moves a published tag — that is a consumer's pin.

### 6. `vfkb--v{version}` is preserved exactly; nothing about delivery changes

The format is asserted in the workflow before any push. `DELIVERY-STATUS.json` stays `unproven` until
`scenarios/records/install-path.json` lands (ADR-0051, untouched).

## Alternatives considered

**release-please with a custom tag format — rejected on three independent, source-verified grounds.**
It is the right tool for the vfkb *engine* repo (ADR-0056) and the wrong one here. Verified against
`googleapis/release-please@5d70353` (v17.10.3), the version `release-please-action@v5.0.0` resolves:

1. **It cannot parse back the tag it would emit.** `component: "vfkb"` + `tag-separator: "--"` does
   generate `vfkb--v0.5.0`, but `TAG_PATTERN` in `src/util/tag-name.ts` is
   `/^((?<component>.*)(?<separator>[^a-zA-Z0-9]))?(?<v>v)?(?<version>\d+\.\d+\.\d+.*)$/` — the greedy
   `.*` eats the first dash, so the tag round-trips to component **`vfkb-`**, not `vfkb` (**observed**:
   run against the real regex, `vfkb--v0.5.0 → component="vfkb-"`; `vfkb-v0.5.0 → component="vfkb"`).
   Release discovery matches components by string equality (`src/manifest.ts`), so release-please would
   emit our tags and then **fail to recognize its own releases**, treating every run as
   beginning-of-time. Every separator in its own tests is a single character. Keeping ADR-0060's
   mandatory format means keeping tagging away from release-please — and the format is not negotiable
   (ref-pinning and the `install-path` upgrade arm read that exact string).
2. **Our cadence cuts no releases.** Releases here are chore-driven re-vendors (4 of 6 shipped
   versions are `chore: re-vendor …`). `chore:` is `hidden: true` by default, and
   `src/strategies/base.ts` skips the release entirely when the changelog is empty — so
   release-please would have cut **zero** of them. Making `chore:` release-triggering is configurable,
   but then every chore cuts a release, which is the opposite error.
3. **Its release PR would clobber the evidence.** The release gate requires the metered L4 records to
   be re-pinned to the shipping `pluginVersion` — so the bot's bump PR is **born red** and can only go
   green by adding records to it. But `src/github.ts` passes a hardcoded, non-configurable
   `force: true`, rebuilding the release branch from `main`'s head — any records pushed onto it are
   destroyed on the bot's next run. The standing release PR, release-please's central artifact, is
   structurally incompatible with this repo's evidence discipline.

**A lighter "did this PR bump?" merge-base check — rejected**: green on a PR landing onto an already
drifted `main`, and it answers a question about a diff rather than about the artifact.

## Consequences

- **Positive:** the `0.5.0` class of drift is now impossible — verified by replaying that exact
  history against the Brake, which goes red naming `templates/vfkb-guard.mjs`. "The previous release"
  stays resolvable, and no release can ship untagged.
- **The real trade-off, stated plainly: surface changes now cost three metered L4 re-runs, and that
  cost is no longer evadable.** The release gate always demanded records bound to the shipping
  version; drifting the version was the (unintentional) way around it. This makes the existing cost
  honest rather than adding a new one — but it does mean a one-line `templates/` fix is a release.
  Accepted: that is what shipping to consumers is.
- **`0.5.0`'s drift stays blessed.** The Brake is green on today's `main` because ADR-0060 retro-tagged
  `v0.5.0` at the tip. The invariant holds **forward**; shipped history is not renumbered (ADR-0060's
  accepted trade-off, unchanged).
- **Tag creation moves to CI**, so it inherits CI's failure modes (a broken `GITHUB_TOKEN` means no
  tag). The workflow verifies the ref landed on the remote rather than trusting the push's exit code,
  and re-runs the deterministic gates before tagging so it can never bless a red `main`.
- **`RELEASING.md` rewritten**: `claude plugin tag` leaves the checklist; the local pre-flight gains
  `version-bump.mjs`, which diffs the working tree so a red is a local red first.
- **Non-goals:** no publishing, no GitHub Release, no CHANGELOG. This creates the one ref ADR-0060
  specifies and stops.
