# Goals

| Goal ID | Status | Relationship | Ledger |
|---|---|---|---|
| `confidence-header-notification-center` | active | parent of `board-all-clear-lookback-disclosure` | `.agent/runs/confidence-header-notification-center/` |
| `board-all-clear-lookback-disclosure` | queued | child of `confidence-header-notification-center` | `.agent/runs/board-all-clear-lookback-disclosure/` |

## board-all-clear-lookback-disclosure

**Queued, not started.** Blocked behind S3, S4 and S6-T3/T4 of the
confidence-header + notification-center program
(`docs/superpowers/plans/2026-08-05-confidence-header-and-notification-center.md`).
Lands on its own at a task boundary — the separation is the point.

The Board's rich all-clear (`renderPrograms`, app.js:5050+) is unreachable at any
reachable lookback preset, and the analysis concludes it would be **false** if it
were reached: `withinLookback` filters on `updatedAt` recency, so a session
waiting eight hours on a person is live and outside a 6h window. The fix is the
disclosure, not merely the reachability. Full reasoning in the ledger.

## confidence-header-notification-center

**Active.** Five tranches merged to main (PRs #9, #11, #12, #13, #14), each CI-green
before merge. S0, S1, S2, S3, S5 and S6-T1/T2 are done; S4, S6-T3/T4, A11Y-2..6,
the panel geometry test and the Board all-clear defect remain.

Two findings changed the design rather than the code, and both are recorded as
standing evidence: **dead time cannot be measured from any available source**, so
the standby hero was deleted rather than withheld; and **`attentionSignal.evidence`
fails as the ask in 3 of 5 live blocking sessions**, but the remedy was proven only
synthetically, so nothing shipped for it.

Relationship to the child goal: the all-clear defect was found *during* this program
by an outside agent, and is held back deliberately. It touches `renderPrograms()` in
`app.js`, which this program's FE lane holds, and its fix must restructure a
condition the concurrently-running unified-filtering program owns terms inside. It
lands at a task boundary, on its own.

