# A11y sweep — the notification center

**Lane:** a11y-sweep (Opus 5 xhigh). **Kickoff:** `docs/LANE-A11Y-SWEEP.md`.
**Program:** `docs/superpowers/plans/2026-08-05-confidence-header-and-notification-center.md` §6, §7.

**Scope, held exactly:** the notification center only — `#notify-toggle`, `#notifications-panel`,
its rows, and the delivery switch in its footer. **The header (S2–S4) was not audited**; it is
mid-build and a finding filed against it tonight would be a finding against code that has already
moved. `src/web/**` was not edited. Every defect below is written up for fe-notify to apply.

**Method.** `MOUNTAIN_PORT=4799 bun src/server/index.ts` — a throwaway server from this worktree,
so the operator's launchd board on 4701 was never touched. Everything below was driven through the
`/browse` skill (gstack headless Chromium) against `http://localhost:4799`, on the **live board**,
not a fixture: 2–4 real blocking agents across `cooper-scheduler` and `the-ant-hill` for the
duration of the sweep.

**Tree measured.** `fix/cmux-control-health-lifecycle`. Findings were first measured over
`cf069ad…4b4afa5` while fe-notify committed underneath, then **every finding was re-measured
against `4b4afa5` with `src/web/` clean** before being written down. The line numbers below are
`4b4afa5`.

**Screenshots:** `docs/a11y-shots/`. **Regression lock:** `tests/notification-center-a11y.test.ts`
(20 tests, 0 fail) pins the invariants that hold. It deliberately does **not** pin the failures —
a defect asserted green stops being a defect.

---

## Verdict table

| # | Check | Result |
|---|---|---|
| 1 | AX tree with the panel open | **PASS with 3 defects** — toggle contract correct, badge count in the name; three naming defects on the panel and its rows |
| 2 | Focus contract | **PASS with 1 defect** — Esc, Tab, Shift+Tab, outside-press all correct; focus is dropped to `<body>` when the focused row leaves the feed |
| 3 | Console clean | **PASS** — zero messages of any level across open → route → close |
| 4 | `(hover: none)` at 420px | **PASS with 1 defect** — no hover-only affordance anywhere; the Focus control misses the codebase's own 44px touch sweep. The media-feature emulation itself is **still NOT RUN** — see §4-emulation |
| 5 | `prefers-reduced-motion` | ~~NOT RUN~~ → **PASS, measured live 2026-08-06 07:2x** under real emulation, both surfaces. See §5 |
| 6 | Responsive 420 / 768 / 1280 | **FAIL at 420px** — no horizontal scroll anywhere, but the panel overflows the viewport's **left** edge by 24px and the clipped strip is unreachable. **Fixed in `fd34a66`; its regression guard is NOT RUN — see §6-guard** |
| 7 | The ember contract, visually | **PASS** — measured on the live blocking board and across all three tones |

⚠ **What is still not observed.** Check 5 **was closed on 2026-08-06** once the
harness gained media emulation — it is now a measured pass, not an argument.
What remains: check 4's `(hover: none)` *emulation* (its conclusion does not
depend on it — §4-emulation), and check 6's *guard*, which measures the
stylesheet rather than the panel. Both are written up in full rather than left as
a green tick; a check nobody can see failing is the failure mode this document
exists to prevent.

**Seven defects, one environment note.** None of them is in the model — `notification-center.js`
came through the derivation probes clean on every fixture. All seven are in the paint.

---

## 1. AX tree — PASS with three defects

Panel open, `browse snapshot -i -s "#notifications-panel"` plus a full CDP
`Accessibility.getFullAXTree`.

**What holds.**

- `#notify-toggle` exposes `aria-expanded` and `aria-controls="notifications-panel"` in the markup
  and re-states both on every paint. Measured `false → true → false` across open, Esc and
  outside-press. It never carries `aria-pressed` — delivery is the switch, this is the disclosure.
- **The badge count is in the accessible name, not only in the glyph.** Accessible name read
  `"Notifications, 2 agents waiting on you"`; the visible `2` is a `<span aria-hidden="true">`.
  All three tones name what the number counts (`…N agents waiting on you` /
  `…N being watched, nobody waiting on you` / `…nothing waiting`).
- Every row's title control is fully named, and the name is a sentence, not a fragment:
  `"Execute lane F-1 from kickoff document is stopped and cannot continue until you answer.
  In cooper-scheduler. Opens the session."`
- **Contrast passes everywhere** in the panel. Measured 21 text/background pairs against their
  composited backgrounds: lowest was `.notify-row-trace` at **4.85:1** (needs 4.5). All three badge
  tones pass: blocked 5.30:1 (white on `--ember`), noticed 4.68:1, clear 5.71:1.

### DEFECT A11Y-3 · The panel has a name that no role permits it to expose

**Selector:** `src/web/index.html:35` — `<div id="notifications-panel" class="notify-panel" hidden aria-labelledby="notify-panel-title">`

**Measured.** CDP `Accessibility.getFullAXTree` with the panel open:

```
role: generic   ignored: false   name: "4 agents stopped"
```

`aria-labelledby` is name-**prohibited** on `role="generic"` (ARIA 1.2). Chrome computes the string
anyway, but the node is a generic container: there is no boundary for a screen reader to enter and
no landmark for rotor navigation to reach.

