#!/usr/bin/env bash
# devops-kb — clean-room, TOOLED Claude Code session for Azure infra ops, carrying the
# seeded devops-kb knowledge substrate. Isolated from mykb (fresh container HOME); real
# az / terraform / ansible / kubectl + your ~/.azure access; read-only runs free, every
# mutation prompts (the bash-guard PreToolUse hook + no --dangerously-skip-permissions).
#
# Usage:  devops-kb [--build] [extra claude args...]
#   --build            rebuild the image first (after a vtfkb change)
#   DEVOPS_KB_HOME     persistent state dir   (default ~/.devops-kb)
#   DEVOPS_KB_MODEL    pin a model            (default: CLI default model)
#   VTFKB_REPO         vtfkb checkout         (default ~/GitHub/vtfkb)
set -euo pipefail
STATE="${DEVOPS_KB_HOME:-$HOME/.devops-kb}"
BRAIN="$STATE/brain"; SYNTH="$STATE/claude.json"
GITLAB="$HOME/.devops-kb-GitLab"
REPO="${VTFKB_REPO:-$HOME/GitHub/vtfkb}"
mkdir -p "$BRAIN" "$GITLAB"; chmod 777 "$BRAIN" "$GITLAB" 2>/dev/null || true

if [ "${1:-}" = "--build" ]; then
  shift
  ( cd "$REPO" && npm run build >/dev/null && docker build -f spike/devops-kb/Dockerfile -t devops-kb . )
fi
docker image inspect devops-kb >/dev/null 2>&1 || { echo "image 'devops-kb' missing — run: devops-kb --build"; exit 1; }
[ -s "$BRAIN/entries.jsonl" ] || echo "[devops-kb] note: brain at $BRAIN looks empty — seed it with spike/devops-kb/migrate-seed.mjs"

# Synthetic ~/.claude.json — account identity ONLY (no mykb projects/MCP/history).
node -e 'const c=require(process.env.HOME+"/.claude.json");require("fs").writeFileSync(process.argv[1],JSON.stringify({oauthAccount:c.oauthAccount,claudeCodeFirstTokenDate:c.claudeCodeFirstTokenDate,hasCompletedOnboarding:true,bypassPermissionsModeAccepted:true}))' "$SYNTH"

MODEL_ARGS=(); [ -n "${DEVOPS_KB_MODEL:-}" ] && MODEL_ARGS=(--model "$DEVOPS_KB_MODEL")

# SSH for cloning <internal-gitlab> repos (the /gitlab convention). Mount the
# host keys read-only and pin git to the ed25519 key: container OpenSSH 9.x + modern
# GitLab reject ssh-rsa/SHA-1 (so id_rsa is dead here), and the host config's many
# global IdentityFiles would trip MaxAuthTries before the right key. IdentitiesOnly +
# an explicit -i sidesteps both. Direct `ssh` to infra still uses the full ~/.ssh/config.
SSH_ARGS=(); GIT_SSH=""
if [ -d "$HOME/.ssh" ]; then
  SSH_ARGS=(-v "$HOME/.ssh":/work/.ssh:ro)
  [ -f "$HOME/.ssh/gitlab_ed25519" ] && GIT_SSH="ssh -i /work/.ssh/gitlab_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
else
  echo "[devops-kb] note: no ~/.ssh — git clone of <internal-gitlab> repos won't authenticate"
fi

echo "[devops-kb] brain: $BRAIN   repos: $GITLAB -> /gitlab   az: ~/.azure (live)   -> clean-room tooled claude"
exec docker run --rm -it --user "$(id -u):$(id -g)" -e HOME=/work \
  -e GIT_SSH_COMMAND="$GIT_SSH" \
  -v "$BRAIN":/brain \
  -v "$GITLAB":/gitlab \
  -v "$HOME/.azure":/work/.azure \
  -v "$HOME/.claude/.credentials.json":/work/.claude/.credentials.json:ro \
  -v "$SYNTH":/work/.claude.json:ro \
  "${SSH_ARGS[@]}" \
  -w /gitlab \
  devops-kb \
  claude --strict-mcp-config \
         --mcp-config /opt/vtfkb/mcp-config.json \
         --settings  /opt/vtfkb/settings.json \
         "${MODEL_ARGS[@]}" "$@"
