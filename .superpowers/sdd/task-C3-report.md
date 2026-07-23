# Task C3 Report — Density + keyboard pass (WS-C lane, final implementation task)

**Lane:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-tree-glance`
**Branch:** `ant-hill/luna-tree-glance-20260722` (tip was `97275aa`, the reviewed C2 head)
**Commit:** `2295975` — `feat(rows): density pass with touch + keyboard integrity`
**Status:** DONE

---

## What shipped

A single values-only CSS rule: at `min-width: 1440px`, `.agent-row` vertical padding
tightens from `0.45rem` to `0.35rem` (top + bottom) so more of the colony fits per
screen. Nothing else — no structure, no markup, no JS, no focus behavior.

Diff is exactly two files (84 insertions, 0 deletions):
- `src/web/styles.css` — the compact rule (12 lines: comment + one `@media (min-width: 1440px)` block with one `.agent-row` override), placed at the top of the `responsive` section.
- `tests/web-client.test.ts` — the C3 describe block (three intent tests).

```css
/* top of the responsive section */
@media (min-width: 1440px) {
  .agent-row { padding-top: 0.35rem; padding-bottom: 0.35rem; }
}
```

---

## Chosen value + derivation

**`0.35rem` top/bottom, from `0.45rem`.** Not an invented pixel — it is one step
down the `agent rows` section's own spacing scale, and specifically it is the
`.agent-column-header`'s bottom padding:

```
.agent-row            { padding: 0.45rem 0.85rem 0.45rem 0.8rem; }   (base — comfortable)
.agent-column-header  { padding: 0.45rem 0.85rem 0.35rem 0.8rem; }   (0.35rem bottom step)
.shelf-title          { padding: 0.55rem 0.75rem 0.35rem;       }   (0.35rem also appears here)
```

So the compact row's vertical rhythm at width matches the header it sits directly
under. Horizontal padding is deliberately left to the base rule (longhand overrides
only top/bottom of the shorthand): the compact row keeps `0.85rem` right / `0.8rem`
left, verified live as `padRight: 13.6px / padLeft: 12.8px`.

**Why the cut lands on the rows that matter.** Measured before any change at
1440x900, the base row is `59.86px` tall against a `min-height: 52px` floor — for
this shape the floor does NOT bind; height is content-driven (name line + summary
line + padding), so the padding cut lands directly on row height. **This holds only
for rows that carry a summary line — which is every row in live data (108-119 char
summaries → 56-76px).** A sparse, name-only row (no summary) IS floor-bound and the
rule is a harmless no-op for it; see **## Review fix — floor claim** below for the
measurement. `min-height` is left untouched (structure).

---

## Row-count delta at 1440x900

Measured in the live `Idle` roster (real data), viewport `1440x900`, roster pane
(`.pane-list`) visible height `696px`:

| | Before (`0.45rem`) | After (`0.35rem`) |
|---|---|---|
| Row padding (top/bottom) | 7.2px / 7.2px | 5.6px / 5.6px |
| Standard row height | 59.86px | 56.67px (**−3.19px, −5.3%**) |
| Tall row (tags+note) | 78.89px | 75.70px (−3.19px) |
| `min-height` | 52px | 52px (unchanged) |
| Roster pane visible height | 696px | 696px |

The per-row shrink is exactly `2 × (7.2 − 5.6) = 3.2px`, confirming only vertical
padding moved.

**Rows that fit the 696px pane (standard rows):**
- Before: `floor(696 / 59.86) = 11` rows (12 × 59.86 = 718px > 696).
- After: `floor(696 / 56.67) = 12` rows (12 × 56.67 = 680px < 696; 13 × 56.67 = 737 > 696).
- **Delta: +1 row (11 → 12).** A full 12-agent program of standard rows now clears
  the fold where before the 12th row was pushed to scroll.

(Standard = a row carrying a summary line, i.e. every row in live data — these are
content-bound, above the 52px floor, so the padding cut applies to them. The +1
delta is unaffected by the sparse-row floor finding in the review-fix section below.)

In the live grouped roster (rows interleaved with program-header chrome), the
direct in-pane count moved `fully-visible 3→3, partially-visible 3→4` (a 4th row
now peeks in) — but the live data's row count shifted between the two snapshots
(9 idle → 8 idle), so that grouped count is not a matched comparison. The
deterministic per-row shrink + rows-per-pane calc above is the honest headline.

**No clipped text.** At 1440, an automated scan of every `.agent-name`,
`.row-summary`, `.row-state`, and `.ri-value` against its row box returned
`0 vertically-clipped text nodes`. Screenshot confirms both row lines (name +
summary) render fully; horizontal ellipsis on long summaries is pre-existing and
unrelated.

---

## Breakpoint fencing (compact rule cannot leak below tablet)

Computed `.agent-row` `padding-top` measured live across widths:

| Width | padding-top / bottom | Meaning |
|---|---|---|
| 1440 | 5.6px / 5.6px | compact rule active |
| 1439 | 7.2px / 7.2px | just below breakpoint — base 0.45rem |
| 1280 | 7.2px / 7.2px | base |
| 1024 | 7.2px / 7.2px | base (row density unchanged vs C2) |
| 375 | 7.2px / 7.2px | base (row density unchanged vs C2) |

Clean cutover at exactly 1440. Row heights at 1024 and 375 are unchanged from C2.

---

## Touch integrity (44px sweep intact)

The `<1024px` 44px touch sweep is a `max-width` rule; the density rule is
`min-width` — they never overlap. Verified live: `.agent-rename` (the one
agent-row-scoped control in the sweep) computes `min-height: 44px` at both 1024
and 375, and `auto` at desktop widths (unchanged, correct — pointer input).
The sweep's full selector list is unmodified.

---

## Keyboard integrity (full row path still works)

Exercised live at 1440 (compact padding active), reported step by step:

1. **Focus the row** — `.agent-row` (`role="button"`, `tabindex="0"`) receives
   focus; `document.activeElement` is the row; computed `padding-top` is `5.6px`
   (compact rule active while focused). Focusability survives the padding change.
2. **Enter** — drawer opens: `body.inspector-open = true`, `.pane-inspector`
   present and not `[hidden]`, and focus moves into the drawer to `.inspector-title`.
3. **Tab (in drawer)** — focus advances to `.btn.inspector-close`, still contained
   within the drawer (focus stays in the drawer).
4. **ArrowRight** — no-op on the close button (arrows navigate only where already
   wired, e.g. tablists; the close button doesn't consume them). No breakage.
5. **Escape** — drawer closes (`inspector-open = false`, `[hidden]` set) and focus
   returns to the exact opening row (`agent-codex:019f8da7-…`) via the stable-fkey
   restore loop.

Nothing about focus order or focusability changed — expected, since the change is
padding-only.

---

## TDD RED → GREEN

**Tests (C3 describe block, `tests/web-client.test.ts`):**
- **(a)** a `≥1440px` rule tightens `.agent-row` vertical padding to `0.35rem`
  (extracts the media-block body, asserts both edges; also locks the derivation by
  asserting the `.agent-column-header`'s `0.35rem` bottom padding still exists).
- **(b)** honest regression guard: the `<1024px` 44px touch sweep keeps its full
  selector list including the row's `.agent-rename` control (quotes the list anchors
  end-to-end). Disclosed per the honest-guard precedent — this **passes before**
  implementation.
- **(c)** the compact rule is fenced inside `min-width:1440px`: the base row keeps
  `0.45rem`, the `padding-top: 0.35rem` override appears exactly once, and it does
  not appear in the `<1024px` or `<720px` max-width blocks.

**RED** (`bun test`, before implementing): `288 pass, 2 fail` — (a) and (c) failed
for the right reason (no `@media (min-width: 1440px)` existed, so the extracted
block was empty and `padding-top: 0.35rem` matched zero times); (b) passed as
disclosed.

**GREEN** (`bun run check`, after implementing): typecheck clean, `290 pass, 0 fail`
(287 baseline + 3 C3 tests). Full suite, none skipped.

---

## Screenshots

- 1440 after: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/c3-after-1440.png`
- 375 after: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/c3-after-375.png`

(Browse writes only under `/tmp` or the repo root, so these were captured to
`/tmp/c3-after-*.png` and copied into the QA baseline dir, matching how the earlier
C1/C2 shots landed there.)

---

## Self-review

- **Values-only diff:** yes — `git diff --stat` = `styles.css` (compact rule) +
  `web-client.test.ts` (C3 tests). Zero JS, zero markup, zero structure. No `app.js`
  edit, so the contract's stop rule never tripped.
- **Compact rule fenced inside `min-width: 1440px`:** yes — verified at 1439/1280/
  1024/375 the row stays at base `0.45rem`.
- **Sweep guard intact:** yes — `.agent-rename` still clears 44px at ≤1024; the
  `<1024px` sweep list is byte-unchanged.
- **44px constraint inviolable:** honored — the density rule is `min-width` only and
  cannot reach the touch range.
- **Derived, not invented:** `0.35rem` = the section's existing header bottom-padding
  step.
- **No layout fault exposed:** the "before you begin" check — tightening padding at
  1440 exposed no clipped text or misaligned cluster (0 clipped nodes; instrument
  columns still aligned). Nothing adjacent was touched.
- **Evidence complete:** row-count delta (+1 for a 12-row program), keyboard walk
  (5 steps), breakpoint table, touch table, RED→GREEN, screenshots. Preview killed.

---

## Review fix — floor claim

**Reviewer's Important (evidentiary):** my original claim "the 52px min-height floor
does NOT bind; row height is content-driven" was stated universally, but I had only
measured standard (with-summary) and tall (with-tags) rows. The reviewer's
back-of-envelope suggested a sparse row (short name, no summary) likely sits at or
under the floor already, making the blanket claim false. Fix requested: measure a
sparse row and amend the claim. No code change expected (a binding floor is inert).

**Method.** Re-opened `scripts/anthill-preview.sh` (port 4710) + browse skill.
Surveyed every live row across Now / Idle / History at 1440x900: **no sparse row
exists in live data** — every rendered row carries a summary line (`summaryLen`
108-119 chars), so the sparsest real row is 56.67px (content-bound). To measure the
sparse shape, I took the closest real row and stripped its summary + tags nodes to
name-only, then read the unconstrained `.row-identity` height (the row-identity has
no `min-height`; only `.agent-row` does, so this reads true content height). Ephemeral
DOM edit for measurement only; the live re-render restores it. No app code touched.

**Measurement (1440x900):**

| Quantity | Value |
|---|---|
| `.row-identity` with summary | 45.48px |
| `.row-identity` name-only (summary + tags removed) | **24.8px** |
| Compact vertical padding (0.35rem × 2) | 11.2px |
| min-height floor | 52px |
| Sparse row natural height @ **0.35rem** (compact) | 24.8 + 11.2 ≈ **36px** → **< 52px, floor BINDS** |
| Sparse row natural height @ **0.45rem** (base) | 24.8 + 14.4 ≈ **39.2px** → **< 52px, floor BINDS** |

(Direct JS boolean checks returned `floorBinds_compact: true`, `floorBinds_base: true`.)

**Corrected claim (replaces the universal statement):**

> The 52px min-height floor **binds for sparse (name-only, no-summary) rows** at
> ~24.8px content: such a row renders at the 52px floor at **both** 0.45rem and
> 0.35rem, so the density rule is a **no-op for that shape**. This is harmless — the
> cut applies only where content already exceeds the floor. Rows that carry a summary
> line — **every row in live data** (108-119 char summaries → 56-76px, content-bound)
> — are above the floor and DO get the −3.2px density benefit. So in practice every
> currently-rendered row is content-bound and shrinks; the no-op affects only a
> name-only shape that does not occur in the current data.

**Why no code change.** A floor larger than the content is inert: the sparse row's
24.8px content sits comfortably inside the 52px box — no clipping, no misalignment,
no overflow. The reviewer's expectation (a binding floor is harmless, code unchanged)
holds. The density rule stays exactly as shipped; it delivers the gain on the rows
that exceed the floor and is safely inert on the rest.

**Code changed:** none. `styles.css` and `tests/web-client.test.ts` are unchanged
since commit `2295975`; only this report was amended.

---

## Final fix wave

The consolidated fix wave from the whole-branch review — exactly the six approved
items, nothing else. Five commits on `ant-hill/luna-tree-glance-20260722` (tip was
`2295975`), all local. Baseline `290 pass`; final **`295 pass, 0 fail, 0 skipped`,
typecheck clean**. Net +5 tests (2 Important-1, 1 Important-2, 1 Triage-1, 1
Triage-4; Triage-11 added an assertion to an existing test). Diff across the wave:
4 files, +183 / −32.

| Commit | Item(s) |
|---|---|
| `3c67882` | Important 1 — wire recollect + lastHealthyAt |
| `36e76c1` | Important 2 — focus ring survives alert rails |
| `1ccdb35` | Triage 1 — alerts count ember ink |
| `de9c205` | Triage 4 + 11 — deferred guard tests |
| `e7baf34` | Triage 17 — DESIGN-LANGUAGE.md sync (doc-only) |

### Important 1 — wire the B1 contract into the UI (`3c67882`)

The degraded-verdict Refresh called `fetchSnapshot()` (GET, re-serves cache);
`POST /api/recollect` was built by B1 but never consumed. Also rendered "since
when" on the degraded reason from `sourceHealth.byProvider[*].lastHealthyAt`.

- **Mechanism.** Extracted the shape-guard + state-adopt + render body of
  `fetchSnapshot` into a shared `applySnapshot(snap)`; `fetchSnapshot` now calls it,
  and new `recollectSnapshot()` POSTs `/api/recollect` (no body, same-origin) and
  applies through the same path. A non-OK envelope (403/500) or a network error
  falls back to `fetchSnapshot()` so Refresh is never dead. Button `onclick` →
  `recollectSnapshot()`. This is a reuse of the apply path, not a fork — the STOP
  condition ("recollect wiring fights the snapshot-apply path") never tripped.
- **"Since when."** New pure helper `degradedSinceText(snap)`: among currently
  degraded (`healthy === false`) byProvider sources, the most recent non-null
  `lastHealthyAt`, formatted with the existing `agoText` → `" · last healthy 12m
  ago"`. Null (never healthy) → `""` (honest omission). Appended to the reason line
  before the snapshot note; exported on `TheAntHill`.
