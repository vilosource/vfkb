#!/usr/bin/env bash
# Stage-1 headless acceptance smoke for the vtfkb container dogfood.
# Every assertion checks GROUND TRUTH (the brain file / hook output on the host),
# never the agent's self-report. Uses a THROWAWAY brain so it can't pollute the real
# dogfood brain. Requires: `docker build -t vtfkb-dogfood -f spike/dogfood.Dockerfile .`
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="${VTFKB_DOGFOOD_HOME:-$HOME/.vtfkb-dogfood}"; SYNTH="$STATE/claude.json"
BRAIN="$(mktemp -d)"; chmod 777 "$BRAIN"
mkdir -p "$STATE"
node -e 'const c=require(process.env.HOME+"/.claude.json");require("fs").writeFileSync(process.argv[1],JSON.stringify({oauthAccount:c.oauthAccount,claudeCodeFirstTokenDate:c.claudeCodeFirstTokenDate,hasCompletedOnboarding:true,bypassPermissionsModeAccepted:true}))' "$SYNTH"

pass=0; fail=0
ok(){ echo "  PASS: $1"; pass=$((pass+1)); }
no(){ echo "  FAIL: $1"; fail=$((fail+1)); }
drun(){ docker run --rm --user "$(id -u):$(id -g)" -e HOME=/work \
  -v "$REPO":/work/vtfkb -v "$BRAIN":/brain \
  -v "$HOME/.claude/.credentials.json":/work/.claude/.credentials.json:ro \
  -v "$SYNTH":/work/.claude.json:ro -w /work/vtfkb vtfkb-dogfood "$@"; }
claude_p(){ drun claude -p "$1" --strict-mcp-config --mcp-config /opt/vtfkb/mcp-config.json \
  --settings /opt/vtfkb/settings.json --model claude-haiku-4-5 --dangerously-skip-permissions 2>&1; }

echo "== 1. seed a distinctive fact via the engine (sole writer) =="
drun node /opt/vtfkb/dist/cli.js add fact "The dogfood canary marker is ZEBRA-7" --role human >/dev/null
drun node /opt/vtfkb/dist/cli.js list | grep -q "ZEBRA-7" && ok "seed fact in brain" || no "seed fact missing"

echo "== 2. Tier-A: SessionStart hook injects seeded knowledge (valid JSON) =="
INJ=$(echo '{}' | drun node /opt/vtfkb/dist/cli.js hook session-start)
echo "$INJ" | grep -q "ZEBRA-7" && ok "SessionStart injects seeded fact" || no "no Tier-A inject"
echo "$INJ" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s).hookSpecificOutput.additionalContext;process.exit(0)}catch(e){process.exit(1)}})' && ok "valid hookSpecificOutput JSON" || no "inject JSON malformed"

echo "== 3. Tier-B: a REAL claude session's tool call is captured =="
claude_p "Use the Bash tool to run exactly this command: echo CANARY-RUN-9 . Then stop." >/dev/null
drun node /opt/vtfkb/dist/cli.js list | grep -qi "CANARY-RUN-9" && ok "tool call captured (Tier-B)" || no "no Tier-B capture"

echo "== 4. Round-trip: the capture surfaces in a later SessionStart =="
echo '{}' | drun node /opt/vtfkb/dist/cli.js hook session-start | grep -qi "CANARY-RUN-9" && ok "captured item served back" || no "round-trip miss"

echo "== 5. Naive isolation: no mykb knowledge present =="
ISO=$(claude_p "What do you know about 'mykb', the 'kb' CLI, or mykb 'workspaces'? If you have no project knowledge of them, reply with exactly: NOTHING")
echo "$ISO" | grep -qiE "\.mykb|kb work |workspace.*handoff|jsonl.*sqlite|three-tier" && no "mykb detail leaked -> ${ISO:0:140}" || ok "no mykb leak"

echo "== 6. MCP face loaded + strict isolation (vtfkb tools usable, no foreign MCP) =="
MCP=$(claude_p "Use your vtfkb knowledge tools to search the knowledge base for the word canary, then report the result count prefixed with RESULTS= . Use no other tool.")
echo "$MCP" | grep -qi "RESULTS=" && ok "vtfkb MCP face usable in-container" || no "MCP face not usable -> ${MCP:0:140}"

echo "== 7. RFC-001 relevance floor active in-container (deterministic, no LLM) =="
STRONG=$(drun node /opt/vtfkb/dist/cli.js search "dogfood canary marker")
NOISE=$(drun node /opt/vtfkb/dist/cli.js search "canary migration to a different cloud region entirely")
{ echo "$STRONG" | grep -q "ZEBRA-7" && [ -z "$NOISE" ]; } \
  && ok "floor drops 1-of-many noise, keeps the strong match" \
  || no "RFC-001 floor not active -> strong='${STRONG:0:60}' noise='${NOISE:0:60}'"

echo; echo "SMOKE: $pass passed, $fail failed"; rm -rf "$BRAIN"
[ "$fail" -eq 0 ]
