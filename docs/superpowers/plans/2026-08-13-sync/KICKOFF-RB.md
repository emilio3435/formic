# SYNC-RB · Rename, server half (BE · Sol xhigh via Codex)

**Mission:** Implement rename through the funnel with custom-pins-both-sides semantics: a rename from either side pins the title (auto-namer stops), `workspace.renamed` events patch the board instantly, and no combination of writers produces a loop.

**Files:** `renameWorkspace` (+ tab rename if the board shows tab titles — check what the collector carries and scope accordingly; state the finding in your report) in `cmux-actions.ts`, `/api/sync/rename` route, `workspace.renamed` handler registration, `tests/cmux-rename.test.ts`.

**Consumes:** E's seams, funnel skeleton, `workspace.rename` RPC (verified: sets `has_custom_title: true`). **Produces:** route shape per contract; RF renders against it; renamed titles reach the snapshot via your patch handler without waiting for a poll.

## Tasks

### Task 1: rename verb
- [ ] Failing tests: `renameWorkspace` issues `workspace.rename {workspace_id, title}` and records the echo fingerprint; empty/whitespace-only titles → `{ok:false, code:"invalid_title"}` with no cmux call; a title identical after trim to the current one → `{ok:true}` no-op with NO cmux call (a spelling-only write is the loop seed — ground rules #4); anchor workspaces → `{ok:false, code:"anchor"}`.
- [ ] Implement; tests pass; commit-or-stage.

### Task 2: event patch + loop-proofing
- [ ] Failing tests: a `workspace.renamed` event patches the snapshot title in the same dispatch; an event that `isOwnEcho` matches patches state but triggers no further write; the adversarial pair — two rapid renames (ours then a foreign one) — converges with exactly one write issued (ours) and the foreign title winning (last-writer is the human; the board never re-asserts titles, unlike colors: titles have NO board-authoritative rule — cmux truth wins on read, write happens only on explicit user action).
- [ ] Implement; tests pass.

### Task 3: route + floor
- [ ] Same-origin-gated `POST /api/sync/rename`; 404 unknown workspace; full floor; report §4.

**Traps:** ground rules #4 (normalize/trim before compare — the rename analog of the TINT hex-case loop), #6, #2. NOTE the asymmetry vs TINT colors and pin it in a test: colors are board-authoritative and re-asserted; titles are NEVER re-asserted by the board. Getting this backwards builds a machine that fights every manual rename forever.
