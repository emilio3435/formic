# RHSP Vertical Ownership + Prime System Monitor Implementation Plan

> For implementers: execute red-first, one task at a time. Do not start in the current dirty integration worktree. Preserve every foreign change and stop on a shared-file collision.

**Goal:** Make the right-hand-side panel (RHSP) keep its transcript, transcript footer, unavailable explanation, composer, and control buttons visibly inside one bounded shell at desktop and mobile sizes; classify the reserved Prime heartbeat monitor as system infrastructure and exclude it from dashboard rows and presentation counts without weakening routing or losing heartbeat/cost evidence.

**Architecture:** The document remains the dashboard scroll owner. The inspector moves out of the workboard's clipped shell and becomes its sibling. An agent inspector is a definite three-row shell: intrinsic header, `minmax(0, 1fr)` content, intrinsic controls footer. Desktop content has two deliberate scrollers (transcript and evidence). Mobile has one drawer-body scroller and a fixed footer. The reserved source ID `prime:ant-heartbeat-monitor` is declared `sessionKind: "system"` by the Prime collector; a provider-neutral client predicate removes system sessions only from dashboard presentation populations. Raw snapshot, health, TL;DR extraction, and usage evidence stay complete.

**Tech stack:** Bun, TypeScript server, vanilla ES-module client, CSS Grid/Flexbox, existing gstack Chromium driver for a local-only real-geometry gate. No new dependency, endpoint, persistence format, or routing rule.

## Success criteria

- At 1357x738 and 1530x862, these five boxes exist, have non-zero geometry, and are fully inside both `.pane-inspector` and the viewport:
  - `.drawer-chat`
  - `.drawer-chat-scroll`
  - `.chat-feed-foot`
  - `.drawer-controls-strip`
  - `.command-composer`
- `.drawer-controls-strip` is a direct shell footer after `.drawer-grid`, not a descendant of `.drawer-chat`.
- An unavailable session still renders the routing explanation, composer, Send, Focus, and Interrupt. The input and refused buttons use native `disabled`, cannot dispatch an action, and are absent from sequential keyboard focus.
- Shared cwd alone still never authorizes Focus, Send, or Interrupt. No server capability, target-resolution, or transmission gate is relaxed.
- The exact reserved Prime monitor is `system`; an ordinary UUID Prime session and an ordinary stable-string Prime session are not.
- System sessions do not appear in Board or History rows, search results, tab counts, scope counts, finished shelves, program heads, repository bands, or program drawers.
- The raw snapshot still contains the monitor; `heartbeatTldrAgent()` still finds it; operational health/usage paths can still count it; the venture ledger is unchanged.
- The required Bun tests, typecheck, diff check, and real-browser geometry gate report explicit PASS/FAIL/BLOCKED/UNAVAILABLE verdicts.

## Locked decisions

1. **Routing and visibility remain separate.** The RHSP fix changes DOM/layout only. The monitor fix changes system classification/dashboard presentation only. Neither changes target resolution or advertised capabilities.
2. **The dashboard document keeps scrolling.** Do not restore the old `100dvh` frozen application shell; it previously left a 28px transcript after 539px of chrome at 1440x900.
3. **The evidence desk no longer sizes the document column.** Remove the absolute `.drawer-doc` arrangement. Both columns consume a definite content row.
4. **Unavailable explanation belongs with unavailable controls.** `renderControlBanner()` moves into the dock footer; remove the duplicated visually-hidden dock explanation.
5. **Only the exact reserved monitor ID is system.** Stable Prime IDs are not hidden or made routable by shape. The declaration is an application-owned fact about one synthetic source, not a general stable-ID rule.
6. **Raw census and dashboard population are different products.** `totalsOf()` remains the operational/raw census. Dashboard helpers exclude `system`. Do not globally filter `snapshotAgents()`.
7. **Cost UI is deferred.** The heartbeat ledger already tracks cycles, invocations, tokens, and missing billing data. This repair preserves it; it does not invent billed dollars or add a new Usage card.

## Evidence baseline

