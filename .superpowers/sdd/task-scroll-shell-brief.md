# Task: Scroll shell + sticky headers (Opus 4.8) — Emilio's direct request 2026-07-23

**Work in:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-scroll-shell` — branch `ant-hill/luna-scroll-shell-20260723`, cut from `main` at `5b71f38` (344 tests green). All work and commits HERE. Never push; never touch `~/Developer/the-mountain-main` (it has someone's uncommitted `bun.lock` state) or any other checkout. Production `:4701` serves main — do not restart it; use `scripts/anthill-preview.sh` for all QA.

**Emilio's report (verbatim intent):** the left panel's header row disappears on scroll — it must be visually stuck/frozen at the top. And "when the list of agents grows long and the trees wide, it becomes hard to read and move around — something is off with the scrollability of the page overall — investigate and make sure that the scrollability of the page is up to spec and modern with 2026 standards."

## Part 0 — INVESTIGATE FIRST (do not write fixes until this is answered)

The stylesheet already *intends* an app shell: `html/body { height: 100% }`, body = flex column, `.masthead`/`.health-rail` flex:none, `.app-body { flex:1; min-height:0 }`, `.ops-stage { flex:1; min-height:0; overflow:hidden }`, `.pane-list`/`.pane-inspector { overflow-y:auto }`. Yet in production the PAGE scrolls (masthead and summary strip scroll away, panes don't scroll independently — screenshot-verified by the controller at ~2000px width with the drawer open). Something breaks the constraint chain at runtime.

Method: `scripts/anthill-preview.sh` + the gstack `browse` skill (never mcp chrome tools). On the loaded page run a JS probe: compare `document.scrollingElement.scrollHeight` vs `clientHeight`; if it scrolls, walk down (`document.body`, each flex child, `.app-body`, `.ops-stage`) comparing `scrollHeight`/`clientHeight`/`getBoundingClientRect()` to find exactly which element exceeds its box and why (missing `min-height:0`? a child with `height`/`min-height` set? content outside the flex column? a `position: static` element pushed below? the `#pulse-findings` expansion? `body.inspector-open` at ≥1180 changing the math?). Record the culprit chain in your report BEFORE fixing — the fix must name its mechanism, not carpet-bomb the CSS.

## Part 1 — Restore + modernize the scroll architecture

Target state (the 2026-standard app-shell contract):
- The app frame is exactly the viewport: use `100dvh` on the shell (dynamic viewport units — replaces the fragile `height:100%` chain; keep a `100vh` fallback line before it for old engines).
- Masthead + summary strip are fixed chrome — they NEVER scroll away. (If the summary strip's inline findings expansion can exceed the viewport, the expansion panel itself gets `max-height` + internal scroll — the chrome stays put; judge the max-height against the strip's design, e.g. `min(40dvh, ...)`.)
- `.pane-list` and `.pane-inspector` are the ONLY vertical scroll surfaces at desktop: each gets `overscroll-behavior: contain` (no scroll-chaining to the page when a pane hits its end) and `scrollbar-gutter: stable` (list already has it; add to inspector).
- The page/document itself must not scroll at desktop: after the fix, `document.scrollingElement.scrollHeight === clientHeight` with the drawer open AND closed, with the findings panel expanded AND collapsed. Prefer fixing the constraint chain over slapping `overflow: hidden` on body — but a final `overflow: clip` guard on body is acceptable *in addition to* a root-cause fix, never instead of one.
- The <1024px behavior (full-sheet fixed inspector, page flows naturally) is a DIFFERENT contract — verify it still works; do not force the desktop shell onto it.

## Part 2 — Sticky left-pane headers

