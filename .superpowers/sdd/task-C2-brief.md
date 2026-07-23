# Task C2: Program header rollups (Opus 4.8, WS-C lane)

**Work in:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-tree-glance` — branch `ant-hill/luna-tree-glance-20260722`, tip = the reviewed C1 head (`19f1f5e` or later). All work and commits happen HERE. Never push; never touch `main` or other checkouts.

**Your inputs (read in this order):**
1. `DESIGN-LANGUAGE.md` at the lane root — vocabulary + six rules.
2. `programRollupLine(program)` in `src/web/app.js` (~line 3028 region, built by the inspector workstream for the program DRAWER head) — **this is the aggregation source of truth. Reuse it (or extract its aggregation core into a shared helper both call sites use) — do NOT re-derive counts in a second place.** Read its honest-omission behavior (token aggregate omitted when un-derivable) and preserve it.
3. Current `renderProgram` (the section-header block) in `src/web/app.js` and the `/* ---------- programs ---------- */` styles section.

**The contract:**
- Program section headers in the left tree render an at-a-glance rollup: agent count, working count, alert count, aggregate session tokens — mono values (matching the A4 `.program-rollup` treatment already in place), labels ui/`--faint`.
- **Alert count uses `--ember` ink ONLY when > 0** — at zero it renders in the quiet default ink (calm does not earn color). Other counts stay quiet at all values.
- Honest omission: the token aggregate is omitted when un-derivable (same rule as the drawer); counts always derivable client-side, so they always render.
- If `renderProgram` already renders a partial rollup (A4 gave `.program-rollup` its mono treatment — check what it currently contains), EXTEND it to the full contract rather than adding a second element.
- Keep untouched: program rename form, collapse/expand behavior, the drawer trigger.

**Files:**
- Modify: `src/web/app.js` (`renderProgram` header block; the shared aggregation helper if extraction is needed), `src/web/styles.css` (`programs` section)
- Test: `tests/web-client.test.ts`

## Steps

1. **Write failing intent tests** (`withDom` executable fixtures per the established idiom): (a) executed program header against a fixture program (3 agents, 2 working, 1 alert, known tokens) renders all four cells with mono values and ember ink on the alert cell; (b) executed with 0 alerts renders the alert count WITHOUT the ember class; (c) executed with un-derivable tokens omits the token cell honestly; (d) source-level: the header and the drawer both source their aggregation from the same helper (assert the shared call, not duplicated arithmetic).
2. `bun run check` → new tests FAIL for the right reasons.
3. **Implement.** Surgical; match section conventions; CSP-safe (ember via a class, e.g. `is-alerting`, never inline).
4. `bun run check` → all green (282 + yours).
5. **Visual QA:** `scripts/anthill-preview.sh` + gstack `browse` skill (never mcp chrome tools): 1440×900 — headers scannable, alert ember visible only where alerts exist; 375 — headers don't wrap chaotically. Screenshots to `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/c2-after-{1440,375}.png`. Kill the preview.
6. **Commit:** `feat(programs): at-a-glance rollups in program headers` (body: contract, shared-helper decision, rules enforced).

## Global Constraints (binding)

- Strict CSP: never inline `style`; variant colors via classes.
- Mono only for values; labels ui/`--faint`; indicator inks (ember as ink, never fill), calm earns no color.
- 44px touch targets <1024px for interactive elements you add/move.
- `prefers-reduced-motion` guard for any animation you add.
- No feature flags. Tests stay green, none skipped.
- Accessibility: rollup data present in the header's accessible text (extend the existing aria pattern).

## Report

Write your full report to `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-C2-report.md` (implementation summary, the reuse-vs-extract decision with evidence, TDD RED→GREEN, files changed, screenshot paths, self-review). Then report back under 15 lines: Status, commits, one-line test summary, concerns, report path.
