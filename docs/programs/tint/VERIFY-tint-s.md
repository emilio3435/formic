# VERIFY — lane TINT-S (two-way sync)

Adversarial, read-only. Tree state verified: `git log 06d385c..HEAD` is `bff04a4` (feat) then `2f22c83` (anchor addendum). Working tree clean — addendum is in HEAD, not leftover dirt.

Floor re-run this pass: `bunx tsc --noEmit` exit 0; `bun test tests/cmux-color-sync.test.ts` 42 pass / 0 fail; full `bun test` 3343 pass / 1 fail. The one red is `tests/cross-source-token-agreement.test.ts` (too few sessions joined). Documented, expected, not this lane.

Hollow-test probe: throwaway copy at `/tmp/tint-s-verify-copy`. Deleting the `lastWrittenHex` branch failed `a user override this process just wrote is not fought while settings catch up`. Deleting the collection-time anchor drop failed `a group anchor never reaches the board` and `with mirrorGroups on, the group's anchor is neither published nor painted`. Tests have teeth.

## Findings (ranked)

### 1. Note — files outside the GOAL-S "owns" list, none in the "must not touch" list

Fence owns: `cmux-color-sync.ts`, minimal `custom_color` read in `cmux.ts`, one `/* TINT-S */` registration line, tests. Also changed:

- `src/server/types.ts:190-194` — optional `customColor?: string | null` on `CmuxWorkspaceSnapshot`. Required by the fence-mandated `cmux.ts` carry; without it the read has nowhere to land.
- `ARCHITECTURE.md:15` — one paragraph naming `src/server/cmux-color-sync.ts`. Forced by `tests/reference-docs.test.ts` (every `src/server/*.ts` must be named or the floor is red).
- `src/server/state.ts:12` import + `src/server/state.ts:864` call, both marked `/* TINT-S */`. Fence said "one registration line"; the import is the second. Not a second behavior.

Did not touch `src/web/**`, funnel internals, `cmux-groups.ts`, or `settings.ts`. No BLOCK: reverting the extras makes tsc or the architecture gate red.

### 2. Note — `lastWrittenHex` is not what stops the common write loop

`src/server/cmux-color-sync.ts:412-424` checks assignment equality (normalized) *before* `lastWrittenHex`. On the copy, removing the echo branch left `a re-assert observed by the next poll produces no further write` green — that test is assignment-match + `normalizeHex`, not funnel-echo. The user-override test (`tests/cmux-color-sync.test.ts:559-573`) is the one that actually pins `lastWrittenHex`. Restart (`tests/cmux-color-sync.test.ts:542-557`) is assignment-match with `lastWrittenHex` null, which is the required restart case.

Residual hole the lane already disclosed (`LANE-REPORT-tint-s.md` §5.3): if cmux ever stores a hex that normalizes to neither the assignment nor `lastWrittenHex`, the pass re-asserts every poll. Contract puts that record on the funnel (TINT-F). Locked rule 3 is implemented as specified.

### 3. Note — production re-assert is idle until TINT-F persists `repoColors` on hub settings

`src/server/state.ts:864` passes `HubSettings | undefined`. `HubSettings` (`src/server/settings.ts:53-73`) has no `repoColors` key. `repoColorsSettingsFrom` (`src/server/cmux-color-sync.ts:499-511`) then yields empty `assignments` → ingest only, no writes. Fence forbids S from editing `settings.ts`. Honest seam; silent if F's key name differs. Lane report §5.4 already flags it.

### 4. Note — color-sync errors never join `#cmuxErrors`

Failed funnel writes and cmux RPC failures are recorded on the result and `console.error`'d (`src/server/cmux-color-sync.ts:598-601`). `latestColorSyncErrors()` exists (`src/server/cmux-color-sync.ts:530-532`) but nothing in `state.ts` consumes it. A failed write is not marked reconciled (see target 7); it is also not visible on the board until F's route reads the export.

---

## Refutation targets

### 1. Write-loop survival — holds

