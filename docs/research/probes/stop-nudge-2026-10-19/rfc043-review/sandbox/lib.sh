set -e
c(){ # c <date> <msg> : commit all at given date
  GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q --allow-empty -m "$2"; }
entry(){ # entry id updated tag
  printf '{"id":"%s","type":"fact","text":"t","tags":["%s"],"created":"2026-01-01T00:00:00.000Z","updated":"%s"}\n' "$1" "$3" "$2" >> .vfkb/entries.jsonl; }
carrier(){ git log --first-parent --reverse --format=%H -G"\"id\":\"$1\".*\"updated\":\"$2\"" HEAD -- .vfkb/entries.jsonl | head -1; }
ts(){ git rev-list -1 --before="$1" HEAD; }
name(){ [ -z "$1" ] && echo "(none)" || git log -1 --format=%s "$1"; }
