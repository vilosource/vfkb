. ../lib.sh
git init -q -b main; mkdir .vfkb; echo a>a; git add -A; c 2026-03-01T00:00:00Z "T0 base"
git switch -q -c topic
# Session: handoff written at turn 4 (u = 03-02T10), code committed at turn 20, SessionEnd commits brain-only.
entry PINE 2026-03-02T10:00:00.000Z handoff
echo k>k; git add k; c 2026-03-02T11:00:00Z "K code committed AFTER the handoff"
git add .vfkb/entries.jsonl; c 2026-03-02T12:00:00Z "E vfkb: session-end brain auto-commit"
U=2026-03-02T10:00:00.000Z
C=$(carrier PINE $U); T=$(ts $U)
echo "next session on topic: carrier=$(name $C)  ts-anchor=$(name $T)"
set +e
git diff --quiet $T HEAD -- . ':(exclude).vfkb'; echo "today (ts anchor) B3 stale? exit $? (1=stale)"
git diff --quiet $C HEAD -- . ':(exclude).vfkb'; echo "Part 0 (later=carrier) B3 stale? exit $? (0=NOT stale)"
echo "Part A listing C..HEAD:"; git log --format='  %s' $C..HEAD -- . ':(exclude).vfkb'; echo "  (end)"
echo "proposed fix: first-parent commits in T..HEAD touching non-brain paths, excluding C:"
git log --first-parent --format='  %h %s' $T..HEAD -- . ':(exclude).vfkb' | grep -v "$(git rev-parse --short $C)"
