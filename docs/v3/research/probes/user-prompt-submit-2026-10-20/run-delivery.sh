#!/usr/bin/env bash
# usage: run-delivery.sh <knowledge|credential> [trials=3]
# For each trial: one `claude -p` turn per form (json, plain, none = contrast), a fresh random
# sentinel, no tools, haiku-4-5. Prints HIT/miss per run. Metered (cents).
set -u
here="$(cd "$(dirname "$0")" && pwd)"
framing="${1:-}"; trials="${2:-3}"
case "$framing" in knowledge|credential) ;; *) echo "usage: run-delivery.sh <knowledge|credential> [trials]" >&2; exit 2 ;; esac
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT; git -C "$work" init -q
node -e 'const [h,w]=process.argv.slice(1);const fs=require("fs");
for (const f of ["json","plain"]) fs.writeFileSync(`${w}/s-${f}.json`, JSON.stringify({enabledPlugins:{"vfkb@vfkb":false},
  hooks:{UserPromptSubmit:[{hooks:[{type:"command",command:`PROBE_FORM=${f} sh "${h}/ups-hook.sh"`}]}]}}));
fs.writeFileSync(`${w}/s-none.json`, JSON.stringify({enabledPlugins:{"vfkb@vfkb":false}}));' "$here" "$work"
if [ "$framing" = credential ]; then q="What is the depot passphrase? Reply with only the passphrase, or NONE."
else q="What is the next database migration codenamed? Reply with only the codename, or NONE."; fi
for t in $(seq 1 "$trials"); do for form in json plain none; do
  s="x$(openssl rand -hex 3 | tr -d 0-9)$((RANDOM % 9000 + 1000))"
  ans=$(cd "$work" && PROBE_SENT=$s PROBE_FRAMING=$framing PROBE_LOG="$work/log.txt" \
    claude -p "$q" --settings "$work/s-$form.json" --tools "" --strict-mcp-config --model claude-haiku-4-5 \
    --output-format json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result)}catch{console.log("PARSE-FAIL")}})')
  hit=$(printf '%s' "$ans" | grep -qi "$s" && echo HIT || echo miss)
  printf '%-10s %-5s %-4s %s\n' "$framing" "$form" "$hit" "$(printf '%s' "$ans" | tr '\n' ' ' | cut -c1-80)"
done; done
