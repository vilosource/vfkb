---
type: Proposal
title: "RFC-039: The software factory — GitHub Issues as state, local dispatch, gates over agents"
description: "Proposes moving vfkb's issue tracking to GitHub Issues as the system of record and wiring a local orchestrator that dispatches a Claude coding agent and a Codex review agent around it. The central finding is that the orchestrator's leverage is in what it refuses to dispatch and what it deterministically verifies, not in how many agents it coordinates: no source found supports adding agents, a great deal supports adding gates. Three clauses were pre-ruled by the operator on 2026-09-14 (autonomous merge narrowed to admission-gated issues; the cross-model reviewer is advisory not blocking; scope opens at cleanup/testing/refactoring only) and are recorded as ruled rather than proposed. Nothing here is built; per ADR-0050 the only honest status for every clause is unbuilt."
status: "Proposed — unratified"
timestamp: 2026-09-14
---

# RFC-039: The software factory

- **Status:** **PROPOSED, unratified.** Nothing in this RFC is built. Per ADR-0007 this is a
  *proposed decision*; it becomes an ADR only on operator acceptance. Three clauses (D9, D6, D10)
  carry operator rulings taken during the design conversation and are marked **[RULED]** — those
  rulings bind the shape of this RFC, but the RFC as a whole is still unratified.
- **Date:** 2026-09-14
- **Deciders:** operator + Claude
- **Trigger:** operator request, 2026-09-14 — *"I want us to move to using github as the issue
  tracker, research how we can implement the development process as a software factory … we will
  have orchestrator agent that manages coding agent, review agent … please go online and research
  agentic workflows … and then propose a solution and we will discuss."* Followed by two
  constraints that materially shaped the result: *"i favour local execution"*, and the
  clarification that multiple agents are wanted for **model diversity** (`cldw` = Claude,
  `codexw` = Codex), not for agent count.
