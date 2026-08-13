# VERIFY — SYNC-NB

Adversarial read-only pass against `VERIFY-BRIEF-sync-nb.md`. Base `656f2a9f4b07ec45d1df39eccea2b993a56e6518` (`git merge-base HEAD feat/sync-integration`). Dirt only; no commit/push/revert.

## Check 1 — Fence

**PASS (shapes + file set). No close/rename bleed in the scrutinized diffs.**

Changed vs merge-base (plus gitignored `LANE-REPORT-sync-nb.md`):

- `ARCHITECTURE.md` (one `ack.ts` row)
- `src/shared/types.ts` (HubSnapshot `cmuxNotifications` / `acks` only)
- `src/server/{ack,app,cmux-actions,cmux,index,snapshot,state}.ts`
- `tests/cmux-notifications.test.ts`

That is the report §3 list. `VERIFY-BRIEF-sync-nb.md` is the master’s spawn file, not lane work.

Frozen `AgentAck` / `CmuxNotificationSummary` at merge-base are byte-identical to the working tree (exact keys `agentId, ackedAt, alertFingerprint` and `id, workspaceId, surfaceId, title, subtitle, body, isRead, createdAt`). New snapshot fields are the allowed addition.

`snapshot.ts`: copies the two input arrays onto the snapshot. `index.ts`: opens `data/acks.json` and injects the store. `state.ts`: collector wiring, same-tick debounce re-list, three event registrations, post-classify `reconcile`. No close/rename verbs, no group-anchor mutation, no UI/settings.

## Check 2 — Param vocabularies (trap #3)

**PASS.**

`runNotificationAction` issues only `{ id }` for `notification.mark_read` and `notification.dismiss`. Tests pin `Object.keys` to `["id"]` and forbid `notification_id` / `tab_id` / `all` / `all_read`. Wrong-key mock returns `invalid_params`.

`notification.create*` does not appear in src changes. Hits for `notification.created` are the required event name; `notification_id` appears only as a **parse fallback** on `notification.list` bodies, never as an issued RPC key.

## Check 3 — Redaction (trap #3b)

**PASS.**

Ingest bodies come from `notification.list` (`collectCmuxNotificationSummaries`). Event handlers ignore payload and call `#queueNotificationRelist` (microtask debounce). Burst test: three `created/read/removed` in one tick → **one** `syncNotifications` call, `sessionCollections === 0`. A later isolated event makes a second list. No session recollect.

## Check 4 — Anchors (trap #6) + windows (trap #1)

**FAIL the required fixture.** Implementation walks `window.list` then `workspace.group.list {window_id}` per window and unions anchors; tests pin both `window_id`s. But the only anchor (`WORKSPACE-ANCHOR` / `NOTICE-ANCHOR`) lives on **WINDOW-1**. WINDOW-2 returns empty groups.

A filter that issued both RPCs and then kept only WINDOW-1’s anchors would still drop `NOTICE-ANCHOR`. The brief required a second-window anchor that a single-window (or first-window) walk would leak. That fixture is not here.

## Check 5 — Ack semantics (trap #9)

**PASS as mechanics; the fingerprint those mechanics consume is check 6.**

- PUT stores frozen `{agentId, ackedAt, alertFingerprint}`.
- Unchanged fingerprint retained across refresh; a changed fingerprint is gone from the **produced snapshot** on that same `refresh` with no DELETE route call.
- Explicit DELETE unacks.
- Non-alerting agent → 409 `AGENT_NOT_ALERTING`.
- `ack.ts` writes only `data/acks.json` (atomic tmp+rename). No cmux import, no agent-state mutation. Routes call `ackStore` then `state.refresh()` (collect/publish), never `cmux-actions` notification/close/rename verbs.

## Check 6 — Fingerprint judgment honesty

**BLOCK.**

Report §3: hook-declared input → `hookLifecycle + hookLifecycleAt`; prose → `attentionSignal.kind + lastHumanFacingAt`; `updatedAt` only when the source clock is absent; heartbeat churn cannot revoke.

