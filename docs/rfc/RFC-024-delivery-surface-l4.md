---
type: RFC
title: "RFC-024: The delivery surface is part of the surface — upgrade-path proof, a currency check, and a Brake"
description: "A capability can be DEMONSTRATED 3/3 and still be unreachable, because the L4 harness loads the plugin with --plugin-dir and bypasses distribution entirely. Worse, the failure is an UPGRADE failure that a fresh-install proof cannot reproduce, and `vfkb doctor` reports it as OK. Close all three: prove the upgrade path, make doctor compare currency, and require the record in the release-gate Brake."
status: "Proposed"
timestamp: 2026-07-09
---

# RFC-024: The delivery surface is part of the surface — upgrade-path proof, a currency check, and a Brake

- **Status:** Proposed
- **Date:** 2026-07-09
- **Deciders:** operator + Claude
- **Relates:** [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) (the constitutional DoD
  gate this RFC *extends*, not supersedes — its four clauses are unchanged; this RFC sharpens what
  "the real surface" means),
  [ADR-0029](../adr/ADR-0029-sandbox-proven-definition-of-done.md) (the DoD this descends from),
  [ADR-0022](../adr/ADR-0022-l4-evaluation-methodology.md) (≥2/3 DEMONSTRATED, can-fail arm),
  [ADR-0023](../adr/ADR-0023-scenario-contract-first.md) (scenario-contract-first),
  [ADR-0045](../adr/ADR-0045-vfkb-claude-code-plugin.md) (the plugin — the distribution mechanism
  whose path is currently unproven),
  [ADR-0030](../adr/ADR-0030-consumer-integration-and-distribution.md) / [ADR-0031](../adr/ADR-0031-bootstrap-engine-resolution-guard.md)
  (the *other* consumer population — bundle + `vfkb init` — which has its own upgrade story),
  [ADR-0048](../adr/ADR-0048-retire-wiring-smoke-gate.md) (**this RFC is that ADR's deferred item
  coming due** — ADR-0048 retired the in-repo wiring smoke gate and deferred host-level
  plugin-wiring validation to the plugin repo's release flow, "tracked, not silently dropped." It
  was never built, and the gap it left is the gap this incident fell through),
  [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md) / [RFC-023](RFC-023-session-start-briefing.md)
  (`/vfkb:brief`, the capability that exposed the gap).

## Context — an observed failure, one day after the Brake was built

On **2026-07-09**, hours after ADR-0050 made the L4 DoD constitutional and mechanically enforced,
the operator restarted Claude Code to use `/vfkb:brief` — the skill shipped in plugin v0.4.0, whose
L4 record says **DEMONSTRATED 3/3, Haiku fork observed in `modelUsage`, bound to `pluginVersion:
0.4.0`**. That record is real; its predicate was audited during this investigation and it is not an
asserted claim.

The operator got:

```
Unknown command: /vfkb:brief
```

Both facts held at once. The skill was proven, and the skill was unreachable.

### Root cause 1 — `--plugin-dir` is not the operator's surface

`scenarios/brief-skill.mjs` invokes the real surface *of the skill*:

```js
sh('claude', ['-p', '/vfkb:brief', '--plugin-dir', PLUGIN, ...])
```

`--plugin-dir` loads the plugin **directly from a source tree**, bypassing every step between a
merged commit and a running operator session:

| Step in the real chain | Exercised by `--plugin-dir`? |
| --- | --- |
| marketplace git clone is fetched / advanced | **no** |
| `marketplace.json` resolves the plugin entry | **no** |
| version lands in `plugins/cache/<mp>/<plugin>/<version>/` | **no** |
| `installed_plugins.json` records installPath + scope + sha | **no** |
| session resolves the *installed* plugin at startup | **no** |
| skill/agent/hook/MCP components register from it | partially |

The v0.4.0 L4 proved the last row and nothing above it. Running it a hundred more times would go
100/100 while the operator still gets `Unknown command`. **This is not a "more trials" problem.**

