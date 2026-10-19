#!/usr/bin/env bash
# usage: real.sh <run-name> <plugin-dir>
# One process, three user messages (stream-json): OK -> /compact -> ask for the
# constitutional sentinel. No --resume, so no SessionStart(resume) between the
# compaction and the question: anything the agent knows afterwards came from
# the compaction summary or from a SessionStart(compact) re-injection.
set -u
P="$(cd "$(dirname "$0")" && pwd)"
export PROBE_LOG="$P/$1.jsonl"
rm -f "$PROBE_LOG"
cd "$P/real"
msg() { printf '{"type":"user","message":{"role":"user","content":%s}}\n' "$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$1")"; }
{
  msg "Reply with the single word OK."
  sleep 25
  msg "/compact"
  sleep 60
  msg "What is the vault code word in your context? Reply with only the code word, or NONE."
  sleep 40
} | claude -p --input-format stream-json --output-format stream-json --verbose \
    --plugin-dir "$2" --settings "$P/real-settings.json" \
    --model claude-haiku-4-5 --permission-mode bypassPermissions > "$P/$1.stream.jsonl" 2>"$P/$1.err"
echo "results:"
node -e '
for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean)) {
  let j; try { j = JSON.parse(l); } catch { continue; }
  if (j.type === "result") console.log("  result:", JSON.stringify(String(j.result).slice(0,120)), "is_error=" + j.is_error);
}' "$P/$1.stream.jsonl"
node "$P/extract.mjs" "$P/$1.stream.jsonl"
echo "events:"
node -e '
for (const l of require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n")) {
  const { _ev, payload: p } = JSON.parse(l);
  console.log(" ", _ev, (p.session_id||"").slice(0,8), p.source || p.trigger || "");
}' "$PROBE_LOG"