- The composer is in the DOM and is rendered by `renderCommandDock()`. It was not removed by a conditional branch.
- Commit `e716d67` changed `.drawer-chat-scroll` from `min-height: 0` to `min-height: 16rem`. With `.drawer-chat { overflow: hidden }`, that hard floor could push the following transcript foot and dock beyond the clipped chat box.
- The existing easy fix changes the hard floor to a preferred flex basis: `flex: 1 1 16rem; min-height: 0`. Preserve that prerequisite.
- After that narrow fix and a normal document scroll, all five target boxes were visible at both requested desktop viewports. At `scrollY=0` on 1357x738, the whole workboard began around y=669, proving that the remaining defect is page/panel ownership, not a rendering branch.
- Current vertical ownership is split among the document, `.pane-inspector`, `.drawer-doc`, `.drawer-chat-scroll`, and a desk-sized grid. `syncDrawerFloat()` then measures the resulting content height and feeds it back into sticky positioning.
- `prime:ant-heartbeat-monitor` is a synthetic transcript written by the Ant Hill heartbeat loop. It has no interactive Prime process/surface and no user-turn identity. Its reserved stable ID is valid source identity, not safe routing identity.
- The current Prime parser publishes the monitor as `sessionKind: "unknown"`, so the client correctly treats it as an ordinary row. The defect is classification/presentation, not quarantine.

## What already exists

| Existing mechanism | Reuse decision |
|---|---|
| `SessionKind` already includes `"system"`; `sessionKindFor()` already honors `declaredKind` with `sessionKindSource: "declared"` | Reuse. Add typed collected fields and have the application-owned Prime source publish the verdict. Do not add a new kind or classifier. |
| `controlsFor()`, `renderDockTool()`, and the composer already render refused capabilities with native `disabled` | Reuse and test. Do not alter capability derivation. |
| `heartbeatTldrAgent()` explicitly scans raw snapshot programs for `prime:ant-heartbeat-monitor` | Preserve raw input. Add a regression proving dashboard filtering does not starve it. |
| `workingSet()` is already the source for tab/lens/scope counts | Extend with the provider-neutral dashboard predicate. Do not create separate per-counter filters. |
| `renderPrograms()` already supplies program populations to row, shelf, worktree, and repository rollups | Feed it presentation copies whose `agents` arrays already exclude system sessions. Do not patch each rollup separately. |
| The existing local-only notification geometry gate starts an isolated server and drives real Chromium | Copy the pattern for RHSP geometry. Do not add Playwright/Puppeteer. |
| The easy Cursor-wrapper and flex-minimum fixes are already present as uncommitted changes | Treat them as prerequisites and preserve their tests; do not reimplement them in this plan. |

## Target vertical model

### Desktop, width >= 1025px

```text
document scrollport
└── .app-body                         no overflow; open state is 40/60 grid
    ├── .ops-stage                    left workboard only; content-sized
    │   └── .pane-list                no scroll container; document owns rows
    └── .pane-inspector.dw-agent      sticky; definite viewport-derived height
        ├── .drawer-shell-head        auto (title + attention + vitals)
        ├── .drawer-grid              minmax(0, 1fr); overflow hidden
        │   ├── .drawer-doc           task auto + chat minmax(0, 1fr)
        │   │   ├── .drawer-chat-task auto
        │   │   └── .drawer-chat      minmax(0, 1fr) + transcript foot auto
        │   │       ├── .drawer-chat-scroll   overflow-y:auto
        │   │       └── .chat-feed-foot       always visible
        │   └── .drawer-desk          overflow-y:auto
        └── .drawer-controls-strip    auto; banner + controls + composer
```

Rules:

- `.pane-inspector.dw-agent` owns a definite height such as `calc(100dvh - 2.5rem)` and `overflow: hidden`.
- `.drawer-grid`, `.drawer-doc`, `.drawer-chat`, and every `minmax(0, 1fr)` ancestor have `min-height: 0`.
- The pane and document column are not scroll containers. The normal desktop scrollers are the transcript and desk (plus the already-explicit expanded Full brief micro-scroller).
- The inspector's sticky top is a constant gap. Delete content-centering via `--drawer-float-top`, `drawerFloatTopPx()`, `syncDrawerFloat()`, its observer/listener state, and all calls/exports.
- Opening the inspector does not programmatically scroll the document. A row can only be selected from the workboard, so the app-body is already in the operator's viewport; the pane then sticks while the document moves.

### Tablet, 861px to 1024px

- Keep the existing fixed full-viewport inspector and body scroll lock.
- Retain the two-column drawer content layout inside the full sheet.
- Apply the same header/content/footer shell and desktop column scroll ownership.

### Mobile, width <= 860px

