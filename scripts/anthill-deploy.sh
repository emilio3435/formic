#!/usr/bin/env bash
# Safe deploy of the current `main` worktree to production :4701.
#
# Why this exists: deploys were done by hand (cherry-pick -> maybe run tests ->
# restart), which once let a RED commit through. This script makes the safe path
# the only path:
#   - refuses to run unless this worktree is on `main`
#   - BLOCKS on a red typecheck or test suite (never deploys broken code)
#   - restarts the launchd service and health-checks :4701
#   - prints an exact rollback command if the restart comes up unhealthy
#
# It does NOT commit or merge for you - land your change on `main` first
# (cherry-pick / merge), then run this to verify + go live.
#
# Usage:  bash scripts/anthill-deploy.sh
set -euo pipefail

LABEL="ai.imaginethat.anthill"
PROD_PORT=4701
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="$(git branch --show-current)"
if [ "$BRANCH" != "main" ]; then
  echo "Deploy worktree must be on 'main' (currently '$BRANCH'). Aborting." >&2
  exit 1
fi

HEAD_SHA="$(git rev-parse --short HEAD)"
echo "Deploy candidate: $ROOT @ $HEAD_SHA (main) -> :$PROD_PORT"

echo "-> typecheck"
bunx tsc --noEmit || { echo "tsc FAILED - not deploying." >&2; exit 1; }

echo "-> tests"
bun test || { echo "tests FAILED - not deploying." >&2; exit 1; }

echo "-> restart $LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "-> health check :$PROD_PORT"
for _ in $(seq 1 10); do
  sleep 1
  code="$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PROD_PORT/api/health" || true)"
  if [ "$code" = "200" ]; then
    echo "LIVE: :$PROD_PORT serving a fresh snapshot at $HEAD_SHA."
    exit 0
  fi
done

echo "UNHEALTHY: :$PROD_PORT did not report a fresh snapshot after restart." >&2
echo "Roll back with:" >&2
echo "  git -C \"$ROOT\" reset --hard <last-good-sha> && launchctl kickstart -k gui/$(id -u)/$LABEL" >&2
exit 1
