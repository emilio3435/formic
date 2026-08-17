#!/usr/bin/env bash
# Safe deploy of GitHub `main` to production :4701.
#
# Why this exists: deploys were done by hand (cherry-pick -> maybe run tests ->
# restart), which once let a RED commit through. This script makes the safe path
# the only path:
#   - refuses unless this checkout is ~/Developer/formic
#   - refuses unless origin is public emilio3435/formic (https or ssh)
#   - refuses to run unless this worktree is on `main`
#   - requires a clean tree (unrelated dirty work is never swept)
#   - fetches origin/main and fast-forwards when this checkout is strictly behind
#   - refuses if HEAD has diverged from, or is ahead of, origin/main
#   - verifies launchd points back at this exact checkout
#   - installs the lockfile, then BLOCKS on a red typecheck or test suite
#   - restarts the launchd service and health-checks :4701 (~45s)
#   - leaves the checkout unchanged and points to safe recovery if unhealthy
#
# A green GitHub merge is not a deploy. :4701 serves the local files of
# ~/Developer/formic until this script restarts launchd.
#
# Usage:  cd ~/Developer/formic && bash scripts/anthill-deploy.sh
# Quiet fleet (OpenBurnBar canary only):  ANTHILL_DEPLOY_QUIET_FLEET=1 bash scripts/anthill-deploy.sh
set -euo pipefail

LABEL="ai.imaginethat.anthill"
PROD_PORT=4701
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL_ROOT="${HOME}/Developer/formic"
cd "$ROOT"

if [[ "${ROOT}" != "${CANONICAL_ROOT}" ]]; then
  echo "Deploys must run from the canonical production worktree: ${CANONICAL_ROOT}" >&2
  echo "Current checkout: ${ROOT}" >&2
  exit 1
fi

ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
ORIGIN_NORM="$(printf '%s' "${ORIGIN_URL}" | tr '[:upper:]' '[:lower:]')"
ORIGIN_NORM="${ORIGIN_NORM%/}"
ORIGIN_NORM="${ORIGIN_NORM%.git}"
ORIGIN_NORM="${ORIGIN_NORM%/}"
case "${ORIGIN_NORM}" in
  https://github.com/emilio3435/formic|git@github.com:emilio3435/formic|ssh://git@github.com/emilio3435/formic|ssh://github.com/emilio3435/formic)
    ;;
  *)
    echo "Develop and deploy on public formic only (emilio3435/formic)." >&2
    echo "This checkout's origin is: ${ORIGIN_URL:-<missing>}" >&2
    echo "https or ssh to emilio3435/formic is required. the-ant-hill or any other repo is refused." >&2
    exit 1
    ;;
esac

BRANCH="$(git branch --show-current)"
if [ "$BRANCH" != "main" ]; then
  echo "Deploy worktree must be on 'main' (currently '$BRANCH'). Aborting." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "Deploy worktree must be clean. Preserve or move the current changes before deploying." >&2
  exit 1
fi

echo "-> fetch origin/main"
git fetch origin main:refs/remotes/origin/main || { echo "fetch FAILED - not deploying." >&2; exit 1; }

HEAD_FULL="$(git rev-parse HEAD)"
ORIGIN_MAIN="$(git rev-parse origin/main)"
if [[ "${HEAD_FULL}" != "${ORIGIN_MAIN}" ]]; then
  if git merge-base --is-ancestor HEAD origin/main; then
    echo "-> fast-forward to origin/main"
    git merge --ff-only origin/main || { echo "fast-forward FAILED - not deploying." >&2; exit 1; }
    HEAD_FULL="$(git rev-parse HEAD)"
  elif git merge-base --is-ancestor origin/main HEAD; then
    echo "Deploy HEAD is ahead of origin/main. Aborting." >&2
    echo "  HEAD:        ${HEAD_FULL}" >&2
    echo "  origin/main: ${ORIGIN_MAIN}" >&2
    echo "Production must not carry unpushed commits. Do not reset --hard." >&2
    exit 1
  else
    echo "Deploy HEAD has diverged from origin/main. Aborting." >&2
    echo "  HEAD:        ${HEAD_FULL}" >&2
    echo "  origin/main: ${ORIGIN_MAIN}" >&2
    echo "Preserve local work. Do not reset --hard." >&2
    exit 1
  fi
fi

HEAD_SHA="$(git rev-parse --short HEAD)"
echo "Deploy candidate: $ROOT @ $HEAD_SHA (main) -> :$PROD_PORT"

