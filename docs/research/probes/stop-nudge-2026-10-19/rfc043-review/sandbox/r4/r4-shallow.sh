# Shallow clone: pin committed deep in history, a post-pin PR at HEAD, clone --depth 2
. ../rules.sh
fresh sh-src
entry QS 2026-03-02T10:00:00.000Z handoff; git add -A; c 2026-03-02T10:30:00Z "C pin"
echo x>x; git add -A; c 2026-03-03T00:00:00Z "X post-pin code"
echo y>y; git add -A; c 2026-03-04T00:00:00Z "Y post-pin code"
cd "$WORK"; rm -rf sh; git clone -q --depth 2 "file://$WORK/sh-src" sh; cd sh
echo "visible: $(git log --format=%s | paste -sd'|' -)"
ID=QS U=2026-03-02T10:00:00.000Z
echo "carrier found: $(name "$(carrier_of)")"
report "S1 shallow --depth 2, pin below the boundary, two post-pin commits" "STALE {X, Y}"
