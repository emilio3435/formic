# VERIFY-sync-cf

Adversarial read-only pass against `VERIFY-BRIEF-sync-cf.md`. HEAD `c9a30ef` (`1ce458a` + follow-up `c9a30ef`). Tree clean of lane source after mutations restored from `.lane-evidence/app.js.pristine`. No commit/push/revert.

## 1. Fence

`git diff-tree --name-only` on the two commits:

```text
1ce458a  src/web/app.js
         src/web/client-state.js
         src/web/styles.css
         tests/repo-sync-close-ui.test.ts
         tests/web-client.test.ts
c9a30ef  tests/repo-sync-close-ui.test.ts
```

Allowed set matches. `LANE-REPORT-sync-cf.md` is gitignored (present, not in the commits).

**client-state.js — one marked field, truly minimal.** The only addition is `syncClose: null` with a `/* SYNC-CF */` comment describing `{ agentId, code, workspaceId, siblingAgents }`. The dialog is a child of the drawer, so `inspectorPaintSig` has to see it or an opening dialog would not repaint. Reusing `confirming` would overload a ControlCapability fkey. One field is the minimum that keeps the dialog honest.

**Four dock guards in `tests/web-client.test.ts` (each marked `SYNC-CF`).** They still measure what they measured:

| Guard | What it measured | What the edit did |
|---|---|---|
| composer / cluster fkeys | Communicate group + secondary toolbar membership | Expected cluster fkeys gained `sync-close:codex:a1` after Archive. Grouping, parent, aria still pinned. |
| “clustering added no control” | fkey names are stable; clustering does not rename | Same pin, plus an explicit note that close is a new route rather than a renamed capability. Button count 5→6. |
| empty secondary / hidden empty dock | capability list → cluster presence | Instruct-only / focus-only cases now pass `ENDED` so close (not a capability) cannot contaminate the capability measurement. `dockFor([])` is unchanged: the pre-existing empty-dock early return still hides a capability-less span. |
| RHSP icon-only tiles | Focus/Interrupt/Archive are icon-only with aria-label | Same assertion, fourth tile `"Close terminal"` on the same terms. |

This is fixture isolation, not a guard weakened to pass. A live instruct-only dock now legitimately grows a close tile; the fkey-list tests cover that. A mutation that enabled close on ended rows still fails the lane file (check 6).

**PASS**

## 2. Locked decision 2 literally

`syncCloseView` enables only `target.resolution === "exact" && surfaceId`. `unique-cwd` / `ambiguous` / `missing` / exact-without-id render a disabled control with operator language on `title` + `aria-label`. The gate does not consult `deriveControlState` (`linked` / `unproven`) — that is the exact trap (Focus/Send accept folder-strength).

Attack: widen the gate to `exact || unique-cwd`. Named test went red:

```text
(fail) SYNC-CF task 1 … > every resolution short of exact renders the control disabled and says why
error: unique-cwd
Expected: true
Received: false
```

Scratch: `.lane-evidence/mut-unique-cwd-enabled.txt`. Restored.

Workspace close is only the confirm button: `sendSyncClose(agent, { target: "workspace", id: record.workspaceId, confirm: true })`. The dock tile always POSTs `{ target: "surface", id }`. The SYNC-CF block in `app.js` contains zero `window` tokens and no `target: "window"`. `renderAgentRow` (the strip’s row renderer) has no close; the strip test is not vacuous — it first asserts the row painted this session.

**PASS**

## 3. Envelope fidelity

POSTs through the one `apiFetch("/api/sync/close", …)`:

- tile → `{ target: "surface", id }`
- confirm → `{ target: "workspace", id, confirm: true }`

`invalid_state` / `confirm_required` with a fully-readable escalation set `state.syncClose` and **return before** `feedback` and `toast`. Test: `invalid_state opens the escalation dialog and sends nothing more` — `calls.length === 1`, `feedback` undefined. `confirm_required` lands in the same `renderSyncCloseDialog`.

Partial-envelope rejection is the `siblingAgents.length !== raw.siblingAgents.length` line in `syncCloseEscalation`. Mutation: drop that line. Named test went red on the `{ agentId, label }` fixture — dialog opened with `siblingAgents: []` (would have printed “No other agents share this workspace” over an unread casualty):

