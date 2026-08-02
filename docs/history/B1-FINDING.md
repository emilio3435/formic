# B1 finding: no backend CMUX enumeration gap

## Disposition

No server change is warranted. The reported "only one agent" view is a `src/web/`
rendering/presentation concern, not an agent-discovery or snapshot-serialization
loss.

## Evidence

- The supplied `GET /api/snapshot` observation already contains 128 nested
  `programs[].agents[]` records (105 Codex, 22 Claude, 1 Cursor), with
  `totals.tracked = 128` and `totals.live = 6`. That cannot be a response
  restricted to the primary CMUX session.
- Live CMUX discovery on 2026-07-30 returned 29 terminals, 28 with
  `runtime_surface_ready: true`, across two distinct CMUX window IDs and 26
  workspace IDs. The result includes non-primary workspaces (for example,
  `anthill-be-collectors-0728`, `anthill-be-identity2-0728`, and
  `anthill-w5-server-0728`).
- `collectCmux()` invokes that global `cmux rpc debug.terminals {}` call
  ([src/server/cmux.ts:250](src/server/cmux.ts#L250)) and passes its entire
  parsed result through ([src/server/cmux.ts:263](src/server/cmux.ts#L263)).
  `parseCmuxTerminals()` maps every terminal that has a `surface_id`; it does
  not select a window, workspace, pane, or primary session
  ([src/server/cmux.ts:210](src/server/cmux.ts#L210)). Workspace and pane IDs
  are retained per surface ([src/server/cmux.ts:229](src/server/cmux.ts#L229)).
- Session discovery is independent of CMUX and gathers all provider sources
  before CMUX enrichment ([src/server/collectors.ts:746](src/server/collectors.ts#L746)).
  During refresh, all provider values are flattened into `collectedAgents`
  ([src/server/state.ts:275](src/server/state.ts#L275)); CMUX does not filter
  that list.
- Identity bindings only attach a safe target to an existing agent; they return
  one mapped agent for every input agent and preserve unbound agents
  ([src/server/identity-bindings.ts:302](src/server/identity-bindings.ts#L302)).
  Target resolution deliberately quarantines ambiguous panes rather than
  dropping their agents ([src/server/targets.ts:124](src/server/targets.ts#L124)).
- Snapshot construction deduplicates only identical agent IDs by newest
  timestamp, then iterates every remaining source and pushes it into a program
  ([src/server/snapshot.ts:518](src/server/snapshot.ts#L518),
  [src/server/snapshot.ts:531](src/server/snapshot.ts#L531),
  [src/server/snapshot.ts:612](src/server/snapshot.ts#L612)). A missing or
  ambiguous CMUX target changes controls/metadata, not inclusion in
  `programs[].agents[]`.

## Scope and next owner

`src/server/` was left unchanged. The web lane should trace its consumption of
`snapshot.programs[*].agents` and any active-only, selected-program,
selected-workspace, or collapsed-card filtering that could reduce the visible
list to one card.

## Validation

- `bun test` — 580 passed, 0 failed (31 files).
- `bunx tsc --noEmit` — passed (exit 0).
