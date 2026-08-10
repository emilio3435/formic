# What the lane was

COMPLETE — dashboard-population and RHSP vertical-ownership implementation on
local branch `feat/rhsp-system-monitor-web`, based on
`bad2ac431246fa30e99295cae3d10879e7d7c5b3`.

The lane kept raw snapshot health, heartbeat TL;DR, usage, and debug consumers
intact while separating `sessionKind: "system"` records from dashboard
presentation. It also replaced the agent drawer's overlapping, content-sized
vertical model with one explicit head / bounded content / controls-footer shell.

# Which claims went red first

The implementation tests were written before product changes and run with:

```text
$ bun test tests/web-client.test.ts -t "system infrastructure|agent RHSP"
2 pass
8 fail
562 filtered out
11 expect() calls
Ran 10 tests across 1 file. [64.00ms]
```

The eight named red claims were:

- `dashboardVisible` did not exist.
- `dashboardPrograms` did not exist.
- `workingSet` still included the system monitor.
- `hiddenByLookback` still counted the system monitor.
- `heartbeatTldrAgent` was not exported for the raw-consumer boundary test.
- `#inspector` was still nested inside `.ops-stage`.
- the agent drawer still appended the dock inside `.drawer-chat` rather than as
  the pane footer.
- CSS still encoded the old absolute/content-sized drawer and 16rem minimum
  feed-height model.

The native-disabled no-dispatch fixture and the linked-enabled control fixture
already passed in the red run. That evidence is important: the lane changed
presentation and vertical ownership, not routing authorization.

# What shipped, file and fence

Only the owned fence shipped:

- `src/web/app.js`: added the provider-neutral `dashboardVisible()` predicate
  and shallow `dashboardPrograms()` presentation funnel; applied it to rows,
  Board/History/search, shelves, tab/scope/lookback counts, program/repository
  rollups, and stale selection. `heartbeatTldrAgent()` and raw totals continue
  to consume the raw snapshot. Reordered agent drawer DOM to
  `.drawer-shell-head`, `.drawer-grid`, then the direct
  `.drawer-controls-strip` footer. Removed dynamic drawer-height measurement.
  Mobile no longer writes transcript scroll state when the drawer body is the
  scroll owner. Capability derivation, target resolution, and `sendControl()`
  were not changed.
- `src/web/index.html`: moved `#inspector` beside `.ops-stage` under
  `.app-body`; bumped both asset cache tokens from `ah-t12` to `ah-t13`.
- `src/web/styles.css`: made `.pane-inspector.dw-agent` a definite three-row
  shell (`auto minmax(0, 1fr) auto`), bounded every desktop content ancestor,
  assigned desktop scrolling to transcript/evidence, and assigned mobile
  scrolling to one drawer body. The footer is static, opaque, and in flow; the
  obsolete overlay scrim and dynamic float variable are gone. The feed keeps
  the prerequisite `flex: 1 1 16rem; min-height: 0`.
- `tests/web-client.test.ts`: added red-first population/raw-consumer,
  ancestry/order, native-disabled no-dispatch, linked-enabled, and CSS scroll
  ownership regressions; updated superseded sticky/absolute-layout contracts.
- `LANE-REPORT-web.md`: this evidence handoff.

# Floor results pasted

Focused new-contract green:

```text
$ bun test tests/web-client.test.ts -t "system infrastructure|agent RHSP"
10 pass
0 fail
562 filtered out
56 expect() calls
Ran 10 tests across 1 file. [94.00ms]
```

Required full web-client floor (final run):

```text
$ bun test tests/web-client.test.ts
572 pass
0 fail
3515 expect() calls
Ran 572 tests across 1 file. [462.00ms]
```

Required typecheck:

```text
$ bun run typecheck
$ bunx tsc --noEmit
```

Exit status: `0`.

The isolated worktree initially had no `node_modules`; a sandboxed Bun run
could not write its temporary directory, and an escalated run then reported
`TS2688: Cannot find type definition file for 'bun'`. I ran
`bun install --frozen-lockfile` in this worktree, installing only the lockfile's
pinned `@types/bun@1.3.14` and `typescript@7.0.2`, with no tracked-file change.
The exact typecheck above then passed.

Required diff hygiene:

```text
$ git diff --check
```

No output; exit status `0`.

# Anything unverified

Real-browser geometry and screenshots are not part of this lane's verifier
fence and were not claimed here. The integration/browser lane must still prove
the two target viewports and capture rectangles for `.drawer-chat`,
`.drawer-chat-scroll`, `.chat-feed-foot`, `.drawer-controls-strip`, and
`.command-composer`.

No live service was restarted or exercised. No push, merge, deploy, or primary
checkout mutation occurred.
