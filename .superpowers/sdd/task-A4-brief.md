# Task A4: Masthead + program section headers alignment (Opus 4.8, WS-A lane)

**Work in:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-body-language` — branch `ant-hill/luna-body-language-20260722`, currently at `b4f9d80` (A3 landed: toolbar on the instrument-rail language; `is-current`, mono counts). All work and commits happen HERE. Never push; never touch `main` or other checkouts.

**Your inputs (read in this order):**
1. `DESIGN-LANGUAGE.md` at the lane root — vocabulary + six rules; cite rule names in tests and commit body.
2. `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/AUDIT.md` — the **A4-tagged findings only** (there is 1). A3 is done; A5/A6 belong to other tasks — do not fix their findings.

**Files:**
- Modify: `src/web/styles.css` (`/* ---------- masthead ---------- */` and `/* ---------- programs ---------- */` sections), `src/web/app.js` (`renderProgram` header block only — the section-header markup/classes, NOT the agent rows it contains)
- Test: `tests/web-client.test.ts`

**Interfaces produced:**
- Masthead and `.programs` full-width bands align to the shared `--frame` content edge (same alignment contract the pulse strip and toolbar already follow).
- Program header meta values (counts, timestamps, token values — whatever the header currently renders as data) in `var(--font-mono)`; label text stays `--font-ui`.
- No program-header background fill beyond `--surface`/`--raise`.
- Do NOT add new rollup data to program headers (agent/working/alert counts aggregation is Task C2's job in a later workstream) — this task is language conformance of what already renders.

## Steps

1. **Write failing intent tests** in `tests/web-client.test.ts`, matching the existing idiom there (A3 added four at the bottom — follow their extract-the-rule-body regex style): (a) masthead rule references `--frame`; (b) `.programs` (or its container rule) references `--frame`; (c) program-header meta value class uses `var(--font-mono)`; (d) per the A4 audit finding's specified fix — assert the replacement rule exists and quote the offending pattern from source for the absence check.
2. `bun run check` → confirm the new tests FAIL for the right reason.
3. **Implement** the A4 finding + the interface contract. Surgical: the two CSS sections + the `renderProgram` header block; match each section's existing conventions.
4. `bun run check` → all green (241 + yours).
5. **Visual QA:** `scripts/anthill-preview.sh` to serve the lane, then the gstack `browse` skill (never mcp chrome tools) to screenshot 1440×900 and 375×812 into `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/a4-after-{1440,375}.png`. Verify: masthead, summary strip, toolbar, and program headers share one left content edge at 1440; no horizontal scroll at either width. Kill the preview when done.
6. **Commit:** `feat(web): masthead + program headers share the frame + quiet header language` (body: which audit finding this closes, which rules it enforces).

## Global Constraints (binding)

- Strict CSP: never inline `style`; variant colors via classes.
- Mono only for identifiers/paths/timestamps/token+cost values — never headings or prose.
- Indicator inks, not flood fills; edge marks over washes.
- Full-width bands align to `--frame: min(1680px, calc(100vw - 64px))`.
- `prefers-reduced-motion` disables any animation you add.
- 44px touch targets <1024px for NEW interactive classes only (pre-existing sweep gaps are Task A6's).
- No feature flags. Tests stay green, none skipped.

## Report

Write your full report to `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-A4-report.md` (implementation summary, TDD evidence RED→GREEN with commands + output excerpts, files changed, screenshot paths, self-review). Then report back under 15 lines: Status (DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT), commits (short SHA + subject), one-line test summary, concerns, report path.
