# vtfkb — Phase 0 Spike Report (Claude Code harness increment)

> **Date:** 2026-06-03 · **Status:** Claude Code half of the Phase-0 gate **PASSED (live)**.
> Greenfield TypeScript engine (zero runtime deps), exercised against a **real
> `claude` CLI session** (v2.1.161). Implements the locked decisions ADR-0011…0015.

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
- `src/cli.ts` — the thin face the hooks call; `hook session-start` / `hook
  post-tool-use` carry the verified Claude Code JSON contract.
- `src/harness/claude-code/` + `spike/settings.json` — the SessionStart (inject) and
  PostToolUse (capture) hooks.
- `test/engine.test.ts` — 11 vitest unit tests (all green).

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
| **★ Attention (LIVE)** | `claude -p "what is the Phase-0 canary token?"` with the spike settings | ✅ **model returned `BANANA-42`** — a token present ONLY in the injected context (unguessable → external-effect proof, not self-report) |
| **★ Tier-B capture (LIVE)** | `claude -p` runs a real `echo phase0-capture-probe` Bash tool with the PostToolUse hook | ✅ captured live as `fact/agent/unverified` with `origin.kind=tool_call`, carrying the command the **model** chose |

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

**Proven (Claude Code harness):** the full path engine → CLI → hook → harness → model
context works; Tier-A injection is *attended to* (live); Tier-B capture works; the
10k budget holds; the engine deploys with zero native deps.

**Not yet done (remaining Phase 0 work):**
- **Pi harness half.** The other side of "both harnesses" — the in-process TS
  extension face (study mykb's `src/extension/index.ts` contract). Lower-risk
  (in-process) per ADR-0015, but unproven here.
- **Container deployment proof.** Bundle the engine into an agent image and confirm
  it loads there (mykb's hardest historical pain).
- **Cache-cost measurement.** Architecturally cache-optimal by construction
  (static session-start prefix, per the verified docs); an empirical multi-turn
  cache-hit measurement remains.
- **Per-turn push (Tier C)** is Pi-only by decision (ADR-0015) — not in scope to
  build for Claude Code.

## Reproduce

```
cd ~/GitHub/vtfkb && npm install && npm run build && npm test
# live attention test:
export VTFKB_DIR=/tmp/vtfkb-spike-brain && rm -rf "$VTFKB_DIR"
node dist/cli.js add fact "The Phase-0 canary token is BANANA-42." --role human
cd /tmp && claude -p "What is the Phase-0 canary token? Reply with ONLY the token value." \
      --settings ~/GitHub/vtfkb/spike/settings.json
```
