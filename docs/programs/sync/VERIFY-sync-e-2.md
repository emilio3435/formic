# VERIFY-sync-e-2

Re-verify of the two prior BLOCKs plus checks 4, 6, and 9. Read-only against current dirt. Truth source: `.lane-evidence/live-cmux-frames.txt` (unchanged capture). Parser probe: `.lane-evidence/parse-live-gap-ack-2.txt`.

## 4. Trap #4 (echo before dispatch) — re-grep

`dispatchCmuxSyncEvent` still filters before any handler:

```ts
if (isOwnEcho(event)) return;
for (const handler of syncHandlersFor(event.name)) {
```

`#onFrame` is still the only stream dispatch path and still calls `dispatchCmuxSyncEvent`. Unchanged.

**PASS**

## 5. Trap #8 (gap distrust)

Gap ack: `streamHealthy=false`, `#recovery="gap"`, `#awaitingAck=true`, `recollect()`, events dropped. `#onAck` now advances the cursor from `frame.resume.latestSeq` (not top-level `latest_seq`). Reconnect: first exit sets `#recovery="reconnect"` and unhealthy; second exit recollects; both states `syncStreamHealthy()===false`.

Gap test asserts `seen === []` for replayed seq 12, `recollects === 1`, unhealthy, then reconnect `["cmux","events","--after","40"]` — 40 is `resume.latest_seq` from `ack(true, 40)` — then seq 41 only after a fresh non-gap ack.

Live gap ack from `.lane-evidence/live-cmux-frames.txt` (`workspace.closed` replay, `resume.gap: true`, `resume.latest_seq: 25364`) now parses as:

```json
{"type":"ack","resume":{"afterSeq":21242,"gap":true,"latestSeq":25364,"nextSeq":25365,"oldestSeq":21269}}
```

That is the resume cursor the prior BLOCK said was missing. Same parser accepts the live non-gap ack (`after_seq: null` → `afterSeq: null`, `latestSeq: 25360`).

LANE-REPORT §2 records the red-first run: nested live-shaped fixture against the old top-level parser expected `--after 40`, got `--after 0`.

**PASS**

## 6. Cursor separation — re-grep

- `DEFAULT_CMUX_SYNC_CURSOR_FILE` still `~/.anthill/cmux-sync.cursor`.
- Spawn still `[executable, "events", "--after", String(cursor)]`.
- `events.cursor` still comment-only in `cmux-sync.ts`.
- `git diff --stat -- src/server/cmux-events.ts`: empty (`STAT_LINES=0`). File untouched.

**PASS**

## 8. Hollow-test check

**Gap test:** fixture ack is now the live nested resume shape (`after_seq` / `gap` / `latest_seq` / `next_seq` / `oldest_seq` under `resume`; `after_seq` is `null` when healthy, numeric when gapped). Feeding the captured live gap JSONL through `parseCmuxSyncLine` yields `latestSeq: 25364`. If the parser regressed to top-level `latest_seq`, this live ack has none, `#onAck` would not advance, and the gap test’s `--after 40` pin would fail (LANE-REPORT §2 already showed that red). Replay seq 12 still must not dispatch. Not hollow.

**Multi-window:** still answers only `window.list` + per-window `workspace.list`; any other RPC (including HEAD’s `extension.sidebar.snapshot {"all_windows":true}`) returns exit 1, so `WORKSPACE-A`+`WORKSPACE-B` would fail. Not hollow.

Typed event fixtures remain `{type,seq,name,payload}` — a subset of the live event lines in the same capture; the parser reads those keys and the live `workspace.closed` / `surface.closed` frames parse.

**PASS**

## 9. Floor

```text
$ bunx tsc --noEmit
(no stdout or stderr)
exit 0
```

```text
$ bun test tests/cmux-sync.test.ts tests/cmux.test.ts tests/cmux-events.test.ts tests/reference-docs.test.ts
 137 pass
 0 fail
 823 expect() calls
Ran 137 tests across 4 files. [129.00ms]
```

**PASS**

VERDICT: PASS
