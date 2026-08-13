# SYNC-RF · Rename, board half (FE · Opus 5 high via Claude Code)

**Mission:** Inline rename affordance where workspace titles render on the board — the drawer's session header first, tab titles only if the board actually shows them. Agent/session display names are NOT renameable (they are board derivations, not cmux objects); this lane renames workspaces.

**Files:** `src/web/app.js` (inline rename UI; surgical), `src/web/styles.css`, house-pattern web tests.

**Consumes:** `POST /api/sync/rename` per contract (stub fetch until RB merges; REAL envelopes — [[fixtures-are-not-payloads]]); snapshot workspace titles (already collected; RB makes them event-fresh). **Produces:** nothing other lanes consume.

## Tasks

### Task 1: affordance
- [ ] Failing tests: the drawer session header's workspace title offers rename (pencil-on-hover or the house inline-edit idiom — read how program aliases render/edit first and MATCH that pattern; if no inline-edit idiom exists, click-to-edit with explicit save/cancel); agents with no resolved workspace get no rename; agent display names offer no rename anywhere.
- [ ] Implement; tests pass; commit.

### Task 2: flow + truth
- [ ] Failing tests: save POSTs `{workspaceId, title}`; `{ok:true}` → the field shows the SNAPSHOT's title on next render, not a locally-echoed value (the board renders cmux truth; a foreign rename arriving between save and refresh must win on screen); `{ok:false}` (invalid_title / anchor) → inline error in the existing quiet-error idiom, original title restored; Escape cancels, Enter saves, focus returns to the trigger.
- [ ] Implement; tests pass.

### Task 3: floor
- [ ] Full floor; report §4.

**Traps:** ground rules #7; render snapshot truth, never local echo (the FE half of RB's never-re-assert rule); do not add rename to rows/strip — one affordance, in the drawer, where the workspace identity already lives ([[surgical changes]]).
