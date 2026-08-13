# SYNC-CB · Close, server half (BE · Sol xhigh via Codex)

**Mission:** Implement the close verbs in the funnel, the `/api/sync/close` route with last-surface escalation (sibling agents named), and the close event handlers. Board→cmux close becomes possible; cmux→board instant-ended is SYNC-E's and already merged into your branch.

**Files:** `src/server/cmux-actions.ts` (your verbs only), `/api/sync/close` in the marked `/* SYNC routes */` block, `tests/cmux-actions-close.test.ts`.

**Consumes:** funnel skeleton (`isOwnEcho` fingerprint store), E's merged seams, `TargetResolution` + agent→workspace bindings from the collector. **Produces:** route shape per master plan §Contract — CF builds its UI against exactly that JSON.

## Tasks

### Task 1: closeSurface / closeWorkspace
- [ ] Failing tests (fixture runner, no live cmux): success records the action fingerprint so the subsequent `surface.closed`/`workspace.closed` echo is `isOwnEcho`-true; cmux stderr/non-zero → `{ok:false, code, detail}` and NO fingerprint; `invalid_state` surfaces as `{ok:false, code:"invalid_state"}` (typed, not thrown).
- [ ] Implement via `workspace.close`/`surface.close` RPCs; tests pass; commit-or-stage.

### Task 2: route + escalation
- [ ] Failing tests: `POST /api/sync/close {target:"surface", id}` requires same-origin loopback (copy the sibling gate pattern, test a rejected `http://evil.example` Origin); on `invalid_state` the response carries `escalation.workspaceId` + `escalation.siblingAgents` — every OTHER live agent whose `target.workspaceId` matches, `{id, name}`, from the snapshot; a workspace whose id is a group ANCHOR returns `{ok:false, code:"anchor"}` and issues no cmux call.
- [ ] Implement; tests pass.

### Task 3: workspace close confirm data honesty
- [ ] Failing test: `{target:"workspace"}` close succeeds only when the request carries `confirm: true`; without it → `{ok:false, code:"confirm_required", escalation}` with the same sibling list. (The server enforces the gate; CF renders it — a UI-only confirm is a bypass waiting for a curl.)
- [ ] Implement; tests pass. Full floor; report §4.

**Traps:** ground rules #2 (exit code is not evidence), #5 (invalid_state IS the escalation signal — map it, don't retry), #6 (anchors), #1 if you enumerate anything per-window. Do not implement any notification/rename verb — fences.
