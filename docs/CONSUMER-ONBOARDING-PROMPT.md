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
> **4. Migrate existing knowledge (lossy, `role=import`):**
> ```bash
> node "$VFKB_BUNDLE_DIR/vfkb.mjs" import --from-mykb <your-mykb-area>   # journal -> envelopes
> node "$VFKB_BUNDLE_DIR/vfkb.mjs" import --from-adr docs/adr            # one link per ADR
> ```
>
> **5. Verify and commit:**
> ```bash
> node "$VFKB_BUNDLE_DIR/vfkb.mjs" doctor      # brain<->engine compat, wiring, VFKB_BUNDLE_DIR, project
> git add .mcp.json .claude .gitignore .vfkb AGENTS.md
> ```
> Then start `claude` in this repo and **approve the project MCP server + hooks once** when prompted.
>
> **Key facts:**
> - **Two env vars, don't conflate:** `VFKB_BUNDLE_DIR` = the shared engine *code* (per machine);
>   `VFKB_DATA_DIR=.vfkb` = this repo's *brain*, baked into the wiring and resolved against this repo's
>   directory. Sharing one `VFKB_BUNDLE_DIR` across projects does **not** cross-contaminate — this repo
>   writes only to its own `.vfkb`, never vfkb's brain.
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
