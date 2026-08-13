# SYNC-CF · Close, board half (FE · Opus 5 high via Claude Code)

**Mission:** Give the board its close affordance: a row/drawer "Close terminal" action gated on exact target resolution, and the workspace-close confirm that names every sibling agent it would kill and states that closes are not undoable. You render what CB's route returns; you invent no policy.

**Files:** `src/web/app.js` (close affordance + confirm dialog; surgical), `src/web/styles.css` (dialog styling in the house grammar — signal rails and outline indicators, not filled banners; strict CSP, no inline styles), `tests/repo-sync-close-ui.test.ts` (or the house test file pattern for web-client — read `tests/web-client.test.ts` structure first and match it).

**Consumes:** `POST /api/sync/close` exactly as frozen in master plan §Contract (build against a stubbed fetch until CB merges; your tests drive the REAL envelope shapes — fixtures that hand-author a different shape are the defect class that blocked TINT-F round 1, see [[fixtures-are-not-payloads]]). **Produces:** nothing other lanes consume.

## Tasks

### Task 1: row close affordance + gating
- [ ] Failing tests: the close action renders only when the agent's `targetResolution` is `"exact"` (ambiguous/missing → disabled with the existing visible-reason pattern — read how existing controls do it and match); an agent on an ended row gets no close action.
- [ ] Implement in the drawer's control cluster (where focus/interrupt live). Match existing control idioms exactly.
- [ ] Tests pass; commit (path-scoped).

### Task 2: surface close flow
- [ ] Failing test: clicking close POSTs `{target:"surface", id}` with same-origin headers; `{ok:true}` shows the house success affordance; `{ok:false, code:"invalid_state", escalation}` opens the escalation dialog — no retry, no error toast.
- [ ] Implement; tests pass.

### Task 3: escalation/confirm dialog
- [ ] Failing tests, driven by the REAL route envelope: dialog lists `escalation.siblingAgents` BY NAME (empty list → "no other agents share this workspace"); copy states the close cannot be undone; confirm POSTs `{target:"workspace", id, confirm:true}`; cancel issues nothing; `code:"confirm_required"` from a direct workspace close routes into this same dialog.
- [ ] Keyboard: dialog is focus-trapped, Escape cancels, initial focus on Cancel (destructive default). Match the board's existing dialog/focus idioms ([[a11y patterns in web-client tests]]).
- [ ] Tests pass. Full floor; report §4.

**Traps:** ground rules #7 (CSP); fixtures-are-not-payloads (drive the frozen envelope, add one test asserting a WRONG envelope renders nothing); do not add a window-close affordance (locked decision 2); the strip offers no close (attention rows keep their single job).
