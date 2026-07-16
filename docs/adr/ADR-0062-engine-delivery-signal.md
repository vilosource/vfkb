---
type: Decision
title: "ADR-0062: Engine changes surface automatically as a ready-to-prove plugin release PR — producer-side automation over a normalized-bundle drift signal"
description: "The only link between 'the vfkb engine moved' and 'plugin consumers get it' was a human remembering RELEASING.md step 1; the plugin vendored main@c73cf8e with no signal anywhere. Decision: vfkb CI builds the bundles on every engine-affecting push, compares STAMP-NORMALIZED bytes against the plugin's vendored copies, and on drift pushes a re-vendor branch + opens the plugin release PR itself (scoped PAT) — born red on the evidence Brake, exactly as honest as a hand-made release PR. A credential-free daily cron in the plugin repo is the loud fallback. Raw-hash and commit-path signals rejected on observed false-fire evidence."
status: "Accepted"
timestamp: 2026-07-16
---

# ADR-0062: Engine changes surface automatically as a ready-to-prove plugin release PR

- **Status:** Accepted (2026-07-16)
- **Date:** 2026-07-16
- **Closes:** vfkb-claude-plugin#23 (the umbrella is vfkb-claude-plugin#26)
- **Relates:** [ADR-0061](ADR-0061-plugin-release-version-automation.md) (the version Brake +
  tag-on-merge this feeds into — its Brake decides the bump, its workflow tags the merge);
  [ADR-0060](ADR-0060-plugin-release-tagging.md) (durable release refs);
  [ADR-0051](ADR-0051-delivery-honesty.md) (delivery evidence — the PR this automation opens is
  **born red** on that gate, by design); [ADR-0045](ADR-0045-vfkb-claude-code-plugin.md) (the
  vendoring being automated); RFC-024 (staleness taxonomy). Build repos: this one (producer
  workflow + signal script) and `vilosource/vfkb-claude-plugin` (fallback detector).

## Context

The plugin **vendors** built engine bundles (`plugin/dist/bundles/`); plugin-wired consumers run
whatever was last vendored and never see vfkb's own releases. The only bridge was `RELEASING.md`
step 1 — a human remembering to re-vendor. Observed 2026-07-16: the plugin vendored
`main@c73cf8e`; nothing anywhere would ever flag a lag. The ADR-0061 version Brake cannot see this
class (it compares the plugin repo against its own tags, not against the engine upstream).

**What the signal must be — three findings, each observed:**

1. **Raw bundle hashes false-fire on every commit.** `build-bundles.mjs` stamps engine identity
   into the output via esbuild `define`: `ENGINE_COMMIT = true ? "<short-sha>" : "dev"` and
   `ENGINE_VERSION = true ? "<version>" : ownPackageVersion(`. The commit stamp changes on every
   vfkb commit, the version stamp on every release-please bump — with zero behavioral change.
2. **Commit-path signals false-fire on cosmetic changes.** The one `src/` commit since the last
   vendor (`16c9bba`) changed only a *comment*; esbuild drops comments, and the built bundles are
   byte-identical to the vendored ones once stamps are normalized. A "did `src/` change?" signal
   would have demanded a pointless release. (This corrects this session's own earlier claim that
   the plugin "lags by one engine commit" — at the bytes a consumer runs, it does not lag at all.)
3. **The build is deterministic.** Two consecutive builds from the same tree are byte-identical
   (observed), so normalized-byte comparison is stable.

Therefore the signal is: **normalize exactly the two identity stamps, hash, compare** —
`scripts/bundle-drift.mjs` (exit 0 clean / 1 drift / 2 error, so "the comparison broke" can never
read as either answer). Proven: CLEAN across different stamps on identical source (real data:
c73cf8e/0.2.1 vs current/0.2.3); DRIFT on a genuine byte change (a side-effect mutation — note the
first probe, an unused `export const`, was tree-shaken away and correctly did NOT fire).
Deliberate consequence: a stamp-only lag (older `vfkb --version` string in the vendored bundle)
does not trigger a release — cosmetic identity lag is `vfkb doctor` territory, not a delivery event.

## Decision

### 1. Producer-side automation — vfkb CI does everything, with one scoped secret

`.github/workflows/engine-delivery.yml` (this repo), on pushes to `main` touching the build inputs
(`src/`, `package.json`, `package-lock.json`, `scripts/build-bundles.mjs`, `tsconfig.json`) or the
signal's own files (`scripts/bundle-drift.mjs`, the workflow itself), and on manual dispatch:

