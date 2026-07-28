#!/usr/bin/env bash
# Spin up a THROWAWAY Ant Hill preview without ever touching production :4701.
#
# Why this exists: previews were launched by hand on a hardcoded port (4702),
# which orphaned processes and risked colliding with prod. This script:
#   - auto-picks the first FREE port in the reserved preview range (4710-4719)
#   - hard-refuses the production port (4701)
#   - copies source/config into a temporary root with isolated persisted state
#   - runs in the foreground and removes that root on exit
#
# Usage:  bash scripts/anthill-preview.sh
# Then open the printed URL. Ctrl-C to stop. Nothing to clean up afterward.
set -euo pipefail

PROD_PORT=4701
PREVIEW_LO=4710
PREVIEW_HI=4719
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREVIEW_TMP="${TMPDIR:-/tmp}"

port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

PORT=""
for p in $(seq "$PREVIEW_LO" "$PREVIEW_HI"); do
  if ! port_in_use "$p"; then PORT="$p"; break; fi
done

if [ -z "$PORT" ]; then
  echo "No free preview port in ${PREVIEW_LO}-${PREVIEW_HI}." >&2
  echo "Find and kill orphans:  bash scripts/anthill-ps.sh" >&2
  exit 1
fi
if [ "$PORT" = "$PROD_PORT" ]; then
  echo "Refusing to run a preview on the production port $PROD_PORT." >&2
  exit 1
fi

PREVIEW_ROOT="$(mktemp -d "${PREVIEW_TMP%/}/anthill-preview.XXXXXX")"
cleanup() {
  if [[ -n "${PREVIEW_ROOT}" && "${PREVIEW_ROOT}" == "${PREVIEW_TMP%/}/anthill-preview."* ]]; then
    rm -rf -- "${PREVIEW_ROOT}"
  fi
}
trap cleanup EXIT

cp -R "${ROOT}/src" "${ROOT}/config" "${PREVIEW_ROOT}/"
mkdir -p "${PREVIEW_ROOT}/data"
if [[ -f "${ROOT}/data/cmux-socket.env" ]]; then
  cp "${ROOT}/data/cmux-socket.env" "${PREVIEW_ROOT}/data/cmux-socket.env"
fi

BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo '?')"
echo "Ant Hill PREVIEW  ->  http://127.0.0.1:$PORT"
echo "  source:   $ROOT  (branch: $BRANCH)"
echo "  isolated data: ${PREVIEW_ROOT}/data"
echo "  production :$PROD_PORT is untouched. Ctrl-C to stop; it self-cleans."
cd "$PREVIEW_ROOT"
MOUNTAIN_PORT="$PORT" bun src/server/index.ts
