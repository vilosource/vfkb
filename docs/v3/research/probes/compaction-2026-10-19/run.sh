#!/usr/bin/env bash
# usage: run.sh <run-name> <all|startup-only>
# Turn 1 starts a session, turn 2 runs /compact in it, turn 3 asks for the sentinel.
set -u
P="$(cd "$(dirname "$0")" && pwd)"
export PROBE_LOG="$P/$1.jsonl" PROBE_MODE="$2"
rm -f "$PROBE_LOG"
mkdir -p "$P/sandbox" && cd "$P/sandbox"
C=(--settings "$P/settings.json" --model claude-haiku-4-5 --permission-mode bypassPermissions --output-format json)
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(String(j[process.argv[1]]).slice(0,300))}catch{console.log("NONJSON: "+s.slice(0,300))}})' "$1"; }

r1=$(claude -p "Reply with the single word OK." "${C[@]}")
sid=$(printf '%s' "$r1" | field session_id)
echo "sid=$sid"
echo "t1: $(printf '%s' "$r1" | field result)"
r2=$(claude -p "/compact" --resume "$sid" "${C[@]}")
echo "t2: $(printf '%s' "$r2" | field result) | is_error=$(printf '%s' "$r2" | field is_error) | sid=$(printf '%s' "$r2" | field session_id)"
r3=$(claude -p "What is the vault code word in your context? Reply with only the code word, or NONE." --resume "$sid" "${C[@]}")
echo "t3: $(printf '%s' "$r3" | field result)"
echo "--- events"
node -e '
for (const l of require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n")) {
  const { _ev, payload: p } = JSON.parse(l);
  const extra = Object.fromEntries(Object.entries(p).filter(([k]) => !["session_id","transcript_path","cwd","hook_event_name","permission_mode","prompt_id"].includes(k)).map(([k,v]) => [k, typeof v === "string" ? v.slice(0,120) : v]));
  console.log(_ev, (p.session_id||"").slice(0,8), JSON.stringify(extra));
}' "$PROBE_LOG"
