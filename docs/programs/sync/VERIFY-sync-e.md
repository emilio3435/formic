# VERIFY-sync-e

Adversarial read-only pass against `VERIFY-BRIEF-sync-e.md`. HEAD `ca8077d1b0df31d68319dd73d402dc3e8791b9fe`. Lane dirt uncommitted (expected). Live JSONL frames captured from this machine's `cmux events` into `.lane-evidence/live-cmux-frames.txt`. Parser probe in `.lane-evidence/parse-live-vs-fixture.txt`.

## 1. Fence

`git status --short` (before this file):

```text
 M ARCHITECTURE.md
 M src/server/cmux-sync.ts
 M src/server/cmux.ts
 M src/server/state.ts
 M tests/cmux.test.ts
?? VERIFY-BRIEF-sync-e.md
?? tests/cmux-sync.test.ts
```

Allowed set: `ARCHITECTURE.md`, `src/server/cmux-sync.ts`, `src/server/cmux.ts`, `src/server/state.ts`, `tests/cmux.test.ts`, `tests/cmux-sync.test.ts`, plus `LANE-REPORT-sync-e.md` (gitignored, present) and this brief/output. No extra modified files.

**PASS**

## 2. Frozen contract intact

`git show HEAD:src/server/cmux-sync.ts` vs working copy: `CmuxSyncEventName`, `CmuxSyncEvent`, `SyncHandler`, `registerSyncHandler(name, handler) → () => void` are byte-identical. `syncStreamHealthy()` still `(): boolean`; body now returns `streamHealthy` instead of stub `false` (implementation, not a shape change). Additions (`CmuxSyncSupervisor`, `parseCmuxSyncLine`, cursor store, …) only.

**PASS**

## 3. Trap #1 (window-scoped lists)

`src/server/cmux.ts` `workspace.list` / `workspace.group.list`:

- `workspace.group.list`: no call sites.
- `workspace.list`: one site, always `JSON.stringify({ window_id: windowId })` after `window.list`.
- Remaining `"{}"` RPCs: `debug.terminals` and `window.list` only — not the trap.

Pre-fix walk (HEAD): `extension.sidebar.snapshot '{"all_windows":true}'`. Multi-window test (`tests/cmux.test.ts` “enumerates every cmux window before collecting workspaces”) answers only `window.list` + `workspace.list` with `WINDOW-A`/`WINDOW-B`; any other method/params returns exit 1. Old walk would yield `value: []`, not `WORKSPACE-A`+`WORKSPACE-B`. Regression would fail.

**PASS**

## 4. Trap #4 (echo before dispatch)

`dispatchCmuxSyncEvent` (`src/server/cmux-sync.ts`):

```ts
if (isOwnEcho(event)) return;
for (const handler of syncHandlersFor(event.name)) {
```

Supervisor `#onFrame` is the only stream dispatch path and calls that function. Echo test records `notification.mark_read` then dispatches `notification.mark_read_requested`; handler count stays 0.

**PASS**

## 5. Trap #8 (gap distrust)

Code path: `gap` ack sets `streamHealthy=false`, `#recovery="gap"`, `#awaitingAck=true`, fires `recollect()`, drops subsequent events (`#onFrame` returns when awaiting ack / recovering / unhealthy). Exit sets `#recovery="reconnect"` and `syncStreamHealthy()===false`; second exit recollects. Gap test asserts `seen === []` for seq 12 on the gapped child, `recollects === 1`, unhealthy, then seq 41 only after a fresh non-gap ack.

**BLOCK.** Quarantine + recollect fire, but recovery cursor is wrong for live acks. `parseCmuxSyncLine` takes `latestSeq` from top-level `frame.latest_seq` only. Official contract (`docs/cli-contract.md`): resume metadata lives under `ack.resume` as `after_seq`/`oldest_seq`/`latest_seq`/`next_seq`/`gap`. Live gap ack (replay `--after 21242 --name workspace.closed`):

