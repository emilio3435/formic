# Cockpit audit: the surfaces outside the drawer

**Scope.** Summary band, agent rows and program rollups, tab bar and its counts, toolbar.
The drawer has had two critique rounds; these four have had none.

**Method.** Four Codex workers at high effort, each owning one surface, measuring the **live
board** at `127.0.0.1:4701` through the shared headless browser — `getBoundingClientRect`,
`getComputedStyle`, `innerText` occurrence counts, and synthetic calls into
`TheAntHill.summaryWidgetData(...)` to prove states the live board was not currently in. I
captured the evidence bundle and screenshots first, because the browse daemon is a singleton
and four concurrent drivers would corrupt each other's measurements.

**Measured at `2be476c`**, 1440×900, drawer docked. Every claim below has a measurement or a
rendered string behind it. Findings are ordered worst-first by operator consequence: actively
misleading, then hides needed information, then repeated under a second label, then cannot
signal, then occupies space without earning it.

---

## 1. The docked roster hides the triage fields on *every* row, not just the selected one

**Evidence.** An unselected, in-viewport row rendered only
`Claude · the-mountain-main | #56889ddb | Working`. Its other fields existed in the DOM with
`display: "none"`: `opus 5 · 44%`, `444k tokens`, `35.6h`. The rule at `styles.css:1650` hides
`.ri-model` / `.ri-tokens` / `.ri-elapsed` for the whole roster whenever the drawer is docked,
though `renderAgentRow` builds them (`app.js:3402`).

**Why it violates the north star.** This is the cockpit failing at its one job. Context fill,
runtime and token burn are exactly what decides *which agent to look at next*. Blanking them
on all 275 rows because one drawer is open forces the operator to open drawers serially to
triage a swarm — the opposite of condensing it.

**Fix.** Scope the docked hide to the selected row only: `.agent-row.is-selected .ri-model`
(and `.ri-tokens`, `.ri-elapsed`). The selected row can stay quiet because its drawer carries
those facts inches away. For unselected rows, collapse the three into one `.row-triage` cell
in `renderAgentRow`, appending control/liveness only when exceptional. Target rendered string:
`opus 5 · 44% ctx · 444k · 35.6h`, plus `· Routing locked` when applicable.

---

## 2. The first screen answers "what is everything doing", not "what needs me"

**Evidence.** `Now` is the hard-coded default (`client-state.js:30`) and is ordered first
(`index.html:68`); `[data-view="now"]` returned `aria-pressed="true"`. `agent-model.js:174`
defines `now: act === "working" || alerting(agent)` against `working: act === "working"`.
Live samples: `Now 13 / Alerts 0 / Working 13`, then `Now 12 / Alerts 0 / Working 12`.

**Why it violates the north star.** The cockpit opens on every routine working agent, with the
attention tab reading `0` beside it. A north star that demands silence about what does not need
attention cannot have "show me all routine work" as its landing state.

**Fix.** Order `needs-you` first in `OPS_VIEWS`, set `state.view = "needs-you"`, make its
button first and current in `index.html`, and rename the label `Alerts` → `Needs you`. Keep
`Now` as a secondary overview — it genuinely diverges when an agent is `activity: "idle"` with
`outcome: "needs-you"` (included by `Now`, excluded by `Working`). The board should open on
`Needs you`, rendering no routine rows until a routine view is chosen.

---

## 3. BURN contradicts itself in a single tile

**Evidence.** `document.querySelector('.widget-burn').innerText` →
`BURN\nNo data\n$19.54 last hour · 31/31 reporting`. In `summaryWidgetData` (`app.js:692`) the
headline is selected from `burn.tokensPerMin` alone while the sublabel is built independently
from `costLastHourUsd` and `coverage`. The rate needs completed five-minute buckets; the cost
comes from BurnBar (`pulse.ts:154`, `pulse.ts:257`).

**Why it violates the north star.** "No data" is a verdict on the whole tile, printed directly
above a dollar figure and a claim of *complete* 31/31 coverage. The operator cannot tell
whether spend is unknown or $19.54.

