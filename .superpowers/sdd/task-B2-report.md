# Task B2 completion report — verdict head + section reorder

## Commit

- Worktree: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem`
- Branch: `ant-hill/luna-inspector-totem-20260722`
- Commit: `af60de7 feat(inspector): verdict head with in-head action; lineage demoted below the shelf` (on top of B1's `ad4a950`)
- Not pushed. Worktree clean after commit.

## Implementation summary

`renderAgentDrawer` now appends, in order: **verdict head** (`.inspector-head.inspector-verdict`) → **control banner** (unchanged logic/position) → **`.next-action`** → **empty `.inspector-vitals` mount** → **Operate | Chat drawer-shelf** (unchanged) → **lineage spine** (demoted below the shelf) → **command dock** (unchanged).

- **Verdict head structure:** `.inspector-id` column keeps title, one quiet source line, `.inspector-sub`, `renderStatusLine` (untouched — no wrapper change was needed), and the conditional `.verdict-gate`. A right-side `.verdict-side` column stacks the Close button and, when available, the head action inside `.verdict-action`.
- **`quietSourceLine(agent)` / `fullSourceDetail(agent)`:** the three-way naming ternary collapsed into one `.inspector-source-name` render. Quiet line is `"Terminal: X"` / `"Source agent: Y"`, or **null when the terminal title IS the shown name** (also now null when an operator alias coincidentally equals the terminal title — previously rendered redundantly). `fullSourceDetail` returns the quiet line, plus `" · " + CWD_MISMATCH_HINT` on cwd mismatch — the "session cwd ≠ pane folder" sentence moved from the visible line into the tooltip. `is-mismatch` keeps a visible ember dot via a CSS `::before` (class-driven, CSP-safe). Both helpers exported on `globalThis.TheAntHill` for tests and for B4 reuse.
- **`verdictGate(agent, outcome)`:** renders only when outcome is `blocked`; text = first non-empty `agent.gates` entry, else concise `statusReason`, else "Blocked"; `statusReason` in the `title`. Ember ink + 1px outline, `background: none` — never a fill.
- **`headPrimaryAction(agent)`:** reuses `capability()` + `renderDockTool()` (no duplicated action logic). Priority: null when Focus/Send are locked (the control banner owns that story) → Focus when enabled → Interrupt only when it is the sole enabled lever → null. Head and dock instances therefore share busy/confirm/disabled behavior exactly.
- **`.inspector-vitals`:** always-rendered empty div directly after `.next-action`; `.inspector-vitals:empty { display: none; }` keeps it from spending the pane's 1rem flex gap until B3 fills it via `renderVitalsBand(agent)`.
- **CSS** added only in the `/* ---------- inspector: layered drawer ---------- */` section (verdict-side stack, verdict-action button treatment, verdict-gate chip, mismatch dot, vitals `:empty` rule) plus one line in the existing `@media (max-width: 1024px)` 44px touch sweep for `.verdict-action .dock-tool`. No inline styles; no animations added (nothing new for the reduced-motion guard to cover).

## TDD evidence

**RED** — 4 new tests in `tests/web-client.test.ts` (`describe("verdict head — act from the top (B2)")`), written first, failing for the right reasons:

```
bun test tests/web-client.test.ts -t "verdict head"
✗ drawer order …            (inspector-head inspector-verdict not found: index -1)
✗ head carries gate + action (verdictGate/headPrimaryAction missing)
✗ head de-noising            Expected: 1  Received: 4   (four inspector-source-name renders)
✗ quietSourceLine …          TypeError: M.quietSourceLine is not a function
 0 pass / 4 fail
```

**GREEN** — after implementation, the full-file run flagged one stale pre-existing assertion (below), then:

```
bun run check    →  bunx tsc --noEmit ✓
 246 pass / 0 fail / 966 expect() calls — Ran 246 tests across 20 files
```

242 pre-existing + 4 new; none skipped or filtered.

**One pre-existing assertion updated** (`redesigned network contracts > agent names track terminal titles…`): it pinned the old head ternary's literal `text: "Source agent: " + sourceAgentName(agent)`. B2's contract removes that ternary by design, so the assertion now checks `'"Source agent: " + sourceAgentName(agent)'` (the expression lives in `quietSourceLine` and in `presentationLabelTargets`). Intent — that source-agent identity stays derived from `sourceAgentName` — preserved.

## Files changed

- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem/src/web/app.js` — 4 new helpers before `renderAgentDrawer`; head rewrite + reorder inside `renderAgentDrawer`; 2 exports added to the test surface.
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem/src/web/styles.css` — verdict head/gate/source/vitals rules in the inspector section; one 44px sweep entry.
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem/tests/web-client.test.ts` — new B2 describe block (4 tests); 1 stale assertion modernized.

## Visual QA (browse skill, preview :4711, killed after)

- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/b2-after-1440-inspector.png` — 1440×900, agent drawer open. Head (y 221–302), next-action (y 375–394), vitals mount (present, 0-height), lineage below the shelf, dock pinned — all inside the 900px window without scrolling. Zero console errors after page settle.
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/b2-after-375-inspector.png` — 375×812 full-surface sheet: head → status → banner → Next → Operate → Chat → Evidence rail → Lineage → dock, opaque sheet, no horizontal scroll.
- DOM order verified live (not just source): pane children read `["inspector-head inspector-verdict","control-banner","next-action","inspector-vitals","drawer-shelf","dw-spine","command-dock"]`.
- The ember ring around the drawer title in both screenshots is the pre-existing `focusDrawerLead()` focus affordance (app.js:2811-2821), not a B2 change. An earlier 375 capture caught the `sheet-up` opacity animation mid-flight (background bleed); the committed shot is post-settle.