- build the bundles, clone the plugin repo (public read), run `bundle-drift.mjs`;
- **CLEAN → green, done** (the common case);
- **DRIFT →** copy the fresh bundles into the clone, let **the plugin's own version Brake decide
  the bump** (run `scenarios/version-bump.mjs`; red → minor-bump `plugin.json`; re-run → must
  pass), commit as `chore: re-vendor engine bundles from vfkb main@<sha> — v<ver>`, force-push
  branch `re-vendor/engine`, and open the PR if none is open — authenticated by the fine-grained
  PAT `PLUGIN_DISPATCH_TOKEN` (scoped to the plugin repo only; expires 2026-10-14, refresh per
  brain fact `e8b0b341e2b0`).
- **every failure is loud** — a broken build, comparison error, push or PR failure is a red run on
  vfkb `main`.

**Why producer-side, not `repository_dispatch` + a plugin-side creator** (the shape plugin#23
sketched): the dispatch hop adds a second workflow, and its creator would need the PAT stored as a
secret in the **public** plugin repo, reachable by more trigger paths. Producer-side needs the
secret in exactly one place, and the PR is created by a **user PAT**, so CI runs on it —
`GITHUB_TOKEN`-created PRs get no workflow runs (observed on vfkb release-please, PR #120/#129).

### 2. The PR is born red on the evidence gate — automation proposes, never ships

The re-vendor PR changes `plugin/` bytes, so the tree-bound delivery record (issue #22) and the
version-bound capability records immediately fail the release gate. That red is the design: the
automation carries everything deterministic; the metered L4 re-pins (run from the **pushed**
branch, per the tree-binding) remain the only human step, exactly as for a hand-made release PR.
Nothing about ADR-0050/0051 relaxes. Unattended evidence production is plugin#24, not this ADR.

### 3. Idempotent single-PR flow — branch-aware, never clobbering evidence

One standing branch (`re-vendor/engine`); `concurrency: engine-delivery` serializes runs. Because
the PR's own instructions tell the operator to commit the re-pinned L4 records **onto that
branch**, the update path is guarded (review finding, vfkb#182 — the unguarded version reintroduced
exactly the release-please clobber class ADR-0061 §3 rejected):

- if the open branch **already proposes these bytes** (drift-compare against the *branch's*
  bundles, not `main`'s), exit green — this also kills gratuitous re-fires from stamp-only vfkb
  pushes after the PR opens;
- if the branch is genuinely stale but carries **any non-automation commit** (a subject not
  matching the re-vendor pattern, or anything touching `scenarios/records/`), **fail red for
  manual reconciliation** — a force-push would destroy committed, metered evidence;
- only a branch carrying nothing but this automation's own commits is force-pushed.

### 4. Credential-free fallback: the plugin repo detects staleness daily

`.github/workflows/engine-staleness.yml` (plugin repo, cron + manual): check out vfkb `main`,
build, run the same `bundle-drift.mjs`. CLEAN → green. DRIFT with an open `re-vendor/engine` PR →
green (the system is working). DRIFT with **no** open PR → **fail loud**, naming the likely causes
(producer workflow broken; PAT expired — 2026-10-14). No secrets: reads are public, `gh pr list`
uses the repo's own `GITHUB_TOKEN` (owner-filtered, so a fork branch named `re-vendor/engine`
cannot mask staleness). **Accepted blind spots, stated:** an open-but-ignored PR keeps the cron
green indefinitely (no age escalation), and GitHub disables `schedule` workflows after ~60 days of
repo inactivity — the fallback can itself go quiet in a dormant period.

### 5. The observation lever

The PR-creation path cannot be observed until real drift exists (none does today — finding 2). So
the workflow carries a `probe` dispatch input: it skips the drift gate, pushes a `re-vendor/probe`
branch with a marker file (no `plugin/` surface change, no version bump), and opens a `[probe]` PR
— exercising token, cross-repo push, PR creation and CI-on-PR end to end. Run once at rollout,
observe, close. Without this, the load-bearing path would ship unobserved (the release-tag.yml
lesson).

## Consequences

- An engine change on `main` now surfaces as actionable work within minutes, without human memory;
  a missed signal surfaces within a day, loudly.
- Stamp-only version lag in vendored bundles is accepted (cosmetic; `doctor` reports staleness).
- The PAT is a standing supply-chain credential for a repo 8 consumers track — mitigated by
  fine-grained scoping (one repo, Contents/PR/Actions), 90-day expiry, and the loud-failure design.
- Unit backstop: `test/bundle-drift.test.ts` pins the normalization against the exact stamp
  literals **and against a real build** — it builds the bundles and asserts the regexes bite them
  in the observed per-bundle counts (synthetic literals alone would stay green if the toolchain
  changed the emitted shape — review finding, vfkb#182). The regexes tolerate esbuild's
  collision-renaming (`\d*` suffixes), the one shape drift already observable in these bundles.
- **Non-goals:** producing evidence (plugin#24), merging (plugin#25), CHANGELOG/publishing.