```text
(fail) SYNC-CF task 3 … > an escalation envelope the client cannot fully read renders no dialog
Received: { agentId: "codex:a1", code: "invalid_state", workspaceId: "W", siblingAgents: [] }
```

Scratch: `.lane-evidence/mut-drop-partial-reject.txt`. Restored. Failure path records `feedback.ok === false` (reported, not swallowed).

**PASS**

## 4. Dialog honesty

Siblings render as `<li class="sync-close-sibling">` with `sibling.name`. Empty list: `"No other agents share this workspace."` Warning: `"Closing a workspace cannot be undone."` Cancel calls `cancelSyncClose()` only; after the escalating POST, cancel leaves `calls.length === 1`. Confirm is the second fetch, frozen workspace envelope.

**PASS**

## 5. Keyboard

Focus trap is the dialog `onkeydown`: Tab `preventDefault`s and walks the dialog’s own `[cancel, confirm]` nodes. Escape calls `preventDefault` + `stopPropagation` + `cancelSyncClose`. Initial focus is `focusSyncCloseCancel` → `[data-fkey="sync-close-cancel:…"]`.

Mutation: point that query at `sync-close-confirm`. Named test went red:

```text
(fail) SYNC-CF task 3 … > keyboard: Escape cancels, Tab is trapped, and Cancel takes the initial focus
-   "[data-fkey="sync-close-cancel:codex:a1"]",
+   "[data-fkey="sync-close-confirm:codex:a1"]",
```

Scratch: `.lane-evidence/mut-focus-confirm.txt`. Restored. Escape-bubble test still pins `stopPropagation`.

**PASS**

## 6. Ended rows

`syncCloseView` returns `null` when `isTerminal(agent)` (`finished` or `retained`). Mutation: drop that conjunct. Named test went red — ended fixtures painted an **enabled** Close terminal (`aria-label: "Close terminal"`, no `disabled`):

```text
(fail) SYNC-CF task 1 … > a session the board has stopped watching is offered no close at all
```

Scratch: `.lane-evidence/mut-drop-isterminal.txt`. Restored.

**PASS**

## 7. Strict CSP (trap #7)

`git diff 656f2a9..c9a30ef` has no `style=` (the only `style:` hit is CSS `list-style`). Rendered dialog + tile nodes have no `style` attribute (lane test). Every new visual class has a stylesheet rule. Dialog uses a left signal rail (`border-left: 3px solid var(--bad)` on `.sync-close-inner`), sibling items a 2px `--line` rail, house tokens (`--surface`, `--ink`, `--muted`, `--bad`, `--ember-soft`, `--radius-md`). Not a filled banner.

Residual, not a CSP miss: class `sync-close-cancel` has no dedicated rule. Cancel is `class="btn sync-close-cancel"` and inherits `.btn`; confirm is the one that needs a distinct hue and has `.sync-close-confirm`. No inline style was used to paper over it.

**PASS**

## 8. Floor

```text
$ bunx tsc --noEmit
TSC_EXIT=0
```

```text
$ bun test tests/repo-sync-close-ui.test.ts
 24 pass
 0 fail
 117 expect() calls
Ran 24 tests across 1 file. [53.00ms]
```

```text
$ bun test
1 tests failed:
(fail) what this board counted is what a separate application recorded > the comparison actually ran against both sources [0.15ms]
      at <anonymous> (tests/cross-source-token-agreement.test.ts:644:76)
error: too few sessions joined to be worth believing
Expected: > 20
Received: 17

 3335 pass
 1 fail
 15456 expect() calls
Ran 3336 tests across 180 files. [85.74s]
```

Only tolerated red: `tests/cross-source-token-agreement.test.ts` (fleet canary).

**PASS**

## Residuals (not block)

- Route is still a stubbed fetch; first real integration is after SYNC-CB merges (lane already said so).
- Group-anchor close gate cannot live in this client (`anchor` is absent from `src/web/*.js`); that is CB’s.
- `renderCommandDock` still bails to a hidden span when *no* ControlCapability is advertised, before `closeTool` is built. A hypothetical live exact session with an empty `controls` array would offer no close. Production live rows advertise the dock caps; not a unique-cwd enablement path.

VERDICT: PASS