## Self-review

- Interface names match the brief exactly: `.inspector-verdict`, `.verdict-gate`, `.inspector-vitals`, `quietSourceLine`, `fullSourceDetail`, `headPrimaryAction(agent)`, lineage appended after the drawer-shelf. Verified by grep and in the live DOM.
- Untouched as required: `renderControlBanner` internals, `renderStatusLine`, Evidence shelf/contents, per-type drawers, `workStateBanner`/`impactBlock` (no diff hunks anywhere near them), `renderPrimaryActions` body.
- Every changed line traces to the brief; `git diff` reviewed hunk-by-hunk before commit; no secrets.

## Concerns

1. **`renderPrimaryActions` placement:** it was already a dead thin alias to `renderCommandDock` before B2 — zero call sites; kept (per its own comment) only so source-level tests find `controlUnavailableText` through the dock path. B2 derives `headPrimaryAction` from the same underlying code (`capability` + `renderDockTool`) rather than from the alias, so the alias is now doubly redundant. Left in place per the brief ("do not delete beyond your task"); flag for a later cleanup task.
2. **Duplicate `data-fkey` when the head action renders:** head and dock Focus buttons share `act:<id>:focus`; the focus-restore `querySelector` resolves to the head instance (first match). Behavior is correct, but keyboard focus parked on the dock's Focus tool can migrate to the head instance across a re-render. Minor; fixable in B3/B4 if it bothers.
3. **Interrupt-as-head-action confirm:** if Interrupt ever leads the head (only when no Focus capability exists), triggering it renders the confirm strip in both head and dock (shared `state.confirming` key). Both work; visually duplicated in a rare state.
4. **Gate/action states not photographed:** both live agents during QA were observed-only (banner shown, head action correctly null) and none blocked, so `verdict-gate` and the in-head Focus button are verified by intent tests and helper logic, not by a live screenshot.

## Review fixes — instance-scoped head keys + executable coverage

Commit: `c07d0f9 fix(inspector): instance-scoped head action keys + executable head-logic coverage`

Controller decision implemented as specified: instance-scoped keys — the dock always renders its full toolset (unchanged), the head keeps its single action, duplication resolved at the key level.

1. **Distinct head fkey (Important #1).** `renderDockTool(agent, cap, action, opts = {})` now builds `fkey = (opts.fkeyPrefix || "") + "act:" + key` and `confirmKey = prefix + "confirm:" + key`; `headPrimaryAction` passes `{ fkeyPrefix: "head:" }`, so the head Focus renders `head:act:<id>:focus` while the dock keeps `act:<id>:focus`. The `render()` first-match focus restore (app.js ~1292-1318 / ~1451-1487) now resolves each instance exactly. **Escape-cancel path verified and fixed per-instance:** `state.confirming` stores the full instance fkey, and the Escape handler restores focus via `CSS.escape(key)` on that stored value — the strip's opener gets focus back, head or dock. The composer Send fkey (`act:<id>:instruct`) is untouched — the head never renders instruct, so it was never duplicated.
2. **Confirm strip per instance (Important #2).** The strip renders only when `state.confirming === fkey` (the instance fkey) and the opener sets `state.confirming = fkey`, so clicking Interrupt in the head confirms only in the head, and in the dock only in the dock. Shared `busy`/`sendControl` semantics unchanged (still keyed by `<id>:<action>`). `state.confirming`'s doc comment updated to the new format.
3. **Executable head-logic coverage (Important #3).** `verdictGate` and `headPrimaryAction` exported on `globalThis.TheAntHill`. New describe block `"B2 review fixes — instance-scoped head keys + executable head logic"` installs a minimal fake `document` around each call (app.js is imported DOM-less, so the fake is scoped per-call and deleted after) and asserts **actual returns**: safe-locked → null; focus enabled → `.dock-tool` node with fkey `head:act:codex:a1:focus`; focus absent + interrupt enabled → fkey `head:act:codex:a1:interrupt`; all controls absent → null; verdictGate gate-text vs statusReason fallback, and null when not blocked. Substring assertions retained for the key-scoping wiring.
4. **Fold-in minors.** `verdictGate` title is `statusReason || gate || null` — gate-only agents get the gate text as tooltip, never empty. `quietSourceLine` keeps the mismatch mark when the shown name equals the terminal title (`terminal === agentName(agent) && !mismatch` is now the only quiet path); the paired test also pins the calm case staying null.

**TDD evidence.** RED first (4 new tests):

```
✗ headPrimaryAction …   TypeError: M.headPrimaryAction is not a function
✗ verdictGate …         TypeError: M.verdictGate is not a function
✗ cwd mismatch keeps its mark …   Expected: "Terminal: Ridge pane"  Received: null
✗ instance-scoped keys …          Expected to contain: 'opts.fkeyPrefix || ""'
 0 pass / 4 fail
```

GREEN after implementation:

```
bun run check  →  bunx tsc --noEmit ✓
 250 pass / 0 fail / 988 expect() calls — Ran 250 tests across 20 files
```

246 pre-fix + 4 new; none skipped. Worktree clean after commit; not pushed.

**Out of scope, untouched per instructions:** shared `isSafeLocked` extraction; ordering-test regex hardening.