**What a user hits.** A screen-reader operator presses the toggle, focus lands inside the panel, and
nothing announces *what they just entered*. They hear a button's label with no container context.
There is also no way to jump back to the panel from elsewhere on the page.

**This is inconsistent with the control sitting two nodes away.** `#settings-panel`, in the same
masthead, is `role="dialog"` with `aria-labelledby="settings-panel-title"` — measured live. The
notification panel is the same kind of object (focus moves into it on open, Escape closes it,
outside-press closes it) and got none of it.

**Fix I would make.** Give the panel a role that permits a name. The codebase's own answer inside
this very panel is `role="group"` with an `aria-label` (`app.js:2632`,
`el("div", { class: "notify-instrument", role: "group", "aria-label": "Instrument trust" })`), so:

```html
<div id="notifications-panel" class="notify-panel" hidden
     role="group" aria-label="Notifications"></div>
```

**Verified live**: setting `role="group"` on the element flipped the AX node from `generic` to
`group`, at which point the name is legitimately exposed. Prefer a **static** `aria-label` over the
existing `aria-labelledby="notify-panel-title"`: the title text is `"4 agents stopped"` and changes
on every paint, and a container whose *name* churns is a container a screen reader re-announces for
no reason. Keep `#notify-panel-title` as the `<h2>` it already is.

### DEFECT A11Y-4 · Every Focus button in the panel has the same name

**Selector:** `src/web/app.js:2439` — `acts.append(renderDockTool(found.agent, focusCap, "focus", { fkeyPrefix: "notify:" }))`

**Measured.** Four blocking rows, four buttons, one name:

```
@e2  [button] "Focus"
@e5  [button] "Focus"
@e8  [button] "Focus"
@e11 [button] "Focus"
```

`renderDockTool` (`app.js:7814-7820`) gives the button no `aria-label`; its accessible name is the
visible text. The `title` carries `focusDestinationHint(agent)`, but with text content present the
title becomes the *description*, not the name — many operators never hear it.

**What a user hits.** In a screen reader's button list, or under voice control ("click Focus"), four
identical controls that send four different agents to four different panes. The dock is a
one-agent surface where "Focus" is unambiguous; **this panel is the one place several agents' tools
coexist**, and it is the surface a rotor-driven user is most likely to land on.

It is also inconsistent *inside a single row*: the sibling Reply button is fully disambiguated —
`"Reply to Execute lane F-1 from kickoff document — opens its inspector, where the reply box is"`
(`app.js:2444`).

**Fix I would make.** Do **not** fork `renderDockTool` — reusing it verbatim is deliberate
(`app.js:2427-2433`: same capability gate, same confirm strip, same busy state). Add an opt-in
override honoured only when passed, and pass it from the one caller that has ambiguity:

```js
// app.js renderDockTool(), in the returned el("button", { … })
"aria-label": opts.ariaLabel || null,

// app.js:2439, notifyRowActions()
if (focusCap) acts.append(renderDockTool(found.agent, focusCap, "focus", {
  fkeyPrefix: "notify:",
  ariaLabel: "Focus " + agentName(found.agent) + " — " + focusDestinationHint(found.agent),
}));
```

Every other `renderDockTool` call site is unchanged and keeps the visible label as its name.

### DEFECT A11Y-5 · A quiet row's visible program name is missing from its accessible name

**Selector:** `src/web/app.js:2494` — `"aria-label": item.impact + " " + item.evidence`

**Measured on a rendered watching row** (`docs/a11y-shots/08-watching-row.png`):

```
visible : "the-ant-hill · Execute LANE-FE1 filters documentation has gone quiet. Nothing is …"
aria    : "Execute LANE-FE1 filters documentation has gone quiet. Nothing is waiting on you; …"
```

The visible text opens with the program name (`app.js:2498`, `.notify-quiet-prog`); the accessible
name does not contain it. That is WCAG **2.5.3 Label in Name** (A).

**What a user hits.** A voice-control operator reads `the-ant-hill · …` on screen and says it; the
match fails because the string is not in the name. A screen-reader user hears an agent name with no
program, on a board where the same lane name recurs across programs.

**Fix I would make.** Put the program in the name the same way the blocking row already does
(`app.js:2461`, `… In <program>. Opens the session.`):

```js
"aria-label": (item.source.programName ? item.source.programName + " · " : "") + item.impact + " " + item.evidence,
```

---

## 2. Focus contract — PASS with one defect

| Sub-check | Result | Measured |
|---|---|---|
| Open moves focus into the panel | ✅ | `activeElement` = first `.notify-row-open` |
| Open → Esc → focus back on `#notify-toggle` | ✅ | `{ expanded: "false", hidden: true, active: "notify-toggle" }` |
| Tab reaches Focus and Reply on **every** row | ✅ | 9 stops walked in order: row-open → Focus → Reply ×3 rows, then 2 quiet rows, then the delivery switch |
| No forward trap | ✅ | 10th Tab exits to `#settings-toggle` |
| No backward trap | ✅ | Shift+Tab from the first panel control returns to `#notify-toggle` |
| Outside-press closes | ✅ | click on `.wordmark h1` → `hidden: true`, `aria-expanded: "false"` |
| Focus not lost to `<body>` | ⚠️ | see below |

**On the outside-press landing on `<body>`:** it does, and that is correct. `closeNotificationsPanel(false)`
declines the focus return because the operator's click already chose where to be. **Control run:**
clicking the same non-focusable `<h1>` with the panel *closed* also lands on `<body>` — it is
browser default, not something the panel does.

