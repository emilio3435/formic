#!/usr/bin/env bash
# List every running Ant Hill server: pid, listening port, and which worktree
# it is serving. Use it to spot orphaned previews or port collisions before they
# bite. Usage: bash scripts/anthill-ps.sh
set -uo pipefail

printf "%-6s %-6s %s\n" "PID" "PORT" "WORKTREE"
# Find bun/node processes listening on the Ant Hill port range (4700-4799).
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null \
  | awk '($1 ~ /bun|node/) && ($9 ~ /:47[0-9][0-9]$/) {split($9,a,":"); print $2, a[length(a)]}' \
  | sort -u \
  | while read -r pid port; do
      cmd="$(ps -p "$pid" -o command= 2>/dev/null)"
      wt="$(printf '%s' "$cmd" | grep -oE '/[^ ]*the-mountain[^/ ]*/' | head -1)"
      printf "%-6s %-6s %s\n" "$pid" "$port" "${wt:-$cmd}"
    done
echo
echo "Reserved: 4701 = PRODUCTION (launchd ai.imaginethat.anthill), 4710-4719 = previews."
