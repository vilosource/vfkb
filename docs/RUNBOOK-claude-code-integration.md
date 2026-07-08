# Runbook — Install & configure vfkb in a Claude Code CLI project

> **Purpose:** stand up the vfkb auto-layer (MCP server + hooks + brain) inside a Claude Code
> project so a session **runs on vfkb automatically** — session-start continuity injection, a
> brain-write gate, and the end-of-turn decision-capture reminder.
> **Status of the steps below:** every command was **verified on this machine** (Node v20.18.1,
> Claude Code CLI v2.1.195, vfkb `dist/` built from this repo) on 2026-06-29, **except** the two
> install paths explicitly flagged *unverified* (GitHub Packages install). This repo (`~/VFKB/vfkb`)
> is itself wired this way and is the reference example (ADR-0019 self-hosting).

---

## 0. What you are wiring (the integration surface)

| Piece | File | Effect |
|---|---|---|
| **MCP server** (9 tools) | `.mcp.json` | `kb_search` `kb_context` `kb_add` `kb_get` `kb_list` `kb_map` `kb_resume` `kb_supersede` `kb_transition` available in-session as `mcp__vfkb__*` |
| **SessionStart hook** | `.claude/settings.json` | injects the resume digest + knowledge bundle at session start (continuity, automatic) |
| **PreToolUse hook** | `.claude/settings.json` | **denies** direct `Write/Edit/MultiEdit` into the brain dir → forces brain writes through the engine (normal code/doc edits pass through) |
| **Stop hook** | `.claude/settings.json` | conditional end-of-turn **decision-capture reminder** (ADR-0027); native `stop_hook_active` loop guard; fail-open |
| **PostToolUse hook** | `.claude/settings.json` | **OPTIONAL, OFF by default** — auto-captures tool calls; leave OFF for a *committed* design brain (tool-call noise), ON only for a private/operational brain |
| **The brain** | `.vfkb/` (in the **target project**, not vfkb's source tree) | append-only JSONL knowledge store; `entries.jsonl` is committed, the rest is gitignored |

`VFKB_DIR` is resolved relative to the **Claude session's cwd** (your project root), independent of
where vfkb's *code* lives — so the brain lives with your project even when vfkb is installed globally.

---

## 1. Prerequisites

- **Node ≥ 20** (`node --version`; verified on v20.18.1). No native modules.
- **Claude Code CLI** installed (`claude --version`; the Stop-hook contract is verified at **v2.1.195**
  — see §8 if yours differs).
- The target project is a **git repo** (`git init` if not) — the Stop-hook heuristic and `vfkb save`
  read git state.
- A built vfkb `dist/` (next step).

---

## 2. Install vfkb (pick one mode)

vfkb ships as code you point Claude Code's MCP/hook commands at. Choose how those commands resolve it.

### Mode A — vfkb's own repo (self-hosting)
You are working **inside `~/VFKB/vfkb`** itself. It is already wired with **relative** paths
(`node dist/cli.js`, `dist/mcp-server.js`) because cwd *is* the vfkb repo. Just build:

```bash
cd ~/VFKB/vfkb
npm run build        # tsc → dist/ (verified green)
```

Nothing else to configure — `.mcp.json` and `.claude/settings.json` are committed. Go to §6.

### Mode B — global bins via `npm link` (recommended for *other* projects)
Build once in a vfkb clone, expose `vfkb` / `vfkb-mcp` on `PATH`:

```bash
cd /path/to/vfkb && npm run build && npm link    # creates global `vfkb` and `vfkb-mcp`
which vfkb vfkb-mcp                               # verify both resolve
```

*(Verified: `npm link` creates working `vfkb`/`vfkb-mcp` bins; `vfkb map` runs against a brain.)*
In your project, the MCP command is **`vfkb-mcp`** and hook commands are **`vfkb hook …`** (§4–§5,
Mode B column). Undo with `npm unlink -g @vilosource/vfkb`.

### Mode C — absolute paths to a clone's `dist/` (no global install)
Build a clone and reference its `dist/` by **absolute path**. Node resolves vfkb's own
`node_modules` from the script location, so your project needs nothing installed:

```bash
cd /path/to/vfkb && npm run build
# then use:  node /path/to/vfkb/dist/mcp-server.js   and   node /path/to/vfkb/dist/cli.js hook …
```

> ⚠️ Do **not** symlink vfkb's `dist/` *into* your project. A coding agent can follow the symlink back
> to vfkb's real repo root and write files there (observed gotcha). Absolute paths leave no breadcrumb.

### Mode D — npm dependency *(UNVERIFIED — auth-gated)*
`@vilosource/vfkb` is published to **GitHub Packages** (`npm.pkg.github.com`, per `package.json`
`publishConfig`). Installing it needs a GitHub Packages auth token + `.npmrc`. **This path was not
verified in this runbook** — treat the following as a sketch, not a tested instruction:
`npm install @vilosource/vfkb` → bins at `node_modules/.bin/vfkb` / server at
`node_modules/@vilosource/vfkb/dist/mcp-server.js`. Verify before relying on it.

> **Off-VPN caveat (this machine):** `npm install` here targets the corporate Nexus
> (`nexus.optiscangroup.com`) → `ENOTFOUND` off-VPN. vfkb itself only needs `npm run build` + its two
> deps (`@modelcontextprotocol/sdk`, `zod`); `node_modules` was bootstrapped by copying from another
> clone. On VPN a normal install works.

---

## 3. Choose your command form

The rest of the runbook shows the **command** that goes into the JSON. Substitute per your mode:

| | MCP server command | Hook command prefix |
|---|---|---|
| **A** (self-host) | `node` + args `["dist/mcp-server.js"]` | `node dist/cli.js hook …` |
| **B** (npm link) | `vfkb-mcp` | `vfkb hook …` |
| **C** (absolute) | `node` + args `["/abs/vfkb/dist/mcp-server.js"]` | `node /abs/vfkb/dist/cli.js hook …` |

Each hook command is prefixed with the env `VFKB_DIR=.vfkb VFKB_PROJECT=<your-label>`.

---

## 4. Register the MCP server — `.mcp.json`

Create `.mcp.json` in the **project root**. Mode A/C form (Mode B: replace `command`/`args` with
`"command": "vfkb-mcp", "args": []`):

```json
{
  "mcpServers": {
    "vfkb": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "env": { "VFKB_DIR": ".vfkb", "VFKB_PROJECT": "myproject" }
    }
  }
}
```

*(Verified: the server boots and advertises all 9 `kb_*` tools via a JSON-RPC `tools/list`.)*

---

## 5. Configure the hooks — `.claude/settings.json`

Create `.claude/settings.json` in the project root. Below is the **live, verified** three-hook config
(Mode A form — swap the `command` strings per §3 for Mode B/C):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command",
        "command": "VFKB_DIR=.vfkb VFKB_PROJECT=myproject node dist/cli.js hook session-start" } ] }
    ],
    "PreToolUse": [
      { "matcher": "Write|Edit|MultiEdit", "hooks": [ { "type": "command",
        "command": "VFKB_DIR=.vfkb VFKB_PROJECT=myproject node dist/cli.js hook pre-tool-use" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command",
        "command": "VFKB_DIR=.vfkb VFKB_PROJECT=myproject node dist/cli.js hook stop" } ] }
    ]
  }
}
```

**What each hook does (verified output):**

- **`hook session-start`** → emits
  `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<vfkb-resume …>…"}}` —
  the prior-session digest + live knowledge bundle, injected automatically. Also persists this
  session's record (cross-session continuity).
