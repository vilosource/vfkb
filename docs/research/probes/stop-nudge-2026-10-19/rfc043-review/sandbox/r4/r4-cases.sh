# Round-4 adversarial cases for RFC-043 Part 0 (rule B). Run from a fresh subdir: bash ../r4-cases.sh
. ../rules.sh

# N1. handoff -> code -> ONE commit of code + brain together (git add -A), on the topic branch
fresh n1; git switch -q -c topic
entry Q1 2026-03-02T10:00:00.000Z handoff
echo k>k; git add -A; c 2026-03-02T11:00:00Z "K code+brain in one commit"
ID=Q1 U=2026-03-02T10:00:00.000Z; report "N1 handoff -> code -> single mixed commit (topic)" "STALE {K} (code written after the handoff)"

# N2. amend: K authored before the handoff, amended with more code after it, brain committed after
fresh n2; git switch -q -c topic
echo k>k; git add -A; c 2026-03-02T09:00:00Z "K code (authored pre-pin)"
entry Q2 2026-03-02T10:00:00.000Z handoff
echo k2>>k; git add k; GIT_COMMITTER_DATE=2026-03-02T11:00:00Z git commit -q --amend --no-edit
git add .vfkb/entries.jsonl; c 2026-03-02T12:00:00Z "E brain commit"
ID=Q2 U=2026-03-02T10:00:00.000Z; report "N2 pre-pin commit amended with post-pin code, then brain commit" "STALE {K} (amended after the handoff)"

# N3. spoofed/older author date on post-pin code (git commit --date)
fresh n3; git switch -q -c topic
entry Q3 2026-03-02T10:00:00.000Z handoff
echo k>k; git add k; GIT_AUTHOR_DATE=2026-03-01T00:00:00Z GIT_COMMITTER_DATE=2026-03-02T11:00:00Z git commit -q -m "K --date in the past"
git add .vfkb/entries.jsonl; c 2026-03-02T12:00:00Z "E brain commit"
ID=Q3 U=2026-03-02T10:00:00.000Z; report "N3 post-pin code with back-dated author date, then brain commit" "STALE {K}"

# N4. fixup of post-pin work into a pre-pin commit via rebase --autosquash, then brain commit
fresh n4; git switch -q -c topic
echo a1>a1; git add -A; c 2026-03-02T09:00:00Z "A1 code (pre-pin)"
entry Q4 2026-03-02T10:00:00.000Z handoff
echo a2>>a1; git add a1; GIT_AUTHOR_DATE=2026-03-02T11:00:00Z GIT_COMMITTER_DATE=2026-03-02T11:00:00Z git commit -q --fixup HEAD
GIT_COMMITTER_DATE=2026-03-02T11:30:00Z GIT_SEQUENCE_EDITOR=: git rebase -q -i --autosquash main
git add .vfkb/entries.jsonl; c 2026-03-02T12:00:00Z "E brain commit"
ID=Q4 U=2026-03-02T10:00:00.000Z; report "N4 post-pin fixup squashed into pre-pin commit, then brain commit" "STALE {A1} (it now holds post-pin work)"

# N5. UNCOMMITTED pin, then the topic is rebased (no upstream change): no carrier -> rule 5 skipped
fresh n5; git switch -q -c topic
echo a1>a1; git add -A; c 2026-03-02T09:00:00Z "A1 code (pre-pin)"
entry Q5 2026-03-02T10:00:00.000Z handoff
GIT_COMMITTER_DATE=2026-03-02T11:00:00Z git rebase -q --force-rebase main
ID=Q5 U=2026-03-02T10:00:00.000Z; report "N5 uncommitted pin, then force-rebase (no upstream change)" "quiet"

# N5b. uncommitted pin, rebase onto a main that moved after the pin (pull --rebase shape)
fresh n5b; git switch -q -c topic
echo a1>a1; git add -A; c 2026-03-02T09:00:00Z "A1 code (pre-pin)"
git switch -q main; echo m1>m1; git add -A; c 2026-03-02T10:30:00Z "M1 main (post-pin)"
git switch -q topic
entry Q5 2026-03-02T10:00:00.000Z handoff
GIT_COMMITTER_DATE=2026-03-02T11:00:00Z git rebase -q main
report "N5b uncommitted pin, rebase onto moved main" "STALE {M1} only"

# N6. octopus merge carrying the pin, with post-pin code on another arm
fresh n6; git switch -q -c b1; entry Q6 2026-03-02T10:00:00.000Z handoff; git add -A; c 2026-03-02T10:30:00Z "b1: pin"
git switch -q main; git switch -q -c b2; echo z>z; git add -A; c 2026-03-02T11:00:00Z "b2: code post-pin"
git switch -q main; git switch -q -c b3; echo y>y; git add -A; c 2026-03-02T11:10:00Z "b3: code post-pin"
git switch -q main; GIT_COMMITTER_DATE=2026-03-02T12:00:00Z GIT_AUTHOR_DATE=2026-03-02T12:00:00Z git merge -q --no-ff b1 b2 b3 -m "OCT octopus"
ID=Q6 U=2026-03-02T10:00:00.000Z; report "N6 octopus merge carries pin + other arms' post-pin code" "STALE {OCT}? (b2/b3 are not the pin's PR) - inherent: inside carrier"

