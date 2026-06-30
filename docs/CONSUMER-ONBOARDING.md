# Onboarding another repo to vfkb (consumer guide)

How to make **any repo** a vfkb consumer — so a session there runs on vfkb automatically, the way
this repo does. This is the human-readable companion to **[ADR-0030](adr/ADR-0030-consumer-integration-and-distribution.md)**
(the consumer integration & distribution contract); `vfkb init` automates steps 3–4.

> For vfkb's *own* self-hosting setup, see the root `CLAUDE.md`. This guide is for a **different** repo
> (e.g. vfwb, a fleet project) that wants to *use* vfkb.

## What you get

After onboarding, a coding agent (Claude Code) working in your repo:

- gets the **resume digest + knowledge bundle** injected at session start (continuity, automatic);
- has the **`mcp__vfkb__kb_*` tools** to search/add knowledge;
- has its **direct writes to `.vfkb/` gated** through the engine (knowledge is recorded deliberately);
- gets the **end-of-turn decision-capture reminder**.

The engine is resolved through one environment variable, **`$VFKB_HOME`** — so the same committed
wiring works on every machine, container, and clone, with **no machine paths in git** and **no
`node_modules`** on the consumer side.

## One-time, per machine

1. **Build the single-file bundles** (in a checkout of the vfkb repo):
   ```sh
   npm run build:bundles        # -> dist/bundles/vfkb.mjs + vfkb-mcp.mjs
   ```
   These are self-contained (the MCP server has `@modelcontextprotocol/sdk` + `zod` inlined), so they
   drop into any Node ≥20 with zero runtime deps. For air-gapped / fleet use, vendor the two files.

2. **Point `$VFKB_HOME` at them** (add to your shell profile so hooks inherit it):
   ```sh
   export VFKB_HOME=/path/to/vfkb/dist/bundles
   ```

## Onboard a repo

3. **Scaffold the wiring** — from the root of the target repo:
   ```sh
   node "$VFKB_HOME/vfkb.mjs" init <project-name>      # project defaults to the dir name
   ```
   `init` is **idempotent** (safe to re-run) and writes:

   | Path | What |
   |---|---|
   | `.vfkb/entries.jsonl` | the brain (empty; an existing brain is never clobbered) |
   | `.vfkb/manifest.json` | brain↔engine version stamp (committed) |
   | `.mcp.json` | registers the `vfkb` MCP server via `${VFKB_HOME}/vfkb-mcp.mjs` |
   | `.claude/settings.json` | SessionStart / PreToolUse-gate / Stop hooks via `$VFKB_HOME/vfkb.mjs` |
   | `.gitignore` | the derived/operational stanza (only `entries.jsonl` + `manifest.json` are committed) |
   | `AGENTS.md` | a parameterized "how we track work HERE" snippet |

4. **Approve once** — start `claude` in the repo and approve the project MCP server + hooks when
   prompted (a one-time, per-machine Claude Code step that `init` cannot do for you).

5. **Commit the wiring + the brain:**
   ```sh
   git add .mcp.json .claude .gitignore .vfkb AGENTS.md
   ```

## Bring existing knowledge across (optional)

`vfkb import` migrates prior knowledge into the brain (recorded as `role=import`, unverified, lossy):

```sh
node "$VFKB_HOME/vfkb.mjs" import --from-adr docs/adr        # one link per ADR
node "$VFKB_HOME/vfkb.mjs" import --from-mykb <area>          # a mykb area's *.jsonl -> envelopes
node "$VFKB_HOME/vfkb.mjs" import --from-markdown NOTES.md    # attach a historical doc
```

## Check it's healthy

```sh
node "$VFKB_HOME/vfkb.mjs" doctor
```

`doctor` verifies brain↔engine compatibility, that `$VFKB_HOME` resolves the bundles, that the wiring
is present, and that `VFKB_PROJECT` is consistent across `.mcp.json` and the hooks — and warns on
engine drift (a brain last stamped by a different engine build). A non-zero exit means a `FAIL` to fix.

## How this is proven

The onboarding path is verified end-to-end by `scenarios/consumer-onboarding.mjs` (ADR-0029 DoD): a
real agent in a freshly `init`-ed throwaway repo grounds on that repo's vfkb knowledge via the
`$VFKB_HOME` bundles, while a not-onboarded repo cannot. Structural pieces (`init` idempotency, the
bundles, `doctor`) are covered by deterministic unit tests.
