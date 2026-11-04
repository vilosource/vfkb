# Shared by the vfkb commit identity hooks (pre-commit, pre-merge-commit, pre-push).
# Every commit in vfkb is authored and committed as vilosource. The operator's global
# ~/.gitconfig carries a work (OneIO) identity; with no repo-local override, commits here
# silently went out under it. Set the identity once per clone:
#   git config user.name "Jason Viloria"
#   git config user.email 126692+vilosource@users.noreply.github.com
# Opt out (e.g. an outside contributor): git config vfkb.identityGuard off
VFKB_ALLOWED='126692+vilosource@users.noreply.github.com'

vfkb_guard_off() { [ "$(git config --get vfkb.identityGuard)" = "off" ]; }

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# author_ok EMAIL: vilosource, or a GitHub bot (dependabot, github-actions) on a commit
# made server-side that a local branch carries.
author_ok() {
  e=$(lower "$1")
  [ "$e" = "$VFKB_ALLOWED" ] && return 0
  case "$e" in *'[bot]@users.noreply.github.com') return 0 ;; esac
  return 1
}

# committer_ok EMAIL: vilosource, or GitHub itself (the committer of a squash merge on main).
committer_ok() {
  e=$(lower "$1")
  [ "$e" = "$VFKB_ALLOWED" ] || [ "$e" = 'noreply@github.com' ]
}

vfkb_fix_hint() {
  echo "Commits in this repo must use <$VFKB_ALLOWED> (vilosource). Fix with:" >&2
  echo "  git config user.name \"Jason Viloria\"" >&2
  echo "  git config user.email $VFKB_ALLOWED" >&2
}
