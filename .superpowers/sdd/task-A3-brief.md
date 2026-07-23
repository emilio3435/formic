# Task A3: Toolbar + view tabs to instrument-rail language (Opus 4.8, WS-A lane)

**Work in:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-body-language` — branch `ant-hill/luna-body-language-20260722`, cut from `main` at `00f4bf0` (post-Pulse). Deps installed, 237 tests green. All work and commits happen HERE. Never push; never touch `main` or any other checkout.

**Your inputs (read in this order):**
1. `/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md` — the design vocabulary and six rules; cite rule names in your test strings and commit body.
2. `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/AUDIT.md` — read the **A3-tagged findings only**; they are your concrete defect list (includes the `.select-toggle[aria-pressed=true]` flood-fill violation). A4/A5/A6-tagged findings belong to other tasks — do not fix them, even when tempting.

**Files:**
- Modify: `src/web/styles.css` (the `/* ---------- toolbar: views, filter chips, search ---------- */` section), `src/web/app.js` (`renderTabs`, `renderFilterBar`) — and `src/web/index.html` only if the class contract changes.
- Test: `tests/web-client.test.ts`

**Interfaces produced (later tasks depend on these exact names):**
- `.view-tab` active state = ink text + 2px `--signal-rail` bottom rail via class `is-current` (WS-C reuses `is-current` semantics unchanged).
- `.count` badges in `var(--font-mono)`.
- Search input and `.select-toggle` as quiet outline controls; `.select-toggle[aria-pressed=true]` uses ink text + edge mark/tint per the audit's specified fix, not a flood fill. Alert count keeps `--ember` as ink, not fill.

## Steps

0. **Docs commit first:** copy `/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md` into the lane root, `git add DESIGN-LANGUAGE.md`, commit `docs: codify techno-orchestra design language + conformance checklist`.
1. **Write failing intent tests** in `tests/web-client.test.ts`, following the existing string/regex-over-source test idiom in that file (read neighboring tests first): (a) styles source contains an `is-current` rule for `.view-tab` using `--signal-rail`; (b) no filled-background active-tab rule remains (assert the absence of the current offending pattern — quote it from source); (c) `.count` uses `var(--font-mono)`; (d) the `.select-toggle[aria-pressed=true]` fix per the audit.
2. `bun run check` → confirm the new tests FAIL for the right reason.
3. **Implement** the A3 findings + the interface contract above. Surgical: only the toolbar section and the two render functions; match existing CSS conventions (custom properties, section comments, no inline styles).
4. `bun run check` → all green (237 + yours).
5. **Visual QA:** `scripts/anthill-preview.sh` (repo root; uses ports 4710-4719, refuses 4701) to serve the lane, then use the gstack `browse` skill (never mcp chrome tools) to screenshot at 1440×900 and 375×812 into `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/a3-after-{1440,375}.png`. Verify: no horizontal scroll, tabs align to the shared `--frame` edge. Kill the preview when done.
6. **Commit:** `feat(web): toolbar + view tabs on the instrument-rail language` (body: which audit findings this closes, which rules it enforces).

## Global Constraints (binding)

- Strict CSP: never inline `style`; variant colors via classes.
- Mono only for identifiers/paths/timestamps/token+cost values — never headings or prose.
- Indicator inks, not flood fills; 2px `--signal-rail` edge marks.
- Full-width bands align to `--frame`.
- `prefers-reduced-motion` disables any animation you add (put it in the existing guard block).
- 44px touch targets <1024px apply to any NEW interactive class you introduce (the systematic sweep of pre-existing gaps is Task A6's job, not yours).
- No feature flags. Tests stay green, none skipped.

## Report

Write your full report to `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-A3-report.md` (what you implemented, TDD evidence RED→GREEN with commands + output excerpts, files changed, screenshot paths, self-review). Then report back under 15 lines: Status (DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT), commits (short SHA + subject), one-line test summary, concerns, report path.
