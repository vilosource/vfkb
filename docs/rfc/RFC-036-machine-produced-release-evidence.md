---
type: Proposal
title: "RFC-036: Machine-produced release evidence — moving the L4 re-pins off the operator's machine without weakening what they prove"
description: "The plugin release gate demands four metered L4 records re-pinned to every shipping version, and today they can only be produced on the operator's laptop against interactive OAuth. This proposes the trust-model change that lets trusted automation produce them — the constitutional question ADR-0050/0051 leave open — plus the credential, hosting, fork-safety and flake decisions it forces. Recommends kagent (already deployed) over ARC (controller deployed, zero runners) and an OAuth-copy model gated behind a private mirror, because the harness supports no other credential today."
status: "Proposed"
timestamp: 2026-07-19
---

# RFC-036: Machine-produced release evidence

- **Status:** Proposed — needs operator ratification before any build
- **Fixes on ratification+build:** [vfkb-claude-plugin#24](https://github.com/vilosource/vfkb-claude-plugin/issues/24);
  unblocks [#25](https://github.com/vilosource/vfkb-claude-plugin/issues/25) and the
  [#26](https://github.com/vilosource/vfkb-claude-plugin/issues/26) umbrella
- **Relates:** [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) and
  [ADR-0051](../adr/ADR-0051-delivery-honesty.md) (the evidence rules this changes the
  *producer* of, never the *content* of); ADR-0060/0061 (tag + version Brake);
  ADR-0022 (DEMONSTRATED ≥2/3)

## Context — why this is a constitutional question, not a CI chore

Every plugin release must ship with four **version-bound, DEMONSTRATED** L4 records:
`brief-skill`, `hooks-smoke`, `inactive-signal`, `install-path`. The release gate rejects a
record bound to any other `pluginVersion`, so a version bump is unshippable until all four are
re-produced.

Today they can only be produced on the operator's machine. This is not a preference — it is
**verified in the harness**: `scenarios/hooks-smoke.mjs:74-80` and
`scenarios/install-path.mjs:110-115` read `~/.claude/.credentials.json`, **throw** if there is
no `claudeAiOauth` block, and copy that block into a sandboxed `HOME`. There is no API-key path
in the code at all.

I ran all four by hand for v0.11.0 on 2026-07-18 (each DEMONSTRATED; `install-path` alone is
~12 metered sessions). That is the bottleneck #24 names, and it is the last irreducibly manual
step of an otherwise automated chain.

**The reason this needs an ADR rather than a PR:** ADR-0050/0051 and `RELEASING.md` ("run
locally") assume evidence is produced by the operator, on the operator's machine, under the
operator's credential. Moving production to a machine changes *who vouches for the run*. That
is a trust-model change to a constitutional rule, and this project's own precedent (ADR-0051,
where a `--plugin-dir` shortcut quietly weakened a non-negotiable) is that such a change is
ratified explicitly or not at all.

## What must NOT change

Automation changes **who does the work**, never **what counts as proof**:

- real `claude -p` sessions, sandboxed `HOME`, no `--plugin-dir`, no directory source;
- the can-fail arm must still be able to fail, and must be observed failing;
- records stay version-bound **and** tree-bound (the #22 fix — my v0.11.0 `install-path` run
  reported `ref under test = chore/revendor-0.11.0 @ 41382328 (plugin/ tree 2f5a400b9008)`,
  which is what makes a pre-merge re-pin honest);
- DEMONSTRATED remains ≥2/3 recomputed by the gate, never asserted by the producer.

## Decisions this RFC asks the operator to make

### D1 — Credential model

| Option | Assessment |
|---|---|
| **A. Copy operator OAuth to the runner** | The only option the harness supports **today** (verified above). Blast radius: the token is the operator's full Claude identity. Refresh/rotation is fragile — an expired token turns every release red with an auth error, not a proof failure. |
| **B. Metered API key held by the runner** | Cleaner blast radius and rotation, and cost is explicitly not a constraint (operator directive 2026-07-16). **Requires a harness change** — the scenarios must accept an API key, and it is **UNVERIFIED** whether `claude -p` under an API key reproduces the same plugin/hook behaviour the OAuth path exercises. That must be probed before adoption, not assumed. |

**Recommendation: B, gated on a Tier-0 probe** that an API-key session loads plugins and fires
hooks identically. Fall back to A only if the probe shows a behavioural difference — in which
case the difference itself is a finding worth recording.

### D2 — Where it runs

Verified on the cluster 2026-07-19:

- **kagent: DEPLOYED and in use** — `kagent-controller` (19d), `k8s-agent` (19d),
  `dev-assistant` (15d), `vilonotes-researcher` (14d). #24 asks whether the endpoint exists;
  it does, and it is already hosting a real agent.
- **ARC: controller deployed, capacity absent** — `arc-gha-rs-controller` (18d) is running, but
  there are **no runner pods and no runner scale set**, and
  `repos/vilosource/vfkb-claude-plugin/actions/runners` reports **0**. So "self-hosted runner"
  is not a ready option; it is a build.

**Recommendation: kagent.** It is the only option that exists today, it gives
retry-with-diagnosis on a flaky red instead of a dead red PR (#24's own candidate note), and it
is the first genuine fleet-wiring step — the thing V2-VISION §2 stress-tests the design
against. ARC stays the fallback if kagent proves unsuitable, and provisioning it is then its
own issue.

### D3 — Public-repo safety

`vilosource/vfkb-claude-plugin` is **public**. A workflow holding a Claude credential must be
unreachable from arbitrary PRs and forks. Proposed constraints:

- evidence production is **never** triggered by `pull_request` from a fork;
- the credential lives in an **environment** with required reviewers, or the job runs only on
  branches in the upstream repo;
- the run is triggered by the release automation (#23) on a re-vendor branch, not by arbitrary
  contributor input.

This needs stating in the ADR because "we'll be careful" is not a control.

### D4 — Flake policy

DEMONSTRATED is ≥2/3, which already tolerates one bad trial. A **fully** red run needs a
defined path rather than a stuck release:

1. retry once, automatically;
2. on a second red, **do not** silently retry again — attach the transcript and escalate
   loudly (the run is evidence that something is wrong, and burying it is the failure ADR-0051
   §3 exists to prevent);
3. never auto-relax a threshold to get green.

### D5 — Provenance in the record

#24 requires records to say where and by what they were produced. Proposed: each record gains a
`producedBy` block (`host`/`runner`, credential *kind* — never the value, workflow run URL,
commit + tree). The gate should **require** it once ratified, so an unprovenanced record cannot
pass — otherwise the field is decoration.

## Definition of Done

- The operator ratifies D1–D5 as an ADR in this repo (the trust-model change on the record).
- A release branch's full four-record re-pin is produced unattended by the ratified mechanism,
  and the records pass the **existing** gate unchanged.
- Records carry provenance, and the gate enforces its presence.
- The can-fail arm is observed failing in the automated environment — a proof that cannot fail
  proves nothing, and that property must survive the move off the laptop.

## Explicitly not in scope

The merge policy (#25) — a green release PR merging itself — is a separate decision that
depends on this one. There is nothing safe to auto-merge until the evidence is machine-produced
*and* machine-trustworthy.
