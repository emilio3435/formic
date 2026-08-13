# Verification brief — SYNC-NB (adversarial, read-only)

Try to BLOCK this lane. Read-only; write only `VERIFY-sync-nb.md` (root) + scratch in `.lane-evidence/`. Never commit/push/revert. Work is UNCOMMITTED dirt (codex sandbox; expected). Base for diffs: `$(git merge-base HEAD feat/sync-integration)`.

Context: `docs/superpowers/plans/2026-08-13-sync/00-MASTER-PLAN.md` §Contract, `KICKOFF-NB.md`, `02-GROUND-RULES.md`, `LANE-REPORT-sync-nb.md`.

## Checks

1. **Fence.** Changed files must be exactly the report §3 list: `ARCHITECTURE.md`, `src/shared/types.ts`, `src/server/{ack,app,cmux-actions,cmux,index,snapshot,state}.ts`, `tests/cmux-notifications.test.ts`, LANE-REPORT. Scrutinize `snapshot.ts`/`index.ts`/`state.ts` diffs for anything beyond notification ingest wiring + ack store injection + event registrations — close/rename territory or unrelated edits = BLOCK. `src/shared/types.ts`: the frozen `AgentAck`/`CmuxNotificationSummary` shapes must be UNCHANGED (new snapshot fields `cmuxNotifications`/`acks` allowed).
2. **Param vocabularies (trap #3 — THIS lane's trap).** Tests must pin exact issued params: `notification.mark_read {id}` and `notification.dismiss {id}` — key `id`, never `notification_id`; `all`/`all_read`/`tab_id` never emitted (an Object.keys-style pin, TINT precedent). `notification.create*` must appear NOWHERE in src changes.
3. **Redaction (trap #3b).** Bodies come from `notification.list`, never from event payloads. Events trigger a targeted re-list (debounced within a tick — burst test must assert ONE list call), never a session recollect.
4. **Anchors (trap #6) + windows (trap #1).** Anchor notifications dropped via per-window `workspace.group.list {window_id}`; a second-window anchor fixture that would fail a single-window walk.
5. **Ack semantics (trap #9 — the locked decision).** `PUT /api/sync/ack/:agentId` stores frozen `{agentId, ackedAt, alertFingerprint}`; unchanged fingerprint stays acked across refreshes; a FRESH alert (different fingerprint) removes the ack in the same snapshot pass with NO DELETE call (assert the ack is gone from the produced snapshot); explicit DELETE unacks; non-alerting agent → 409. Ack must never write to cmux and never mutate agent state — grep the ack path for any cmux call or agent-state write = BLOCK.
6. **Fingerprint judgment honesty.** Report §3 claims: hook-declared input → `hookLifecycle + hookLifecycleAt`; prose alerts → `attentionSignal.kind + lastHumanFacingAt`; heartbeat churn cannot revoke. Attack this: find a field in the fingerprint inputs that changes on ordinary refresh without a new alert (e.g. updatedAt used when a source clock EXISTS) — if churn can revoke an ack, BLOCK. Tests must drive produced snapshots, not hand-authored agents divorced from `buildSnapshot` (fixtures-are-not-payloads).
7. **Failure honesty (trap #2).** Exit-zero refusal bodies and string refusals → typed failures, no fingerprint.
8. **Route gate.** `/api/sync/notifications` + ack routes same-origin loopback gated; foreign Origin rejected before any cmux call/store write.
9. **Floor.** Run + paste: `bunx tsc --noEmit`; `bun test tests/cmux-notifications.test.ts tests/cmux-sync.test.ts tests/cmux.test.ts tests/reference-docs.test.ts`. Any red = BLOCK.

## Output

`VERIFY-sync-nb.md`, findings per check, final line exactly `VERDICT: PASS` or `VERDICT: BLOCK — <reasons>`. Uncertainty = BLOCK.
