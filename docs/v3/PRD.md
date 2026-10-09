# vfkb v3 — Product Requirements

> **Status: DRAFT / unratified. Nothing here is decided.** This is a PRD, not a
> decision: per [ADR-0007](../adr/ADR-0007-rfc-is-proposed-decision.md) a proposal
> becomes binding only as an RFC that is then accepted into an ADR. Each theme in §6
> is written so it can graduate into its own RFC independently — the whole document
> does not have to be swallowed at once, and parts of it should probably be
> rejected.
>
> **Created:** 2026-10-07. **Author:** operator + Claude.
> **Evidence base:** [`research/claude-code-harness-2026-10.md`](research/claude-code-harness-2026-10.md)
> (what the harness offers now),
> [`research/brain-compatibility-2026-10.md`](research/brain-compatibility-2026-10.md)
> (what "no records lost" costs and forbids) and
> [`../research/decision-models-2026-10.md`](../research/decision-models-2026-10.md)
> (the measured retrieval surface and the decision-model class).
>
> **Naming.** "v2" is a **completed** cycle in this repo — ADR-0039…0044, PR #86,
> merge `5bb087e` (2026-07-08), with `../V2-VISION.md` and `../V2-ROADMAP.md` as its
> historical record. This is the **next** generation and is therefore v3.
> It is a generation name, not a semver target: the package is at **0.9.1** and this
> document does not propose a version number (§7 Q5).
>
> *(`5bb087e` is server-verified as PR #86's merge commit but is not an object in a
> fresh local clone, the `v2` branch having been deleted. The `v2-shipped` tag points
> at `8aca738` — the PR #85 docs-sync merge — **not** at the ship commit.)*

---

## 0. Operator rulings so far, and the one hard constraint

**Ruling 1 (2026-10-08): v3 MAY BE A FULL REWRITE.** Breaking changes are allowed.
This **supersedes non-goal N1 of this document's first draft**, which read "Not a
rewrite" — that non-goal is withdrawn, and §4 records the inversion rather than
hiding it.

**Ruling 2 (2026-10-08) — THE ONE REQUIREMENT, in the operator's words:**

> *"The current records should not be lost when moving to v3 — so either
> compatibility or migration."*

**C1. No record loss. A constraint, not a goal — it does not trade off against
anything in §6.**

The compatibility survey then turns it into something sharper than the either/or it
was offered as:

**C2. Read-compatibility is the floor, not one of two options.** A perfect
`vfkb migrate` does not remove the need for v3 to read a v2 log, because three live
mechanisms keep writing v2-format lines into a brain *after* it is migrated: mixed
engine versions are live right now (this checkout is 0.9.1, the installed plugin
vendors **0.8.0**); the manifest **cannot gate writes** (`readManifest` has zero call
sites in `storage.ts`/`engine.ts`/`mcp-server.ts`/`cli.ts`, and 15 of 27 brains on
this machine have no manifest at all); and `merge=union` plus journal recovery
re-introduce old lines. **Migration is therefore optional, and only ever a layer on
top of read-compatibility.**

**C3. Four things a rewrite may NOT change** — entry `id`s (cited in prose and in
structural `supersedes`/`contradicts` edges), the `updated` spelling (the fold is a
**lexical** string compare, so re-stamping silently resurrects older revisions),
tombstone semantics, and one-JSONL-line-per-record with the LWW fold. Everything
else in the envelope is open, because **unknown top-level and nested fields already
pass through** — pinned by `test/schema-honesty.test.ts:88` and `:115`.

**C4. ~1,365 live records are at stake, ~893 of them outside this repo**, plus an
unknown count elsewhere. That is what makes "start fresh" not merely unwise but
ruled out. (Measured 2026-10-09 at `5c82f44`: 25 brains, 1,402 physical lines,
1,365 live. An earlier sweep found 27 / 1,388 — see M2 below on why that denominator
moves and why it must be pinned.)

**Ruling 3 (2026-10-09): BOTH METRICS BELOW ARE ADOPTED.** G1 was unfalsifiable
without M1, and C1 was unprovable without M2.

### M1 — eligible entries reaching a session

**Baseline at `5c82f44`: 6 of 470 injectable entries = 1.28%**, with the render
printing `+ 464 lower-ranked entries omitted` against a 10,000-char budget.

```sh
VFKB_DATA_DIR=.vfkb VFKB_PROJECT=vfkb node --input-type=module -e '
import { readAll, renderContextBundle, isInjectable, supersededIds } from "./dist/engine.js";
const all = readAll();
const inj = all.filter(e => isInjectable(e, undefined, supersededIds(all)));
const b = renderContextBundle("vfkb");
let reached = 0;
for (const e of inj) { const probe = (e.text||"").slice(0,60).trim(); if (probe && b.includes(probe)) reached++; }
console.log({ injectable: inj.length, reached, pct: +(100*reached/inj.length).toFixed(2) });
'
```

**The denominator is the injectable set** (`isInjectable` survivors), not the live
set and not the line count — a line count is not an entry count
(brain `da3b58990c1d`).

**What makes this worth tracking rather than merely interesting:** the numerator is
pinned by the budget, not by the brain. Between 2026-10-05 and 2026-10-09 the
eligible set grew 456 → 470 while the number reaching a session stayed at **exactly
6** (1.32% → 1.28%). **The ratio decays on its own as knowledge accumulates.** Any
v3 claim about retrieval has to beat a baseline that is getting worse without
anyone touching the code.

**Known gaming risk, stated so it is not discovered later:** M1 rises if you inject
*more* rather than *more relevant*. It is a floor indicator, not a target to
maximise, and it never replaces the L4 that asks whether an agent can name the thing
it actually needed.

### M2 — live-record count per brain, before and after

**Baseline at `5c82f44` for this repo: 478 distinct, 472 live, 6 archived.**

```sh
VFKB_DATA_DIR=.vfkb node --input-type=module -e '
import { readAll } from "./dist/engine.js";
const all = readAll();
console.log({ distinct: all.length, live: all.filter(e => e.zone !== "archive").length });
'
```

This is the only thing that makes C1 checkable rather than asserted, and the
compatibility survey §5 shows why a weaker check will not do: `import --from-markdown`
**exits 0 while preserving nothing**. A no-loss claim resting on exit status or a
"migrated N" line on stdout is worthless (ADR-0051 §3).

**⚠ M2 must be measured over an ENUMERATED set of brains, never a filesystem
sweep.** Observed 2026-10-09: two brains present in an earlier sweep were gone
hours later — both ephemeral git worktrees under
`~/OneIO-Workdir-Dev/.claude/worktrees/` — moving the fleet total from 27/1,388 to
25/1,365 with no record lost anywhere. A denominator that drifts for reasons
unrelated to loss cannot detect loss. The enumerated set must also exclude the
three config-dir brains (`~/.claude`, `~/.claude-cldp`, `~/.claude-cldw`), which are
default/global brains rather than project brains. Pinning that list is a
prerequisite for any migration proof, and it does not exist yet.

---

## 1. Why now

Two forcing functions, independent of each other, pointing the same way.

**1. The harness moved out from under the design.** vfkb's auto-layer was built
against a Claude Code that offered a handful of hook events taking shell commands.
It now documents **33 events** and **five hook types**, and four of those events map
onto problems vfkb has written down as open, blocked, or structurally impossible —
including one the project recorded as an external block it could not fix. The CLI
also now ships two commands vfkb's own ADRs name as blockers. Full enumeration and
the version caveat: the harness survey.

**2. Retrieval is measurably failing, and nobody measured it until last week.** The
session-start render delivers **six entries out of 456 eligible — ~1.3%**. Four of
those six are pinned by rule, so **the ADR-0012 reranker's entire contribution to a
session is two entries, both `gotcha`**, the joint-top type tier. Not one `fact`,
`decision`, `pattern` or `link` from the ranked set survives the budget. ADR-0049
diagnosed the shape of this at 23 gotchas; there are now 81.

These combine into something sharper than either alone: **the reason retrieval
cannot be fixed within the current design is that there is only one injection
moment and it has no query.** The harness now offers more moments, and one of them
has a query.

---

## 2. What v2 delivered, and what it did not

v2 was a **correctness** cycle, and it succeeded at that:

| v2 delivered | ADR |
|---|---|
| Session backbone | ADR-0039 |
| Native concurrency lock | ADR-0040 |
| `entries.jsonl` `merge=union` | ADR-0041 |
| Schema honesty | ADR-0042 |
| Storage seam | ADR-0044 |
| *(rebuildable index — left GATED)* | ADR-0043 |

Every one is plumbing: the log is safe under concurrency, merges without conflict,
and admits what it does not know. **None of them changed what reaches an agent.**
The retrieval path v2 shipped is the retrieval path ADR-0012 specified in v1 — a
type-tier heuristic with no relevance signal — and §1's measurement is of that path.

**So v3 is not a continuation of v2. It is the other half.** v2 made the substrate
trustworthy; v3 has to make it *arrive*.

---

## 3. Thesis

> **v2 made the brain correct. v3 makes it reach the agent at the moment it is
> needed, and makes its delivery provable.**

Three clauses, each falsifiable:

1. **Timing beats ranking.** The 10k budget is not primarily a ranking problem; it
   is a consequence of having exactly one injection moment. More moments, each
   cheaper and narrower, beats a better sort over one bundle.
2. **A query changes what is possible.** With a query available on an automatic
   path, deterministic lexical retrieval — which vfkb already has, offline and free
   — becomes usable where it previously could not be.
3. **Delivery must stop being unproven.** ADR-0051 makes "delivery is unproven" a
   mandatory disclosure on every release note until an install-path L4 exists. The
   command that blocked it now exists. Closing that is a v3 deliverable, not a
   footnote.

---

## 4. Goals and non-goals

### Goals

- **G1.** Raise the share of *relevant* knowledge reaching a session, measured by
  **M1** (§0) against its `5c82f44` baseline of **6 / 470 = 1.28%**. The metric is
  defined and adopted, so the goal is falsifiable — and note the baseline decays
  without anyone touching the code, so "no change" is a regression.
- **G2.** Make injection survive the session, not just start it: compaction,
  subagents, and long-running work.
- **G3.** Make capture work on the primary harness, closing the pi-only gap.
- **G4.** Retire the "delivery is unproven" disclosure by landing the install-path
  L4 that ADR-0051 names.
- **G5.** Reduce curation debt enough that the budget is not spent on dead weight
  (106 `handoff`-tagged entries, of which exactly one is ever pinned).
- **G6.** Position deliberately relative to Claude Code Projects' shared memory,
  rather than by omission.

### Non-goals

- **N1. ~~Not a rewrite.~~ WITHDRAWN 2026-10-08 — a rewrite is permitted.** The
  first draft made "not a rewrite" a non-goal, on the grounds that the storage
  kernel, the LWW fold, provenance and the zone model are v2 outcomes that work. The
  operator ruled otherwise (§0 Ruling 1), so the non-goal is gone. **What replaces it
  is narrower and harder:** the *log format* is a fixed point (§0 C2/C3) while the
  code that reads and writes it is not — a rewrite is free above the line and
  constrained at it. The inversion is recorded rather than quietly deleted, because a
  reader of the first draft would otherwise think this document still forbids a
  rewrite.
- **N2. No new Brake built on a judgement.** Settled by the decision-model survey
  §3 and reaffirmed by the RFC-041 arc: a model with no referent cannot gate. Any
  inference in v3 is advisory, propose-only, or fail-open.
- **N3. Not a hard dependency on anything beta, cloud-only or quota-capped.**
  ADR-0013's posture applies to Claude Code Projects exactly as it applied to
  `better-sqlite3`.
- **N4. Not re-opening RFC-041.** The tamper-predicate question is parked with named
  triggers. Nothing in v3 is a seventh design.
- **N5. Not a semver commitment.** This document does not decide whether the cycle
  ships as 1.0 or 2.0 (§7 Q5). Ruling 1 does remove 0.10 from the options — a
  rewrite with breaking changes is a major by definition.

---

## 5. Who this is for

vfkb has exactly one user class today and should be honest about it:

- **The operator**, working across ~12 consumer repos, whose actual pain is a
  session that starts without the thing it needed and a handoff that has to be
  re-derived. Primary.
- **Agents in those repos**, which are the *consumers* of the substrate but not its
  customer. Their "requirement" is that the right knowledge is in context.
- **The factory** (ADR-0075) — dispatched agents that will need grounding without a
  human in the loop. Not yet real; nothing in P12 is built. v3 should not design
  *for* it speculatively, but should not foreclose it.

---

## 6. Requirements

Each theme states the **measured problem**, the **proposed capability**, what it
**depends on**, and how it would be **proven**. Themes are independent and
separately RFC-able. Priority is the operator's call (§7 Q1).

### R1 — Query-time injection

**Problem.** One injection moment, no query, ~1.3% delivered, and the reranker
contributing two entries.

**Capability.** Inject narrow, relevant knowledge at prompt-submit time using the
existing lexical index, in addition to (not instead of) the session-start bundle.
Budget per injection far smaller than 10k; selection by `searchScored` plus the
RFC-001 relevance floor, which already exist and are deterministic, offline and free.

**Depends on.** `UserPromptSubmit` with `additionalContext` — **documented, not
observed** on the installed CLI. Blocking probe: harness survey §7 item 1.

**Proof.** An L4 whose can-fail arm is the current behaviour: seed a brain where the
needed entry is below the session-start budget cut (the reproduced 2026-07-09
failure), then assert the agent names the sentinel **when the prompt mentions the
topic** and misses it with per-prompt injection off. Plus deterministic unit tests
for budget, floor and dedup against the already-injected set.

**Open risks.** Per-prompt injection on every turn is a token cost paid forever;
needs a measured ceiling. Duplicate suppression against the session-start bundle is
required or the same entry arrives twice. And this partially un-gates **S1** — the
BM25-first amendment becomes relevant to an automatic path for the first time, so
S1's trigger should be re-read rather than assumed.

### R2 — Survive compaction

**Problem.** ADR-0008 guarantees the Constitution always leads; ADR-0049 guarantees
the handoff pin is never budget-dropped. **Both are injection-time guarantees that
silently do not survive a compaction**, and `--autocompact` spans 100k–1M tokens, so
compaction is routine. This is a correctness gap in a shipped guarantee and it has
never been written down.

**Capability.** Re-assert the pinned sections after compaction. Narrow by
construction: Constitution + pinned handoff + cross-repo, not the ranked bundle.

**Depends on.** `PostCompact` [docs, unobserved].

**Proof.** Deterministic test over the render; L4 arm that compacts a session and
asserts the Constitution is still present. The can-fail arm is trivially available —
today it is absent after compaction.

### R3 — Failure capture on the Claude face

**Problem.** `CLAUDE.md` records it as an external block: `PostToolUse` does not
fire on a failed call, so live failure capture is pi-only. `src/distiller.ts`'s only
v1 signal is the `capture:error` fact, so auto-distill is half-dark on the primary
harness.

**Capability.** A `post-tool-use-failure` engine handler feeding the existing
distiller path, under the existing ADR-0021 containment (`incoming` + `unverified` +
agent-trust, ≥2 corroborations to promote).

**Depends on.** `PostToolUseFailure` [docs, unobserved].

**Proof.** Unit tests for the handler; an L4 that causes a real tool failure and
asserts a candidate gotcha appears in `incoming` and **does not** reach the trusted
set. Containment is already deterministically tested — reuse it.

**Note.** Auto-capture of *successes* is off for noise reasons. Failures are a
different signal-to-noise class, so that decision does not transfer; but the brain is
committed, so the threshold question is real and belongs in the RFC.

### R4 — One engine instance: `mcp_tool` hooks

**Problem.** Every hook event spawns a process loading a **vendored** engine copy
(ADR-0045 Phase 1). Consequences are documented in `CLAUDE.md` itself: editing `src/`
no longer changes what the live hooks run, and dogfooding an engine change requires a
plugin release.

**Capability.** Investigate hooks of type `mcp_tool` calling the already-running MCP
server, collapsing the hook path and the tool path onto one process and one engine
version.

**Depends on.** `mcp_tool` hook type [docs, unobserved]; and critically its
**failure mode when the server is down**, since the current `command` hooks fail open
by design (`src/hook-stdin-failopen.test.ts`).

**Proof.** Probe first (harness survey §7 item 3). This is the one theme that could
come back "no" — if an `mcp_tool` hook fails closed on a dead server, it is
disqualified from the inject path outright.

### R5 — Close "delivery is unproven"

**Problem.** ADR-0051 makes the disclosure mandatory in every release note, ADR and
handoff until `scenarios/records/install-path.json` lands, and says the L4 is "not
even immediately buildable (blocked on adopting `claude plugin tag`; the plugin repo
has zero tags)".

**Capability.** Adopt `claude plugin tag` in the plugin repo's release flow and build
the install-path L4 — a real marketplace install, not `--plugin-dir`, which ADR-0051
§1 rules out explicitly.

**Depends on.** `claude plugin tag` — **observed present on `2.1.273`**. The one
`[cli]`-verified dependency in this document, which is why R5 is the least
speculative theme here.

**Proof.** `scenarios/records/install-path.json`, DEMONSTRATED ≥2/3 with a can-fail
arm, and the release gate's `deliveryProof` flipping to `proven` by deriving it from
that record rather than by prose.

**Open.** The tag-scheme collision (`{name}--v{version}` vs release-please's
`vX.Y.Z`) is unexamined — harness survey §7 item 5.

### R6 — A wiring Brake for the plugin

**Problem.** ADR-0048 assigns plugin `hooks.json` validation to the plugin repo's
release flow and it is **pending** (vfkb-claude-plugin#6). A broken manifest is a
delivery regression for all consumers.

**Capability.** `claude plugin validate --strict --json` in the plugin repo's CI.

**Depends on.** Observed present on `2.1.273`. Must first confirm it actually
*rejects* a malformed `hooks.json` (harness survey §7 item 4) — a validator adopted
as a Brake that tolerates its defect class is worse than none, per this repo's own
`observed-red-is-a-floor` lesson (`1af189641750`).

### R7 — Curation that keeps the budget clean

**Problem.** 458 live entries; **106** carry `handoff`, of which exactly one is ever
pinned, so 105 compete for budget as dead weight. `findLexicalDuplicates` is
exact-match-after-normalisation only, deferring semantic dedup to gated RFC-003.
`isInjectable` cannot notice an entry went obsolete unless someone marked it.

**Capability.** Propose-only curation: semantic duplicate pairs, staleness
candidates, and handoff lifecycle routing. **Propose-only is not a softening** — it
is what keeps N2 satisfied and the never-rewrite Brake intact.

**Depends on.** Nothing in the harness. Optionally a decision model as an opt-in
`Reranker`/`Decider` behind an ADR-0013-shaped seam — which the decision-model survey
§10 says must be preceded by a calibration spike that can invalidate it for about a
dollar.

### R8 — Position against Claude Code Projects

**Problem.** A first-party shared-memory layer for coordinated multi-session work now
exists (beta, 2026-09-17). vfkb has never had to position against an overlapping
first-party primitive.

**Capability.** A written position — complement, partial substitute, or consumer —
plus whatever interop that implies. The harness survey §6 lays out all three
readings; this requirement is to **pick one on the record**, not to build.

**Depends on.** Account availability, unknown; nothing has been run.

**Non-goal reminder.** N3 — no hard dependency on a beta, gated, cloud-only,
quota-capped surface.

---

## 7. Open questions — operator decisions required

These are not rhetorical. Each changes what gets built.

- **Q1. Priority order of R1–R8.** My read: **R5 and R6 first** (the only
  `[cli]`-verified dependencies, and R5 retires a standing disclosure obligation),
  then **R2** (a correctness gap in a shipped guarantee, cheap, with a trivially
  available can-fail arm), then **R1** (the largest payoff and the largest unknown),
  then R3, R7, R4, R8.
- **Q2. ~~Are breaking changes allowed?~~ ANSWERED 2026-10-08: YES — a full rewrite
  is permitted**, subject to §0's C1–C3. One sub-question stays open, and it is the
  sharp one: *which* breaks are worth taking, given that the log format is fixed and
  **enum values are breaking-by-stealth while any older engine is live**. An unknown
  `type`/`zone`/`role`/`status` value read by the 0.8.0 engine is **coerced, and the
  coercion persists** on the next write — so adding an entry type is not the free
  additive change it looks like.
- **Q3. Branch strategy — Ruling 1 reopens this and points it the other way.** For
  an additive cycle, landing on `main` behind flags was the cheap answer. A rewrite
  cannot: `main` must keep serving 0.9.1 to ~12 consumer repos while v3 is unusable,
  which is precisely the situation ADR-0036's long-lived branch was built for. **My
  read: revive the ADR-0036 shape** — a long-lived `v3` branch with docs still
  landing on `main` — rather than invent a third pattern. Note the cost ADR-0036
  itself paid: every v1 fix had to be merged forward promptly, *"not batched"*, or
  the two branches diverge far enough that reconciliation becomes its own project.
- **Q4. Minimum supported Claude Code version.** Every `[docs]` dependency implies a
  floor. A plugin that fails to load on an older CLI is a delivery regression for all
  12 consumers — so the floor is a product decision, not an implementation detail.
- **Q5. Version number.** Package is 0.9.1 and has never declared a stable API.
  "v3" is a generation name here; whether the cycle ships as 0.10, 1.0 or 2.0 is
  open, and 1.0 carries an API-stability promise this project has not made.
- **Q6. ~~Does the ~1.3% number become a tracked metric?~~ ANSWERED 2026-10-09:
  YES, both.** M1 (eligible entries reaching a session) and M2 (live-record count
  per brain) are adopted as Ruling 3, defined with their commands and `5c82f44`
  baselines in §0. Two things remain open and are deliberately *not* decided here:
  **(a)** the measurement must be committed as a script rather than living in prose,
  or it rots — a metric defined only in a document is this repo's own failure mode;
  **(b)** M2 needs a **pinned list of consumer brains**, because a filesystem sweep
  drifts (§0 M2). Neither is a decision, both are work.

---

## 8. Definition of Done

**[ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) /
[ADR-0051](../adr/ADR-0051-delivery-honesty.md) are non-negotiable and bind every
theme here.** Restating the parts this cycle will trip over:

- Anything user-facing ships only behind a **full sandboxed agent-driven L4**:
  committed reproducible scenario, DEMONSTRATED ≥2/3, a **can-fail arm**, every
  load-bearing claim **observed not asserted**.
- **`--plugin-dir` is not a real surface** (ADR-0051 §1). R5's whole point is a real
  marketplace install.
- **The quiet-success trap** (ADR-0051 §3): where a failure presents as a successful
  run lacking the capability, the predicate must be a **content assertion over
  output**. R1 is squarely in this class — an agent that fails to receive an
  injection still answers, fluently, and exits 0.
- Until a theme's evidence exists and is named, its only honest status is
  **"built, NOT yet verified"**.

**Two DoD hazards specific to v3:**

1. **Hook events cannot be proven by documentation.** This repo's own lesson is that
   a flag whose semantics you have not observed is not a guardrail
   (`61daf266f883` — `--allowedTools` did not remove the shell). Every `[docs]`
   dependency needs an observation probe **before** its RFC, not during its build.
2. **L4 isolation is already compromised and must be fixed first.** Gotcha
   `fb712c13f39e`: the vfkb plugin is enabled at **user** scope on this machine, so
   it runs inside every sandbox an L4 launches — creating `.vfkb/` in the sandbox,
   nudging the agent mid-arm, and auto-committing the brain so agent writes vanish
   from `git status`. Any v3 scenario must disable the plugin per-sandbox and
   **assert it stayed off**. `--bare` may help but skips all plugins, so an L4 that
   tests vfkb's own wiring cannot use it.

---

## 9. Sequencing principle

Not a schedule — this repo builds on evidence, not plans
(`CLAUDE.md`: *"Don't build speculatively"*).

1. **Probe before propose.** Harness survey §7's five probes gate every `[docs]`
   dependency. A probe that comes back "not in our version" kills or defers its
   theme, cheaply.
2. **Verified dependencies first.** R5 and R6 rest on `[cli]`-observed commands and
   retire named obligations.
3. **One RFC per theme.** Each graduates independently; the PRD is not a package
   deal.
4. **The roadmap stays the authority.** `H4-DEVELOPMENT-ROADMAP.md` §4 is the
   execution authority; nothing here changes that until a theme is ratified and
   sequenced there.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **Version skew** — `[docs]` surfaces may not exist on `2.1.273` | §9.1 probes first; Q4 sets a floor |
| **Harness churn** — the surface moved sixfold since vfkb's design; it will move again | Keep the engine harness-agnostic behind faces (the existing `src/cli.ts` / `src/pi-extension.ts` split); treat hook events as adapters, never as the model |
| **Token cost of per-prompt injection** paid on every turn forever | Measured ceiling in R1's RFC; opt-in; dedup against the session bundle |
| **R1 fails quietly** — a missing injection still produces a fluent answer | ADR-0051 §3: content assertion over output, never exit status |
| **Plugin load failure on older CLIs** = delivery regression for 12 consumers | Q4; R6's validator in CI; `vfkb doctor` surfaces the floor |
| **Projects makes part of vfkb redundant** | R8 forces the position onto the record instead of leaving it to drift |
| **Scope sprawl** — eight themes is a lot | §9.3 one RFC per theme; expect rejections; N1 forbids touching the log |

---

## 11. Explicitly out of scope

- The tamper-predicate redesign (RFC-041, parked, named triggers, no seventh design).
- Any Brake resting on model judgement (N2).
- The storage kernel, the append-only log and the zone/provenance model (N1).
- H2 fleet wiring and H3 global tier — parked before v2 and not revived here.
- `recorded_invalid_at` — deleted by ADR-0076, not to be reintroduced.

---

## 12. Not verified

- **Every harness dependency except `claude plugin tag`, `claude plugin validate`,
  `claude plugin details`, `--bare` and `--autocompact` is `[docs]` only** and has
  not been fired or observed. That covers R1, R2, R3 and R4 — four of eight themes.
- **The ~1.3% / `6 of 456` baseline** was measured at `8237fc4` on this repo's own
  brain. It is one project's brain at one moment, not a general claim.
- **Claude Code Projects** is `[secondary]` only; availability unknown, nothing run.
  §6 R8's three readings are analysis.
- **No cost model.** R1's per-turn token cost is named as a risk and not estimated.
- **No claim that any theme should be built.** A PRD is a proposal; an RFC is a
  proposed decision; only an ADR decides (ADR-0007).
