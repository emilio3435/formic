# VERIFY · SYNC-NF (adversarial, read-only)

Subject: `3d4b9ae` `feat(sync-nf): cmux notification badges, clear verbs, board-local Ack`
Tree after mutations: restored; `src/web/app.js` and `src/web/styles.css` byte-match the committed copies. No commit/push/revert.

## 1. Fence — PASS

`git show --name-only 3d4b9ae` is exactly:

- `src/web/app.js` (+370 / −7)
- `src/web/styles.css` (+75)
- `tests/sync-notifications-board.test.ts` (+608)

No server files. No `client-state.js`. `notification-center.js` is untouched.

Dropdown change is one appended section in existing furniture: `renderCmuxNotifySection` builds `.notify-sect` / `.notify-eyebrow` and `renderNotificationCenter` does `panel.append(terminalNotifications)` after investigations. No panel geometry rewrite, no new center, no mockup adjudication.

## 2. Locked decision 3 (one-fixture test) — PASS

THE test is `LOCKED DECISION 3 — clearing the badge does not take an alerting row out of Needs you` in `tests/sync-notifications-board.test.ts`. One fixture pair (`withUnread` / `cleared`, same still-alerting agent): badge present then gone, and `needsYouStrip(...)` still contains the row.

That is the live membership path, not a parallel stub: `needsYouStrip` → `stripAlerting` → `alerting(agent) && !ackedAgent(...)`. `alerting` is the `agent-model.js` export. Badge path is `cmuxBadgeNode` → `agentUnreadCmux` → `unreadCmuxByWorkspace` (`note.isRead` skipped). Clearing a notification does not ack and does not change `alerting()`.

Re-applied mutations on the shipped source, then restored:

```
M1 stripAlerting ignores acks (`return alerting(agent)`)
  16 pass  3 fail
  (fail) Ack PUTs … the acked agent then leaves the strip while its row stays
  (fail) a server-side self-revoke returns the row to the strip with no client bookkeeping
  (fail) an ack for another agent never hides this one

M2 badge counts read notifications too (`if (!note) continue`)
  15 pass  4 fail
  (fail) a row whose workspace has unread notifications carries a quiet count badge  (got "3" not "2")
  (fail) LOCKED DECISION 3 — …  (cleared isRead:true still drew a badge)
  (fail) unread terminal notifications get an entry with both clear verbs  (2 rows, not 1)
  (fail) the panel signature carries the unread set …
```

M1/M2 counts match the lane report. M2's four names are the real tests that went red (report shorthand said "no-badge · row sig"; the no-badge claim is the LD3 after-assertion, and the fourth red is panel-sig not row-sig). The tests are not hollow.

## 3. Ack semantics (trap #9) — PASS

Visible mark is `acked ·`. Copy is operator judgment: `"You acknowledged this alert… The agent is still waiting — nothing about its state changed."` Forbidden agent-completion words (`finished` / `done` / `resolved` / `completed`) are asserted absent. `.acked-mark` and `.cmux-badge` take `var(--muted)`; neither rule contains a status token.

No client ack store that survives a snapshot refresh:

- `ackedIds` / `ackedAgent` read `snap.acks` only (`Array.isArray` else empty).
- `ackCache` is a `WeakMap` keyed on the snap object. `applySnapshot` replaces `state.snap`; `applySnapshotDelta` returns a new `{ ...delta.snapshot, programs }` object — cache cannot outlive a refresh.
- `syncPending` is in-flight disablement, not an ack record. No `localStorage` acks, no `state.acks`.
- Self-revoke test: `acks: [ack]` → strip empty; `acks: []` → row returns and `.acked-mark` is gone. No expiry timer, no fingerprint special-case on the client.

Re-applied:

```
M6 acked mark says "The agent is done."
  18 pass  1 fail
  (fail) the acked row says the OPERATOR judged it, in muted ink, and offers the undo

M7 .cmux-badge { color: var(--needs) }
  18 pass  1 fail
  (fail) a row whose workspace has unread notifications carries a quiet count badge
```

## 4. Exact params (trap #3) — PASS