Inside the `.pane-list` scroll container (sticky works within the scrolling ancestor):
- `.program-head` → `position: sticky; top: 0` with an opaque background (`--surface` — it must occlude rows sliding under, and keep its hover/`--sand` state) and a z-index above rows.
- `.agent-column-header` → sticky directly below its program head (`top:` = the head's stuck height). The head is `min-height: 38px` but can wrap taller — either pin the stuck offset via a CSS var that matches a single-line head and prevent wrap while stuck, or measure the robust alternative; document your choice. Column header keeps its `--sand` background (already opaque).
- Stacking: a lower program's sticky head must push the previous program's stuck pair away naturally (default sticky behavior within each program's box — verify, since `.program { overflow: hidden }` creates the containing scope and may need `overflow: clip visible` or removal of `overflow: hidden` in favor of border-radius clipping via the sticky elements' own backgrounds; investigate and pick the mechanism that keeps the rounded corners without breaking sticky).
- Keyboard parity: rows get `scroll-margin-top` equal to the stuck stack height so Tab/arrow focus never lands hidden under the headers.

## Part 3 — Long/wide tree readability

- Deep swarm nesting currently indents every level; at 40% pane width (drawer open) deep trees crush the content column. Cap the visual indent: full indent for the first N levels (pick from the current indent step so N·step ≤ ~25% of the pane's min width), then stop indenting and let the existing depth/swarm chips carry the hierarchy. State N and the math in the report.
- Verify the row grid's `minmax` floors keep every cell readable at the 40/60 split's minimum (`clamp(380px, 40%, 760px)`) — no cell may collapse below its floor, no horizontal page creep (`overflow-x` stays clean at every width).

## Tests (intent-test idioms of `tests/web-client.test.ts`)

(a) shell: styles contain the `dvh` shell sizing and `overscroll-behavior: contain` on both panes; (b) sticky: `.program-head` and `.agent-column-header` rules carry `position: sticky` with their `top` offsets and opaque backgrounds; (c) rows carry `scroll-margin-top`; (d) the indent cap rule exists (quote the current uncapped pattern for the absence check if one is replaced); (e) regression guard: the <1024px fixed-inspector block unchanged. RED first where genuine; disclose honest guards.

## Visual QA (browse skill, preview port)

1. Desktop 1440×900 with a LONG list (scroll the real colony): masthead + strip pinned; program head + column header stuck while their rows scroll; next program's headers replace them at the boundary; `document.scrollingElement.scrollHeight === clientHeight` probe passes drawer-open + drawer-closed + findings-expanded.
2. Wheel at the very bottom of `.pane-list` → the page does not move (overscroll contained). Same in the inspector.
3. Drawer open at ≥1180 (40/60): deep-nested rows readable, cells at their floors, no h-scroll.
4. 375×812: unchanged full-sheet behavior, no h-scroll.
5. Screenshots: `scroll-shell-{stuck-headers,deep-tree,375}.png` into `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/`.

## Commits

Suggested: `fix(shell): page never scrolls — dvh app frame + contained pane scrolling` (Part 0 root cause named in body + Part 1), `feat(rows): sticky program + column headers in the roster scroll` (Part 2), `feat(rows): cap tree indent for deep swarms` (Part 3). Conventional messages; body of the first commit MUST name the root-cause mechanism found in Part 0.

## Global Constraints (binding)

Strict CSP (no inline styles). Mono for values only. Indicator inks. 44px touch targets <1024px preserved. `prefers-reduced-motion` guard for anything animated. No feature flags. Tests green, none skipped. Full `bun run check` before each commit. If Part 0's culprit turns out to be JS-structural (content rendered outside the flex column), report DONE_WITH_CONCERNS with the minimal JS fix rather than a CSS workaround — but the expectation is CSS-layer.

## Report

Write the full report to `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-scroll-shell-report.md`: the Part-0 culprit chain with probe numbers, every mechanism choice (sticky offsets, overflow-on-.program resolution, indent cap N), TDD evidence, QA probe results, screenshots. Then report back under 15 lines: Status, commits, one-line test summary, the root cause in one sentence, concerns, report path.