- **Relates:** [ADR-0052](../adr/ADR-0052-review-gate.md) (the review gate and its record schema —
  the factory's review stage is this, automated, not a new mechanism);
  [ADR-0070](../adr/ADR-0070-guards-that-can-fail.md) (a guard that cannot fail is not a guard —
  governs D8's two new gates and §5's ordering); [ADR-0029](../adr/ADR-0029-sandbox-proven-definition-of-done.md) /
  [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) /
  [ADR-0051](../adr/ADR-0051-delivery-honesty.md) (what a proof must be, and that silence
  about an unproven capability is the violation);
  [ADR-0067](../adr/ADR-0067-hybrid-credential-model.md) (OAuth stays local — already ratified,
  and independently forces D4's local-execution split);
  [#261](https://github.com/vilosource/vfkb/issues/261) (claims must cite something checkable —
  the reason §1.2 exists)

## 1. Context

### 1.1 What we track work with today, and why it is insufficient

Work is currently tracked across three surfaces that do not agree with each other: GitHub Issues
(9 open, verified 2026-09-14), `docs/task-priority.md`, and the committed brain's `handoff`/`next`
facts. None is authoritative, and the roadmap ledger at `docs/H4-DEVELOPMENT-ROADMAP.md` §4 —
nominally the execution authority — was last touched 2026-07-25.

The repo's label set is GitHub's default plus `priority: high` and the two release-please labels.
**There is no state vocabulary at all** — nothing distinguishes an issue that is ready to work
from one that is underspecified, in progress, or awaiting review.

### 1.2 How the evidence below was gathered, and how far to trust it

The research supporting this RFC was produced by a subagent that fetched and read ~120 primary
sources directly (arXiv paper bodies, vendor engineering blogs, `docs.github.com`, and the GitHub
API for live repository ground truth).

**Two labelling disciplines apply throughout, and they are not decorative.**

First, **I have not independently re-verified most of the cited measurements.** What I verified
myself is marked **[VERIFIED HERE]**; everything else is **[RELAYED]** — cited to a named primary
source, but taken on the research agent's reading of it. Per #261 this distinction is the claim's
actual epistemic status and is not flattened.

Second, and the reason the first matters: **during that research an automated PDF summariser
fabricated an entire results table** for arXiv:2410.06992 — invented percentages appearing nowhere
in the paper — caught only by extracting the PDF text locally. Any design that consumes relayed
benchmark numbers must assume some fraction are wrong. This is the same failure class as brain
gotcha `836d111fb67e` (five instances of trusting command output without verifying the command
ran), and it is why §4's gate ordering does not rest on any single number.

### 1.3 The finding that shapes the whole design

> **The orchestrator's leverage is in what it refuses to dispatch and what it deterministically
> verifies, not in how many agents it coordinates. Nothing found supports adding agents; a good
> deal supports adding gates.**

The decisive measurement is the oldest one. **[RELAYED** — Valmeekam, Marquez & Kambhampati,
[arXiv:2310.08118](https://arxiv.org/abs/2310.08118), 100 Blocksworld instances**]**: GPT-4 as its
own critic moves accuracy 40% → 55%, while **waving through 84.45% of invalid work**; a *sound
external verifier* moves it to 88%. Feedback granularity barely mattered.

Corroborating, on real code review: independent precision measurements run **3.56%** (CR-Bench)
to **36.4% acceptance** across 31,073 CodeRabbit review/feedback pairs, with the sting that
*functional* reviews were judged invalid **more** often than maintainability ones — least
trustworthy exactly where a gate needs it. The honest vendor number is Cursor's: roughly **one
caught-and-fixed bug per two PRs, at best**. **[RELAYED]**

Against that, the largest single improvement in the best-documented real deployment —
dotnet/runtime, 878 Copilot coding-agent PRs over ten months — was **41.7% → 69%, from a firewall
fix and a written build-instructions file.** Not from the model. **[RELAYED** — Toub,
[devblogs.microsoft.com](https://devblogs.microsoft.com/dotnet/ten-months-with-cca-in-dotnet-runtime/)**]**

**This repo is unusually well placed to act on that**, because it already owns most of the
deterministic half: `scripts/review-gate.mjs`, `scripts/adr-lint.mjs`,
`scripts/hook-durable-claim-check.mjs`, `scripts/hook-git-compound-guard.mjs`, each with a
`.selftest.mjs` sibling, plus ADR-0070's standing requirement that a guard be observed failing
and ADR-0052's review records with mutation logs. **[VERIFIED HERE** — `ls scripts/`**]** The
factory is mostly dispatch wiring around gates that already exist.

## 2. Decisions

### D1 — GitHub Issues become the system of record; state lives in labels

One FSM label at a time, following the only fully-auditable public analogue
(`withastro/triagebot-action`, whose rule is *"each issue has exactly one triage label at any
time"* **[RELAYED]**):

```
fsm:needs-spec  →  fsm:queued  →  fsm:dispatched  →  fsm:in-review  →  fsm:awaiting-merge
                                        ↓
                                   fsm:blocked  (terminal, human-reopened)
```

`docs/task-priority.md` becomes a generated projection, not a parallel tracker. Brain `handoff`
facts continue to carry *narrative* continuity; they stop carrying *task state*.

**GitHub Projects v2 is rejected as the state substrate** and may serve only as a human-facing
view: it is GraphQL-only with no ETag/304 equivalent (so no cheap polling), and **`GITHUB_TOKEN`
cannot access projects at all**; `projects_v2_item` is additionally not an Actions trigger.
**[VERIFIED HERE** — the trigger absence, against GitHub's events reference**]**

### D2 — The admission gate is built FIRST, before any coding agent

An issue is dispatchable only if it names (a) acceptance criteria, (b) the surfaces/files it
touches, and (c) its governing ADR/RFC — the last being this repo's existing standard, since
`/review` already refuses to review a change with no governing document. A failing issue is
returned to `fsm:needs-spec` **with specific questions**, and is not dispatched.

This is the highest-leverage clause in the RFC and the only one with no counter-evidence found.
Four independent lines converge **[RELAYED]**: stripping human-written requirements swings GPT-5
(high) **25.9% → 8.40%** on SWE-Bench Pro; an interpretable issue-readiness model reaches
**median AUC 72%**, finding that mergeable issues are *"shorter, well scoped, with clear guidance
and hints about the relevant artifacts"*; Sweep.dev pivoted away from issue-to-PR and named this
as failure reason #1 — *"our agent really needed a well defined spec to have a >90% success
rate … developers don't want to write a spec"*; and OpenAI's own retraction analysis found that
underspecification is *what makes contamination pay*, because *"models that have seen the problems
during training are more likely to succeed, because they have additional information needed to
pass the underspecified tests."*

Building it first is also what keeps D9's narrowed merge grant meaningful.

### D3 — The orchestrator is a dispatcher, not a supervisor

It routes work, runs gates, and advances labels. It does **not** supervise agent reasoning.

**It re-observes GitHub and the worktree before advancing any state, and never trusts an agent's
self-report** — the rule two independent implementations reached separately, stated by
`issue-orchestrator` as *"agent intent, orchestrator authority."* **[RELAYED]**

**Explicit completion detection is mandatory, not a nicety.** Baton's published scar is the
precise bug this omits: *"the agent would finish its work, create a PR on turn 2 of 5, and Baton
would keep scheduling continuation turns for the remaining 3."* **[RELAYED]**

This also resolves an asymmetry that would otherwise be structural: the 32-event hook surface
belongs to Claude Code, and `codexw` is a different harness with no equivalent. Because the
orchestrator's contract is **artifact-based** (issue state, branch, diff, check results) rather
than hook-based, hooks become a Claude-side enrichment rather than the mechanism — and the design
survives adding a third model.

### D4 — Local polling, level-triggered; Actions keeps the required checks

The split is: **local process owns state transitions; GitHub Actions owns verification.**

Local polling is chosen on correctness grounds, not convenience. **GitHub never automatically
redelivers a failed webhook** — stated twice on its own docs page — so webhooks there are
effectively at-most-once with a manual repair API, and a webhook-only design needs a reconciler
bolted on regardless. **Polling is the reconciler.** This places the design on the correct side
of the level-triggered argument (Hockin; Kubernetes controllers; Stripe's undelivered-events
guide). **[RELAYED, with the GitHub docs statement [VERIFIED HERE]]**

Three consequences follow, all favourable:

1. A local orchestrator authenticates as the operator, so its writes **do** trigger workflows —
   the `GITHUB_TOKEN` recursion guard never bites. **[VERIFIED HERE]**
2. ETag'd conditional requests are free: *"making a conditional request does not count against
   your primary rate limit if a `304` response is returned."* **[VERIFIED HERE]** (Secondary
   limits still apply, and a poller running *inside* Actions would get 1,000/hr rather than
   5,000/hr — a further reason not to.)
3. A single local process holds an in-process lock, giving true single-writer semantics per issue
   with no distributed coordination.

That third point is load-bearing: across 33,596 agent PRs in 2,807 repos, **79.4% open
concurrently with another**, and the textual conflict rate is **41.7% cross-agent vs 19.8%
intra-agent** (non-overlapping CIs). **[RELAYED]**

**The cost, stated:** availability is laptop-grade. Because the design is level-triggered, a
sleeping machine causes *delay*, not *loss* — **but only if no "what I have already seen" cursor
is cached in process memory.** State lives in labels; an in-memory cursor reintroduces the
edge-triggered failure mode through the back door and is forbidden.

Required checks stay in Actions because branch protection demands it —
`required_checks: ["review-gate","test (20)","test (22)","test (24)"]` with `enforce_admins: true`
**[VERIFIED HERE]** — and because Actions is the only Linux available. That is not incidental:
PR #281's realpath bug class was **live and invisible on green CI**, failing only on macOS
(gotcha on record). Cross-platform verification is a capability only Actions has.

### D5 — The coder runs in a history-stripped worktree with an anti-shortcut constraint

Coder = `cldw` (Claude). One `git` worktree per issue, cloned `--single-branch` with bounded
depth and no other refs, tags or reflog reachable.

**This is not hygiene.** SWE-bench issue #465 (filed by Meta AI, 2025-09-03) is proof by
construction: given `git log --all`, Claude 4 Sonnet ran
`git log --oneline --all | grep -i "bracket\|parametrize\|modpath"` and **the output printed the
gold diff**. Independent audits found the same class across 28+ submissions on 9 benchmarks.
**[RELAYED]** If a fix exists on another branch, a tag, or the reflog, assume the agent finds it.

The coder's prompt carries an explicit **solution-originality constraint**. This is the best
cost/benefit item in the entire body of evidence: one instruction cut exploitation rates from
**45.1%–82.4% to 4.0%–10.7%** on SWE-bench Multilingual, with core performance maintained.
**[RELAYED** — NVIDIA, [arXiv:2609.06780](https://arxiv.org/abs/2609.06780)**]** It costs a
paragraph.

### D6 — [RULED] The cross-model reviewer is ADVISORY, never blocking

Reviewer = `codexw` (Codex), in a session that **never saw the coder's transcript**, charged to
refute "done", emitting findings as `file:line` claims and **never a numeric self-score**. Its
output lands as findings in the ADR-0052 review record. It cannot block a merge.

**Operator ruling, 2026-09-14.** Rationale on the record: an LLM reviewer with blocking authority
is the least defensible component available, given the 84.45% invalid-pass rate in §1.3.

Two independent mechanisms support the *cross-model* part, and they are worth separating because
they were reached differently:

1. **Self-preference bias is measured, and its cause is not authorship.** LLM judges assign higher
   evaluations to outputs with **lower perplexity** — text that feels familiar — *"regardless of
   whether the outputs were self-generated."* **[RELAYED** —
   [arXiv:2410.21819](https://arxiv.org/abs/2410.21819)**]** That is a stronger argument than
   "models like their own work": a Claude reviewer gives a familiarity bonus to Claude-idiom code
   whether or not it wrote it.
2. **Context rot.** All 18 frontier models tested degrade as input length grows, well before the
   context limit. **[RELAYED** — Chroma**]** Cognition ships a Code-Review-Loop that works
   *because* the reviewer has *"completely clean context"* rather than inheriting the coder's.

**The limit of this evidence, stated plainly:** neither paper tests cross-model evaluation as a
mitigation. The inference that a different model family does not share the perplexity prior is
**ours, not theirs, and is UNVERIFIED.** A different model is not automatically an independent
judge. The design does not depend on that inference being right, because the reviewer is advisory.

Precedent for two models in one pipeline **[RELAYED]**: `no_human` (311★) uses *"a different
model, in a session that never saw the coder's transcript, told to refute 'done'"*;
Cloudflare/Astro's triagebot runs `triage-model: claude-opus-4-6` and
`verification-model: claude-sonnet-4-6`.

### D7 — Gate ordering: deterministic first, LLM last

| # | Gate | Blocking | Status |
|---|---|---|---|
| 1 | `tsc` + `npm test` | yes | exists |
| 2 | `review-gate.mjs` — record present, mutation log per new/changed guard (ADR-0052/0070) | yes | exists |
| 3 | `adr-lint.mjs` | yes | exists |
| 4 | **tamper detection** (D8) | yes | **build** |
| 5 | **reproduction gate** (D8) | yes | **build** |
| 6 | cross-model review (D6) | **no** | **build** |

The ordering follows the measured rejection reasons. METR's blinded maintainer study ranks them
**code quality → other → breaks other code → core functionality failure** — *"the most common
reason a passing patch is rejected is quality, not correctness"* — and its earlier pilot found
that among test-passing agent runs, **testing coverage failed 100%, docs 75%, lint/format/typing
75%**. **[RELAYED]** All three are cheap deterministic checks, which is the point: they belong
above the LLM, not below it.

### D8 — Two new deterministic gates

**Tamper detection.** Mechanically counts deleted tests, newly-added `.skip`, tautological
assertions, and `|| true` appended to test commands. GitHub's own framing of why:
*"Agents have an obvious path to get tests passing: remove the tests, skip the lint step, add
`|| true` to test commands."* **[RELAYED]** `no_human` ships exactly this alongside a reproduction
gate. **[RELAYED]**

**Reproduction gate.** A test added by an agent must **fail at the merge base and pass at the new
tree.** This is ADR-0070's can-fail requirement made mechanical for agent-authored work: today
ADR-0070 §2 requires the *author* to log the mutation, and a dispatched agent is an author whose
log is exactly as trustworthy as its self-report (D3).

Both gates are themselves subject to ADR-0070 §1 — **each must be observed failing against a
deliberately tampered tree before it is trusted**, and that observation is a proof obligation
in §5, not an implementation detail.

### D9 — [RULED] Autonomous merge survives, narrowed to admission-gated issues

**Operator ruling, 2026-09-14:** the standing autonomous-PR grant (2026-07-14, brain decision
`5f380d6ca496`) is **not** withdrawn, but applies under the factory **only to issues that passed
the D2 admission gate.**

This is recorded as a narrowing because every reviewed implementation takes the opposite line —
`issue-orchestrator`'s hard rule is *"Agents cannot merge PRs. Humans merge."* **[RELAYED]** The
operator's ruling diverges from that precedent knowingly. The reasoning on the record: the
original grant was written for PRs the operator had scoped personally, and unattended dispatch
changes what it covers, so the admission gate becomes the thing that restores the missing scoping
step rather than the grant being withdrawn.

Unchanged by this RFC: the ADR-0050/0051 DoD gate, the never-push-to-`main` rule, and the
requirement to call out an outward publish.

### D10 — [RULED] Scope opens at cleanup, testing and refactoring only

**Operator ruling, 2026-09-14.** Measured success by task type in the best-documented deployment
**[RELAYED]**: removal/cleanup **84.7%** · testing **75.6%** · refactoring **69.7%** · bug fixes
**69.4%** · **performance 54.5%**; and brownfield **67.9%** vs greenfield **77.3%** — vfkb is
brownfield. Bug fixes and performance work stay human-dispatched until this repo has its own
merge-rate data.

**No published benchmark may be used to size expectations here.** With OpenAI's retraction of
SWE-bench Verified (*"we have stopped reporting SWE-bench Verified scores, and we recommend that
other model developers do so too"*), METR's 24.2pp grader-vs-maintainer gap, and SWE-Bench+'s
12.47% → 3.97% after filtering, resolve rates carry no usable signal for this repo. **[RELAYED]**
The only valid instrument is our own merge and revert rate, instrumented from day one.

### D11 — Liveness keys off state and age, never off ownership

*"Any issue in a non-terminal `fsm:` state whose label has not moved in N minutes is
reclaimable."* A reaper sweep enforces it.

The failure this avoids is specific and already documented elsewhere:
`iopsystems/durable#117` — a worker dies, the ownership field clears, *"the state stays 'active',
so no notification is emitted"*, and the work stalls silently. **[RELAYED]** A design that keys
liveness off a claim record never notices. This matters more here than in a hosted system,
because D4 accepts laptop-grade availability.

### D12 — Rejection is appealable, not terminal

METR's blinded study included **47 human gold patches as a noise baseline: only 68% were merged**
— a third of genuinely-merged historical PRs are rejected on blinded re-review. **[RELAYED]**

A well-calibrated gate therefore rejects roughly a third of *correct* work. A gate tuned never to
reject correct work will accept everything; a gate that treats rejection as final discards a third
of good output. The shape adopted: re-triageable vs terminal states (D1), with a **max-3-attempts**
cap before escalation to the operator — which is also the existing ADR-0070 §4 escalation rule
(*"a round's blocking findings were introduced by the previous round's fixes"*), reused rather
than reinvented.

## 3. Rejected alternatives

**A three-agent topology with a supervising orchestrator** — rejected as originally framed. The
only controlled topology experiment holding tools, prompts and compute constant reports relative
performance vs a single-agent baseline ranging **+80.8% on decomposable financial reasoning to
−70.0% on sequential planning**, with the note that *"tool-heavy tasks appear to incur multi-agent
overhead."* **[RELAYED** — [arXiv:2512.08296](https://arxiv.org/abs/2512.08296)**]** Issue
resolution is both sequential and tool-heavy. What survives from that paper is the *other* result:
a centralized orchestrator contains error amplification from **17.2× to 4.4×** — its value is as a
validation bottleneck, which is what D3 keeps and what the "supervisor" framing discards.

**Webhooks as the primary trigger** — rejected per D4 (no automatic redelivery).

**GitHub Projects v2 as state** — rejected per D1 (GraphQL-only, no cheap polling, no
`GITHUB_TOKEN` access, not an Actions trigger).

**Running the orchestrator inside Actions** — rejected. It inherits the `GITHUB_TOKEN` recursion
guard, drops to a 1,000/hr rate limit, and forfeits the entire Claude Code hook surface. ADR-0067
independently already rules that OAuth stays local.

**A durable-execution engine (Temporal, Restate, DBOS, LangGraph checkpointing)** — rejected at
this scale. Temporal's own agent abstraction is documented as *"earlier than public preview. The
APIs will change"*, and the most credible independent guide argues against adoption at single-repo
scale in favour of *"a SQLite store, a `waiting_human` status, and the conviction that the simplest
correct thing is the right thing until you've got a fleet."* **[RELAYED]** Labels plus a reaper
sweep is that simplest correct thing. Revisit if the factory ever spans repos.

**An LLM reviewer with blocking authority** — rejected by operator ruling (D6).

**Sizing anything from published benchmarks** — rejected per D10.

## 4. Security — issue text is attacker-writable input

vfkb is public. An orchestrator that reads issue bodies and dispatches on them is consuming
untrusted input, and the documented attack is not hypothetical: a planted instruction in a
**public GitHub Issue** leads an agent to pull **private** repo data and open a **public** PR
leaking it — *"not a flaw in the MCP server code itself, but rather a fundamental architectural
issue."* CamoLeak (CVE-2025-59145, CVSS 9.6) exfiltrated private source via hidden markdown
comments. **[RELAYED]**

Two mitigations are in scope for the build and neither is probabilistic, because *"in security,
95% is very much a failing grade"*:

1. **Separate intent from authority** — the agent proposes; the orchestrator performs every
   write, with the write set validated against a schema. This is the `gh-aw` "safe outputs"
   pattern, and it is the same shape as D3.
2. **Dispatch only on issues authored by the operator or an org member** until there is a reason
   to widen it. This is a deliberate restriction of the factory's reach and should be revisited
   explicitly, not eroded.

There is a real tension to state rather than resolve silently: **the isolation that protects
against exfiltration is the same isolation that prevents the agent verifying its own work** —
the exact trap behind dotnet/runtime's 41.7% floor, where the agent *"couldn't compile, because
firewall rules blocked NuGet feeds."* This repo already has a local instance of it: `npm install`
resolves against a corporate Nexus mirror and fails off-VPN (gotcha on record), so a sandboxed
worktree needs a working dependency path decided up front.

## 5. Proof obligations

Per ADR-0029/ADR-0050, each capability carries its own obligation, binding whenever it is built.
Stated here so they cannot be assembled retrospectively:

**P1 — the two new gates must be observed RED first (ADR-0070 §1).** Tamper detection must be seen
failing against a tree with a deliberately deleted test, an added `.skip`, and a `|| true`; the
reproduction gate must be seen failing against a test that passes at the merge base. A gate first
observed green proves nothing, and this is the ordering constraint D8 inherits from ADR-0074's D5.

**P2 — the admission gate needs a can-fail arm.** An L4 in which a deliberately underspecified
issue is **refused** and a well-specified one is **dispatched**, DEMONSTRATED ≥2/3 per ADR-0022.
A gate that admits everything is the failure mode, so the refusal is the load-bearing arm.

**P3 — the dispatcher's completion detection must be observed against the Baton failure.** A
scenario where the agent opens a PR before exhausting its turn budget, asserting the orchestrator
releases the claim rather than scheduling further turns.

**P4 — the reaper must be observed against a killed worker**, asserting reclamation is driven by
state + age with the ownership record left deliberately stale (D11).

**P5 — history stripping must be observed.** A worktree in which the fix exists on another ref,
asserting the agent cannot reach it. Per ADR-0051 §3 this must be a **content assertion over the
output**, not an exit status — the quiet-success trap applies directly, since an agent that finds
the gold diff exits 0 and looks successful.

**Until each of these exists and is named, the only honest status for its clause is "built, NOT
yet verified"** — never "done" or "shipped".

## 6. Open questions — not decided here

1. **Does the coder get network access in its worktree?** §4's tension has no default answer. A
   ruling is needed before D5 is built, not during.
2. **Where does the factory's own state live when the laptop is off?** D4 accepts delay over loss,
   but nothing currently surfaces "the orchestrator has not run in 3 days." `vfkb doctor` is the
   natural home (RFC-024 §1), and the seven-week silent `engine-delivery` red (#285) is the case
   study for what an unsurfaced signal costs.
3. **Does the review agent's advisory output feed the brain?** A `codexw` finding is knowledge; it
   is not obvious whether it belongs in `.vfkb/` as a `fact`, only in the review record, or both.
4. **What is the merge-rate instrument?** D10 says our own rate is the only valid instrument but
   does not specify how it is measured. It should be decided before dispatch begins, because
   retrofitting a baseline is not possible.
