# Task C3: Density + keyboard pass (Opus 4.8, WS-C lane — final implementation task)

**Work in:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-tree-glance` — branch `ant-hill/luna-tree-glance-20260722`, tip = the reviewed C2 head (`97275aa` or later). All work and commits happen HERE. Never push; never touch `main` or other checkouts.

**Your inputs (read in this order):**
1. `DESIGN-LANGUAGE.md` at the lane root — vocabulary + six rules.
2. The `agent rows` and `responsive` sections of `src/web/styles.css` as they now stand (C1's instrument cluster + C2's header rollups are in) — read before changing.

**The contract:**
- **Density at width:** at ≥1440px, agent-row vertical padding tightens (a compact rule) so a 12-agent program fits more rows per screen — values, not structure; the instrument cluster and summary line keep their sizes.
- **Touch integrity:** the <1024px 44px sweep is untouched and still wins below its breakpoint (the compact rule must not leak into tablet/mobile).
- **Keyboard integrity:** the full row keyboard path still works after the density change — tab to row, Enter opens the drawer, arrows navigate where they already do; nothing about focus order or focusability changes.
- This is a values-only CSS task. If you find yourself editing `app.js`, stop — you have exceeded the contract (report NEEDS_CONTEXT with what forced it).

**Files:**
- Modify: `src/web/styles.css` (`agent rows` + `responsive` sections only)
- Test: `tests/web-client.test.ts`

## Steps

1. **Write failing intent tests:** (a) a ≥1440px media rule exists tightening `.agent-row` vertical padding (extract the rule body, assert the compact value); (b) the <1024px sweep still contains its full selector list including the row treatment (regression guard quoting the current list); (c) the compact rule lives inside a `min-width: 1440px` query (so it cannot apply below tablet widths).
2. `bun run check` → the new density tests FAIL for the right reasons (the guard test may pass — disclose per the honest-guard precedent).
3. **Implement.** Values matched to the section's existing spacing scale (read neighboring paddings; derive, don't invent arbitrary pixels).
4. `bun run check` → all green (287 + yours).
5. **Visual QA:** `scripts/anthill-preview.sh` + gstack `browse` skill (never mcp chrome tools): 1440×900 — count visible rows before/after (report the delta), no clipped text in either row line; 1024 and 375 — row heights unchanged vs C2's screenshots; keyboard walk — tab/Enter/arrows into and out of the drawer, report what you exercised. Screenshots to `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/c3-after-{1440,375}.png`. Kill the preview.
6. **Commit:** `feat(rows): density pass with touch + keyboard integrity` (body: the compact values chosen and why, rules enforced).

## Global Constraints (binding)

- Strict CSP: never inline `style`.
- 44px touch targets <1024px — inviolable; the density rule exists only ≥1440px.
- No feature flags. Tests stay green, none skipped.
- Values-only: zero JS changes, zero markup changes.

## Report

Write your full report to `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-C3-report.md` (implementation summary, the chosen values with their derivation, row-count delta at 1440, keyboard-walk evidence, TDD RED→GREEN, screenshot paths, self-review). Then report back under 15 lines: Status, commits, one-line test summary, concerns, report path.
