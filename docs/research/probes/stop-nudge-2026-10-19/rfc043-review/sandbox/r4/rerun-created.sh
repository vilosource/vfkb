#!/usr/bin/env bash
# vfkb#386 / ADR-0084 §5.3: re-run round 4's 33-case B/B′ table (bp-all.sh), the 15 round-4
# cases (r4-cases.sh) and the shallow case (r4-shallow.sh) under ADR-0082 §2's `created` key,
# and diff each against its committed `updated`-key output.
#   bash docs/research/probes/stop-nudge-2026-10-19/rfc043-review/sandbox/r4/rerun-created.sh
# Writes bp-all.created.out, r4-cases.created.out and r4-shallow.created.out beside the
# originals (which stay as evidence) and prints the diffs.
#
# KEY=created switches the carrier lookup (rules.sh). Fixture faithfulness (decide D2): a
# same-id re-version keeps its ORIGINAL `created` and bumps only `updated`, so U (= the pin's
# created) must not move with it. The edits below, applied to temp copies only, make that so:
#   - case 3's retag keeps P3's created 2026-01-02, which becomes U (as rerun-created-keys.sh);
#   - N8's v2 and N8b's v3 keep Q8's created 10:00, which becomes U for both rows;
#   - case 10's hand-written root-brain line gets created = its updated (a first version).
# Without them `entry` would mint a new created per version — the quiet-success trap
# ADR-0051 clause 3 names: N8 would silently report "unchanged".
set -euo pipefail
R4="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
mkdir -p "$T/r4"
cp "$R4/../lib.sh" "$T/"
cp "$R4"/rules.sh "$R4"/rules-bp.sh "$R4"/bp-all.sh "$R4"/r4-cases.sh "$R4"/r4-shallow.sh "$T/r4/"
for f in bp-all.sh r4-cases.sh; do
  sed -i.bak \
    -e 's/^entry P3 2026-01-09T00:00:00.000Z handoff;/entry P3 2026-01-09T00:00:00.000Z handoff 2026-01-02T00:00:00.000Z;/' \
    -e 's/^ID=P3 U=2026-01-09T00:00:00.000Z; report "3 retagged old entry"/ID=P3 U=2026-01-02T00:00:00.000Z; report "3 retagged old entry"/' \
    -e 's/"created":"2026-01-01T00:00:00.000Z","updated":"2026-01-03T00:00:00.000Z"/"created":"2026-01-03T00:00:00.000Z","updated":"2026-01-03T00:00:00.000Z"/' \
    -e 's/^entry Q8 2026-03-02T12:00:00.000Z handoff;/entry Q8 2026-03-02T12:00:00.000Z handoff 2026-03-02T10:00:00.000Z;/' \
    -e 's/^ID=Q8 U=2026-03-02T12:00:00.000Z; report "N8 /ID=Q8 U=2026-03-02T10:00:00.000Z; report "N8 /' \
    -e 's/^entry Q8 2026-03-02T13:00:00.000Z handoff$/entry Q8 2026-03-02T13:00:00.000Z handoff 2026-03-02T10:00:00.000Z/' \
    -e 's/^ID=Q8 U=2026-03-02T13:00:00.000Z; report "N8b /ID=Q8 U=2026-03-02T10:00:00.000Z; report "N8b /' \
    "$T/r4/$f"
done
# Guard: a missed sed match still yields a believable diff (rerun-created-keys.sh's lesson,
# gotcha 853d9444599c), so count every edit and fail loudly.
g(){ grep -c -- "$1" "$T/r4/$2" || true; }
ok=1
[ "$(g 'handoff 2026-01-02T00:00:00.000Z;' bp-all.sh)" = 1 ] || ok=0
[ "$(g 'ID=P3 U=2026-01-02T00:00:00.000Z' bp-all.sh)" = 1 ] || ok=0
[ "$(g '"created":"2026-01-03T00:00:00.000Z","updated":"2026-01-03' bp-all.sh)" = 1 ] || ok=0
for f in bp-all.sh r4-cases.sh; do
  [ "$(g 'handoff 2026-03-02T10:00:00.000Z' "$f")" = 2 ] || ok=0
  [ "$(g 'ID=Q8 U=2026-03-02T10:00:00.000Z' "$f")" = 2 ] || ok=0
done
[ "$ok" = 1 ] || { echo "edit guard FAILED: created-key fixture edits did not all apply" >&2; rm -rf "$T"; exit 1; }
echo "## git: $(git --version)  os: $(uname -sr)  date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "## script edits"
for f in bp-all.sh r4-cases.sh; do diff "$R4/$f" "$T/r4/$f" || true; done
# git's own chatter (squash/octopus notices) is dropped so the rows compare with bp-all.out,
# which was saved without it.
noise='^(Squash commit -- not updating HEAD|Fast-forwarding to:|Trying simple merge|Automatic merge went well)'
run(){ # run <script> <out> <filter-noise:0|1>
  rm -rf "$T/r4/run"; mkdir "$T/r4/run"
  if [ "$3" = 1 ]; then (cd "$T/r4/run" && KEY=created bash "../$1" 2>/dev/null | grep -Ev "$noise") > "$R4/$2" || true
  else (cd "$T/r4/run" && KEY=created bash "../$1" > "$R4/$2" 2>&1) || true; fi
}
run bp-all.sh bp-all.created.out 1
run r4-cases.sh r4-cases.created.out 0
run r4-shallow.sh r4-shallow.created.out 0
for p in bp-all r4-cases r4-shallow; do
  echo "## $p: rows orig $(grep -c '^### ' "$R4/$p.out"), created $(grep -c '^### ' "$R4/$p.created.out")"
  echo "## $p output diff (updated < > created)"; diff "$R4/$p.out" "$R4/$p.created.out" || true
done
rm -rf "$T"
