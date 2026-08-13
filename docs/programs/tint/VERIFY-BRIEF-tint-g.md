# Verification brief — lane TINT-G (cmux sidebar group mirror)

READ-ONLY adversarial verification. You may run read-only commands and the test suite; you may mutate ONLY throwaway COPIES of the tree that you create yourself.

## Context to read first
- `docs/superpowers/plans/2026-08-13-tint/00-MASTER-PLAN.md` — authority rules (§2), fences (§3)
- `docs/superpowers/plans/2026-08-13-tint/GOAL-G-groups.md`
- `LANE-REPORT-tint-g.md` (worktree root — on disk though gitignored; READ IT, the lane's claims live there)
- The diff: `git diff 06d385c..HEAD` (2 commits: 1b446fc, d414cfe)

## Lane's self-reported claims (try hard to refute each from the code)
- Reconcile is per-window; membership = all repo-mapped workspaces; dissolve when a repo empties; full teardown when `mirrorGroups` goes off.
- Anchor workspaces (`anchor_workspace_id` from `workspace.group.list`) are exempt from filing AND removal; `group.remove` on an anchor would destroy the group.
- `group.delete` (which closes member workspaces) is never called anywhere; `ungroup` is the only teardown.
- Provenance = recorded group ids in `data/repo-group-provenance.json` (JsonAttentionStore pattern); never name-matching.
- Colors flow only via TINT-F's `setGroupColor` funnel.
- `repoGroupReconcileTick` returns null and issues ZERO cmux calls until `registerRepoGroupInputs` is called — which nothing on this branch does yet. THIS IS BY DESIGN (no compile-time dependency on cmux-color.ts), not dead code. Do not report it as unwired/dead.

## Additional refutation targets, ranked
1. Idempotence: a second reconcile over identical state must issue zero mutations.
2. A failed `group.add` that still records the workspace as filed.
3. Any code path that could reach `group.delete` or close a workspace.
4. Provenance that would annex a user-made group (anything resembling name-matching).
5. Hollow tests: 17 claimed, 8 mutation-verified — spot-check two mutations yourself in a COPY of the tree, never the original.
6. The `/* TINT-G */` registration in `src/server/state.ts`: a throw inside the tick must not break `#performRefresh`.

## Known/expected — do NOT report
- `tests/cross-source-token-agreement.test.ts` red: fleet-state dependent, documented, red on all TINT lanes tonight.

## Output
Write findings ranked by severity with `file:line` refs to `.lane-evidence/VERIFY-tint-g.md`. Modify NOTHING tracked, commit nothing, never push. End the file AND your final message with exactly one line: `VERDICT: PASS` or `VERDICT: BLOCK` plus one sentence.
