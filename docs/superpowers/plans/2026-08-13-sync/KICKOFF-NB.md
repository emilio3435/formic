# SYNC-NB · Notifications + Ack, server half (BE · Sol xhigh via Codex)

**Mission:** Ingest cmux notifications into the snapshot (bodies from `notification.list` — events are redacted), implement mark-read/dismiss through the funnel, and build the board-local Ack store with alert-fingerprint self-revoke. Badge actions never touch agent state; Ack never touches cmux.

**Files:** notification ingest in the collector cycle (your marked block), `markNotificationRead`/`dismissNotification` in `cmux-actions.ts`, `/api/sync/notifications` + `/api/sync/ack/:agentId` routes in the `/* SYNC routes */` block, `JsonAckStore` (own JSON file, `JsonAttentionStore` pattern — do NOT extend settings shapes), `tests/cmux-notifications.test.ts`.

**Consumes:** E's seams (`notification.created/read/removed` handler registrations trigger targeted re-list), funnel skeleton, `CmuxNotificationSummary` + `AgentAck` frozen shapes. **Produces:** snapshot carries `cmuxNotifications: CmuxNotificationSummary[]` and `acks: AgentAck[]`; NF renders exactly these.

## Tasks

### Task 1: ingest
- [ ] Failing tests: fixture `notification.list` output → snapshot summaries keyed/mapped per frozen shape; notifications on group-ANCHOR workspaces are dropped; a `notification.created` event triggers one re-list (not one per event in a burst — debounce within a tick).
- [ ] Implement; tests pass; commit-or-stage.

### Task 2: verbs
- [ ] Failing tests: `mark_read` sends `{id}` — assert the EXACT param key (`id`, never `notification_id`; the wrong key errors, and a test pins Object.keys like TINT's param-pinning test); `dismiss` same; both record echo fingerprints; failure honesty per ground rules #2; the `all`/`all_read`/`tab_id` variants are never emitted (pin by asserting issued params).
- [ ] Implement; route with same-origin gate + tests.

### Task 3: Ack store + self-revoke
- [ ] Failing tests: `PUT /api/sync/ack/:agentId` stores `{agentId, ackedAt, alertFingerprint}` where the fingerprint derives from the agent's CURRENT alert evidence (state + its since-timestamp — derive from what the snapshot actually carries; read `agent-model` first and name your choice in the report); an acked agent whose fingerprint is UNCHANGED stays acked across refreshes; a NEW alert (fingerprint differs) removes the ack in the same snapshot pass — the test asserts the ack is gone without any DELETE call; explicit `DELETE` unacks; acking a non-alerting agent → 409.
- [ ] Implement; tests pass. Full floor; report §4.

**Traps:** ground rules #3 (param vocabularies — this is YOUR trap, pin it in tests), #9 (Ack semantics), #6 (anchors), #1 (any per-window walk). Never call `notification.create*`. The fingerprint definition is the one open judgment in this lane — decide from real snapshot fields, state the choice and why in report §3.
