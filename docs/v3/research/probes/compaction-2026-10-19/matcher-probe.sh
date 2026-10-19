#!/usr/bin/env bash
# usage: matcher-probe.sh <scratch-dir>
# Which SessionStart matchers fire on source "startup" vs "compact"? One process:
# a startup turn, then /compact. Each matcher's hook logs its own tag + stdin.
# Tags are m0..mN on purpose: a `|` in a hook-command argument is a shell pipe.
set -u
M="$1"; mkdir -p "$M/sb"; git -C "$M/sb" init -q 2>/dev/null
cat > "$M/tag.sh" <<'TAG'
#!/bin/sh
in=$(cat); printf '%s\t%s\n' "$1" "$in" >> "$MLOG"; echo '{}'
TAG
chmod +x "$M/tag.sh"
node -e '
const M = process.argv[1];
const ms = [null, "startup", "startup|compact", "compact|resume", "compa", "omp.ct",
            "c.mpact", "^compact$", "comp.*", "*", "", "Compact"];
const e = (m, i) => ({ ...(m === null ? {} : { matcher: m }), hooks: [{ type: "command", command: `${M}/tag.sh m${i}` }] });
require("fs").writeFileSync(`${M}/s.json`, JSON.stringify({ enabledPlugins: { "vfkb@vfkb": false }, hooks: { SessionStart: ms.map(e) } }));
console.log(ms.map((m, i) => "m" + i + "=" + JSON.stringify(m)).join(" "));' "$M"
export MLOG="$M/log.txt"; rm -f "$MLOG"
cd "$M/sb"
{ printf '%s\n' '{"type":"user","message":{"role":"user","content":"Reply OK."}}'; sleep 20
  printf '%s\n' '{"type":"user","message":{"role":"user","content":"/compact"}}'; sleep 60; } |
  claude -p --input-format stream-json --output-format stream-json --verbose --settings "$M/s.json" \
    --model claude-haiku-4-5 --permission-mode bypassPermissions > "$M/stream.jsonl" 2> "$M/err.txt"
while IFS=$'\t' read -r t j; do
  echo "$(printf '%s' "$j" | node -pe 'JSON.parse(require("fs").readFileSync(0)).source') $t"
done < "$MLOG" | sort | awk '{a[$1]=a[$1]" "$2} END{for(k in a) print k":"a[k]}'
