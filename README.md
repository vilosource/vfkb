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

## Proving the purpose (comprehensive L4 scenario harness)

Unit tests prove the modules are correct; the L4 harness proves vtfkb fulfils its
**purpose** — that a real agent behaves *better because of it*. Every scenario drives
a real agent (**DeepSeek-V4 via `pi` by default**; `claude` for the MCP/parity ones),
asserts on **observable effects** (the agent's output or the brain's state — never
self-report), and **contrasts against a baseline** so the win is shown to be *caused*
by vtfkb:
- `naive` = a mykb-v1-style flat, load-order, unfiltered memory (surfaces stale);
- `none` = no memory at all;
- `ungated` / `no-mcp` = the same harness without vtfkb's guardrail / tools.

Live + costs tokens + nondeterministic → NOT part of `npm test`. Override the agent
with `VTFKB_L4_MODEL` / `VTFKB_L4_PROVIDER`.

```
node scenarios/l4-purpose.mjs            # all (run in batches if your runner has a wall-clock cap)
node scenarios/l4-purpose.mjs --list     # list scenario ids
node scenarios/l4-purpose.mjs capture-recall mcp-pull   # subset
```

**24 scenarios** across every dimension (DeepSeek-V4-pro: **24/24 demonstrated**, 2026-06-03):

- **Stale-exclusion (the core value):** supersession, `valid_until` expiry, deprecated
  status, provenance-stale, supersession-**chain**, and precedence-amid-distractors.
- **Constitution / constraints:** single rule, aggregate (many rules at once),
  prohibition (forbidden term + required prefix).
- **Knowledge delivery:** fact, gotcha, vision-pattern, decision, link, and
  multi-fact **synthesis** (combine two entries); unverified-but-delivered (trust).
- **Memory:** passive capture → cross-session **recall**.
- **Guardrails:** tool-gating (brain stays intact vs an ungated clobber) and
  no-secrets (the agent's `kb_add` of a key is refused).
- **MCP (cross-harness pull, claude):** pull via `kb_search`, filtered search,
  map-then-search navigation.
- **Cross-harness parity:** exclusion + constitution also hold on Claude Code.

### Recording behavior + comparing models

Every run **records each model's behavior** to `scenarios/records/<provider>__<model>.{json,md}`
(per-scenario verdicts + the agent's full output, merged across batched runs). Run the
identical suite against another model and compare:

```
VTFKB_L4_MODEL=deepseek-v4-pro   node scenarios/l4-purpose.mjs          # baseline record
VTFKB_L4_MODEL=deepseek-v4-flash node scenarios/l4-purpose.mjs <subset> # another model
node scenarios/compare.mjs                                              # cross-model report card
```

Recorded so far: `deepseek-v4-pro` 24/24; `deepseek-v4-flash` 8/8 (subset); **no
divergences** on shared scenarios.

### Why the baselines are trustworthy (isolation discipline)

A contrast only proves causation if the baseline **reliably fails** and is genuinely
knowledge-free. The harness spawns the real `claude` CLI as the agent, so by default
it inherits the **user's global config** — every connected MCP server and the global
`CLAUDE.md`. The **proven** leak was the **filesystem**: an un-restricted `claude`
baseline used its default tools to read the brain's `entries.jsonl` in `/tmp` (it cited
the brain dir name in its answer). So every `claude` run now **denies all filesystem/
exec tools** (`--disallowedTools …`) — that is the fix that stops the leak — and also
uses `--strict-mcp-config` + an empty MCP config to disable the user's global MCP
servers (Atlassian/Gmail/Calendar/etc.) so the test can't touch real services and has
no out-of-band knowledge. The MCP variant keeps only `mcp__vtfkb__*`, so it is *forced*
to answer via `kb_search`. Archive-zone exclusion is **table-stakes** (any memory drops
it) and is omitted from L4 (unit-tested instead).

## Try the auto-layer (against a throwaway brain)

```
export VTFKB_DIR=/tmp/vtfkb && rm -rf "$VTFKB_DIR"
node dist/cli.js add fact "the canary token is BANANA-42." --role human
# Claude Code:
claude -p "what is the canary token? reply with only the token" --settings spike/settings.json
# Pi:
pi -p -e dist/pi-extension.js --no-tools "what is the canary token? reply with only the token"
```
