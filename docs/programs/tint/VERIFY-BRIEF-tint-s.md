# Verification brief — lane TINT-S (two-way sync)

READ-ONLY adversarial verification. You may run read-only commands and the test suite; you may mutate ONLY throwaway COPIES of the tree that you create yourself.

NOTE: the lane may still be committing an addendum (anchor-workspace filtering). Verify `git log 06d385c..HEAD` PLUS uncommitted changes — the addendum's requirement is part of what you check.

## Context to read first
- `docs/superpowers/plans/2026-08-13-tint/00-MASTER-PLAN.md` — contract (§1), authority rules (§2), fences (§3)
- `docs/superpowers/plans/2026-08-13-tint/GOAL-S-sync.md`
- `LANE-REPORT-tint-s.md` (worktree root, on disk)

## Refutation targets, ranked
1. Write-loop survival: echo suppression keyed on anything but the funnel's `lastWrittenHex`; restart case (fresh process, cmux color == assignment must be ignore, not re-assert); hex case mismatch (`#2E66A8` vs `#2e66a8`) read as drift; absent `custom_color` treated as drift instead of "no color".
2. Anchor filtering (master addendum): workspaces whose id appears as `anchor_workspace_id` in `workspace.group.list` must be excluded from collection, repo-mapping, ingest, and re-assert. If this is absent or partial in the current tree state, report it as the top finding.
3. Per-window coverage: `workspace.list` is window-scoped; all windows must be enumerated.
4. Files changed outside the GOAL-S fence (`cmux-color-sync.ts`, minimal read additions in `cmux.ts`, one registration line, tests).
5. Contract shape drift in usage of `src/shared/repo-color.ts`.
6. Hollow tests that pass on any output — spot-check one by mutating a COPY of the tree.
7. cmux command failures surfacing as success; a workspace marked reconciled on a failed write.

## Known/expected — do NOT report
- `tests/cross-source-token-agreement.test.ts` red: fleet-state dependent, documented, red on all TINT lanes tonight.

## Output
Write findings ranked by severity with `file:line` refs to `.lane-evidence/VERIFY-tint-s.md`. Modify NOTHING tracked, commit nothing, never push. End the file AND your final message with exactly one line: `VERDICT: PASS` or `VERDICT: BLOCK` plus one sentence.
