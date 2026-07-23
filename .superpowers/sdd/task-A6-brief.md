# Task A6: Motion + responsive conformance sweep (Opus 4.8, WS-A lane — final WS-A task)

**Work in:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-body-language` — branch `ant-hill/luna-body-language-20260722`, tip `d516ad7` (A3 toolbar, A4 headers, A5 peripherals landed; 247 tests green). All work and commits happen HERE. Never push; never touch `main` or other checkouts.

**Your inputs (read in this order):**
1. `DESIGN-LANGUAGE.md` at the lane root — vocabulary + six rules.
2. `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/AUDIT.md` — the **A6-tagged findings only** (there are 2). The audit quantified the touch-target gaps precisely: `.filter-chip` never swept by the 44px rules; `.program-details` swept only <720px instead of <1024px; three text inputs never swept. Follow the findings' specified fixes exactly.

**Files:**
- Modify: `src/web/styles.css` (only the `/* ---------- responsive ---------- */` and `/* ---------- motion ---------- */` sections)
- Test: `tests/web-client.test.ts`

**Scope rule:** exactly the two A6-tagged findings. The ~3px masthead/content left-edge offset is a KNOWN pre-existing item explicitly deferred to the final review — do NOT fix it. Untagged observations go in your report, unfixed.

## Steps

1. **Write failing intent tests** in `tests/web-client.test.ts` (extract-regex idiom): (a) the <1024px touch-target sweep covers `.filter-chip`; (b) `.program-details`' 44px treatment applies at the <1024px breakpoint (quote the current <720px-only pattern from source for the absence/replacement check); (c) the three text inputs named by the audit are covered by a min-height/touch rule below 1024px; (d) motion: every `@keyframes`/`animation` introduced by WS-A commits (b4f9d80..d516ad7) appears inside the existing `prefers-reduced-motion` guard block — A3/A4/A5 all reported adding NO new animation, so write this as a regression guard asserting the guard block still disables the full existing animation set; if that is already true at your base, say so (honest guard, no fake RED — the A4 precedent).
2. `bun run check` → new tests FAIL for the right reasons (the touch-target ones must be genuine REDs; the motion one may be a guard per above).
3. **Implement** the two findings exactly as the audit specifies. Only the two named sections change.
4. `bun run check` → all green (247 + yours).
5. **Visual QA:** `scripts/anthill-preview.sh`, then the gstack `browse` skill (never mcp chrome tools) at 1440×900, 1024×900, and 375×812: no horizontal scroll anywhere; the drawer is full-surface below 1024; filter chips and the swept inputs visibly comfortable at 375. Screenshots to `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/a6-after-{1440,1024,375}.png`. Kill the preview.
6. **Commit:** `feat(web): motion + responsive conformance for the restyled body` (body: findings closed, rules enforced).

## Global Constraints (binding)

- Strict CSP: never inline `style`.
- Mono only for values; indicator inks, not flood fills; `--frame` alignment.
- `prefers-reduced-motion` disables every animation.
- 44px touch targets <1024px — this task IS the sweep that closes the audited gaps.
- No feature flags. Tests stay green, none skipped.

## Report

Write your full report to `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-A6-report.md` (implementation summary, TDD evidence, files changed, screenshot paths, self-review, untagged observations). Then report back under 15 lines: Status, commits, one-line test summary, concerns, report path.
