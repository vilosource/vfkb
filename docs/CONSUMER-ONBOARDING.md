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

The engine is resolved through one environment variable, **`$VFKB_BUNDLE_DIR`** — so the same committed
wiring works on every machine, container, and clone, with **no machine paths in git** and **no
`node_modules`** on the consumer side.

## Two variables — don't confuse them

| Variable | Means | Value | Scope |
|---|---|---|---|
| **`VFKB_DATA_DIR`** | this repo's **brain** (the data) | `.vfkb` (relative) | **per-project** — set by the wiring |
| **`VFKB_BUNDLE_DIR`** | the shared vfkb **engine** (the code/bundles) | `…/vfkb/dist/bundles` | **per-machine** — you export it once |

They are independent. `VFKB_BUNDLE_DIR` only tells vfkb *where the engine code is*; it never affects
which brain is written. Every project's wiring bakes in `VFKB_DATA_DIR=.vfkb`, resolved against that
project's directory — so working in `vfwb` writes to `vfwb/.vfkb`, **never** to vfkb's own brain, even
though both share one `VFKB_BUNDLE_DIR`. (Verify with `vfkb doctor`, which reports the brain in use.)

> The earlier names **`VFKB_DIR`** (→ `VFKB_DATA_DIR`) and **`VFKB_HOME`** (→ `VFKB_BUNDLE_DIR`) still
> work as **deprecated aliases** (ADR-0032); `vfkb doctor` warns when one is in use.

## If you forget `$VFKB_BUNDLE_DIR`

You won't get a cryptic failure. The committed bootstrap (`.vfkb/bin/bootstrap.mjs`, ADR-0031) detects
an unset/invalid `$VFKB_BUNDLE_DIR` and **degrades gracefully**: at session start it injects a clear
**⚠️ "vfkb is INACTIVE: VFKB_BUNDLE_DIR is not set — here's the fix"** banner, the write-gate stops blocking
(your edits aren't held hostage), and nothing crashes. Set the variable (below) and you're live. Run
`vfkb doctor` any time to check.

## One-time, per machine

1. **Build the single-file bundles** (in a checkout of the vfkb repo):
   ```sh
   npm run build:bundles        # -> dist/bundles/vfkb.mjs + vfkb-mcp.mjs
   ```
   These are self-contained (the MCP server has `@modelcontextprotocol/sdk` + `zod` inlined), so they
   drop into any Node ≥20 with zero runtime deps. For air-gapped / fleet use, vendor the two files.

2. **Point `$VFKB_BUNDLE_DIR` at them** (add to your shell profile so hooks inherit it):
   ```sh
   export VFKB_BUNDLE_DIR=/path/to/vfkb/dist/bundles
   ```

## Onboard a repo

3. **Scaffold the wiring** — from the root of the target repo:
   ```sh
   node "$VFKB_BUNDLE_DIR/vfkb.mjs" init <project-name>      # project defaults to the dir name
   ```
   `init` is **idempotent** (safe to re-run) and writes:

   | Path | What |
   |---|---|
   | `.vfkb/entries.jsonl` | the brain (empty; an existing brain is never clobbered) |
   | `.vfkb/manifest.json` | brain↔engine version stamp (committed) |
   | `.vfkb/bin/bootstrap.mjs` | committed engine-resolution guard (committed; see below) |
   | `.mcp.json` | registers the `vfkb` MCP server via the bootstrap |
   | `.claude/settings.json` | SessionStart / PreToolUse-gate / Stop hooks via the bootstrap |
   | `.gitignore` | the derived/operational stanza (only `entries.jsonl` + `manifest.json` are committed) |
   | `AGENTS.md` | a parameterized "how we track work HERE" snippet |

4. **Approve once** — start `claude` in the repo and approve the project MCP server + hooks when
   prompted (a one-time, per-machine Claude Code step that `init` cannot do for you).

5. **Commit the wiring + the brain:**
   ```sh
   git add .mcp.json .claude .gitignore .vfkb AGENTS.md
   ```

## Bring existing knowledge across (optional)

`vfkb import` migrates prior knowledge into the brain (recorded as `role=import`, unverified, lossy).
**First point the manual CLI at this repo's brain** — a manual command has no cwd auto-detection, so with
`VFKB_DATA_DIR` unset it writes to the global `~/.vfkb`, not this repo (the hooks bake this in, but a
hand-run command doesn't). Export it for the shell and run from the repo root:

```sh
export VFKB_DATA_DIR=.vfkb        # per-repo; do NOT put in ~/.bashrc (only VFKB_BUNDLE_DIR is global)
node "$VFKB_BUNDLE_DIR/vfkb.mjs" import --from-adr docs/adr        # one link per ADR
node "$VFKB_BUNDLE_DIR/vfkb.mjs" import --from-markdown NOTES.md   # attach a historical doc
node "$VFKB_BUNDLE_DIR/vfkb.mjs" import --from-mykb <area>          # ONLY a mykb AREA (see caveat)
```

**`--from-mykb` caveat:** it reads only `~/.mykb/areas/<name>/{decisions,facts,gotchas,patterns,links}.jsonl`
— **not** a mykb *workspace* journal (`~/.mykb/workspaces/<name>/journal.jsonl`). A `kb work journal` is a
workspace, so `--from-mykb` on it imports nothing; check `kb list` / `ls ~/.mykb/areas` first, and if the
data is only in a workspace journal, hand-fold the durable lines with `vfkb add`. Imports are append-only
(no dedup) — run each once.

## Check it's healthy

```sh
node "$VFKB_BUNDLE_DIR/vfkb.mjs" doctor        # with VFKB_DATA_DIR=.vfkb still exported (as above)
```

`doctor` verifies brain↔engine compatibility, that `$VFKB_BUNDLE_DIR` resolves the bundles, that the wiring
is present, and that `VFKB_PROJECT` is consistent across `.mcp.json` and the hooks — and warns on
engine drift (a brain last stamped by a different engine build). A non-zero exit means a `FAIL` to fix.

## How this is proven

The onboarding path is verified end-to-end by `scenarios/consumer-onboarding.mjs` (ADR-0029 DoD): a
real agent in a freshly `init`-ed throwaway repo grounds on that repo's vfkb knowledge via the
`$VFKB_BUNDLE_DIR` bundles, while a not-onboarded repo cannot. Structural pieces (`init` idempotency, the
bundles, `doctor`) are covered by deterministic unit tests.
