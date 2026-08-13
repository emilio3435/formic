#!/usr/bin/env bash
#
# Every test except the ones that assert against THIS machine.
#
# Most of the suite is hermetic and belongs in CI. A handful of files are
# deliberately not: they read the developer's live session history, or call the
# board on localhost:4701, and they are written to FAIL rather than skip when
# that evidence is missing — an intentional choice, because a check that passes
# vacuously on an empty read is worse than no check. That makes them real local
# gates and impossible in CI by construction, not flaky tests to be silenced.
#
# The list is spelled out here rather than expressed as a skip inside each file
# so the exclusion is visible in one place and shows up in review. Anything NOT
# named here runs, so a new test file is covered by default.
#
# Run the excluded ones locally with: bun test <path>
set -euo pipefail
cd "$(dirname "$0")/.."

LOCAL_ONLY=(
  # Calls the running board at 127.0.0.1:4701 and cross-checks its token
  # accounting against BurnBar's independent record.
  tests/cross-source-token-agreement.test.ts
  # Asserts physical bounds over this machine's real burn history; on an empty
  # read the bounds cannot fire, which the file itself treats as a failure.
  tests/physical-bounds.test.ts
  # Same: identities that must hold across windows of real recorded usage.
  tests/published-identities.test.ts
  # Checks DEPLOY.md against local lane branches that exist only in a working
  # clone of this fleet.
  tests/reference-docs.test.ts
)

# Print the list and stop. scripts/anthill-deploy.sh runs these four as its own
# phase, and reading them from here keeps one copy of the list: a second copy in
# the deploy script would drift the first time this one changed, and the drift
# would be invisible until a deploy either skipped a gate or demanded a file
# that no longer exists. Answers before the existence check below so the query
# works from a checkout that has no tests/ at all.
if [[ "${1:-}" == "--local-only" ]]; then
  printf '%s\n' "${LOCAL_ONLY[@]}"
  exit 0
fi

for path in "${LOCAL_ONLY[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "ci-tests: '$path' is excluded but does not exist — the list has rotted." >&2
    exit 1
  fi
done

included=()
while IFS= read -r path; do
  skip=false
  for excluded in "${LOCAL_ONLY[@]}"; do
    [[ "$path" == "$excluded" ]] && skip=true && break
  done
  $skip || included+=("$path")
done < <(find tests -name '*.test.ts' | sort)

echo "ci-tests: running ${#included[@]} files, excluding ${#LOCAL_ONLY[@]} local-only:"
printf '  - %s\n' "${LOCAL_ONLY[@]}"

exec bun test "${included[@]}"
