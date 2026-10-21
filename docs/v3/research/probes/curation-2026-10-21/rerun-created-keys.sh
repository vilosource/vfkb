#!/usr/bin/env bash
# ADR-0082 §2 evidence: re-run RFC-043's anchor prototype with B3's keys switched from
# `updated` to `created`, and diff against the original.
#   bash docs/v3/research/probes/curation-2026-10-21/rerun-created-keys.sh
# Edits applied to a temp copy, never to the RFC-043 sandbox:
#   - pin_in_head (line 18) and the carrier -G pattern (line 20) match "created", not "updated";
#   - lib.sh entry() takes an optional created, defaulting to updated (it hard-coded 2026-01-01);
#   - case 3's retag keeps P3's original created (2026-01-02), which becomes U.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/../../../../research/probes/stop-nudge-2026-10-19/rfc043-review/sandbox" && pwd)"
T="$(mktemp -d)"
for v in orig created; do mkdir -p "$T/$v/p"; cp "$SRC/anchor-proto.sh" "$SRC/lib.sh" "$T/$v/"; done
C="$T/created"
sed -i.bak -e '18s/\\"updated\\":\\"\$U\\"/\\"created\\":\\"$U\\"/' \
  -e '20s/\\"updated\\":/\\"created\\":/' \
  -e 's/^entry P3 2026-01-09T00:00:00.000Z handoff;/entry P3 2026-01-09T00:00:00.000Z handoff 2026-01-02T00:00:00.000Z;/' \
  -e 's/^ID=P3 U=2026-01-09T00:00:00.000Z; report "3 retagged old entry"/ID=P3 U=2026-01-02T00:00:00.000Z; report "3 retagged old entry"/' \
  "$C/anchor-proto.sh"
sed -i.bak -e 's/^entry(){ # entry id updated tag$/entry(){ # entry id updated tag [created]/' \
  -e 's/"created":"2026-01-01T00:00:00.000Z","updated":"%s"}\\n'"'"' "\$1" "\$3" "\$2"/"created":"%s","updated":"%s"}\\n'"'"' "$1" "$3" "${4:-$2}" "$2"/' \
  "$C/lib.sh"
echo "## script edits"; diff "$T/orig/anchor-proto.sh" "$C/anchor-proto.sh" || true; diff "$T/orig/lib.sh" "$C/lib.sh" || true
for v in orig created; do (cd "$T/$v/p" && bash ../anchor-proto.sh > "$T/$v.out" 2>&1); done
echo "## rows: orig $(grep -c . "$T/orig.out"), created $(grep -c . "$T/created.out")"
echo "## output diff (orig < > created)"; diff "$T/orig.out" "$T/created.out" || true
rm -rf "$T"