### Root cause 2 — the failure is an *upgrade* failure, and fresh-install proofs cannot see it

This is the subtler half, and it invalidates the obvious fix.

The operator's marketplace clone was pinned at `b0e6667` (v0.3.0 — one skill, zero agents) while the
plugin's `origin/main` was at `3aec82f` with `plugin/skills/brief/SKILL.md`. **A Claude Code restart
re-reads the cached install and never re-pulls the marketplace clone**, so no restart could have
produced the command. (Brain gotcha `112f75187029`.)

A scenario that installs into a clean `CLAUDE_CONFIG_DIR` **always resolves the newest version** and
therefore goes green regardless. A fresh-install proof is structurally incapable of reproducing this
bug. The proof must traverse **old install → documented upgrade procedure → new capability**.

There are two independent staleness axes, and they fail differently:

| axis | what is stale | detectable offline? | bit the operator? |
| --- | --- | --- | --- |
| **(a)** marketplace clone behind its remote | the *source* never advanced | **no** — needs `git fetch` | **yes** |
| **(b)** install behind the clone | clone advanced, `plugin update` didn't | **yes** — compare `installed_plugins.json` vs the clone's `plugin.json` | latent |

Axis (b) is not hypothetical: `claude plugin update <p>@<mp>` **defaults to `--scope user` and
hard-fails on a project-scope install** with `Plugin "vfkb" is not installed at scope user`. Run the
documented upgrade, miss the scope flag, and you land in (b) with a fresh clone and a stale plugin.

### Root cause 3 — `vfkb doctor` reports the broken state as OK

`src/doctor.ts:200-206` reads the installed version and explicitly declines to judge it:

```ts
// 5c. Plugin install state (best-effort, informational; ADR-0045). Doctor cannot
// compare the vendored engine's currency — the version is reported as information,
// never as "up to date".
add('plugin', 'ok', `${plugin.key} installed, version ${plugin.installed.version} (informational — currency not compared)`);
```

Observed on the live repo today:

```
OK    plugin — vfkb@vfkb installed, version 0.4.0 (informational — currency not compared)
```

Yesterday that same line read `version 0.3.0`, still prefixed `OK`. **The one tool whose job is "is
my wiring healthy?" looked directly at the stale install and passed it.** `detectPluginWiring()`
already parses the registry and holds the version — the comparison was simply never made.

### The trap that makes this class of bug invisible

Reproduced hermetically during this investigation (isolated `CLAUDE_CONFIG_DIR`, a marketplace
pinned at the v0.3.0 commit, same sandbox and sentinel as the wired arm):

| | wired arm (real install, v0.4.0) | stale arm (v0.3.0) |
| --- | --- | --- |
| sentinel in result text | **true** | false |
| `modelUsage` | `claude-haiku-4-5-20251001` | `[]` |
| result text | the five-section brief | `Unknown command: /vfkb:brief` |
| `is_error` | false | **false** |
| process exit code | 0 | **0** |

**A session that cannot find the command exits zero and reports `is_error: false`.** The harness
considers "I told the user the command doesn't exist" a successful turn — and from its point of view
it is. Any gate keyed on exit status, `is_error`, or "did it crash" passes the broken install
silently. **Only a content predicate over the result text catches it.** Same lesson as ADR-0022's
can-fail clause, one layer lower: the proof must fail *the way the real bug fails*, and this bug
fails quietly and successfully.

## Problem statement

ADR-0050 requires a capability be proven "through the real surface … observed not asserted." *Surface*
was read as **the surface of the capability**. The incident shows it must also mean **the surface by
which the capability arrives**, and — for the population that already has vfkb — **the path by which
it is upgraded**.

A capability the user cannot receive is not shipped. A capability that only *new* users receive is not
shipped either.

## Proposal

Four parts. Part 2 is the only substantial new build; part 3 is a one-line change.

### 1. `vfkb doctor` compares currency (vfkb, engine)

Turn the informational line into a real check. Two checks, matching the two axes:

