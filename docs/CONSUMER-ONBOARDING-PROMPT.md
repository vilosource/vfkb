# Consumer onboarding — a hand-off prompt for the consumer's agent

A ready-to-paste prompt to give the **agent working in the repo you want to onboard** (e.g. vfwb), so
it can onboard itself to vfkb. It is the agent-facing companion to [CONSUMER-ONBOARDING.md](CONSUMER-ONBOARDING.md)
(the human guide) and implements the [ADR-0030](adr/ADR-0030-consumer-integration-and-distribution.md)
contract (+ [ADR-0031](adr/ADR-0031-bootstrap-engine-resolution-guard.md) bootstrap guard,
[ADR-0032](adr/ADR-0032-env-var-rename-data-dir-bundle-dir.md) env-var names).

Fill in the two placeholders (`<abs/path/to/vfkb-bundles>`, `<your-mykb-area>`) before sending, or tell
the agent to ask for them.

---

> **vfkb consumer onboarding is shipped — onboard this repo to vfkb.**
>
> The consumer-onboarding capability is built and merged in `vilosource/vfkb` (ADR-0030 contract;
> ADR-0031 bootstrap guard; ADR-0032 env-var names). vfkb dogfoods this exact wiring itself, and the
> path is proven by an agent-driven scenario. Read `docs/CONSUMER-ONBOARDING.md` in the vfkb repo first,
> then do this:
>
> **1. Get the engine (no `npm install` needed — the bundles are self-contained, zero-dep).** Either:
> - **Vendor them (recommended — avoids the Nexus/off-VPN install problem):** obtain `vfkb.mjs` +
>   `vfkb-mcp.mjs` from a built vfkb `dist/bundles/` and drop them in a stable dir, e.g.
>   `~/.vfkb-bundles/`.
> - **Or build them:** in a vfkb checkout, `npm run build:bundles` → `dist/bundles/`.
>
> **2. Point the engine env var at them (once per machine; add to `~/.bashrc`):**
> ```bash
> export VFKB_BUNDLE_DIR=<abs/path/to/vfkb-bundles>   # the dir holding vfkb.mjs + vfkb-mcp.mjs
> ```
>
> **3. Scaffold this repo (idempotent) — from its root:**
> ```bash
> node "$VFKB_BUNDLE_DIR/vfkb.mjs" init <project-name>
> ```
> Writes `.mcp.json`, `.claude/settings.json` (SessionStart / PreToolUse-gate / Stop hooks), the
> `.gitignore` stanza, an empty `.vfkb/` brain, `.vfkb/manifest.json`, the committed
> `.vfkb/bin/bootstrap.mjs`, and an `AGENTS.md` snippet — all wired through the bootstrap, no machine
> paths in git.
>
> **3b. Point the *manual* CLI at this repo's brain (do this before any `import`/`doctor`/`add`).**
> The hooks bake `VFKB_DATA_DIR=.vfkb` into their commands, but a **manual** CLI call resolves its brain
> from the environment — with `VFKB_DATA_DIR` unset it **silently writes to the global `~/.vfkb`, not this
> repo**. So export it (and the project name) for this shell, and keep `cwd` at the repo root (the path is
> relative) for every command below:
> ```bash
> export VFKB_DATA_DIR=.vfkb        # per-repo — do NOT put this in ~/.bashrc (only VFKB_BUNDLE_DIR is global)
> export VFKB_PROJECT=<project-name>
> ```
>
> **4. Migrate existing knowledge (lossy, `role=import`).** The reliable source is this repo's own
> git-tracked docs — do this unconditionally:
> ```bash
> node "$VFKB_BUNDLE_DIR/vfkb.mjs" import --from-adr docs/adr            # one link per ADR
> node "$VFKB_BUNDLE_DIR/vfkb.mjs" import --from-markdown <path/to/doc>  # attach a key doc as a source
> ```
> **mykb is conditional — `--from-mykb` reads ONLY `~/.mykb/areas/<name>/{decisions,facts,gotchas,patterns,links}.jsonl`.**
> It does **not** read a mykb *workspace* journal (`~/.mykb/workspaces/<name>/journal.jsonl`, a `{date,text}`
> log) — a `kb work journal` is a workspace, not an area, so pointing `--from-mykb` at it imports **nothing**.
> Discover the real source first (`kb list` = areas; `ls ~/.mykb/areas ~/.mykb/workspaces`), then:
> ```bash
> node "$VFKB_BUNDLE_DIR/vfkb.mjs" import --from-mykb <area-name-or-absolute-dir>   # only if a real AREA exists
> ```
> If your knowledge is only in a workspace journal (or no area exists), skip it and hand-fold the durable
> lines with `vfkb add fact "…" --role human`. Run each import **once** — it's append-only with no dedup,
> so re-running duplicates entries.
>
> **5. Verify and commit:**
> ```bash
> node "$VFKB_BUNDLE_DIR/vfkb.mjs" doctor      # brain<->engine compat, wiring, VFKB_BUNDLE_DIR, project
> git add .mcp.json .claude .gitignore .vfkb AGENTS.md
> ```
> Then start `claude` in this repo and **approve the project MCP server + hooks once** when prompted.
>
> **Key facts:**
> - **Two env vars, don't conflate:** `VFKB_BUNDLE_DIR` = the shared engine *code* (per machine, global);
>   `VFKB_DATA_DIR=.vfkb` = this repo's *brain*. The **hooks** set `VFKB_DATA_DIR=.vfkb` for you (though
>   that path is CWD-relative too — see vfkb#22), while a **manual** `import`/`doctor`/`add`/`resume` has no
>   cwd auto-detection: with `VFKB_DATA_DIR` unset it targets the global `~/.vfkb`, not this repo (hence
>   step 3b). Sharing one
>   `VFKB_BUNDLE_DIR` across projects does **not** cross-contaminate — each repo writes only to its own `.vfkb`.
> - **Guardrail:** if `VFKB_BUNDLE_DIR` is unset, SessionStart shows a clear *"vfkb INACTIVE — set
>   VFKB_BUNDLE_DIR"* banner and the write-gate stops blocking — it never breaks your session.
>   `vfkb doctor` reports it too.
> - Only `.vfkb/entries.jsonl`, `.vfkb/manifest.json`, and `.vfkb/bin/` are committed;
>   `index-meta.json` / `.sessions/` / `.signals/` are gitignored.
> - (`VFKB_DIR` / `VFKB_HOME` still work as deprecated aliases if you see them in older docs.)
>
> Report back if `doctor` flags anything or the SessionStart banner appears — that is the system telling
> you exactly what to fix.

---

**Maintainer notes (not part of the prompt):**
- The "vendor the two bundles" path is the answer to the original FR-2 concern (vfkb is unpublished and
  `npm install` hits the corporate Nexus → ENOTFOUND off-VPN). The bundles are zero-dep, so the consumer
  side needs no install.
- `vfkb init` is idempotent but **appends** to existing hooks — for a repo already on a *non-bootstrap*
  wiring, hand-author the migration instead (see how this repo's own wiring was migrated).
