# VERIFY-sync-rb

Adversarial, read-only. Base = `656f2a9f4b07ec45d1df39eccea2b993a56e6518` (`git merge-base HEAD feat/sync-integration`). Work is staged, uncommitted. Tried to block on each check.

## 1. Fence + master ruling

Diff vs merge-base (staged, no unstaged source):

```
M	src/server/app.ts
M	src/server/cmux-actions.ts
M	src/server/cmux-sync.ts
M	src/server/state.ts
A	tests/cmux-rename.test.ts
```

`LANE-REPORT-sync-rb.md` exists at the worktree root (gitignored; allowed). No other production/test paths changed. `VERIFY-BRIEF-sync-rb.md` is verifier input, not lane work.

- `cmux-actions.ts`: `closeSurface` / `closeWorkspace` / `markNotificationRead` / `dismissNotification` remain `unimplemented(...)` stubs. Only `renameWorkspace` was filled. Shared runner/lookup helpers exist because this is the first live verb; they do not implement close/notify.
- `app.ts`: the only new route is `POST /api/sync/rename` inside the marked SYNC block. Close/notify routes were not added. The extra `configureCmuxActions({ runner, executable })` at `createMountainFetch` start is runner injection for that route (partial `Object.assign`; does not reset `resolveWorkspace`). Not a second SYNC verb.
- `state.ts`: one `registerSyncHandler("workspace.renamed", ...)` plus `#applyCmuxRenamedEvent`.
- `cmux-sync.ts`: the one master-ruled line `if (isOwnEcho(event) && event.name !== "workspace.renamed") return;` plus the comment that names the exception. Nothing else.

**PASS**

## 2. The seam exception is safe

Attacked `if (isOwnEcho(event) && event.name !== "workspace.renamed") return;`.

**(a) Only registered handler is state-only.** Production `registerSyncHandler("workspace.renamed", ...)` appears once, in `HubState.startCmuxSync`. `#applyCmuxRenamedEvent` reads `payload` / `params` / `result` / `result.workspace`, patches `#surfaces[].workspaceTitle` and `agent.target.workspaceTitle`, notifies snapshot listeners. It does not import `cmux-actions`, does not call `renameWorkspace`, does not run a `CommandRunner`. `recollect` in the rename tests throws; those tests still pass, so the handler does not poll.

**(b) Adversarial pair counts issued commands.** `ours then a rapid foreign rename converges to the foreign title with one write total` uses `recordingRunner()`: every `runner.run(command)` pushes the argv. After `renameWorkspace("Our title")` + own echo + foreign `"Human wins"`, titles are `["Human wins","Human wins"]` and `calls` has length 1. That is the command log, not a `renameWorkspace` call counter. Lookup is injected, so the one entry is the mutation. The handler has no second runner path (2a), so an un-instrumented `HubState` runner cannot hide a write.

**(c) E's echo tests unmodified and green.** `git diff $(git merge-base HEAD feat/sync-integration) -- tests/cmux-sync.test.ts` is empty. `filters this process's action echo before registered handlers see it` still registers `notification.mark_read_requested`, records `notification.mark_read {id: NOTICE-1}`, dispatches the echo, and asserts `dispatched === 0`. Ran in the floor below; passed. The rename exception is name-gated; notification echoes stay filtered.

**PASS**

## 3. Title asymmetry pinned (rename-war rule)

The kickoff-required pair test exists and is executable, not prose: foreign title wins and `calls` stays at 1 after the foreign event. Production write sites for `renameWorkspace` are only `POST /api/sync/rename` (explicit board action) and the tests. No poll/recollect/color-style re-assert path was added. Collector reads remain cmux-authoritative; they are not writes.

**PASS**

## 4. Trap #4 normalize/trim

- `a trim-identical title is a successful no-op with no cmux call`: `"  Old title  "` → `{ok:true}` and `expect(calls).toEqual([])`.
- `rejects an empty title before any cmux call`: `" \n\t "` → `{ok:false, code:"invalid_title"}` and `calls` empty.

Both assert the recording runner's issued argv, not merely `ok`. Funnel trims before compare (`workspace.title?.trim() === normalizedTitle`) and returns before `runCmux`.

**PASS**

## 5. Anchors (trap #6) + window-scoped lists (trap #1)

- Injected anchor: `{ok:false, code:"anchor"}`, `calls` empty.
- Production: `resolveWorkspaceFromCmux` runs `window.list {}`, then per window `workspace.list {window_id}` and `workspace.group.list {window_id}`. Anchor on `WINDOW-2` → `{ok:false, code:"anchor"}` and no `workspace.rename` in `calls`.
- Grep of production rename path: every `workspace.group.list` / `workspace.list` carries `window_id`. No unscoped `workspace.group.list {}`.
- Route maps `anchor` to 409, not 404; route test asserts no mutation.

**PASS**

## 6. Failure honesty (trap #2)

`cmux refusal is typed and never records a fingerprint` feeds exit 0 + stderr `Error: invalid_state: workspace cannot be renamed` → `{ok:false, code:"invalid_state", detail:"workspace cannot be renamed"}`, then `isOwnEcho(...) === false`.

`recordIssuedAction` runs only after `commandFailure` is empty. `commandFailure` treats missing binary, timeout, non-zero exit, non-empty stderr, and JSON `error` as failure. Non-zero is the same early-return (not a second test); not uncertain.

**PASS**

## 7. Route

- `sameOriginLoopback`: loopback host and `Origin === url.origin`. Foreign `http://evil.example` → 403 `ORIGIN_REJECTED`, `calls` empty.
- Request shape: body must contain only string `workspaceId` + string `title` (extra keys rejected). Matches contract `{workspaceId, title}`.
- 404 only when the funnel returns `code:"not_found"`. That is `resolveWorkspace(...) === undefined`. Production `resolveWorkspaceFromCmux` returns `{error}` on `window.list` / per-window list / parse failure, `{anchor:true}` for anchors, and `undefined` only after a successful walk finds no id. Lookup failure therefore maps to 502/503/409, not 404. Route test: injected `undefined` → 404 and no `workspace.rename`.

