# SYNC-E · Event foundation (BE · Sol xhigh via Codex)

**Mission:** Implement `src/server/cmux-sync.ts` — the long-lived cmux event subscription with seq cursor, gap-safe recollect, and the `registerSyncHandler` seam — plus the multi-window collector fix and instant live→ended liveness. You are serial-first: every other lane builds on your seams, so you land alone and first.

**Files:** Implement `src/server/cmux-sync.ts` (stub is committed; shapes frozen — bodies only). Modify `src/server/cmux.ts` (multi-window walks) and `src/server/state.ts` (one `/* SYNC-E */` registration + liveness handlers). Create `tests/cmux-sync.test.ts`. ARCHITECTURE.md: your module's row.

**Consumes:** contract stub. **Produces (frozen, others rely on):** `registerSyncHandler(name, handler) → unregister`, `syncStreamHealthy()`, `CmuxSyncEvent` dispatch with `isOwnEcho`-filtered events, liveness flips with reason `cmux-closed`.

## Tasks

### Task 1: subscription + cursor
- [ ] Failing test: a fixture event line stream (JSONL, the real `cmux events` shapes from the spec's Probe Evidence — ack line, then `{"type":"event","name":"workspace.closed",...}`) dispatches to a registered handler exactly once, in seq order.
- [ ] Implement: spawn `cmux events --after <cursor>` (CommandRunner-injected for tests), parse lines, track `seq`, dispatch. Handler throw must not kill the stream (log, continue) — fire-and-forget like the TINT-G tick.
- [ ] Test passes; commit-or-stage.

### Task 2: gap + reconnect safety
- [ ] Failing tests: (a) ack with `gap: true` → a single injected `recollect()` callback fires and NO patch handlers run for replayed events until a fresh ack; (b) stream process exit → reconnect with `--after <cursor>`, and a second exit within the backoff window escalates to recollect; (c) `syncStreamHealthy()` is false in both states, true after recovery.
- [ ] Implement; tests pass.

### Task 3: multi-window collector fix
- [ ] Failing test: a fixture with two windows, workspaces split across them → collection output contains ALL workspaces (this is TINT-S's measured 10/15 bug; the fixture must fail against the current single-window walk before your fix).
- [ ] Implement: every `workspace.list`/`workspace.group.list` call site in `src/server/cmux.ts` enumerates `window.list`. Keep the diff minimal — same pattern TINT-S used for its own group.list pairing.
- [ ] Tests pass; run the FULL floor here (this touches every collector consumer).

### Task 4: instant liveness
- [ ] Failing tests: `workspace.closed` event → every agent with that `target.workspaceId` flips live→ended with reason `cmux-closed` within the same dispatch (no poll); `surface.closed` (not workspace_teardown origin) flips only agents bound to that surface; a teardown-origin surface.closed does not double-fire ended (workspace.closed covers it).
- [ ] Implement as registered handlers in `state.ts` (`/* SYNC-E */` block); tests pass.

### Task 5: report + floor
- [ ] Full floor, output pasted in report §4. Definition of Done: all above green, report complete, work committed or staged-with-report.

**Traps for you specifically:** ground rules #1 (you are FIXING this trap — your fixture must reproduce it first), #4 (dispatch AFTER `isOwnEcho` filter — the funnel skeleton's fingerprint store is already in the stub), #8. The event stream buffers ~4k events; your `--after` cursor persistence must tolerate the board restarting after the buffer rolled (that IS the gap case, not an edge case).

**Master addendum (2026-08-13, pre-spawn):** `src/server/cmux-events.ts` ALREADY EXISTS on main — a coarse poll accelerator supervising `cmux events --cursor-file ~/.anthill/events.cursor --reconnect --category agent --category workspace` that requests refreshes; `state.ts` imports it. Your `cmux-sync.ts` is the TYPED dispatch router and must coexist: use your own cursor persistence (never `~/.anthill/events.cursor`), and decide reuse-one-child vs parallel-child deliberately — state the choice and why in report §3. Do not break the existing supervisor or its test (`tests/cmux-events.test.ts`).
