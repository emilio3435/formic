# Task B3: Vitals instrument band promotion (Opus 4.8, WS-B lane)

**Work in:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem` — branch `ant-hill/luna-inspector-totem-20260722`, tip `c07d0f9` (B1 backend + B2 verdict head landed; 250 tests green). All work and commits happen HERE. Never push; never touch `main` or other checkouts.

**Your inputs (read in this order):**
1. `/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md` — vocabulary + six rules. Note the corrected `.vital-big` fact: its values are ALWAYS mono via a paired `mono` class at every call site — preserve that convention when you move the tiles.
2. `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-B2-report.md` — B2's interfaces you consume: the empty `.inspector-vitals` mount (rendered between `.next-action` and the drawer-shelf), and the head structure you must not disturb.
3. `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-B1-report.md` — the backend contract: `snapshot.totals.sourceHealth?.byProvider?.[provider]?.lastHealthyAt` exists per provider (you do NOT need it for agent tiles; it is listed so you know what exists — using it is B4/degraded-header scope, not yours).

**The task:** move the vitals tiles OUT of the Evidence shelf (`renderEvidenceShelf`) into a new `renderVitalsBand(agent)` that fills B2's `.inspector-vitals` mount. Evidence keeps paths, routing, and the transcript tail.

**Files:**
- Modify: `src/web/app.js` (extract the vitals block from `renderEvidenceShelf` into `renderVitalsBand(agent)`; call it where `.inspector-vitals` is mounted in `renderAgentDrawer`), `src/web/styles.css` (`/* ---------- vitals band ---------- */` section — adapt tile styles to the band's new position under the head; compact row layout)
- Test: `tests/web-client.test.ts`

**Interfaces produced:**
- `renderVitalsBand(agent)` — exported to `globalThis.TheAntHill` (follow the export pattern B2 used for its helpers) so tests execute it.
- The band renders inside `.inspector-vitals` as a compact tile row: values in mono (the existing `vital-big mono` convention), labels in `--faint`; the context meter stays an SVG-attribute meter (CSP rule).
- Honest fallbacks preserved exactly: unknown values render the codebase's existing honest strings ("not reported", observed-token fallback) — never invented numbers.
- **Per-agent cost tile:** only if the agent record already carries a per-agent cost field at your base commit. If cost exists only at program/pulse level, OMIT the cost tile entirely — do not render program-level cost inside an agent's band, and say so in your report. Check the actual snapshot types in `src/shared/types.ts` before deciding; state your finding.

## Steps

1. **Write failing intent tests** in `tests/web-client.test.ts` (mix of the extract-regex idiom AND executable fixture style B2 established with `withDom`): (a) `renderVitalsBand` exists, is exported, and — executed against an agent fixture with model/tokens/elapsed — returns a node containing mono-classed values; (b) executed against a fixture with missing vitals, it renders the honest fallback text, not fabricated values; (c) `renderEvidenceShelf` source no longer contains the vitals block (quote the moved pattern from source for the absence check); (d) `renderAgentDrawer` fills `.inspector-vitals` with the band.
2. `bun run check` → new tests FAIL for the right reasons.
3. **Implement.** This is an extraction-and-rehome, not a redesign: reuse the existing tile markup/classes wherever they survive the move; adapt CSS in the vitals-band section for the band's new position (compact horizontal row under the head at desktop width, wrapping gracefully at <1024px full-surface drawer).
4. `bun run check` → all green (250 + yours).
5. **Visual QA:** `scripts/anthill-preview.sh`, then the gstack `browse` skill (never mcp chrome tools): open an agent drawer at 1440×900 — head, next-action, and the FILLED vitals band all visible without scrolling in a 900px window; Evidence shelf opens and shows paths/routing/transcript WITHOUT vitals. Screenshots to `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/b3-after-{1440,375}-inspector.png`. Kill the preview.
6. **Commit:** `feat(inspector): vitals promoted to an instrument band under the verdict head` (body: what moved, what Evidence retains, the cost-tile decision, rules enforced).

## Global Constraints (binding)

- Strict CSP: never inline `style`; meters via SVG attributes; variant colors via classes.
- Mono only for values (the `vital-big mono` convention); labels `--faint` in ui font.
- Indicator inks, not flood fills.
- `--inspector-w` desktop; full-surface drawer <1024px; 44px touch targets <1024px for any interactive element you add or move.
- `prefers-reduced-motion` guard for any animation you touch (the existing `dw-pulse` guard must keep covering whatever you move).
- `workStateBanner` + `impactBlock` untouched (regression guard).
- No feature flags. Tests stay green, none skipped.

## Report

Write your full report to `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-B3-report.md` (implementation summary, the cost-tile decision with the types evidence, TDD RED→GREEN, files changed, screenshot paths, self-review). Then report back under 15 lines: Status, commits, one-line test summary, concerns, report path.
