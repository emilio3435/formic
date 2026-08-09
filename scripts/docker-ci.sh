#!/usr/bin/env bash
#
# The hermetic tier, run on Linux. See Dockerfile.ci for why this is not CI.
#
# Two exclusion lists apply, and keeping them separate is the point:
#
#   scripts/ci-tests.sh  LOCAL_ONLY  — suites that assert against THIS developer's
#                                     machine. Excluded everywhere, including
#                                     macOS CI. Not our business here.
#
#   PLATFORM_ONLY below              — suites that assert against macOS itself:
#                                     lsof output shape, ~/Library paths, launchd.
#                                     They are REAL gates that only macOS can run,
#                                     which is why the GitHub workflow stays on
#                                     macos-latest. Named here so a reader can see
#                                     exactly what a green Docker run does not cover.
#
# A suite belongs in PLATFORM_ONLY only if Linux cannot judge it. "It failed and I
# do not know why" is not a reason — that is a finding.
set -uo pipefail
cd "$(dirname "$0")/.."

PLATFORM_ONLY=(
  # Parses `ps`/`lsof` output whose columns and lstart format are macOS-specific.
  tests/process-liveness.test.ts
  tests/no-raw-pid-liveness.test.ts
  # Reads the BurnBar store under ~/Library/Application Support and guards on
  # process.platform === "darwin" (src/server/burnbar.ts).
  tests/burnbar.test.ts
  tests/burnbar-query.test.ts
)

for path in "${PLATFORM_ONLY[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "docker-ci: '$path' is excluded but does not exist — the list has rotted." >&2
    exit 1
  fi
done

echo "── typecheck ──────────────────────────────────────────"
bunx tsc --noEmit || exit 1

echo
echo "── hermetic suite (Linux) ─────────────────────────────"
mapfile -t local_only < <(grep -oE '^  tests/[a-z0-9.-]+\.test\.ts' scripts/ci-tests.sh | tr -d ' ')

# An explicit file list, not --ignore. `bun test <dir> --ignore <path>` silently
# runs the excluded file anyway, which is how the machine-only suites appeared in
# a run that claimed to skip them — an exclusion that does not exclude is worse
# than none, because the report says it worked.
declare -A excluded=()
for path in "${local_only[@]}" "${PLATFORM_ONLY[@]}"; do excluded["$path"]=1; done

run_files=()
while IFS= read -r path; do
  [[ -n "${excluded[$path]:-}" ]] || run_files+=("$path")
done < <(find tests -name '*.test.ts' | sort)

echo "running ${#run_files[@]} suites; excluding ${#excluded[@]}"
bun test "${run_files[@]}"
status=$?

echo
echo "── not covered by this run ────────────────────────────"
printf '  machine-only (excluded from CI too): %s\n' "${local_only[@]}"
printf '  macOS-only (real gates, CI runs these): %s\n' "${PLATFORM_ONLY[@]}"
echo
if [[ $status -ne 0 ]]; then
  cat <<'NOTE'

── read this before "fixing" a failure above ──────────
53 suites still fail on Linux as of 2026-08-06, and they are NOT yet classified.
They cluster in four places, all environment rather than logic:

  bash shims (T8/T9)   spawn real processes and test tty/job-control behaviour
  Cursor store         reads ~/Library/Application Support paths
  deploy health check  asserts against a launchd deployment
  repo/worktree tests  assume this machine's git layout

The work still owed is deciding, per suite, which of three things it is:
  1. macOS-only  -> add to PLATFORM_ONLY above WITH a reason
  2. hermetic but wrong on Linux -> a real portability bug, fix the test
  3. a genuine defect this container caught -> best possible outcome, fix the code

Do NOT bulk-add them to PLATFORM_ONLY to get green. An exclusion list nobody can
justify line by line is how a gate stops meaning anything — the same failure this
repo already found in a regression guard that only grepped a stylesheet.
NOTE
fi
echo "A green run here means the hermetic tier is sound. It does not mean CI passes."
exit $status
