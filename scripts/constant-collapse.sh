#!/bin/zsh
# ---------------------------------------------------------------------------
# constant-collapse — find assertions the product has quietly made unfalsifiable
#
# WHAT IT ANSWERS
#   Ordinary mutation testing asks "can this assertion fail?". This asks a
#   different question: "given what the product now EMITS, can it still fail?"
#
#   Those come apart when a fix collapses a field to a constant. On 2026-08-02
#   a fix hardcoded `completionsLastHour` to null, and every assertion in
#   tests/completions-counter.test.ts became unfalsifiable in one commit — four
#   toBeNull, two not.toBe(1), one (x ?? 0) under toBeLessThan(2). The suite
#   reported green. The assertion that had originally caught the bug was the
#   one now proving nothing, because not.toBe(1) is equally true of null.
#
#   This script collapses a field to a constant in an isolated copy of the repo
#   and reports which collapses NOTHING notices. A survivor means the tests
#   naming that field can no longer fail because of it.
#
# READS   (all read-only, nothing is modified)
#   ./src, ./tests, ./config, ./package.json, ./tsconfig.json  — copied out
#   ./node_modules                                             — symlinked
#   $SPEC_FILE if given, else the built-in spec below
#   Some tests read ~/Library/Application Support/OpenBurnBar/openburnbar.sqlite.
#   That is a READ. Nothing here writes to it. Pass --no-live to skip them.
#
# WRITES
#   One temporary directory from `mktemp -d`, removed on exit.
#   NOTHING in this repository. No file under src/ or tests/ is touched, even
#   momentarily. No git state is read or changed. No server is started or
#   contacted. No LaunchAgent, plist or data/ file is written.
#
# SAFE UNDER THE SHARED CHECKOUT
#   Five lanes share this working tree. An earlier version of this sweep
#   mutated src/ in place and reverted afterwards; that is unsafe here, because
#   another lane running its tests during the window would see a broken tree,
#   and a lane committing during the window could commit the mutation. So this
#   version copies first and never writes to the working tree at all. Other
#   lanes may commit freely while it runs — the copy is a point-in-time
#   snapshot and is unaffected.
#
# SAFE AGAINST A LIVE BOARD
#   Runs `bun test` only. Excludes the deploy and launchd script suites by
#   default, since those exercise LaunchAgent and plist paths that a live
#   machine should not have exercised repeatedly. Use --include-deploy to
#   override, and read those tests first.
#
# USAGE
#   scripts/constant-collapse.sh --plan            # print what it would do, do nothing
#   scripts/constant-collapse.sh --yes             # run the built-in spec
#   scripts/constant-collapse.sh --yes --spec f    # run a custom spec file
#   scripts/constant-collapse.sh --yes --no-live   # skip tests that read BurnBar
#
# SPEC FORMAT — records of four lines, separated by a blank line:
#   FILE: src/server/pulse.ts
#   LABEL: momentum.working -> constant
#   OLD: working: this.#latestSnapshot?.totals.working ?? 0,
#   NEW: working: 1,
#   Use \n in OLD/NEW for a literal newline. OLD must match EXACTLY once.
#
# READING THE RESULTS
#   killed     an assertion depends on that field. Good.
#   SURVIVED   nothing in the suite can fail because of that field. Either the
#              tests naming it are hollow, or it has no coverage at all.
#   NO-MATCH   the spec is stale — the source moved. Fix the spec; a NO-MATCH
#              is not a pass.
#
#   ONE TRAP, AND IT COST ME A FALSE FINDING. A collapse must move the value to
#   something the field cannot currently hold. Replacing STALL_THRESHOLD_MS
#   with 900_000 is a no-op, because that IS its value, and it reported
#   SURVIVED against perfectly good assertions. Collapsing to 999_999 killed
#   four. A survivor whose NEW might equal the current value proves nothing —
#   check that before believing it.
# ---------------------------------------------------------------------------
set -u
setopt NULL_GLOB 2>/dev/null || true

REPO="${0:A:h:h}"
SPEC_FILE=""
CONFIRMED=0
PLAN_ONLY=0
INCLUDE_DEPLOY=0
SKIP_LIVE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) CONFIRMED=1 ;;
    --plan) PLAN_ONLY=1 ;;
    --spec) SPEC_FILE="${2:-}"; shift ;;
    --include-deploy) INCLUDE_DEPLOY=1 ;;
    --no-live) SKIP_LIVE=1 ;;
    -h|--help) sed -n '2,72p' "$0"; exit 0 ;;
    *) print -u2 "unknown argument: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

