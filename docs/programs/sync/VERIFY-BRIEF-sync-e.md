# Verification brief — SYNC-E (adversarial, read-only)

You are the verification lane for SYNC-E in the SYNC program. Your job is to try to BLOCK this lane's work, not to approve it. Work read-only: run checks and tests, but modify nothing except writing your findings to `VERIFY-sync-e.md` in this worktree root and scratch under `.lane-evidence/`. Never commit, never push, never revert the lane's dirt.

Context: `docs/superpowers/plans/2026-08-13-sync/00-MASTER-PLAN.md` (contract + fences), `KICKOFF-E.md` (its orders, incl. master addendum), `02-GROUND-RULES.md` (traps), `LANE-REPORT-sync-e.md` (its claims). The lane's work is UNCOMMITTED dirt on top of ca8077d (codex sandbox cannot commit — expected, not a finding).

## Checks (all of them; name evidence per check)

1. **Fence.** `git status --short` must show only: `ARCHITECTURE.md`, `src/server/cmux-sync.ts`, `src/server/cmux.ts`, `src/server/state.ts`, `tests/cmux.test.ts`, `tests/cmux-sync.test.ts`, plus `LANE-REPORT-sync-e.md` and this brief/your output. Any other modified file = BLOCK.
2. **Frozen contract intact.** `src/server/cmux-sync.ts` must still export `CmuxSyncEventName`, `CmuxSyncEvent`, `SyncHandler`, `registerSyncHandler(name, handler) → unregister`, `syncStreamHealthy()` with unchanged shapes (additions allowed; changes/removals = BLOCK).
3. **Trap #1 (window-scoped lists).** Every `workspace.list` / `workspace.group.list` issued from `src/server/cmux.ts` must enumerate `window.list` and pass `window_id`. Grep for any remaining bare `{}` calls. The multi-window regression test must genuinely reproduce the old bug (would fail against the pre-fix walk — check what it asserts, not that it exists).
4. **Trap #4 (echo before dispatch).** Find the dispatch path in `cmux-sync.ts`: events must pass through `isOwnEcho` filtering BEFORE handlers run. A dispatcher that hands echoes to handlers = BLOCK.
5. **Trap #8 (gap distrust).** `gap: true` on ack, and reconnect, must quarantine patching and trigger full recollect; `syncStreamHealthy()` false in both states. Check the tests assert NO patch handlers run on replayed events until a fresh ack.
6. **Cursor separation.** The new stream must use its own cursor persistence and never read/write `~/.anthill/events.cursor`. `src/server/cmux-events.ts` must be UNTOUCHED (`git diff --stat` proves it).
7. **Liveness.** `workspace.closed` flips all bound agents live→ended reason `cmux-closed` in the same dispatch; teardown-origin `surface.closed` does not double-fire; the `/* SYNC-E */` marker exists in `state.ts` and the registration is the only state.ts change beyond what liveness needs.
8. **Hollow-test check.** For the gap test and the multi-window test: would each fail if the behavior it pins regressed? Fixtures must use the REAL `cmux events` JSONL frame shapes (ack line with `oldest_seq`/`latest_seq`/`resume`/`gap`, then typed event lines) — a hand-invented frame shape is the fixtures-are-not-payloads defect = BLOCK.
9. **Floor.** Run and paste: `bunx tsc --noEmit` then `bun test tests/cmux-sync.test.ts tests/cmux.test.ts tests/cmux-events.test.ts tests/reference-docs.test.ts`. Any red = BLOCK (your environment is not sandboxed; there is no tolerated red in this focused set).

## Output

Write `VERIFY-sync-e.md` in the worktree root: findings per check with evidence, then EXACTLY ONE final line: `VERDICT: PASS` or `VERDICT: BLOCK — <named reasons>`. Uncertainty is a BLOCK with the uncertainty named, never a PASS.