`clearCmuxNotification` POSTs `{ action, id }` to `/api/sync/notifications`. Test pins `Object.keys(body) === ["action","id"]` for both `mark_read` and `dismiss`.

Commit diff mentions `all` / `all_read` / `tab_id` / `notification_id` only in comments and in that assertion — never as sent fields. The lookback `"all"` at `app.js:1673` is pre-existing filter storage, not a notify verb.

```
M3 body uses notification_id instead of id
  18 pass  1 fail
  (fail) mark_read and dismiss reach /api/sync/notifications with the exact frozen params
  Received: { "action": "mark_read", "notification_id": "n-1" }
```

## 5. Strip-membership coherence — PASS

`stripAlerting` is the membership predicate at exactly the three sites:

1. `needsYouStrip` (strip rows)
2. `pinnedIds` in `agentRowPlan`
3. `hollowInPane`

Ember / inline-mark still call `alerting()`:

- `hasDrawnAlertingDescendant` → `alerting(child)`
- `opts.alerting: markAlerting && alerting(agent)`

Deliberate, as claimed in the lane report §3.3.

Hollow-guard: no test imports `hollowInPane` by name. Proof is the code path: `hollowInPane` returns false unless **every** agent is `stripAlerting`. An acked sole-alerting agent is `alerting` but not `stripAlerting`, so the group is not hollow and is not skipped in `renderPrograms`. The companion test `Ack PUTs … leaves the strip while its row stays` drives `agentRowPlan` and asserts `row:<id>` remains (pinnedIds uses `stripAlerting`; an ack applied only to the strip would pin via `alerting()` and drop the row from the group). Together: ack cannot delete a live session from the board.

`deriveRollup().needsYou` still counts `alerting()` — fleet counters unchanged.

## 6. Envelope honesty — PASS

`syncRequest`: `if (envelope && envelope.ok === true) return { ok: true };` — not `res.ok`. HTTP 200 + `{ok:false}` is a refusal; no snapshot re-read (`calls`).toHaveLength(1). Empty JSON `{}` is also `ok: false`.

```
M8 if (res.ok) return { ok: true }
  18 pass  1 fail
  (fail) a refused clear is reported as a refusal, never as success
  (200 + {ok:false, code:"invalid_state"} was treated as success and fetchSnapshot ran)
```

## 7. A11y — PASS

Ack `aria-label`: `"Ack — Acknowledge <name>: removes from alerts; agent may still be waiting"`. Unack: `"Unack — … returns it to alerts"`. `leadsWithVisibleText` is present and used (whole leading word, not `startsWith`). Announcement writes into `#bar-scope-note`, declared in `index.html` as `aria-live="polite"` (persistent; filter bar is rebuilt around it). Copy: `"N acknowledged — hidden from Needs you, still waiting"`.

## 8. Absence path — PASS

`unreadCmuxByWorkspace` / `ackedIds` treat a missing field as empty (`Array.isArray(...) ? ... : []`). Tests:

- snapshot without `cmuxNotifications` → no `.cmux-badge`
- snapshot without the field / empty list → `renderCmuxNotifySection` returns `null`
- `acks: []` (same branch as absent) → no `.acked-mark`; self-revoke test
- those renders do not throw

Today's production snapshot (NB unmerged) is this shape.

## 9. Floor — PASS (only tolerated red)

```
$ bunx tsc --noEmit
tsc exit: 0
(stdout empty)

$ bun test tests/sync-notifications-board.test.ts
 19 pass
 0 fail
 94 expect() calls
Ran 19 tests across 1 file. [44.00ms]

$ bun test
(fail) what this board counted is what a separate application recorded > the comparison actually ran against both sources [0.11ms]
  tests/cross-source-token-agreement.test.ts:644
  error: too few sessions joined to be worth believing
  Expected: > 20
  Received: 17

 3330 pass
 1 fail
 15433 expect() calls
Ran 3331 tests across 180 files. [87.94s]
```

The single red is the named fleet canary `tests/cross-source-token-agreement.test.ts`. No other fail.

VERDICT: PASS
