# Task B4: Per-type drawer conformance (Opus 4.8, WS-B lane — final WS-B task)

**Work in:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem` — branch `ant-hill/luna-inspector-totem-20260722`, tip `8783946` (B1 backend, B2 verdict head, B3 vitals band landed; 254 tests green). All work and commits happen HERE. Never push; never touch `main` or other checkouts.

**Your inputs (read in this order):**
1. `/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md` — vocabulary + six rules (now also tracked on `main`; this canonical path is current).
2. `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/AUDIT.md` — the **WS-B input findings** that fall inside your files below (known set includes: `.control-banner` dual-red-token mismatch — note the settled ruling that `--failed` ink + `--ember-soft` tint is the SANCTIONED pattern, so conform the banner to that ruling, don't invent a third scheme; dead `.state-pill` CSS; `#fff`-vs-`--surface` inconsistency where it appears in inspector sections). Findings outside your files (agent-row washes = WS-C) stay untouched.
3. `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-B2-report.md` — the head structure and helpers you reuse: `.inspector-verdict` / `.verdict-gate` classes, `quietSourceLine`/`fullSourceDetail` (exported), the `head:` fkey-prefix convention via `renderDockTool`'s `opts.fkeyPrefix`, and instance-scoped `state.confirming`.

**The task:** every entity drawer opens with a verdict-head-shaped block — title + status ink + its single most-relevant primary action — BEFORE any evidence/detail, mirroring the agent drawer's totem.

**Files:**
- Modify: `src/web/app.js` (`renderInterventionDrawer`, `renderAdvisoryDrawer`, `renderInvestigationDrawer`, `renderResolvedDrawer`, `renderProgramDrawer`), `src/web/styles.css` (`/* ---------- inspector: per-type drawer states ---------- */` section; `controls` section ONLY for the control-banner conformance finding)
- Test: `tests/web-client.test.ts`

**Contract per drawer:**
- **Intervention:** head = issue title + severity/status ink + the drawer's existing primary action (e.g. Generate triage / Review) promoted into the head. `workStateBanner` + `impactBlock` still render below — REGRESSION GUARD, byte-untouched logic.
- **Advisory:** head = title + advisory ink + its existing acknowledge/primary control. `workStateBanner`/`impactBlock` guard applies.
- **Investigation:** head = title + investigation status ink + its existing primary control. Guard applies.
- **Resolved:** head = title + resolved (clay/moss) ink + its existing reopen/inspect control if one exists; if none exists, the head renders without an action — do not invent one.
- **Program:** head = program name + status ink + rollup vitals line (agent count, working count, alert count, aggregate tokens — client-side aggregation over the program's agents, mono values). If an aggregate is not derivable from data already on the client, omit that cell honestly.
- Where a drawer shows source/terminal naming, reuse `quietSourceLine`/`fullSourceDetail` — do not reintroduce ternary chains.
- Any action control rendered in a drawer head uses the `head:` fkey prefix convention from B2 (instance-scoped keys) if the same control also renders elsewhere in that drawer.

## Steps

1. **Write failing intent tests** in `tests/web-client.test.ts` (extract-regex + the `withDom` executable-fixture idiom where behavior warrants): (a) each of the five drawer render functions opens with a verdict-head-shaped block before detail content (per-function ordering assertions); (b) `workStateBanner` and `impactBlock` still render in intervention/advisory/investigation (regression guard — quote current call sites); (c) program drawer head contains the rollup vitals with mono values (fixture-executed against a small program of fake agents); (d) per the audit findings you close: assert the replacement rule and quote the offending pattern for absence (e.g. dead `.state-pill` removal, control-banner token conformance).
2. `bun run check` → new tests FAIL for the right reasons (honest guards where already-true, disclosed).
3. **Implement.** Reuse B2's head classes/structure — extract a shared `drawerVerdictHead({title, statusClass, statusText, action, sub})` helper if (and only if) it removes real duplication across the five drawers; five hand-rolled near-identical blocks would be a review finding.
4. `bun run check` → all green (254 + yours).
5. **Visual QA:** `scripts/anthill-preview.sh`, then the gstack `browse` skill (never mcp chrome tools): open each entity type's drawer via its thin trigger (intervention/advisory/investigation/resolved may not all exist in live data — screenshot what exists, and for absent types note it and rely on the fixture tests, the A4/B2 precedent). Screenshots to `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/b4-after-<type>.png`. Kill the preview.
6. **Commit:** `feat(inspector): all entity drawers lead with verdict + action` (body: contract, findings closed, rules enforced).

## Global Constraints (binding)

- Strict CSP: never inline `style`; variant colors via classes.
- Mono only for values; labels ui/`--faint`.
- Indicator inks, not flood fills; `--failed` is ink-only, failed tints borrow `--ember-soft` (settled ruling).
- `--inspector-w` desktop; full-surface drawer <1024px; 44px touch targets <1024px for controls you add/move.
- `prefers-reduced-motion` guard for any animation you touch.
- `workStateBanner` + `impactBlock` logic byte-untouched.
- No feature flags. Tests stay green, none skipped.

## Report

Write your full report to `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-B4-report.md` (implementation summary, per-drawer decisions incl. any omitted head actions/aggregates with evidence, TDD RED→GREEN, files changed, screenshot paths, self-review). Then report back under 15 lines: Status, commits, one-line test summary, concerns, report path.
