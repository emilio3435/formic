# Delta-verification brief — lane TINT-F, round 2 (post-BLOCK fixes)

READ-ONLY adversarial verification of the FIX ROUND only. Prior round: your predecessor's report at `.lane-evidence/VERIFY-tint-f.md` (VERDICT: BLOCK, five findings). Scope now: `git diff 6d18675..HEAD` (commits ccef942 code, f06b049 report). You may run read-only commands and the test suite; mutate ONLY throwaway COPIES you create.

## Context
- `.lane-evidence/VERIFY-tint-f.md` — the five findings being fixed
- `LANE-REPORT-tint-f.md` §2a — the lane's fix table, mutation table (11 claimed, all caught), and one approved deviation
- `docs/superpowers/plans/2026-08-13-tint/00-MASTER-PLAN.md` §2 (authority rules)

## The five fixes as claimed — refute each
1. (was BLOCK) Join is two-hop at BOTH call sites: name → repoNames[name] → settings.assignments[key].hex. New tests drive fetchRepoColors with a stubbed fetch against a REAL GET envelope, ditto putRepoColor, plus one asserting the collapsed (name===key) form paints NOTHING. Refute: any remaining call site feeding repoNames values straight into a hex position; any new test that still hand-authors color state instead of driving the wire path.
2. Ambiguous printed name (two repoKeys, one name) drops out of the join entirely; both insertion orders → identical absent join; cmux fan-out still colors both repos via repoKey. Refute with an order-dependent counterexample.
3. Signal tick now set by agentRowPlan for UNBANDED (interleaved) rows only; banded rows get none (Whisper spine instead); the strip offers NO repo tint at all (master-approved deviation — the rule-5 hole is closed by absence, not by ember classes; tests/web-client.test.ts:9846 "strip rows do not double-mark" must still pass). Refute: any strip row that can receive a tick or wash; a hook-needsInput row (alerting, healthy outcome) wearing any identity treatment; an interleaved row that gets no tick.
4. fakeGit now throws on --show-toplevel and on missing --git-common-dir. Verify by reading the fake, then confirm the four fake repoKeyForCwd tests fail in a copy where the implementation is switched to --show-toplevel.
5. PUT and DELETE share one fanOutFor. Refute: any verb-specific path that can skip fan-out.

## Mutation spot-checks (in a COPY, never the original) — pick exactly these two
- Revert the join fix at ONE call site only (the lane's own harness once missed the second) → the new tests must go red.
- Mutation 3c: re-add repo tint to stripRowOpts → must be caught.

## Also confirm still true after the fix round
- Hex normalization at withAssignments (round-1 red #1): an assignment survives a store reopen byte-identical.
- No inline style= for tint; text never wears --repo-tint; funnel untouched by this round (only settings.ts/app.js/tests changed — verify via the diffstat).

## Known/expected — do NOT report
- tests/cross-source-token-agreement.test.ts red (fleet-dependent, ledgered).

## Output
Findings ranked with file:line refs to `.lane-evidence/VERIFY2-tint-f.md`. Modify NOTHING tracked, commit nothing, never push. End the file AND your final message with exactly one line: `VERDICT: PASS` or `VERDICT: BLOCK` plus one sentence.