That claim is false on the hook path — the path PUT actually uses for a waiting agent.

`collectors.ts` `attachHookFacts` sets `hookLifecycleAt` from the hook record’s **`updatedAt`** (unix write time). `AgentSnapshot` documents the field as “When the hook store recorded hookLifecycle.” Live measurement `docs/S0-T1-DEAD-TIME-MEASUREMENT.md` (same session, stayed `needsInput` + `processAlive`):

| Pass | `hookLifecycleAt` |
|---|---|
| 1 | `2026-08-06T01:38:51.896Z` |
| 2 | `2026-08-06T01:39:16.199Z` |
| 3 | `2026-08-06T01:40:41.667Z` |

It is a heartbeat/write clock. `alertFingerprintFor` still does `hook:${hookLifecycle}:${hookLifecycleAt}`. `reconcile` drops any ack whose fingerprint no longer matches. Ordinary hook-store writes therefore **revoke an Ack with no new alert**. `stalled-active` uses the same clock (`hookLifecycleAt ?? updatedAt`).

The lane avoided the agent’s `updatedAt` field and substituted the hook store’s `updatedAt` under another name. That is the brief’s example: updatedAt used when they claim a source clock exists.

Tests hide it (fixtures-are-not-payloads):

- Unit test hand-authors `AgentSnapshot`, freezes `hookLifecycleAt`, then advances **agent** `updatedAt` (not in the fingerprint while `hookLifecycleAt` is present). Green against a field production does not use.
- HTTP test does run `HubState.refresh` → `buildSnapshot`, but injects a literal `CollectedAgent.hookLifecycleAt` and never `attachHookFacts`. “Heartbeat” in that test is again agent `updatedAt`. When they want a revoke they **manually** move `hookLifecycleAt` — which is what a live hook write already does.

No test drives a produced snapshot through hook-record `updatedAt` advancing while `needsInput` holds.

## Check 7 — Failure honesty (trap #2)

**PASS.**

Exit-zero `{ error: { code, message } }`, exit-zero string `invalid_state: …`, and non-zero process failure all return `{ok:false, code, detail}` and do not call `recordIssuedAction`. Echo pins stay false.

## Check 8 — Route gate

**PASS on code.** Both `/api/sync/notifications` and `/api/sync/ack/:agentId` call `sameOriginLoopback` before JSON parse / store write / funnel. Notifications test: foreign Origin → 403 and no third cmux RPC. Ack foreign Origin is implemented the same way (untested). Missing `Origin` is not equal to `url.origin` → reject.

## Check 9 — Floor

**PASS (prescribed commands green).**

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
(pass) SYNC-NB alert fingerprints and Ack store > fingerprints use the current alert state and its own since timestamp, not heartbeat churn
(pass) SYNC-NB alert fingerprints and Ack store > JsonAckStore persists the frozen AgentAck shape and explicit delete
(pass) PUT/DELETE /api/sync/ack/:agentId > unchanged alerts stay acked, a fresh alert self-revokes in that snapshot pass, DELETE unacks, and quiet agents are 409

 140 pass
 0 fail
 853 expect() calls
Ran 140 tests across 4 files. [174.00ms]
```

Green tests do not save check 6: they never feed the write clock that production puts in the fingerprint.

## Summary

Ingest, verbs, redaction debounce, Ack store shape, origin gate, and the prescribed floor are real. The locked Ack decision is not: self-revoke is wired to a field this repo already measured as heartbeat. Report §3’s “heartbeat cannot revoke” is the opposite of S0-T1 plus `attachHookFacts`.

VERDICT: BLOCK — hookLifecycleAt is a measured hook write/heartbeat clock (S0-T1); Ack fingerprints it, so ordinary refresh revokes; tests freeze that clock by hand instead of driving attachHookFacts; ingest fixture puts the only anchor on WINDOW-1