**PASS**

## 8. Exact params

`trims the title, issues workspace.rename with exact params, and records its echo` pins argv:

```
["/fake/cmux", "rpc", "workspace.rename",
  JSON.stringify({ workspace_id: "WORKSPACE-1", title: "New title" })]
```

Keys are `workspace_id` and `title` (TINT-style pin). Leading/trailing title whitespace is stripped before the RPC. Fingerprint uses the same params.

**PASS**

## 9. Floor

```text
$ bunx tsc --noEmit
(exit 0; no stdout)
```

```text
$ bun test tests/cmux-rename.test.ts tests/cmux-sync.test.ts tests/cmux.test.ts tests/reference-docs.test.ts
bun test v1.3.14 (0d9b296a)

tests/cmux-rename.test.ts:
(pass) renameWorkspace — explicit writes only > trims the title, issues workspace.rename with exact params, and records its echo [0.51ms]
(pass) renameWorkspace — explicit writes only > rejects an empty title before any cmux call [0.04ms]
(pass) renameWorkspace — explicit writes only > a trim-identical title is a successful no-op with no cmux call [0.07ms]
(pass) renameWorkspace — explicit writes only > a group-anchor workspace is refused before any mutation [0.09ms]
(pass) renameWorkspace — explicit writes only > the production anchor check enumerates windows and reads each window's group list [0.54ms]
(pass) renameWorkspace — explicit writes only > cmux refusal is typed and never records a fingerprint [0.24ms]
(pass) workspace.renamed — cmux truth wins in the same dispatch > a foreign event patches every bound agent without a poll [12.72ms]
(pass) workspace.renamed — cmux truth wins in the same dispatch > this process's echo still patches state and never issues a second write [1.88ms]
(pass) workspace.renamed — cmux truth wins in the same dispatch > ours then a rapid foreign rename converges to the foreign title with one write total [1.32ms]
(pass) POST /api/sync/rename > rejects cross-origin before issuing a cmux call [1.82ms]
(pass) POST /api/sync/rename > returns 404 for an unknown workspace and never calls workspace.rename [0.24ms]
(pass) POST /api/sync/rename > returns anchor for a group header and issues no cmux mutation [0.12ms]
(pass) POST /api/sync/rename > returns the funnel result for a valid same-origin rename [0.09ms]

tests/cmux-sync.test.ts:
(pass) cmux typed sync stream > parses every cursor field from the live nested ack resume shape [0.17ms]
(pass) cmux typed sync stream > dispatches JSONL events once in seq order and a throwing handler cannot kill the stream [0.96ms]
(pass) cmux typed sync stream > filters this process's action echo before registered handlers see it [0.05ms]
(pass) cmux typed sync stream > a gap recollects once, drops replay patches, and resumes only after a fresh ack [0.46ms]
(pass) cmux typed sync stream > an exit reconnects after the cursor and a second pre-recovery exit recollects [0.49ms]
(pass) cmux close events update HubState in the same dispatch > workspace.closed ends every bound agent with reason cmux-closed without a poll [2.78ms]
(pass) cmux close events update HubState in the same dispatch > surface.closed ends only its bound agent [2.99ms]
(pass) cmux close events update HubState in the same dispatch > workspace teardown surface events do not double-fire before workspace.closed [1.89ms]

 145 pass
 0 fail
 823 expect() calls
Ran 145 tests across 4 files. [231.00ms]
```

(`tests/cmux.test.ts` and `tests/reference-docs.test.ts` also all passed in that run; names omitted here only for length. Full paste is in `.lane-evidence/verify-floor.txt` plus the command output above: 145/0.)

**PASS**

## Residual (not a block)

`#applyCmuxRenamedEvent` falls back to payload key `id` after `workspace_id` / `workspaceId`. The closed-event handler does not. Probe shape is `method`+`params`+`result`; tests use `params.workspace_id`. A top-level non-workspace `id` on a live envelope could steal the id before params are read. Not in the brief's fail set; live payload was not re-probed here.

VERDICT: PASS
