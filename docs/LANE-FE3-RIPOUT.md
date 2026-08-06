# Lane FE-3 — remove the select-to-send and action-log subsystems

Emilio ruled 2026-08-05 23:55: "Rip them out once we're done landing." FE-2
landed (see `docs/LANE-FE2-STATUS.md`); the buttons are already gone
(`e919831`) and the machinery is dormant. Your lane deletes the machinery.
This is REMOVAL work: every deleted line must trace to one of the two
subsystems; nothing else gets "improved."

## Scope A — selection / broadcast ("Select to send")

- `enterSelectMode` and every `state.selecting` read/write in `src/web/app.js`
  (row rendering threads it through aria-labels, tabindex, checkbox
  affordances, click guards — roughly the `renderAgentRow` region and the
  broadcast plumbing; map ALL refs with grep before cutting).
- `renderBroadcastBar` and the "Done selecting" exit FE-2 added to it
  (`f905254`-era; it exists only because the mode was still enterable — with
  the mode gone, the bar goes whole).
- The program-drawer entry point ("send to program" / selection entry — find
  it in `renderProgramDrawer`).
- `state.selecting` in `src/web/client-state.js`; `broadcastEligible`,
  `broadcastIneligibleReason` in their module, their seam exports, and any
  now-unused imports.
- All `.broadcast*`, `.is-selecting`, selection-checkbox CSS.

## Scope B — action log

- `src/web/action-log.js` module and its import (`app.js:27` region), every
  render/wiring call.
- `#actions-panel` (`index.html`, ~:144) — index.html may carry foreign
  hunks; atomic staging.
- All `.action-log*` and `.actions-panel*` CSS.

## Rules

- Tests: delete the two subsystems' behavior tests WITH the code; flip any
  presence pins to absence only where a surviving surface warrants it. The
  aria-label test for rows updates to the label without the selection
  suffix. CSS census and source-hygiene suites are your tripwires — run
  `bun test tests/web-client.test.ts` after each scope, full
  `bunx tsc --noEmit` + `bun test` before finishing.
- If a removal orphans something OUTSIDE the two subsystems (an import, a
  helper, a CSS var), remove it only if YOUR removal orphaned it; otherwise
  status-line it.
- Shared-worktree law (it bit three times today): branch
  `fix/cmux-control-health-lifecycle`, re-check before commits; app.js /
  styles.css / index.html / web-client.test.ts are co-tenanted; stage ONLY
  your hunks and commit in the same shell invocation; verify foreign hunks
  survive after each commit. Two commits: one per scope
  (`refactor(web): remove the select-to-send machinery`,
  `refactor(web): remove the action log`). Do not push. Do not commit this
  kickoff or your status file.
- Known foreign reds you are NOT to fix: the "Board all-clear is reachable"
  block (a co-tenant's in-flight TDD) and docs/a11y-geometry-gate (needs a
  live board).

## Status protocol

Append to `docs/LANE-FE3-STATUS.md`: `[HH:MM] SCOPE-A DONE <sha>` /
`SCOPE-B DONE <sha>` / `BLOCKED <reason>` / final `[HH:MM] LANE DONE`.
