---
type: RFC
title: "RFC-024: Staleness is undetectable and delivery is unproven — build the detector, fix the Brake, amend ADR-0050's `--plugin-dir` clause, and gate the L4"
description: "Plugin v0.4.0 was DEMONSTRATED 3/3 and unreachable. Adversarial review killed the obvious fix: a release-time install L4 would have gone GREEN on release day, because the packaging was fine and the operator's clone was stale. What is actually missing is a detector (doctor), a deterministic packaging check, and an honest ADR-0050 that stops calling `--plugin-dir` a real surface."
status: "Proposed"
timestamp: 2026-07-09
---

# RFC-024: Staleness is undetectable and delivery is unproven

- **Status:** Proposed
- **Date:** 2026-07-09
- **Deciders:** operator + Claude
- **Relates:**
  [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) — **this RFC amends it.** ADR-0050
  §"What counts as the full gate" (line 64) prescribes ``--plugin-dir`` as an acceptable real surface:
  *"driving the capability through the real surface a user will use (for plugin capabilities: a real
  plugin load, e.g. `--plugin-dir`; …)"*. That example is wrong. It did **not** cause the incident
  below — but it is why we cannot say whether delivery has ever worked.

  **Governance — why amend, not supersede.**
  [ADR-0001](../adr/ADR-0001-record-decisions-as-adrs.md) says a decided ADR is *"never edited."*
  `docs/adr/README.md:18-20` supplies the lawful follow-on status `Amended by ADR-XXXX` — for a
  decision one wishes *"to refine it without replacing (the original still holds, evidence or scope
  changed)"* — and notes *"the only permitted edit to a decided ADR is this one-line status pointer."*
  Precedent: **ADR-0016 amends ADR-0012**; **ADR-0024 amends ADR-0021**. ADR-0048 supplies the *test*,
  not the precedent: its §"Why supersede, not amend" holds supersede is for a mandate *withdrawn
  entirely* (as ADR-0048 did to ADR-0028), amend for a decision that still holds with changed scope or
  evidence. ADR-0050's mandate — the non-negotiable L4 gate — **stands in full**; one illustrative
  example inside it is wrong. Amend is the honest label. On acceptance this becomes **ADR-0051**;
  ADR-0050's body stays untouched and only its status-pointer line gains *"Amended by ADR-0051."*

  [ADR-0029](../adr/ADR-0029-sandbox-proven-definition-of-done.md) (the DoD),
  [ADR-0022](../adr/ADR-0022-l4-evaluation-methodology.md) (≥2/3 DEMONSTRATED; §8 credential
  handling — which this RFC's own probes violated, see Disclosure),
  [ADR-0023](../adr/ADR-0023-scenario-contract-first.md),
  [ADR-0045](../adr/ADR-0045-vfkb-claude-code-plugin.md) (the distribution mechanism),
  [ADR-0030](../adr/ADR-0030-consumer-integration-and-distribution.md) /
  [ADR-0031](../adr/ADR-0031-bootstrap-engine-resolution-guard.md) (the bundle consumer population),
  [ADR-0048](../adr/ADR-0048-retire-wiring-smoke-gate.md) (its deferred `hooks.json` item stays open),
  [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md) / [RFC-023](RFC-023-session-start-briefing.md)
  (`/vfkb:brief`, the capability that exposed the gap).

## Repos, and where each artifact lands

The one committed `[record]` cited below **does not exist in this repo.**

| Path | Repo |
| --- | --- |
| `src/doctor.ts`, `docs/**` | **vfkb** (this repo) |
| `scenarios/brief-skill.mjs`, `scenarios/release-gate.mjs`, `scenarios/records/brief-skill.json` | **vfkb-claude-plugin** |

## Evidence status

Every mechanical claim below was executed on 2026-07-09. **None of it is a committed L4 record.** Per
ADR-0050's own standard — *"A smoke check (N=1, no committed record) is NOT this gate"* — these are
**single-run, unrecorded probe observations**, labelled **[probe]**, sufficient to establish mechanism
and motivate a build, insufficient to declare anything done. The one committed artifact cited is
`scenarios/records/brief-skill.json`, labelled **[record]**.

## Context — what actually happened

Hours after ADR-0050 made the L4 DoD constitutional, the operator restarted Claude Code to use
`/vfkb:brief`, shipped in plugin v0.4.0. Its record says `demonstrated: true`, `wired: 3/3`,
`pluginVersion: "0.4.0"`, with `claude-haiku-4-5-20251001` in every wired arm's `models` **[record]**.
That record is real; its predicate was audited.

The operator got `Unknown command: /vfkb:brief`.

**The proximate cause was staleness, not packaging.** The marketplace clone was pinned at `b0e6667`
(v0.3.0 — `Skills (1)`, `Agents (0)`) while `origin/main` was `3aec82f`. **A Claude Code restart
re-reads the cached install and never re-pulls the clone.** (Brain gotcha `112f75187029`.) Compounding
it, `claude plugin update` defaults to `--scope user` and fails on a project-scope install.

**The packaging was never broken.** At `3aec82f`, `plugin/skills/brief/SKILL.md` and
`plugin/agents/briefer.md` are both present on `origin/main` **[probe]**. A fresh install at release
time would have succeeded. This single fact kills the obvious remedy, and is why this RFC does not
propose it — see "The fix that does not work."

### Root cause 2 — nothing could tell the operator he was stale

`src/doctor.ts:200-206` reads the installed version and declines to judge it (comment and `add()` are
verbatim but **not contiguous**; a guard and a sentence are elided):

```ts
// Doctor cannot compare the vendored engine's currency — the version is
// reported as information, never as "up to date".
…
add('plugin', 'ok', `${plugin.key} installed, version ${plugin.installed.version} (informational — currency not compared)`);
```

Live today **[probe]**: `OK plugin — vfkb@vfkb installed, version 0.4.0 (informational — currency not
compared)`. Yesterday the same line read `0.3.0`, still prefixed `OK`. **The one tool whose job is
"is my wiring healthy?" looked at the stale install and passed it.**

### Root cause 3 — delivery has never been proven, by construction

`scenarios/brief-skill.mjs:71` invokes `claude -p '/vfkb:brief' --plugin-dir <src>`. This is not a
corner cut; it is what ADR-0050 line 64 instructs. `--plugin-dir` loads from a source tree, bypassing
the marketplace clone, `marketplace.json` resolution (`source: "./plugin"`), the version cache,
`installed_plugins.json`, scope, and startup resolution. So we have **no evidence, ever, that the
plugin installs**. That is a latent gap the incident *revealed*. It is not what broke.

### The quiet-success trap

Reproduced hermetically **[probe]** (isolated `CLAUDE_CONFIG_DIR`, marketplace pinned at v0.3.0):

| | wired (v0.4.0) | stale (v0.3.0) |
| --- | --- | --- |
| sentinel in `result` | **true** | false |
| `modelUsage` (CLI JSON field) | `claude-haiku-4-5-20251001` | `[]` |
| `result` text | the five-section brief | `Unknown command: /vfkb:brief` |
| `is_error` | false | **false** |
| exit code | 0 | **0** |

**A session that cannot find the command exits zero and reports `is_error: false`.** Any check keyed on
exit status or error flags passes a broken install silently. This constrains every gate below.

## The fix that does not work

The obvious remedy — an `install-path` L4 that installs from the marketplace and exercises the skill —
**would have gone green on release day.** The packaging was correct; only the operator's clone was
stale. Worse, adversarial review surfaced two structural defects that make it unbuildable today:

1. **Version-binding deadlock.** `marketplace add owner/repo` clones the default branch and cannot pin
   a ref (`--help`: only `--scope`, `--sparse`) **[probe]**. To release v0.5.0 you need a record bound
   to v0.5.0, but `origin/main` still holds v0.4.0 until the release merges — and `release-gate` is a
   *required check* on that merge. The record can only be honest (proving 0.4.0, failing the gate) or
   green (claiming 0.5.0 while proving 0.4.0) — the exact asserted-not-observed sin this RFC opposes.
2. **No previous release to rewind to.** The upgrade arm needs "the previous release" commit. The
   plugin repo has **zero git tags** **[probe]**; releases are untagged merge commits. A hardcoded SHA
   rots at the next release. (`claude plugin tag` exists and would fix this — it is a prerequisite, not
   an assumption.)

And it would cost ~12 live metered sessions per release. Against CLAUDE.md:143 — **"Deterministic
backstop > probabilistic gate"** — spending twelve LLM sessions on a gate that misses its own
motivating bug is precisely the trade the doctrine forbids. **The L4 is therefore gated, not built**
(part 4).

## Proposal

### 1. `vfkb doctor` gains a currency check — the actual detector *(vfkb)*

This is the only part that addresses the incident.

- **Axis (a) — clone behind remote. The real detector.** `git fetch` in the marketplace's
  `installLocation`, compare `HEAD` to `origin/<default>`. Behind → **`warn`** with the remedy. This
  is the state the operator was in. It requires the network; offline → `skip`, never `fail`. Attempted
  by default with a short timeout, not hidden behind a flag: a detector nobody runs detects nothing.
- **Axis (b) — install behind clone. Deterministic, offline, `fail`.** Resolve the offered version by
  a two-hop lookup — `known_marketplaces.json[<mp>].installLocation` →
  `.claude-plugin/marketplace.json` → the plugin entry's `source` (`"./plugin"`) →
  `<source>/.claude-plugin/plugin.json` **[probe]**. There is **no** `plugin.json` at the clone root; a
  naive implementation finds nothing. Compare with the installed version from
  `installed_plugins.json`.

**Honest scope.** Axis (b) fires only for the *half-upgraded* state (clone advanced, install did not) —
reachable exactly via the `--scope user` default trap. In the operator's failure `installed == offered
== 0.3.0`, so **axis (b) would have passed clean.** Only axis (a) sees it, and only online. *Offline,
vfkb cannot tell you that you are running old code.* That is inherent, and it must be stated in the
doctor output rather than papered over.

Correctness requirements, each a defect found in review:

- **Honor `CLAUDE_CONFIG_DIR`.** `doctor.ts:98-99` derives the registry from `env.HOME` alone
  **[probe]**; Claude Code relocates the whole config, `plugins/` included. Standalone bug; prerequisite.
- **Semver compare, not string.** `"0.10.0" < "0.9.0"` is `true` lexicographically.
- **Never report a foreign install.** `findInstall()` falls back to any `scope: 'user'` entry.
- **Never use `claude plugin details` to learn the installed version.** It reports the version the
  *marketplace offers*: after advancing a directory-source marketplace, `details` printed `0.4.0` while
  `plugin update` simultaneously said *"updated from 0.3.0 to 0.4.0"* **[probe]**. Read
  `installed_plugins.json`.

**Evidence symmetry.** Axis (a) is backed by an observed instance. Axis (b) is backed by a *mechanism*
argument (the documented `--scope user` default), not an observed instance — the standard this RFC
elsewhere calls insufficient. It is admitted because it is deterministic, offline, cheap, and shares
axis (a)'s code path. A reviewer may reasonably gate it.

**Bundle consumers (ADR-0030/0031) are out of scope.** The engine carries `ENGINE_VERSION` /
`ENGINE_COMMIT` (`doctor.ts:91`) but no registry exists to compare against. No bundle consumer has been
*observed* running stale, so per CLAUDE.md's evidence-gated rule no probe is proposed. Trigger for a
future RFC: an observed stale-bundle consumer.

### 2. Deterministic backstops in the plugin's release gate *(vfkb-claude-plugin)*

No LLM, no auth, CI-safe. Two changes.

**2a. The gate must stop trusting a self-asserted boolean.** `scenarios/release-gate.mjs` reads
`rec.demonstrated`, `rec.pluginVersion`, and prints `rec.wired`/`rec.trials`. A record with
`demonstrated: true` and `wired: 1/3` **passes**. The gate enforces version-binding, not the criterion.
Fix: recompute the verdict from per-arm counts. To make that implementable, records adopt named arms
with explicit roles — note `brief-skill.json` already uses `arms` for *arrays of trial objects*, so
this is a **breaking shape change**, and `brief-skill.json` must be migrated, not shimmed:

```jsonc
{ "scenario": "brief-skill", "pluginVersion": "0.5.0", "trials": 3,
  "arms": { "wired": { "role": "positive", "passed": 3 },
            "contrast": { "role": "contrast", "passed": 0 } } }
```

Verdict, recomputed and never read from the record: **every `positive` arm ≥ ⌈2·trials/3⌉ and every
`contrast` arm == 0.**

**2b. A structural packaging check.** Assert that every component the plugin *declares* is present in
the tree that ships: each `skills/<name>/SKILL.md`, each `agents/<name>.md` referenced by a skill's
`agent:` frontmatter, `hooks/hooks.json` parses, `.mcp.json` parses, and the vendored bundles exist and
are non-empty. This is a deterministic unit test. It catches "released without the skill" — the class
of defect `--plugin-dir` masks — at zero metered cost, in CI, on every PR. It does **not** prove the
plugin installs; nothing deterministic can. It is the backstop doctrine demands before reaching for a
probabilistic gate.

`release-gate` is already a required status check on the plugin's `main` (`gh api
…/branches/main/protection` → `["release-gate"]`) **[probe]**.

### 3. Amend ADR-0050 *(vfkb)* — this RFC becomes ADR-0051

ADR-0050's body is **not edited** (ADR-0001). ADR-0051 states:

> **Amends ADR-0050.** Strike `--plugin-dir` as an example of "the real surface a user will use." A
> plugin loaded with `--plugin-dir` is a *development* surface: it proves the capability and **not**
> its delivery. It remains correct for the inner loop and for per-capability L4s. It may not be cited
> as evidence that a plugin **installs**.
>
> **Delivery is a capability, and upgrade is a capability distinct from install.** Neither is currently
> proven for this plugin. Until a delivery proof exists, the honest status of "the plugin installs" is
> **unproven** — and ADRs, release notes, and handoffs must say so rather than inferring it from a
> `--plugin-dir` L4.
>
> **Corollary — the quiet-success trap.** Where a delivery failure presents as a *successful* run
> lacking the capability (exit 0, `is_error: false`, "Unknown command"), the predicate MUST be a
> content assertion over the output. Exit status and error flags are not admissible evidence of
> delivery.
>
> **Corollary — a release-time gate cannot detect consumer staleness.** A correct release can be
> unreachable because the consumer's clone never advanced. Staleness is a *detection* problem, owned by
> `vfkb doctor`, not a gate problem. Do not build a release gate to catch it.

This RFC does **not** amend ADR-0022. Its ≥2/3 single-contrast rule is untouched, because the
three-arm scenario that would have extended it is gated below rather than built.

### 4. The `install-path` L4 — designed, **gated**, not built *(vfkb-claude-plugin)*

Per CLAUDE.md's evidence-gated rule (*"Don't build speculatively — an RFC decides the shape; the build
triggers on observed evidence or an explicit request"*), the delivery L4 is **specified and parked**.

**Trigger:** a delivery or upgrade defect that part 2b's structural check cannot see — e.g. the plugin
installs but fails to load, a hook path breaks only under the installed layout, or an upgrade leaves a
mixed-version cache. Or an explicit operator request.

**Prerequisites, both blocking:** (i) `claude plugin tag` adopted so "the previous release" is
resolvable; (ii) a way to bind a record to an unreleased version — a `ref`-pinned marketplace source,
or running the scenario post-merge and decoupling the gate's version binding.

**Design, and the traps found while probing it** — recorded so the eventual builder does not rediscover
them at cost:

- Arms: `fresh` (install from marketplace, capability present), `upgrade` (install previous release →
  capability absent → `marketplace update` → `plugin update --scope project` → capability present),
  `contrast` (capability removed → absent). The full transition was executed: stale clone at `b0e6667`
  → install resolves `0.3.0` → `marketplace update` advances the clone to `3aec82f` →
  `plugin update --scope project` → `0.4.0 @ 3aec82f` **[probe]**.
- A **directory** source records `{source: "directory", installLocation: <the path itself>}` and creates
  **no clone** — it cannot model a stale clone **[probe]**. `file://…` is **rejected** *("Invalid
  marketplace source format. Try: owner/repo, https://..., or ./path")* **[probe]**. A **github** source
  clones **shallowly**, so rewinding needs `git fetch --unshallow` first **[probe]**.
- `claude plugin install --scope project` works headlessly but needs a project dir containing
  `.claude/settings.json`; installing at project scope **auto-writes** `enabledPlugins` **[probe]**.
- `plugin update` prints *"Restart to apply changes."* Whether a fresh `claude -p` suffices as that
  restart is **unobserved**; on-disk state after update (`installed_plugins.json` → `0.4.0`, cache dir
  containing `brief`) suggests yes **[probe]**. This is the design's least-evidenced step.
- The `contrast` arm must delete **both** `skills/brief/` and `agents/briefer.md`. Deleting only the
  skill leaves the Haiku briefer agent installed and `Task`-spawnable, which could forge a Haiku entry
  in `modelUsage`.
- Predicate: sentinel in `result` **and** a `haiku` model in `modelUsage`. `haiku` alone does not
  discriminate — `brief-skill.json`'s contrast arm records `haiku: true, sentinel: false` **[record]**.
  Note the observed capability-absent case produced `modelUsage: []` and no model turn at all, so the
  sentinel may suffice; the conjunction is cheap insurance against a harness that starts running a turn.
  Assert **neither** exit code **nor** `is_error`.
- **The plugin's own hooks fire inside every arm.** `SessionEnd` auto-commits `.vfkb/entries.jsonl` and
  may write a B2 auto-handoff `fact`; it no-ops only on the default branch (`src/session-end.ts`). The
  sandbox must therefore stay on the default branch, and the `upgrade` arm's two runs **share one
  mutable brain** — the pre-run can perturb the post-run's predicate. Any builder must handle this.
- Credentials MUST follow ADR-0022 §8: `claudeAiOauth` only, containerised, scrubbed in a `finally`.
- Cost estimate: `3×1 (fresh) + 3×2 (upgrade, pre+post) + 3×1 (contrast)` ≈ **12 live sessions** per
  release.

## What this does not close

ADR-0048 deferred **host-level validation of the plugin's `hooks.json`** (vfkb-claude-plugin#6):
*"until it lands, validation of the plugin's `hooks.json` is an acknowledged gap."* Part 2b checks that
`hooks.json` *parses*; it never fires a hook. **#6 stays open.** An earlier draft claimed this RFC
closed it; withdrawn.

## Disclosure — credential mishandling during this investigation

The probes copied the **entire** `~/.claude/.credentials.json` (including `mcpOAuth`) into two sandbox
config dirs and ran two authenticated `claude -p` sessions against them. **This violated ADR-0022 §8**,
which already required copying only the `claudeAiOauth` block, into a container, *"never the live host
file, so a container-side token refresh cannot disturb the host session's credential."* Both copies were
deleted and the scratch dirs removed (verified: zero `.credentials.json` remain). **"No breakage was
observed" is not "no rotation occurred"** — a silent server-side refresh-token rotation is not
detectable by inspecting the host file. Operator action: if the live session's auth misbehaves,
re-authenticate (`/login`).

## Existing projects — how they get upgraded

**Plugin consumers (ADR-0045).** Two commands; the restart is last, not first:

```
claude plugin marketplace update <marketplace>      # axis (a): advance the clone
claude plugin update <plugin>@<mp> --scope project  # axis (b): advance the install
# then restart Claude Code to apply
```

`--scope` must match the install (`installed_plugins.json` shows it); the default `user` hard-fails on a
project-scope install. After part 1, `doctor` **warns** on axis (a) when online — the axis that bit the
operator — and **fails** on axis (b). Offline, it still cannot tell you that you are stale.

**Bundle consumers (ADR-0030/0031).** Refresh `$VFKB_BUNDLE_DIR`. No registry; currency unanswerable
offline. Out of scope, evidence-gated.

**No migration is required.** Nothing here changes on-disk formats, wiring, or the brain.

## Alternatives considered

**A. Remember to test after releasing.** The prose-rule-without-a-Brake ADR-0050 exists to reject.

**B. A release-time `install-path` L4 as the primary remedy.** *This RFC's first two drafts.* It would
have gone **green on release day**: the packaging was correct and the operator's clone was stale.
Rejected as the primary remedy, retained as a gated build for a different defect class.

**C. A fresh-install-only proof.** Also drafted, also wrong: a clean `CLAUDE_CONFIG_DIR` always resolves
newest, so it cannot reproduce an upgrade failure.

**D. A local-path (`./dir`) upgrade arm.** A directory source creates no clone, so axis (a) has nothing
to be stale **[probe]**.

**E. Make `brief-skill.mjs` use the install path.** Conflates skill regression with packaging
regression, and destroys the fast inner-loop gate.

**F. Run a live L4 in CI as the Brake.** Needs `claude` auth, is metered, and would put operator
credentials in CI.

**G. Assert on exit code / `is_error`.** Empirically broken **[probe]**.

**H. Surface staleness at session start rather than in `doctor`.** Attractive — it reaches the operator
without being asked — but a network `git fetch` on every `SessionStart` is a latency and offline-failure
hazard on the hot path. Deferred; revisit if the doctor warning proves insufficient.

## Consequences

- ADR-0050 — a *constitutional* ADR — is amended **the same day it was accepted** (both carry
  `timestamp: 2026-07-09`). The rule was falsified by evidence within hours; the amendment carries the
  evidence. *(An earlier draft of this section claimed "eleven days," a number with no source.)*
- The headline remedy is a **detector**, not a gate. That is an uncomfortable conclusion for a project
  whose doctrine is gate-shaped, and it follows directly from the packaging having been correct.
- `vfkb doctor` gains its first `fail` about the *environment* rather than the brain, plus a network
  `warn`. Consumers on a half-upgraded plugin see red where they saw green; consumers offline with a
  stale clone still see green, and doctor must say so.
- The plugin's release gate stops trusting a self-asserted boolean. `brief-skill.json`'s shape changes
  (breaking); the record must be regenerated or rewritten.
- Fixing `doctor` to honor `CLAUDE_CONFIG_DIR` is a prerequisite and a standalone bug fix.
- "The plugin installs" remains **unproven** and must be described that way until the gated L4 runs.
- Brain: gotchas `112f75187029`, `3c5ac5414d7a`, `b1f4272e605f`; fact `5e6f88502243`.

## Definition of Done

Until every item holds, the honest status is **"built, NOT yet verified."**

1. *(vfkb)* `doctor` honors `CLAUDE_CONFIG_DIR`, with a unit test that goes red on a fixture whose
   registry lives outside `$HOME`.
2. *(vfkb)* Axis (b): two-hop manifest resolution + semver compare, with deterministic unit tests that
   go red on a stale-registry fixture, a `0.10.0`-vs-`0.9.0` fixture, and a foreign-scope fixture.
3. *(vfkb)* Axis (a): `warn` when the clone is behind, `skip` when offline — with a unit test over a
   fixture pair (local git repo ahead of a clone) and an offline fixture asserting `skip`, never `fail`.
   Doctor's output states plainly that offline staleness is undetectable.
4. *(plugin)* `release-gate.mjs` recomputes the verdict from per-arm counts and roles, never reading
   `rec.demonstrated`. **The Brake is seen going red** on a stale record *and* on a `demonstrated: true`
   record with a failing arm. `brief-skill.json` is migrated to the roles shape.
5. *(plugin)* The structural packaging check exists, and is **seen going red** on a tree with a declared
   skill removed.
6. *(vfkb)* ADR-0051 committed; ADR-0050's status-pointer line — and nothing else in its body — records
   the amendment; CLAUDE.md's DoD section updated to match, including the "a release gate cannot detect
   consumer staleness" corollary.
7. The `install-path` L4 is **not** built. Its trigger and prerequisites are recorded above. Building it
   without the trigger is the speculative build this RFC declines.