```text
body.inspector-open                  overflow locked; fixed sheet is the modal
└── .pane-inspector.dw-agent         grid: auto minmax(0,1fr) auto; overflow hidden
    ├── .drawer-shell-head           auto
    ├── .drawer-grid                 the single drawer-body overflow-y:auto
    │   ├── task
    │   ├── transcript/feed/foot     expands in normal flow; no nested feed scroll
    │   └── evidence/lineage         expands in normal flow
    └── .drawer-controls-strip       auto; always visible
```

- Remove `.drawer-chat { height: 68vh }` at this breakpoint.
- Set the transcript and desk overflow to visible here so `.drawer-grid` is the one body scroller.
- Keep the native document lock only while the true full-sheet inspector is open.
- Do not introduce scroll-jacking to preserve desktop chat-bottom behavior. At <=860px, open the single drawer body at its top and disable the chat-feed scroll memo for that breakpoint; chat-bottom pinning and per-agent mid-transcript restoration remain desktop/tablet behavior only. Pin this deliberate mobile behavior in a test.

## Target monitor data flow

```text
~/.prime/agent/sessions/ANT-HEARTBEAT-MONITOR.jsonl
        |
        v
createPrimeParser()
  exact sourceSessionId == "ant-heartbeat-monitor" ?
        | yes                               | no
        v                                   v
sessionKind="system"                  no declaration
source="declared"                    normal evidence classifier
        \___________________________________/
                        |
                        v
                 buildSnapshot()
                        |
             +----------+-----------+
             |                      |
             v                      v
raw operational consumers       dashboardPrograms()
health / TL;DR / usage          filter sessionKind==system
monitor preserved              rows/counts/rollups exclude
```

The declaration proves what the source *is*. It does not prove a process, cmux surface, target, or transmission route. The monitor remains observed-only even though its stable source ID is legitimate.

## Minimal implementation file fence

| File | Change |
|---|---|
| `src/server/types.ts` | Add optional typed `sessionKind` and `sessionKindSource` fields to `CollectedAgent`; import existing shared types. |
| `src/server/prime.ts` | Declare only `ant-heartbeat-monitor` as system; remove the `as unknown as CollectedAgent` escape if the returned object now satisfies the interface. |
| `src/web/index.html` | Move `#inspector` out of `.ops-stage` so it is a sibling under `.app-body`. Bump the static asset query only if this repo's cache-bust convention requires it at implementation time. |
| `src/web/app.js` | Add dashboard population helpers, apply them to selection/working sets/program presentation, wrap the agent header, move banner+dock to a direct pane footer, and retire dynamic float measurement. |
| `src/web/styles.css` | Establish the app-body/pane shell and one scroll owner per content area; remove desk-sized/absolute-doc rules and mobile nested chat height. |
| `tests/b2-render-proof.test.ts` | Add exact reserved-monitor parser/snapshot tests and ordinary stable/UUID controls. |
| `tests/web-client.test.ts` | Add dashboard-population, DOM-order, disabled-control, CSS ownership, and non-regression tests. Update only existing assertions invalidated by the intended structure. |
| `docs/rhsp-geometry-gate/drawer-geometry.test.ts` | Add a local-only real-Chromium test for both desktop viewports and one mobile viewport; fail loudly if the browser cannot run. |

Implementation changes are limited to these eight files. This plan document is not part of the runtime fence.

## Engineering review conclusions

- **Architecture:** Three resolved issues: competing vertical owners, raw/presentation population coupling, and source identity being mistaken for routing identity.
- **Code quality:** Two resolved issues: content-height feedback through `ResizeObserver`, and untyped collected `sessionKind` fields hidden behind casts.
- **Tests:** Five required gaps are covered below: real geometry, exact/near-match monitor classification, raw TL;DR retention, rollup/count parity, and native-disabled no-dispatch behavior.
- **Performance:** No open issue. Filtering is one linear shallow-copy pass over the already-rendered population; do not add memoization or another cache. Removing the resize observer eliminates layout-measure/write feedback.
- **TODO ledger:** `TODOS.md` does not exist. No TODO is added. The optional Infrastructure cost card remains a named product decision in this plan rather than a context-free backlog line.
- **Retrospective:** The recent sequence moved scroll authority from document to workboard to desk-sized drawer and then added a hard feed floor. This plan replaces that oscillation with one explicit owner per region; do not land another isolated min-height or sticky-offset patch.

## Inline documentation to add during implementation