# N7. merge main INTO topic, where main's squash carried the pin and another PR landed after it
fresh n7; git switch -q -c topic; echo t0>t0; git add -A; c 2026-03-01T00:00:00Z "T0 topic code (pre-pin)"
git switch -q main; git switch -q -c pr; entry Q7 2026-03-02T10:00:00.000Z handoff; git add -A; c 2026-03-02T10:30:00Z "pr: pin"
git switch -q main; git merge -q --squash pr; c 2026-03-02T11:00:00Z "S1 squash pr (carries pin)"
echo s2>s2; git add -A; c 2026-03-02T12:00:00Z "S2 other PR (post-pin)"
git switch -q topic; echo t1>t1; git add -A; c 2026-03-02T13:00:00Z "T1 topic code (post-pin)"
GIT_COMMITTER_DATE=2026-03-02T14:00:00Z GIT_AUTHOR_DATE=2026-03-02T14:00:00Z git merge -q --no-ff main -m "MM merge main into topic"
ID=Q7 U=2026-03-02T10:00:00.000Z; report "N7 merge main into topic (carrier = that merge)" "STALE {T1, and S2 via MM}"

# N8. pin updated twice: v1 committed, code, v2 committed
fresh n8; entry Q8 2026-03-02T10:00:00.000Z handoff; git add -A; c 2026-03-02T10:30:00Z "C1 pin v1"
echo k>k; git add -A; c 2026-03-02T11:00:00Z "K code"
entry Q8 2026-03-02T12:00:00.000Z handoff; git add -A; c 2026-03-02T12:30:00Z "C2 pin v2"
ID=Q8 U=2026-03-02T12:00:00.000Z; report "N8 pin updated twice, v2 after code" "quiet"
entry Q8 2026-03-02T13:00:00.000Z handoff
ID=Q8 U=2026-03-02T13:00:00.000Z; report "N8b v3 uncommitted, HEAD holds v2" "quiet"

# N9. pin predates all history (empty T), committed later, code after
fresh n9; git switch -q --orphan orph; git rm -rq --cached . ; rm -f a
entry Q9 2025-12-01T00:00:00.000Z handoff; git add -A; c 2026-01-02T00:00:00Z "orphan root carries pin"
echo k>k; git add -A; c 2026-01-03T00:00:00Z "K code"
ID=Q9 U=2025-12-01T00:00:00.000Z; report "N9 orphan branch, pin predates history (empty T), code after" "STALE {K}"
git reset -q --hard HEAD~1
report "N9b orphan branch, empty T, nothing after" "quiet"

# N10. timezone: pre-pin commit with a +03:00 author date that is BEFORE u in UTC, rebased below C
fresh n10; git switch -q -c topic
echo a1>a1; git add -A; GIT_AUTHOR_DATE=2026-03-02T12:30:00+03:00 GIT_COMMITTER_DATE=2026-03-02T12:30:00+03:00 git commit -q -m "A1 (09:30Z, pre-pin)"
entry Q10 2026-03-02T10:00:00.000Z handoff; git add -A; c 2026-03-02T10:30:00Z "C pin"
GIT_COMMITTER_DATE=2026-03-02T11:00:00Z git rebase -q --force-rebase main
ID=Q10 U=2026-03-02T10:00:00.000Z; report "N10 +03:00 author date before u (UTC), force-rebase" "quiet"
echo "   (string compare of %aI vs u would say: $( [ '2026-03-02T12:30:00+03:00' \> '2026-03-02T10:00:00.000Z' ] && echo 'after u -> kept -> STALE' || echo 'before u'))"

# N11. detached HEAD inside a linked worktree, R3-B1 shape
fresh n11; git switch -q -c topic
entry Q11 2026-03-02T10:00:00.000Z handoff
echo k>k; git add k; c 2026-03-02T11:00:00Z "K code after the handoff"
git add .vfkb/entries.jsonl; c 2026-03-02T12:00:00Z "E brain commit"
git worktree add -q --detach ../n11-wt HEAD; cd ../n11-wt
ID=Q11 U=2026-03-02T10:00:00.000Z; report "N11 detached HEAD in a linked worktree (R3-B1 shape)" "STALE {K}"

# N12. pull --rebase on main with a local brain commit; upstream landed a merge-commit PR post-pin
fresh n12; git clone -q . ../n12-up; cd ../n12-up; echo o>o; git add -A; c 2026-03-02T11:00:00Z "O upstream PR (post-pin)"; cd ../n12
entry Q12 2026-03-02T10:00:00.000Z handoff; git add -A; c 2026-03-02T10:30:00Z "C local brain commit"
git remote add up ../n12-up; git fetch -q up; GIT_COMMITTER_DATE=2026-03-02T12:00:00Z git rebase -q up/main
ID=Q12 U=2026-03-02T10:00:00.000Z; report "N12 pull --rebase on main, local brain commit, upstream post-pin PR" "STALE {O}"