- **`hook pre-tool-use`** → on a write into the brain dir, emits
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"vfkb: edit the brain via the engine/CLI/MCP, not by writing files directly …"}}`;
  on any other write, emits `{}` (allow). Fail-open on malformed input.
- **`hook stop`** → returns `{}` on `stop_hook_active:true` (native loop guard). Otherwise, **if** there
  are uncommitted `src/`/`docs/` changes **and** no new `decision` entry since `HEAD`, it emits
  `decision:block` + an `additionalContext` reminder to record the decision; else `{}`. Fail-open.

### Optional: PostToolUse auto-capture (leave OFF for a committed brain)
Add only if your brain is **private/operational** (not committed) and you want automatic tool-call
capture feeding the distiller:

```json
"PostToolUse": [
  { "hooks": [ { "type": "command",
    "command": "VFKB_DIR=.vfkb VFKB_PROJECT=myproject node dist/cli.js hook post-tool-use" } ] }
]
```

It captures each tool call (skips vfkb's own `kb_*`/`mcp__vfkb__*` to avoid self-pollution) and always
returns `{}` (never blocks). **For a committed design brain, keep it OFF** — it floods `.vfkb` with
tool-call noise; capture knowledge deliberately via `kb_add` instead.

---

## 6. Initialize the brain & gitignore

The brain auto-creates on first write. Seed one entry and (optionally) scaffold the context doc:

```bash
# Mode A: `node dist/cli.js`;  Mode B: `vfkb`;  Mode C: `node /abs/vfkb/dist/cli.js`
VFKB_DIR=.vfkb VFKB_PROJECT=myproject vfkb add fact "project bootstrapped on vfkb" --role human
VFKB_DIR=.vfkb VFKB_PROJECT=myproject vfkb context init      # optional: scaffolds .vfkb/context.md
```

Commit only the knowledge SoR; ignore the derived/operational files. Add to the project `.gitignore`:

```gitignore
.vfkb/.sessions/
.vfkb/.signals/
.vfkb/index-meta.json
```

Then `git add .vfkb/entries.jsonl` (and `.vfkb/context.md` if you used it) — the brain ships **with**
the repo (ADR-0019). Cross-clone continuity lives in committed **entries**, not in session records.

---

## 7. First-run approval

On the first **interactive** `claude` in the project, Claude Code prompts to approve the project MCP
server + hooks. **Approve once** (per machine). After that, sessions run on vfkb automatically.
`--dangerously-skip-permissions` bypasses the prompt (used by the sandbox harnesses; not recommended
for daily work).

---

## 8. Verify the wiring (smoke test)

Run these from the project root — each was used to verify this runbook:

```bash
# 1. session-start emits the resume render
echo '{}' | VFKB_DIR=.vfkb VFKB_PROJECT=myproject vfkb hook session-start | head -c 200

