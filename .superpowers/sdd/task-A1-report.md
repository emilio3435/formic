# Task A1 Report — Codify the Ant Hill design language

**Status: DONE** (with two judgment calls flagged for the Sonnet audit — see Concerns).

## What was written

Created `/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md` (the
single deliverable), structured as:

1. **Vocabulary** — all 48 custom properties from the pulse worktree's `styles.css`
   with exact names and current values verbatim: 41 `:root` tokens (ground, ink
   scale, indicator inks + `-soft` mixes, `--signal-rail`, semantic aliases,
   provider inks, typography, radii, `--frame`, `--inspector-w`, shadow scale) plus
   7 component-scoped properties (`--prov`, `--role-color`, `--role-surface`,
   `--role-ink`, `--tree-depth`, `--tree-color`, `--inspector-pad-x`) with the
   classes that set them.
2. **Named patterns** — mono-for-values, SVG-attribute meters (full class
   inventory), urgency-weighted cell, calm collapse, progressive disclosure
   (thin trigger → drawer), signal rails/edge marks.
3. **The six rules** — named and worded exactly as the brief names them.
4. **Per-section conformance checklist** — 16 rows (the brief's exact section
   list) x R1–R6, each cell pass / FAIL / ? / n/a, with per-row evidence notes.
5. **Open questions for the audit** — 5 items.

## How token-name fidelity was verified

Scripted self-review, all clean:

- Every `--token` string in the doc grepped against
  `/Users/emilionunezgarcia/Developer/anthill-pulse/src/web/styles.css` — 0 missing.
- Every `.class` name cited in the doc grepped against the same file — 0 missing.
- All 16 checklist headers matched against real `/* ---------- section ---------- */`
  headers — all present (used the full header text where it is longer than the
  brief's short name, e.g. `vitals band: the instrument tiles`; both forms appear
  in the table so greps on either hit).
- The six rule names grepped verbatim — all exact.
- Value spot-checks (`--frame`, `--inspector-w`, `--shadow-lift`, `--ember-soft`,
  `--font-mono` stacks) verbatim — all exact.

## Files changed

- Created: `/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md`
- Created: this report file (as instructed by the task message).
- Nothing else touched; no git commands run anywhere; pulse worktree read-only.

## Key findings from the assessment

