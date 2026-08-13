# Verification brief — SYNC-CF (adversarial, read-only)

Try to BLOCK this lane. Read-only; write only `VERIFY-sync-cf.md` (root) + scratch in `.lane-evidence/`. Never commit/push/revert. Work is COMMITTED locally (`1ce458a` + `c9a30ef`).

Context: `docs/superpowers/plans/2026-08-13-sync/00-MASTER-PLAN.md` §Contract, `KICKOFF-CF.md`, `02-GROUND-RULES.md`, `LANE-REPORT-sync-cf.md`.

## Checks

1. **Fence.** Commits touch only `src/web/app.js`, `src/web/styles.css`, `src/web/client-state.js` (ONE marked field — assess it is truly minimal), `tests/repo-sync-close-ui.test.ts`, `tests/web-client.test.ts` (four dock guards, each marked `SYNC-CF` — confirm those edits still measure what they measured; a guard weakened to pass = BLOCK).
2. **Locked decision 2 literally.** Surface close at `exact` resolution only (attack: any path where `unique-cwd` or worse reaches an ENABLED control); workspace close only through the confirm dialog; NO window-close affordance anywhere in the diff; rows and strip offer no close (drawer only).
3. **Envelope fidelity.** POSTs are exactly `{target:"surface", id}` and `{target:"workspace", id, confirm:true}`; `invalid_state` + escalation opens the dialog with NO retry and NO error toast; `confirm_required` routes into the same dialog. The partial-envelope rejection: an escalation whose siblings can't all be read renders NO dialog and reports failure — re-apply the lane's mutation (drop the rejection in `syncCloseEscalation`) and confirm the named test fails.
4. **Dialog honesty.** Siblings listed BY NAME; empty list prints the no-other-agents sentence; copy states the close cannot be undone; cancel issues nothing (assert zero fetches on cancel).
5. **Keyboard.** Focus-trapped, Escape cancels WITHOUT closing the drawer behind it (stopPropagation pinned), initial focus on Cancel. Re-apply the "focus Confirm instead" mutation, confirm red.
6. **Ended rows.** `isTerminal` agents get no close; re-apply that mutation, confirm red.
7. **Strict CSP (trap #7).** No inline `style=` in the diff; every new class has a stylesheet rule; dialog styling is signal-rail grammar, not filled banner (check `.sync-close` rules use a left rail + house tokens).
8. **Floor.** Run + paste: `bunx tsc --noEmit`; `bun test tests/repo-sync-close-ui.test.ts`; full `bun test` tail. Only tolerated red: cross-source canary. Else BLOCK.

## Output

`VERIFY-sync-cf.md`, findings per check, final line exactly `VERDICT: PASS` or `VERDICT: BLOCK — <reasons>`. Uncertainty = BLOCK.
