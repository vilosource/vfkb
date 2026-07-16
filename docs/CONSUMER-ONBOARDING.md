# Onboarding another repo to vfkb (consumer guide)

How to make **any repo** a vfkb consumer — so a session there runs on vfkb automatically, the way
this repo does. The current, canonical mechanism is the **Claude Code plugin**
([ADR-0045](adr/ADR-0045-vfkb-claude-code-plugin.md)); the legacy `$VFKB_BUNDLE_DIR` bootstrap
([ADR-0030](adr/ADR-0030-consumer-integration-and-distribution.md)/[ADR-0031](adr/ADR-0031-bootstrap-engine-resolution-guard.md))
is kept as a **fallback** (see the last section).

> For vfkb's *own* self-hosting setup, see the root `CLAUDE.md`. This guide is for a **different** repo
> (e.g. vfwb, a fleet project) that wants to *use* vfkb. For a **brand-new** project, don't hand-wire
> — the `vfkb-new-project` skill does everything here end-to-end (repo create, identity, plugin wiring,
> guard, verify, push).

## What you get

After onboarding, a coding agent (Claude Code) working in your repo:

- gets the **resume digest + knowledge bundle** injected at session start (continuity, automatic);
- has the **9 `kb_*` MCP tools** to search/add knowledge (namespaced `mcp__plugin_vfkb_vfkb__kb_*`
  under the plugin);
- has its **direct writes to `.vfkb/` gated** through the engine (knowledge is recorded deliberately);
- gets the **end-of-turn decision-capture reminder** and the **auto-commit of the brain at session end**.

Under the plugin, the engine ships **inside the plugin** (it vendors its own bundles), so there is
**no `$VFKB_BUNDLE_DIR` to set** and **no `node_modules`** on the consumer side.

## Plugin wiring — the two committed files

A plugin-wired repo commits exactly **two files** under `.claude/`, copied **byte-for-byte from vfkb's
own `main`** (the dogfooded reference, kept current) — never hand-crafted:

| Path | What |
|---|---|
| `.claude/settings.json` | `extraKnownMarketplaces.vfkb` (→ `vilosource/vfkb-claude-plugin`) + `enabledPlugins["vfkb@vfkb"]` + a `SessionStart` hook that runs the guard |
| `.claude/vfkb-guard.mjs` | the **ADR-0059 "vfkb INACTIVE" guard** — engine-free (Node stdlib only), fails open |

Everything else (the resume/gate/capture hooks, the MCP server, the engine) lives **inside the
plugin**. That is why only these two files are committed: the plugin delivers the rest.

**Why the guard must be a committed repo file, not part of the plugin
([ADR-0059](adr/ADR-0059-inactive-signal-guard.md)):** it exists to detect the case where the plugin
*didn't load*. A guard shipped by the plugin couldn't run in exactly that case — "the one job that
cannot be delegated to the thing that might be missing." It compares this repo's `enabledPlugins`
declaration against Claude Code's `~/.claude/plugins/installed_plugins.json` fulfillment and, on a
mismatch, banners `vfkb INACTIVE` at session start. It **fails open**: any read/parse error exits 0
silently — a smoke alarm, never a lock.

### Wire an existing repo

From the root of the target repo, fetch both files from vfkb `main`:

```sh
mkdir -p .claude .vfkb
gh api repos/vilosource/vfkb/contents/.claude/settings.json?ref=main  --jq .content | base64 -d > .claude/settings.json
gh api repos/vilosource/vfkb/contents/.claude/vfkb-guard.mjs?ref=main --jq .content | base64 -d > .claude/vfkb-guard.mjs
python3 -c 'import json; json.load(open(".claude/settings.json"))'   # settings.json is valid JSON
: > .vfkb/entries.jsonl        # empty brain (a valid, committable starting point)
```

> **If the repo already has a `.claude/settings.json`**, don't overwrite it — **merge**: add the
> `extraKnownMarketplaces.vfkb`, `enabledPlugins["vfkb@vfkb"]`, and the `SessionStart` guard hook into
> the existing object, keeping the repo's other keys and hooks.

## Install once (per machine, per repo)

`enabledPlugins` only **declares** the plugin — it does not install it. Complete the one-time install
so the next session actually runs vfkb:

