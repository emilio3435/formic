# VERIFY — SYNC-RF

Adversarial, read-only against committed `7225867` (`feat(sync): SYNC-RF — inline cmux workspace rename in the drawer header`). Mutations applied to `src/web/app.js`, suite re-run, then reverted. Probe for wrong-envelope / `unique-cwd` / `invalid_state` run against a temporary test then reverted. Working tree matches `HEAD` aside from this report, the brief, and `.lane-evidence/` scratch.

## 1. Fence — PASS

`git diff-tree --no-commit-id --name-only -r 7225867`:

```
src/web/app.js
src/web/client-state.js
src/web/styles.css
tests/web-client.test.ts
```

Exactly the four allowed paths. No server module, no `ARCHITECTURE.md`, no extra CSS/HTML file.

**One affordance, drawer only.** `renderWorkspaceRename` has a single call site, inside `renderAgentDrawer` under `.inspector-title` (the session header). The commit does not touch `renderAgentRow`, the strip, or `renderProgram` / program heads. `ws-rename:` fkeys exist only in the new drawer block.

**Agent display names.** The `<h2 class="inspector-title">` still carries the session name with no control (test 1 asserts `buttonsOf(inspector-title) === 0` and exactly one `ws-rename:` trigger in the whole drawer). Pre-existing `.agent-rename` / `.program-rename` are the presentation-label path (`startRename` → `/api/program-aliases`), not this commit and not `POST /api/sync/rename`.

## 2. Never-re-assert (FE half) — PASS

After `{ok:true}`, `submitWorkspaceRename` sets `wsRenaming = null` and does **not** write the typed title into snapshot/agent state. The closed row reads `ws.title` from `renameableWorkspace(agent)` → `agent.target.workspaceTitle`.

**Mutation (re-applied):** closed-state title span prefers `state.wsRenameDraft || ws.title`. Test (4) `save POSTs {workspaceId, title} to the frozen route and never echoes the typed title` **fails**:

```
Expected to contain: "renamed in cmux"
Received: "Workspace  SYNC · renamed  "
```

The leftover draft after a successful save is what makes that mutation live — test (4) is not hollow. Reverted.

**Notes, not BLOCKs.** `wsRenameDraft` is not cleared on success (only unused once the form closes). The success toast interpolates the typed title (`"Renamed workspace to " + title`); that is not the field.

## 3. Gating — PASS

`renameableWorkspace` requires `workspaceId`, `resolution ∈ {exact, unique-cwd}`, and a non-empty trimmed title. Unlinked / ambiguous / missing id / blank title are in test (2).

**Mutation (re-applied):** deleted the resolution line. Test (2) **fails on `ambiguous`** (`expect(..., "ambiguous").toBeNull()` received a `.drawer-workspace` node). The negative test is not green-by-absence. Reverted.

Scratch probe (reverted): `resolution: "unique-cwd"` **does** grow the control. No-workspace agents (`resolution: "none"`, no id) still get none.

## 4. Contract envelope — PASS

POST body is exactly `{workspaceId, title}` to `/api/sync/rename`. Success is `status ∈ [200,300) && body && body.ok === true` — bare `ActionResult`, not a wrapped envelope.

Refusals (`invalid_title` / `anchor` / `invalid_state`) map through `SYNC_RENAME_ERRORS` into `.rename-error` with `role="alert"`; draft resets to the snapshot title; editor stays open. Test (5) covers `invalid_title` and `anchor`. Scratch probe (reverted): `invalid_state` holds the editor and prints the mapped sentence.

**Wrong-envelope (fixtures-are-not-payloads), scratch probe reverted, all held the editor and set an error:**

| body | treated as success? |
|---|---|
| `{ data: { ok: true } }` | no |
| `{ success: true }` | no |
| `{ ok: "true" }` | no |
| `{ result: { ok: true } }` | no |

The committed suite does not itself contain that wrong-envelope case; the `body.ok === true` gate is what enforces it. Behaviour holds.

## 5. Keyboard + a11y — PASS