**Fix.** When `burn.tokensPerMin == null`, set `value: "Token rate unavailable"` and keep the
cost. Rendered: `BURN — Token rate unavailable · $19.54 last hour`.

---

## 4. REFRESH is offered as the remedy for a fault refresh cannot fix

**Evidence.** The HEALTH cell rendered `4 live sessions can't take commands · snapshot 0s ago
… until one is closed. REFRESH`, while `TheAntHill.state` reported `conn:"live"`,
`fetchFailed:false`. `renderSummaryWidget` attaches the button for every `degraded`/`advisory`
state regardless of whether recollection could repair it.

**Why it violates the north star.** The cell names the correct action — close one of the
conflicting sessions — and then renders a button that does something else. The only affordance
present is the one that cannot help.

**Fix.** Render a refresh control only when `state.fetchFailed`, or when the remedy explicitly
requires re-scanning after an external repair. Use `Retry snapshot` for a failed fetch and
`Verify repair` after a "start cmux" style remedy; render no button for "until one is closed".

---

## 5. The summary band can never be silent

**Evidence.** `renderHealthRail` (`app.js:1814`) always renders either `renderPulseCalm` or
every enabled `state.widgetIds`. Calm mode always prints `All clear · N shipping · … · All
clear` (`app.js:1748`). A synthetic issue-free snapshot with only `cmuxReachable:false`
produced `NEEDS YOU 0 / No active findings`, `MOMENTUM 0 / No completion data yet`,
`BURN No data`, `CONTEXT PEAK No data`, `HEALTH Blocked`. The live DOM contained five visible
`.reading-widget` elements.

**Why it violates the north star.** Four cells reporting *absence* surround the one cell
reporting a real fault. A band that always renders cannot signal by rendering, and "All clear"
printed twice in one line is the purest form of the noise this cockpit exists to remove.

**Fix.** In `renderHealthRail`, when `model.calm`, clear and hide `#health-rail` entirely — no
rendered string. In `pulseStripModel`, omit NEEDS YOU at zero, omit BURN/CONTEXT/MOMENTUM when
their data is missing, and omit HEALTH when operational. The synthetic state above should
render exactly one cell: `HEALTH — Blocked · cmux unreachable — Focus and Send cannot route`.

---

## 6. NEEDS YOU and HEALTH render the same fault twice, the second time in a full-width row

**Evidence.** `NEEDS YOU\n1 finding\nTwo live sessions share one cmux pane` and
`HEALTH\nAdvisory\n4 live sessions can't take commands…` followed by the same pane-conflict
explanation and remedy. `attentionSummary` counts `issuesOf(snap)` and `topSourceIssue`
selects from that identical array (`app.js:437`); `healthRemedy` re-renders the same issue's
affected sessions and summary (`app.js:478`). The HEALTH cell measured **1340.8 × 112.2px** —
a second full row for a restatement.

**They can genuinely diverge**, so do not delete HEALTH. Proven synthetically:
`issues:[], cmuxReachable:false` → `NEEDS YOU 0`, `HEALTH Blocked`; a lone agent failure with
healthy sources → `NEEDS YOU 1`, `HEALTH All clear`.

**Fix.** In `pulseStripModel`, treat HEALTH as already represented when `conn === "live"`,
`fetchFailed === false`, `systemStatus(...).key === "degraded"`, `cmuxReachable === true`, and
`topSourceIssue(snap)?.kind === "system"`. In that case omit HEALTH and attach
`healthRemedy(snap)` to the NEEDS YOU cell. One cell: `NEEDS YOU — 1 finding · Two live
sessions share one cmux pane · 4 sessions cannot take commands · close one shared session`.

---

## 7. The Status column restates the tab the operator already chose

**Evidence.** Active tab `Now 11`; the six in-viewport rows returned `Working` six times from
`.row-state`. `viewMatches` admits only working-or-alerting agents to `Now` and pins every
other operational tab to one activity (`agent-model.js:174`); `renderAgentRow` then prints that
activity again (`app.js:3407`).

**Why it violates the north star.** A column where every cell carries the same word is not a
signal, and it consumes the roster's only instrument column while the drawer critique already
established this exact argument for the drawer's status line.

