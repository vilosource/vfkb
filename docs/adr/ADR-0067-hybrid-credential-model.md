---
type: Decision
title: "ADR-0067: Hybrid credential model for machine-produced plugin evidence — DeepSeek in CI, OAuth stays on the laptop (accepts RFC-036)"
description: "RFC-036's remaining constitutional question was who vouches for the Claude-plugin L4 records and with what credential. The 2026-07-25 spike (plugin#45) falsified the forced choice — headless Claude Code works on DeepSeek env auth, full plugin pipeline observed — so the operator ratified HYBRID: per-release CI evidence on the DEEPSEEK_TOKEN secret via the pi package's proven produce→vouch shape, with the operator's Claude OAuth never leaving the laptop and occasional laptop runs as the full-fidelity check. CI records are honestly scoped (harness wiring on deepseek-v4-pro, not the production model config); records gain required producedBy provenance; a bad token hangs rather than failing fast, so per-turn timeouts are load-bearing."
status: "Accepted"
timestamp: 2026-07-25
---

# ADR-0067: Hybrid credential model for machine-produced plugin evidence

- **Status:** Accepted
- **Date:** 2026-07-25 (operator ratification: "hybrid", after the three options were
  presented with trade-offs; recommendation was hybrid)
- **RFC:** [RFC-036](../rfc/RFC-036-machine-produced-release-evidence.md) — accepted by this
  ADR. The pi side shipped 2026-07-24 without needing ratification (no personal credential);
  this ADR closes the Claude-plugin side, the part that was constitutional.
- **Relates:** [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md) /
  [ADR-0051](ADR-0051-delivery-honesty.md) (the evidence rules — this changes the *producer*,
  never the *content*); [ADR-0022](ADR-0022-l4-evaluation-methodology.md) (DEMONSTRATED ≥2/3,
  recomputed); [ADR-0066](ADR-0066-pi-package-delivery.md) (the pi package whose
  produce→vouch shape this reuses)
- **Brain:** ruling `4ee7b78fd065`; spike result `98fa0f1d171f`; spike issue link
  `0158a50ffd45`; pi-side precedent `af129ce53586`/`44be0c1efb06`
- **Fixes / unblocks:** [vfkb-claude-plugin#24](https://github.com/vilosource/vfkb-claude-plugin/issues/24),
  [#25](https://github.com/vilosource/vfkb-claude-plugin/issues/25) (merge policy — still its
  own decision), [#26](https://github.com/vilosource/vfkb-claude-plugin/issues/26),
  [#45](https://github.com/vilosource/vfkb-claude-plugin/issues/45) (the spike)

## Context

Every plugin release must re-pin four version-bound DEMONSTRATED L4 records. Until now they
could only be produced on the operator's laptop, because the scenarios stage the operator's
Claude OAuth into a sandboxed `HOME` — the last irreducibly manual step of the release chain,
and a trust-model question ADR-0050/0051 reserve for the operator.

RFC-036 originally collapsed the credential choice to "copy the operator's OAuth to a runner"
after option B (an Anthropic API key) was declined. The 2026-07-25 spike
([plugin#45](https://github.com/vilosource/vfkb-claude-plugin/issues/45)) broke that collapse:
headless Claude Code (CLI 2.1.220) authenticates via `ANTHROPIC_BASE_URL` +
`ANTHROPIC_AUTH_TOKEN` against DeepSeek's Anthropic-compatible endpoint, and the **whole
plugin pipeline was observed working** under env-only auth — real marketplace add/install,
all four hook events, the deferred-tool MCP round-trip, and a causally clean no-plugin
contrast (`hooks-smoke` wired arm 6/6, unwired 0/4, N=1).

## Decision

**D1 — credential model: HYBRID.**

1. **Per-release CI evidence runs on DeepSeek env auth.** The four scenarios run on GitHub
   runners authenticated by the `DEEPSEEK_TOKEN` repository secret (the model already
   accepted for vfkb-pi-package), via the same produce→vouch two-job split proven there:
   `produce` holds the key and cannot push; `vouch` re-derives the verdict with the gate's
   own recompute and can push, but never sees the key.
2. **The operator's Claude OAuth never reaches a runner.** Full-fidelity runs (Anthropic
   models, the config real consumers use) stay on the laptop via the P11-a release wrapper,
   executed occasionally at the operator's cadence — before major releases or when CI
   evidence looks suspicious — not per-release.
3. Options rejected: **A-only** (OAuth on the runner: carries the operator's full Claude
   identity for fidelity the hybrid gets at lower frequency), **B** (Anthropic API key:
   already declined, and moot now that C exists).

**D2 — where it runs: plain GitHub-hosted runners.** The kagent/ARC question the RFC weighed
existed only because a runner was going to hold the operator's OAuth. Under hybrid the CI
side holds a revocable third-party API key, exactly like the pi package — which runs on
GitHub-hosted runners, observed working. kagent/ARC are not needed and not used for this.

**D3 — public-repo safety: the pi package's constraints, verbatim.** Evidence production
triggers are `workflow_dispatch` + `push:main` only — never `pull_request` — so no fork ever
sees the key; `produce` runs with `permissions: contents: read`; the vouch push is
pathspec-scoped and cannot retrigger the workflow. These are the controls already live in
`vfkb-pi-package/.github/workflows/l4-install-path.yml`.

**D4 — flake policy: as proposed, plus the spike's timeout finding.** One automatic retry of
a fully red run; a second red escalates loudly with the transcript attached — never a silent
third retry, never an auto-relaxed threshold. Additionally (observed in the spike): **a bad
or rotated token makes `claude -p` hang to the timeout rather than fail fast**, so every
turn carries a tight timeout and a first-turn timeout is read as an auth-shaped failure, not
a model flake.

**D5 — provenance: required, phased in with the first machine re-pin.** Every record gains a
`producedBy` block: where it ran (`laptop`/`github-runner`), the credential *kind*
(`claude-oauth`/`deepseek-env` — never a value), the auth base (production Anthropic vs the
DeepSeek endpoint), workflow run URL when applicable, commit and tree. The gate **requires**
the block — enforcement lands together with the first full unattended re-pin, since the gate
cannot demand a field the four already-committed laptop records lack without going red on
`main` retroactively.

**Honest scoping of CI records (binding wording rule):** a DeepSeek-produced record proves
the plugin's *harness wiring* — hooks, skills, MCP, marketplace resolution — on
`deepseek-v4-pro`. It does not prove behaviour on the production model config; that is what
the laptop leg of the hybrid is for. Specifically, `brief-skill`'s pinned-model assertion is
re-worded to what it can honestly observe under CI: *the skill's model pin is honored*
(`modelUsage` reports the pinned model — mechanism observed working in the spike), not "it
runs on Haiku".

## Consequences

- The release bottleneck (#24) closes: a version bump's re-pin is producible unattended.
- Two record populations exist by design; `producedBy` makes them distinguishable at a
  glance, and the gate's verdict rules (ADR-0022, recomputed, can-fail arm observed failing)
  apply to both unchanged.
- The merge policy (#25 — may a green release PR merge itself) remains a separate, undecided
  question; nothing in this ADR auto-merges anything.
- The laptop leg has no mechanical trigger — its cadence is operator judgment. If it decays
  to "never", the fidelity check silently disappears; the RELEASING.md hybrid section must
  state the expectation so the decay is at least visible.
- Definition of Done for the build this ADR unlocks (RFC-036 §DoD, unchanged): a full
  four-record re-pin produced unattended by this mechanism, passing the existing gate, with
  provenance present and the can-fail arm observed failing in the automated environment.
