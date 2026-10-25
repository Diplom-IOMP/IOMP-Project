#!/usr/bin/env bash
# Fails a PR that:
# - uses a branch prefix that does not match the zone it changes,
# - mixes ownership zones (repo/* branches excepted),
# - changes contracts/ or shared files, or the other owner's zone,
#   without approval from someone other than the author.
set -euo pipefail

repo="$GITHUB_REPOSITORY"
pr="$PR_NUMBER"
author="$PR_AUTHOR"
head_ref="${PR_HEAD_REF:-}"

agent_owner=Rewer2022
platform_owner=mutednew

zone_of() {
  case "$1" in
    agent/*|docs/agent/*|docs/adr/ADR-AG-*|.github/workflows/agent.yml) echo agent ;;
    platform/*|docs/platform/*|docs/adr/ADR-PL-*|.github/workflows/platform.yml) echo platform ;;
    contracts/*|docs/adr/ADR-CT-*) echo contracts ;;
    *) echo shared ;;
  esac
}

zones=$(gh api --paginate "repos/$repo/pulls/$pr/files" --jq '.[].filename' |
  while IFS= read -r f; do zone_of "$f"; done | sort -u)
echo "Zones touched:"; echo "$zones"

case "$head_ref" in
  agent/*)    want=agent ;;
  platform/*) want=platform ;;
  contract/*) want=contracts ;;
  repo/*)     want=any ;;
  *)
    echo "::error::Branch '$head_ref' must start with agent/, platform/, contract/ or repo/."
    exit 1 ;;
esac

if [ "$want" = any ]; then
  zones=shared
elif [ "$zones" != "$want" ]; then
  echo "::error::Branch '$head_ref' may only change the $want zone, but touches: $(echo $zones)."
  exit 1
fi

needs_approval=false
case "$zones" in
  contracts|shared) needs_approval=true ;;
  agent)    [ "$author" = "$agent_owner" ] || needs_approval=true ;;
  platform) [ "$author" = "$platform_owner" ] || needs_approval=true ;;
esac

if [ "$needs_approval" = true ]; then
  # Only the right owner can approve, and only their latest review counts: anyone can
  # review a public repository, and a later "changes requested" withdraws an approval.
  # agent/platform: that zone's owner. contracts/shared: an owner other than the author.
  case "$zones:$author" in
    agent:*)                  approvers_allowed="\"$agent_owner\"" ;;
    platform:*)               approvers_allowed="\"$platform_owner\"" ;;
    *:"$agent_owner")         approvers_allowed="\"$platform_owner\"" ;;
    *:"$platform_owner")      approvers_allowed="\"$agent_owner\"" ;;
    *)                        approvers_allowed="\"$agent_owner\", \"$platform_owner\"" ;;
  esac
  approvers=$(gh api --paginate "repos/$repo/pulls/$pr/reviews" --jq '.[]' |
    jq -s --argjson allowed "[$approvers_allowed]" '
      [.[] | select(.state != "COMMENTED" and .state != "PENDING")]
      | group_by(.user.login) | map(last)
      | map(select(.state == "APPROVED" and (.user.login as $l | $allowed | index($l))))
      | length')
  if [ "$approvers" -lt 1 ]; then
    echo "::error::Changes to the $zones zone by $author need approval from the other owner ($approvers_allowed)."
    exit 1
  fi
fi

echo "Zone check passed."
