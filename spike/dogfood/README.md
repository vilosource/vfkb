# vfkb container dogfood

A clean-room **Claude Code session inside the deployment-shaped container**
(`node:20-slim`, a proxy for the node-based vafi-developer agent image), fully
isolated from the host's mykb context, on a **persistent brain**, working the
**live vfkb repo** read-write. Dogfoods vfkb on its own repo and doubles as the
container deployment proof for the MCP face.

## Why a container

A fresh container `HOME` is isolated for free: no `/home/jasonvi/CLAUDE.md`, no
global `~/.claude.json` MCP servers, no mykb auto-memory, no `kb` on PATH, no
`~/.bashrc` funcs, no skills. Only what is baked (`dogfood.Dockerfile`) or mounted
(launcher) exists. `--strict-mcp-config` is belt-and-suspenders.

Both vfkb faces are wired at once:
- **MCP** (`mcp-config.json` → `dist/mcp-server.js`) — active pull/search/map tools.
- **hooks** (`settings.json` → `dist/cli.js`) — SessionStart Tier-A inject,
  Post/PreToolUse passive capture + brain-write gate.

## Auth

Uses the host's **Claude subscription** (flat rate), not an API key. The launcher
mounts `~/.claude/.credentials.json` (read-only) and a **synthetic
`~/.claude.json` containing only `oauthAccount`** — account identity with zero mykb
project/MCP/history leak.

## Use

```bash
spike/vfkb-dogfood.sh                 # interactive clean-room session
VFKB_DOGFOOD_MODEL=claude-haiku-4-5 spike/vfkb-dogfood.sh   # pin a model
bash spike/dogfood-smoke.sh            # headless acceptance smoke (throwaway brain)
```

Persistent state lives in `~/.vfkb-dogfood/` (`brain/` + synthetic `claude.json`);
override with `VFKB_DOGFOOD_HOME`. The agent edits the live repo on whatever branch
is checked out — work on a dedicated branch so its edits stay isolated/revertible.

## Files

| File | Role |
|---|---|
| `spike/dogfood.Dockerfile` | image: claude CLI + vfkb dist + baked clean-room config |
| `spike/vfkb-dogfood.sh` | launcher: build, synthesize creds, `docker run -it` |
| `spike/dogfood-smoke.sh` | 6-check headless acceptance smoke (ground-truth asserts) |
| `spike/dogfood/CLAUDE.md` | baked `/work/CLAUDE.md` — vfkb-only, zero mykb |
| `spike/dogfood/mcp-config.json` | vfkb MCP server, `VFKB_DIR=/brain` |
| `spike/dogfood/settings.json` | SessionStart + Pre/PostToolUse hooks |
