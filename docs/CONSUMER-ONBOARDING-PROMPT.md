# Consumer onboarding — a hand-off prompt for the consumer's agent

A ready-to-paste prompt to give the **agent working in the repo you want to onboard** (e.g. vfwb), so
it can onboard itself to vfkb via the **Claude Code plugin** ([ADR-0045](adr/ADR-0045-vfkb-claude-code-plugin.md)) —
the current canonical mechanism. It is the agent-facing companion to
[CONSUMER-ONBOARDING.md](CONSUMER-ONBOARDING.md) (the human guide); the guard it installs is
[ADR-0059](adr/ADR-0059-inactive-signal-guard.md). The legacy `$VFKB_BUNDLE_DIR` bootstrap
([ADR-0030](adr/ADR-0030-consumer-integration-and-distribution.md)/[ADR-0031](adr/ADR-0031-bootstrap-engine-resolution-guard.md))
is a fallback only — use it solely if the repo deliberately isn't plugin-wired.

> For a **brand-new** project, don't paste this — run the `vfkb-new-project` skill instead; it does the
> repo create, identity, plugin wiring, guard, verify, and push end-to-end.

---

> **Onboard this repo to vfkb via its Claude Code plugin.**
>
> vfkb is wired into a repo by committing **two files** under `.claude/`, copied byte-for-byte from
> vfkb's own `main` (the dogfooded reference). The plugin vendors its own engine — there is **no
> `VFKB_BUNDLE_DIR` to set** and **no `npm install`**. Read `docs/CONSUMER-ONBOARDING.md` in the vfkb
> repo first, then do this from this repo's root:
>
> **1. Fetch the wiring from vfkb `main` (never hand-craft it):**
> ```bash
> mkdir -p .claude .vfkb
> gh api repos/vilosource/vfkb/contents/.claude/settings.json?ref=main  --jq .content | base64 -d > .claude/settings.json
> gh api repos/vilosource/vfkb/contents/.claude/vfkb-guard.mjs?ref=main --jq .content | base64 -d > .claude/vfkb-guard.mjs
> python3 -c 'import json; json.load(open(".claude/settings.json"))'   # settings.json is valid JSON
> : > .vfkb/entries.jsonl        # empty brain (valid, committable)
> ```
> `.claude/settings.json` carries `extraKnownMarketplaces.vfkb` (→ `vilosource/vfkb-claude-plugin`),
> `enabledPlugins["vfkb@vfkb"]`, and a `SessionStart` hook that runs the guard. `.claude/vfkb-guard.mjs`
> is the ADR-0059 "vfkb INACTIVE" guard (engine-free, fails open) — it MUST be committed, because a
> plugin that didn't load can't warn about its own absence.
>
> **If this repo already has `.claude/settings.json`, MERGE** — add the three keys above into the
> existing object, keeping its other keys and hooks; do not overwrite it.
>
> **2. Verify the guard fires (its can-fail proof):**
> ```bash
> CLAUDE_PROJECT_DIR=$PWD node .claude/vfkb-guard.mjs   # prints the `vfkb INACTIVE` banner, exits 0
> ```
> This is **correct**: the plugin is *declared* here but not yet *installed*, so the guard banners.
> Do **not** claim vfkb is "live" yet — `enabledPlugins` only declares it (gotcha `8e76f8f72b64`:
> settings-wired ≠ loaded).
>
> **3. Migrate existing knowledge (optional, lossy, `role=import`).** A manual CLI call needs a vfkb
> engine — use a vfkb checkout's `dist/cli.js` and point it at this repo's brain:
> ```bash
> export VFKB_DATA_DIR=.vfkb        # per-repo — do NOT put in ~/.bashrc
> node ~/VFKB/vfkb/dist/cli.js import --from-adr docs/adr            # one link per ADR
> node ~/VFKB/vfkb/dist/cli.js import --from-markdown <path/to/doc>  # attach a key doc as a source
> ```
> **`--from-mykb` reads ONLY `~/.mykb/areas/<name>/{decisions,facts,gotchas,patterns,links}.jsonl`** —
> not a mykb *workspace* journal (`~/.mykb/workspaces/<name>/journal.jsonl`). A `kb work journal` is a
> workspace, so `--from-mykb` on it imports **nothing**. Check `kb list` / `ls ~/.mykb/areas` first; if
> your knowledge is only in a workspace journal, hand-fold the durable lines with
> `vfkb add fact "…" --role human`. Run each import **once** — append-only, no dedup.
>
> **4. Commit the wiring + brain:**
> ```bash
> git add .claude/settings.json .claude/vfkb-guard.mjs .vfkb/entries.jsonl
> # add .gitignore for the derived brain bits if this is the repo's first vfkb wiring:
> #   .vfkb/index-meta.json  .vfkb/.sessions/  .vfkb/.signals/
> ```
>
> **5. Do the one-time install — vfkb is NOT live until this runs:**
> ```bash
> claude plugin install vfkb@vfkb --scope project      # from this repo's root
> ```
> …or start `claude` here and **approve the plugin's MCP server + hooks** when prompted, then restart.
> Until then the guard banners `vfkb INACTIVE` every session — the intended honest signal, not a bug.
>
> **Verify it actually loaded (observed, not asserted):** in a live session the
> `mcp__plugin_vfkb_vfkb__kb_*` tools are present and the SessionStart resume digest is injected.
> Inspecting `settings.json` is **not** sufficient (ADR-0051 quiet-failure class) — probe the session.
>
> **Key facts:**
> - The plugin vendors its own engine, so a plugin-wired repo needs **no `VFKB_BUNDLE_DIR`**. That env
>   var is only for the legacy bootstrap fallback.
> - `VFKB_DATA_DIR=.vfkb` = this repo's *brain*; a **manual** `import`/`add` has no cwd auto-detection,
>   so export it (step 3) or it targets the global `~/.vfkb`. The plugin's hooks set it for you.
> - Only `.vfkb/entries.jsonl` is committed; `index-meta.json` / `.sessions/` / `.signals/` are gitignored.
> - The **ADR-0059 guard's `enabledPlugins` check is inert in a bootstrap-wired repo** — a non-plugin
>   repo relies on the bootstrap's own `VFKB_BUNDLE_DIR` banner instead.
>
> Report back if the guard banner still appears after the install + restart, or if the `kb_*` tools are
> absent in a live session — that is the system telling you exactly what to fix.

---

**Maintainer notes (not part of the prompt):**
- Fetching the two files from vfkb `main` keeps consumers byte-identical to the dogfooded reference —
  the same guard sweep the fleet runs. Don't template or paraphrase the files.
- **Fallback (bootstrap, ADR-0030/0031):** only for a repo that deliberately isn't plugin-wired. In a
  vfkb checkout `npm run build:bundles`, `export VFKB_BUNDLE_DIR=…/dist/bundles`, then
  `node "$VFKB_BUNDLE_DIR/vfkb.mjs" init <project>` (idempotent; **appends** to existing hooks — for a
  repo already on a non-bootstrap wiring, hand-author the migration). See CONSUMER-ONBOARDING.md's
  "Fallback: bootstrap wiring" section.