**Fix.** Change the header from `Status` to `Updated / attention`
(`renderAgentColumnHeader`, `app.js:3222`). Render `agoText(agent.updatedAt)` for healthy rows
and prefix only exceptional outcomes: `4m ago`, or `Blocked · 4m ago` / `Alert · 4m ago`.

---

## 8. The count line is the tab bar restated, with a silent population mismatch

**Evidence.** One atomic probe returned tabs `Now 12 / Alerts 0 / Working 12 / Idle 19 /
History 44`, scope note `12 shown · 31 live · 280 tracked`, rollup `126 agents, 11 working,
0 alerts, 725.0M tokens`. That is **12 numeric occurrences carrying 9 distinct values**; the
three `12`s are one set. `shown` is the active tab *after* search/facets (`app.js:2593`) while
tab counts omit those filters (`app.js:2602`) — so they silently disagree once a filter is on.
`live` is working+idle (`app.js:231`), but the Idle tab applies a six-hour lookback
(`agent-model.js:204`), so an idle agent older than six hours makes `live` diverge from
`Working + Idle` with nothing on screen explaining why.

**Why it violates the north star.** `shown` and `live` restate the tabs; `tracked` (280) has no
threshold, no change and no action attached to it.

**Fix.** In `renderScopeNote` (`app.js:2743`) render only interpretation-changing state: add
`N matching` only when search/facets are active, `Lookback 6h · scan 36h` only for
Idle/History, `Last refresh failed` on failure; otherwise `note.textContent = ""` and
`note.hidden = true`. Drop `live` and `tracked`.

---

## 9. The roster's dominant text is the part that is identical across rows

**Evidence.** Four of six in-viewport rows were titled `Codex · the-mountain-main`. Measured:
`.agent-name` = **15px / weight 700 / rgb(18,24,32) / 201.3×21.75px** for the identical text;
`.row-session-tag` = **10.5px / weight 400 / rgb(90,104,118) / 66.8×15.2px** for the only
distinguishing value. `renderAgentRow` computes the correct `nameTag` (`app.js:3301`) but puts
it on the subordinate `.row-identity-tags` line (`app.js:3345`). The drawer, by contrast, puts
its tag inside the `<h2>`.

**Why it violates the north star.** Scanning the roster means reading the smallest, faintest
element on each row; the loudest element repeats the program header directly above it.

**Fix.** In `renderAgentRow`, strip the ` · ${programName(program)}` suffix for the roster only
(the program header already carries it) and move `#${nameTag}` into `.agent-name-wrap`
immediately after `.agent-name` at ~12px/600 muted. Rendered: `Codex #92bf3d43`.

---

## 10. The program rollup truncates to unreadable fragments when docked

**Evidence.** Screenshot at 1440 with the drawer docked shows the header rendering
`121 a…  10 wo…  0 al…  680.4M t…`. Note `scrollWidth` did **not** report clipping for these
cells — the ellipsis is applied such that the DOM measurement agrees with the clipped box, so
this is only provable from pixels.

**Why it violates the north star.** `0 al…` is not information in any language. The cell that
would tell the operator a program has alerts is the one truncated hardest.

**Fix.** Drop the words and keep the numbers with icons or fixed short units
(`121 agents` → `121`, `0 alerts` → hide at zero, see §11), or let the rollup wrap to a second
line when docked instead of ellipsising four cells.

---

## 11. Three counters assert zero permanently

**Evidence.** Tab `Alerts 0` renders unconditionally — `renderTabs` has no zero-count silence
gate. Program rollup renders `0 alerts` per program. NEEDS YOU renders `0 / No active
findings` when calm.

**Why it violates the north star.** "Nothing needs your attention" is the state the cockpit
should express by *saying nothing*. Three separate widgets spend pixels asserting it, and an
operator who learns that `Alerts` always reads 0 stops reading it — which is exactly when it
turns 1.

**Fix.** Hide the `needs-you` tab when its count is 0 unless it is the current view; hide the
rollup alerts cell at 0; omit NEEDS YOU from the band at 0 (covered by §5).

---

## 12. CONTEXT PEAK prints its headline percentage twice