- **(b), deterministic, offline, always run.** Resolve the marketplace clone for the enabled
  `vfkb@<mp>` key (`~/.claude/plugins/marketplaces/<mp>/`), read the plugin source's
  `plugin.json.version`, and compare to `installed_plugins.json`'s installed version for this root.
  If installed < available → **`fail`**, with the exact remediation, scope included:
  `claude plugin update vfkb@vfkb --scope project`. This is a unit-testable pure function over two
  JSON blobs, so it is an inner-gate deterministic test, not an L4.
- **(a), best-effort, network, opt-in.** `vfkb doctor --check-remote` runs `git -C <clone> fetch` and
  compares clone `HEAD` to `origin/<default>`. Behind → **`warn`** with
  `claude plugin marketplace update <mp>`. Offline or unfetchable → `skip`, never `fail`. Doctor must
  stay useful on a plane.

Doctor is **advisory**, not a Brake — it is the consumer-facing detector. Its value is that an
existing project can now *ask* and get a true answer, which today it cannot.

For **bundle consumers** (ADR-0030/0031, `$VFKB_BUNDLE_DIR`): the engine already carries
`ENGINE_VERSION` / `ENGINE_COMMIT` (`src/version.ts`, surfaced at `doctor.ts:91`). There is no
registry to compare against, so currency is genuinely unanswerable offline for this population.
Honest scope for this RFC: report `ENGINE_COMMIT` and, under `--check-remote`, compare it to the
vfkb repo's `origin/main` sha via the GitHub API when reachable. Anything more (a version manifest, a
release channel) is a separate RFC and is **not** proposed here.

### 2. An `install-path` L4 with an *upgrade* arm (vfkb-claude-plugin)

A new committed scenario, `scenarios/install-path.mjs`, proving one user-facing capability through
the operator's own chain — **no `--plugin-dir` anywhere in it**. Three arms:

- **`fresh`** — `claude plugin marketplace add <src>` → `claude plugin install vfkb@vfkb
  --scope project` → capability **present**. Proves the chain.
- **`upgrade`** *(the arm that would have caught this bug)* — marketplace source checked out at the
  **previous release**; add + install; assert the capability is **absent**; then run the *documented*
  upgrade verbatim — `claude plugin marketplace update <mp>` then
  `claude plugin update vfkb@vfkb --scope project` — and assert the capability is now **present**.
  Encodes both traps: the clone must advance (axis a) and the scope flag must be right (axis b).
- **`contrast`** *(can-fail)* — marketplace source is a copy of the plugin with `skills/brief/`
  **removed**; assert the capability is **absent**. Deriving contrast by deleting the skill, rather
  than pinning a historical commit like `b0e6667`, keeps the arm version-agnostic as the plugin
  evolves.

Mechanism, each step executed during this investigation rather than assumed:

- **Isolation.** `CLAUDE_CONFIG_DIR=<tmp>` fully isolates plugin state — a fresh dir reports
  `No marketplaces configured` and gets its own `.claude.json`; the host install is untouched
  (verified: host stayed `0.4.0`/`project` throughout).
- **Install headlessly.** `marketplace add <path>` and `install <p>@<mp>` both succeed against a
  local source. `marketplace update` advances the clone. `plugin details <p>@<mp>` prints the
  component inventory (`Skills (2) brief, vfkb` / `Agents (1) briefer` on v0.4.0;
  `Skills (1) vfkb` / `Agents (0)` on v0.3.0) — a cheap structural pre-check before the metered run.
- **Auth.** A live `claude -p` run needs credentials and the isolated config dir does not inherit
  them. The scenario copies `~/.claude/.credentials.json` into the sandbox config dir (mode `600`)
  and **must delete it in a `finally`, including on failure**. This is why the L4 cannot run in CI
  (see part 3).
- **Predicate.** Seed the sandbox brain with a handoff fact carrying a **sentinel codename** that
  exists nowhere on disk outside `entries.jsonl`. Run `claude -p '/vfkb:brief' --output-format json
  --model claude-sonnet-5 --strict-mcp-config --dangerously-skip-permissions`. Assert the sentinel
  appears in `result`, and that `modelUsage` contains a `haiku` model (outer model pinned non-Haiku,
  so Haiku can only be the fork). Assert **not** on exit code and **not** on `is_error` — both are
  `0`/`false` in the broken arm.
