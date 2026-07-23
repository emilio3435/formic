#!/usr/bin/env bash
# Spin up a THROWAWAY Ant Hill preview without ever touching production :4701.
#
# Why this exists: previews were launched by hand on a hardcoded port (4702),
# which orphaned processes and risked colliding with prod. This script:
#   - auto-picks the first FREE port in the reserved preview range (4710-4719)
#   - hard-refuses the production port (4701)
#   - runs in the foreground and self-cleans on Ctrl-C / terminal close (exec)
#
# Usage:  bash scripts/anthill-preview.sh
# Then open the printed URL. Ctrl-C to stop. Nothing to clean up afterward.
set -euo pipefail

PROD_PORT=4701
PREVIEW_LO=4710
PREVIEW_HI=4719
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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

BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo '?')"
echo "Ant Hill PREVIEW  ->  http://127.0.0.1:$PORT"
echo "  worktree: $ROOT  (branch: $BRANCH)"
echo "  production :$PROD_PORT is untouched. Ctrl-C to stop; it self-cleans."
cd "$ROOT"
# exec so Ctrl-C / SIGHUP kills bun directly - no orphaned preview servers.
MOUNTAIN_PORT="$PORT" exec bun src/server/index.ts