```sh
claude plugin install vfkb@vfkb --scope project    # from the repo root
```

…or start `claude` in the repo and **approve the plugin's MCP server + hooks** when prompted. Then
**restart the session** — hooks and the MCP server are loaded at session start.

> Until this install completes, the guard will banner `vfkb INACTIVE` every session. That is the
> **intended, honest signal**, not a bug — a settings-wired repo is *declared* but not yet *loaded*
> (gotcha `8e76f8f72b64`: settings-wired ≠ loaded).

## The INACTIVE signal (ADR-0059)

You won't silently lose continuity if the plugin isn't loaded. When this repo declares the plugin but
`installed_plugins.json` has no matching fulfillment (uninstalled, never-approved, or wrong project),
the committed guard injects at session start:

> vfkb INACTIVE — this project declares the vfkb plugin (`vfkb@vfkb`) but it is not installed for this
> session. No resume digest, no brain-write gate, and no decision capture are running; knowledge
> recorded now may be lost. Fix: run `claude plugin install vfkb@vfkb` (or approve the plugin when
> prompted), then restart the session.

*(Quoted abbreviated; the guard emits plain text — no emoji — and self-identifies as `vfkb-guard /
ADR-0059`.)*

**Known limitation (ADR-0059):** the installed-but-*unapproved* state may be invisible to the guard
(approval state lives outside `installed_plugins.json`). It decisively covers uninstalled /
never-fulfilled / wrong-project — the modes actually observed.

## Verify it's healthy

