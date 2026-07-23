# Task C2 Report — At-a-glance rollups in program headers

**Lane:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-tree-glance`
**Branch:** `ant-hill/luna-tree-glance-20260722` (tip was `19f1f5e`, the reviewed C1 head)
**Commit:** `97275aa feat(programs): at-a-glance rollups in program headers`
**Status:** DONE — `bun run check` green (287 pass, 0 fail), visual QA at 1440 and 375 passed.

---

## Implementation summary

The program DRAWER head already rendered a four-cell at-a-glance rollup
(`programRollupLine`): agent count, working count, alert count, aggregate session
tokens, with honest token omission. This task brings the SAME data to the left
tree's program section headers (`renderProgram`).

Before C2, the header rendered a different, text-summary rollup — a single mono
`.program-rollup` span built from `rollupParts(deriveRollup(agents))` that read
`"1 alert · 2 working · 3 idle · 1 done"` with a `.hot` span on the alert part.
That was a *second aggregation path* (needsYou/working/idle/ended text) distinct
from the drawer's four cells, and it did not carry tokens.

C2 replaces the header's text summary with the drawer's four-cell contract, sourced
from one shared aggregation helper so the two can never drift.

### Files changed

- `src/web/app.js`
  - **Added** `programRollupCells(agents)` (near `deriveRollup`/`programRollup`) — the
    shared aggregation core: builds the ordered cell list
    `[agents, working, alert{alert:needsYou>0}, tokens?]`, with the token cell pushed
    only when at least one agent reports `tokens.sessionTotal` (honest omission).
  - **Refactored** `programRollupLine(program)` (drawer) to consume
    `programRollupCells(program.agents || [])`. Its DOM output is byte-identical
    (same `.dw-rollup` / `.dw-rollup-cell` / `.dw-rollup-value mono` / `is-alert`) —
    the two existing drawer rollup tests (B4 c / c2) stay green untouched.
  - **Added** `programHeadRollup(agents)` (replacing the removed `rollupParts`) — the
    header rollup builder: `.program-rollup` span of `.program-rollup-cell` →
    `.program-rollup-value mono` + `.program-rollup-label`, with `is-alerting` on the
    alert cell only. Sources the same `programRollupCells(agents)`.
  - **Updated** `renderProgram` to delegate its header rollup to
    `programHeadRollup(agents)`; removed the orphaned `const r = deriveRollup(agents)`
    and inline span loop.
  - **Removed** `rollupParts` (orphaned by this change — its only caller was the header).
  - **Exported** `programRollupCells`, `programHeadRollup` on `TheAntHill`.
- `src/web/styles.css` (`programs` section) — decomposed `.program-rollup` from a single
  mono text span into a wrapping flex row of value/label cells (mirroring the drawer's
  `.dw-rollup`), with `.program-rollup-cell.is-alerting .program-rollup-value` taking
  `--ember`. Removed the now-orphaned `.program-rollup .hot` rule.
- `tests/web-client.test.ts` — new `program-header at-a-glance rollups (C2)` describe
  (5 tests); updated one A4 test's selector (reconciliation, below).

### Filtered-vs-unfiltered nuance

The header receives a **filtered** agents set (`renderPrograms` line 2335 —
`program.agents.filter(...)`), while the drawer uses the **unfiltered** `program.agents`.
So the shared core takes an **agents array**, not a `program`: `programRollupCells(agents)`.
Each caller passes its own set — the header rolls up the visible/filtered agents (its
existing semantics, preserved), the drawer rolls up the full swarm. The *arithmetic* is
shared; the *input scope* stays correct per call site.

---

## Reuse-vs-extract decision (with evidence)

**Decision: EXTRACT the aggregation core; both DOM builders consume it.**

Evidence for why reuse-as-is was not possible and extraction was the surgical choice:

1. `programRollupLine` embedded the aggregation (which cells, the counts, the token
   `reduce` + honest omission, the `alert` flag) *inside* the drawer's DOM builder
   (`.dw-rollup` div). The header needs the same numbers but a different container
   (`.program-rollup`, the class A4 established) and its own ember class name
   (`is-alerting`, per the brief's example), so calling `programRollupLine` directly
   would have injected drawer-namespaced `.dw-rollup` markup into the tree header.
2. The two call sites take different inputs (filtered vs unfiltered agents), so a
   `program`-shaped helper would have forced the header to re-filter or the drawer to
   change semantics.

Extraction resolves both: `programRollupCells(agents)` is the single arithmetic path;
`programRollupLine` and `programHeadRollup` each own only their presentation shell.

**Proof of sharing (source-level test, C2-d):**
- `function programRollupCells(` appears exactly once.
- Both `programRollupLine` and `programHeadRollup` bodies contain `programRollupCells(`.
- The token reduce `sum + a.tokens.sessionTotal` appears exactly once in the whole file
  (the one bit of arithmetic that could drift lives only in the core).
- `renderProgram` contains `programHeadRollup(agents)` and no longer contains
  `deriveRollup(agents)`; `rollupParts` is gone from the source.

---

## TDD RED → GREEN

**RED** (`bun test tests/web-client.test.ts`, before implementation):
- C2 (a)/(b)/(c)/(e): `TypeError: M.programHeadRollup is not a function`.
- C2 (d): `expect(programRollupCells match count).toBe(1)` received 0.
- A4 mono test (reconciled): `.program-rollup-value` rule empty → `toContain("font-family: var(--font-mono)")` failed.

All six failed for the intended reasons (feature/helper/CSS absent), not syntax.

**GREEN** (`bun run check`, after implementation): typecheck clean; **287 pass, 0 fail,
1212 expect() calls, 20 files.** (282 prior + 5 new C2 tests; the A4 test was updated
in place, not added.)

### New tests (executable `withDom` fixtures)
- **(a)** 3-agent fixture (2 running, 1 attention, each 10k sessionTotal) → 4 cells,
  4 mono values, text `3agents`/`2working`/`1alert`/`30k`/`tokens`, exactly one
  `is-alerting` cell whose text is `1alert`.
- **(b)** 3 running / 0 attention → alert cell renders `0alerts` but **zero**
  `is-alerting` cells (calm earns no color).
- **(c)** agents lacking `sessionTotal` → 3 cells (agents/working/alert), no `tokens`
  text (honest omission).
- **(d)** source-level shared-helper proof (see evidence above).
- **(e)** rollup `aria-label` is `Program rollup: 3 agents, 2 working, 1 alert, 30k tokens`
  (data present in accessible text, extending the drawer's aria pattern).

---

## Reconciliation surfaced

**Conflict:** an existing A4 test asserted `.program-rollup { … }` contained
`font-family: var(--font-mono)` — because A4 had made the whole single-span rollup mono.
C2 decomposes `.program-rollup` into value/label cells (mirroring the drawer's
`.dw-rollup-value mono`), relocating mono to `.program-rollup-value`.

**Resolution:** updated that test's selector from `.program-rollup` to
`.program-rollup-value`, keeping the Rule-2 guarantee ("counts render in mono") intact
at its new, correct location — it still fails if anyone strips mono from the value cells.
This is the sanctioned "extend `.program-rollup` rather than add a second element" path
from the brief. No other test referenced the old header rollup internals
(`rollupParts` / `.program-rollup .hot`); the header rename/collapse/trigger test
(app.js line ~554) is behavior-only and stayed green untouched.

---

## Visual QA

Preview via `scripts/anthill-preview.sh` (throwaway port 4711, prod :4701 untouched),
driven by the gstack `browse` skill (no mcp chrome tools). Preview killed after.
Screenshots (browse restricts writes to /tmp + repo root, so captured to /tmp then
copied):

- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/c2-after-1440.png`
  — History view, 5 program headers, all calm. Rollups read
  "N agents · 0 working · 0 alerts · NN tokens" right-aligned, mono values, quiet faint
  labels, token aggregates (30.8M / 23.6M / 318k / 104.2M / 107.4M). All `0 alerts` in
  muted ink — **no ember where there are no alerts.** Scannable.
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/c2-after-1440-alert.png`
  (supplementary) — Now view, the anthill-pulse header reads
  "1 agent · 0 working · **1 alert** · 2.1M tokens" with the alert cell in ember
  (`rgb(194,59,46)` = `--ember`, confirmed via computed style) while the other three
  cells stay `rgb(68,82,96)` = `--muted`. **Ember only where alerts exist.**
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/c2-after-375.png`
  — narrow. Header content on the top row; the rollup wraps below as coherent units —
  "3 agents · 0 working · 0 alerts" then "30.8M tokens" — each cell keeping its
  value+label together (no orphaned numbers). `documentElement.scrollWidth >
  clientWidth` is **false** (no horizontal page scroll). Not chaotic.

Console: no errors on load.

---

## Self-review

- **One aggregation path proven shared** — `programRollupCells` defined once; both
  builders consume it; token reduce appears once file-wide; asserted by C2-d. ✅
- **Ember gating correct at zero and above** — `is-alerting` only when `needsYou > 0`;
  C2-a asserts present (1 alert), C2-b asserts absent (0 alerts); computed color
  verified live (`--ember` on alert, `--muted` elsewhere). ✅
- **Honest token omission** — token cell pushed only when an agent reports
  `sessionTotal`; C2-c asserts the cell is dropped and the counts still render;
  demonstrated live (History headers carry tokens; a token-less program would drop it). ✅
- **Header behaviors untouched** — rename form, caret collapse/expand, and the Details
  drawer trigger are unchanged; the existing keyboard-controls test stayed green. ✅
- **Aria extended** — the rollup's accessible name spells out the data
  (`Program rollup: …`), a data-bearing extension of the drawer's `"Program rollup"`
  group name; C2-e pins it. ✅
- **CSP-safe** — no inline `style`; ember via the `is-alerting` class only. ✅
- **Orphans cleaned** — `rollupParts` (JS) and `.program-rollup .hot` (CSS), both
  orphaned by this change, removed; no pre-existing dead code touched. ✅
- **Test output pristine** — 287 pass, 0 fail, none skipped/filtered. ✅

### Concerns / notes

- The `--font-mono` value rule uses the programs-section **longhand** convention
  (matching `.program-name` / `.program-alias-tag`) rather than the drawer section's
  `font:` shorthand — deliberate, to match the surrounding section and to keep the
  reconciled A4 test's `font-family: var(--font-mono)` assertion meaningful.
- The header aria-label is **data-bearing** (`Program rollup: 3 agents, …`), a slight
  enhancement over the drawer's static `"Program rollup"`. Kept scoped to the header;
  the drawer was left as-is (it exposes its roster below the head anyway). Minor,
  defensible divergence noted for the record.
- No feature flags; nothing skipped.