- **RED→GREEN.** Wrote the intent test (handler references `/api/recollect` POST +
  `applySnapshot` + `fetchSnapshot` fallback; both consumers share the path) and the
  executable `degradedSinceText` test (present → `" · last healthy 12m ago"`; null →
  `""`; no byProvider → `""`), and updated the existing degraded-refresh assertion.
  RED: `289 pass / 3 fail` (2 handler string-misses, 1 `M.degradedSinceText is not a
  function`). GREEN after impl: `292 pass, 0 fail`, typecheck clean.

### Important 2 — keyboard focus ring on alert rows (`36e76c1`)

`.agent-row.is-needs-you:not(.is-selected)` (and `-blocked` / `-failed`) at (0,3,0)
clobbered the (0,2,0) `:focus-visible` ring on the same `box-shadow` property, so
keyboard focus went invisible on exactly the alert rows.

- **Mechanism.** Added three `:focus-visible` variants at (0,4,0) combining rail +
  ring via the file's comma-combine idiom (cf. `.finding.pin.is-selected`), placed
  immediately after the plain rails so the existing alert-rail test still first-matches
  the plain rule.
- **RED→GREEN.** Intent test (g) extracts each of the three rules and asserts BOTH
  shadow components (`inset 4px 0 var(--needs|blocked|failed)` + `inset 0 0 0 1px
  var(--line-strong)`). RED: 1 fail (rules absent). GREEN: `293 pass, 0 fail`.