Echo suppression is `runtime.funnel.lastWrittenHex`, normalized, not a local cache (`src/server/cmux-color-sync.ts:421-423`). Fresh process + cmux color == assignment → ignore, zero writes (`tests/cmux-color-sync.test.ts:542-557`). `#2E66A8` vs `#2e66a8` collapse via `normalizeHex` (`src/server/cmux-color-sync.ts:84-93`, compare at `:412-414`; test `:433-446`). Absent/`null`/missing `custom_color` is `null`, not black (`src/server/cmux-color-sync.ts:154-156`); unmapped + no color → ignore (`:400-403`); mapped + no color → paint (`tests/cmux-color-sync.test.ts:462-471`), which is board authority, not "absent is drift-as-black".

### 2. Anchor filtering (addendum) — present, not partial

`2f22c83` is in HEAD. `parseCmuxGroupAnchorIds` reads `anchor_workspace_id` / `anchorWorkspaceId` (`src/server/cmux-color-sync.ts:138-145`). Collection drops every such id across windows (`:277-281`) before reconcile. Group-list failure skips the window whole (`:232-252`). Reconcile takes a second lock, filters before `workspaceRepoKeys`, records ignore, never ingest/re-assert/publish (`:347-359`, `:381`). Tests cover collection, reconcile (including "cannot vote"), and the `syncCmuxColors` integration path. Copy mutation that kept anchors in `value` went red.

### 3. Per-window coverage — holds

Does not reuse `extension.sidebar.snapshot`. Enumerates `window.list` then `workspace.list {"window_id"}` and `workspace.group.list {"window_id"}` per id (`src/server/cmux-color-sync.ts:193-230`). Two-window fixture test (`tests/cmux-color-sync.test.ts:204-232`) requires both `WS-A` and `WS-B`. Sidebar collector left single-window on purpose (out of fence); flagged in the lane report, not a S miss.

### 4. Fence — extras noted above, must-not-touch clean

`git diff 06d385c --name-only -- src/web src/server/cmux-groups.ts src/server/cmux-color.ts src/server/settings.ts` empty. `cmux.ts` change is the `custom_color` carry only (`src/server/cmux.ts:481-489`).

### 5. Contract shape — no drift

Consumes `RepoColorAssignment` / `RepoColorsSettings` / `repoKeyForCwd` from `src/shared/repo-color.ts` as types + dynamic import. Funnel signatures match the stub (`setWorkspaceColor(id, hex, reason): Promise<boolean>`, `lastWrittenHex(id): string | null`). Published map is `Record<workspaceId, { hex: string; repoKey: string | null }>` (`src/server/cmux-color-sync.ts:72-74`, `:395`), matching `GET /api/repo-colors`. Re-assert reason is `"sync-reassert"`. Does not rewrite palette, slot, or `assignSlot`.

### 6. Hollow tests — not hollow (copy mutated)

See probe at top. One weak assertion remains: `a repo-mapped workspace with no color at all is painted` only checks `writes.length === 1` (`tests/cmux-color-sync.test.ts:462-471`); wrong hex would still pass that test, but `repo-mapped drift is re-asserted through the funnel, with a reason` (`:448-460`) pins hex, id, and reason. `loadColorRuntime` is environment-adaptive (runtime present vs `TINT-F` in errors), not "any output".

### 7. Failures as success — does not

`setWorkspaceColor` false → outcome `"failed"`, error recorded, published hex is what cmux has, not the assignment (`src/server/cmux-color-sync.ts:439-444`; test `:577-591`). Throw → same, pass continues (`:429-437`, test `:594-608`). Window/workspace/group RPC non-zero → errors, no writes, not a clean empty fleet (`:198-204`, `:235-263`; tests `:276-340`, `:762-775`). Missing binary is `absent: true` (board convention), not a fault.

VERDICT: PASS TINT-S meets the contract, addendum, and write-loop traps; remaining notes are fence-adjacent extras and F-integration seams, not defects in this tree.