**Repaint under a held focus is already handled**, and better than expected. With focus on a row's
Reply and the panel's paint signature forced to change, `render()` restored focus to the same
button via `data-fkey` (`app.js:1999-2001`, `2049-2051`). All six buttons the panel builds carry an
fkey — pinned by test.

### DEFECT A11Y-2 · Focus falls to `<body>` when the focused row leaves the feed

**Selector:** `src/web/app.js:2049-2067` — the `focusKey` restore has a fallback only for the drawer.

**Reproduced deterministically**, twice, against `4b4afa5`. Focus a row's Reply; make that agent
stop asking exactly as the server does on the next scan (`attentionSignal.kind = "nothing-wanted"`);
call the app's own `repaint()`:

```json
{ "before": { "fkey": "notify:reply:claude:4a19673c-…", "rows": 4 },
  "after":  { "rows": 3, "rowGone": true, "activeIsBody": true,
              "activeInPanel": false, "panelOpen": true } }
```

**What a user hits.** A keyboard operator is tabbed onto Reply for agent X. X gets answered in the
terminal — which is the *expected, constant* event on this board — the row leaves the feed on the
next 4s snapshot, and focus is thrown from inside an open panel to the top of the document. There is
no visible cue; the next Tab starts from the skip link.

`render()` already knows this failure mode and fixes it for the drawer — the comment at
`app.js:2052-2066` describes exactly this ("the lookup above finds nothing and focus falls to
`<body>` … Measured with a real Enter keypress on the rail: `activeElement === body`") and calls
`focusDrawerLead()`. The notification panel has no equivalent lead.

**Fix I would make.** Capture panel containment beside the drawer's, and give the panel its own
lead — the same node `toggleNotificationsPanel` already chooses on open, so open-focus and
restore-focus agree:

```js
// app.js:2008, beside focusWasInDrawer
const focusWasInPanel = Boolean(document.activeElement
  && $("notifications-panel")?.contains(document.activeElement));

// app.js:2066, beside the drawer fallback
else if (focusWasInPanel && state.notifyPanelOpen) {
  ($("notifications-panel")?.querySelector("button:not([disabled])")
    || $("notify-toggle"))?.focus({ preventScroll: true });
}
```

**Severity note, honestly:** Escape is a document-level listener, so an operator who realises what
happened can still press it and land back on the toggle. The cost is losing your place, not losing
the board.

---

## 3. Console clean — PASS

Fresh load → `console --clear` → open → route to a drawer → Esc → reopen → Esc.

```
open        : (no console messages)
route       : (no console messages)
close cycle : (no console messages)
--errors    : (no console errors)
```

Zero messages of **any** level, not merely zero errors. Routing worked and did not strand focus: the
row's title button closed the panel, opened the inspector, and `activeElement` became
`#inspector-title`.

**One error was produced during this sweep and it was mine.** Injecting a `<style>` element to test
a proposed fix was refused by the page's CSP (`style-src 'self'`) — noted here so the next lane does
not read it as an app defect, and so nobody wastes a cycle trying to prototype CSS that way. Use
`CSSStyleSheet.insertRule` on the same-origin sheet instead; that is what the §6 fix below was
verified with.

---

## 4. `(hover: none)` at 420px — PASS with one defect

**No hover-only affordance exists anywhere in the panel**, at any width. Two independent
measurements:

1. **At rest at 420px, pointer nowhere near the panel**, every row action reported a real box:
   `opacity: 1`, `visibility: visible`, `display: flex|block`, non-zero size. A hover-revealed
   control is one that is *hidden at rest*, so the rest state is the measurement.
2. **Rule-level:** of the 5 `:hover` rules touching a notification selector, **zero** set
   `opacity`, `visibility`, `display`, `transform`, `content`, `width`, `height`, `max-height` or
   `pointer-events`. Every one changes only `background`, `color`, `border-color` or
   `text-decoration`. `.notify-row-meta` also reserves its action space with `min-height: 1.4rem`,
   so nothing reflows under a pointer.

### §4-emulation · `(hover: none)` is **still NOT RUN** — and this time it is the feature, not the tool

Retried on 2026-08-06 after the harness gained `Emulation.setEmulatedMedia`. **It did not take**,
and the failure was isolated rather than assumed:

```
A  setEmulatedMedia hover=none                        -> (hover: none) false, (hover: hover) TRUE
B  setEmulatedMedia prefers-color-scheme=dark  CONTROL -> (prefers-color-scheme: dark) TRUE
C  setDeviceMetricsOverride {mobile:true, 420x900}     -> innerWidth 420, but hover/pointer unchanged
```

**B is the control and it is the whole argument.** The CDP method, the allowlist entry and the
rebuilt daemon all work — a `prefers-*` feature emulates correctly on the same call. So this is
not a broken tool: `hover` and `pointer` are derived from the emulated *input device*, not from
the media-feature override, and C shows that mobile device metrics alone do not move them either.

Closing it needs `Emulation.setTouchEmulationEnabled` (usually with
`setEmitTouchEventsForMouse`) in the allowlist. Only four `Emulation` methods are permitted today
— `setDeviceMetricsOverride`, `clearDeviceMetricsOverride`, `setUserAgentOverride`,
`setEmulatedMedia` — and neither touch method is among them.

**Check 4's conclusion is unaffected, and never depended on this.** "Hover-revealed" means
*hidden at rest*, so the rest-state measurement at 420px answers it directly, and the complete
enumeration of `:hover` rules bounds every way it could have been otherwise. What is NOT RUN is
the media query, not the finding — recorded that way rather than quietly folded into the PASS.

### DEFECT A11Y-6 · Focus is a 32px target where its sibling Reply is 44px

**Selector:** `src/web/styles.css:2873-2881` — the touch sweep inside `@media (max-width: 1024px)`
lists `.notify-act` and `.verdict-action .dock-tool`, but not `.notify-row-acts .dock-tool`.

**Measured** at 420px and at 768px, same row, same line:

| Control | Class | Size |
|---|---|---|
| Reply in inspector | `.notify-act` | 115 × **44** px |
| Focus | `.dock-tool` | 70 × **32** px |

`.dock-tool`'s base is `min-height: 32px` (`styles.css:2505`); the sweep that lifts inline controls
to 44px below 1024px was written for the dock and the verdict head and never picked up the
notification row.

**What a user hits.** On a phone, two controls sitting on one line where one is comfortably tappable
and the other is 27% shorter — and the short one is the one that *moves the operator to the agent*.
The codebase already decided 44px is the number here; this control was missed.

**Fix I would make.** One selector added to the existing sweep at `styles.css:2879`:

```css
.verdict-action .dock-tool, .verdict-action .dw-head-action, .notify-row-acts .dock-tool,
```

**Observation, not filed as a defect.** At 1280px `.notify-act` renders 115 × **21.8** px, under
WCAG 2.5.8 (AA) 24 × 24. It passes via the spacing exception — the nearest target's centre is 98px
away, far outside the 24px circle — so this is a note for whoever next touches desktop density, not
a failure.

---

## 5. `prefers-reduced-motion` — ~~NOT RUN~~ **PASS, measured 2026-08-06 07:2x**

**The harness changed, not the finding.** For the whole program this row was rule-level only,
because `/browse` had no media-emulation command and `Emulation.setEmulatedMedia` was not in its
CDP allowlist. On 2026-08-06 the allowlist gained that entry
(`scope: tab`, `output: trusted`) and the node server bundle was rebuilt. The check is now
observable, so it was run. **This row did not turn green because someone re-read the CSS.**

⚠ The old binary is still `dist/browse` from Jul 15 and does not contain the symbol; the
daemon that enforces the allowlist is `dist/server-node.mjs`, rebuilt 07:20. The CLI does no
client-side validation, so a **daemon restart** is what picks the change up.

**The emulation was proved to take before anything was measured**, because measuring the
`no-preference` branch and reporting a pass would be worse than the NOT RUN it replaced:

```
before emulation   reduce false   no-preference true
after  emulation   reduce TRUE    no-preference false
```

**Panel, open, under real `reduce`:** every transition resolved to `none` / `0s`, and an
enumeration of *every node inside the panel* returned an empty list of animated elements.

```
.notify-row  .notify-quiet  .notify-act  .notify-switch-track
    transition: none   transitionDuration: 0s   animationName: none
anyAnimatedNodeInPanel: []
```

**Clean up chip, mid-sweep, under real `reduce`** — the surface that actually has a keyframe
(`cleanup-spin`), screenshot at `docs/a11y-shots/09-cleanup-reduced-motion.png`:

| Reading | Value | Means |
|---|---|---|
| `animationName` | `none` | `cleanup-spin` is stopped |
| `animationDuration` | `0s` | …and not merely paused |
| `opacity` | `1` | the marker is still **there** |
| `borderStyle` | `dashed` | the static variant took |
| `borderTopColor` == `borderRightColor` | `rgb(154,107,18)` | the ring is complete, not a gap pretending to spin |
| button text | `Examining…` | the state is carried by the label too, not only the mark |
| `aria-busy` | `true` | …and by the tree |

So the chip **does not go blank** when motion is refused: it stops moving and keeps saying a
process is underway, in three independent ways. That is what the rule intended and it is now
observed rather than argued.

The rule-level proof recorded below still holds and is what the committed tests assert; the
live measurement corroborates it rather than replacing it.

**What was measured instead — a complete enumeration, not a spot check.** Every CSS rule in every
loaded stylesheet was walked and tested against every node in `#notify-toggle` and
`#notifications-panel`. **Exactly two** motion rules touch any of them:

```
(prefers-reduced-motion: reduce)        *, ::before, ::after      transition: none !important
(prefers-reduced-motion: no-preference) .notify-row, .notify-quiet, .notify-act,
                                        .notify-peek, .notify-switch-track
                                        transition: background-color .12s, color .12s, border-color .12s
```

So the panel is double-gated: under `reduce` the second rule does not apply *at all*, and the first
kills anything that could, with `!important`. There is no keyframe animation anywhere in the panel.
`styles.css:3137-3139` is the universal kill; `styles.css:3573-3577` is the no-preference block.

**Report this as not-run.** The rule-level proof is strong, and it is still a different instrument
from watching the browser honour the setting. To close it properly, either allowlist
`Emulation.setEmulatedMedia` in gstack browse (one entry, `scope: 'tab'`, `output: 'trusted'`), or
run the panel once under macOS *Reduce Motion* in a headed browser.

---

## 6. Responsive — FAIL at 420px

| Viewport | Document h-scroll | Panel box | Verdict |
|---|---|---|---|
| 420 × 900 | none (`scrollWidth 420 = clientWidth 420`) | **left −24 → right 372** | **FAIL** |
| 768 × 900 | none (768 = 768) | left 266 → right 718 | pass |
| 1280 × 800 | none (1280 = 1280) | left 778 → right 1230 | pass |

The kickoff asks for no horizontal body scroll, and there is none at any width. **The 420px failure
is worse than a scrollbar**: the panel hangs 24px off the *left* edge of the viewport, and because
`body { overflow: hidden }` (measured), left overflow creates no scroll — the clipped strip is
simply unreachable.

### DEFECT A11Y-1 · The panel is clipped off the left edge at 420px

**Selector:** `src/web/styles.css:3337-3342` (`.notify-panel { position: absolute; right: 0; width: min(452px, calc(100vw - 2rem)) }`)
and `styles.css:3588-3593` (the `@media (max-width: 760px)` override, `width: min(452px, calc(100vw - 1.5rem))`).

**Measured at 420px:**

```
.masthead-signals  left 48   right 372     (align-self: center inside a 356px column, styles.css:220)
.notify-panel      left -24  right 372     width 396 = calc(100vw - 1.5rem)
.notify-lede       left -8
.notify-row-open   left -6
body overflow-x    hidden
```

**Root cause.** The width clamp is measured against the **viewport** (`100vw`), but the panel's
right edge is anchored to `.masthead-signals`, which is 48px inside the viewport's right edge. 396px
of panel hung off a 372px anchor leaves 24px outside the window. The comment at `styles.css:3583-3587`
reasons "Width is already clamped to the viewport above" — it is, but the *origin* is not the
viewport edge, and the gutter is a function of the signals row's own content width, so no static
`calc()` can express it.

**What a user hits.** `docs/a11y-shots/03-panel-420.png` shows it: the leading character of every
left-aligned line is cut. `WAITING ON YOU` → `AITING ON YOU`. `cooper-scheduler` →
`ooper-scheduler`. `the-ant-hill` → `he-ant-hill`. `Covers 47 sessions` → `overs 47 sessions`. The
ember rails that mean *a person is the blocker* are partly off-screen. Nothing scrolls it back.

**Fix I would make.** Stop centring the signals row when it is the panel's anchor, and let the panel
fill that anchor instead of overhanging it — this keeps `position: absolute`, which
`styles.css:3583-3587` argues for correctly (a fixed dropdown stops travelling with the button that
opened it):

```css
@media (max-width: 760px) {
  /* The panel is anchored to this row, so at narrow widths the row has to BE
     the content edge — a centred anchor leaves a gutter the width clamp cannot
     see, and the panel hangs off the viewport by exactly that gutter. */
  .masthead-signals { align-self: stretch; justify-content: flex-end; }
  .notify-panel { left: 0; right: 0; width: auto; max-height: 70vh; }
}
```

**Verified live at 420px** by inserting exactly these two rules through `CSSStyleSheet.insertRule`
on the served sheet:

```
before : panel  left -24 → right 372   lede left  -8
after  : panel  left  32 → right 388   lede left  48   h-scroll: none
```

`docs/a11y-shots/06-panel-420-proposed-fix.png` is the result: nothing clipped, ember rails intact,
no horizontal scroll. The panel is 356px instead of 396px at that width, which is the correct trade.

---

## 7. The ember contract, visually — PASS

Verified in two layers, because the kickoff asks for eyes on a real board and the *contract* is a
derivation.

**Layer 1 — the derivation, executed in the live page** against `/notification-center.js` as the
browser loaded it:

| Fixture | feed severities | `feedTone` | `blockingCount` | ember-railed rows | quiet rows |
|---|---|---|---|---|---|
| `stalled-active` only (noticed) | `["warning"]` | `noticed` | 0 | **0** | 1 |
| `input-requested` (blocking) | `["blocking"]` | `blocked` | 1 | 1 | 0 |
| empty board | `[]` | `clear` | 0 | 0 | 0 |

An amber board produces **no blocking severity at all**, so there is nothing an ember could be
earned from. The ember rail is `.notify-row::before` and `notifyRow()` is only ever called for
`model.groups`, which holds blocking items only — a noticed item is rendered as `.notify-quiet`,
which has no rail.

**Layer 2 — the paint, measured on screen** (`docs/a11y-shots/05-badge-*.png`):

| Tone | badge class | background | ink | toggle class |
|---|---|---|---|---|
| blocked | `is-blocked` | **`rgb(194,59,46)`** = `--ember` `#c23b2e` | white | `… is-alerting` |
| noticed | `is-noticed` | `rgba(0,0,0,0)` — **no fill** | `rgb(154,107,18)` amber | *(no `is-alerting`)* |
| clear | `is-clear` | `rgba(0,0,0,0)` | `rgb(90,104,118)` grey | *(no `is-alerting`)* |

`clear` renders a literal `0` rather than disappearing. The live board carried 2–4 blocking agents
throughout and painted `is-blocked` + `is-alerting` every time, with the count matching the rows in
the panel below it. `--ember` as a background appears on **exactly one** badge tone across the whole
stylesheet — pinned by test.

**Hardening note (not a defect).** `notifyRow()` hard-codes `class: "notify-row is-blocking"`
(`app.js:2453`) but `is-blocking` appears **nowhere in `styles.css`**. The ember rail is keyed on
`.notify-row` itself. That is fine today because `.notify-row` is only ever built for blocking
items — but it means the ember is guarded by a *call site*, not by a class. If a future
non-blocking row ever reuses `.notify-row`, it silently inherits an ember rail and the contract
breaks with no test failing. Moving the rail to `.notify-row.is-blocking::before` costs one word and
makes the guard structural.

---

## What was verified, and what it cost

```
bunx tsc --noEmit                     1 error, none of it this lane's — see below
bun test tests/notification-center-a11y.test.ts        20 pass · 0 fail
bun run test:ci   (baseline, my file held out)   2604 tests · 3 fail
bun run test:ci   (my file in)                   2624 tests · 3 fail   ← same three
```

**Run as a controlled comparison, not a single reading**, because the worktree is shared and moving
under the suite. My file adds 20 passing tests and **zero** failures: the failing set is
byte-identical with and without it. An earlier run showed a fourth failure
(`the summary strip never grows its own findings ledger`) which did **not** reproduce — it was
fe-notify's `src/web/app.js` mid-save between two runs, and `renderFindingRow` is absent from
`src/web/` now.

The new suite's assertions were **mutation-checked** rather than assumed: each CSS predicate was
re-run against a deliberately broken copy of the stylesheet and flipped as it should
(a hover rule setting `opacity` is caught; removing the reduce kill is caught; giving `is-noticed`
an ember fill is caught).

The suite reaches the client the way `tests/clean-board.test.ts` does — one bare side-effect
`await import("../src/web/app.js")`, then read the helpers off `globalThis.TheAntHill`, which app.js
already re-exports them onto. No `.d.ts`, no `any` on the import. Source-shaped claims use
`readFileSync` instead, the `tests/web-client.test.ts` pattern.

### Two red things that are not this lane's

**1. `tests/web-client.test.ts` — 3 failing, all under `FE-B: harness-backed client behavior`**
(`(7) pulseStripModel threads the context display`, `(4b) the band reasons about the same context
number it displays`, `(8) CONTEXT PEAK reports the server's peak and median`). That file is
fe-notify's for the whole program and `src/web/app.js` + `styles.css` are dirty in the tree right
now: it is S3's context re-headline mid-build. Baseline was `0 fail` when this lane started; these
three arrived during it, from the header work this audit deliberately did not touch.

**2. `bunx tsc --noEmit`**

```
tests/state-health.test.ts(511,9): error TS2322:
  Property 'showReviewWorkers' is missing in type '{ … }' but required in type 'HubSettings'.
```

`showReviewWorkers` does **not** exist at `HEAD` (`git show HEAD:src/server/settings.ts | grep -c
showReviewWorkers` → `0`). It comes from **another program's uncommitted `src/server/settings.ts`**,
which added a required field without updating that fixture; `tests/state-health.test.ts` is itself
unmodified. Confirmed by the orchestrator as another program mid-edit.

**Deliberately not fixed here.** The one-line fixture change would be finishing someone else's
in-flight edit inside a shared worktree. It is theirs to land. Recorded because the branch's own
verify gate is red for anyone who runs it tonight, and the cause is upstream of every lane's diff.

**This lane's own two errors were real and are fixed.** The first version of the test file imported
named bindings from `../src/web/notification-center.js` and `../src/web/notifications.js` and raised
two `TS7016`s — caught by the orchestrator, not by me, because `bun test` does not typecheck. The
lesson is cheap and worth keeping: **`bun test` green is not `test:ci` green, and neither is
`tsc`.** Run all three.

---

## Handoff — the seven, in the order I would fix them

| # | Defect | Where | Cost |
|---|---|---|---|
| **A11Y-1** | Panel clipped 24px off the left at 420px, unreachable | `styles.css:3588-3593` | 2 rules, verified |
| **A11Y-2** | Focus dropped to `<body>` when the focused row leaves the feed | `app.js:2008`, `2066` | 5 lines |
| **A11Y-3** | Panel's name unexposable — `aria-labelledby` on `role="generic"` | `index.html:35` | 1 attribute |
| **A11Y-4** | N identically-named "Focus" buttons in one panel | `app.js:2439`, `7814` | 2 lines, no fork of `renderDockTool` |
| **A11Y-5** | Quiet row: visible program prefix absent from the accessible name (2.5.3) | `app.js:2494` | 1 line |
| **A11Y-6** | Focus is 32px where Reply is 44px under the touch sweep | `styles.css:2879` | 1 selector |
| **A11Y-7** | `is-blocking` unused — ember guarded by call site, not by class | `styles.css:3424` | 1 word |

Each fix should land with the claim-shaped test that would have caught it; those tests are not in
`tests/notification-center-a11y.test.ts` because they would be red until the fix lands.

---

## Second pass — the Clean up control (2026-08-06 06:5x)

**Scope gap, not a re-audit.** The original sweep was scoped to `#notify-toggle` and
`#notifications-panel`. `cleanupAction()` shipped in S6-T3 *after* it and landed in main
without any a11y pass. It lives on the header instrument-trust chip
(`app.js:2280`, `.verdict-cleanup`), so no check above ever touched it.

Same server: `MOUNTAIN_PORT=4799`, live board, `/browse`. The board carried no debris, so
`cleanupOffered()` was false; the control was brought on screen through its own render path
by setting `state.cleanup.error` — a state the app reaches on its own whenever enumeration
fails — never by hand-editing the DOM.

| # | Check | Result |
|---|---|---|
| C1 | Does the running state reach the screen at all? | **FAIL** — the header never repaints during a sweep |
| C2 | Focus on activation | **FAIL** — falls to `<body>` and never returns |
| C3 | Is the transition announced? | **FAIL** — the live region is destroyed and recreated every paint |
| C4 | Contract sentence in `title` | **PASS, with a caveat** — the orchestrator's suspicion was half right; see C4 |
| C5 | Mark `aria-hidden`, colour-only signal | **PASS** |
| C6 | Target size | **PASS via the 2.5.8 spacing exception** — 74.8 × 17px, nearest target 101px away |
| C7 | `prefers-reduced-motion` static variant | ~~NOT RUN~~ → **PASS, measured 2026-08-06 07:2x** — spin stopped, dashed marker still visible; see §5 |

### CLEAN-1 · The entire running state was unreachable — FIXED

**Selector:** `app.js` `renderHealthRail()`'s paint signature (the `paintUnchanged("widgets", …)` guard).

The Clean up button lives in the header rail. The rail's paint signature signs widget values,
tones and sublabels — **and nothing about the sweep**. Not one signed input moves while a
sweep is in flight, so the guard returns early and the button is never rebuilt.

Measured on the live board, with the guard left alone:

```
resting                     text "Clean up"   disabled false  markOpacity 0
running, guard intact       text "Clean up"   disabled false  markOpacity 0   ← no change at all
running, guard invalidated  text "Examining…" disabled true   markOpacity 1   ← the UI is correct
```

A real activation confirmed it end to end: `running` went `true → false` while the button
read `"Clean up"` throughout and the indicator never appeared.

**What a user hits.** They press Clean up and *nothing happens*. No label change, no spinner,
no busy state — on a control whose entire S6-T3 design is "a rotating indicator on the chip
and nothing else". The sweep runs and its result appears in a different surface. The obvious
next move is to press it again.

**The same bug was already found and fixed one surface away.** The notification panel's
signature signs the sweep, with a comment saying why: *"The sweep's own state, or the panel
would freeze mid-run: the indicator starts and the plan arrives without any snapshot value
changing."* The rail holds the **button** and never got the same treatment.

**Fix:** three lines added to the rail's signature — `state.cleanup.running`, `.at`, `.error` —
mirroring the panel's. Verified with the guard untouched: `"Examining…"`, `aria-busy="true"`,
indicator visible.

### CLEAN-2 · Focus fell to `<body>` on activation and never returned — FIXED

**Selector:** `app.js:2285`, `disabled: running ? "" : null`.

This is A11Y-2 by a third route, and it was **masked by CLEAN-1** — the button never actually
disabled, so the defect could not be observed until the repaint was fixed. Measured under a
repainting rail:

```
focus the button          activeElement = .verdict-cleanup
sweep starts              activeElement = BODY        node replaced, new node disabled
sweep settles             activeElement = BODY        never restored
control vanishes          activeElement = BODY
```

`render()` restores focus by `data-fkey`. It *finds* the rebuilt node — so the `else if`
fallbacks never run — and calls `.focus()` on it, which does nothing because the node is now
`disabled`. On the next paint `focusKey` is read off `<body>`, which has no `fkey`, so there
is nothing left to restore. Focus is gone for good.

**What a user hits.** A keyboard operator presses Enter on Clean up and is silently returned
to the top of the document, mid-task, with no way back except re-tabbing the whole page.

**Fix:** `aria-disabled="true"` instead of `disabled`. It says the same thing to assistive
tech while keeping the control in the tab order, and `requestCleanupProposal()` already
refuses re-entry (`if (state.cleanup.running) return`), so nothing depends on the native
attribute. CSS moves from `:disabled` to `[aria-disabled="true"]`. Verified: focus stays on
`.verdict-cleanup` through running **and** settled.

### CLEAN-3 · The announcement could never fire — FIXED

**Selector:** `app.js:2289`, `"aria-live": "polite"` on the button itself.

Measured: the button node is **replaced on every paint** (`sameNodeAsBefore: false`). A live
region that is destroyed and recreated announces nothing — the region has to already be in
the tree when its content changes. So the one non-visual signal this control had could never
fire, and a spinner says nothing to a screen reader. Combined with CLEAN-1, a non-sighted
operator got **no signal whatsoever** that a sweep had started.

**This codebase already knew.** `index.html` says it in its own words about `#bar-scope-note`:
*"an aria-live region that is destroyed and recreated announces nothing: the region has to
already be in the tree when its content changes."*

**Fix:** a static `#cleanup-status` (`role="status"`, `aria-live="polite"`, visually hidden)
declared in `index.html` beside `#scan-window` — `renderHealthRail` only empties
`#health-widgets`, so it survives the paint that relabels the button. `announceCleanup()`
writes to it at both transitions; the misleading `aria-live` comes off the button. Verified on
a real sweep: *"Cleanup sweep running…"* then *"Cleanup proposal ready…"*, with
`regionNodeStillOriginal: true`.

### C4 · The contract sentence — the suspicion was half right

**Measured, not assumed.** Chrome's AX tree exposes the `title` as the accessible
**description**, in full:

```
role: button   name: "Clean up"
description: "Propose a cleanup: enumerate abandoned worktrees, merged branches and dead
              panes. Nothing will be deleted without your approval — you paste the confirm
              command yourself."
```

So *"invisible to screen readers"* is **wrong** — it is exposed, and the contract is
reachable. Two halves of the concern do stand: a description is announced inconsistently
across AT and verbosity settings, and `title` needs hover, so on touch the sentence is
**unreachable by any means**.

**Not fixed, and deliberately.** Promoting it to `aria-describedby` on a visible node would
put a 30-word sentence permanently inside a compact header chip, which is the "standing scold"
S6-T3 removed on purpose. The honest options are a visually-hidden `aria-describedby` target
(fixes AT, not touch) or moving the contract into the proposal surface the operator reaches
before any command runs — which is where the confirm command already lives. **That is a
design call, not an a11y fix, so it is written up here rather than decided by this lane.**

### C5, C6, C7 — measured, no action

- **`.verdict-cleanup-mark` is correctly `aria-hidden="true"`**, 9×9, `opacity: 0` at rest.
- **Not a colour-only signal.** The state is carried by presence/absence plus a label change
  (`Clean up` → `Examining…`), not by hue. Text contrast 4.68:1 against its composited
  background (needs 4.5).
- **Target 74.8 × 17px**, at 1280 *and* 420 — under WCAG 2.5.8's 24×24. **Passes via the
  spacing exception**: the nearest other target's centre is 101px away, far outside the 24px
  circle. Recorded as an observation, the same treatment `.notify-act` got at desktop, not
  filed as a defect.
- **`prefers-reduced-motion`: NOT RUN**, same harness limit as check 5. `styles.css:3671`
  switches the rotation for a dashed static ring, and the rule is asserted at rule level only.
  The source comment already says so, which is the right form.

---

## Status — 2026-08-06 23:4x, all seven closed

| # | Defect | Landed | Verified |
|---|---|---|---|
| A11Y-1 | panel clipped 24px off the left at 420px | `fd34a66` (fe-notify) | panel `32 → 388`, nothing clipped |
| A11Y-2 | focus dropped to `<body>` when the focused row leaves the feed | `62a7f04` | `activeIsBody false`, `activeInPanel true` |
| A11Y-3 | panel name unexposable on `role="generic"` | this commit | AX tree: `role: group, name: "Notifications"` |
| A11Y-4 | four buttons named exactly `"Focus"` | this commit | `"Focus Debug schedule draft generation algorithm"` |
| A11Y-5 | quiet row's visible program missing from its name | this commit | `name.includes(visibleProgram) === true` |
| A11Y-6 | Focus 32px beside a 44px Reply | this commit | both 44px at 420px |
| A11Y-7 | `is-blocking` unused — ember guarded by call site | still open | — |

Each fix was measured on the live board before and after, not asserted. Two
things are worth carrying forward from doing them:

**The first A11Y-4 draft was worse than the defect.** Appending
`focusDestinationHint` to the name produced *"Focus Execute lane F-1 — Jump to
COOPER DRAFT · F1 pane · Claude bare ·… · /Users/…/cooper-scheduler.worktrees/draft-f1"*
— a home path read aloud one segment at a time, on every row. Caught by looking
at the rendered name rather than at the diff. The name disambiguates; the
destination stays on `title`, where it is a description an operator can ask for
instead of one they must sit through.

**`bun test` on one file is not a gate.** This lane shipped two errors that only
`tsc` or the full `test:ci` could see: a `TS7016` from importing an untyped
browser module, and a literal **NUL byte** in a test file that tripped
`check-nul-files` and would have failed CI. Both were invisible to a green
single-file run. `bunx tsc --noEmit` **and** `bun run test:ci`, every time.

### §6-guard · Check 6's regression guard — NOT RUN, and here is what it would take

The `align-self: stretch` assertion in `tests/notification-center-a11y.test.ts`
**does not guard A11Y-1**, and is now annotated in place saying so. Three
mutations measured at 420px:

| Mutation | Panel box | Clipped? | Text guard |
|---|---|---|---|
| A · anchor reverted to `align-self: center` | `48 → 372` | no | **RED** (false positive) |
| B · centred anchor + viewport-measured width — *what shipped* | `-24 → 372` | **yes** | RED |
| C · anchor stretched, width clamp back | `-8 → 388` | **yes** | **GREEN** (blind) |

A geometry test that measures the box itself, and catches both B and C, is
written and validated — 13 pass today, 2 fail on route B at `panelLeft -24`, 2
fail on route C at `-8`. **It is parked at `docs/a11y-geometry-gate/`, not in
`tests/`, and it does not run.** The full reasoning, the mutation evidence and
the four steps to un-park it are in that directory's README.

The short version: it needs a real CSS layout engine, and this package has none —
`devDependencies` is `@types/bun` and `typescript`, and jsdom/happy-dom do not
implement layout at all, so `getBoundingClientRect()` returns zeros. In `tests/`
it would red-light CI at `beforeAll`; it needs a `LOCAL_ONLY` entry in
`scripts/ci-tests.sh`, which belongs to another lane. A filename that dodges that
glob was considered and rejected — `ci-tests.sh` keeps exclusions in one visible
place on purpose.

**So check 6's regression guard is text-only today, and blind to route C.** Same
standing as the `prefers-reduced-motion` row: a stated gap, not a covered row.
Adding the `LOCAL_ONLY` line makes it a real local gate that CI still never runs;
only a headless browser in `devDependencies` would make panel geometry
CI-enforceable, and that is Emilio's call, not a lane's.

**Standing by for the header audit once S2–S4 land.**