### Triage 1 — ember ink on the Alerts tab count (`1ccdb35`)

- **Mechanism.** `renderTabs` computes a numeric `count` and, for the `needs-you`
  (Alerts) tab, `countNode.classList.toggle("is-alerting", count > 0)` — converging
  on C2's rollup modifier name (also answers the reviewer's Minor 3 toolbar-direction
  drift). CSS `.view-tab .count.is-alerting { color: var(--ember); }` (ink only, no
  fill), placed after `.view-tab.is-current .count` so ember wins by source order on
  the active Alerts tab. The drawer's `is-alert` was deliberately left unrenamed.
- **Test idiom.** `renderTabs` reads module-private `state` and needs
  `getElementById`/`querySelectorAll`, which the `withDom` fixture does not provide —
  so, exactly like the sibling `is-current` toggle (tested by source-intent at
  `classList.toggle("is-current"`), this is a source-intent + CSS test, not
  fixture-executed. Disclosed here as the honest limit of the harness; the LIVE
  behaviour was then verified in the preview (below).
- **RED→GREEN.** RED: 1 fail (toggle + CSS rule absent). GREEN: `294 pass, 0 fail`.

### Triage 4 + 11 — deferred guard tests (`de9c205`)

Both are honest guards over markup/source that already conforms — disclosed as such,
no implementation change, so both pass on first run (no RED phase, by nature).

