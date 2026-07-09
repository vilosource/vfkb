---
type: RFC
title: "RFC-024: Staleness detection and delivery honesty — amend ADR-0050's `--plugin-dir` clause, build the detector and its L4, fix the Brake, gate the install proof"
description: "Plugin v0.4.0 was DEMONSTRATED 3/3 and unreachable. The packaging was fine; the operator's clone was stale, and nothing could tell him. A release-time install L4 would have gone green that day. What is missing is a stale-clone detector in `vfkb doctor` (with its own agent-driven L4), deterministic backstops in the plugin's release gate, and an ADR-0050 that stops calling `--plugin-dir` a real surface. One constitutional question — may an unproven delivery path ship? — was extracted, put to the operator, and ratified: yes, provided the gap is named, with the disclosure enforced by a CI Brake rather than left to prose."
status: "Proposed"
timestamp: 2026-07-09
---

# RFC-024: Staleness detection and delivery honesty

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
  decision one wishes to *"**refine** it without replacing (the original still holds, evidence or scope
  changed)"* — and notes *"the only permitted edit to a decided ADR is this one-line status pointer."*
  Precedent: **ADR-0016 amends ADR-0012**; **ADR-0024 amends ADR-0021**. ADR-0048 supplies the *test*,
  not the precedent: its §"Why supersede, not amend" holds supersede is for a mandate *withdrawn
  entirely* (as ADR-0048 did to ADR-0028), amend for a decision that still holds with changed scope or
  evidence. ADR-0050's mandate — the non-negotiable L4 gate — **stands in full**; one illustrative
  example inside it is wrong. Amend is the honest label. On acceptance this becomes **ADR-0051**;
  ADR-0050's body stays untouched and only its status-pointer line gains *"Amended by ADR-0051."*

  [ADR-0029](../adr/ADR-0029-sandbox-proven-definition-of-done.md) (the DoD; §5 proof-form-fits-the-capability;
  its Alternatives reject a unit-tests-only DoD),
  [ADR-0022](../adr/ADR-0022-l4-evaluation-methodology.md) (≥2/3 DEMONSTRATED; §8 credential handling —
  which this RFC's own probes violated, see Disclosure),
  [ADR-0023](../adr/ADR-0023-scenario-contract-first.md),
  [ADR-0045](../adr/ADR-0045-vfkb-claude-code-plugin.md) (the distribution mechanism),
  [ADR-0030](../adr/ADR-0030-consumer-integration-and-distribution.md) /
  [ADR-0031](../adr/ADR-0031-bootstrap-engine-resolution-guard.md) (the bundle consumer population),
  [ADR-0048](../adr/ADR-0048-retire-wiring-smoke-gate.md) (its deferred `hooks.json` item stays open),
  [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md) / [RFC-023](RFC-023-session-start-briefing.md)
  (`/vfkb:brief`, the capability that exposed the gap).

## Repos, and where each artifact lands

The one committed `[record]` cited below **does not exist in this repo.** ADR-0051 will live in vfkb
while half its Definition of Done is discharged in vfkb-claude-plugin. That split is a real audit
limitation — disclosed rather than hidden — and the plugin-side items must be mirrored in that repo's
tracking issue.

| Path | Repo |
| --- | --- |
| `src/doctor.ts`, `scenarios/doctor-staleness.mjs`, `docs/**` | **vfkb** (this repo) |
| `scenarios/brief-skill.mjs`, `scenarios/release-gate.mjs`, `scenarios/records/brief-skill.json` | **vfkb-claude-plugin** |

## Evidence status

Every mechanical claim below was executed on 2026-07-09. **None of it is a committed L4 record.** Per
`CLAUDE.md:159` — *"A smoke check (N=1, no committed record) is NOT this gate"* (ADR-0050 says it
differently, at line 26: *"1-trial smoke check with no committed scenario or record"*) — these are
**single-run, unrecorded probe observations**, labelled **[probe]**: enough to establish mechanism,
never enough to declare anything done. The one committed artifact cited is
`scenarios/records/brief-skill.json`, labelled **[record]**.

## Context — what actually happened

Hours after ADR-0050 made the L4 DoD constitutional, the operator restarted Claude Code to use
`/vfkb:brief`, shipped in plugin v0.4.0. Its record says `demonstrated: true`, `wired: 3/3`,
`pluginVersion: "0.4.0"`, with `claude-haiku-4-5-20251001` in every wired arm's `models` **[record]**.
That record is real; its predicate was audited.

The operator got `Unknown command: /vfkb:brief`.

**The proximate cause was staleness, not packaging.** The marketplace clone was pinned at `b0e6667`
(v0.3.0 — `Skills (1)`, `Agents (0)`) while `origin/main` was `3aec82f` **[probe]**. **A Claude Code restart
re-reads the cached install and never re-pulls the clone** **[probe]**. (Brain gotcha `112f75187029`, recorded on branch `chore/brain-plugin-update-gotchas` — **PR #100, not yet merged**; it is not resolvable from this branch.) Compounding
it, `claude plugin update` defaults to `--scope user` (per `--help`) and fails on a project-scope
install **[probe]**.

**The packaging was never broken.** At `3aec82f`, `plugin/skills/brief/SKILL.md`,
`plugin/agents/briefer.md`, a `plugin.json` reading `0.4.0`, and both vendored bundles are all present
**[probe]**. A fresh install at release time would have found everything it needed. This single fact
kills the obvious remedy — see "The fix that does not work."

### Root cause 2 — nothing could tell the operator he was stale

`src/doctor.ts:200-206` reads the installed version and declines to judge it. The quoted words are
verbatim, but the excerpt is **not contiguous**: a leading clause (`// 5c. Plugin install state
(best-effort, informational; ADR-0045).`), a trailing sentence, and two guard conditions are elided.

```ts
// … Doctor cannot compare the vendored engine's currency — the version is
// reported as information, never as "up to date". …
add('plugin', 'ok', `${plugin.key} installed, version ${plugin.installed.version} (informational — currency not compared)`);
```

Live today **[probe]**: `OK plugin — vfkb@vfkb installed, version 0.4.0 (informational — currency not
compared)`. Yesterday the same line read `0.3.0`, still prefixed `OK`. **The one tool whose job is "is
my wiring healthy?" looked at the stale install and passed it.**

### Root cause 3 — delivery has never been proven, by construction

`scenarios/brief-skill.mjs:71` (vfkb-claude-plugin) invokes `claude -p '/vfkb:brief' --plugin-dir <src>`
**[probe]**. This is not a
corner cut; it is what ADR-0050 line 64 instructs. `--plugin-dir` loads from a source tree, bypassing
the marketplace clone, `marketplace.json` resolution (`source: "./plugin"`), the version cache,
`installed_plugins.json`, scope, and startup resolution. **We have no evidence, ever, that the plugin
installs.** That is a latent gap the incident *revealed*. It is not what broke.

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
stale. A release-time gate runs in CI, before any consumer exists; it cannot observe a future
consumer's clone. It would buy, for twelve metered sessions per release, a gate that misses the bug that motivated it. The
decisive objection is not cost but evidence: **no delivery defect has ever been observed**, and
CLAUDE.md's evidence-gated rule says do not build for one. CLAUDE.md:143 — *"Deterministic backstop >
probabilistic gate"* — points the same way: part 2b's free structural check first.

The L4 is therefore **gated, not built** (part 4). An earlier draft justified this partly on a
"version-binding deadlock" — the claim that `marketplace add` cannot pin a ref. **That claim was
false.** `marketplace add owner/repo@ref` parses and records `{"source":"github","repo":…,"ref":…}`;
the `okf-skill` marketplace already uses it **[probe]**. Ref-pinning works, so a pre-merge record bound
to an unreleased version *is* constructible. The gating rests on the surviving reasons, not on that one.

## Proposal

### 1. `vfkb doctor` detects a stale clone — the only part that addresses the incident *(vfkb)*

**One axis, not two.** Compare the marketplace clone's `HEAD` to its remote default branch with
**`git ls-remote`** — read-only. Behind → **`warn`**, naming the two remedy commands. Offline,
unreachable, or a `directory`-source marketplace (which has no clone and no remote **[probe]**) →
`skip`, never `fail`. Attempted by default with a short timeout: a detector nobody runs detects nothing.

`git fetch` is **rejected**: it mutates the user's clone (writes refs and objects; github sources are
shallow, so a correct fetch may need `--unshallow`) and can contend on the repo lock with a running
Claude Code. A diagnostic must not write.

**What an earlier draft also proposed, and this one gates.** A second, offline "axis (b)" comparing the
*installed* version to the version the clone *offers* (a two-hop lookup:
`known_marketplaces.json[<mp>].installLocation` → `.claude-plugin/marketplace.json` → the plugin entry's
`source` → `<source>/.claude-plugin/plugin.json`; there is **no** `plugin.json` at the clone root
**[probe]**). It is dropped from this RFC for two reasons that took three review rounds to see:

1. **It is a user-facing capability targeting a defect nobody has observed.** In the operator's failure
   the clone itself was stale, so `installed == offered == 0.3.0` and axis (b) **would have passed
   clean.** It fires only for a *half-upgraded* install, reachable via the `--scope user` trap — a
   mechanism argument, not an instance. (The qualifier matters: part 2b's structural check also targets
   an unobserved defect, but it is a CI-time inner-gate test, not a user-facing capability. Reason 2 is
   what actually separates them.)
2. **It emits a user-facing `fail`**, so by this RFC's own reading of ADR-0050 it would need its own
   agent-driven L4 — which is not free, so "it's cheap and deterministic" does not excuse it.

Gated. Trigger: someone actually lands in the half-upgraded state. The two-hop resolution and the
semver/foreign-install traps below are recorded so the eventual builder does not rediscover them.

**Reach.** The check fires only when the operator runs `vfkb doctor`. Someone who restarts and never runs
it sees the same silent failure. A proactive `SessionStart` check is alternative H, deferred. *Offline,
vfkb cannot tell you that you are running old code*, and doctor's output must say so rather than imply
health.

Correctness requirements, each a defect found in review:

- **Honor `CLAUDE_CONFIG_DIR`.** `doctor.ts:98-99` derives the registry from `env.HOME` alone
  **[probe]**; Claude Code relocates the whole config, `plugins/` included. Standalone bug; prerequisite.
- **Resolve the clone from `known_marketplaces.json[<mp>].installLocation`**, never a hardcoded
  `~/.claude/plugins/marketplaces/<mp>`.
- **Never report a foreign install.** `findInstall()` falls back to any `scope: 'user'` entry.
- **Never use `claude plugin details` to learn the installed version.** It reports the version the
  *marketplace offers*: after advancing a directory-source marketplace, `details` printed `0.4.0` while
  `plugin update` simultaneously said *"updated from 0.3.0 to 0.4.0"* **[probe]**. Read
  `installed_plugins.json`.
- *(Gated with axis (b): semver compare — `"0.10.0" < "0.9.0"` is `true` lexicographically.)*

**Proof form — this capability gets an L4, not an exemption.** `vfkb doctor` is user-facing, so
ADR-0050's gate binds (*"anything a user will use"*), and ADR-0029's Alternatives **explicitly reject** a
unit-tests-only DoD: *"unit tests prove the parts, not that the capability works in its real use-case."*
Unit tests remain the inner gate (ADR-0029 §5: structural invariants *"stay deterministic unit tests …
the inner gate, not the capability-level success criterion"*). The capability-level proof is a new
agent-driven scenario, **`scenarios/doctor-staleness.mjs`**.

**Substrate: a host-level tmpdir sandbox, offline, with hand-built fixtures.** ADR-0022's
container-with-egress-allowlist (decision #1/#4) governs the `l4-purpose` harness; **eight of vfkb's
nine scenarios spawn no container at all** — only `l4-purpose.mjs` does **[probe]** — and this one
follows that in-repo precedent.
It must **not** clone from GitHub: an earlier draft's arm did, which needs SSH keys and network egress
that ADR-0022's model forbids, and which would make the "current" arm depend on live `origin/main` —
destroying reproducibility. Instead the scenario builds its own fixtures, which is possible because doctor reads registry JSON and
(after this RFC — it shells no git today **[probe]**) will invoke only `git ls-remote`:

- a **local bare repo** as the marketplace's `origin`, with two commits;
- a clone of it, plus a `known_marketplaces.json` naming that clone as `installLocation`, plus an
  `installed_plugins.json`. No `claude plugin` CLI, no GitHub, no network, no credentials beyond the
  agent's own model API.

Because nothing is installed into the sandbox, **the plugin's own hooks never fire there** — so the
`SessionEnd` auto-commit hazard that afflicts the gated `install-path` design does not apply here.

- **wired arm** — clone parked one commit behind the bare repo's `main`. An agent is asked *"am I running
  the current plugin?"*, runs `vfkb doctor`, and must report **stale** and name the remedy commands.
- **contrast arm (can-fail)** — identical, clone at `main`. The agent must report **current**.

Two arms, so ADR-0022's DEMONSTRATED rule applies **unchanged**. Six sessions. No `--plugin-dir`, no
plugin-release coupling, no network. It is the **only** proposed proof that reproduces the operator's
actual failure.

**Bundle consumers (ADR-0030/0031) are out of scope.** The engine carries `ENGINE_VERSION` /
`ENGINE_COMMIT` (`doctor.ts:91`) but no registry exists to compare against. No bundle consumer has been
*observed* running stale, so per CLAUDE.md's evidence-gated rule it is **gated**. Trigger: an observed
stale-bundle consumer.

### 2. Deterministic backstops in the plugin's release gate *(vfkb-claude-plugin)*

No LLM, no auth, CI-safe. These are structural invariants, so per ADR-0029 §5 their proof form is
deterministic tests — the inner gate — and they carry no L4.

**2a. The gate must stop trusting a self-asserted boolean.** `scenarios/release-gate.mjs` reads
`rec.demonstrated`, `rec.pluginVersion`, and prints `rec.wired`/`rec.trials`. A record with
`demonstrated: true` and `wired: 1/3` **passes** **[probe]**. The gate enforces version-binding, not the
criterion. Fix: recompute the verdict from per-arm counts. `brief-skill.json` already uses `arms` for
*arrays of trial objects*, so this is a **breaking shape change**; migrate the record and the gate in one
PR, which leaves no red window since both land together:

```jsonc
{ "scenario": "brief-skill", "pluginVersion": "0.5.0", "trials": 3,
  "arms": { "wired":    { "role": "positive", "passed": 3 },
            "contrast": { "role": "contrast", "passed": 0 } } }
```

Verdict, recomputed and never read from the record. ADR-0022:72 constrains only the contrast
(*"`demonstrated` requires the contrast to hold on **≥2/3**"*); the positive threshold below formalizes
what "demonstrated" has always meant in practice, and for `trials=3` the two agree: **every `positive` arm ≥ ⌈2·trials/3⌉ and every `contrast`
arm ≤ ⌊trials/3⌋.** An earlier draft wrote `contrast == 0`, which is *stricter* than ADR-0022 — a silent
tightening of a rule this RFC claims not to touch. It does not.

**2b. A structural packaging check.** Assert every component the plugin *declares* exists in the tree
that ships: each `skills/<name>/SKILL.md`; each `agents/<name>.md` named by a skill's `agent:`
frontmatter; `hooks/hooks.json` parses; `.mcp.json` parses; vendored bundles exist and are non-empty. It
catches "released without the skill" at zero cost, in CI, on every PR. It **would not** have caught the
motivating bug — the packaging was fine — and it does **not** prove the plugin installs. Nothing
deterministic can. It is a structural invariant, so ADR-0029 §5 routes its proof to deterministic tests and it carries no
L4 — an inner-gate test, not a speculative build. It is the backstop CLAUDE.md:143 demands *before*
reaching for a probabilistic gate.

`release-gate` is already a required status check on the plugin's `main` (`gh api
…/branches/main/protection` → `["release-gate"]`) **[probe]**.

### 3. Amend ADR-0050 *(vfkb)* — this RFC becomes ADR-0051

ADR-0050's body is **not edited** (ADR-0001). ADR-0051 states:

> **Amends ADR-0050.** Strike `--plugin-dir` as an example of "the real surface a user will use." A
> plugin loaded with `--plugin-dir` is a *development* surface: it proves the capability and **not** its
> delivery. It remains correct for the inner loop and for per-capability L4s. It may not be cited as
> evidence that a plugin **installs**.
>
> **Delivery and upgrade are capabilities, distinct from the capabilities they carry.** Neither is
> currently proven for this plugin.
>
> **ADR-0050's "declared done or shipped" governs claims, not existence** (operator ruling, 2026-07-09;
> Reading B). Delivery was never *claimed* proven, so releases may continue — but **the violation is
> silence.** Every release note, ADR, and handoff MUST state that **delivery is unproven** until a
> delivery proof exists, and that disclosure MUST be enforced by the release-gate Brake, never left to
> prose. This relaxes a rule marked non-negotiable; it is relaxed by explicit ruling, on the record.
>
> **Corollary — the quiet-success trap.** Where a delivery failure presents as a *successful* run lacking
> the capability (exit 0, `is_error: false`, "Unknown command"), the predicate MUST be a content assertion
> over the output. Exit status and error flags are not admissible evidence of delivery.
>
> **Corollary — a release-time gate cannot observe a consumer's stale clone.** *Scoped narrowly, and
> deliberately so:* CI runs before any consumer exists, so no release gate can detect that a particular
> consumer's marketplace clone never advanced. That specific failure mode is a **detection** problem,
> owned by `vfkb doctor`. This says nothing about other delivery defects — packaging omissions, install
> failures, upgrade corruption — which a delivery gate *can* catch and for which one should be built when
> evidence warrants.

This RFC does **not** amend ADR-0022. Its ≥2/3 single-contrast rule is untouched: the two-arm
`doctor-staleness` scenario fits it exactly, and the three-arm scenario that would have extended it is
gated below.

### 4. The `install-path` L4 — designed, **gated**, not built *(vfkb-claude-plugin)*

Per CLAUDE.md's evidence-gated rule (*"Don't build speculatively"*), the
delivery L4 is **specified and parked**.

**Trigger:** a delivery or upgrade defect that 2b's structural check cannot see — the plugin installs but
fails to load; a hook path breaks only under the installed layout; an upgrade leaves a mixed-version
cache. Or an explicit operator request.

**Prerequisite:** `claude plugin tag` adopted, so "the previous release" is resolvable. The plugin repo
has **zero git tags** **[probe]**; releases are untagged merge commits, and a hardcoded SHA rots at the
next release. *(Ref-pinning is **not** a blocker — `marketplace add owner/repo@ref` works **[probe]**.)*

**Design, and the traps found while probing it** — recorded so the eventual builder does not rediscover
them at cost:

- Arms: `fresh` (install from marketplace → capability present), `upgrade` (install previous release →
  absent → `marketplace update` → `plugin update --scope project` → present), `contrast` (capability
  removed → absent).
- A **directory** source records `{source: "directory", installLocation: <the path itself>}` and creates
  **no clone** — it cannot model a stale clone **[probe]**. `file://…` is **rejected** *("Invalid
  marketplace source format. Try: owner/repo, https://..., or ./path")* **[probe]**. A **github** source
  clones **shallowly**, so rewinding needs `git fetch --unshallow` first **[probe]**.
- `claude plugin install --scope project` works headlessly but needs a project dir containing
  `.claude/settings.json`; installing at project scope **auto-writes** `enabledPlugins` **[probe]**.
- `plugin update` prints *"Restart to apply changes."* Whether a fresh `claude -p` suffices as that
  restart is **unobserved**; post-update on-disk state (`installed_plugins.json` → `0.4.0`, cache dir
  containing `brief`) suggests yes **[probe]**. The design's least-evidenced step.
- The `contrast` arm must delete **both** `skills/brief/` and `agents/briefer.md`. Deleting only the skill
  leaves the Haiku briefer agent installed and `Task`-spawnable, able to forge a `haiku` entry in
  `modelUsage`.
- Predicate: sentinel in `result` **and** a `haiku` model in `modelUsage`. `haiku` alone does not
  discriminate — `brief-skill.json`'s contrast arm records `haiku: true, sentinel: false` **[record]**.
  The observed capability-absent case produced `modelUsage: []` and no model turn at all, so the sentinel
  may suffice; the conjunction is cheap insurance against a harness that starts running a turn. Assert
  **neither** exit code **nor** `is_error`.
- **The plugin's own hooks fire inside every arm.** `SessionEnd` auto-commits `.vfkb/entries.jsonl` and
  may write a B2 auto-handoff `fact`; it returns `on-default-branch` and no-ops *before* both, so the
  sandbox must stay on the default branch (`src/session-end.ts`). The `upgrade` arm's two runs **share one
  mutable brain**: the pre-run can perturb the post-run's predicate.
- Credentials MUST follow ADR-0022 §8: `claudeAiOauth` only, containerised, scrubbed in a `finally`.
- Cost estimate: `3×1 (fresh) + 3×2 (upgrade, pre+post) + 3×1 (contrast)` ≈ **12 live sessions** per
  release.

## The constitutional question — put to the operator, and answered

An earlier draft settled this quietly inside the `--plugin-dir` amendment. It should not have; the
question is constitutional. It was therefore extracted, put to the operator explicitly, and **ratified
on 2026-07-09**.

**ADR-0050:44 says: *"No user-facing capability may be declared done or shipped without a full
sandboxed, agent-driven L4."*** Installing and upgrading the plugin is something users do. By this
RFC's own analysis, delivery has **no** L4 and never has. Two readings follow, and ADR-0050's text does
not choose between them:

| | Reading A — binds literally | **Reading B — governs claims** ✅ |
| --- | --- | --- |
| Next plugin release | **blocked** | allowed |
| Precondition | `install-path` L4 DEMONSTRATED | every release note, ADR and handoff names the gap |
| Unblocking cost | adopt `claude plugin tag` (repo has **zero tags** **[probe]**), then ~12 metered sessions | a disclosure, mechanically enforced |
| Risk accepted | a release freeze over a defect class never observed | delivery stays unproven; we rely on disclosure holding |
| Precedent | — | ADR-0048 / vfkb-claude-plugin#6 (`hooks.json` gap: shipped, named, open) |

**Operator ruling (2026-07-09): Reading B.** "Or shipped" governs *claims*, not existence. Delivery was
never claimed proven; **the violation is silence.** Releases continue, and the gap must be named
everywhere delivery is described. This is recorded as a decision in the brain, not merely in prose.

**This is a weakening of a rule marked non-negotiable, and it is recorded as such.** The amend
precedents cited above (ADR-0016→0012, ADR-0024→0021) are ordinary ADRs; none establishes that a
*constitutional* non-negotiable may be relaxed through the ordinary amend mechanism. This one is
relaxed by explicit operator ruling, on the record, with the reasoning above — not by inference, and
not silently.

### Reading B needs a Brake, or it is just a promise

vfkb's own founding lesson — the one that produced ADR-0050 the same morning — is that **a prose rule
with no Brake gets skipped**. Reading B *is* a prose rule: "always disclose." Left there, it decays the
first time someone cuts a release in a hurry, which is precisely how v0.4.0 shipped on a smoke check.

So the disclosure gets a deterministic, CI-time enforcement, folded into part 2's `release-gate.mjs`:

- The plugin repo carries a machine-readable delivery-status assertion (a `deliveryProof` field in
  `plugin.json`, or a committed `DELIVERY-STATUS.json`), valued `unproven` or naming the record that
  proves it.
- `release-gate` **fails** when the value is `unproven` **and** the release-notes / README text does not
  contain the disclosure string, **and** fails when the value claims a proof whose record is absent or
  version-mismatched.
- It flips to `proven` automatically and only when `scenarios/records/install-path.json` lands
  DEMONSTRATED and version-bound.

Then Reading B is not a promise; the release cannot be cut with the gap unnamed. This is the same
architecture as the existing Brake — verify committed evidence in CI, never trust prose.

## Scope and non-goals

- The `install-path` L4 is **not** built. Building it without its trigger is the speculative build this
  RFC declines.
- Doctor's "axis (b)" (install behind clone) is **not** built. Trigger: an observed half-upgraded install.
- Bundle-consumer currency detection is **not** built.
- A `SessionStart` staleness check is **not** built (alternative H).
- `hooks.json` host-level validation is **not** built; ADR-0048's vfkb-claude-plugin#6 stays open. Part 2b
  checks that `hooks.json` *parses*; it never fires a hook.

## Disclosure — credential mishandling during this investigation

The probes copied the **entire** `~/.claude/.credentials.json` (including `mcpOAuth`) into two sandbox
config dirs and ran two authenticated `claude -p` sessions against them. **This violated ADR-0022 §8**,
which already required copying only the `claudeAiOauth` block, into a container, *"never the live host
file, so a container-side token refresh cannot disturb the host session's credential."* Both copies were
deleted and the scratch dirs removed (verified: zero `.credentials.json` remain). **"No breakage was
observed" is not "no rotation occurred"** — a silent server-side refresh-token rotation is not detectable
by inspecting the host file. Operator action: if the live session's auth misbehaves, re-authenticate
(`/login`).

## Existing projects — how they get upgraded

**Plugin consumers (ADR-0045).** Two commands; the restart is last, not first:

```
claude plugin marketplace update <marketplace>      # axis (a): advance the clone
claude plugin update <plugin>@<mp> --scope project  # axis (b): advance the install
# then restart Claude Code to apply
```

`--scope` must match the install (`installed_plugins.json` shows it); the default `user` hard-fails on a
project-scope install. After part 1, `doctor` **warns** when online that your clone is behind — the failure that bit the
operator. It emits no `fail`: the install-behind-clone check that would have is gated. Offline, doctor
still cannot tell you that you are stale.

**Bundle consumers (ADR-0030/0031).** Refresh `$VFKB_BUNDLE_DIR`. No registry; currency unanswerable
offline. Gated.

**No migration is required.** Nothing here changes on-disk formats, wiring, or the brain.

## Alternatives considered

**A. Remember to test after releasing.** The prose-rule-without-a-Brake ADR-0050 exists to reject.

**B. A release-time `install-path` L4 as the primary remedy.** It would have gone **green on release
day**: the packaging was correct and the operator's clone was stale. Rejected as the primary remedy;
retained as a gated build for a different defect class.

**C. A fresh-install-only proof.** A clean `CLAUDE_CONFIG_DIR` always resolves newest, so it cannot
reproduce an upgrade failure.

**D. A local-path (`./dir`) upgrade arm.** A directory source creates no clone, so there is nothing to be
stale **[probe]**.

**E. Make `brief-skill.mjs` use the install path.** Conflates skill regression with packaging regression,
and destroys the fast inner-loop gate.

**F. Run a live L4 in CI as the Brake.** Needs `claude` auth, is metered, and would put operator
credentials in CI.

**G. Assert on exit code / `is_error`.** Empirically broken **[probe]**.

**H. Surface staleness at `SessionStart` rather than in `doctor`.** Attractive — it reaches the operator
unasked, which is exactly doctor's weakness — but a network call on the hot path is a latency and
offline-failure hazard. Deferred; revisit if the doctor warning proves insufficient.

**I. `git fetch` for axis (a).** Rejected: a diagnostic must not mutate the user's clone, and shallow
clones would need `--unshallow`. `git ls-remote` answers the same question read-only **[probe]**.

**J. A unit-tests-only DoD for `doctor`.** Rejected by ADR-0029's own Alternatives: *"unit tests prove the
parts, not that the capability works in its real use-case."* Hence `doctor-staleness.mjs`.

## Consequences

- ADR-0050 — a *constitutional* ADR — is amended **the same day it was accepted** (both carry
  `timestamp: 2026-07-09`). The rule was falsified by evidence within hours; the amendment carries the
  evidence.
- The headline remedy is a **detector**, not a gate — an uncomfortable conclusion for a gate-shaped
  doctrine, and it follows directly from the packaging having been correct.
- `vfkb doctor` gains a network `warn` about the *environment* rather than the brain — and **no new
  `fail`**, since the only check that would emit one is gated. It also gains vfkb's first scenario that
  tests vfkb's own diagnostic.
- The plugin's release gate stops trusting a self-asserted boolean. `brief-skill.json`'s shape changes
  (breaking); the record is migrated in the same PR as the gate.
- Fixing `doctor` to honor `CLAUDE_CONFIG_DIR` is a prerequisite and a standalone bug fix.
- **"The plugin installs" remains unproven**, and every release note must say so until the gated L4 runs.
- Brain: gotchas `3c5ac5414d7a`, `b1f4272e605f` (this branch); gotcha `112f75187029` and fact
  `5e6f88502243` land via **PR #100** and are not resolvable here until it merges.

## Definition of Done

Until every item holds, the honest status is **"built, NOT yet verified."** All seven are discharged by building; the
constitutional question they used to depend on was ratified separately, before acceptance.

1. *(vfkb)* `doctor` honors `CLAUDE_CONFIG_DIR`, with a unit test that goes red on a fixture whose
   registry lives outside `$HOME`.
2. *(vfkb)* The staleness check resolves the clone from `known_marketplaces.json[<mp>].installLocation`,
   uses **`git ls-remote` only**, and never `fail`s. Git is invoked through an injected runner seam (the
   pattern `src/session-end.ts` already uses), and a unit test asserts the only git subcommand issued is
   `ls-remote` — that is how "no writes" is observed rather than assumed. Fixtures cover: clone behind
   remote → `warn`; clone level → `ok`; unreachable remote → `skip`; `directory` source → `skip`.
3. *(vfkb)* `scenarios/doctor-staleness.mjs` committed: host-level tmpdir sandbox, offline, hand-built
   fixtures (local bare repo + clone + registry JSON), **no GitHub, no `claude plugin` CLI**. DEMONSTRATED
   per ADR-0022:72 — wired ≥2/3, contrast holds ≥2/3. The agent is **observed** naming the stale state
   and the remedy, not merely exiting non-zero. The committed record binds to the **vfkb git sha**. Note this is a *new* convention for a
   per-scenario record: only the `l4-purpose` aggregate records carry `vfkb_sha` today; the five
   standalone records (`decision-capture`, `session-start-briefing`, `session-end-handoff`,
   `okf-bundle-cold-agent`, `agents-md-cold-agent`) carry none **[probe]**. `ENGINE_VERSION` is
   `0.0.0-dev` in `dist` and near-static in the bundle, so it is not a usable binding.
4. *(plugin)* `release-gate.mjs` recomputes the verdict from per-arm counts and roles, never reading
   `rec.demonstrated`, applying ADR-0022:72 unchanged. **The Brake is seen going red** on a stale record
   *and* on a `demonstrated: true` record carrying a failing arm. `brief-skill.json` is migrated to the
   roles shape in the same PR.
5. *(plugin)* The structural packaging check exists and is **seen going red** on a tree with a declared
   skill removed.
6. *(plugin)* The delivery-status Brake exists: `release-gate.mjs` **fails** when delivery is `unproven`
   and the disclosure string is absent, and **fails** when a claimed proof has no matching DEMONSTRATED,
   version-bound record. **Both failures are seen**, not assumed.
7. *(vfkb)* ADR-0051 committed; ADR-0050's status-pointer line — and nothing else in its body — records
   the amendment; CLAUDE.md's DoD section updated to match, including the scoped staleness corollary and
   the standing "delivery is unproven" disclosure.
**Ratification (done, 2026-07-09).** The constitutional question was the operator's, not an
implementer's, so it was never a DoD item. It was put explicitly and answered: **Reading B** — releases
continue, silence is the violation, and the disclosure is enforced by the Brake in DoD item 6. Had
Reading A been chosen, part 4's gate would be void and the `install-path` L4 would become a blocking
DoD item. It was not.