- `src/web/styles.css`: add one compact ASCII comment beside the `.dw-agent` shell showing `header / minmax(0,1fr) content / footer` and name the desktop/mobile scroll owners.
- `src/web/app.js`: add one compact ASCII comment beside the dashboard helpers showing `raw snapshot -> operational consumers` and `raw snapshot -> filtered presentation programs`.
- `src/server/prime.ts`: a prose comment on the exact reserved ID is sufficient; no inline diagram is warranted for one equality branch.

Update these comments in the same change if the implemented ownership differs. A stale scroll diagram is worse than none.

## Task 0: integration and collision gate

**Files:** none.

- [ ] Confirm the easy-fix prerequisite is present:
  - Cursor versioned wrapper admission in `src/server/identity.ts` with `tests/cursor.test.ts` coverage.
  - `.drawer-chat-scroll { flex: 1 1 16rem; min-height: 0 }` with the existing `tests/web-client.test.ts` regression.
- [ ] Run `git status --short --branch` and record the current exact head.
- [ ] Do not implement in `/Users/emilionunezgarcia/Developer/the-mountain-main` while `src/web/app.js`, `src/web/styles.css`, or `tests/web-client.test.ts` contain foreign uncommitted work.
- [ ] Have the owning lane land the easy fixes as a path-scoped local commit after its tests pass, then create a fresh `fix/rhsp-vertical-system-monitor` worktree from that exact commit.
- [ ] If any fenced path is dirty in the new worktree, report **BLOCKED** and stop. Never stash, discard, or absorb it.
- [ ] Capture the baseline commands and pass/fail counts before editing.

## Task 1: classify the reserved Prime source (red first)

**Files:** `tests/b2-render-proof.test.ts`, `src/server/types.ts`, `src/server/prime.ts`.

### Red tests

- [ ] Parse a JSONL session whose header ID is exactly `ant-heartbeat-monitor` and assert:
  - collected ID is `prime:ant-heartbeat-monitor`;
  - `sessionKind === "system"`;
  - `sessionKindSource === "declared"`;
  - no `recordedTarget`, runtime surface, or interactive identity is invented.
- [ ] Send that collected record through `buildSnapshot()` and assert the published agent preserves the same kind/source and TL;DR tail.
- [ ] Parse an ordinary UUID Prime session and an ordinary stable ID such as `release-coordinator`; assert neither is declared system. Their result remains `unknown` unless real launch/declaration evidence says otherwise.
- [ ] Assert `ant-heartbeat-monitor-2` is not captured by a prefix/regex accident.

Expected red: the exact monitor currently has no declared kind, and `CollectedAgent` does not type those fields.

### Implementation

- [ ] Import `SessionKind` and `SessionKindSource` into `src/server/types.ts`; add the two optional fields beside the existing launch/task identity evidence.
- [ ] Define one exact reserved-ID constant in `src/server/prime.ts` and compare normalized `sessionId` by equality.
- [ ] Add `{ sessionKind: "system", sessionKindSource: "declared" }` only for the exact monitor result.
- [ ] Let existing snapshot publication carry those typed fields. Do not edit `sessionKindFor()`, target resolution, or controls.
- [ ] Remove the double type assertion from the Prime result only if TypeScript accepts the honest return shape; do not broaden unrelated Prime cleanup.

### Task verifier

```bash
bun test tests/b2-render-proof.test.ts
bun run typecheck
```

## Task 2: create one dashboard population boundary (red first)

**Files:** `tests/web-client.test.ts`, `src/web/app.js`.

### Red tests

Build one snapshot containing:

- an exact system monitor with `[TL;DR]`;
- one normal automation session;
- one normal work session;
- one finished work session;
- programs sharing a repository so band and program rollups can disagree if any path forgets the filter.

Then assert:

- [ ] `dashboardVisible(system) === false`; `dashboardVisible(automation/work) === true`.
- [ ] `workingSet()` excludes system on Board and History, even when search text matches its ID/TL;DR.
- [ ] `renderTabs()` prints counts from the non-system population and does not count a system row as unverified.
- [ ] `renderPrograms()` emits no monitor row, no monitor finished-shelf row, and reports the same non-system count in program and repository rollups.
- [ ] A program drawer resolved from the dashboard receives a filtered program population.
- [ ] A stale selected monitor cannot reopen an agent drawer after the next paint.
- [ ] `heartbeatTldrAgent(rawSnapshot)` still returns the monitor.
- [ ] `totalsOf(rawSnapshot).tracked` remains the raw server total while `workingSet().length` is the presentation total. This difference is intentional and named in the test.
- [ ] The input snapshot/program arrays are not mutated by the presentation filter.