# 2. brain-write is DENIED
echo '{"tool_name":"Write","tool_input":{"file_path":".vfkb/entries.jsonl","content":"x"}}' \
  | VFKB_DIR=.vfkb VFKB_PROJECT=myproject vfkb hook pre-tool-use      # → permissionDecision:deny

# 3. normal code-write is ALLOWED
echo '{"tool_name":"Write","tool_input":{"file_path":"src/foo.ts","content":"x"}}' \
  | VFKB_DIR=.vfkb VFKB_PROJECT=myproject vfkb hook pre-tool-use      # → {}

# 4. stop re-entry guard
echo '{"stop_hook_active":true}' | VFKB_DIR=.vfkb VFKB_PROJECT=myproject vfkb hook stop   # → {}

# 5. MCP server lists its 9 tools (interactive `claude` then `/mcp`, or a JSON-RPC tools/list)
```

**Hook-wiring validation (updated 2026-07-08, ADR-0048):** the in-repo wiring smoke-gate
(`scenarios/wiring-smoke.mjs`, ADR-0028) is **retired** — post-plugin-migration (ADR-0045) this
repo's live config carries no hooks; the wiring lives in vfkb-claude-plugin's `hooks.json`, and
its pre-release sandbox validation is tracked at
[vfkb-claude-plugin#6](https://github.com/vilosource/vfkb-claude-plugin/issues/6). For repos on
the `vfkb init` fallback, wiring coverage = the init emission unit tests + the
`consumer-onboarding` L4.

---

## 9. Reference

### Environment variables
| Var | Meaning | Default |
|---|---|---|
| `VFKB_DIR` | brain directory (relative to session cwd) | `~/.vfkb` |
| `VFKB_PROJECT` | project label stamped on entries / digests | `spike` |
| `KB_SESSION_ID` | persist the session record so the next session's resume can carry a `resume-note` | unset (record note is ephemeral) |

### CLI surface
`vfkb <add | list | search | query | map | context | context init | resume | resume-note | curate |
distill | save | hook session-start | hook pre-tool-use | hook post-tool-use | hook stop>`

### Committed vs gitignored in `.vfkb/`
- **Committed (SoR):** `entries.jsonl` (and `context.md` if used).
- **Gitignored (derived/operational):** `.sessions/`, `.signals/`, `index-meta.json`.

---

## 10. Troubleshooting

- **Hooks don't fire / "command not found".** Relative `dist/…` paths require the session cwd to be the
  vfkb repo (Mode A). For any *other* project use Mode B (`vfkb`/`vfkb-mcp`) or Mode C (absolute paths).
  Confirm `node` is on `PATH` and `.claude/settings.json` is valid JSON.
- **MCP "tools still connecting" in one-shot `claude -p`.** A known cold-start race (not a regression);
  the server is fine (a deterministic `tools/list` shows all 9). Use interactive `claude`, or retry.
- **Stop hook doesn't steer / loops.** The contract is verified at **CLI v2.1.195**; other versions may
  differ. Re-verify that `decision:block` + `additionalContext` reaches the agent and that
  `stop_hook_active` flips on re-entry before relying on it.
- **`npm install` fails off-VPN (`ENOTFOUND nexus…`).** vfkb only needs `npm run build` + its two deps;
  on VPN a normal install works, or bootstrap `node_modules` from another clone (see §2 Mode D caveat).
- **Brain writes blocked unexpectedly.** That's the PreToolUse gate working — write through
  `vfkb add` / `mcp__vfkb__kb_add`, not by editing `.vfkb/` files directly.
```