- **The 16 body sections are byte-identical between pre-pulse main and the pulse
  worktree except `responsive`** (only the strip's wrap rules differ there). Diff
  confined to lines ~81–755 (health rail + attention board → pulse strip) and the
  responsive strip rules. So the checklist holds for both trees, and the post-G0
  baseline is well-defined.
- **CSP-safe rendering passes file-wide**: zero `style=` in `index.html`, zero
  `.style`/inline-style writes in `app.js` (all 9 "style" hits are comments about
  CSP or `styles.css` references); meters are SVG-geometry, variants class-driven
  (`.dw-provider--*` sets `--prov`).
- **Motion guard is universal** (`*, *::before, *::after { animation: none
  !important; transition: none !important; }`), so R6 passes for every section.
- **Only one non-pass cell**: usage tab R2 marked `?` — token/cost values render
  in `--font-ui` tabular-nums, not `--font-mono`; whether Rule 2's positive
  direction makes that a gap is left to the audit (doc open question 4).

## Concerns / judgment calls (for the audit to ratify)

1. **Mono micro-label idiom.** Rule 2 says values-only, but the finished pulse
   sections use `--font-mono` pervasively for 9–12px uppercase micro-labels
   (`.eyebrow`, `.dw-eyebrow`, `.vital-label`, `.agent-column-label`, ...). I
   documented this as an observed idiom (label furniture, not prose) and judged
   those cells pass; if the audit reads Rule 2 strictly, many cells flip to FAIL —
   including in the pulse reference itself. Doc open question 1.
2. **Flood-fill boundary.** 5–10% color-mix washes behind rails/borders
   (`.agent-row.is-needs-you`, `.dw-block--fix`, `.control-banner`) and small
   solid chips (`.policy-chip`, `.state-pill.policy-mismatch`) judged pass;
   proposed a codified threshold (tint <= 10%, always edge-marked) in doc open
   question 2. Filled *action* buttons (`.btn.primary`, `.btn.confirm-yes`)
   judged outside Rule 1's scope (question 3).
3. **Pulse files mid-edit**: no visible instability during my reads — the `:root`
   block, header comment, and all 16 checklist sections were coherent, and the
   `?v=bookshelf-seam-1` cache-buster in `index.html` matched the bookshelf
   sections present in the CSS. Line numbers will drift, so the doc cites no line
   numbers.
4. **Non-token hexes** worth tokenizing during the restyle (not blocking):
   `#34302a` warm-dark hover (predates cool graphite `--ink`), literal `#b42318`,
   `#fff`, `#f4c9bd`, role-cue and tree-depth hexes. Doc open question 5.

## Fix report (post-review)

Applied exactly the three reviewer-directed changes to
`/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md`. Nothing
else in the file was touched.

### Change 1 (factual error) — `.vital-big` mono claim, in "## 2. Named patterns" / "Mono-for-values"

**Source evidence verified:**
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem/src/web/app.js`, `renderVitals` (lines 3773, 3779, 3788, 3797, 3800) — every single `.vital-big` call site reads `class: "vital-big mono"` (5/5, zero exceptions).
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem/src/web/styles.css:1776` — `.vital-big { font-size: 1.45rem; ... color: var(--ink); }` sets no `font-family` itself; line 118 — `code, .mono { font-family: var(--font-mono); ... }` supplies the mono via the paired class.
- Confirmed `.reading-value` (styles.css:288, app.js:1377/4619-4627) never carries a `mono` class, so it genuinely stays `--font-ui` tabular-nums — the doc's claim about `.reading-value` was correct and left as-is.

**Before:**
> Large display numerals stay `--font-ui` with `font-variant-numeric: tabular-nums` (`.reading-value`, `.vital-big`). Mono never carries headings or sentence prose.

**After:**
> Large display numerals split: `.reading-value` stays `--font-ui` with `font-variant-numeric: tabular-nums`, while `.vital-big` values are always mono — every `renderVitals` call site in `app.js` pairs the class with `mono` (`"vital-big mono"`). Mono never carries headings or sentence prose.

### Change 2 (omission) — `.program-alias-tag` deviation note, same paragraph

**Source evidence verified:**
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem/src/web/styles.css:857` — `.program-alias-tag { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); border: 1px solid var(--line-strong); border-radius: 3px; padding: 0 0.25rem; margin-left: 0.35rem; }` — no `font-family` declared anywhere for this selector (single hit in the file); styles.css:77 sets body `font-family: var(--font-ui)`, so it inherits ui, not mono, despite the uppercase/tracked/faint look matching the micro-label idiom.

**Added (one line, inserted into the same paragraph, right after the mono-micro-label sentence):**
> `.program-alias-tag` deviates from the idiom: it has the same uppercase, tracked, faint-ink look but never sets `font-family`, so it renders in `--font-ui`, not mono.

### Change 3 (controller ruling) — `--failed` vocabulary ruling, in "### Semantic aliases (state → ink)"

**Source evidence verified:**
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem/src/web/styles.css:1603-1608` — `.control-banner { ...border: 1px solid color-mix(in srgb, var(--failed) 28%, var(--line)); background: var(--ember-soft); ...}` and `.control-banner .ico { ...color: var(--failed); ...}` — confirms `.control-banner` mixes `--failed` ink (border + icon) with `--ember-soft` background tint, exactly the pattern the ruling sanctions.
- Grepped the vocabulary tables for `--failed-soft` — no such token exists anywhere in styles.css, consistent with the ruling that none should be added.

**Added (new block, directly under the semantic-aliases table where `--failed` is documented):**
> **Ruling: `--failed` is ink-only.** There is deliberately no `--failed-soft` token; failed states that need a background tint borrow `--ember-soft` instead. `.control-banner` mixing `--failed` ink (border/icon) with an `--ember-soft` background tint is the sanctioned pattern, not a defect. (Decision: minimal vocabulary — recorded 2026-07-23 by the program controller.)

## Fix report (controller re-review sweep)

Two remaining instances of the same `.vital-big` factual error (survivors of the
first pass) corrected in
`/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md`. Same
evidence as Change 1 above applies (`app.js` `renderVitals`, 5/5 call sites use
`class: "vital-big mono"`; `.vital-big` itself sets no `font-family` in
`styles.css:1776`).

### Change 4 — conformance checklist, "vitals band" row (R2 cell)

**Before:**
> `.vital-sub`/`.ring-pct` mono micro-labels; `.vital-big` numerals in ui tabular-nums (R2). Omit-empty tiles (R5).

**After:**
> `.vital-sub`/`.ring-pct` mono micro-labels; `.vital-big` numerals are always mono via the paired `mono` class (R2 pass). Omit-empty tiles (R5).

### Change 5 — open question 4, ui-tabular-nums citation

**Before:**
> `.row-fact-value`, or is ui-tabular-nums the display-numeral idiom (as in `.reading-value`/`.vital-big`)?

**After:**
> `.row-fact-value`, or is ui-tabular-nums the display-numeral idiom (as in `.reading-value`)?

(Open question 4 itself is otherwise unchanged — still open, `.vital-big` simply removed from the ui-tabular-nums example list since it isn't one.)

### Grep-clean verification

```
$ grep -n "vital-big" DESIGN-LANGUAGE.md
133: ... while `.vital-big` values are always mono —
135: ... (`"vital-big mono"`). Mono never carries headings or sentence prose.
262: ... `.vital-big` numerals are always mono via the paired `mono` class (R2 pass). ...
```

All three remaining `.vital-big` mentions state it is mono; none associate it
with `--font-ui`/tabular-nums. No line in the doc now mislabels `.vital-big`.
