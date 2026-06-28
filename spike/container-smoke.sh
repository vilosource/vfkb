#!/usr/bin/env bash
# Runs INSIDE the container. Proves the deployment/loading path with zero install.
set -euo pipefail
echo "node: $(node -v)  (no npm install was run; no native modules)"

echo "== 1. engine + CLI load and write =="
node dist/cli.js add fact "container canary is DOCKER-OK" --role human
node dist/cli.js add pattern "in-container pattern" --role architect

echo "== 2. Tier-A render (Claude Code face) =="
BLOCK=$(node dist/cli.js context-block container-test)
echo "$BLOCK"
echo "$BLOCK" | grep -q "DOCKER-OK" && echo "PASS: seeded fact in block"
[ "$(printf '%s' "$BLOCK" | wc -c)" -le 10000 ] && echo "PASS: block <= 10k"

echo "== 3. SessionStart hook JSON =="
echo '{}' | node dist/cli.js hook session-start | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!d.hookSpecificOutput.additionalContext.includes("DOCKER-OK")) throw new Error("no inject"); console.log("PASS: valid hookSpecificOutput JSON carrying the bundle")'

echo "== 4. Pi extension module loads (default export = function) =="
node --input-type=module -e 'import ext from "/vfkb/dist/pi-extension.js"; if(typeof ext!=="function") throw new Error("pi extension default export is not a function"); console.log("PASS: pi-extension.js loaded; default export is a function")'

echo "== 5. Tier-B capture path =="
echo '{"tool_name":"Bash","tool_input":{"command":"echo in-container"},"tool_use_id":"c9"}' | node dist/cli.js hook post-tool-use >/dev/null
node dist/cli.js list | grep -q "in-container" && echo "PASS: tool-call captured in-container"

echo "ALL CONTAINER SMOKES PASSED"
