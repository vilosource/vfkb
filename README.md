# vtfkb — VFSF per-project knowledge substrate

Greenfield TypeScript reimplementation of a per-project knowledge memory for the
ViloForge software factory. **One engine, two harness faces** (Claude Code hooks +
Pi in-process extension) over an append-only JSONL brain. **Zero runtime
dependencies** (pure Node stdlib) — drops into any node container with no install.

Design + decisions live in
[`vilosource/viloforge-research` → `ViloForge-PRD/`](https://github.com/vilosource/viloforge-research/tree/develop/ViloForge-PRD):
`vtfkb-DESIGN.md`, `vtfkb-IMPLEMENTATION-PLAN.md`, and the ADR log
[`vtfkb-adr/` (ADR-0001…0015)](https://github.com/vilosource/viloforge-research/tree/develop/ViloForge-PRD/vtfkb-adr).

## Status

| Phase | What | State |
|---|---|---|
| **0** | Deployment + cross-harness auto-layer spike | ✅ **DONE** — inject+attention+capture proven LIVE on Claude Code **and** Pi; container proof; cache confirmed. See [`spike/PHASE0-REPORT.md`](spike/PHASE0-REPORT.md). |
| **1** | Storage kernel — append-only JSONL + tombstones, LWW, content-hash freshness, pluggable index | ✅ **DONE** (`storage.ts`, `index-store.ts`) |
| **2** | Decision family — immutable-supersede, status lifecycle, Constitution, ADR ordinals, vision patterns | ✅ **DONE** (`engine.ts`) |
| **3** | Read layer — D5c filters, BM25-lite search, Context Map (ADR-0006); Stark-FQDN E2E | ✅ **DONE** (`read.ts`); bundle live-verified |
| **4** | MCP server — 7 scoped tools (cross-harness pull baseline, D5a); protocol e2e | ✅ **DONE** (`mcp-server.ts`); live-verified in Claude Code |
| **5** | Auto-layer polish — session isolation (`KB_SESSION_ID`, L4), per-turn Tier-C delta, tool-gating | ✅ **DONE** (`session.ts`, `gating.ts`); gating live-verified in Claude Code |
| **6** | Guardrails + git — no-secrets write-time lint (D6e), `save`/`saveAndPush` lifecycle | ✅ **DONE** (`secrets.ts`, `git.ts`) |

**v1 per-project tier feature-complete (Phases 0–6).** Deferred to later tiers: global served tier + promotion, Context Map Glossary/Routing, ACE curator, embedding reranker, SQLite/FTS5 backend.

## Layout

```
src/types.ts        ADR-0011 envelope (validity window + provenance.origin; trust derived)
src/storage.ts      append-only JSONL kernel; tombstones; LWW; content-hash freshness (ADR-0013/0014)
src/index-store.ts  pluggable KbIndex; pure-JS in-memory default; SQLite/FTS5 optional (ADR-0013)
src/engine.ts       facade: filter (ADR-0005) · tiered reranker (ADR-0012) · render (ADR-0015) ·
                    decision family (ADR-0004/0007/0008/0009) · capture
src/cli.ts          Claude Code face — `hook session-start` / `hook post-tool-use`
src/pi-extension.ts Pi face — before_agent_start inject · context (Tier C) · tool_call capture
spike/              Phase-0 settings, Dockerfile, container smoke, report
test/               vitest (engine · storage · decision-family) — 27 tests
```

## Build & test

```
npm install
npm run build      # tsc -> dist/ (no native modules)
npm test           # vitest: 49 unit/integration/protocol tests
```

## Proving the purpose (L4 scenario harness)

Unit tests prove the modules are correct; the L4 harness proves vtfkb fulfils its
**purpose** — that a real agent behaves *better because of it*. It drives `claude -p`
through tasks whose correct outcome depends on vtfkb's knowledge, asserts on
**observable effects** (what the agent outputs), and **contrasts against a baseline**
(a naive flat memory, or no memory) so the improvement is shown to be *caused* by
vtfkb. Live + costs tokens + nondeterministic → NOT part of `npm test`.

```
node scenarios/l4-purpose.mjs                 # all scenarios
node scenarios/l4-purpose.mjs stale-host      # one scenario
```

Demonstrated (2026-06-03):
- **stale-host** — vtfkb → the corrected host (`db-prod-9c814`); naive flat memory →
  *fails* (surfaces both conflicting hosts, agent can't choose). The Stark-FQDN class,
  fixed.
- **constitution-port** — an arbitrary house policy (bind port 8472). vtfkb → `8472`;
  no-memory baseline → `8080` (default). A constitutional rule binds behavior even
  against the model's prior.

## Try the auto-layer (against a throwaway brain)

```
export VTFKB_DIR=/tmp/vtfkb && rm -rf "$VTFKB_DIR"
node dist/cli.js add fact "the canary token is BANANA-42." --role human
# Claude Code:
claude -p "what is the canary token? reply with only the token" --settings spike/settings.json
# Pi:
pi -p -e dist/pi-extension.js --no-tools "what is the canary token? reply with only the token"
```
