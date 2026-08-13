# SYNC — Formic ⇄ cmux two-way action sync

> Spec status: probe-verified 2026-08-13 03:15–03:25 CDT (all five unknowns resolved by live experiment; evidence inline). Decisions locked by Emilio 2026-08-13 ~03:10. Program not yet started; this document is the input to /orchestrate.
> Prior art this builds on: the TINT program (repo-color funnel, echo suppression, anchor rules) — PR #47.

## Goal

Make three action classes bidirectional between the Formic board and cmux — close, notification-clear, rename — on an event-driven foundation that replaces "eventually" with "instantly," without ever letting a sync action lie about agent state or destroy another lane's work.

## Success means

- A cmux workspace/surface close flips the corresponding board row live→ended within one event round-trip (<2s), never by poll luck. Board history is untouched: liveness syncs, existence doesn't (locked decision 1).
- The board can close an agent's surface when target resolution is `exact`; last-surface closes escalate to a workspace-close confirm that **names the other live agents it will kill**; window close is not offered (locked decision 2).
- The board can mark-read and dismiss cmux notifications by id; clearing a badge never hides a board attention row derived from live agent state (locked decision 3).
- A board-local **Ack** removes a waiting agent from the alert list as an operator judgment, is visibly an ack (not a state change), and **self-revokes when the agent alerts anew**.
- Renaming a workspace or tab title on either side updates the other; a custom rename pins the title and the auto-namer stops touching that workspace; no rename loops (locked decision 4). Window rename is out of scope — cmux has no API for it (verified).
- No sync write loops: every board→cmux action funnels through one module with echo suppression keyed on cmux's own `*_requested` event echo.
- The collector sees **all windows** (the single-window blindness measured by TINT-S is fixed as a prerequisite).
- Floor green throughout; every lane adversarially verified before merge (TINT protocol).

## Stop when

All four phases merged green on an integration branch, deployed locally, verified with eyes and live cmux probes, pushed + PR'd on Emilio's word, swept under the program prefix.

---

## Locked decisions (Emilio, 2026-08-13 — override anything contrary below)

1. **Close = instant live→ended.** Rows never vanish from history because a surface closed.
2. **Close radius = surface + gated workspace.** Row close targets the surface (exact resolution only). Workspace close is separate, confirm-gated, and the confirm lists sibling agents. No window close from the board.
3. **Notification clear = badge only** (mark_read / dismiss on cmux ids). Board attention derived from live state is never suppressed by a badge action. NEW FEATURE folded in: board-local **Ack** per the Success bullet above.
4. **Rename: custom pins, both sides.** Scope = workspace titles + tab titles. Auto-namer touches only unpinned workspaces. Windows out (no API).

## Probe evidence (2026-08-13, live cmux; raw capture in program archive)

| Question | Answer | Evidence |
|---|---|---|
| Do close/rename/create emit events? | **YES, all of them** | Captured live: `workspace.created`, `workspace.renamed` (payload carries method+params+result), `workspace.closed`, `surface.created`, `surface.closed` (`origin: workspace_teardown`), `workspace.reordered`, `workspace.selected` |
| Notification verbs | `mark_read {id}` → `is_read: true`, stays listed (models "clicked it"). `dismiss {id}` → removed from list. `clear` also exists. Events: `notification.created` / `notification.read` / `notification.removed` | Probe notification FAFA3E4C… walked through the full lifecycle |
| Rename ↔ auto-namer | `workspace.rename` sets `has_custom_title: true` — the pin exists in the data model | Probe workspace flipped the flag on rename |
| Last surface | `surface.close` on a workspace's only surface **refuses** (`invalid_state: Cannot close the last surface`); workspace close tears down surfaces (`surface.closed` with `origin: workspace_teardown`, then `workspace.closed`) | Live probe |
| Event stream lifetime | Sequence-numbered with replay: ack carries `oldest_seq`/`latest_seq`/`resume.after_seq`/`gap`. ~4k events buffered. Auth = existing socket password | Ack inspected; `--after` replay works |
| Echo suppression channel | **Every RPC echoes as a `*_requested` event including params** (e.g. `notification.mark_read_requested`, `workspace.renamed` carries `method`+`params`) — the sync engine can recognize its own writes without a local-cache-only scheme | Captured during probes |
| Notification payload privacy | Event payloads redact notification content (`"args": "<redacted>"`, `body: null` + `body_length`); full bodies come from `notification.list` only | Captured |
| Undo story for close | `cmux restore` replaces a CLI process from a persisted surface record (argv/env/cwd); `surface.respawn` exists. Workspace-level undo depth unverified — treat close as unrecoverable in the confirm copy until a lane proves otherwise | `restore --help`, methods list |

## Architecture

### Phase 0 — event-driven collection (foundation; lands alone, first)

- New `src/server/cmux-events.ts`: long-lived subscription to `cmux events` (spawned process or socket), maintaining a seq cursor. On relevant events → targeted collector refresh (or direct state patch for cheap ones like rename). On `gap: true` or reconnect → full recollect, never trust a gapped stream.
- Event → action routing table lives in this one module; every other phase registers handlers, TINT-G-style (`registerSyncHandler(name, fn)`), so phases stay fence-clean.
- **Prerequisite fix in the same phase**: the sidebar collector's single-window blindness (TINT-S measured 10/15 workspaces). All `workspace.list` / `workspace.group.list` walks enumerate `window.list`. (This bug bit the master live during the SYNC probes — `workspace.list '{}'` answered from the wrong window and made a live workspace look closed. It is not hypothetical.)
- Liveness: on `workspace.closed`/`surface.closed`, the affected agents flip live→ended immediately with reason `cmux-closed` (never deleted — [[board-liveness-phantom-rows]] rules still govern).

