# VERIFY — SYNC-NB (reopen 2)

Read-only re-attack of the three prior failures against current dirt. Checks 4, 6, 9 only.

## Check 4 — Anchors + windows

**PASS.**

`NotificationListRunner` now emits two distinct anchors:

- WINDOW-1 → `WORKSPACE-ANCHOR-WINDOW-1` / `NOTICE-ANCHOR-WINDOW-1`
- WINDOW-2 → `WORKSPACE-ANCHOR-WINDOW-2` / `NOTICE-ANCHOR-WINDOW-2`

`collectCmuxNotificationSummaries` unions per-window `workspace.group.list {window_id}` into one Set and filters `notification.workspaceId`. The expected snapshot is exactly `NOTICE-UNREAD` and `NOTICE-READ`.

Keeping only WINDOW-1’s anchors would leave `WORKSPACE-ANCHOR-WINDOW-2` out of the Set, so `NOTICE-ANCHOR-WINDOW-2` would survive the filter and the exact equality would go red. A missing `window_id` (caller-window trap) would take the WINDOW-2 branch only and leak `NOTICE-ANCHOR-WINDOW-1` the other way. The fixture fails both single-window walks.

## Check 6 — Fingerprint honesty

**PASS.**

`alertFingerprintFor` pairs semantic state (`hookLifecycle` + `attentionSignal.kind` or outcome/status) with `alertBoundary` = `lastHumanFacingAt ?? startedAt ?? "unclocked"`. `hookLifecycleAt` and `updatedAt` appear only in comments; they are not interpolated.

`lastHumanFacingAt` is a transcript-turn clock, not a hook-record clock:

- Codex (the route fixture) updates it in `recordHumanMessage` from JSONL `event_msg` / `response_item` timestamps (`createCodexParser`), then `makeAgent({ lastHumanFacingAt: messages.lastHumanFacingAt })`.
- `attachHookFacts` copies hook `updatedAt` onto `hookLifecycleAt` only. It does not write `lastHumanFacingAt`.
- `finalizeSessionProviders` reads `join(home, ".cmuxterm")` and runs `attachHookFacts` on every provider result. `collectSessions(home, …)` is that pipeline.

The PUT/DELETE test drives that path for real: temp `home/.codex/sessions/ack-agent.jsonl` + `home/.cmuxterm/codex-hook-sessions.json`, `collectors.sessions = collectSessions(home, …)`. First PUT fingerprint is `hook:needsInput:question-pending:2026-08-13T09:59:00.000Z` — the assistant turn timestamp, not the hook write time. Advancing **only** hook `updatedAt` republishes `hookLifecycleAt` as `2026-08-13T10:10:00.000Z` (proof `attachHookFacts` ran) while the Ack stays. Appending a new user + assistant turn then drops the Ack from the produced snapshot with no DELETE. Quiet `idle` → 409.

Heartbeat therefore cannot revoke via the clocks this lane fingerprints. A genuine new human-facing turn can.

## Check 9 — Floor

**PASS.**

```text
$ bunx tsc --noEmit
[no stdout or stderr]
exit 0
```

```text
$ bun test tests/cmux-notifications.test.ts tests/cmux-sync.test.ts tests/cmux.test.ts tests/reference-docs.test.ts
bun test v1.3.14 (0d9b296a)

tests/cmux-notifications.test.ts:
(pass) SYNC-NB notification ingest > notification.list maps the frozen snapshot summaries and drops group anchors across every window
(pass) SYNC-NB notification ingest > notification created/read/removed in one tick trigger one targeted re-list and no session recollect
(pass) SYNC-NB notification verbs > mark_read and dismiss emit exactly {id}, pin no all variant, and record exact echo fingerprints
(pass) SYNC-NB notification verbs > RPC refusal at exit zero and non-zero process failure stay typed failures and never mint echoes
(pass) POST /api/sync/notifications > routes only exact mark_read/dismiss requests through the funnel under the same-origin gate
(pass) SYNC-NB alert fingerprints and Ack store > fingerprints use semantic alert state and a human-facing transition boundary, never hook write clocks
(pass) SYNC-NB alert fingerprints and Ack store > JsonAckStore persists the frozen AgentAck shape and explicit delete
(pass) PUT/DELETE /api/sync/ack/:agentId > real hook heartbeats preserve Ack, a fresh human-facing alert self-revokes, DELETE unacks, and quiet agents are 409

 140 pass
 0 fail
 855 expect() calls
Ran 140 tests across 4 files. [225.00ms]
```

VERDICT: PASS