- **Guard fires as expected** — before the install, `CLAUDE_PROJECT_DIR=$PWD node .claude/vfkb-guard.mjs`
  prints the `vfkb INACTIVE` banner (it is *declared* but not yet *installed* — the guard's can-fail
  proof). After the install + restart, a live session shows the resume digest injected and no banner.
  *(One exception: if the plugin is already installed at **user** scope on this machine, that fulfils
  every project, so the guard correctly stays silent — a suppressed banner then means "already
  installed," not "fetch failed.")*
- **`kb_*` tools present** — in a live session the `mcp__plugin_vfkb_vfkb__kb_*` tools are available,
  and the SessionStart resume injection appears. Inspecting `settings.json` is **not** sufficient
  (ADR-0051 quiet-failure class) — probe the live session.

## Bring existing knowledge across (optional)

`vfkb import` migrates prior knowledge into the brain (recorded as `role=import`, unverified, lossy).
A **manual** CLI call needs a vfkb engine and this repo's brain dir. Use a vfkb checkout's
`dist/cli.js` (the plugin's vendored engine is not on your `PATH`), and point it at `.vfkb`:

```sh
export VFKB_DATA_DIR=.vfkb        # per-repo; do NOT put in ~/.bashrc
node <vfkb-checkout>/dist/cli.js import --from-adr docs/adr        # one link per ADR
node <vfkb-checkout>/dist/cli.js import --from-markdown NOTES.md   # attach a historical doc
node <vfkb-checkout>/dist/cli.js import --from-mykb <area>          # ONLY a mykb AREA (see caveat)
```

**`--from-mykb` caveat:** it reads only `~/.mykb/areas/<name>/{decisions,facts,gotchas,patterns,links}.jsonl`
— **not** a mykb *workspace* journal (`~/.mykb/workspaces/<name>/journal.jsonl`). A `kb work journal` is a
workspace, so `--from-mykb` on it imports nothing; check `kb list` / `ls ~/.mykb/areas` first, and if the
data is only in a workspace journal, hand-fold the durable lines with `vfkb add`. Imports are append-only
(no dedup) — run each once.

## Commit the wiring + the brain

```sh
git add .claude/settings.json .claude/vfkb-guard.mjs .vfkb/entries.jsonl
```

Only `.vfkb/entries.jsonl` is committed from the brain; `index-meta.json` / `.sessions/` / `.signals/`
are derived and gitignored (add them to `.gitignore` if this is the repo's first vfkb wiring).

## Updating consumers when the engine moves

A machine's consumers run on one of **two wirings**, each with its own update path — a consumer's
wiring is identified by what's in its repo (`enabledPlugins` naming vfkb in `.claude/settings.json` =
plugin; `.vfkb/bin/bootstrap.mjs` = bootstrap):

**Plugin-wired repos (ADR-0045)** — one command covers every plugin install on the machine, because
all installs resolve the same marketplace clone and track the plugin repo's releases (unpinned):

```sh
claude plugin update vfkb@vfkb        # any project; scope follows the install
```

Restart open sessions to apply — hooks and the MCP server are loaded at session start.
(Observed 2026-07-12: after one update in one repo, every other plugin-wired repo already
reported the new version.)

**Bootstrap-wired repos (RFC-010/ADR-0031)** — all of them resolve `$VFKB_BUNDLE_DIR`, so one
refresh per machine covers every such repo at once:

```sh
cd <vfkb-checkout> && git pull && npm run build:bundles
cp dist/bundles/vfkb.mjs dist/bundles/vfkb-mcp.mjs "$VFKB_BUNDLE_DIR"/
node "$VFKB_BUNDLE_DIR/vfkb.mjs" --version      # smoke: prints the engine version
```

**Drift caveat:** the two paths have different sources — bootstrap repos get whatever `main` you
built, plugin repos get the plugin's last vendored release. Refresh both at release points, or the
machine runs two engine versions side by side.

## Fallback: bootstrap wiring (legacy, ADR-0030/0031)

Use this **only** for a repo that deliberately isn't plugin-wired (e.g. an environment without the
plugin marketplace). It commits a self-contained `.vfkb/bin/bootstrap.mjs` and resolves the engine
through **`$VFKB_BUNDLE_DIR`** instead of the plugin's vendored bundles.

1. **Build the bundles** in a vfkb checkout: `npm run build:bundles` → `dist/bundles/vfkb.mjs` +
   `vfkb-mcp.mjs` (self-contained, zero runtime deps).
2. **Point `$VFKB_BUNDLE_DIR` at them** (once per machine, in your shell profile so hooks inherit it):
   `export VFKB_BUNDLE_DIR=/path/to/vfkb/dist/bundles`.
3. **Scaffold** from the target repo's root: `node "$VFKB_BUNDLE_DIR/vfkb.mjs" init <project-name>`.
   `init` is idempotent and writes `.vfkb/entries.jsonl` + `manifest.json`, `.vfkb/bin/bootstrap.mjs`,
   `.mcp.json`, `.claude/settings.json` (SessionStart / PreToolUse-gate / Stop hooks), the `.gitignore`
   stanza, and an `AGENTS.md` snippet.
4. **Approve once** (`claude` in the repo → approve the MCP server + hooks), then
   `git add .mcp.json .claude .gitignore .vfkb AGENTS.md`.

If `$VFKB_BUNDLE_DIR` is unset, the bootstrap degrades gracefully: a session-start
**⚠️ "vfkb is INACTIVE: VFKB_BUNDLE_DIR is not set"** banner, the write-gate stops blocking, nothing
crashes. This is the bootstrap-era analogue of the ADR-0059 guard above; note the **guard's
`enabledPlugins` check is inert in a bootstrap-wired repo** (no `enabledPlugins` declaration to check
against), so a bootstrap repo relies on this banner, not the guard.

> The earlier env names **`VFKB_DIR`** (→ `VFKB_DATA_DIR`) and **`VFKB_HOME`** (→ `VFKB_BUNDLE_DIR`)
> still work as **deprecated aliases** (ADR-0032); `vfkb doctor` warns when one is in use.

## How this is proven

- **The guard** is proven by an agent-driven L4 with a can-fail arm in the plugin repo
  (`scenarios/inactive-signal.mjs`, ADR-0059): positive arm — plugin declared but not installed → the
  `vfkb INACTIVE` banner is observed; contrast arm — plugin installed → banner absent and vfkb live.
- **The bootstrap onboarding path** is verified end-to-end by `scenarios/consumer-onboarding.mjs`
  (ADR-0029 DoD): a real agent in a freshly `init`-ed throwaway repo grounds on that repo's vfkb
  knowledge via the `$VFKB_BUNDLE_DIR` bundles, while a not-onboarded repo cannot. Structural pieces
  (`init` idempotency, the bundles, `doctor`) are covered by deterministic unit tests.
