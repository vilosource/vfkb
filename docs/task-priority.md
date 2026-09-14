# Task priority — open-issue triage

**Scope, so this does not become a second roadmap.** This file triages the **open GitHub issue
queue**: what to pick up next and why. It is *not* an execution authority.
[`H4-DEVELOPMENT-ROADMAP.md`](H4-DEVELOPMENT-ROADMAP.md) §4 remains the ratified track order
(CLAUDE.md, "roadmap-as-authority"); [`V2-ROADMAP.md`](V2-ROADMAP.md) tracks v2 initiatives. When a
tier-1 item here implies a *track*-level change, the move is to update and re-ratify the roadmap —
not to grow this file into one.

> **The roadmap is stale.** §4's last entry is the PI-CODING-AGENT initiative (2026-07-22..23) and
> the file was last touched **2026-07-25**. Everything since — the ADR-0064 journal, ADR-0070,
> ADR-0072/0073, plugin v0.18.x/v0.19.0, the whole `$CLAUDE_CONFIG_DIR` arc — is unrecorded there.
> CLAUDE.md says a "what's next?" urge is a signal to re-ratify it. That re-ratification is itself
> the highest-value item on this page, and it is an operator act, not an agent one.

**Maintenance:** re-sort when an issue is filed, closed, or its evidence gate fires. Every priority
claim below names *why now*, so a stale rationale is visible rather than inherited.

*Last reviewed: 2026-09-14.*

---

## Tier 1 — act next

### 1. [#261](https://github.com/vilosource/vfkb/issues/261) — `adr-lint` verifies that ADR citations resolve

**Its evidence gate has fired.** The issue reads *"build on the next ADR-overclaim incident, or on
operator request."* That incident is on the record: **ADR-0073 carried false claims through two
consecutive review rounds** — "rode a larger **reviewed** PR" (false), corrected to "**none** of the
nine carries a review record" (false in the other direction; the executed count is 2 with a record,
7 without), plus a §4 sentence saying "five injections" over a list of seven of which four applied.

That is exactly the defect class #261 names: *ADR sentences asserting structural properties nothing
enforces*. Four adversarial review rounds caught it; a lint rule would have caught it on the first
commit, for a fraction of the cost. `adr-lint` already exists and already polices build-status prose,
so this extends a live mechanism rather than adding one.

Composes with brain gotcha `836d111fb67e` — machine-check claims instead of trusting careful writing.

### 2. [#267](https://github.com/vilosource/vfkb/issues/267) — no amend path for fluid entries; `index-meta.json` `entry_count` drifts

The only open issue that bites the **daily knowledge-recording loop**. `updateEntry()` exists and
works, but neither `kb_add` nor the CLI exposes a way to target an existing id, so a fluid entry
cannot be corrected through any shipped surface. Found in a real downstream project during its own
review loop, not theorised. Carries a second, separable defect: derived `entry_count` drifting from
the ledger.

---

## Tier 2 — real, bounded

### 3. [#259](https://github.com/vilosource/vfkb/issues/259) — `kb_resume` debounce applies to every MCP instance

`{ debounce: true }` is passed unconditionally, so the 15-minute window covers every server
instance rather than only the hook-driven one. Consumer-visible: a repo wired with `.mcp.json` and
no SessionStart hook behaves wrong. Narrow fix, repro already reproduced against the real stdio
server by the filer.

### 4. [#288](https://github.com/vilosource/vfkb/issues/288) — `vfkb-pi-package` vendors a 7-week-stale engine

All four bundles drifted (verified 2026-09-14 by building from `main` and comparing). The
re-vendor is mechanical; **the real decision is whether the drift check should stay
`continue-on-error`.** If the pi face is supported, a silent warning is the wrong instrument —
[#285](https://github.com/vilosource/vfkb/issues/285) is the case study for what a quiet signal
costs. If it is not supported, archiving is more honest than a warning nobody reads.

### 5. [#262](https://github.com/vilosource/vfkb/issues/262) — `engineBuildHash` on every scenario record

Deliberately deferred: *"land the helper first; adopt per-scenario as records naturally
regenerate."* Eight records regenerated on 2026-09-13/14 (v0.18.1 and v0.19.0) **without** the
helper in place — that adoption window has closed, and the next one is the following plugin
release. Landing the helper before then is what makes the next regeneration free.

---

## Tier 3 — latent, no observed trigger

### 6. [#273](https://github.com/vilosource/vfkb/issues/273) — session-id → filename mapping is lossy

`safeKey` collapses `session/a`, `session?a` and `session:a` onto one filename. Pre-existing since
the ADR-0044 storage seam. **Not observed live** — harness ids are UUID-like; exposure needs
`KB_SESSION_ID` overrides or a future harness with structured ids. Real, dormant.

### 7. [#208](https://github.com/vilosource/vfkb/issues/208) — journal gate as a capability, not a backend-name match

Gated on `storageBackend().name === 'jsonl-fs'`, which is precise today and becomes wrong the
moment a second fs-like backend exists. Pure robustness; nothing is broken now.

---

## Blocked on someone else

### 8. [#229](https://github.com/vilosource/vfkb/issues/229) — a hung MCP server loses a tool call silently and wedges the turn

**Highest severity on this page, and not actionable here.** Observed with a committed probe record:
a stdio MCP server that stays alive but stops answering makes the agent's tool call never return,
with **no error surfaced to the model**. `EXTERNAL-BLOCKED` on Claude Code.

The only move available is to re-probe against current CLI versions periodically and update the
record — which also keeps the evidence fresh if the upstream behaviour ever changes.

---

## Recently closed

| | |
|---|---|
| [#285](https://github.com/vilosource/vfkb/issues/285) | `engine-delivery` red for 7 weeks with real drift behind it. Resolved 2026-09-14: stale `re-vendor/engine` deleted (recoverable from `01ff5b26`), workflow re-dispatched — first success since 2026-07-23 — and v0.19.0 shipped, carrying #281's engine fixes to consumers. Residual tracked as #288. |
| [#280](https://github.com/vilosource/vfkb/issues/280) | Review gate did not cover `.claude/vfkb-guard.mjs`. Closed by #283, which also found and closed a second gap of the same shape (`docs/templates/`) and ratified the rule as ADR-0073: **the gate follows delivery, not directory**. |
