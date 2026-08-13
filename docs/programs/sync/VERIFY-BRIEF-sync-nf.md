# Verification brief — SYNC-NF (adversarial, read-only)

Try to BLOCK this lane. Read-only; write only `VERIFY-sync-nf.md` (root) + scratch in `.lane-evidence/`. Never commit/push/revert. Work is COMMITTED locally (`3d4b9ae`).

Context: `docs/superpowers/plans/2026-08-13-sync/00-MASTER-PLAN.md` §Contract, `KICKOFF-NF.md`, `02-GROUND-RULES.md`, `LANE-REPORT-sync-nf.md`.

## Checks

1. **Fence.** Commit touches only `src/web/app.js`, `src/web/styles.css`, `tests/sync-notifications-board.test.ts`. No notification-center redesign (the dropdown gains ONE section in existing furniture — anything structural = BLOCK); no server files; no client-state.js.
2. **Locked decision 3 (the one-fixture test).** THE test: one fixture where clearing the badge does NOT remove a still-alerting row from needs-you — both states asserted in ONE fixture. Find it; confirm it drives the real strip-membership code path (`stripAlerting` vs `alerting`), not a parallel reimplementation. Re-apply lane mutation M1 (`stripAlerting` ignores acks) and M2 (badge counts read notifications), confirm the named tests fail.
3. **Ack semantics (trap #9).** The acked mark reads as OPERATOR judgment (`acked ·`, muted ink) — text never claims the agent finished (re-apply M6, confirm red); no status color on badge or mark (M7); client renders snapshot truth only — grep for ANY client-side ack bookkeeping that survives a snapshot refresh (the self-revoke test: server-side revoke re-appears the row with no client special-casing).
4. **Exact params (trap #3).** `{action:"mark_read", id}` / `{action:"dismiss", id}` — M3 (`notification_id`) must fail the pinned test; `all` variants never sent (grep the diff).
5. **Strip-membership coherence.** `stripAlerting` replaced `alerting` in exactly the THREE membership sites (strip, pinnedIds, hollowInPane) and NOT in the ember/inline-mark sites (deliberate, per report §3.3). Verify the hollow-guard claim: an acked sole-alerting agent must NOT make its program group hollow (that would delete a live session from the board) — find the test or the code path proving it.
6. **Envelope honesty.** `envelope.ok === true`, not `res.ok` (M8); refused clears surface as refusals.
7. **A11y.** Ack label states what it does NOT do; `leadsWithVisibleText` assertion present (the strengthened M11); announcement in the persistent live region (M10).
8. **Absence path.** A snapshot WITHOUT `cmuxNotifications`/`acks` renders no badge/mark/section and no crash (NB unmerged — this is today's production shape).
9. **Floor.** Run + paste: `bunx tsc --noEmit`; `bun test tests/sync-notifications-board.test.ts`; full `bun test` tail. Only tolerated red: cross-source canary. Else BLOCK.

## Output

`VERIFY-sync-nf.md`, findings per check, final line exactly `VERDICT: PASS` or `VERDICT: BLOCK — <reasons>`. Uncertainty = BLOCK.
