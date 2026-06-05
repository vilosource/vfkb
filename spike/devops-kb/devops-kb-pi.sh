#!/usr/bin/env bash
# devops-kb (PI face) — the same clean-room, TOOLED Azure-ops session as devops-kb.sh,
# but driven by **pi** instead of Claude Code, on **GitHub Copilot Claude Haiku 4.5**.
#
# Same brain (~/.devops-kb/brain), same infra toolchain + ~/.azure access, same posture
# (read-only runs free; every mutation prompts — here via the infra-guard pi extension,
# since pi has no native tool-approval). vtfkb is wired as three pi extensions:
#   pi-extension.js    inject (session-start + per-turn delta) + capture + brain-write gate + git save
#   pi-mcp-bridge.js   the vtfkb MCP tools (kb_search/kb_map/kb_get/kb_list/kb_add/…) as native pi tools
#   infra-guard.mjs    the mutation gate (ctx.ui.confirm; fail-safe block with no UI)
#
# Auth: reuses your host Copilot auth (~/.pi/agent/auth.json) — pi re-exchanges the
# short-lived Copilot token from the long-lived GitHub OAuth token at session start.
# Provider/endpoint are resolved natively by pi (business plan -> api.business.githubcopilot.com).
#
# Usage:  devops-kb-pi [--build] [extra pi args...]
#   --build            rebuild the image first (after a vtfkb change)
#   DEVOPS_KB_HOME     persistent state dir   (default ~/.devops-kb)
#   DEVOPS_KB_MODEL    pin a model            (default: claude-haiku-4.5 via github-copilot)
#   VTFKB_REPO         vtfkb checkout         (default ~/GitHub/vtfkb)
set -euo pipefail
STATE="${DEVOPS_KB_HOME:-$HOME/.devops-kb}"
BRAIN="$STATE/brain"
PICFG="$STATE/pi-agent"           # synthetic, writable ~/.pi/agent for the container
GITLAB="$HOME/.devops-kb-GitLab"
REPO="${VTFKB_REPO:-$HOME/GitHub/vtfkb}"
MODEL="${DEVOPS_KB_MODEL:-claude-haiku-4.5}"
mkdir -p "$BRAIN" "$GITLAB" "$PICFG"; chmod 777 "$BRAIN" "$GITLAB" 2>/dev/null || true

if [ "${1:-}" = "--build" ]; then
  shift
  ( cd "$REPO" && npm run build >/dev/null && docker build -f spike/devops-kb/Dockerfile -t devops-kb . )
fi
docker image inspect devops-kb >/dev/null 2>&1 || { echo "image 'devops-kb' missing — run: devops-kb-pi --build"; exit 1; }
[ -s "$BRAIN/entries.jsonl" ] || echo "[devops-kb-pi] note: brain at $BRAIN looks empty — seed it with spike/devops-kb/migrate-seed.mjs"

# Clean-room ~/.pi/agent: host-proven Copilot auth + provider defs, but a stripped
# settings.json (NONE of the host's machine-specific extensions — those paths don't
# exist in the container and would crash extension loading). Copied (not mounted ro)
# so pi can persist its refreshed Copilot token for the session.
[ -f "$HOME/.pi/agent/auth.json" ]   || { echo "[devops-kb-pi] missing ~/.pi/agent/auth.json — run 'pi' once on the host to authenticate Copilot"; exit 1; }
cp "$HOME/.pi/agent/auth.json" "$PICFG/auth.json"
[ -f "$HOME/.pi/agent/models.json" ] && cp "$HOME/.pi/agent/models.json" "$PICFG/models.json"
cat > "$PICFG/settings.json" <<EOF
{ "defaultProvider": "github-copilot", "defaultModel": "$MODEL", "extensions": [], "defaultThinkingLevel": "medium" }
EOF
chmod -R 700 "$PICFG"

# SSH for cloning gitlab.optiscangroup.com repos (the /gitlab convention). Mount the
# host keys read-only and pin git to the ed25519 key: container OpenSSH 9.x + modern
# GitLab reject ssh-rsa/SHA-1 (so id_rsa is dead here), and the host config's many
# global IdentityFiles would trip MaxAuthTries before the right key. IdentitiesOnly +
# an explicit -i sidesteps both. Direct `ssh` to infra still uses the full ~/.ssh/config.
SSH_ARGS=(); GIT_SSH=""
GITLAB_KEY="$HOME/.ssh/gitlab_ed25519"
if [ -d "$HOME/.ssh" ]; then
  SSH_ARGS=(-v "$HOME/.ssh":/work/.ssh:ro)
  [ -f "$GITLAB_KEY" ] && GIT_SSH="ssh -i /work/.ssh/gitlab_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
else
  echo "[devops-kb-pi] note: no ~/.ssh — git clone of gitlab.optiscangroup.com repos won't authenticate"
fi

echo "[devops-kb-pi] brain: $BRAIN   repos: $GITLAB -> /gitlab   az: ~/.azure (live)   model: github-copilot/$MODEL"
exec docker run --rm -it --user "$(id -u):$(id -g)" -e HOME=/work \
  -e VTFKB_DIR=/brain -e VTFKB_PROJECT=devops-kb -e VTFKB_MCP_CONFIG=/opt/vtfkb/mcp-config.json \
  -e GIT_SSH_COMMAND="$GIT_SSH" \
  -v "$BRAIN":/brain \
  -v "$GITLAB":/gitlab \
  -v "$HOME/.azure":/work/.azure \
  -v "$PICFG":/work/.pi/agent \
  "${SSH_ARGS[@]}" \
  -w /gitlab \
  devops-kb \
  pi --provider github-copilot --model "$MODEL" \
     -e /opt/vtfkb/dist/pi-extension.js \
     -e /opt/vtfkb/dist/pi-mcp-bridge.js \
     -e /opt/vtfkb/infra-guard.mjs \
     --append-system-prompt /opt/vtfkb/operating-rules.md \
     "$@"