Expected red: `sessionKind: "system"` currently passes every view/search path and full `program.agents` still feeds rollups.

### Implementation

- [ ] Add pure, provider-neutral helpers:
  - `dashboardVisible(agent) => sessionKindOf(agent) !== "system"`;
  - `dashboardProgram(program)` or `dashboardPrograms(snap)` returning shallow presentation copies with filtered `agents` arrays.
- [ ] Export the helpers and `heartbeatTldrAgent` only through the existing `TheAntHill` test seam.
- [ ] Apply `dashboardVisible` at the population boundary for `workingSet`, `currentFilter`, `shelfFilter`, `hiddenByLookback`, tab unverified counts, and selected-agent resolution.
- [ ] Make `renderPrograms()` iterate filtered program copies so row, shelf, program-head, worktree, and repository-band derivations all consume the same arrays.
- [ ] Derive the `renderPrograms()` tracked/empty-list decision from the filtered presentation programs, not `totalsOf().tracked`, so a system-only source cannot create a zero-row/nonzero-row-count contradiction.
- [ ] Make program-drawer selection use the same filtered copy.
- [ ] Keep `snapshotAgents()`, `totalsOf()`, health rail, heartbeat extraction, source health, debug endpoints, and Usage inputs on the raw snapshot.
- [ ] Do not add a “show system sessions” search escape in this repair. The monitor stays available through raw/debug/health paths, not the operator row surface.

### Task verifier

```bash
bun test tests/web-client.test.ts tests/b2-render-proof.test.ts
bun run typecheck
```

## Task 3: reorder the agent drawer DOM (red first)

**Files:** `tests/web-client.test.ts`, `src/web/index.html`, `src/web/app.js`.

### Red tests

- [ ] Static DOM test: `#inspector` is a direct child of `.app-body` after `.ops-stage`, not a child of `.ops-stage`.
- [ ] Fake-DOM render test: an agent pane has exactly this structural order:

```text
.drawer-shell-head
.drawer-grid
.drawer-controls-strip
```

- [ ] `.drawer-controls-strip.parent === pane`; it is not under `.drawer-chat` or `.drawer-doc`.
- [ ] `.chat-feed-foot.parent === .drawer-chat` and follows `.drawer-chat-scroll`.
- [ ] For a quarantined/shared-cwd fixture, the dock contains `.control-banner`, `.command-composer`, Send, Focus, and Interrupt.
- [ ] The input and refused buttons have a native disabled attribute. Their action handlers do not run through normal click/submit/keyboard paths; the test must assert no control request is recorded.
- [ ] The routing explanation includes the existing shared-folder/ambiguous reason and “See routing evidence” action.
- [ ] A linked fixture remains enabled, proving the UI move did not globally disable controls.

### Implementation

- [ ] Move the static `<aside id="inspector">` after the closing `.ops-stage` tag while keeping it inside `.app-body`.
- [ ] In `renderAgentDrawer()`, create `.drawer-shell-head` and append the existing verdict head, optional attention block, and vitals into it.
- [ ] Keep `.drawer-grid` as the content row.
- [ ] Append `renderTranscriptFoot(agent)` to `.drawer-chat` after the feed.
- [ ] Build the dock once, add `.drawer-controls-strip`, insert `renderControlBanner(agent, control)` at its start when present, and append the dock to the pane after `.drawer-grid`.
- [ ] Remove the old pane-level banner append and the duplicated visually-hidden safe-lock explanation.
- [ ] Preserve every existing control object and `sendControl()` call path. This task is geography and accessibility only.
- [ ] Remove `drawerFloatTopPx`, `syncDrawerFloat`, observer/listener state, cleanup calls, and test exports. Replace no part of them with timers or scroll listeners.
- [ ] Gate the existing chat-scroll memo at `min-width: 861px`. At mobile widths, do not write `scrollTop` on the now-non-scrolling feed and let the single drawer body open at its top.

### Task verifier

```bash
bun test tests/web-client.test.ts
bun run typecheck
```

## Task 4: assign one vertical owner per region (red first)

**Files:** `tests/web-client.test.ts`, `src/web/styles.css`.

### Red CSS-contract tests

Assert behavior-bearing invariants, not exact formatting:

