Goal: Determine whether current-head usage, context, cost, health, and timestamp values are sourced, scoped, and degraded truthfully.

Success means:

- Claims `M-01` through `M-07` have evidence-backed verdicts.
- Raw source values are traced independently through collection, aggregation, snapshot serialization, and rendering contracts.
- Missing, stale, capped, partial, estimated, and upstream-unavailable states stay distinct from zero and healthy.
- Clock boundaries and active-window denominators are exercised with deterministic evidence.

Stop when: The lane report contains current-head evidence, exact commands and outputs, a prioritized finding list, and explicit unknowns for all measurement claims.

## Mission

Trace measurement provenance on detached SHA `059cbbea670374a8778e20ef87f0582697efb42f`. Treat usage, context, cost, health, and timestamps as separate claims even when they share collectors or snapshot fields.

## Claims

- `M-01`: Session and aggregate token usage count the intended source fields exactly once and preserve scope/window semantics.
- `M-02`: Context usage derives from a supported context limit and shows unknown when the denominator is absent.
- `M-03`: Cost values distinguish measured, derived estimate, and unknown; unpriced or unavailable sources cannot become `$0` or poison-free totals.
- `M-04`: Source and system health reflect collector evidence, deadlines, degradation, and failed probes without equating absence with health.
- `M-05`: Generated, updated, last-event, activity, archive, and freshness timestamps use the intended clock and cannot run backward or overstate active work.
- `M-06`: Capped queries, retention, live/archive reconciliation, and partial collectors do not present bounded subsets as complete totals.
- `M-07`: OpenBurnBar/Codex availability is classified as current Ant Hill failure, upstream failure, blocked, or unavailable using a non-vacuous probe.

## Inspection fence

Read `src/server/{collectors,burnbar,burnbar-query,foreign-sqlite,pulse,state,snapshot,snapshot-agent,archive,lifecycle,publish-state,model-config,types}.ts`, `src/shared/types.ts`, measurement render consumers, and usage/context/cost/health/timestamp tests. Keep product and test source read-only in this phase.

## Evidence floor

Run focused deterministic suites for each claim and paste literal output. Use live loopback health/snapshot and OpenBurnBar probes only as read-only evidence, preserving non-vacuous source counts. Separate candidate-specific failures from external dependency failures by comparing the same probe semantics. Include `git status --short`, `git rev-parse HEAD`, and `git diff --check` in the report.

Write `LANE-REPORT-M.md` first with these headings, each initially `PENDING`: lane scope; named claims and first-red status; findings and proposed file fence; literal floor output; unverified or refused proof. Keep product source read-only, write scratch only under `.lane-evidence/`, never push or restart production, and delete nothing.
