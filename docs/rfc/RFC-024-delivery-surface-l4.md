---
type: RFC
title: "RFC-024: Delivery and upgrade are capabilities — amend ADR-0050's `--plugin-dir` clause, prove the upgrade path, and teach doctor to compare currency"
description: "Plugin v0.4.0 was DEMONSTRATED 3/3 and simultaneously unreachable. ADR-0050 explicitly names `--plugin-dir` as an acceptable real surface; that clause is wrong and this RFC amends it. Proposes an install-path L4 with an upgrade arm, a currency check in doctor, and an honest account of what each can and cannot detect."
status: "Proposed"
timestamp: 2026-07-09
---

# RFC-024: Delivery and upgrade are capabilities

- **Status:** Proposed
- **Date:** 2026-07-09
- **Deciders:** operator + Claude
- **Relates:**
  [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) — **this RFC amends it.** ADR-0050 §"What
  counts as the full gate" (line 64) explicitly prescribes ``--plugin-dir`` as an acceptable real
  surface: *"driving the capability through the real surface a user will use (for plugin capabilities:
  a real plugin load, e.g. `--plugin-dir`; …)"*. That example is **wrong** and is the proximate cause
  of the incident below. Per [ADR-0001](../adr/ADR-0001-record-decisions-as-adrs.md) a decided ADR is *"never
  edited; a change of mind is a new ADR that supersedes the old one"* — so on acceptance this becomes
  **ADR-0051**, ADR-0050's body stays untouched, and only ADR-0050's status-pointer line gains
  *"amended by ADR-0051"* (the same lawful move ADR-0048 used).
  [ADR-0029](../adr/ADR-0029-sandbox-proven-definition-of-done.md) (the DoD),
  [ADR-0022](../adr/ADR-0022-l4-evaluation-methodology.md) (≥2/3 DEMONSTRATED; §8 credential
  handling — which this RFC's first draft violated),
  [ADR-0023](../adr/ADR-0023-scenario-contract-first.md),
  [ADR-0045](../adr/ADR-0045-vfkb-claude-code-plugin.md) (the distribution mechanism),
  [ADR-0030](../adr/ADR-0030-consumer-integration-and-distribution.md) /
  [ADR-0031](../adr/ADR-0031-bootstrap-engine-resolution-guard.md) (the bundle consumer population),
  [ADR-0048](../adr/ADR-0048-retire-wiring-smoke-gate.md) (**partially** related — see the honest
  scoping in "What this does not close"),
  [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md) / [RFC-023](RFC-023-session-start-briefing.md)
  (`/vfkb:brief`, the capability that exposed the gap).

## Evidence status of this document

Every mechanical claim below was executed during the investigation of 2026-07-09. **None of it is a
committed L4 record.** Per ADR-0050's own standard — *"A smoke check (N=1, no committed record) is
NOT this gate"* — these are **single-run, unrecorded probe observations**, sufficient to establish
*constructibility* and to motivate a build, and explicitly **not** sufficient to declare anything
done. They are labelled **[probe]** throughout. The one exception is `scenarios/records/brief-skill.json`,
a committed record, cited as **[record]**.

## Context — an observed failure, one day after the Brake was built

Hours after ADR-0050 made the L4 DoD constitutional and mechanically enforced, the operator restarted
Claude Code to use `/vfkb:brief`, shipped in plugin v0.4.0. Its L4 record says `demonstrated: true`,
`wired: 3/3`, `pluginVersion: "0.4.0"`, with `claude-haiku-4-5-20251001` in every wired arm's
`modelUsage` **[record]**. That record is real; its predicate was audited and it is not an asserted
claim.

The operator got:

```
Unknown command: /vfkb:brief
```

Both facts held at once. The skill was proven, and the skill was unreachable.

### Root cause 1 — ADR-0050 sanctioned the wrong surface

`scenarios/brief-skill.mjs:71` invokes:

```js
sh('claude', ['-p', '/vfkb:brief', '--plugin-dir', PLUGIN, ...])
```

This is not a scenario author cutting a corner. It is **exactly what ADR-0050 line 64 tells them to
do.** `--plugin-dir` loads the plugin from a source tree, bypassing every step between a merged commit
and a running session:

| Step in the real chain | Exercised by `--plugin-dir`? |
| --- | --- |
| marketplace clone is fetched / advanced | **no** |
| `marketplace.json` resolves the plugin entry (`source: "./plugin"`) | **no** |
| version lands in `plugins/cache/<mp>/<plugin>/<version>/` | **no** |
| `installed_plugins.json` records installPath + scope + sha | **no** |
| session resolves the *installed* plugin at startup | **no** |
| skill/agent/hook/MCP components register from it | partially |

The v0.4.0 L4 proved the last row. Running it a hundred more times goes 100/100 while the operator
still gets `Unknown command`. **This is not a "more trials" problem, and it is not a discipline
problem — it is a defect in the constitutional rule itself.**

### Root cause 2 — the failure is an *upgrade* failure; fresh-install proofs cannot see it

The operator's marketplace clone was pinned at `b0e6667` (v0.3.0 — `Skills (1) vfkb`, `Agents (0)`)
while `origin/main` was `3aec82f` with `plugin/skills/brief/SKILL.md`. **A restart re-reads the cached
install and never re-pulls the clone.** (Brain gotcha `112f75187029`.)

A scenario that installs into a clean `CLAUDE_CONFIG_DIR` **always resolves the newest version** and
goes green regardless. **This RFC's own first draft proposed exactly that**, and would have passed
while the operator was broken. See rejected alternative B.

Two independent staleness axes, which fail differently and are **not** equally detectable:

| axis | what is stale | offline-detectable? | caused the incident? |
| --- | --- | --- | --- |
| **(a)** clone behind its remote | the *source* never advanced | **no** — requires `git fetch` | **yes** |
| **(b)** install behind the clone | clone advanced, `plugin update` didn't | **yes** | no (latent) |

Axis (b) is not hypothetical: `claude plugin update <p>@<mp>` **defaults to `--scope user`** (confirmed
from `--help`) and fails on a project-scope install. Run the documented upgrade, miss the scope flag,
land in (b).

### Root cause 3 — `vfkb doctor` reports the broken state as OK

`src/doctor.ts:200-206` reads the installed version and declines to judge it (comment and `add()` call
below are verbatim but **not contiguous** — a guard and a sentence are elided):

```ts
// Doctor cannot compare the vendored engine's currency — the version is
// reported as information, never as "up to date".
…
add('plugin', 'ok', `${plugin.key} installed, version ${plugin.installed.version} (informational — currency not compared)`);
```

Observed live today **[probe]**: `OK plugin — vfkb@vfkb installed, version 0.4.0 (informational —
currency not compared)`. Yesterday the same line read `0.3.0`, still prefixed `OK`.
`detectPluginWiring()` already parses the registry and holds the version; the comparison was simply
never made.

### The quiet-success trap

Reproduced hermetically **[probe]** (isolated `CLAUDE_CONFIG_DIR`; marketplace pinned at the v0.3.0
commit; same sandbox and sentinel):

| | wired (v0.4.0) | stale (v0.3.0) |
| --- | --- | --- |
| sentinel in `result` | **true** | false |
| `modelUsage` | `claude-haiku-4-5-20251001` | `[]` |
| `result` text | the five-section brief | `Unknown command: /vfkb:brief` |
| `is_error` | false | **false** |
| exit code | 0 | **0** |

**A session that cannot find the command exits zero and reports `is_error: false`.** Any gate keyed on
exit status or error flags passes the broken install silently. Only a content assertion catches it.

## Problem statement

ADR-0050 requires proof "through the real surface a user will use," then names an example that is not
a surface any user uses. Two distinct capabilities were never proven for the plugin: that a user can
**receive** it, and that an existing user can **upgrade into** it. A capability the user cannot
receive is not shipped. A capability only *new* users receive is not shipped either.

## Proposal

Four parts. Part 4 is the doctrinal fix and is the reason this becomes an ADR.

### 1. `vfkb doctor` compares currency — with an honest account of what it can detect

Two checks, matching the two axes. **Neither is a Brake**; doctor is the consumer-facing *detector*.

- **Axis (b) — offline, always run, `fail`.** Compare the installed version against the version the
  marketplace *offers*. Resolution is a two-hop lookup, not a guess:
  `known_marketplaces.json[<mp>].installLocation` → that dir's `.claude-plugin/marketplace.json` →
  the plugin entry's `source` (here `"./plugin"`) → `<source>/.claude-plugin/plugin.json`.**[probe]**
  There is **no** `plugin.json` at the clone root; a naive implementation finds nothing.
- **Axis (a) — network, opt-in `--check-remote`, `warn`.** `git fetch` in `installLocation`, compare
  `HEAD` to `origin/<default>`. Offline → `skip`, never `fail`. Note the clone is created **shallow**
  **[probe]**, so history-based comparisons must not assume old commits are present.

**What axis (b) cannot do — stated plainly, because the first draft oversold it.** In the operator's
actual failure the *clone itself* was stale, so `installed == available == 0.3.0` and **axis (b)
passes clean**. The default, offline, deterministic check **would not have caught the incident that
motivates this RFC.** Only axis (a) detects it, and axis (a) requires the network. The honest summary
is: *doctor cannot tell you offline whether you are running old code.* Axis (b) catches the
half-upgraded state; axis (a) catches the incident.

Correctness requirements the design must satisfy (each is a real defect found in the first draft):

- **Honor `CLAUDE_CONFIG_DIR`.** `doctor.ts:98-99` derives the registry from `env.HOME` alone. Claude
  Code relocates the whole config — including `plugins/` — under `CLAUDE_CONFIG_DIR` **[probe]**. As
  written, doctor would read the host registry even when run inside a sandbox. Fix this first; it is
  also a standalone bug.
- **Semver compare, not string compare.** `"0.10.0" < "0.9.0"` is `true` lexicographically.
- **Do not report another project's install.** `findInstall()` falls back to any `scope: 'user'`
  entry; a foreign install must not produce a `fail` for this root.
- **Do not use `claude plugin details` to learn the installed version.** It reports the version the
  *marketplace offers*, not the one installed: after advancing a directory-source marketplace,
  `details` printed `0.4.0` while `plugin update` simultaneously reported *"updated from 0.3.0 to
  0.4.0"* **[probe]**. Read `installed_plugins.json`.

**Bundle consumers (ADR-0030/0031) are out of scope.** The engine carries `ENGINE_VERSION` /
`ENGINE_COMMIT` (`doctor.ts:91`) but there is no registry to compare against. No bundle consumer has
been *observed* running a stale bundle, so per CLAUDE.md's evidence-gated rule (*"Don't build
speculatively"*) this RFC proposes **no** bundle-currency probe — not even the GitHub-API comparison
its own first draft proposed while simultaneously declaring the population out of scope. Trigger for a
future RFC: an observed stale-bundle consumer.

### 2. An `install-path` L4 with an *upgrade* arm (vfkb-claude-plugin)

`scenarios/install-path.mjs`, **no `--plugin-dir` anywhere**. Three arms.

Constructibility is established **[probe]**, and the mechanics are more constrained than the first
draft assumed:

- A **directory** source (`./path`) records `{source: "directory", installLocation: <the path itself>}` —
  **no clone is created.** A directory-sourced arm therefore *cannot* reproduce axis (a); there is
  nothing to be stale. The first draft's local-path upgrade arm was unbuildable for its stated purpose.
- `file://…` is **rejected**: *"Invalid marketplace source format. Try: owner/repo, https://..., or
  ./path."* A local bare repo cannot serve as a git source.
- A **github** source (`owner/repo`) creates a real, **shallow** clone at
  `<config>/plugins/marketplaces/<mp>`. Axis (a) is reproduced by `git fetch --unshallow` then
  `git reset --hard <prev-release>` inside that clone — the operator's exact state.
- `claude plugin install --scope project` works headlessly, but needs a project dir containing
  `.claude/settings.json`; the sandbox must create one.

Full transition, executed **[probe]**: stale clone at `b0e6667` → `install` resolves `0.3.0` →
`marketplace update` advances the clone to `3aec82f` → `plugin update --scope project` → `0.4.0 @
3aec82f`.

**Arms:**

- **`fresh`** — github source at HEAD → `marketplace add` → `install --scope project` → capability
  **present**. Proves delivery.
- **`upgrade`** *(the arm that would have caught this bug)* — clone rewound to the previous release →
  `install` → capability **absent** → run the *documented* upgrade verbatim (`marketplace update`;
  `plugin update <p>@<mp> --scope project`) → capability **present**. Proves both axes and the scope
  flag.
- **`contrast`** *(can-fail)* — github source at HEAD with `skills/brief/` deleted → capability
  **absent**.

**Predicate — a conjunction, because the sentinel alone is not safe.** The seeded brain contains the
sentinel in `entries.jsonl` in *every* arm, and the run uses `--dangerously-skip-permissions` with full
tools. An agent told `/vfkb:brief` is unknown may satisfy the apparent intent by reading
`entries.jsonl` and emitting the sentinel anyway — a false green on the can-fail arm. (The existing
`brief-skill` contrast avoided this only because *its* contrast brain had no handoff at all.)
Therefore:

> **PASS ⇔ the sentinel appears in `result` AND `modelUsage` contains a `haiku` model.**

The outer model is pinned non-Haiku, so Haiku can only be the skill's `context: fork`. If the skill is
absent no fork occurs, so `modelUsage` is `[]` **[probe]** — and a brain-reading agent cannot forge it.
Note that `haiku` **alone** does not discriminate: `brief-skill.json`'s contrast arm shows
`haiku: true` with `sentinel: false` **[record]**, because there the skill existed and forked over a
handoff-less brain. Only the conjunction is sound, and only for *this* scenario's failure mode.
Assert **neither** exit code **nor** `is_error`.

**DEMONSTRATED for a three-arm scenario — an explicit extension of ADR-0022, not a reading of it.**
ADR-0022 §5 defines DEMONSTRATED against a *single* contrast at ≥2/3. This scenario needs a composite,
so it is defined here and must be ratified as part of this RFC:

> `fresh` ≥ 2/3 **and** `upgrade` ≥ 2/3 **and** `contrast` == 0/3.

`contrast == 0` (not merely "lower") because with LLM noise a 2-vs-1 split is a one-trial margin.
**Cost: 3 arms × 3 trials = 9 live `claude -p` sessions per release**, plus credential handling.

**Credentials — the first draft violated existing doctrine.** It proposed copying the whole
`~/.claude/.credentials.json` into a host-side config dir. ADR-0022 §8 already settled this: copy
**only** the `claudeAiOauth` block, into the container, *"never the live host file, so a container-side
token refresh cannot disturb the host session's credential."* The full-file copy also carries
`mcpOAuth`. Worse, a host-side copy shares the refresh token: **if the sandbox session refreshes, the
server may rotate the token and invalidate the operator's live credential.** The scenario MUST follow
ADR-0022 §8 — `claudeAiOauth` only, containerised, scrubbed in a `finally`. *(Disclosure: the probes
behind this RFC copied the full file to a host dir. No breakage was observed, but the risk was real
and the rule already existed.)*

### 3. Wire it into the Brake — and fix what the Brake actually checks

`scenarios/release-gate.mjs` reads only `rec.demonstrated`, `rec.pluginVersion`, and prints
`rec.wired`/`rec.trials`. **The first draft's claim that this is a "one-line change" was wrong**, in
two ways:

1. A three-arm record has no `wired` field, so the gate would log the literal `DEMONSTRATED
   undefined/3`. Cosmetic, but it is a lie in the CI log.
2. More seriously, **the gate trusts a self-asserted `demonstrated` boolean.** A record with
   `demonstrated: true` and `fresh: 1/3` passes. The gate enforces *version-binding*, not the
   criterion. Saying it makes a bad release "mechanically impossible" overstates it.

So the change is `REQUIRED = ['brief-skill', 'install-path']` **plus** teaching the gate to recompute
the verdict from the per-arm counts rather than trust the boolean, and to handle both record shapes.
`release-gate` is already a required status check on the plugin's `main` (`gh api
…/branches/main/protection` → `["release-gate"]`) **[probe]**, so once the gate is honest, the binding
is real.

### 4. Amend ADR-0050 (this RFC becomes ADR-0051)

ADR-0050's body is **not edited** (ADR-0001). ADR-0051 states:

> **Amends ADR-0050.** Strike `--plugin-dir` as an example of "the real surface a user will use." A
> plugin loaded with `--plugin-dir` is a *development* surface. It proves the capability and **not**
> its delivery, and may not be cited as satisfying the gate **for a release**. It remains correct for
> the inner loop and for per-capability L4s that are not the release canary.
>
> **Delivery is a capability; upgrade is a capability distinct from install.** For anything
> distributed to a user, a release proof must traverse the **delivery surface** (installed by the
> mechanism the user installs it by, in an isolated environment, then exercised) and the **upgrade
> surface** (an installation of the *previous* release, advanced by the *documented upgrade
> procedure*, then exercised). A proof that installs into a clean environment proves delivery and
> **not** upgrade.
>
> **Corollary — the quiet-success trap.** Where the delivery failure mode is a *successful* run that
> merely lacks the capability (exit 0, `is_error: false`, "Unknown command"), the predicate MUST be a
> content assertion over the output. Exit status and error flags are not admissible evidence of
> delivery.

**Scope discipline.** Not every capability needs an install-path L4 — that is a per-feature tax for a
per-release risk. Delivery and upgrade are proven **once per release** by a single canary. Every other
capability's L4 then legitimately tests the capability rather than the chain, and `--plugin-dir` is
fine for those.

## What this does not close

ADR-0048 deferred **host-level validation of the plugin's `hooks.json`** (SessionStart / PreToolUse /
Stop / SessionEnd), tracked as vfkb-claude-plugin#6: *"until it lands, validation of the plugin's
`hooks.json` is an acknowledged gap."* The `install-path` scenario asserts that a **skill** is
reachable through the install chain. **It never fires a hook.** This RFC therefore closes the
distribution/upgrade half and leaves #6 **open**. The first draft claimed it "closes ADR-0048's
deferred item"; that was an overreach and is withdrawn.

## Existing projects — how they get upgraded

**Plugin consumers (ADR-0045).** Two commands, and the restart is last, not first:

```
claude plugin marketplace update <marketplace>      # axis (a): advance the clone
claude plugin update <plugin>@<mp> --scope project  # axis (b): advance the install
# then restart Claude Code to apply
```

`--scope` must match the install (`installed_plugins.json` shows it); the default `user` hard-fails on
a project-scope install. After part 1, `doctor` **fails** on axis (b) and, **only with
`--check-remote`**, warns on axis (a) — the axis that actually bit the operator. Offline, doctor still
cannot tell you that you are running old code. That limitation is inherent, not an oversight.

**Bundle consumers (ADR-0030/0031).** Upgrade is a refresh of `$VFKB_BUNDLE_DIR`. No registry exists;
currency is unanswerable offline. Out of scope, evidence-gated (above).

**No migration is required of either population.** Nothing here changes on-disk formats, wiring, or the
brain.

## Alternatives considered

**A. Remember to test after releasing.** The prose-rule-without-a-Brake ADR-0050 exists to reject; it
failed within a day of ADR-0050 being written.

**B. Fresh-install proof only.** **This RFC's own first draft.** A clean-config install always resolves
newest, so it goes green in exactly the state that broke the operator. Recorded so it is not
re-proposed.

**C. A local-path (`./dir`) upgrade arm.** Unbuildable for its purpose: a directory source creates no
clone, so axis (a) has nothing to be stale **[probe]**. Also drafted, also wrong.

**D. Make `brief-skill.mjs` itself use the install path.** Conflates two failures — a red run would not
say whether the skill regressed or the packaging did — and destroys the fast inner-loop gate for
iterating on `SKILL.md`.

**E. Run the install-path L4 in CI as the Brake.** Needs live `claude` auth, is metered, and would put
the operator's credentials in CI. The record-checking gate is the right pattern.

**F. Assert on exit code / `is_error`.** Empirically broken: the stale arm exits `0` with
`is_error: false` **[probe]**.

**G. Predicate on the sentinel alone.** Unsafe: a tool-enabled agent can read `entries.jsonl` and emit
the sentinel even when the skill is absent. Hence the `sentinel AND haiku` conjunction.

**H. Predicate on `haiku` alone.** Non-discriminating: `brief-skill`'s contrast arm records
`haiku: true, sentinel: false` **[record]**.

## Consequences

- ADR-0050 — a *constitutional* ADR — is amended eleven days into its life. That is the system working:
  the rule was falsified by evidence and the amendment carries the evidence.
- A plugin version bump without a fresh install-**and-upgrade** proof becomes unmergeable, once the
  gate is fixed to recompute the verdict rather than trust a boolean.
- Releases cost 9 live agent sessions plus credential handling. Bounded, once per release.
- The scenario needs an authenticated `claude` in a container per ADR-0022 §8. This is the reason the
  L4 stays local and CI checks only the record.
- `vfkb doctor` gains its first `fail` about the *environment* rather than the brain. Consumers on a
  half-upgraded plugin start seeing red where they saw green. That is the point — but they will still
  see green when their clone is stale and they are offline.
- Fixing `doctor` to honor `CLAUDE_CONFIG_DIR` is a prerequisite and a standalone bug fix.
- Brain: gotcha `112f75187029` (restart ≠ update; `plugin update` scope default), fact `5e6f88502243`
  (the `CLAUDE_PLUGIN_ROOT` false alarm).

## Definition of Done

This RFC's build lands only when all of the following hold. Until then its honest status is
**"built, NOT yet verified."**

1. `scenarios/install-path.mjs` committed, with `fresh`, `upgrade`, `contrast` arms and **no**
   `--plugin-dir`.
2. Run for real: `fresh` ≥2/3, `upgrade` ≥2/3, `contrast` == 0/3; `scenarios/records/install-path.json`
   committed with `pluginVersion` equal to the released version.
3. `modelUsage` in the passing arms records the Haiku fork — observed, not asserted.
4. Credentials handled per ADR-0022 §8 (`claudeAiOauth` only, containerised, scrubbed in `finally`).
5. `release-gate.mjs` recomputes DEMONSTRATED from per-arm counts (does not trust `rec.demonstrated`),
   handles both record shapes, and `REQUIRED` includes `install-path`. **The Brake is seen going red**
   on a stale record and on a `demonstrated: true` record with a failing arm.
6. `doctor` honors `CLAUDE_CONFIG_DIR`; the axis-(b) check uses the two-hop manifest resolution and a
   semver compare, with deterministic unit tests that go red on a stale-registry fixture, on a
   `0.10.0`-vs-`0.9.0` fixture, and on a foreign-scope fixture.
7. ADR-0051 is committed; ADR-0050's status-pointer line — and nothing else in its body — records the
   amendment; CLAUDE.md's DoD section is updated to match.
