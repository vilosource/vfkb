# RFC-009: L4 sandbox hardening + a home for Tier-0 platform-contract probes

- **Status:** Proposed — **evidence-gated / parked** (no build until a trigger below fires)
- **Date:** 2026-06-29
- **Deciders:** operator + Claude
- **Relates:** [ADR-0022](../adr/ADR-0022-l4-evaluation-methodology.md) (the L4 harness this would extend),
  [ADR-0023](../adr/ADR-0023-scenario-contract-first.md) (scenario-as-DoD), [RFC-008](RFC-008-decision-capture-reminder.md)
  (the probe that motivated splitting this out), [ADR-0015](../adr/ADR-0015-cross-harness-auto-layer.md)
  (P1 external-block — the canonical version-pinned finding). Brain decision `a16022550efc`.

## Context

Scoping RFC-008's Stop-hook probe surfaced a set of L4-harness improvements. Bundling them into RFC-008
would have inverted the build order (a 30-min probe blocked on multi-day infra), so they are **split here
and explicitly evidence-gated** (ADR-0016 G1 discipline: an RFC decides the *shape*; the *build* triggers
on observed evidence or an explicit request).

The L4 sandbox today (ADR-0022) is genuinely good: two pinned, self-contained Docker images
(`vfkb-l4-pi:dev` = pi 0.73.1 + DeepSeek; `vfkb-l4-claude:dev` = claude-code 2.1.195 + Max-subscription
OAuth), the container *is* the sandbox (no host FS/MCP/creds beyond scoped mounts), a uid-matched `/brain`
bind-mount for cross-session continuity, N=3 / ≥2/3 = DEMONSTRATED, image digest pinned in records. The
weaknesses are at the edges: **version drift, no regression trigger, and no home for one-off platform
probes.**

## Conceptual framing — two axes, not one pyramid

The testing model is **two axes**, not a single stack:
- **The pyramid** = repeatable *verification gates* — deterministic unit/integration (`npm test`) → the
  live L4 purpose harness. (Honesty fix: there is no separate "integration tier"; it is the subset of
  vitest tests that spawn the real CLI/MCP process. We describe it as **one deterministic gate + one live
  gate**, integration being a *property* of some unit tests.)
- **Probes / spikes** = one-shot *discovery* of an external/harness contract, producing a **version-pinned
  finding** (a `gotcha`/`fact` in `.vfkb`), which then *informs* design and gating. The RFC-008 Stop-hook
  test is the first named instance ("Tier-0 platform-contract probe"). Its output is **knowledge, not a
  CI gate**.

These feed each other: a probe settles a contract; if we then *build on* that contract, a cheap guard can
graduate onto the pyramid (the "deterministic backstop > probabilistic gate" principle applied to external
contracts).

## Proposed improvements (each independently gated)

1. **Pinned-version drift banner** (was over-scoped as a "single source of truth" refactor). The runner
   prints the image's baked agent version vs the host version and **warns loud on mismatch**. Records
   already pin the digest, so this is a *warning*, not a new config system. **Trigger:** first time a stale
   image silently diverges from the host, or an explicit ask.
2. **Probe-mode beside L4 scenarios** — reuse the pinned image as the sandbox for Tier-0 platform-contract
   probes (e.g. the Stop-hook contract), so a probe's finding is co-versioned with the agent it tested.
   ⚠️ **Faithfulness caveat (learned from RFC-008):** the L4 path drives `claude -p`; a feature that
   deploys into *interactive host* sessions must be probed in a mode that matches — or the print/docker
   vs interactive/host delta must be stated in the finding. Co-versioning with L4 is only a benefit when
   L4's environment *is* the deployment target. **Trigger:** a 2nd platform probe needs a sandbox, or an
   explicit ask.
3. **Readiness gate before the scored turn** — poll `tools/list` (or equivalent) until ready, killing the
   known `claude -p` MCP cold-start race (intermittent "tools still connecting"; brain-confirmed *not* a
   regression). **Trigger:** the race produces a false-RED on a run we care about.
4. **Cost + model-build telemetry in records** — per-trial tokens/cost/wall-clock + the model's reported
   build where the API exposes it (the model is the one thing the image can't pin). **Trigger:** a paid
   run we want to budget, or a suspected model-side drift.
5. **Triggered re-validation on version bump** (depends on #1) — when the pin moves, re-run the affected
   scenarios/probes. The regression signal L4 currently lacks. **Trigger:** after #1 lands.
6. **Auto-layer wiring smoke gate** — ✅ **DELIVERED 2026-06-29** ([ADR-0028](../adr/ADR-0028-sandbox-validate-auto-layer-wiring.md),
   `scenarios/wiring-smoke.mjs`). The sandbox's second job beyond contract probes: drive real `claude`
   turns against the **candidate** `.claude/settings.json` and assert hooks fire/suppress/terminate
   **before** promoting to the live config. First case = ADR-0027's Stop wiring. Extends as new
   hooks/MCP wiring are added.

## Alternatives

- **Keep bundling these into RFC-008.** Rejected — inverts build order; RFC-008 stands on its verified
  contract without any of this.
- **Build the harness improvements speculatively now.** Rejected — violates evidence-gated discipline; no
  trigger has fired.
- **Treat probes as just another L4 scenario.** Rejected — a probe's output is a *finding*, not a
  pass/fail purpose-demonstration; conflating them muddies ADR-0022's "purpose, not invariants" boundary.

## Open items

1. Promote the **two-axis testing model + the honest "2 gates" correction** into `CLAUDE.md` / the roadmap
   §5 standing principles (and decide whether it warrants its own ADR). *(Separate from this harness RFC.)*
2. Decide the **re-verification mechanism** for version-pinned findings (#5) — surfaced at `resume`, or a
   preflight check.
3. Confirm each improvement's **trigger** is the right one before any build.