### The action funnel (shared by phases 1–3)

`src/server/cmux-actions.ts` — the TINT `cmux-color.ts` pattern generalized:
- `closeSurface(surfaceId, reason)` · `closeWorkspace(workspaceId, reason)` · `markNotificationRead(id)` · `dismissNotification(id)` · `renameWorkspace(workspaceId, title, reason)` · `renameTab(...)`.
- Each records an issued-action fingerprint; the Phase-0 event router drops `*_requested` echoes matching a recent fingerprint (id or params match, bounded window). Failure honesty: stderr/non-zero/refusal (`invalid_state`) surfaces as failure, never success.
- All mutating board routes same-origin loopback, like every sibling.

### Phase 1 — close

- cmux→board: Phase 0 handlers (already listed).
- Board→cmux: row action "Close terminal" enabled only at `exact` resolution (reuse `TargetResolution` gating). If cmux refuses with last-surface `invalid_state`, the UI escalates to the workspace-close confirm; the confirm dialog lists every OTHER live agent whose `target.workspaceId` matches, by name. Copy states closes are not undoable. Group-anchor workspaces are never close targets (TINT anchor rules).

### Phase 2 — notifications + Ack

- Collector ingests `notification.list` (bodies come from list, not events — redaction) keyed by workspace/surface; board rows and the notifications dropdown show unread cmux badges.
- Actions: mark-read (the "I saw it" verb) and dismiss, per id or all-for-workspace (`mark_read` takes `id|tab_id|all`; `dismiss` takes `id|all_read` — the param vocabularies differ per verb and `id` is the key, NOT `notification_id`; both probed).
- **Ack** (board-local, no cmux side): `acks[agentId] = {at, alertFingerprint}` in settings-adjacent storage. An acked agent leaves the needs-you strip; the row shows a quiet "acked" mark; a NEW alert (different fingerprint — e.g. new waiting-since timestamp or state transition) clears the ack automatically. Ack never mutates agent state and never writes to cmux.

### Phase 3 — rename

- cmux→board: `workspace.renamed` event patches titles instantly (collector already carries `workspaceTitle`).
- Board→cmux: inline rename affordance where workspace titles render (drawer session header; NOT agent names — those are board derivations and stay board-owned). Tab titles via `tab.action` rename where the board shows terminal tabs.
- Pin rules: any custom rename (either side) → `has_custom_title: true` → auto-namer excluded. The board never renames a workspace whose title the user set in cmux except by explicit user action on the board (custom-pins-both-sides is symmetric).
- Echo suppression via the funnel fingerprint + `workspace.renamed`'s embedded `method`/`params`.

## Fences preview (per-lane, TINT-style)

| Lane | Owns |
|---|---|
| SYNC-E (Phase 0) | `cmux-events.ts` (new), multi-window fix in collector walks, liveness handlers, its tests |
| SYNC-C (Phase 1) | close paths in `cmux-actions.ts`, board close UI + confirm, its tests |
| SYNC-N (Phase 2) | notification ingest + actions, Ack store + strip/dropdown UI, its tests |
| SYNC-R (Phase 3) | rename paths, inline rename UI, pin rules, its tests |
| Master | contract stub, `cmux-actions.ts` skeleton + registration seams, merges, floor, deploy |

Phase 0 lands alone before C/N/R spawn (serial-first foundation, orchestrate §3). C/N/R then run in parallel against the frozen seams.

## Traps (verified tonight, for the ground-rules file)

- `workspace.list` / `workspace.group.list` are **window-scoped**; `{}` answers from the CALLER'S window. Enumerate `window.list` always. (Bit the master mid-probe.)
- Notification params: the key is `id`; `mark_read` selects one of `id|tab_id|all`, `dismiss` one of `id|all_read`. `notification_id` is silently invalid → error, but easy to fumble into `all` variants — never send `all` from sync code.
- `surface.close` on a last surface refuses with `invalid_state` — handle as escalation signal, not error.
- Event payloads redact notification content — fetch bodies via `notification.list`.
- `notification.create*` exists — sync code must never call it (we clear, we don't create).
- Event stream `gap: true` → full recollect; a gapped stream that keeps patching is a board that quietly diverges.
- Hex/title normalization before comparison (TINT write-loop lesson; titles: exact string, but trim + the `·`-separator conventions vary).

## Open items (not blockers; resolve in-lane or post)

- Workspace-close undo depth (`cmux restore` coverage for whole workspaces) — informs confirm-dialog copy only.
- Whether the board's notifications dropdown design (two unpicked mockups from 2026-08-05) gets settled by SYNC-N or stays minimal (recommend: minimal — badges + clear verbs only, no redesign).
- Ack fingerprint definition (waiting-since timestamp vs state-transition counter) — SYNC-N decides against real data.

## Not in scope

- Window rename (no API), window close from the board (locked out), cmux notification creation from the board, ingesting board-only attention INTO cmux, renaming agent/session display names from cmux.
