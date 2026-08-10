# Ant Hill trust audit, 2026-08-10

Goal: Establish exact-head trust verdicts for identity, routing, measurement, browser layout, and rendering, then land only the smallest verified repairs for confirmed high-severity defects.

Success means:

- Every claim has one verdict: `PASS`, `FAIL`, `BLOCKED`, or `UNAVAILABLE`.
- Browser defects include a screenshot and numeric geometry from the same build and viewport.
- Each repair begins with a named regression test that fails for the intended reason.
- Routing ambiguity remains fail-closed, and unavailable controls remain visible, disabled, keyboard-inert, and explained.
- Each lane uses an exclusive worktree and a disjoint implementation fence.
- The integration owner reruns every floor on the combined exact head and reviews the complete diff.

Stop when: Every named subsystem has an evidence-backed verdict, eligible high-severity defects have minimal verified fixes, and the local integration branch is PR-ready.

## Locked decisions

- Baseline is `origin/main` at `059cbbea670374a8778e20ef87f0582697efb42f`, fetched on 2026-08-10.
- Integration branch is `fix/ant-hill-trust-audit-20260810`.
- Publication is outside this run. Push, PR creation, merge, deployment, and production restart require Emilio's confirmation.
- Read-only lanes may write only `LANE-REPORT-*.md` and `.lane-evidence/` artifacts in their own worktrees.
- A high-severity defect can misidentify or control the wrong session, materially falsify trust telemetry, or make a core browser control unusable at a supported viewport.
- Medium and low findings remain in the defect register without implementation unless Emilio expands scope.
- Historical evidence seeds hypotheses only. Current-head source, executable tests, live API responses, browser geometry, and screenshots determine verdicts.

## Verdict contract

- `PASS`: Current-head evidence directly satisfies the claim.
- `FAIL`: Current-head evidence directly contradicts the claim or reproduces the defect.
- `BLOCKED`: A named in-scope dependency or authorization gate prevents the required proof after safe alternatives are exhausted.
- `UNAVAILABLE`: The required source, service, platform, data population, or browser capability is absent in this environment; unavailable is not green.

## Evidence contract

Each claim records the exact SHA, command or probe, relevant output, and artifact path. Tests report pass, fail, skip, and filter counts. Browser claims record viewport, device scale, bounding rectangles, overflow/occlusion calculations, focusability, and screenshot path. Source inference is labeled as inference and cannot by itself confirm a browser defect.

## Claim ownership

- Lane I: `I-*`, session identity, routing, control authorization.
- Lane B: `B-*`, browser UX, accessibility, responsiveness, rendering, scroll ownership.
- Lane M: `M-*`, usage, context, cost, health, timestamps.
- Integration owner: reconciliation, severity, implementation fences, combined exact-head verification, final register.