- [ ] `.app-body` becomes the open-state desktop grid; `.ops-stage` no longer contains/sizes the inspector.
- [ ] `.pane-inspector.dw-agent` has a definite viewport-derived height, three grid rows, `min-height: 0`, and `overflow: hidden` at desktop.
- [ ] `.drawer-grid` owns `minmax(0, 1fr)` and `min-height: 0`.
- [ ] `.drawer-doc` is not `position: absolute` and is not a scroller.
- [ ] `.drawer-chat` has rows `minmax(0, 1fr) auto`; `.drawer-chat-scroll` keeps `flex-basis: 16rem`/`min-height: 0` and owns desktop transcript overflow.
- [ ] `.drawer-desk` owns desktop evidence overflow.
- [ ] `.drawer-controls-strip` is static shell-footer layout, with no negative pane bleed and no dependency on `.drawer-chat >` ancestry.
- [ ] No CSS references `--drawer-float-top`; no source references `syncDrawerFloat`.
- [ ] At `max-width: 860px`, `.drawer-grid` owns `overflow-y: auto`; `.drawer-chat-scroll` and `.drawer-desk` do not; `.drawer-chat` has no `68vh` fixed height.
- [ ] The body scroll lock exists only in the existing full-sheet breakpoint.

### Implementation

- [ ] Make `.app-body` a single column by default and a 40/60 grid only for an open desktop inspector. Preserve the current `clamp(380px, 40%, 760px)` left-track policy in one declaration.
- [ ] Remove the desktop flex-basis coupling between `.pane-list` and `.pane-inspector`; the grid tracks become the one width authority.
- [ ] Give the sibling inspector its own border/background shell now that `.ops-stage` no longer wraps it.
- [ ] Give `.dw-agent` the three-row shell and definite viewport height. Other drawer kinds keep their existing single-pane overflow behavior unless a rule must change to support the sibling move.
- [ ] Replace the desk-sized grid and absolute document rules with a definite content row. Both columns fill it; transcript and desk absorb overflow independently.
- [ ] Convert `.drawer-chat` to a two-row grid (feed, foot). Keep `overflow: hidden` only as border-radius clipping; the feed is allowed to shrink because every ancestor has `min-height: 0`.
- [ ] Restyle `.drawer-controls-strip` as the pane footer. The banner may make the footer taller; the grid explicitly reserves that height instead of allowing the chat to cover or clip it.
- [ ] In the mobile rule, make `.drawer-grid` the single content scroller and allow chat/evidence to expand in it. Keep the dock/footer outside that scroller.
- [ ] Preserve horizontal overflow guards and `overscroll-behavior` only on elements that truly scroll.

### Task verifier

```bash
bun test tests/web-client.test.ts
bun run typecheck
```

## Task 5: add and run the real geometry gate

**Files:** `docs/rhsp-geometry-gate/drawer-geometry.test.ts`.

Follow the existing `docs/a11y-geometry-gate/notification-center-geometry.test.ts` pattern:

- [ ] Resolve the project-local or machine-wide gstack browser binary.
- [ ] Start this checkout's server on an ephemeral port. Never use or restart port 4701.
- [ ] Stop boot polling, inject a deterministic quarantined agent fixture through `globalThis.TheAntHill`, render its drawer, and scroll `.app-body` into the normal selection position on desktop.
- [ ] Measure 1357x738 and 1530x862. For every required selector, record `{top,bottom,left,right,width,height}` and assert:
  - width and height are non-zero;
  - top/bottom are inside the pane and viewport;
  - left/right are inside the pane and viewport;
  - the feed ends before the transcript footer and the content grid ends before the dock;
  - `.drawer-chat-scroll` has at least 48px of usable height at 1357x738;
  - the composer input is natively disabled in the unavailable fixture;
  - document horizontal scroll width does not exceed client width.
- [ ] Measure 390x844 and assert:
  - fixed pane is entirely on-screen;
  - header and footer are visible;
  - `.drawer-grid` is the only drawer-body element with vertical scrolling;
  - `.command-composer` is inside the pane and viewport;
  - the document is locked only while the sheet is open.
- [ ] Add a guard-on-the-guard: fail if the pane is hidden, any selector is missing, or any target rectangle is 0x0.
- [ ] Capture screenshots to `/tmp/anthill-rhsp-1357x738.png`, `/tmp/anthill-rhsp-1530x862.png`, and `/tmp/anthill-rhsp-390x844.png` during verification. Screenshots are evidence, not committed artifacts.
- [ ] If Chromium cannot run, report **UNAVAILABLE**. Do not mark geometry PASS from fake-DOM or CSS-text tests.