# --- the built-in spec: the fields an operator reads, plus every field the
#     2026-08-02 fixes touched. Extend it rather than replacing it. -----------
builtin_spec() {
  cat <<'SPEC'
FILE: src/server/pulse.ts
LABEL: momentum.working
OLD: working: this.#latestSnapshot?.totals.working ?? 0,
NEW: working: 1,

FILE: src/server/pulse.ts
LABEL: momentum.stalled
OLD: stalled: stalledAgentIds.length,
NEW: stalled: 0,

FILE: src/server/pulse.ts
LABEL: momentum.stallThresholdMs
OLD: stallThresholdMs: STALL_THRESHOLD_MS,
NEW: stallThresholdMs: 999_999,

FILE: src/server/pulse.ts
LABEL: burn.windowMs
OLD: windowMs: coveredBuckets.length * BUCKET_MS,
NEW: windowMs: 999_999,

FILE: src/server/snapshot.ts
LABEL: totals.needsYou
OLD: needsYou: allAgents.filter((agent) => Boolean(agent.attentionSignal)).length,
NEW: needsYou: 0,

FILE: src/server/snapshot.ts
LABEL: totals.tokenEligible
OLD: tokenEligible: workingAgents.length,
NEW: tokenEligible: 0,

FILE: src/server/snapshot.ts
LABEL: totals.history
OLD: history: allAgents.filter((agent) => agent.activity === "ended").length,
NEW: history: 0,

FILE: src/server/snapshot-agent.ts
LABEL: controlsFor.routed (button/endpoint agreement)
OLD: const routed = Boolean(target.surfaceId) && (target.resolution === "exact" || target.resolution === "unique-cwd");
NEW: const routed = true;

FILE: src/server/snapshot-agent.ts
LABEL: controlsFor.refusal (write gate advertisement)
OLD: const refusal = transmitRefusal({ target, processState: processStateFor(agent), archived });
NEW: const refusal = null;

FILE: src/server/targets.ts
LABEL: processKnownDead (liveness gate)
OLD: return agent.processState === "died";
NEW: return false;

FILE: src/server/archive.ts
LABEL: archive.archivedAt (retention clock)
OLD: archivedAt: existingArchivedAt ?? new Date(nowMs).toISOString(),
NEW: archivedAt: "2020-01-01T00:00:00.000Z",

FILE: src/server/archive.ts
LABEL: ARCHIVE_RETENTION_MS
OLD: ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
NEW: ARCHIVE_RETENTION_MS = 999 * 24 * 60 * 60 * 1_000

FILE: src/server/cmux.ts
LABEL: ATTENTION_RETENTION_MS
OLD: ATTENTION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
NEW: ATTENTION_RETENTION_MS = 999 * 24 * 60 * 60 * 1_000

FILE: src/server/triage.ts
LABEL: TRIAGE_RETENTION_MS
OLD: TRIAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
NEW: TRIAGE_RETENTION_MS = 999 * 24 * 60 * 60 * 1_000

FILE: src/server/snapshot-issues.ts
LABEL: RECENTLY_RESOLVED_TTL_MS
OLD: const RECENTLY_RESOLVED_TTL_MS = 15 * 60 * 1_000;
NEW: const RECENTLY_RESOLVED_TTL_MS = 999 * 60 * 1_000;
SPEC
}

spec_source() { [ -n "$SPEC_FILE" ] && cat "$SPEC_FILE" || builtin_spec; }
spec_count() { spec_source | grep -c '^FILE: ' }

EXCLUDE='anthill-(scripts|deploy)'
[ "$INCLUDE_DEPLOY" -eq 1 ] && EXCLUDE='__none__'
[ "$SKIP_LIVE" -eq 1 ] && EXCLUDE="${EXCLUDE}|physical-bounds|published-identities|capped-queries|cumulative-session|burnbar"

# --- say what it is about to do, before doing any of it --------------------
print "constant-collapse"
print "  repository        $REPO"
print "  spec              $([ -n "$SPEC_FILE" ] && print "$SPEC_FILE" || print "built-in") ($(spec_count) collapses)"
print "  test files        all of tests/*.test.ts except /$EXCLUDE/"
print ""
print "  It will COPY src, tests and config to a fresh mktemp directory,"
print "  symlink node_modules, and apply each collapse THERE."
print ""
print "  It will NOT write to this working tree. Not src, not tests, not data,"
print "  not git state. Five lanes share this checkout and may commit while it"
print "  runs; the copy is a point-in-time snapshot and is unaffected."
print ""
print "  It runs 'bun test' only. No server is started or contacted."
print "  Some tests READ the BurnBar sqlite database. Nothing writes to it."
print "  Deploy and launchd suites are excluded by default."
print ""
print "  Expect roughly $(( $(spec_count) + 1 )) full test runs."

