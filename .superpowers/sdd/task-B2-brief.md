# Task B2: Verdict head + section reorder (Fable 5 xhigh, WS-B lane)

**Work in:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem` — branch `ant-hill/luna-inspector-totem-20260722`, tip `ad4a950` (B1 backend contract landed: `SourceHealthSummary.byProvider` + `POST /api/recollect`). All work and commits happen HERE. Never push; never touch `main` or other checkouts.

**Your inputs (read in this order):**
1. `/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md` — vocabulary + six rules (canonical copy; it lands in this lane later via the WS-A rebase — do not copy or commit it here).
2. `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/AUDIT.md` — the **"WS-B/WS-C input"** findings that touch the inspector (read for context; fix only what falls inside your files below — the rest belongs to B3/B4/WS-C).
3. `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-B1-report.md` — the exact backend contract (`byProvider` read path, recollect route semantics).
4. Baseline "before" screenshot: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/baseline-1440-inspector.png`.

## The ordering contract (what "important at the top" means)

Target order inside `renderAgentDrawer`:
1. **Verdict head** — agent name + status word + outcome (ink-colored), blocker/gate chip when blocked (`verdict-gate`, ember ink outline — not a fill), and the single most-relevant primary action **in the head**.
2. **Next action** line (directly under the head).
3. **`.inspector-vitals` mount** — an empty container B3 will fill; it must exist in the DOM order now.
4. **Operate | Chat** shelf (drawer-shelf, unchanged behavior).
5. **Lineage spine** (demoted: moves from above the shelf to below it — context, not action).
6. **Evidence rail** (unchanged in this task; B3 extracts vitals from it).
7. **Command dock** pinned at the bottom (unchanged).

Today's `renderAgentDrawer` order is: head (with naming noise) → control banner → lineage spine → nextAction → shelf → dock.

**Head de-noising:** the three-way naming ternaries (`Terminal: … · session cwd ≠ pane folder` / `Terminal: …` / `Source agent: …`) collapse into two helpers you create — `quietSourceLine(agent)` (one short line of text, or null when the terminal name matches the display name) and `fullSourceDetail(agent)` (the complete sentence for the `title` tooltip). One `.inspector-source-name` element renders the quiet line with the full detail as its `title`; the `is-mismatch` state keeps a visible mark (ember dot or equivalent class) but the explanatory sentence lives in the tooltip.

**Control banner:** keeps its current render logic and position immediately after the head (it is state, not navigation). Do not restyle its internals — language conformance of banner visuals is a later task.

**Primary action in the head:** derive from the existing `renderPrimaryActions(agent)` logic — extract a `headPrimaryAction(agent)` helper returning the single most-relevant action control (or null), reusing the existing action-derivation code rather than duplicating it. `renderPrimaryActions` itself stays for wherever it currently renders (if that placement becomes redundant, note it in your report — do not delete beyond your task).

**Files:**
- Modify: `src/web/app.js` (`renderAgentDrawer`, `renderStatusLine` only if the head integration requires a wrapper change, `renderPrimaryActions` refactor into the shared helper), `src/web/styles.css` (`/* ---------- inspector: layered drawer ---------- */` section for the head/verdict/gate/source-name styles)
- Test: `tests/web-client.test.ts`

**Interfaces produced (B3/B4 depend on these exact names):**
- `.inspector-verdict` head block containing `.verdict-gate` (conditional) and the head action.
- `.inspector-vitals` empty mount directly after `.next-action` (B3 fills it via `renderVitalsBand(agent)`).
- `quietSourceLine`/`fullSourceDetail` helpers (B4 reuses them for other drawer types' heads).
- Lineage spine appended AFTER the drawer-shelf.

## Steps

1. **Write failing intent tests** in `tests/web-client.test.ts` (follow the extract-and-assert idiom of the newest tests there): (a) `renderAgentDrawer` source appends the lineage spine after the drawer-shelf (regex on ordering within the function body); (b) head contains `verdict-gate` and a primary-action control; (c) a single `.inspector-source-name` render with a `title` attribute (the ternary block gone); (d) `.inspector-vitals` mount exists between next-action and the shelf.
2. `bun run check` → new tests FAIL for the right reasons.
3. **Implement.** Surgical; keep `el()` idiom; CSP-safe (no inline styles); reuse existing tokens.
4. `bun run check` → all green (242 + yours).
5. **Visual QA:** `scripts/anthill-preview.sh`, then the gstack `browse` skill (never mcp chrome tools): open an agent drawer at 1440×900 — verify head, next action, and the (empty, zero-height is fine) vitals mount are all visible without scrolling in a 900px-tall window; screenshot to `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/b2-after-1440-inspector.png`. Also 375×812 full-surface drawer sanity shot `b2-after-375-inspector.png`. Kill the preview.
6. **Commit:** `feat(inspector): verdict head with in-head action; lineage demoted below the shelf` (body: ordering contract + which rules it enforces).

## Global Constraints (binding)

- Strict CSP: never inline `style`; variant colors via classes (`dw-provider--<provider>` pattern stays).
- Mono only for identifiers/paths/timestamps/token+cost values.
- Indicator inks, not flood fills; `verdict-gate` is ember ink + outline/edge, never a filled banner.
- Inspector width `--inspector-w: clamp(480px, 32vw, 520px)` desktop; full-surface drawer <1024px; 44px touch targets <1024px for interactive elements you add or move.
- `prefers-reduced-motion` disables any animation you add.
- `workStateBanner` + `impactBlock` rendering in the intervention/advisory/investigation drawers must remain untouched (regression guard from the pulse program).
- No feature flags. Tests stay green, none skipped.

## Report

Write your full report to `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-B2-report.md` (implementation summary, TDD evidence RED→GREEN, files changed, screenshot paths, self-review, concerns — including whether `renderPrimaryActions`' original placement became redundant). Then report back under 15 lines: Status, commits, one-line test summary, concerns, report path.
