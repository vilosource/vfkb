# vtfkb — Phase 0 Spike Report (cross-harness auto-layer)

> **Date:** 2026-06-03 · **Status:** the **core Phase-0 gate is MET, LIVE, on BOTH
> harnesses** — an engine-injected fact appears *and is used* in Claude Code **and**
> Pi, and a tool-call is captured in both. One greenfield TypeScript engine (zero
> runtime deps), two faces, exercised against a real `claude` CLI (v2.1.161) **and**
> a real `pi` CLI. Implements the locked decisions ADR-0011…0015.
> **Remaining:** container deployment proof + empirical cache-cost measurement.

## What Phase 0 had to de-risk

Per [`vtfkb-IMPLEMENTATION-PLAN.md`](../../viloforge-research/ViloForge-PRD/vtfkb-IMPLEMENTATION-PLAN.md)
§5 + [ADR-0015](../../viloforge-research/ViloForge-PRD/vtfkb-adr/ADR-0015-cross-harness-auto-layer.md):
prove the *path* (engine → harness → model), not the logic, and settle the three
things the hook docs don't: **attention** (does an injected fact actually get *used*),
**budget fit** (10k-char `additionalContext` cap), and **cache cost**.

**Gate:** an engine-injected fact appears **and is used** in the harness; a tool-call
is captured; the bundle fits the cap.

## What was built (this increment)

A minimal but real engine + Claude Code face, **zero runtime dependencies** (pure
Node stdlib — demonstrates [ADR-0013](../../viloforge-research/ViloForge-PRD/vtfkb-adr/ADR-0013-no-hard-native-dep.md)):

- `src/types.ts` — the [ADR-0011](../../viloforge-research/ViloForge-PRD/vtfkb-adr/ADR-0011-envelope-richness.md)
  envelope (validity window + structured `provenance.origin`; trust **derived**).
- `src/engine.ts` — pure-JS JSONL storage (source of truth), `deriveTrust`, the
  [ADR-0005](../../viloforge-research/ViloForge-PRD/vtfkb-adr/ADR-0005-injection-filters-stale.md)+ADR-0011
  injection **filter** (hard gate), the [ADR-0012](../../viloforge-research/ViloForge-PRD/vtfkb-adr/ADR-0012-two-stage-retrieval.md)
  **tiered Heuristic reranker** (soft sort), the ADR-0015 10k-budgeted Tier-A bundle,
  and Tier-B tool-call capture.
- `src/cli.ts` — the thin face the Claude Code hooks call; `hook session-start` /
  `hook post-tool-use` carry the verified Claude Code JSON contract.
- `spike/settings.json` — the Claude Code SessionStart (inject) + PostToolUse (capture) hooks.
- `src/pi-extension.ts` + `src/pi-types.ts` — the **Pi face**: an in-process TS
  extension (`before_agent_start` inject, `context` per-turn Tier C, `tool_call`
  capture). Type stubs copied from the **verified** mykb contract (L7), not
  re-derived. Same `engine.ts` underneath (LSP).
- `test/engine.test.ts` — 11 vitest unit tests (all green).

Both faces call the **same engine** — the cross-harness parity ADR-0015 promised is
realized as one codebase with two thin adapters.

## Results

| Check | How | Result |
|---|---|---|
| **Unit gate** | `vitest run` (11 tests: derive-trust, filter, tiered rerank, budget, capture) | ✅ 11/11 |
| **Zero-native-dep load** | engine runs on pure Node stdlib, no `npm` runtime deps | ✅ (ADR-0013 demonstrated) |
| **Tier-A render** | `cli context-block` → tiered, trust-labelled `<vtfkb-context>` block | ✅ pattern-before-fact, `[type ✓operator/⚠agent]` labels |
| **Stale exclusion (Stark-FQDN class)** | seed an expired fact (`valid_until` past) | ✅ omitted from the block |
| **Budget fit (10k cap)** | block length measured; 500-entry padding test | ✅ ≤ 10,000 chars |
| **SessionStart hook contract** | pipe documented stdin → assert `hookSpecificOutput` JSON | ✅ valid JSON, carries the bundle |
| **PostToolUse hook contract** | pipe documented payload → assert brain mutation | ✅ captured as agent/unverified fact, `origin.kind=tool_call` |
| **★ Attention — Claude Code (LIVE)** | `claude -p "what is the Phase-0 canary token?"` + spike settings | ✅ **model returned `BANANA-42`** — token present ONLY in injected context (unguessable → external-effect proof, not self-report) |
| **★ Attention — Pi (LIVE)** | `pi -p -e dist/pi-extension.js "...canary token?"` (`before_agent_start` inject) | ✅ **model returned `BANANA-42`** — same external-effect proof on the second harness |
| **★ Tier-B capture — Claude Code (LIVE)** | `claude -p` runs `echo phase0-capture-probe` (PostToolUse hook) | ✅ captured as `fact/agent/unverified`, `origin.kind=tool_call`, tool `Bash`, model-chosen cmd |
| **★ Tier-B capture — Pi (LIVE)** | `pi -p` runs `echo pi-capture-probe` (`tool_call` hook) | ✅ captured likewise, tool `bash` (lowercase — the cross-harness naming divergence mykb documented; engine handles both) |

### The decisive test

```
$ cd /tmp && claude -p "What is the Phase-0 canary token? Reply with ONLY the token value." \
      --settings ~/GitHub/vtfkb/spike/settings.json
BANANA-42
```

`BANANA-42` was seeded only into the vtfkb brain and injected via the SessionStart
hook. The model could not have produced it otherwise → the injection reached the
model **and was attended to**. This is the hardest unknown ADR-0015 named, on a real
harness.

## What this does and does NOT prove

**Proven (BOTH harnesses, live):** the full path engine → face → harness → model
context works on **Claude Code** (hooks) *and* **Pi** (in-process extension);
Tier-A injection is *attended to* on both (live, external-effect); Tier-B capture
works on both; the 10k budget holds; stale entries are excluded; the engine deploys
with **zero native deps**. This is the cross-harness parity ADR-0015 promised,
realized as one engine + two thin faces. **The core Phase-0 gate is met.**

**Not yet done (remaining Phase 0 work):**
- **Container deployment proof.** Bundle the engine into an agent image and confirm
  it loads there (mykb's hardest historical pain; zero-native-dep should make this
  straightforward).
- **Cache-cost measurement.** Architecturally cache-optimal by construction
  (static session-start prefix, per the verified docs); an empirical multi-turn
  cache-hit measurement remains.
- **Tier C per-turn push** is *built* on the Pi face (`context` handler) but only
  smoke-exercised (single-turn `-p`); a multi-turn assertion that per-turn deltas
  land is deferred. (Tier C is Pi-only by ADR-0015 — not built for Claude Code.)

## Reproduce

```
cd ~/GitHub/vtfkb && npm install && npm run build && npm test
# live attention test:
export VTFKB_DIR=/tmp/vtfkb-spike-brain && rm -rf "$VTFKB_DIR"
node dist/cli.js add fact "The Phase-0 canary token is BANANA-42." --role human
cd /tmp && claude -p "What is the Phase-0 canary token? Reply with ONLY the token value." \
      --settings ~/GitHub/vtfkb/spike/settings.json          # -> BANANA-42
# same test, Pi harness:
cd /tmp && VTFKB_DIR=/tmp/vtfkb-spike-brain pi -p -e ~/GitHub/vtfkb/dist/pi-extension.js \
      --no-tools "What is the Phase-0 canary token? Reply with ONLY the token value."   # -> BANANA-42
```