if [ "$PLAN_ONLY" -eq 1 ]; then print "\n--plan given; stopping without doing any of it."; exit 0; fi
if [ "$CONFIRMED" -ne 1 ]; then
  print "\nRe-run with --yes to proceed, or --plan to see this without running."
  exit 1
fi

LAB="$(mktemp -d "${TMPDIR:-/tmp}/constant-collapse.XXXXXX")" || exit 1
cleanup() { [ -n "${LAB:-}" ] && rm -rf "$LAB"; }
trap cleanup EXIT INT TERM

print "\n  lab               $LAB"
for d in src tests config; do [ -d "$REPO/$d" ] && cp -R "$REPO/$d" "$LAB/$d"; done
for f in package.json tsconfig.json bunfig.toml; do [ -f "$REPO/$f" ] && cp "$REPO/$f" "$LAB/$f"; done
[ -d "$REPO/node_modules" ] && ln -s "$REPO/node_modules" "$LAB/node_modules"
cd "$LAB" || exit 1

TESTS=(${(f)"$(ls tests/*.test.ts | grep -vE "$EXCLUDE")"})
[ ${#TESTS} -eq 0 ] && { print -u2 "no test files matched"; exit 1; }

run_failures() { timeout 900 bun test "${TESTS[@]}" 2>&1 | grep -E '^ *[0-9]+ fail' | tr -dc '0-9'; }

print "\n  measuring baseline over ${#TESTS} files ..."
BASE_1="$(run_failures)"; BASE_2="$(run_failures)"
if [ "${BASE_1:-x}" != "${BASE_2:-y}" ]; then
  print -u2 "\n  UNSTABLE BASELINE: $BASE_1 then $BASE_2 failures."
  print -u2 "  A flaky suite makes every result below meaningless. Fix or exclude"
  print -u2 "  the flaky file first (try --no-live), then re-run."
  exit 1
fi
BASE="${BASE_1:-0}"
print "  baseline          $BASE failing (stable across two runs)"
[ "$BASE" -gt 0 ] && print "  NOTE: a non-zero baseline is tolerated; 'killed' means failures > $BASE."
print ""

KILLED=0; SURVIVED=0; NOMATCH=0
apply_and_run() {
  local file="$1" old="$2" new="$3" label="$4"
  [ -f "$file" ] || { printf '  %-52s NO-MATCH (no such file)\n' "$label"; NOMATCH=$((NOMATCH+1)); return; }
  cp "$file" "$file.collapse-bak"
  OLD_S="$old" NEW_S="$new" python3 - "$file" <<'PY'
import os, sys
path = sys.argv[1]
old = os.environ["OLD_S"].replace("\\n", "\n")
new = os.environ["NEW_S"].replace("\\n", "\n")
text = open(path).read()
n = text.count(old)
if n != 1:
    sys.exit(3 if n == 0 else 4)
open(path, "w").write(text.replace(old, new, 1))
PY
  local rc=$?
  if [ $rc -eq 3 ] || [ $rc -eq 4 ]; then
    mv "$file.collapse-bak" "$file"
    printf '  %-52s NO-MATCH (%s)\n' "$label" "$([ $rc -eq 3 ] && print 'not found' || print 'matched more than once')"
    NOMATCH=$((NOMATCH+1)); return
  fi
  local f; f="$(run_failures)"; f="${f:-0}"
  mv "$file.collapse-bak" "$file"
  if [ "$f" -gt "$BASE" ]; then
    printf '  %-52s killed (%s failing)\n' "$label" "$f"; KILLED=$((KILLED+1))
  else
    printf '  %-52s >>> SURVIVED <<<\n' "$label"; SURVIVED=$((SURVIVED+1))
  fi
}

FILE=""; LABEL=""; OLD=""; NEW=""
while IFS= read -r line; do
  case "$line" in
    "FILE: "*)  FILE="${line#FILE: }" ;;
    "LABEL: "*) LABEL="${line#LABEL: }" ;;
    "OLD: "*)   OLD="${line#OLD: }" ;;
    "NEW: "*)   NEW="${line#NEW: }" ;;
    "")
      [ -n "$FILE" ] && [ -n "$OLD" ] && apply_and_run "$FILE" "$OLD" "$NEW" "$LABEL"
      FILE=""; LABEL=""; OLD=""; NEW="" ;;
  esac
done < <(spec_source; print "")

print ""
print "  killed $KILLED   survived $SURVIVED   no-match $NOMATCH"
if [ "$SURVIVED" -gt 0 ]; then
  print ""
  print "  Before believing a SURVIVED: check its NEW value differs from what the"
  print "  field already holds. Collapsing a constant to its own value is a no-op"
  print "  and reports SURVIVED against perfectly good assertions."
fi
[ "$NOMATCH" -gt 0 ] && print "\n  A NO-MATCH is a stale spec, not a pass. Update it against current source."
exit 0