- **Triage 4.** Asserts `index.html` seeds `class="view-tab is-current"
  data-view="now" aria-pressed="true"` on the default Now tab, locking the
  currentless-first-frame guard.
- **Triage 11.** Added `not.toContain('class: "usage-val", text: row.startTime')`
  beside the existing Provider/Model negative checks in the A5 usage-table test,
  covering the When cell.
- GREEN: `295 pass, 0 fail` (+1 test for Triage 4; Triage 11 is an added assertion).

### Triage 17 — DESIGN-LANGUAGE.md sync (doc-only, `e7baf34`)

Both copies kept byte-identical (lane commit + `cp` to the untracked
`the-mountain-main` canonical, no git there; shas match `546a377910ce`).

- Replaced all three dead `.row-fact-value` citations (deleted by C1) — lines ~124
  and ~246 → `.ri-value`; the third was inside open question 4, rewritten.
- Open question 1 → **resolved (ratified)**: the mono micro-label idiom is label
  furniture, so the R2 `pass` verdicts stand (A4 precedent voice).
- Open question 4 → **resolved (Task A5)**: usage-table token/cost/session *values*
  are mono via `.usage-table td.usage-val`, prose columns stay `--font-ui`. Flipped
  the checklist `usage tab` R2 cell `?` → `pass`, and synced the now-false usage-tab
  evidence note so it no longer contradicts the verdict (in scope as "sync the
  verdict"; the note is the R2 cell's evidence). No remaining `.row-fact-value` in
  the doc.

### Visual QA (preview `scripts/anthill-preview.sh` :4710, gstack browse)

1. **Focus an alerting row @1440.** One live `is-needs-you` row; keyboard-style focus
   (`focus({focusVisible:true})`, `matches(':focus-visible') === true`) gave computed
   `box-shadow: rgb(194,59,46) 4px 0 inset, rgb(174,185,196) 0 0 0 1px inset` — the
   ember `--needs` rail AND the `--line-strong` ring together. Screenshot
   `qa-baseline-20260722/final-wave-focus-alert-row.png` shows both.
2. **Degraded state.** NOT reproducible in the preview: all four sources healthy
   (`sourceHealth.degraded: 0`, cmux reachable), so no Degraded verdict renders.
   Stated per the brief; the recollect wiring + `degradedSinceText` are covered by
   the Important-1 tests instead.
3. **Alerts tab ember ink.** `count-needs-you` computed `className "count is-alerting"`,
   `color rgb(194,59,46)` (`--ember`); screenshot
   `qa-baseline-20260722/final-wave-alerts-tab.png` shows the Alerts "1" in ember
   while every other tab count (Now/Working/Idle/History) stays quiet gray. Preview
   killed (:4710 free).

### Self-review

- Six items closed; diff traces line-for-line to the brief (4 files: app.js =
  Important 1 + Triage 1, styles.css = Important 2 + Triage 1, test file = all tests,
  DESIGN-LANGUAGE.md = Triage 17). No unrelated edits; noticed-but-untouched: a stale
  `.row-fact-value` mention survives in a `styles.css` code comment (~L2274) — out of
  this list's scope, flagged not fixed.
- Doc copies identical (same sha). Test output pristine: `295 pass, 0 fail, 0 skipped`,
  no `.skip`/`.only`/`.todo`, typecheck clean before each commit. Nothing pushed.