Manual/local command:

```bash
bun test docs/rhsp-geometry-gate/drawer-geometry.test.ts
```

## Task 6: full verification and diff review

Run from the exact implementation worktree:

```bash
bun test tests/web-client.test.ts tests/snapshot.test.ts tests/cursor.test.ts tests/identity-trace.test.ts tests/b2-render-proof.test.ts
bun run typecheck
bun test docs/rhsp-geometry-gate/drawer-geometry.test.ts
git diff --check
git status --short --branch
git diff -- src/server/types.ts src/server/prime.ts src/web/index.html src/web/app.js src/web/styles.css tests/b2-render-proof.test.ts tests/web-client.test.ts docs/rhsp-geometry-gate/drawer-geometry.test.ts
```

Then verify all of the following explicitly:

- [ ] The monitor is absent from Board/History rows and every presentation rollup/count.
- [ ] The raw `/api/snapshot` still contains `prime:ant-heartbeat-monitor` as `system`.
- [ ] The header TL;DR still renders from the raw monitor.
- [ ] `/api/debug/identity?agent=prime%3Aant-heartbeat-monitor` remains observed-only/unroutable; no target is invented.
- [ ] One shared-cwd Home/Cursor session still advertises disabled Focus/Send/Interrupt unless exact identity evidence now exists.
- [ ] No product service was restarted. Live endpoint checks are **UNAVAILABLE** if no isolated/local server is running and no restart was authorized.

Each verifier is reported as one of **PASS**, **FAIL**, **BLOCKED**, or **UNAVAILABLE**, with command and exact counts/error.

## Coverage diagram

```text
CODE PATHS                                             USER-VISIBLE CONTRACTS
[+] Prime parser                                       [+] Infrastructure monitor
  ├── exact reserved ID -> declared system               ├── hidden from Board + History
  ├── ordinary stable ID -> normal classifier             ├── absent from search and row counts
  ├── UUID ID -> normal classifier                        └── TL;DR + raw evidence retained
  └── snapshot spread preserves kind/source

[+] Dashboard population                               [+] Dashboard navigation
  ├── workingSet excludes system                          ├── tab counts match visible population
  ├── current/shelf/lookback exclude system               ├── scope count matches rows
  ├── presentation program copy excludes system           └── repository/program rollups match rows
  ├── selected system cannot open drawer
  └── raw totals + heartbeat bypass the presentation gate

[+] Agent drawer                                       [+] Unavailable controls
  ├── head -> content -> footer DOM order                 ├── explanation remains visible
  ├── banner lives inside footer                          ├── composer remains visible
  ├── feed -> transcript foot order                       ├── Send/Focus/Interrupt visible disabled
  └── no dynamic height observer                          └── no click or keyboard activation

[+] Layout                                             [+] Viewports [REAL BROWSER]
  ├── desktop document scroll + sticky pane               ├── 1357x738 all five boxes visible
  ├── transcript/evidence own desktop overflow             ├── 1530x862 all five boxes visible
  ├── mobile drawer body owns content overflow              └── 390x844 footer visible, one body scroll
  └── footer always reserves its own row
```

## Production failure modes

| Failure mode | Required test | Existing handling | User impact if missed |
|---|---|---|---|
| A prefix match classifies ordinary `ant-heartbeat-monitor-*` sessions as system | Exact negative parser tests | Exact equality | Legitimate session silently disappears. |
| Client filters the raw snapshot globally | Raw totals + `heartbeatTldrAgent()` regression | Separate presentation helper | TL;DR/health infrastructure silently vanishes. |
| Rows filter system but program/repository heads still count it | Production `renderPrograms()`/rollup fixture | Filtered program copies | Counts disagree with visible rows. |
| Old selected monitor reopens a drawer after its row is hidden | Selection regression | Selection applies dashboard predicate | Hidden infra still surfaces through stale state. |
| Footer banner becomes tall and collapses transcript to zero | Real 1357x738 minimum feed-height assertion | Three-row shell, min-height chain | Controls visible but chat unusable. |
| A future hard min-height or absolute document rule reintroduces clipping | CSS contract + browser rectangles | `minmax(0,1fr)` hierarchy | Composer is in DOM but invisible again. |
| Mobile retains pane + feed + desk nested scroll owners | Mobile computed-overflow assertion | Single drawer-body scroll | Touch scrolling locks or traps. |
| Disabled styling returns without native disabling | DOM attribute and no-dispatch tests | Existing `disabled` capability gates | Unsafe controls look inert but activate. |
| Browser driver is missing | Geometry test fails loudly; verifier says UNAVAILABLE | No fake fallback | Visual safety remains unverified, never falsely green. |

