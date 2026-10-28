# RECREATED 2026-10-28 for vfkb#386 (ADR-0084 §5.3): `bp-all.sh` sources `../rules-bp.sh`,
# which was never committed. Rule B (RFC-043 Part 0 as proposed) and B′ (RFC-043 Q5, adopted
# by ADR-0084 §5.2): with NO carrier, rule 5 drops every commit authored at or before u, with
# no ancestry condition. The carrier path is identical to B.
# Plumbing comes from ./rules.sh (KEY=updated|created, see there); `report` prints only the
# two columns bp-all.out carries.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/rules.sh"
WORK=$PWD

r_Bp(){ local C S="" at; C=$(carrier_of); local ue; ue=$(u_epoch)
  for h in $(setA); do
    at=$(git log -1 --format=%at "$h")
    if [ -n "$C" ]; then
      if git merge-base --is-ancestor "$h" "$C" && [ "$at" -le "$ue" ]; then continue; fi
    else
      if [ -z "$at" ] || [ "$at" -le "$ue" ]; then continue; fi
    fi
    S="$S $h"; done; show "$(echo $S)"; }

report(){ # report <case> <expected>
  printf '\n### %s\nexpected: %s\n  B    : %s\n  B-prime: %s\n' "$1" "$2" "$(r_B)" "$(r_Bp)"; }