- **Record.** `scenarios/records/install-path.json`, same shape as `brief-skill.json`. DEMONSTRATED
  per ADR-0022 = `fresh` and `upgrade` each ≥2/3, both strictly greater than `contrast`.

Both the wired and the stale arms were prototyped once and behaved exactly as tabulated above, so the
scenario is known-constructible before it is written — GREEN and RED both observed.

### 3. Wire it into the Brake (vfkb-claude-plugin)

`scenarios/release-gate.mjs` already has the right architecture: it does **not** run the metered L4s
(they need auth); it verifies committed evidence — record exists, `demonstrated === true`, and
`record.pluginVersion === plugin.json.version`, so a version bump without a re-run goes red with no
API access in CI. The change is one line:

```js
const REQUIRED = ['brief-skill', 'install-path'];
```

`release-gate` is already a **required status check** on the plugin's `main` (verified:
`gh api repos/vilosource/vfkb-claude-plugin/branches/main/protection` → `["release-gate"]`). So this
makes it mechanically impossible to bump the plugin version without a fresh, DEMONSTRATED,
version-bound proof that the plugin can be **installed, upgraded into, and used**.

### 4. Sharpen the doctrine (vfkb — ADR + CLAUDE.md)

Amend CLAUDE.md's DoD "proof fits the capability" list with a row, and ADR-0050's "real surface"
clause with a definition. This also **closes the item ADR-0048 deferred**: host-level plugin-wiring
validation now has an owner (the plugin repo's `install-path` scenario) and a Brake (`release-gate`),
rather than a tracking note.

> **Delivery is a capability, and upgrade is a distinct capability from install.** For anything
> distributed to a user — a plugin, a bundle, an installable — the DoD proof must traverse the
> **delivery surface**: the artifact is installed *by the mechanism the user installs it by*, in an
> isolated environment, and then exercised. Where existing installations exist, the proof must also
> traverse the **upgrade surface**: an installation of the *previous* release, advanced by the
> *documented upgrade procedure*, and then exercised. A proof that hands the artifact to the agent
> directly (`--plugin-dir`, a local `import`, a vendored path, `PYTHONPATH=`) proves the capability
> and **not** its delivery, and may not be cited as satisfying the gate for a release. A proof that
> installs into a clean environment proves delivery and **not** upgrade.
>
> **Corollary — the quiet-success trap.** Where the delivery failure mode is a *successful* run that
> merely lacks the capability (exit 0, `is_error: false`, "Unknown command"), the scenario predicate
> MUST be a content assertion over the output. Exit status and error flags are not admissible
> evidence of delivery.

**Scope discipline.** This does **not** mean every capability needs an install-path L4 — a per-feature
tax for a per-release risk. Delivery and upgrade are proven **once per release**, by a single canary
capability that traverses the full chain. If the plugin installs, upgrades, and one skill works from
the installed copy, the chain is sound; every other capability's L4 then legitimately tests the
capability rather than the chain.

## Existing projects — how they get upgraded

The question this RFC must answer for the installed base, not just for the next release.

**Population 1 — plugin consumers (ADR-0045).** Upgrade is two commands, and neither is a restart:

```
claude plugin marketplace update <marketplace>      # axis (a): advance the clone
claude plugin update <plugin>@<mp> --scope project  # axis (b): advance the install
# then restart Claude Code to apply
```

`--scope` must match the install (`claude plugin list` / `installed_plugins.json` shows it); the
default is `user` and it hard-fails on a project-scope install. After part 1 lands, `vfkb doctor`
**fails loudly** on axis (b) and warns on axis (a) under `--check-remote`, so an existing project can
discover it is stale instead of silently running old code. That is the upgrade story: **doctor is the
detector, the two commands are the remedy, and the `upgrade` arm of the L4 proves the remedy works.**

**Population 2 — bundle consumers (ADR-0030/0031, `vfkb init` + `$VFKB_BUNDLE_DIR`).** Upgrade is a
refresh of the bundles directory (rebuild from vfkb `main`, or re-copy). Nothing in the wiring pins a
version, so upgrade is inherently safe but also inherently *invisible*. Part 1 gives them
`ENGINE_COMMIT` reporting and an opt-in remote comparison; a first-class release channel for this
population is explicitly **out of scope** and left to a future RFC, to be triggered by evidence
(a consumer actually running a stale bundle) rather than built on spec, per the evidence-gated rule.

**No migration is required of either population.** Nothing in this RFC changes on-disk formats,
wiring, or the brain. It adds a check, a scenario, and a gate.

## Alternatives considered

**A. Just remember to test after releasing.** Precisely the prose-rule-without-a-Brake that ADR-0050
exists to reject; it failed within one day of ADR-0050 being written. Rejected on vfkb's own doctrine.

**B. Fresh-install proof only (no upgrade arm).** This was this RFC's own first draft, and it is
wrong: a clean-config install always resolves the newest version, so it goes green in exactly the
state that broke the operator. Recorded so it is not re-proposed.

**C. Make `brief-skill.mjs` itself use the install path.** One scenario instead of two, but it
conflates two failures — when it goes red you would not know whether the skill regressed or the
packaging did. The source-tree skill L4 is also the fast inner-loop gate while iterating on
`SKILL.md`. Keep them separate: `brief-skill` tests the skill, `install-path` tests the chain.

**D. Run the install-path L4 in CI as the Brake.** Not viable: needs live `claude` auth, is metered,
and would put the operator's credentials in CI. The existing evidence-checking gate (record + version
binding) is the right pattern and is already proven.

