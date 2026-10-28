#!/bin/sh
# Tier-0 harness-turn probe for vfkb#385 (ADR-0084 §2.6; discharges ADR-0080 §5 Q4).
# Records, per harness turn kind this script can start headlessly, whether UserPromptSubmit
# fires and the verbatim head of the `prompt` it carries. Metered (claude-haiku-4-5, a few
# cents). Kinds that need the interactive TUI are NOT driven here and are reported as
# "not observed" in README.md, never guessed.
#   sh run.sh  → writes ./out/<kind>.jsonl and prints a summary
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/out" # raw logs (gitignored by README instruction; observed.json is the committed digest); rm -rf "$OUT"; mkdir -p "$OUT"
SB=$(mktemp -d "${TMPDIR:-/tmp}/vfkb-ht-XXXXXX")
cd "$SB"; git init -q; mkdir -p .claude
settings() { # $1 = log file
  printf '{"enabledPlugins":{"vfkb@vfkb":false},"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"PROBE_LOG=%s sh %s/ups-log.sh"}]}]}}' "$1" "$HERE" > .claude/settings.json
}
run() { # $1 kind, $2 prompt, rest: extra args
  kind=$1; prompt=$2; shift 2; settings "$OUT/$kind.jsonl"
  claude -p "$prompt" "$@" --settings .claude/settings.json --strict-mcp-config --model claude-haiku-4-5 \
    --dangerously-skip-permissions --output-format json > "$OUT/$kind.result.json" 2>/dev/null || true
}
SID=$(uuidgen | tr 'A-Z' 'a-z')
run p-prompt 'Reply with the single word: ok' --session-id "$SID"
run resume-prompt 'Reply with the single word: again' --resume "$SID"
run background-task 'Use the Bash tool with run_in_background=true to run: sleep 4; echo bg-finished . Then wait until you are notified that the background task completed, and reply with its output.'
run subagent 'Use the Agent/Task tool to spawn one general-purpose subagent whose only job is to reply "sub-ok". Then reply with what it returned.'
echo "--- summary (prompt heads, first 80 chars) ---"
for f in "$OUT"/*.jsonl; do
  k=$(basename "$f" .jsonl); n=$(wc -l < "$f" | tr -d ' ')
  echo "$k: $n UserPromptSubmit fire(s)"
  node -e 'for (const l of require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean)) { const p = JSON.parse(l).prompt ?? ""; console.log("   " + JSON.stringify(String(p).slice(0,80))); }' "$f"
done
rm -rf "$SB"
