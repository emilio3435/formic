# SYNC-NF · Notifications + Ack, board half (FE · Opus 5 high via Claude Code)

**Mission:** Render cmux notification badges minimally (rows + the existing notifications dropdown — NO redesign of the unsettled notification center), wire mark-read/dismiss, and ship the Ack button: an operator judgment that quiets a waiting agent's alert without lying about its state.

**Files:** `src/web/app.js` (badges, clear verbs, Ack button + acked mark + strip filtering; surgical), `src/web/styles.css`, house-pattern web tests.

**Consumes:** snapshot `cmuxNotifications` + `acks` exactly as frozen; `/api/sync/notifications` + ack routes per contract (stub fetch until NB merges; drive REAL envelopes — [[fixtures-are-not-payloads]]). **Produces:** nothing other lanes consume.

## Tasks

### Task 1: badges + clear verbs
- [ ] Failing tests: a row whose workspace has unread cmux notifications shows the badge (count, quiet styling — muted ink, not a status color; status colors stay reserved); mark-read POSTs `{action:"mark_read", id}`; dismiss likewise; a cleared badge does NOT remove the row from needs-you when the agent is still alerting (assert both states in one fixture — this is locked decision 3 and the test that proves it).
- [ ] Implement; badges in rows + dropdown entries only where notifications already render; tests pass; commit.

### Task 2: Ack
- [ ] Failing tests: an alerting agent's row/drawer offers "Ack"; ack PUTs and, on `{ok:true}`, the agent leaves the needs-you strip while its row shows a quiet "acked" mark (visible truth: the agent is still waiting — the mark says the OPERATOR judged it done, e.g. `acked ·` prefix in muted ink, never a status-green); an agent whose ack was self-revoked server-side (fresh alert) re-appears in the strip with no client special-casing (the client renders snapshot truth, it does not track acks itself); non-alerting agents offer no Ack.
- [ ] Implement; tests pass.

### Task 3: a11y + floor
- [ ] Ack and clear controls keyboard-reachable, labeled (`aria-label` states what it does and does NOT do: "Acknowledge — removes from alerts; agent may still be waiting"); strip filtering announced via the existing aria-live reconciling-sentence pattern.
- [ ] Full floor; report §4.

**Traps:** ground rules #7, #9 (the mark must read as operator-judgment, not agent-state — text never claims the agent finished); status colors reserved (badge is quiet ink); no notification-center redesign — two unpicked mockups exist from 2026-08-05, do not adjudicate them from inside this lane.
