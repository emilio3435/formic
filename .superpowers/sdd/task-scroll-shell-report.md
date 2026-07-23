# Task Report: Scroll shell + sticky headers (Opus 4.8) — Emilio 2026-07-23

Lane: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-scroll-shell`
Branch: `ant-hill/luna-scroll-shell-20260723` (cut from main `5b71f38`, 344 tests green — confirmed).
Preview for QA: `scripts/anthill-preview.sh` → `http://127.0.0.1:4711` (prod :4701 untouched).

---

## Part 0 — Investigation (probe-verified, live via gstack `browse`)

### The intended shell (from the stylesheet)
`html { height: 100% }` → `body { height: 100%; display:flex; flex-direction:column; overflow-x:hidden }`.
Body children: `.masthead` (flex:none) · `.health-rail` (flex:none) · `.app-body` (flex:1; min-height:0) · fixed `#broadcast-bar`/`#toast`.
`.app-body(flex:1,min-h:0)` → `.ops-stage(flex:1;min-h:0;overflow:hidden)` → `.pane-list(overflow-y:auto)` + `.pane-inspector(overflow-y:auto;min-h:0)`.
On paper this gives independent pane scrolling. Probes confirm it *does* hold with a long roster — until the chrome grows.

### Probe A — long roster, drawer closed, 1440×900
Injected 40 clone rows (41 total). `document.scrollingElement`: scrollHeight **900** === clientHeight **900** → **document does NOT scroll**. `.pane-list` scrolls internally. Chain holds.

### Probe B — long roster, drawer OPEN, 2000×900 (the controller's repro width)
`body.inspector-open` set, 41 rows. Walk of every body child + app-body/ops-stage/pane-list/pane-inspector:
- `scrollingElement`: scrollHeight **900** === clientHeight **900** → **document does NOT scroll**.
- `.masthead` 75px, `.health-rail` **131px**, `.app-body` 692px (fills remainder), `.ops-stage` overflow:hidden clips, `.pane-list` scrollHeight **4123** vs clientHeight **690** (`overflowsBox:true` → scrolls internally), `.pane-inspector` 690===690 (its content scrolls internally when tall).
- Notable computed value: **`body` `overflow-y` computes to `auto`** (only `overflow-x:hidden` is authored; per CSS spec, when one axis is a scrolling value the `visible` axis computes to `auto`). So the body/viewport is *primed* to scroll the moment anything overflows the fixed-height body box.

Chain still holds with a long roster alone. The page does not scroll from roster length. So roster length is NOT the trigger.

### Probe C — the trigger: `flex:none` chrome + unbounded inline expansion (1440×900)
Opened `#widget-customizer` and injected an expanded `#pulse-findings` (12 finding rows — a normal triage state):
- `.health-rail` grew to **781px** (it is `flex: 0 0 auto` = flex:none → takes full content height; **it has no `max-height`**).
- Chrome total (masthead 75 + health-rail 781) = **857px**.
- `.app-body` shrank to **44px** (min-height:0 let it shrink, but it cannot go below 0).
- `document.scrollingElement`: scrollHeight **909** > clientHeight **900** → **DOCUMENT SCROLLS (over by 9px)**.

Collapse the expansions → 900 === 900 again.

### NAMED ROOT CAUSE (culprit chain)
The two chrome bands (`.masthead`, `.health-rail`) are `flex: none`. `.health-rail` hosts two inline expansions with **no height bound** — `#pulse-findings` (the findings ledger you open to triage alerts) and `#widget-customizer` ("Customize summary"). When either expands, the band grows to its full content height. Because `body` is a **definite** `height:100%` box and its `overflow-y` computes to `auto`, once masthead + expanded health-rail exceed the viewport (`.app-body { min-height:0 }` bottoms out at 0, cannot absorb more), the excess overflows the body box and **the document scrolls — carrying the masthead + summary strip out of view**. This is exactly the reported "the left panel's header row disappears / the masthead and summary scroll away." The independent pane scrolling still works underneath; the document-level scroll rides over it. The `height:100%` chain is also the fragile pre-`dvh` pattern the brief calls out. This is a **CSS-layer** cause (no content is rendered outside the flex column), so the fix stays in CSS.

