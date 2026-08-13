# TINT-S · Two-way color sync — cmux ⇄ board

You are the TINT-S sub-orchestrator (Opus 5 high). Read `00-MASTER-PLAN.md` first; contract §1, authority rules §2, and your fence §3 override anything here. A swarm of one — you doing the work yourself — is a legitimate size for this lane.

**Mission (2 sentences):** Make the board *read* cmux workspace colors, not just write them: ingest `custom_color` from `workspace.list`, surface it for unmapped workspaces, and re-assert board authority over repo-mapped ones — without ever entering a write loop. The funnel's `lastWrittenHex` is your echo suppressor; every write you make goes through the funnel, never a direct shell call.

## Goal

`src/server/cmux-color-sync.ts` reconciles cmux `custom_color` against `RepoColorsSettings.assignments` on each cmux collector pass, per authority rules: unmapped → ingest/display, repo-mapped drift → re-assert through the funnel, echo → ignore.

## Success means

- `src/server/cmux.ts` workspace collection carries `custom_color` (nullable) into the collected shape — the only change you make to that file, minimal and pattern-matching.
- Reconcile pass (piggybacked on the existing collector poll — no new timer, locked decision 3): for each workspace, exactly one of: **ignore** (color matches assignment, or matches `lastWrittenHex`, or `syncFromCmux` false), **ingest** (unmapped: expose in the `workspaces` map of `GET /api/repo-colors` — read side only; you don't own the route, consume F's shape), **re-assert** (repo-mapped drift: `setWorkspaceColor(id, assignedHex, "sync-reassert")`).
- Loop-proof by test: a re-assert followed by the next poll observing its own write produces zero further writes (echo suppression); a genuinely re-drifted color (user edits again between polls) is re-asserted again — assert both directions.
- Shared-workspace rule 4 applied via whatever agent→workspace mapping the collector already exposes; deterministic tie-break, tested.
- Failure honesty: a funnel write that fails logs and reports failure; sync never marks a workspace reconciled on a failed write.
- Floor green in your worktree: `bunx tsc --noEmit` → 0; `bun test` → green (tolerated red: `docs/a11y-geometry-gate` only). Your reconcile tests run against fixture data, not a live cmux.

## Stop when

Floor green, `LANE-REPORT-tint-s.md` §4 holds pasted floor output, committed locally on `feat/tint-s`, nothing pushed. Tell the master.

## Fence

Own: `src/server/cmux-color-sync.ts` (create) · minimal `custom_color` read in `src/server/cmux.ts` · one `/* TINT-S */` registration line · your tests.
Never touch: `src/web/**`, funnel internals (consume only), `cmux-groups.ts`, `settings.ts` beyond reading.

## Consumes / produces

- Consumes: contract stub; F's funnel signatures (stub in tests until F's first commit reaches you at integration; your code paths must call the real funnel).
- Produces: reconcile pass invoked from the collector cycle; ingested unmapped colors available server-side for F's `GET /api/repo-colors` `workspaces` map.

## Traps that fail silently

- Echo suppression keyed on anything but the funnel's `lastWrittenHex` (e.g. your own local cache) desyncs after restart and re-fights the user once per process lifetime — test the restart case: fresh process, cmux color = assignment → ignore, not re-assert.
- cmux hex case: normalize before comparing (`#2E66A8` vs `#2e66a8` must not read as drift and re-assert forever — that IS the write loop, arriving dressed as a string bug).
- `workspace.list` is per-window — enumerate windows (`window.list`) or use whatever the collector already does for full coverage; testing with one window hides the gap.
- An absent `custom_color` is "no color", not black, not drift.