**E. Assert on exit code / `is_error`.** Empirically broken — the stale arm exits `0` with
`is_error: false`. Recorded so it is never re-proposed.

**F. Have doctor compare the install against the *local clone* only.** Catches axis (b), misses axis
(a) — and axis (a) is what actually bit the operator, since the clone itself was stale. Necessary,
not sufficient; hence the two-check design in part 1.

## Consequences

- A plugin version bump without a fresh install-**and-upgrade** proof becomes impossible to merge
  (required check), not merely discouraged.
- Releases cost one additional metered L4 (three arms × N trials). Bounded, once per release, not per
  feature.
- The scenario copies the operator's credentials into a sandbox config dir. This is real secret
  handling: `try/finally` scrub, mode `600`, and it must be reviewed when the scenario lands. It is
  also the reason the L4 stays local and CI checks only the record.
- `vfkb doctor` gains its first **`fail`** that is about the *environment* rather than the brain.
  Consumers on a stale plugin will start seeing red where they saw green. That is the point.
- `--plugin-dir` remains correct for the inner loop; it is now explicitly **not** admissible as
  release evidence.
- Brain entries from the incident: gotcha `112f75187029` (restart ≠ update; `plugin update` scope
  default), fact `5e6f88502243` (the `CLAUDE_PLUGIN_ROOT` false alarm chased down en route).

## Definition of Done for this RFC

Per ADR-0050, this RFC's own build lands only when:

1. `scenarios/install-path.mjs` exists in vfkb-claude-plugin, committed, with `fresh`, `upgrade`, and
   `contrast` arms.
2. It has been run for real: `fresh` and `upgrade` each ≥2/3, `contrast` strictly lower, and
   `scenarios/records/install-path.json` committed with `demonstrated: true` and `pluginVersion`
   equal to the released version.
3. `modelUsage` in the passing arms records the Haiku fork — observed, not asserted.
4. `REQUIRED` includes `install-path`, and a negative check confirms the gate goes **red** when the
   record is stale or absent — **the Brake itself must be seen failing.**
5. `vfkb doctor`'s axis-(b) currency check has a deterministic unit test that goes red on a stale
   registry fixture.
6. Until all five hold, the honest status of this work is **"built, NOT yet verified."**
