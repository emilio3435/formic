# Verification brief — lane TINT-F (foundation)

READ-ONLY adversarial verification. You may run read-only commands and the test suite; you may mutate ONLY throwaway COPIES of the tree that you create yourself.

## Context to read first
- `docs/superpowers/plans/2026-08-13-tint/00-MASTER-PLAN.md` — contract (§1), authority rules (§2), fences (§3)
- `docs/superpowers/plans/2026-08-13-tint/GOAL-F-foundation.md`
- `LANE-REPORT-tint-f.md` (tracked, worktree root)
- The diff: `git diff 06d385c..HEAD` (4 commits)

## Lane's self-reported claims (your job: try hard to refute each, from the code)
- Funnel `setWorkspaceColor` shells `cmux workspace-action set-color`; `setGroupColor` uses RPC with params pinned to exactly `{group_id, hex}` by a test that reads issued argv and pins `Object.keys()`.
- `setGroupColor` does a strict read-back: echoed `custom_color` must value-match via `normalizeHex`; echoed null / no stdout / different colour each read as FAILURE (deliberate loud-false-negative design).
- `lastWrittenHex` records ONLY on verified-clean writes; a failed write is never suppressed as an echo.
- Fan-out enumerates only agents' resolved `target.workspaceId`, so group anchor workspaces are never colored.
- `GET /api/repo-colors` grew an additive `repoNames` key (master-approved; additive only).

## Additional refutation targets, ranked
1. `repoKeyForCwd` fragments worktrees — it must use the git common dir; walk the logic against a linked-worktree path like `../the-mountain.worktrees/tint-f`.
2. Assignment nondeterminism: permute repo discovery order and check the same colors result; 7th repo must fold to clay `#64707C`, never a new hue.
3. Any cmux color write path that bypasses the funnel.
4. A failed/unverified write that still records `lastWrittenHex`.
5. Attention rows blending repo tint with ember instead of replacing it; any text node wearing repo color.
6. Tint carried via inline `style=` (dies on strict CSP) rather than class/stylesheet.
7. `PUT /api/repo-colors/:repoKey` missing the same-origin/local gating sibling mutating routes have.
8. `repoNames` join wrong when two repos share a basename.
9. Hollow tests among the 64 new ones — spot-check two by mutating a COPY of the tree, never the original.

## Known/expected — do NOT report
- `tests/cross-source-token-agreement.test.ts` red: fleet-state dependent, proven red at base 06d385c (evidence in lane report §4).

## Output
Write findings ranked by severity with `file:line` refs to `.lane-evidence/VERIFY-tint-f.md`. Modify NOTHING tracked, commit nothing, never push. End the file AND your final message with exactly one line: `VERDICT: PASS` or `VERDICT: BLOCK` plus one sentence.
