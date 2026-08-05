#!/usr/bin/env bash
# Sourceable T9 self-registration boot hook.
#
# From a lane launch command (after exporting identity):
#   export ANTHILL_RUN=... ANTHILL_LANE=... ANTHILL_PROVIDER=... ANTHILL_SESSION=...
#   # optional tests: ANTHILL_RUNS_ROOT=/tmp/...
#   source /path/to/anthill/scripts/anthill-self-register.sh
#
# On source: writes sessionId + status:active (+ statusAt) into the manifest lane
# (atomic, first-write-wins per session). On clean shell EXIT: status:done.
#
# Safe to source multiple times in one shell — the EXIT trap is installed once.

if [[ -n "${ANTHILL_SELF_REGISTER_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
ANTHILL_SELF_REGISTER_LOADED=1

_ANTHILL_SELF_REGISTER_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_ANTHILL_SELF_REGISTER_BUN="${BUN_BIN:-bun}"

anthill_self_register_invoke() {
  local op="$1"
  local -a args=(
    "$_ANTHILL_SELF_REGISTER_BUN"
    "$_ANTHILL_SELF_REGISTER_REPO/scripts/anthill-manifest.ts"
    "$op"
    --run "${ANTHILL_RUN:?ANTHILL_RUN required}"
    --lane "${ANTHILL_LANE:?ANTHILL_LANE required}"
    --provider "${ANTHILL_PROVIDER:?ANTHILL_PROVIDER required}"
    --session-id "${ANTHILL_SESSION:?ANTHILL_SESSION required}"
  )
  if [[ -n "${ANTHILL_RUNS_ROOT:-}" ]]; then
    args+=(--root "$ANTHILL_RUNS_ROOT")
  fi
  "${args[@]}" >/dev/null
}

anthill_self_register_boot() {
  anthill_self_register_invoke boot
}

anthill_self_register_done() {
  anthill_self_register_invoke done || true
}

anthill_self_register_boot
trap 'anthill_self_register_done' EXIT
