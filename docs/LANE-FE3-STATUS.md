# Lane FE-3 — status

Branch `fix/cmux-control-health-lifecycle`, shared worktree.
Baseline before any edit: `bunx tsc --noEmit` exit 0, `bun test
tests/web-client.test.ts` 524 pass / 0 fail.

[00:30] START — mapped both subsystems with grep before cutting.

[00:40] SCOPE-A DONE 2a406b7
`bunx tsc --noEmit` exit 0. `bun test` 2835 pass / 1 fail — the one fail is
`docs/a11y-geometry-gate` ("the test board never answered"), named in the
kickoff as a known foreign red needing a live board. `tests/web-client.test.ts`
515 pass / 0 fail (524 − the 9 tests that were the subsystem's own).

Nine tests deleted with the code: three eligibility suites, the dock-chip
source pin, the sendBroadcast request test, `(19a) nothing offers a broadcast`,
`selection mode keeps a way out`, and the two broadcastPaintSig tests.
The row aria-label test now expects the label with no select-mode suffix.
`.agent-row.is-child.is-selecting` left the tree-indent cap test, so it pins
four sites, not five. `broadcast-bar` left the structural-anchor presence list
and was NOT flipped to an absence pin — nothing surviving warrants one, and
the CSS census already forbids the rules coming back without an emitter.

[00:47] SCOPE-B DONE a2f0edf
`bunx tsc --noEmit` exit 0. `bun test` 2833 pass / 1 fail — same
`docs/a11y-geometry-gate` red, unchanged. `tests/web-client.test.ts`
513 pass / 0 fail.

Three tests deleted with the panel (row rendering, `actionRecipients`, the
empty/loading/missing panel states); one added in their place pinning the
three failure SENTENCES, which `loadActions` still writes. The live-route
test keeps its fetch half and now asserts the normalized records the command
dock consumes rather than the panel's DOM.

**Deviation from the kickoff, deliberate.** The kickoff said "`action-log.js`
module and its import." The module survives, stripped to a data module.
`loadActions` / `refreshActions` / `normalizeActions` / `ACTION_KINDS` /
`ACTION_KIND_LABELS` feed the agent drawer's command dock, which prints this
agent's last journalled action beside the button that would send it again
(`.command-dock-last`, `app.js` `renderCommandDock`, populated by the one
`void loadActions()` at boot). That is a live, reachable surface OUTSIDE the
action-log panel, so deleting the module whole would have silently killed it —
the exact failure the kickoff's orphan rule forbids. What went is everything
that painted: `renderActionsPanel`, `renderActionLog`, `actionRowNode`,
`actionRecipients`, `ACTIONS_RENDER_CAP`, and with them the module's
`dom-primitives` / `text-formatters` / `presentation` imports. It now owns no
DOM. `.command-dock-last` CSS stays for the same reason.

[00:47] LANE DONE

## Final state

`bunx tsc --noEmit` exit 0. `bun test` **2833 pass / 1 fail**, the single fail
being `docs/a11y-geometry-gate/notification-center-geometry.test.ts` — a
kickoff-named foreign red that needs a live board. The other named foreign red
(the Board all-clear TDD block) landed as `9ebb698` before this lane started
and is green.

Zero references to either subsystem survive in `src/web/` — the only remaining
`selecting` hits are the English word in two unrelated comments.

Two commits, forward-only, both path-scoped with `git commit -- <paths>`:

| commit | scope |
|---|---|
| `2a406b7` | `refactor(web): remove the select-to-send machinery` |
| `a2f0edf` | `refactor(web): remove the action log` |

A co-tenant's `a3a583f docs(goal): …` landed between the two and is intact;
`git status` shows no tracked modifications and no foreign hunk was swept.
Not pushed. This status file and the kickoff are uncommitted, per the kickoff.

## Status-lined, not done (outside the two subsystems)

- **`POST /api/broadcast` now has no client caller.** `src/server/broadcast.ts`
  and its four test files (`broadcast`, `broadcast-rotation`,
  `broadcast-loopback-only`, `broadcast-selection-bounds` — ~90 assertions) are
  untouched. The kickoff scoped this lane to the client; retiring a live server
  endpoint is a server-side call, not this lane's.
- **`GET /api/actions` and `ActionLogStore` are untouched and still needed** —
  the command dock reads the route. The server-side journalling in
  `src/server/app.ts` is unaffected.
- **`ANT-GUIDE.md`'s "Swarm control" glossary entry was removed** (in Scope A).
  It taught a beginner to click a `Select to send` button that FE-2 had already
  deleted and described machinery this lane deleted. It is documentation OF the
  subsystem, so it went with it. No test pinned it — `tests/ant-guide.test.ts`
  does not cover the glossary, which is worth knowing.
- **`.agent-row[aria-disabled="true"]` was removed with the selection code** —
  select mode was its only emitter. It is an attribute selector, so the CSS
  census (which matches `.class` tokens) would never have flagged it as an
  orphan. Same class of gap as the ANT-GUIDE entry.
- **Pre-existing, NOT mine, not fixed:** `app.js` still carries an
  `/* ---------- out-of-page notification ---------- */` section header standing
  over nothing — its code moved into `notifications.js` in an earlier lane's
  module split. Six blank lines sit under it. Left alone because my removal did
  not orphan it.
