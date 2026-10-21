. ../lib.sh
git init -q -b main; mkdir .vfkb; echo a>a; git add -A; c 2026-02-01T00:00:00Z "A main"
git switch -q -c feat
echo f>f; git add -A; c 2026-02-03T00:00:00Z "F feature (pre-pin)"
git switch -q main
echo p>p; git add -A; c 2026-02-02T00:00:00Z "P main (pre-pin)"
# pin written at 02-04, committed on main at 02-04T12 (case 1: committed)
entry PINX 2026-02-04T00:00:00.000Z handoff; git add -A; c 2026-02-04T12:00:00Z "C carries pin"
GIT_COMMITTER_DATE=2026-02-05T00:00:00Z GIT_AUTHOR_DATE=2026-02-05T00:00:00Z git merge -q --no-ff feat -m "M merge feat (post-pin)"
C=$(carrier PINX 2026-02-04T00:00:00.000Z); T=$(ts 2026-02-04T00:00:00.000Z)
echo "carrier=$(name $C)  ts-anchor=$(name $T)  ts-anchor-first-parent=$(name $(git rev-list -1 --first-parent --before=2026-02-04T00:00:00.000Z HEAD))"
set +e
git merge-base --is-ancestor $T $C; a=$?; git merge-base --is-ancestor $C $T; b=$?
echo "T ancestor of C? exit $a ; C ancestor of T? exit $b  (1,1 = incomparable)"
set -e
echo "--- Part A listing from the ts anchor, if it were used (T..HEAD):"; git log --format='  %s' $T..HEAD -- . ':(exclude).vfkb'
echo "--- listing from carrier (C..HEAD):"; git log --format='  %s' $C..HEAD -- . ':(exclude).vfkb'
echo
echo "=== CASE uncommitted pin on main (fallback to ts anchor), same history shape"
cd ..; rm -rf u; mkdir u; cd u
git init -q -b main; mkdir .vfkb; echo a>a; git add -A; c 2026-02-01T00:00:00Z "A main"
git switch -q -c feat
echo f>f; git add -A; c 2026-02-03T00:00:00Z "F feature (pre-pin)"
git switch -q main
echo p>p; git add -A; c 2026-02-02T00:00:00Z "P main (pre-pin)"
GIT_COMMITTER_DATE=2026-02-05T00:00:00Z GIT_AUTHOR_DATE=2026-02-05T00:00:00Z git merge -q --no-ff feat -m "M merge feat (post-pin)"
entry PINU 2026-02-04T00:00:00.000Z handoff   # uncommitted; updated predates M
T=$(ts 2026-02-04T00:00:00.000Z); TF=$(git rev-list -1 --first-parent --before=2026-02-04T00:00:00.000Z HEAD)
echo "ts-anchor=$(name $T)  first-parent ts-anchor=$(name $TF)"
echo "--- Part A listing T..HEAD (labelled 'Commits since this handoff was recorded'):"; git log --format='  %s' $T..HEAD -- . ':(exclude).vfkb'
echo "--- listing --first-parent TF..HEAD:"; git log --first-parent --format='  %s' $TF..HEAD -- . ':(exclude).vfkb'
set +e; git diff --quiet $T HEAD -- . ':(exclude).vfkb'; echo "B3 diff exit (ts anchor) $?"; git diff --quiet $TF HEAD -- . ':(exclude).vfkb'; echo "B3 diff exit (fp anchor) $?"
