. ../lib.sh
git init -q -b main; mkdir .vfkb; echo a>a; git add -A; c 2026-01-01T00:00:00Z init
# --- squash case
git switch -q -c topic
entry PIN1 2026-01-02T00:00:00.000Z handoff; git add -A; c 2026-01-02T01:00:00Z "topic: pin"
echo b>b; git add -A; c 2026-01-03T00:00:00Z "topic: code after pin"
git switch -q main; git merge -q --squash topic; c 2026-01-04T00:00:00Z "squash topic (#1)"
echo "SQUASH carrier: $(name $(carrier PIN1 2026-01-02T00:00:00.000Z))"
echo "SQUASH ts     : $(name $(ts 2026-01-02T00:00:00.000Z))"
# --- no-ff merge
git switch -q -c t2
entry PIN2 2026-01-05T00:00:00.000Z handoff; git add -A; c 2026-01-05T01:00:00Z "t2: pin"
git switch -q main; GIT_COMMITTER_DATE=2026-01-06T00:00:00Z GIT_AUTHOR_DATE=2026-01-06T00:00:00Z git merge -q --no-ff t2 -m "merge t2"
echo "NOFF carrier : $(name $(carrier PIN2 2026-01-05T00:00:00.000Z))"
# --- retag old entry
echo c>c; git add -A; c 2026-01-07T00:00:00Z code1
echo d>d; git add -A; c 2026-01-08T00:00:00Z code2
entry PIN1 2026-01-09T00:00:00.000Z handoff; git add -A; c 2026-01-09T01:00:00Z "retag PIN1"
echo "RETAG carrier: $(name $(carrier PIN1 2026-01-09T00:00:00.000Z))  (id-only -S gives: $(name $(git log --first-parent --reverse --format=%H -SPIN1 HEAD -- .vfkb/entries.jsonl|head -1)))"
# --- uncommitted pin
entry PIN3 2026-01-10T00:00:00.000Z handoff
if git show HEAD:.vfkb/entries.jsonl | grep -q '"id":"PIN3"'; then echo "UNCOMMITTED: found?!"; else echo "UNCOMMITTED: HEAD lacks PIN3 -> fallback"; fi
git checkout -q -- .vfkb/entries.jsonl
set +e
git show HEAD:/tmp/x/entries.jsonl >/dev/null 2>&1; echo "OUTSIDE: git show exit $?"
