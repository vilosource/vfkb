# THROWAWAY prototype of RFC-043 Part 0's anchor rule (not production code).
# Run from a fresh empty subdir of sandbox/:  mkdir p && cd p && bash ../anchor-proto.sh
# Each case builds its own repo in ./<case>/ and prints one row per rule:
#   today = current handoffIsStale (rev-list --before, tree diff)
#   r2    = RFC-043 @ 5d4c2e5: committed pin -> later of carrier and ts anchor, else ts anchor
#   A     = round-3 proposal: first-parent ts anchor; stale iff a first-parent commit in
#           TF..HEAD touches non-brain paths, excluding the carrier; Part A lists that set
#   B     = A, minus commits BELOW the carrier whose AUTHOR date is <= the pin's updated
#           (rebased pre-pin work: rebase rewrites committer dates, keeps author dates)
. ../lib.sh
set +e
EMPTY=4b825dc642cb6eb9a060e54bf8d69288fbee4904
WORK=$PWD

# --- rule plumbing. Inputs: $U (pin updated), $ID (pin id), $ENT (entries path in HEAD, or ""),
#     PATHS (array pathspec).
esc(){ printf '%s' "$1" | sed 's/[.[\*^$]/\\&/g'; }
pin_in_head(){ [ -n "$ENT" ] && git show "HEAD:$ENT" 2>/dev/null | grep -F "\"id\":\"$ID\"" | grep -qF "\"updated\":\"$U\""; }
carrier_of(){ pin_in_head || return 0
  git log --first-parent --reverse --format=%H -G"\"id\":\"$(esc "$ID")\".*\"updated\":\"$(esc "$U")\"" HEAD -- "$ENT" | head -1; }
subj(){ for h in "$@"; do git log -1 --format=%s "$h"; done | paste -sd'|' -; }
show(){ [ -z "$1" ] && echo "quiet" || echo "STALE {$(subj $1)}"; }

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
r_B(){ local C S=""; C=$(carrier_of); local ue; ue=$(date -j -u -f '%Y-%m-%dT%H:%M:%S' "${U%.*}" +%s 2>/dev/null || date -u -d "$U" +%s)
  for h in $(setA); do
    if [ -n "$C" ] && git merge-base --is-ancestor "$h" "$C" && [ "$(git log -1 --format=%at "$h")" -le "$ue" ]; then continue; fi
    S="$S $h"; done; show "$(echo $S)"; }

report(){ # report <case> <expected>
  printf '\n### %s\nexpected: %s\n  today: %s\n  r2   : %s\n  A    : %s\n  B    : %s\n' "$1" "$2" "$(r_today)" "$(r_r2)" "$(r_A)" "$(r_B)"; }
fresh(){ cd "$WORK"; rm -rf "$1"; mkdir "$1"; cd "$1"; git init -q -b main; mkdir .vfkb; echo a>a; git add -A; c 2026-01-01T00:00:00Z init; }
ENT=.vfkb/entries.jsonl; PATHS=(. ':(exclude).vfkb')

# 1. plain squash (cause 1): pin on topic, more code on topic, squash to main
fresh squash; git switch -q -c topic
entry P1 2026-01-02T00:00:00.000Z handoff; git add -A; c 2026-01-02T01:00:00Z "topic: pin"
echo b>b; git add -A; c 2026-01-03T00:00:00Z "topic: code after pin"
git switch -q main; git merge -q --squash topic; c 2026-01-04T00:00:00Z "squash topic (#1)"
ID=P1 U=2026-01-02T00:00:00.000Z; report "1 squash carries pin" "quiet (code inside the carrier is the disclosed loss)"
# 1b. another PR merged after the squash
echo x>x; git add -A; c 2026-01-05T00:00:00Z "squash other (#2)"
report "1b squash, then another PR" "STALE {squash other (#2)}"

