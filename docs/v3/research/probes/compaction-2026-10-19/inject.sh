#!/bin/sh
# SessionStart: log, then inject a sentinel that names the source it was injected on
in=$(cat); printf '{"_ev":"SessionStart","payload":%s}\n' "$in" >> "$PROBE_LOG"
src=$(printf '%s' "$in" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).source||"none")}catch{console.log("parse-fail")}})')
if [ "$PROBE_MODE" != "all" ] && [ "$PROBE_MODE" != "$src-only" ]; then echo "{}"; exit 0; fi
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"PROBE SENTINEL: the vault code word is TANGERINE-%s-4471."}}\n' "$src"