```json
"resume":{"after_seq":21242,"gap":true,"gap_reason":"requested sequence is older than the retained in-memory event log","latest_seq":25364,"next_seq":25365,"oldest_seq":21269,"requested_after_seq":21242}
```

No top-level `latest_seq`. `parseCmuxSyncLine(liveGapAck)` → `{"type":"ack","gap":true}` (no `latestSeq`). Same parser on the test fixture → `{"type":"ack","gap":true,"latestSeq":40}`. After a real buffer-roll gap the child reconnects with the stale `--after` cursor, which is the case kickoff named as the gap case, not an edge. The gap test’s `["cmux","events","--after","40"]` pin is an artifact of that invented field.

## 6. Cursor separation

- `DEFAULT_CMUX_SYNC_CURSOR_FILE` = `join(homedir(), ".anthill/cmux-sync.cursor")`.
- Spawn command: `[executable, "events", "--after", String(cursor)]` — no `--cursor-file`.
- `events.cursor` appears only in a comment. `FileCmuxSyncCursorStore` reads/writes the sync path only.
- `git diff --stat -- src/server/cmux-events.ts`: empty. File untouched.

**PASS**

## 7. Liveness

`/* SYNC-E */` in `state.ts` at the `registerSyncHandler("workspace.closed" | "surface.closed")` pair. `#applyCmuxClosedEvent` ends matching agents with `statusReason: "cmux-closed"` synchronously in dispatch; `origin === "workspace_teardown"` returns before mutate/publish. Tests: workspace close ends both bound agents and does not call `refresh`; teardown `surface.closed` leaves activity un-ended and `publications === 0`, then `workspace.closed` publishes once. Remaining `state.ts` diff is supervisor start/stop (production auto-start from `startCmuxEvents` when no injected child), snapshot totals/surfaces/pulse — needed for the liveness path.

Live `workspace.closed` / `surface.closed` frames put `workspace_id` / `surface_id` / `origin` inside `payload`, which the handler reads. Event side of liveness is not the ack-shape defect.

**PASS**

## 8. Hollow-test check

**Multi-window:** would fail if the collector stopped enumerating both windows or called the old sidebar RPC. Not hollow.

**Gap test / JSONL fixtures: BLOCK.** Brief: real `cmux events` ack carries `oldest_seq`/`latest_seq`/`resume`/`gap`; a hand-invented frame is fixtures-are-not-payloads.

Test helper (`tests/cmux-sync.test.ts`):

```ts
{ type: "ack", oldest_seq: Math.max(0, latestSeq - 4_000), latest_seq: latestSeq, resume: { after_seq: 0, gap } }
```

Live ack (and CLI contract): `oldest_seq`/`latest_seq`/`gap` are **inside `resume`**, not top-level. Event lines `{type,seq,name,payload}` do match live `workspace.closed` (subset). The gap test would **not** fail if `resume.latest_seq` parsing regressed, because the fixture never puts `latest_seq` there. That is the hollow pin.

Typed event fixtures are close enough to live payloads (`payload.workspace_id`, `payload.origin: "workspace_teardown"`). The ack shape is not.

## 9. Floor

```text
$ bunx tsc --noEmit
(no stdout or stderr)
exit 0
```

```text
$ bun test tests/cmux-sync.test.ts tests/cmux.test.ts tests/cmux-events.test.ts tests/reference-docs.test.ts
 136 pass
 0 fail
 822 expect() calls
Ran 136 tests across 4 files. [148.00ms]
```

Focused set green. Green does not rescue check 8: the gap test is green *because* the ack fixture is not the live frame.

**PASS** (this check only)

VERDICT: BLOCK — Trap #8 gap-ack cursor ignores live `resume.latest_seq`; hollow-test ack fixture invents top-level `oldest_seq`/`latest_seq` (fixtures-are-not-payloads)