# 2. --no-ff merge carries the pin
fresh noff; git switch -q -c t2
entry P2 2026-01-05T00:00:00.000Z handoff; git add -A; c 2026-01-05T01:00:00Z "t2: pin"
git switch -q main; GIT_COMMITTER_DATE=2026-01-06T00:00:00Z GIT_AUTHOR_DATE=2026-01-06T00:00:00Z git merge -q --no-ff t2 -m "merge t2"
ID=P2 U=2026-01-05T00:00:00.000Z; report "2 no-ff merge carries pin" "quiet"

# 3. retagged old entry (promoted to pin after code landed)
fresh retag; entry P3 2026-01-02T00:00:00.000Z fact; git add -A; c 2026-01-02T01:00:00Z "P3 first version"
echo c>c; git add -A; c 2026-01-07T00:00:00Z code1
echo d>d; git add -A; c 2026-01-08T00:00:00Z code2
entry P3 2026-01-09T00:00:00.000Z handoff; git add -A; c 2026-01-09T01:00:00Z "retag P3"
ID=P3 U=2026-01-09T00:00:00.000Z; report "3 retagged old entry" "quiet"
echo e>e; git add -A; c 2026-01-10T00:00:00Z code3
report "3b retagged, then code" "STALE {code3}"

# 4. uncommitted pin
fresh uncommitted; echo b>b; git add -A; c 2026-01-02T00:00:00Z "code before pin"
entry P4 2026-01-03T00:00:00.000Z handoff
ID=P4 U=2026-01-03T00:00:00.000Z; report "4 uncommitted pin, nothing after" "quiet"
echo k>k; git add k; c 2026-01-04T00:00:00Z "code after pin"
report "4b uncommitted pin, code committed after" "STALE {code after pin}"

# 5. case2: committed pin on main, then a true merge of a pre-pin feature commit
fresh case2; git switch -q -c feat; echo f>f; git add -A; c 2026-02-03T00:00:00Z "F feature (pre-pin)"
git switch -q main; echo p>p; git add -A; c 2026-02-02T00:00:00Z "P main (pre-pin)"
entry PX 2026-02-04T00:00:00.000Z handoff; git add -A; c 2026-02-04T12:00:00Z "C carries pin"
GIT_COMMITTER_DATE=2026-02-05T00:00:00Z GIT_AUTHOR_DATE=2026-02-05T00:00:00Z git merge -q --no-ff feat -m "M merge feat (post-pin)"
ID=PX U=2026-02-04T00:00:00.000Z; report "5 committed pin, then true merge (R3-M1)" "STALE {M merge feat (post-pin)}"

# 6. case2-u: uncommitted pin on main, true merge after (R3-M2)
fresh case2u; git switch -q -c feat; echo f>f; git add -A; c 2026-02-03T00:00:00Z "F feature (pre-pin)"
git switch -q main; echo p>p; git add -A; c 2026-02-02T00:00:00Z "P main (pre-pin)"
GIT_COMMITTER_DATE=2026-02-05T00:00:00Z GIT_AUTHOR_DATE=2026-02-05T00:00:00Z git merge -q --no-ff feat -m "M merge feat (post-pin)"
entry PU 2026-02-04T00:00:00.000Z handoff
ID=PU U=2026-02-04T00:00:00.000Z; report "6 uncommitted pin, true merge after (R3-M2)" "STALE {M merge feat (post-pin)}"

# 7. case3 (R3-B1): handoff, then code, then brain-only commit at session end
fresh case3; git switch -q -c topic
entry PE 2026-03-02T10:00:00.000Z handoff
echo k>k; git add k; c 2026-03-02T11:00:00Z "K code after the handoff"
git add .vfkb/entries.jsonl; c 2026-03-02T12:00:00Z "E session-end brain commit"
ID=PE U=2026-03-02T10:00:00.000Z; report "7 handoff -> code -> brain commit (R3-B1)" "STALE {K code after the handoff}"
# 7b. same, then that topic is squash-merged to main
git switch -q main; git merge -q --squash topic; c 2026-03-03T00:00:00Z "squash topic (#3)"
report "7b ...then squash-merged to main" "quiet (K is inside the carrier: the disclosed loss)"

