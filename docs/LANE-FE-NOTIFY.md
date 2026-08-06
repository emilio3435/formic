# Lane kickoff — fe-notify (Opus 5 xhigh)

**Program:** `docs/superpowers/plans/2026-08-05-confidence-header-and-notification-center.md` — read it first, all of it. It is the spec; this file is only your fence and your start order.

**Worktree:** `/Users/emilionunezgarcia/Developer/the-mountain-main`, branch `fix/cmux-control-health-lifecycle`. **Shared** — other agents are editing it right now. Re-run `git branch --show-current` before every git action and never `git add -A`; stage the exact paths you changed.

**Sub-skill:** superpowers:subagent-driven-development or superpowers:executing-plans. Task by task, checkbox tracking, one commit per task.

---

## Your territory — sole writer

- `src/web/notification-center.js` **(new file, yours alone)**
- `src/web/notifications.js` — **only** the `tone` addition to `notifyToggleView` and the `needsHumanIds` repoint
- `src/web/app.js` — **three named regions only**: `summaryWidgetData`, `renderSummaryWidget`, `renderHealthRail`. Re-read each symbol before editing; line numbers in the plan are anchors from an older commit and the file has moved since.
- `src/web/client-catalogs.js`, `src/web/index.html`, `src/web/styles.css`
- `tests/web-client.test.ts`

## Not yours — do not open with an editor

- `src/server/**` and `src/shared/types.ts` — be-dwell's, and a **live Codex session is writing `src/server/collectors.ts`, `identity.ts`, `identity-bindings.ts`, `process-liveness.ts` right now**. Touching them destroys someone's in-flight work.
- `tests/process-liveness.test.ts`, `tests/snapshot.test.ts`, `tests/fixtures/**` — other lanes'.

## Frozen — the delivery contract, out of scope in every direction

`loadNotifyPreference`, `saveNotifyPreference`, `toggleNotifications`, `deliverNotification`, `NOTIFY_TAG`, `titleWithAlerts`, and permission-on-click-only. Do not refactor them, do not move them, do not "improve" them while passing through. The one behavioral change you are authorized to make is **S1-T5**: repoint *which agents* delivery fires for. Targeting, not mechanics.

---

## Start order

**S1 first, in full. Do not start S2 until the S1 acceptance gate passes.**

1. **S1-T1** `notificationFeed(snap, queueItems, now)` in the new file. Pure derivation, no DOM. Item contract is §4.2 — every field, no optionals invented.
2. **S1-T2** `hasCurrentImpact(item, snap)` — one named function, the §4.3 truth table as its test, the only gate between live and history.
3. **S1-T3** the panel, built to `mockups/notifications-dropdown-proposal-2026-08-05.html` **revision 2**. That file is the design of record; open it in a browser before you write CSS.
4. **S1-T4** badge tone. Ember filled **only** when a person is the blocker. That single sentence is the contract the whole surface rests on.
5. **S1-T5** delivery reads the blocking set.
6. **S1-T6** keyboard, focus, `prefers-reduced-motion`, `(hover: none)`.

**S1 gate:** on the live board, enumerate `issuesOf(snap) ∪ queueItems` and confirm every id resolves to a center item or a documented history demotion. Post the table. S2 (header removals) is blocked on it — the point of the order is that no window exists where a finding is unreachable.

Then S2 → S3 → S4 as the plan lists them. **S2-T3 (the global scan-window statement) lands before the per-card tag comes off Tokens, never after** — otherwise the Tokens card ships an aggregate with an unstated population, which is the exact defect this program exists to remove.

**S0 fields are not on the wire yet.** `blockedSince`, `attentionClass`, `pulse.blocked`, `pulse.standbyMs`, and the new token aggregate are be-dwell's and be-dwell is held. Build against fixtures with the lock-tests gated, and flip the gates at integration. Do **not** invent server fields, and do **not** render a field you have not measured on the real board — that rule is why the plan has S0-T1 and S0-T4 at all.

---

## Constraints that bite

- **Strict CSP.** No inline `style`. SVG meters use attributes.
- **Paint signatures.** The panel gets its own signature. Do not hang it off the widgets guard — that is the bug the settings panel had.
- **CSS class names must appear as whole string literals** in `app.js`; `tests/overhaul-guards.test.ts` and the orphan-CSS check read the file as text. Never assemble a class name at runtime.
- **Dead CSS is enforced.** `every class in styles.css is emitted by the client` will fail you for a leftover rule.
- The summary strip's expansion count stays at **one**.

## Verify before each commit

`bunx tsc --noEmit` (exit 0) then `bun test`. **The suite is `2542 pass / 1 fail` at your baseline** — the failure is `tests/cross-source-token-agreement.test.ts` "no uuid session silently falls out of the join", pre-existing and unrelated. Assert that exact count and that exact test name. **Do not report `0 fail`, and do not touch that test to make it green.** Any *other* failure is yours.

Live verification per §7: throwaway server `MOUNTAIN_PORT=4799 bun src/server/index.ts` from this worktree so the launchd instance on 4701 is untouched. Console clean, AX tree, focus contract, responsive, reduced motion. Screenshot each.

## Stop and escalate — do not improvise

- The S1 parity gate cannot be made to pass.
- Reply's capability gate cannot be reused inline → take the documented degradation (Focus-and-open-drawer, **and say so on the control**); do not build a second send path.
- You find yourself needing to edit a file outside your territory.
