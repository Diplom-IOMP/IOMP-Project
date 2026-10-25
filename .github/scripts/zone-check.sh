#!/usr/bin/env bash
# Fails a PR that mixes ownership zones, or that changes shared files
# (contracts/, repo root, docs/specs/, shared CI) without approval from someone other than the author.
# repo/* branches (repo-wide maintenance, e.g. the bootstrap) may touch every zone,
# but always need that approval.
set -euo pipefail

repo="$GITHUB_REPOSITORY"
pr="$PR_NUMBER"
author="$PR_AUTHOR"
head_ref="${PR_HEAD_REF:-}"

files=$(gh api --paginate "repos/$repo/pulls/$pr/files" --jq '.[].filename')

zone_of() {
  case "$1" in
    agent/*|docs/agent/*|docs/adr/ADR-AG-*|.github/workflows/agent.yml) echo agent ;;
    platform/*|docs/platform/*|docs/adr/ADR-PL-*|.github/workflows/platform.yml) echo platform ;;
    contracts/*|docs/adr/ADR-CT-*) echo contracts ;;
    *) echo shared ;;
  esac
}

zones=$(for f in $files; do zone_of "$f"; done | sort -u)
echo "Zones touched:"; echo "$zones"

if [[ "$head_ref" == repo/* ]]; then
  zones=shared
elif [ "$(echo "$zones" | grep -c .)" -gt 1 ]; then
  echo "::error::This PR touches more than one zone ($(echo $zones)). Split it: one PR per zone."
  exit 1
fi

if [ "$zones" = "contracts" ] || [ "$zones" = "shared" ]; then
  approvers=$(gh api --paginate "repos/$repo/pulls/$pr/reviews" \
    --jq "[.[] | select(.state == \"APPROVED\" and .user.login != \"$author\")] | length")
  if [ "$approvers" -lt 1 ]; then
    echo "::error::Changes to $zones need approval from the other owner."
    exit 1
  fi
fi

echo "Zone check passed."
