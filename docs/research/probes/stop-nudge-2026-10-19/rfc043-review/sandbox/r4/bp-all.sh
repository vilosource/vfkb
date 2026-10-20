. ../rules-bp.sh

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
