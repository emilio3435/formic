# Task C1: Row instrument cluster + de-noise (Opus 4.8, WS-C lane)

**Work in:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-tree-glance` — branch `ant-hill/luna-tree-glance-20260722`, cut from `main` at `21d1b5f` (both prior workstreams landed; 276 tests green). All work and commits happen HERE. Never push; never touch `main` or other checkouts.

**Your inputs (read in this order):**
1. `DESIGN-LANGUAGE.md` at the lane root (tracked) — vocabulary + six rules; cite rule names in tests and commit body.
2. `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/AUDIT.md` — the **WS-C input findings** that fall inside the agent-rows scope (known: agent-row alert washes missing their colored edge rail — conform per Rule 1's tint-plus-edge-mark contract). Findings outside agent rows are not yours.
3. Current `renderAgentRow` / `renderAgentRows` / `renderAgentColumnHeader` / `renderSwarmAnchor` in `src/web/app.js`, and the `/* ---------- agent rows ---------- */` styles section — read fully before changing.

**Row contract (the "maximum detail at a glance, zero clutter" target):**
- One line per agent: `[provider mark] [name] [role chip if not agent] … [status word·outcome] [model + ctx%] [tokens] [elapsed]`.
- The right-side cluster is a new `.row-instruments` class: values in `--font-mono` with tabular-nums, right-aligned, honest fallbacks (reuse the existing derivations — `modelShort`, the context-window derivation, `tokenSummary`, elapsed — never invent numbers; omit a cell honestly when unknown, matching the vitals-band precedent).
- **De-noise:** the `terminal:` / `source:` / `cwd differs` TEXT tags leave the row. Default rendering keeps only a small mark for the mismatch state (ember dot with an accessible label), with the full sentence in the row's `title` and available in the drawer (which already carries it via `quietSourceLine`/`fullSourceDetail` — reuse those helpers for the tooltip text where they fit; do not fork new naming logic).
- Task summary stays as the second line, single-line ellipsized.
- Keep untouched: rename button behavior, selection checkbox flow, swarm anchor/cluster notes, row `aria-label` completeness (fold the de-noised detail into the aria-label/tooltip so screen readers lose nothing).
- `renderAgentColumnHeader` updates to name the instrument columns.
- Responsive: at <720px the instrument cluster collapses to model + status only (drop tokens/elapsed cells) — via CSS, not JS branching, if the markup allows; otherwise the smallest honest JS conditional.

**Files:**
- Modify: `src/web/app.js` (`renderAgentRow`, `renderAgentColumnHeader`; `renderAgentRows` only if column layout requires), `src/web/styles.css` (`agent rows` section + its `responsive` entries)
- Test: `tests/web-client.test.ts`

## Steps

1. **Write failing intent tests** (extract-regex + `withDom` executable fixtures per the established idioms): (a) executed `renderAgentRow` against a fixture agent renders `.row-instruments` containing model, tokens, elapsed with mono classes; (b) executed against a fixture with unknown tokens/context renders honest omission (no fabricated cells); (c) the literal `"terminal: "` prefix no longer appears in `renderAgentRow`'s source output path (absence check quoting the current pattern) while the mismatch state still renders a marked indicator; (d) column header names the instrument columns; (e) the audit's alert-wash finding — replacement rule present, offending pattern absent.
2. `bun run check` → new tests FAIL for the right reasons.
3. **Implement.** Surgical; match section conventions; CSP-safe.
4. `bun run check` → all green (276 + yours).
5. **Visual QA:** `scripts/anthill-preview.sh` + gstack `browse` skill (never mcp chrome tools): at 1440×900 a program with many agents fits without wrapping and the cluster is scannable; at 720/375 the cluster collapses per contract; row keyboard navigation (tab/arrows into drawer) still works. Screenshots to `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/c1-after-{1440,375}.png`. Kill the preview.
6. **Commit:** `feat(rows): instrument cluster per agent; naming noise demoted to tooltip` (body: contract, findings closed, rules enforced).

## Global Constraints (binding)

- Strict CSP: never inline `style`; variant colors via classes.
- Mono only for values; labels ui/`--faint`; indicator inks + edge rails, not flood fills.
- 44px touch targets <1024px for interactive elements you add/move (rows are interactive — preserve their existing swept height treatment).
- `prefers-reduced-motion` guard for any animation you add.
- No feature flags. Tests stay green, none skipped.
- Accessibility is a hard line: information removed from visible text must survive in `title`/`aria-label`.

## Report

Write your full report to `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-C1-report.md` (implementation summary, TDD RED→GREEN, files changed, screenshot paths, self-review, untagged observations). Then report back under 15 lines: Status, commits, one-line test summary, concerns, report path.
