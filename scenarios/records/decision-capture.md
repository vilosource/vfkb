# decision-capture L4 — ADR-0027 reminder-driven decision capture

**DEMONSTRATED** (model `claude-sonnet-4-6`, N=3):

| arm | captured | recall |
|---|---|---|
| **vfkb (Stop hook ON)** | **3/3** | all +recall |
| baseline (Stop hook OFF) | 0/3 (did the work, recorded nothing) | — |

## Design

Causal contrast — the **only** variable is the Stop hook. Identical sandbox + task in both
arms, **no "record it" instruction**, no CLAUDE.md prose rule, empty brain. Capture surface =
the real vfkb MCP server (`mcp__vfkb__kb_add`) + the PreToolUse gating hook (the agent cannot
write `.vfkb` directly — capture must go through the engine), mirroring the live repo.

Task (`config-format`): *"decide JSON vs YAML, then create src/config.ts on disk implementing
your choice."* So any capture in the vfkb arm is reminder-driven by elimination.

Assertion per trial: a `decision` entry reflecting the choice lands in the sandbox `.vfkb`
**AND** is retrievable via `vfkb search` (recall). Verdict = vfkb ≥2/3 **and** > baseline.

## Captured decisions (vfkb arm)

- t1: "Config files use JSON format (`.config.json`), loaded via `src/config.ts`."
- t2: "Config files use JSON (not YAML). Format is `.cliconfig.json` loaded via Node's built-in `fs` + `JSON.parse` in `src/config.ts`."
- t3: "Config files use JSON (not YAML). Loader is src/config.ts; reads config.json from CWD by default, returns {} if absent. Why: JSON requires zero extra deps."

Baseline did the work in all 3 trials but recorded nothing.

## Findings (surfaced by running this scenario)

1. **vfkb bug** — search/indexing crashed on a tagless entry (`entry.tags.join`); fixed at the
   read boundary (`storage.ts materialize`) + `index-store.ts` guard + regression test.
2. **Sandbox isolation** — symlinking `dist` into the sandbox let the agent infer the real repo
   root and write `src/` files into it; fixed with absolute paths (no breadcrumb) + a leak guard.

Run: `VFKB_DC_TRIALS=3 VFKB_DC_MODEL=claude-sonnet-4-6 node scenarios/decision-capture.mjs`