### Probe D — Part 2 sticky mechanism (`.program { overflow:hidden }` interaction), 1440×900
Set `.program-head { position:sticky; top:0 }` and scrolled `.pane-list` to 600px, testing three `.program` overflow values:
- `overflow: hidden` → head `rectTop` **-269** (scrolled completely away — **NOT stuck**). Confirms `overflow:hidden` makes `.program` the sticky scroll-scope, breaking the intended pin-to-`.pane-list`.
- `overflow: clip` → head `rectTop` **218** vs pane top 209 (**stuck**, 9px = `.pane-list` padding-top 0.6rem). Keeps rounded-corner clipping.
- `overflow: visible` → head `rectTop` **218** (**stuck**, but loses rounded-corner clipping).
**Decision: `.program { overflow: clip }`** — the only value that keeps both the sticky pin AND the card's rounded-corner clipping.

### Probe E — sticky offset stability (the `.program-head` wrap problem)
Real head "The Ant Hill" measured: **46px** at 1440 drawer-closed (full pane), but **68px** at 1440 drawer-open (550px pane) — the `.program-rollup` wraps its cells at the 40% pane. So a fixed column-header offset is fragile with the head as authored.
Applying nowrap+truncate (`.program-head{flex-wrap:nowrap}` + truncating `.program-name` + `.program-rollup{flex-wrap:nowrap}`) yields a **stable single line** with **zero horizontal overflow** at every width:
- 1440 drawer-open (550px pane): head **46px**, no h-overflow.
- 1180 drawer-open (446px pane): head **46px**, no h-overflow.
- 375 mobile (311px pane): head **60px** (rename/details grow to 44px touch targets ≤1024/≤720), no h-overflow.
- 720 (656px pane): head **60px**, no h-overflow.
Column-header measured **25px** tall, background `rgb(232,237,242)` = `--sand` (already opaque). Program-head background was `rgba(0,0,0,0)` = **transparent** → must get `--surface` to occlude rows.
**Decision:** pin the stuck offset via a CSS var — `--program-head-h: 46px` (>1024px), overridden to `60px` at `≤1024px` (where the touch sweep grows the head's buttons) — and prevent wrap so the single-line height is stable. Column-header `top: var(--program-head-h)`; rows `scroll-margin-top: var(--program-head-h) + 25px`.

### Probe F — <1024px contract (regression baseline)
At 375×812 with 30 injected rows: `document` does NOT scroll (812===812), `.pane-list` scrolls internally (clientHeight 270), `.ops-stage` overflow `visible`, inspector is `position:fixed; inset:0` full sheet. The <1024 contract must stay intact.

### Part 3 — indent math (current state)
Indent: `.agent-row.is-child { padding-left: calc(0.8rem + var(--tree-depth) * 1.3rem) }`; connector `::before` left `calc(0.55rem + (var(--tree-depth) - 1) * 1.3rem)`. `--tree-depth` set by `.depth-1..4`; JS caps the class at `Math.min(depth,4)`. Step = 1.3rem = 20.8px. At the 40% drawer-open **minimum pane width 380px** (`clamp(380px,40%,760px)` floor), 25% = 95px. Total indent at depth-4 = 0.8+5.2 = 6rem = **96px = 25.3%** — over budget and crushing.
**Decision: cap N=3.** `min(var(--tree-depth), 3)` in the indent/connector calcs → capped total indent = 0.8+3·1.3 = 4.7rem = **75.2px = 19.8%** of 380px, safely ≤25%; depth colour + swarm/depth chips carry hierarchy past level 3.

---

## Part 1–3 implementation, TDD evidence, QA — (in progress; appended below as completed)

## Implementation — commits (branch ant-hill/luna-scroll-shell-20260723, off 5b71f38)

- `0260b0a` fix(shell): page never scrolls — dvh app frame + contained pane scrolling (Part 0 root cause named in body + Part 1)
- `a5f9ae3` feat(rows): sticky program + column headers in the roster scroll (Part 2)
- `9b04848` feat(rows): cap tree indent for deep swarms (Part 3)

### TDD
9 RED intent-tests written first in `tests/web-client.test.ts` (idioms of the file: `styles.match(/rule/)` + `toContain`/`toMatch`, absence checks for replaced patterns). Sequence honored per-part (each commit green): baseline 344 → +4 Part-1 (348) → +4 Part-2 (352) → +1 Part-3 (353). Full `bun run check` (tsc --noEmit + bun test) green before every commit. Zero tests skipped.

### Part 1 — shell (styles.css)
- `body`: `height:100vh; height:100dvh` (dvh frame + vh fallback) replaces `height:100%`; `overflow-y:clip` guard added alongside the existing `overflow-x:hidden`.
- `#pulse-findings`: `max-height:min(40dvh,26rem)` + `overflow-y:auto` + `overscroll-behavior:contain` (replaced the unbounded `overflow:hidden`).
- `.widget-customizer`: `max-height:min(50dvh,22rem)` + `overflow-y:auto` + `overscroll-behavior:contain`.
- `.pane-list`: `overscroll-behavior:contain` (defines `--program-head-h:46px`). `.pane-inspector`: `overscroll-behavior:contain` + `scrollbar-gutter:stable`.

### Part 2 — sticky headers (styles.css)
- `.program`: `overflow:hidden` → `overflow:clip` (probe D: the resolution that keeps rounded corners AND sticky).
- `.program-head`: `position:sticky; top:0; z-index:3; background:var(--surface)`; `flex-wrap:wrap`→`nowrap`; `.program-label` shrinks + `.program-name` truncates (`white-space:nowrap; text-overflow:ellipsis`); `.program-rollup` `flex-wrap:wrap`→`nowrap; flex:0 0 auto` — keeps the head a stable single line.
- `.agent-column-header`: `position:sticky; top:var(--program-head-h); z-index:2` (kept `--sand`).
- `--program-head-h`: `46px` base, re-pointed to `60px` inside `@media (max-width:1024px)` (the touch sweep grows the head's buttons to 44px there).
- `.agent-row` + `.swarm-anchor`: `scroll-margin-top: calc(var(--program-head-h) + 25px)` (keyboard parity).
- Sliver fix: overflow clips at the PADDING box, so `.pane-list` top padding painted a row sliver ABOVE the frozen headers. Moved that 0.6rem breathing from `.pane-list` padding-top to `.toolbar` `margin-top` (scrolls away cleanly) so the headers pin FLUSH. Mirrored in the ≤720px `.pane-list` override.

### Part 3 — indent cap (styles.css)
`min(var(--tree-depth), 3)` in `.agent-row.is-child` (+ `.is-selecting` + `::before` connector), `.swarm-anchor.is-child`, and the ≤720px mobile step. N=3 → capped indent 4.7rem/75px (19.8% of 380px min pane), was depth-4 96px/25.3%.

## Visual QA (gstack browse, preview :4711)

1. **Doc never scrolls — all 4 state combos @ desktop.** `scrollingElement.scrollHeight === clientHeight`:
   - closed/collapsed 1440: 900===900 (no scroll) · closed/expanded 1440 (15 findings + 40 rows): 900===900 · open/collapsed 2000: 900===900 · open/expanded 2000: 900===900. All PASS.
2. **Sticky stack @ 1440 long roster + 2 programs.** Head stuck FLUSH at pane top (headTop 268 == listTop 268, gap 0), column header flush beneath (colFlush true), both opaque (head `--surface` rgb(251,252,253), col `--sand` rgb(232,237,242)), z 3>2>rows, no rows peek above the head, no h-overflow. Cross-program handoff: program-1 stuck pair pushed out as program-2 head rises. `scroll-margin-top` computes 71px. Screenshot `scroll-shell-stuck-headers.png`.
3. **Overscroll containment.** `overscroll-behavior:contain` computed on `.pane-list` AND `.pane-inspector`; `scrollbar-gutter:stable` on both. With the document itself unscrollable (900===900), wheel at a pane's end cannot move the page.
4. **Deep tree @ 1280 drawer-open (486px pane).** Indent depth1/2/3 = 33.6/54.4/75.2px, depth4 = 75.2px (capped == depth3); no h-overflow; identity + status cells readable at the 40% split. Screenshot `scroll-shell-deep-tree.png`.
5. **375×812 contract intact.** doc does not scroll, no h-scroll (before + after opening drawer), pane-list scrolls internally, inspector opens `position:fixed; inset:0` full sheet. Screenshot `scroll-shell-375.png`.

Screenshots in `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/`: `scroll-shell-stuck-headers.png`, `scroll-shell-deep-tree.png`, `scroll-shell-375.png`.

## Self-review vs. constraints
- Page provably never scrolls at desktop in all four state combos (probe numbers above).
- Sticky stack works across program boundaries; headers opaque; rounded corners preserved (`clip`).
- Keyboard focus clears the stuck stack (`scroll-margin-top` 71px).
- <1024px full-sheet fixed-inspector contract untouched (regression test (e) + 375 probe).
- Strict CSP honored (no inline styles added; all changes are class/rule CSS). Mono untouched. `prefers-reduced-motion` block untouched (no new animation). No feature flags. 44px touch targets ≤1024 preserved.
- One intentional side effect, documented: forcing the program head to a single line makes the ≤720px mobile head compact (~60px) instead of the old wrapped multi-line (~187px) — a cleaner, more compact header, required for a stable sticky offset.

**Status: DONE.**

---

## Review follow-up — commit `ddb1d55` fix(shell): exclusive chrome expansions + honest rollup shrink + hardened guards

Addressed 3 Important + 4 folded minors from the review. Full `bun run check` green (355 tests, +2 from 353). TDD: exclusivity + rollup tests added, test (c)/(d)/(e) tightened. Committed before live QA (stall-safety), QA after.

### Important 1 — exclusive chrome expansions (app.js)
`#pulse-findings` and `#widget-customizer` are both flex:none summary-strip expansions; both open at 1440×900 = 918px > 900 (silently clipped by the new `body overflow-y:clip`). Now mutually exclusive: `togglePulseFindings` sets `widgetCustomizerOpen=false` when opening; the `customize-summary` handler sets `pulseExpanded=false` when opening. Combined overflow is structurally impossible; the max-height bounds remain as belt-and-suspenders.

**Live combined-state probe (1440×900, real toggles):**
| step | findingsOpen | customizerOpen | doc scrolls (sh/ch) | open panel bottom visible |
|---|---|---|---|---|
| initial | false | false | no (900/900) | — |
| open findings | **true** | false | no (900/900) | findings ✓ |
| open customizer | false (auto-closed) | **true** | no (900/900) | customizer ✓ |
| reopen findings | **true** | false (auto-closed) | no (900/900) | findings ✓ |
Never co-open; document never scrolls; the open panel's bottom edge is fully visible in every state.

### Important 2 — honest rollup shrink (styles.css + app.js)
`.program-rollup` was `flex:0 0 auto` + nowrap inside `.program{overflow:clip}` → cropped with zero indication at narrow widths. Now `min-width:0` + `flex:0 1 auto` (shrinks after the name truncates), `.program-rollup-cell` `min-width:0; overflow:hidden` + label ellipsis, `.program-rollup-cell.is-alerting{flex-shrink:0}` (last to go, always legible). The least-critical tokens cell (tagged `key:"tokens"` in app.js → `.program-rollup-cell--tokens`) is dropped at ≤720px; the alerts cell is never dropped.

**Live rollup probe (program with alert + token cells):**
| width | pane | alert visible | alert within card | tokens display | h-overflow |
|---|---|---|---|---|---|
| 375×812 | 311px | ✓ "1 alert" (right 317 ≤ card 333) | ✓ | none (dropped) | none |
| 720×900 | 656px | ✓ "1 alert" (right 662 ≤ card 678) | ✓ | none (dropped) | none |
| 1024×900 | 960px | ✓ "1 alert" (right 875 ≤ card 978) | ✓ | flex (shown) | none |
Screenshots: `scroll-shell-rollup-375x812.png`, `-720x900.png`, `-1024x900.png` — at 375 the name truncates and agents/working cells shrink while "1 alert" stays fully legible in ember; tokens dropped ≤720.

### Important 3 — tightened test (d)
`min(var(--tree-depth), 3)` is now asserted per-rule at all five capped sites (desktop `.agent-row.is-child`, `.is-selecting`, `::before` connector, `.swarm-anchor.is-child`, and the two ≤720px mobile step rules) via individual rule extraction, plus a file-wide absence check that no uncapped `var(--tree-depth) * {1.3,0.85}rem` survives.

### Folded minors
(a) both `scroll-margin-top` calcs use a new `--column-head-h` var (25px base, 44px at ≤720px for the 2-row mobile header) instead of a magic 25px, defined beside `--program-head-h` on `.pane-list`; (b) `vh` fallback lines (`min(40vh,26rem)` / `min(50vh,22rem)`) before the dvh bounds on both expansions; (c) regression test (e) bound to one extracted `.pane-inspector` rule; (d) test (c) now covers `.swarm-anchor` scroll-margin too.

**Status: DONE.**
