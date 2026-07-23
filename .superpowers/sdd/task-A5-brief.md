# Task A5: Peripherals — empty state, toast, broadcast dock, usage tab (Opus 4.8, WS-A lane)

**Work in:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-body-language` — branch `ant-hill/luna-body-language-20260722`, tip `e4b83a4` (A3 toolbar + A4 headers landed). All work and commits happen HERE. Never push; never touch `main` or other checkouts.

**Your inputs (read in this order):**
1. `DESIGN-LANGUAGE.md` at the lane root — vocabulary + six rules; cite rule names in tests and commit body.
2. `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/AUDIT.md` — the **A5-tagged findings only** (there are 2). A3/A4 are done; A6 and WS-B/WS-C findings belong elsewhere — do not fix them.

**Files:**
- Modify: `src/web/styles.css` (only these sections: `/* ---------- empty state ---------- */`, `/* ---------- toast ---------- */`, `/* ---------- broadcast dock ---------- */`, `/* ---------- usage tab ---------- */`), `src/web/app.js` (only the render functions the two A5 findings name, if a finding requires a markup/class change)
- Test: `tests/web-client.test.ts`

**Scope rule:** this task is exactly the two A5-tagged audit findings — nothing more. If, while in those sections, you see other language violations the audit did NOT tag, list them in your report as observations; do not fix them.

**Usage-tab numerals note (settled adjudication — do not relitigate):** the audit's split verdict stands: usage KPI tiles keep ui tabular-nums (display-numeral idiom); usage invocation-TABLE cells are values and take `var(--font-mono)` where the A5 finding says so. Follow the finding's specified fix text exactly.

## Steps

1. **Write failing intent tests** in `tests/web-client.test.ts` (follow the extract-the-rule-body regex idiom of the newest tests): one test per A5 finding, asserting the replacement rule exists and — where a finding removes a pattern — quoting the offending pattern from source for the absence check.
2. `bun run check` → new tests FAIL for the right reasons. If a finding turns out to be already-conformant at your base (like A4's frame guards), write it as a regression guard and say so in your report — do not contrive a fake RED.
3. **Implement** the two findings exactly as the audit specifies. Match each section's existing conventions.
4. `bun run check` → all green (245 + yours).
5. **Visual QA:** `scripts/anthill-preview.sh`, then the gstack `browse` skill (never mcp chrome tools): capture the states your findings touch — the empty state requires no live data (the audit finding will say how it manifests; if it only renders with no colony, note that and verify via CSS+test like A4's alias-tag), the usage tab via clicking the Usage view tab. Screenshots to `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/a5-after-*.png`. Kill the preview.
6. **Commit:** `feat(web): peripheral surfaces conform to the design language` (body: which findings closed, which rules enforced).

## Global Constraints (binding)

- Strict CSP: never inline `style`; variant colors via classes.
- Mono only for identifiers/paths/timestamps/token+cost values — never headings or prose.
- Indicator inks, not flood fills; edge marks over washes.
- Full-width bands align to `--frame`.
- `prefers-reduced-motion` disables any animation you add.
- 44px touch targets <1024px for NEW interactive classes only (pre-existing sweep gaps are Task A6's).
- No feature flags. Tests stay green, none skipped.

## Report

Write your full report to `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-A5-report.md` (implementation summary, TDD evidence, files changed, screenshot paths, self-review, observations of untagged violations if any). Then report back under 15 lines: Status, commits, one-line test summary, concerns, report path.