**Evidence.** Rendered: `CONTEXT PEAK / 62% peak window / Peak 62% · Median 7% · 11/11
reporting`. This is the same defect the drawer's Context tile already had fixed; the fix was
not applied to the band.

**Fix.** Drop `Peak 62%` from the sub-line: `62% peak window · Median 7%`.

---

## 13. "Alerts off" and "Alerts 0" use one noun for two unrelated systems

**Evidence.** The masthead control `Alerts off` toggles browser notification delivery; the tab
`Alerts 0` counts agents needing a human. Same word, adjacent surfaces, no shared meaning.

**Fix.** Rename the masthead control to `Notifications off` and the tab to `Needs you` (which
§2 already requires).

---

## 14. The LIVE pill restates freshness the HEALTH cell already carries

**Evidence.** Masthead renders `LIVE`; the HEALTH cell renders `snapshot 0s ago`. Both derive
from connection state and snapshot age.

**Fix.** Keep the pill only when the connection is *not* live — `Reconnecting`, `Offline` —
and render nothing when healthy.

---

## 15. Search is the 13th tab stop and has no shortcut

**Evidence.** `[...focusable].indexOf(document.querySelector('#search')) + 1` → **13**; the six
tabs occupy stops 7–12. All tabs and the search input have `tabIndex: 0`, no `accesskey`.
`boot()` handles keydown only for row navigation and `Escape`.

**Why it violates the north star.** A cockpit is a keyboard surface. Reaching search means
tabbing through every summary control and every tab.

**Fix.** Add `handleCockpitKeys()` in `boot()`: `/` outside an editable control focuses
`#search`. Give `#views` a roving tabindex (only the current tab `tabindex="0"`), with
ArrowLeft/Right/Home/End calling `setView()` and moving focus — collapsing six stops to one.

---

## 16. Lower-severity items

| # | Finding | Evidence | Fix |
|---|---|---|---|
| 16 | Search placeholder is visibly truncated even after shortening | rendered width < text width | Shorten to `Search agents…`; move the field list to `title`/help |
| 17 | `Customize summary` competes permanently with an active finding | always rendered in the band | Move into an overflow menu, or show only on band hover/focus |
| 18 | `Action log` occupies permanent toolbar space with no attention-worthy result | always rendered | Badge it only when a recent action failed; otherwise move to overflow |
| 19 | `Select` renders without checking that anything is selectable, and hides the operation it enables | always rendered | Render only when rows are selectable; label it with the operation |
| 20 | Two `N/M reporting` suffixes name different populations but render identically | BURN `31/31`, CONTEXT PEAK `11/11` | Render only when coverage is *incomplete*; suppress at `N == M` |
| 21 | The 75.4px masthead spends its normal state on branding | `The Ant Hill / LIVE MULTI-AGENT CONTROL ROOM` | Collapse the tagline; reclaim the row for the band |

---

## Themes

Three patterns produced most of the list, and fixing them structurally would prevent recurrence:

1. **Nothing is allowed to be silent.** §5, §11, §14, §20 are all the same bug: widgets that
   render their empty state instead of not rendering. A single convention — *a cell that has
   nothing to report returns null* — removes four findings at once.
2. **Counts are restated rather than referenced.** §7, §8, §12 all print a number that another
   visible element already carries. The rule that fixed the drawer ("every surviving field
   appears exactly once") has not been applied outside it.
3. **Docked layout is treated as a width problem, not an information problem.** §1 and §10 both
   hide or clip fields when the drawer opens, without asking whether the operator still needs
   them. The drawer critique found the same shape at ≤1024px.

---

## Caveats

- Measured at `2be476c` on a board that was healthy apart from one cmux identity conflict.
  States I could not observe live (`outcome: failed`, cmux unreachable) were reached by
  synthetic calls into `TheAntHill.summaryWidgetData(...)`, which exercises the model but not
  the renderer.
- Other lanes were committing throughout; §10's ellipsis and §1's hide rule are behaviours of
  the running build and may already be moving.
- The four workers shared one browser daemon. I forbade `goto`/`viewport`/`click` so their
  reads could not corrupt each other, which also means none of them measured a non-default
  viewport. Widths other than 1440 are unaudited for these four surfaces.
