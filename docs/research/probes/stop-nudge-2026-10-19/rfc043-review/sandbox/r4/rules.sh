# RECREATED 2026-10-28 for vfkb#386 (ADR-0084 §5.3): round 4's `r4-cases.sh` and
# `r4-shallow.sh` source `../rules.sh`, which was never committed. This is the rule plumbing
# of `../anchor-proto.sh` (rules today, r2, A, B), copied verbatim except:
#   - it locates `lib.sh` from its own path, so it can be sourced from any run dir;
#   - KEY selects the pin key the carrier lookup matches (`updated`, the default, reproduces
#     the committed r4 outputs byte-for-byte; `created` is ADR-0082 §2's key, used by
#     `rerun-created.sh`). $U is whatever the case sets: the pin's `updated` or `created`.
# THROWAWAY prototype, like anchor-proto.sh: production is src/pin-staleness.ts, whose unit
# fixtures (test/pin-staleness.test.ts) are the standing gate (decide step D3).
# Run from a fresh subdir of r4/:  mkdir p && cd p && bash ../r4-cases.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"
set +e
# entry id updated tag [created] — lib.sh's entry() hard-codes created=2026-01-01, which is
# inert under KEY=updated but wrong under KEY=created. Here created defaults to updated (a
# first version), and a same-id re-version passes its ORIGINAL created as $4 (decide D2).
# Overridden here, not in lib.sh, so rerun-created-keys.sh's edit guard on lib.sh still holds.
entry(){ printf '{"id":"%s","type":"fact","text":"t","tags":["%s"],"created":"%s","updated":"%s"}\n' "$1" "$3" "${4:-$2}" "$2" >> .vfkb/entries.jsonl; }
EMPTY=4b825dc642cb6eb9a060e54bf8d69288fbee4904
WORK=$PWD
KEY=${KEY:-updated}

esc(){ printf '%s' "$1" | sed 's/[.[\*^$]/\\&/g'; }
pin_in_head(){ [ -n "$ENT" ] && git show "HEAD:$ENT" 2>/dev/null | grep -F "\"id\":\"$ID\"" | grep -qF "\"$KEY\":\"$U\""; }
carrier_of(){ pin_in_head || return 0
  git log --first-parent --reverse --format=%H -G"\"id\":\"$(esc "$ID")\".*\"$KEY\":\"$(esc "$U")\"" HEAD -- "$ENT" | head -1; }
subj(){ for h in "$@"; do git log -1 --format=%s "$h"; done | paste -sd'|' -; }
show(){ [ -z "$1" ] && echo "quiet" || echo "STALE {$(subj $1)}"; }
u_epoch(){ date -j -u -f '%Y-%m-%dT%H:%M:%S' "${U%.*}" +%s 2>/dev/null || date -u -d "$U" +%s; }

r_today(){ local T; T=$(git rev-list -1 --before="$U" HEAD)
  git diff --quiet "${T:-$EMPTY}" HEAD -- "${PATHS[@]}"; [ $? = 1 ] && echo "STALE (tree diff)" || echo quiet; }
r_r2(){ local T C A; T=$(git rev-list -1 --before="$U" HEAD); C=$(carrier_of); A=$T
  if [ -n "$C" ]; then
    if [ -z "$T" ] || git merge-base --is-ancestor "$T" "$C"; then A=$C
    elif ! git merge-base --is-ancestor "$C" "$T"; then echo "UNDEFINED (anchors incomparable)"; return; fi
  fi
  git diff --quiet "${A:-$EMPTY}" HEAD -- "${PATHS[@]}"; local s=$?
  local L; L=$(git log --first-parent --format=%H ${A:+$A..}HEAD -- "${PATHS[@]}")
  [ $s = 1 ] && echo "STALE {$(subj $L)}" || echo quiet; }
setA(){ local TF C; TF=$(git rev-list -1 --first-parent --before="$U" HEAD); C=$(carrier_of)
  git log --first-parent --format=%H ${TF:+$TF..}HEAD -- "${PATHS[@]}" | { [ -n "$C" ] && grep -v "^$C\$" || cat; }; }
r_A(){ show "$(setA | xargs)"; }
r_B(){ local C S=""; C=$(carrier_of); local ue; ue=$(u_epoch)
  for h in $(setA); do
    if [ -n "$C" ] && git merge-base --is-ancestor "$h" "$C" && [ "$(git log -1 --format=%at "$h")" -le "$ue" ]; then continue; fi
    S="$S $h"; done; show "$(echo $S)"; }

report(){ # report <case> <expected>
  printf '\n### %s\nexpected: %s\n  today: %s\n  r2   : %s\n  A    : %s\n  B    : %s\n' "$1" "$2" "$(r_today)" "$(r_r2)" "$(r_A)" "$(r_B)"; }
fresh(){ cd "$WORK"; rm -rf "$1"; mkdir "$1"; cd "$1"; git init -q -b main; mkdir .vfkb; echo a>a; git add -A; c 2026-01-01T00:00:00Z init; }
ENT=.vfkb/entries.jsonl; PATHS=(. ':(exclude).vfkb')