No failure mode is allowed to remain silent without a test and a named verifier.

## Parallel worktree strategy

| Lane | Modules | Depends on |
|---|---|---|
| A: monitor classification | `src/server/`, `tests/b2-render-proof.test.ts` | Task 0 |
| B: dashboard population + RHSP DOM/CSS | `src/web/`, `tests/web-client.test.ts` | Task 0 |
| C: browser geometry gate | `docs/rhsp-geometry-gate/` | Lane B |
| Integration | all fenced paths | A + B + C |

- Launch A and B in parallel only from separate clean worktrees at the same prerequisite commit.
- Run C after B lands because its selectors and vertical contract depend on B.
- Integrate A and B, then run all verification. A and B have disjoint runtime/test files; C is additive.
- Do not parallelize work inside Lane B: `app.js`, `styles.css`, `index.html`, and `web-client.test.ts` describe one DOM/layout contract and should move together.

## NOT in scope

- **Routing stable Prime IDs:** A stable source ID proves transcript continuity, not an interactive process/surface. No new Focus/Send/Interrupt binding is proposed.
- **Controlling the heartbeat monitor:** It is a synthetic mailbox and periodic loop, not an interactive Prime agent. It remains observed-only.
- **Changing Home/Cursor cwd grouping:** The easy wrapper admission improves exact store inspection, but genuinely GUI-only/out-of-cmux sessions remain safely unroutable.
- **Changing `totalsOf()` or server health census:** Operational infrastructure remains observable even when not a dashboard row.
- **New heartbeat cost card or dollar estimate:** Actual billed cost is missing. Preserve the ledger and defer honest UI attribution to a separate product decision.
- **Adding Playwright/Puppeteer or making local Chromium a CI dependency:** Use the existing local browser boundary and report it unavailable when absent.
- **Refactoring other drawer kinds:** Only the sibling shell move and any necessary base compatibility styles apply to them; their content anatomy is unchanged.
- **Restart, deploy, push, PR, or merge:** Implementation and verification are local unless separately authorized.

## Deferred product decision

Should Usage gain a dedicated **Infrastructure** card backed by `data/task-summaries/venture-usage.jsonl`?

- Current truth: the ledger tracks cycles, model invocations, tokens, outcomes, and missing price data; it does not know actual billed cost.
- Recommendation: defer it. When built, label tokens/invocations as observed and dollars as unavailable unless a billing-grade source is added. Never infer per-row cost from this synthetic Prime transcript.

This decision does not block hiding the monitor row because tracking already exists independently of dashboard presentation.

## Completion checklist

- [ ] Task 0 clean-worktree/collision gate satisfied.
- [ ] Task 1 monitor classification tests red, then green.
- [ ] Task 2 presentation-population tests red, then green.
- [ ] Task 3 DOM/control-state tests red, then green.
- [ ] Task 4 CSS ownership tests red, then green.
- [ ] Task 5 real-browser geometry passes or is explicitly UNAVAILABLE.
- [ ] Required focused tests pass with exact counts.
- [ ] Typecheck passes.
- [ ] `git diff --check` passes.
- [ ] Final diff is limited to the eight-file fence.
- [ ] No routing or transmission gate changed.
- [ ] No foreign work was committed, discarded, reformatted, or overwritten.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---:|---|---|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | NOT RUN | Existing diagnosis and user decisions supplied scope. |
| Codex Review | `/codex review` | Independent second opinion | 0 | NOT RUN | Not required for the plan artifact. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 10 issues/gaps incorporated; 0 critical gaps; 0 unresolved decisions. |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | NOT RUN | Recommended before implementation because RHSP interaction changes are visual. |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | NOT RUN | No new developer-facing interface. |

**UNRESOLVED:** 0 implementation decisions. The optional Infrastructure cost card is explicitly deferred and does not block this repair.

**VERDICT:** ENG CLEARED — implementation-ready after Task 0's clean-worktree prerequisite.