ANTHILL_REPO="$ROOT" bash "$ROOT/scripts/anthill-deploy-target.sh"

echo "-> bun install --frozen-lockfile"
bun install --frozen-lockfile || { echo "bun install FAILED - not deploying." >&2; exit 1; }

echo "-> typecheck"
bunx tsc --noEmit || { echo "tsc FAILED - not deploying." >&2; exit 1; }

# The hermetic suite. Everything that can be decided from the code alone, and
# the reason "broken code never reaches :4701" is still true below.
echo "-> tests (hermetic)"
bun run test:ci || { echo "tests FAILED - not deploying." >&2; exit 1; }

# The four files that assert against THIS machine's live evidence — the running
# board, real burn history, local lane branches. scripts/ci-tests.sh owns the
# list and explains why they fail rather than skip on thin evidence.
#
# They are a separate phase because their red has two different meanings, and
# the old single `bun test` could not tell them apart: the board's token
# accounting genuinely disagreeing with BurnBar is a reason not to deploy, and
# a quiet fleet with too few joined sessions to compare is not. Running the
# whole suite meant a quiet morning blocked production entirely (2026-08-13:
# the same two failures reproduced on the pre-merge commit, so nothing was wrong
# with the candidate).
#
# So: still red by default, still blocking, and now escapable only by naming the
# reason. The flag does not reach the hermetic phase above — a code regression
# is not overridable, and the test suite pins that.
echo "-> local-evidence gates"
LOCAL_ONLY=()
while IFS= read -r path; do LOCAL_ONLY+=("$path"); done < <(bash "$ROOT/scripts/ci-tests.sh" --local-only)
if bun test "${LOCAL_ONLY[@]}"; then
  echo "   local-evidence gates green"
elif [ "${ANTHILL_DEPLOY_QUIET_FLEET:-0}" = "1" ]; then
  echo "   local-evidence gates RED, OVERRIDDEN by ANTHILL_DEPLOY_QUIET_FLEET=1." >&2
  echo "   Deploying with these UNVERIFIED on this machine:" >&2
  printf '     - %s\n' "${LOCAL_ONLY[@]}" >&2
else
  {
    echo "local-evidence gates FAILED - not deploying."
    printf '  - %s\n' "${LOCAL_ONLY[@]}"
    echo "These read live evidence (the board on :$PROD_PORT, real burn history,"
    echo "local branches) and fail rather than skip when it is missing."
    echo
    echo "If they are red because a REGRESSION reached them, fix it — that is"
    echo "what they are for. If they are red because the fleet is quiet and there"
    echo "is not enough recorded usage to compare (the OpenBurnBar canary), deploy with:"
    echo "  ANTHILL_DEPLOY_QUIET_FLEET=1 bash ${CANONICAL_ROOT}/scripts/anthill-deploy.sh"
    echo "Check which it is by running one directly, e.g."
    echo "  bun test ${LOCAL_ONLY[0]:-tests/cross-source-token-agreement.test.ts}"
  } >&2
  exit 1
fi

echo "-> restart $LABEL"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "-> health check :$PROD_PORT"
HEALTH_TRIES="${ANTHILL_DEPLOY_HEALTH_TRIES:-45}"
for _ in $(seq 1 "$HEALTH_TRIES"); do
  sleep 1
  code="$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PROD_PORT/api/health" || true)"
  if [ "$code" = "200" ]; then
    echo "HEALTHY: :$PROD_PORT answered after restart requested at $HEAD_SHA."
    echo "LIVE: $HEAD_SHA on :$PROD_PORT (a green GitHub merge is not a deploy)."
    BUST="$(awk 'match($0, /ah-t[0-9]+/) { print substr($0, RSTART, RLENGTH); exit }' "$ROOT/src/web/index.html" 2>/dev/null || true)"
    if [ -n "$BUST" ]; then
      echo "cache-bust: $BUST. Hard-refresh the board. Proof: curl -sS http://127.0.0.1:$PROD_PORT/ | grep $BUST"
    fi
    exit 0
  fi
done

echo "UNHEALTHY: :$PROD_PORT did not report a fresh snapshot after restart." >&2
echo "Recovery: revert the unhealthy change through GitHub main, then fast-forward and deploy again." >&2
echo "Inspect the service log first:" >&2
echo "  tail -n 100 \"$HOME/Library/Logs/$LABEL.err.log\"" >&2
exit 1
