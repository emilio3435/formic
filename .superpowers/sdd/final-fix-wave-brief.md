# Final fix wave (Opus 4.8, WS-C lane) — the ONLY work before landing

**Work in:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-tree-glance` — branch `ant-hill/luna-tree-glance-20260722`, tip `2295975`, 290 tests green. Commits HERE only; never push. This is the consolidated fix wave from the final whole-branch review — exactly these six items, nothing else. TDD per item where behavior changes; run focused tests while iterating; ONE full `bun run check` before each commit.

## Important 1 — Wire the B1 contract into the UI (the two blockers it was built to close)

Files: `src/web/app.js` (degraded-refresh handler ~line 1441; degraded reason line ~884-899 area), `tests/web-client.test.ts`.
- The degraded-verdict "Refresh" button currently calls `fetchSnapshot()` (GET, re-serves cache). Change it to `POST /api/recollect` (no body; same-origin — the server guard expects the Origin header browsers send automatically) and apply the returned snapshot through the same path fetchSnapshot's result takes. On a non-OK response (the `{ ok:false, error:{code,message} }` envelope, e.g. 500 RECOLLECT_FAILED), fall back to `fetchSnapshot()` so Refresh never becomes a dead button.
- Render "since when" in the degraded reason: read `totals.sourceHealth?.byProvider?.[provider]?.lastHealthyAt` for the degraded source(s) and append a relative time (reuse the codebase's existing relative-time formatter — find it, don't write a new one) to the degraded reason line, e.g. "· last healthy 12m ago". Honest omission when null ("never seen healthy" is a lie — render nothing extra when null).
- Tests: fixture/intent per the file's idioms — (a) the refresh handler references `/api/recollect` with method POST and has the fetchSnapshot fallback; (b) the degraded reason renders the relative time when lastHealthyAt is present and omits it when null.

## Important 2 — Keyboard focus ring on alert rows

Files: `src/web/styles.css` (agent rows section, near the alert rails at ~951-961), `tests/web-client.test.ts`.
- The `.agent-row.is-needs-you:not(.is-selected)` (and `.is-blocked`, `.is-failed`) rails at specificity (0,3,0) clobber the focus-visible `box-shadow: inset 0 0 0 1px var(--line-strong)` ring at (0,2,0) on the same property. Fix with the file's own comma-combine idiom (see `.finding.pin.is-selected` at ~styles.css:519): add `:focus-visible` variants for the three alert states combining rail + ring, e.g. `.agent-row.is-needs-you:not(.is-selected):focus-visible { box-shadow: inset 4px 0 var(--needs), inset 0 0 0 1px var(--line-strong); }`.
- Test: intent test asserting the three combined rules exist (extract + assert both shadow components in each).

## Triage 1 — Ember ink on the Alerts tab count when > 0

Files: `src/web/app.js` (`renderTabs`), `src/web/styles.css` (toolbar section), `tests/web-client.test.ts`.
- `renderTabs` toggles a class (e.g. `is-alerting`) on the Alerts tab's `.count` when its count > 0; CSS gives that class `color: var(--ember)` (ink only, no fill). At zero: quiet default. NAMING: converge with C2's existing modifier — use the SAME class name the program rollup cells use (`is-alerting`) for the same semantic (this also answers the reviewer's Minor 3 drift note in the toolbar direction; do NOT rename the drawer's `is-alert` — out of scope).
- Tests: fixture-executed renderTabs with alert count > 0 → class present; count 0 → absent; CSS rule asserts ember ink.

## Triage 4 — Fifth A3 test: index.html seeds `is-current`

File: `tests/web-client.test.ts`. One assertion: the html source seeds `is-current` on the default Now tab (quote the actual markup). The markup already does this — honest guard, disclose as such.

## Triage 11 — "When" cell negative mono check

File: `tests/web-client.test.ts`. One `not.toContain` beside the existing Provider/Model negative checks in the A5 usage-table test, covering the When cell.

## Triage 17 — DESIGN-LANGUAGE.md sync (doc-only)

Files: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-tree-glance/DESIGN-LANGUAGE.md` (committed) AND `/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md` (untracked canonical — keep identical, no git commands there).
- Sync the checklist table cell + open questions 1 and 4 with their resolved verdicts (mono idiom ratified; usage-tab split verdict implemented — cite the landed rules).
- Replace the three `.row-fact-value` citations (~lines 124, 246, 316) — the class was deleted by C1; cite a live Rule-2 exemplar instead (`.ri-value` or `.usage-val`).
- Keep the doc's voice; mark resolutions with their task/commit provenance as the existing A4 correction did.

## Commits

Group sensibly (suggested: one `fix(web): wire recollect + lastHealthyAt into the degraded verdict` for Important 1; one `fix(rows): keyboard focus ring survives alert rails` for Important 2; one `feat(toolbar): alerts count takes ember ink when alerting` for Triage 1; one `test(web): close deferred guard gaps` for Triage 4+11; one `docs: sync design language with landed verdicts` for Triage 17). Conventional messages, each body citing the final-review finding it closes.

## Visual QA (after all commits)

`scripts/anthill-preview.sh` + gstack browse skill (never mcp chrome tools): (1) keyboard-focus an ALERTING row at 1440 — screenshot showing rail + ring together (`final-wave-focus-alert-row.png` in the qa-baseline dir); (2) trigger the degraded state if reproducible in preview — if not, state so and rely on tests; (3) Alerts tab with nonzero count showing ember ink (`final-wave-alerts-tab.png`). Kill the preview.

## Report

Append "## Final fix wave" to `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-C3-report.md` with per-item RED→GREEN evidence and the QA notes. Report back under 15 lines: status, commit SHAs, final test count, anything that resisted.
