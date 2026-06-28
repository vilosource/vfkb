#!/usr/bin/env bash
# Launch the clean-room vfkb dogfood: an INTERACTIVE Claude Code session inside the
# deployment-shaped container (node:20-slim ~ vafi-developer image), fully isolated
# from mykb, on a PERSISTENT brain, working the LIVE vfkb repo (read-write).
#
# Isolation: a fresh container HOME has no /home/jasonvi/CLAUDE.md, no global
# ~/.claude.json MCP servers, no mykb auto-memory, no kb/bashrc/skills. --strict-mcp-config
# is belt-and-suspenders on top. Both vfkb faces are wired (MCP + session hooks).
#
# Usage:  spike/vfkb-dogfood.sh [extra claude args...]
#   VFKB_DOGFOOD_HOME=<dir>   persistent state dir   (default ~/.vfkb-dogfood)
#   VFKB_DOGFOOD_MODEL=<id>   pin a model            (default: CLI default model)
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"      # ~/GitHub/vfkb
STATE="${VFKB_DOGFOOD_HOME:-$HOME/.vfkb-dogfood}"
BRAIN="$STATE/brain"; SYNTH="$STATE/claude.json"
mkdir -p "$BRAIN"; chmod 777 "$BRAIN"

echo "[dogfood] build + image refresh..."
( cd "$REPO" && npm run build >/dev/null && docker build -q -f spike/dogfood.Dockerfile -t vfkb-dogfood . >/dev/null )

# Synthetic ~/.claude.json — ONLY oauthAccount (account identity). No mykb projects,
# MCP servers, or history. This is what keeps the session naive.
node -e 'const c=require(process.env.HOME+"/.claude.json");require("fs").writeFileSync(process.argv[1],JSON.stringify({oauthAccount:c.oauthAccount,claudeCodeFirstTokenDate:c.claudeCodeFirstTokenDate,hasCompletedOnboarding:true,bypassPermissionsModeAccepted:true}))' "$SYNTH"

MODEL_ARGS=(); [ -n "${VFKB_DOGFOOD_MODEL:-}" ] && MODEL_ARGS=(--model "$VFKB_DOGFOOD_MODEL")

echo "[dogfood] brain: $BRAIN   repo (rw): $REPO   ->  clean-room claude"
exec docker run --rm -it --user "$(id -u):$(id -g)" -e HOME=/work \
  -v "$REPO":/work/vfkb \
  -v "$BRAIN":/brain \
  -v "$HOME/.claude/.credentials.json":/work/.claude/.credentials.json:ro \
  -v "$SYNTH":/work/.claude.json:ro \
  -w /work/vfkb \
  vfkb-dogfood \
  claude --strict-mcp-config \
         --mcp-config /opt/vfkb/mcp-config.json \
         --settings  /opt/vfkb/settings.json \
         "${MODEL_ARGS[@]}" "$@"