# 8. outside-tree brain (no carrier possible; pathspec '.')
fresh outside; rm -rf .vfkb; OUT=$WORK/outside-brain; rm -rf "$OUT"; mkdir -p "$OUT/.vfkb"
( cd "$OUT"; entry PO 2026-01-03T00:00:00.000Z handoff )
echo b>b; git add -A; c 2026-01-02T00:00:00Z "code before pin"
ENT="" PATHS=(.); ID=PO U=2026-01-03T00:00:00.000Z; report "8 outside-tree brain, nothing after" "quiet"
echo k>k; git add -A; c 2026-01-04T00:00:00Z "code after pin"
report "8b outside-tree brain, code after" "STALE {code after pin}"
ENT=.vfkb/entries.jsonl; PATHS=(. ':(exclude).vfkb')

# 9. rebase: pre-pin code + committed pin on topic; main advances after the pin; topic rebased
fresh rebase; git switch -q -c topic
echo a1>a1; git add -A; c 2026-01-02T00:00:00Z "A1 topic code (pre-pin)"
entry PR 2026-01-03T00:00:00.000Z handoff; git add -A; c 2026-01-03T01:00:00Z "topic: pin"
git switch -q main; echo m1>m1; git add -A; c 2026-01-04T00:00:00Z "M1 main (post-pin)"
git switch -q topic; GIT_COMMITTER_DATE=2026-01-05T00:00:00Z git rebase -q main
ID=PR U=2026-01-03T00:00:00.000Z; report "9 rebase onto main that moved after the pin" "STALE {M1 main (post-pin)} only"
# 9b. rebase that only rewrites dates (no upstream change)
fresh rebase0; git switch -q -c topic
echo a1>a1; git add -A; c 2026-01-02T00:00:00Z "A1 topic code (pre-pin)"
entry PR 2026-01-03T00:00:00.000Z handoff; git add -A; c 2026-01-03T01:00:00Z "topic: pin"
GIT_COMMITTER_DATE=2026-01-05T00:00:00Z git rebase -q --force-rebase main
report "9b force-rebase, no upstream change" "quiet"

# 10. root brain (VFKB_DATA_DIR=.): brain files live at the root
fresh root; rm -rf .vfkb; ENT=entries.jsonl; PATHS=(. ':(exclude)entries.jsonl' ':(exclude)manifest.json')
printf '{"id":"PT","type":"fact","text":"t","tags":["handoff"],"created":"2026-01-01T00:00:00.000Z","updated":"2026-01-03T00:00:00.000Z"}\n' > entries.jsonl
git add -A; c 2026-01-03T01:00:00Z "root: pin"
ID=PT U=2026-01-03T00:00:00.000Z; report "10 root brain, committed pin" "quiet"
echo k>k; git add -A; c 2026-01-04T00:00:00Z "code after pin"
report "10b root brain, code after" "STALE {code after pin}"
ENT=.vfkb/entries.jsonl; PATHS=(. ':(exclude).vfkb')

# 11. B's known blind spot: another PR's commit AUTHORED before the pin is rebase-merged onto
#     main AFTER the pin, below the carrier (GitHub "rebase and merge"), then our squash lands.
fresh rebasemerge; git switch -q -c other
GIT_AUTHOR_DATE=2026-01-02T00:00:00Z GIT_COMMITTER_DATE=2026-01-02T00:00:00Z sh -c 'echo o>o; git add -A; git commit -q -m "O other PR (authored pre-pin)"'
git switch -q main; git switch -q -c topic
entry PB 2026-01-03T00:00:00.000Z handoff; git add -A; c 2026-01-03T01:00:00Z "topic: pin"
git switch -q main; GIT_COMMITTER_DATE=2026-01-04T00:00:00Z git cherry-pick other >/dev/null
git merge -q --squash topic; c 2026-01-05T00:00:00Z "squash topic (#4)"
ID=PB U=2026-01-03T00:00:00.000Z; report "11 pre-pin-authored PR rebase-merged after the pin, below carrier" "STALE {O other PR} (it landed after the handoff)"