- Enter: native form submit → `onsubmit` → `submitWorkspaceRename`. Test (6) fires `submit` and sees the POST.
- Escape: input `keydown` → `cancelWorkspaceRename`. Test (6) asserts no fetch and focus `["ws-rename:" + WS_ID]`.
- Focus returns to the trigger on save and on cancel (test 6, `trackFocusByFkey`).
- Error uses `role="alert"` (test 5 + `invalid_state` probe).
- Touch: `.drawer-workspace-rename` is in the house `@media (max-width: 1024px)` sweep `{ min-height: 44px }`. That is the same contract `.btn` / `.inspector-close` / `.program-rename` join at tablet.

**Note.** Base size is `width: 1.6rem; height: 1.6rem` (~26×26 desktop). At phone width the 1024px sweep raises **height** to 44px; **width stays 1.6rem**. The `@media (max-width: 720px)` rule that squares `.program-rename` / `.agent-rename` to `2.75rem` (44×44) was not extended to this drawer pencil. Lane eyes-on already reported “44px tall at 390px”. That is the house min-height sweep, not a 44×44 square. Not a BLOCK: the brief’s 44px bar for this surface is the 1024px sweep this control joined, and sibling drawer chrome (`.inspector-close` is 40px wide) is not 44×44 either.

## 6. Strict CSP (trap #7) — PASS

`git show 7225867` on the four files: no `style=` attributes, no `style:` keys in the new `el()` calls. New classes and stylesheet rules:

| class | rule present |
|---|---|
| `.drawer-workspace` | yes (`display: flex; …`) |
| `.drawer-workspace-label` | yes |
| `.drawer-workspace-title` | yes |
| `.drawer-workspace-rename` | yes (+ `:hover` + `.ico`) |
| `.sync-rename-form` | yes |

Test 8 enumerates those five names with `styles.includes("." + name)` and asserts `renderWorkspaceRename` contains no `style:`.

**Note (hollow-ish, not a miss).** `includes(".drawer-workspace")` would still pass if only the `-label`/`-title`/`-rename` rules existed (prefix). The parent rule *is* present; I did not take the test’s word for it. The `style:` scan is only the closed-state function (non-greedy to the first `}\n`); `renderWorkspaceRenameForm` is not in that slice. I grepped the whole commit anyway: no inline style there either.

## 7. Duplication flag — NOTE (not BLOCK)

Reachable. `quietSourceLine` prints `"Terminal: " + terminalSourceName(agent)` unless that string equals `agentName(agent)`. `terminalSourceName` is `surfaceTitle || workspaceTitle`. This lane always prints the workspace title again on the new row when the workspace is renameable.

So: **no `surfaceTitle`, workspace title ≠ display name** → eyebrow `Terminal: <workspaceTitle>` and row `Workspace <workspaceTitle>`. That is a real snapshot shape (workspace titles are often paths/names; display names are agent derivations). When `surfaceTitle` is present the two strings differ on purpose (pane vs workspace) and are not a duplicate.

Severity: **cosmetic.** Labels disagree (`Terminal:` vs `Workspace`) so it can look like two objects; the new row is the accurate one, and the eyebrow fallback is pre-existing (`quietSourceLine` / four other drawer types). Does not mis-aim a rename. Not a BLOCK.

## 8. Floor — PASS

```
$ bunx tsc --noEmit
tsc exit: 0
```

```
$ bun test tests/web-client.test.ts
 627 pass
 0 fail
 3985 expect() calls
Ran 627 tests across 1 file. [475.00ms]
```

(All eight SYNC-RF tests green; see `.lane-evidence/web-client-tail.txt`.)

```
$ bun test
1 tests failed:
(fail) what this board counted is what a separate application recorded > the comparison actually ran against both sources [0.14ms]

 3319 pass
 1 fail
 15413 expect() calls
Ran 3320 tests across 179 files. [102.72s]
```

Named red is only `tests/cross-source-token-agreement.test.ts` (`joined.length` 17, needs >20). Same tolerated fleet canary as the lane report. No other `(fail)` line.

## Notes for the master

- Route still stubbed until SYNC-RB; every request assertion is harness `fetch` with a bare `ActionResult`.
- Success toast echoes the typed title; the field does not.
- Drawer pencil is 44px tall / ~26px wide at mobile; row pencils go 44×44 at ≤720px.

VERDICT: PASS
