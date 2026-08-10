#!/usr/bin/env bash
# Verify that the production LaunchAgent serves the checkout being deployed.
set -euo pipefail

ROOT="${ANTHILL_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LABEL="ai.imaginethat.anthill"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
EXPECTED_SERVER="${ROOT}/src/server/index.ts"

if ! command -v plutil >/dev/null 2>&1; then
  echo "Deploy target check requires plutil. Aborting." >&2
  exit 1
fi

if [[ ! -f "${PLIST}" ]]; then
  echo "Deploy target missing: ${PLIST}" >&2
  echo "Repair it with:" >&2
  echo "  ANTHILL_REPO=\"${ROOT}\" bash \"${ROOT}/scripts/anthill-hygiene.sh\"" >&2
  exit 1
fi

WORKING_DIRECTORY="$(plutil -extract WorkingDirectory raw "${PLIST}" 2>/dev/null || true)"
SERVER_ENTRY="$(plutil -extract ProgramArguments.1 raw "${PLIST}" 2>/dev/null || true)"

if [[ "${WORKING_DIRECTORY}" != "${ROOT}" || "${SERVER_ENTRY}" != "${EXPECTED_SERVER}" ]]; then
  echo "Deploy target mismatch. Refusing to restart ${LABEL}." >&2
  echo "  checkout: ${ROOT}" >&2
  echo "  WorkingDirectory: ${WORKING_DIRECTORY:-<missing>}" >&2
  echo "  ProgramArguments[1]: ${SERVER_ENTRY:-<missing>}" >&2
  echo "Repair it with:" >&2
  echo "  ANTHILL_REPO=\"${ROOT}\" bash \"${ROOT}/scripts/anthill-hygiene.sh\"" >&2
  exit 1
fi

echo "Deploy target verified: ${LABEL} -> ${ROOT}"
