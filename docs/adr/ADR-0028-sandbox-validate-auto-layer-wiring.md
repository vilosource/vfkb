# ADR-0028: Auto-layer wiring is sandbox-validated before promotion to the live config

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** operator + Claude
- **Origin:** the 2026-06-29 ADR-0027 build. While wiring the Stop-hook reminder, the plan was to add
  it to the live `.claude/settings.json` and "verify on a live turn here." The operator caught this as a
  process gap: that validates a behavior-changing config edit *in production*. The same had happened on
  the initial auto-layer wiring (commit `1135b46`).
- **Relates:** [ADR-0015](ADR-0015-cross-harness-auto-layer.md) (the auto-layer this governs),
  [ADR-0023](ADR-0023-scenario-contract-first.md) (RED-before-promotion, here applied to *wiring*),
  [ADR-0027](ADR-0027-stop-hook-decision-capture-reminder.md) (the first feature gated by this),
  [RFC-009](../rfc/RFC-009-l4-harness-and-platform-probes.md) (the gate lives in the harness/probe family).
  Brain decision `3c989cb9e6f6`.

## Context

vfkb has sandboxed stages for nearly every layer: deterministic unit tests (engine), Tier-0 platform
probes (the harness contract, e.g. the Stop-hook JSON), and the L4 purpose harness (agent-observable
behaviour). The one thing **without** a sandbox stage was the **auto-layer wiring itself** — the
`.claude/settings.json` / `.mcp.json` that binds the engine to the harness. It was promoted straight to
the live config and validated only by running a session here.

That is uniquely hazardous in this repo: `.claude/settings.json` is **both** the config governing the
developer's own sessions **and** the product artifact under development. Editing it live = changing the
tool while using it. A mis-built *blocking* hook (e.g. a Stop hook whose loop guard is wrong) could wedge
or nag every subsequent turn of the very session building it.

## Decision

**Any change to the auto-layer wiring (`.claude/settings.json`, `.mcp.json`, or the equivalent Pi face)
must pass a sandbox wiring-validation gate before it is promoted to the live, committed config.**

1. **The gate drives the real harness against the candidate wiring in a throwaway sandbox** — it is not a
   reconstruction or a simulation. For Claude Code: a temp git repo + a `.vfkb` brain + the **candidate**
   `settings.json`, driving real `claude` turns and asserting the hooks fire and behave (fire/suppress,
   loop-terminate, no wedge). Implemented as `scenarios/wiring-smoke.mjs` (ADR-0027's Stop wiring is its
   first case).
2. **Observation without prod instrumentation** — the sandbox may wrap the real hook command for
   observation (e.g. tee its stdout); the command under test stays byte-for-byte the one to be promoted.
3. **Promote only on green.** The live edit must be a copy of wiring already proven in the sandbox — never
   a first run. (This is ADR-0023's "RED before promotion" applied to wiring rather than to a scenario.)
4. **Metered, not in `npm test`.** The gate drives live `claude`/`pi` turns (tokens, minutes), so it is a
   `scenarios/`-style gate run at promotion time, like L4 — not the deterministic inner loop.

## Consequences

- **+** A behavior-changing config edit is proven in isolation before it can affect a live session;
  closes the "editing the tool while using it" hazard.
- **+** Gives the auto-layer wiring the same evidence discipline the rest of the stack already has, and
  gives RFC-009's sandbox a second job beyond contract probes: wiring-integration validation.
- **+** Repeatable: future hooks/MCP wiring add a case to the gate instead of being hand-checked live.
- **−** Promotion costs a metered sandbox run. Mitigated: it is small (a couple of tiny turns) and only
  at promotion, not per edit.
- **−** The gate validates *wiring/plumbing* (does the hook fire and behave), not agent *purpose* — that
  remains the L4 harness's job (ADR-0022/0023). The two are complementary, not substitutes.

## Alternatives Considered

- **Validate on a live turn in this repo (status quo).** Rejected — tests in production; the gap this ADR
  closes.
- **Unit tests only.** Rejected — unit tests prove the command's logic but never that the *harness fires
  it via the committed settings shape*; that is exactly where wiring bugs hide (cf. ADR-0023's
  undelivered-on-a-harness gap).
- **Full L4 scenario for every wiring change.** Rejected — heavier than needed; wiring validation is a
  plumbing smoke test, not a purpose-demonstration.

## Related

[ADR-0015](ADR-0015-cross-harness-auto-layer.md), [ADR-0023](ADR-0023-scenario-contract-first.md),
[ADR-0027](ADR-0027-stop-hook-decision-capture-reminder.md),
[RFC-009](../rfc/RFC-009-l4-harness-and-platform-probes.md). Code: `scenarios/wiring-smoke.mjs`. Brain:
decision `3c989cb9e6f6`.
