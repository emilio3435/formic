# Goals

| Goal ID | Status | Relationship | Ledger |
|---|---|---|---|
| `ant-panel-integration-2026-08-09` | **active — OBB blocked** | standalone integration program | `.agent/runs/ant-panel-integration-2026-08-09/` |
| `confidence-header-notification-center` | **complete** | parent of `board-all-clear-lookback-disclosure` | `.agent/runs/confidence-header-notification-center/` |
| `a11y-geometry-harness` | candidate | child of `confidence-header-notification-center` | brief: `docs/a11y-geometry-gate/README.md` |
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

**COMPLETE 2026-08-06 05:29 UTC.** Eight tranches merged (PRs #9, #11, #12, #13,
#14, #15, #16, #17), each CI-green before merge. Every stage S0-S6 shipped, all six
a11y defects fixed, and the Board all-clear defect closed — that last one was found
mid-flight by an outside agent and was never in the plan.

Final state: `main` at `97def66`, `tsc` exit 0, 2706 pass / 0 fail.

One item carried forward as its own goal: `a11y-geometry-harness`. The panel geometry
test is written and validated but needs a browser harness this package lacks, so the
A11Y-1 guard remains CSS-text only — and the mutation audit proved that guard is wrong
in both directions.

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


## ant-panel-integration-2026-08-09

**ACTIVE — Phase 0 blocked.** OBB 1.0.32 and its encrypted schema are compatible,
but the required 24-hour cross-source window contains no readable rows. The
elevated repository gate is 3010/3011; a fresh Luna RCA owns the only red claim.
Chat UX is explicitly user-owned. Parser is landed; Foundation and Task Widget
handoffs are ready; the TL;DR ribbon mockup is in active visual refinement.
