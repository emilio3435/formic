Goal: Determine whether current-head browser UX, accessibility, responsive layout, rendering, and scroll ownership preserve every core control and truth signal on screen.

Success means:

- Claims `B-01` through `B-07` have evidence-backed verdicts.
- Desktop, tablet, and mobile viewports have screenshots and numeric bounding-box evidence.
- Drawer/chat/footer/control/composer visibility, disabled behavior, focus order, overflow, and nested scroll ownership are measured in a real browser.
- Rendering truth is checked against snapshot data without mutating production state.

Stop when: The lane report contains current-head screenshots, geometry, accessibility evidence, console/network results, prioritized findings, and explicit unknowns for all browser claims.

## Mission

Launch an isolated scratch preview from detached SHA `059cbbea670374a8778e20ef87f0582697efb42f` and use the shared gstack browser. Reproduce candidate defects using the rendered app, numeric geometry, focus/disabled-state probes, and screenshots from the same viewport.

## Claims

- `B-01`: Primary live, history, and usage views remain reachable and readable at supported viewports.
- `B-02`: Opening an agent drawer keeps its header, transcript, status footer, control strip, and composer visible or intentionally reachable through the documented scroll owner.
- `B-03`: Unavailable controls remain visible, disabled, keyboard-inert, and explained.
- `B-04`: Each bounded region has one intentional scroll owner; repaint preserves the operator's relevant position.
- `B-05`: Responsive layout avoids horizontal overflow, destructive overlap, and off-screen core controls at 1280x720, 768x1024, and 375x812.
- `B-06`: Accessible names, roles, focus order, landmarks, and live-status semantics expose the same capability state visible on screen.
- `B-07`: Rendered identity, usage, health, and timestamp text agrees with the backing snapshot or clearly labels absence/degradation.

## Inspection fence

Read `src/web/**`, browser-facing shared types, `src/server/http.ts` and snapshot serializers as consumers, browser/client tests, and existing geometry-gate documentation. Keep product and test source read-only in this phase.

## Evidence floor

Use `bash scripts/anthill-preview.sh` or an equivalent isolated random-port preview owned by this lane. Capture console and failed-network output. At each viewport record `getBoundingClientRect()`, `clientHeight/Width`, `scrollHeight/Width`, computed overflow/min-size, intersection with the viewport and containing box, and active/disabled/tabindex/aria state for the drawer, chat scroll region, footer, control strip, composer, and submit button. Save screenshots under `.lane-evidence/` and inspect the pixels before verdicts.

Write `LANE-REPORT-B.md` first with these headings, each initially `PENDING`: lane scope; named claims and first-red status; findings and proposed file fence; literal floor output; unverified or refused proof. Keep product source read-only, write scratch only under `.lane-evidence/`, never push or restart production, and delete nothing.
