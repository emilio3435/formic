# Task A3 Report — Toolbar + view tabs on the instrument-rail language

**Status:** DONE_WITH_CONCERNS (one interpretation call flagged below; no defects)
**Lane:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-body-language`
**Branch:** `ant-hill/luna-body-language-20260722` (cut from `main` @ `00f4bf0`)

## Commits created

| SHA | Subject |
|---|---|
| `0c12a35` | docs: codify techno-orchestra design language + conformance checklist |
| `b4f9d80` | feat(web): toolbar + view tabs on the instrument-rail language |

Nothing pushed; `main` and all other checkouts untouched.

## What I implemented

Single A3 audit finding + the brief's forward interface contract, restricted to the
`toolbar: views, filter chips, search` CSS section, `renderTabs`, and the default-tab
markup.

1. **`.select-toggle[aria-pressed="true"]` flood-fill fix (the one A3 audit finding).**
   Was `color: var(--surface); background: var(--ink); border-color: var(--ink)` — a
   full ink flood for the "currently selecting" mode. Now
   `color: var(--ink); background: var(--sand); border-color: var(--ink)` — ink text +
   sand tint + ink edge mark, exactly the audit's specified replacement, matching its two
   toolbar siblings. Enforces **Rule 1** (indicator inks, not flood fills).

2. **`.view-tab` active state → `is-current` ink underline (interface contract).**
   Migrated the active tab from an `[aria-pressed="true"]` filled/boxed tab
   (`background: var(--surface)` + `border-color: var(--line-strong)` box + `box-shadow`)
   to `.view-tab.is-current { color: var(--ink); background: transparent;
   border-color: transparent; border-bottom: var(--signal-rail) solid var(--ink) }` — a
   clean 2px `--signal-rail` ink underline, no fill. `renderTabs` now toggles the
   `is-current` class (`aria-pressed` retained for a11y); `index.html` seeds `is-current`
   on the default Now tab so the active marker is correct before/independent of JS. This
   is the exact `is-current` semantics WS-C reuses unchanged. **Rule 1.**

3. **`.view-tab .count` badges → `var(--font-mono)`.** Added `font-family: var(--font-mono)`
   (kept tabular-nums). Counts are numeric values. **Rule 2** (mono for values).

## Interface contract satisfied

- `.view-tab` active = ink text + 2px `--signal-rail` bottom rail via class `is-current`. ✓
- `.count` badges in `var(--font-mono)`. ✓
- Search input + `.select-toggle` are quiet outline controls; `.select-toggle` pressed =
  ink text + edge mark/tint, not a flood. ✓ (computed styles verified live)
- Alert count keeps `--ember` as ink, not fill. ✓ interpreted as a non-regression guardrail
  — the count carries `--faint`/`--muted` with no fill; no ember flood introduced. See
  Concerns.

## TDD evidence (RED → GREEN)

Test idiom matched: string/regex assertions over the `styles` / `source` file contents in
`tests/web-client.test.ts`. New describe block: `toolbar on the instrument-rail language (A3)`,
four tests (a: is-current `--signal-rail` rail + no `--surface` fill + `classList.toggle("is-current"`;
b: old `.view-tab[aria-pressed="true"]` filled-surface rule gone, quoting the offending pattern;
c: `.view-tab .count` uses `font-family: var(--font-mono)`; d: `.select-toggle[aria-pressed="true"]`
ink+sand+ink, no `background: var(--ink)`).

**Baseline before work:** `bun run check` → typecheck clean, `237 pass, 0 fail`.

**RED** — after writing the four tests, before implementation (`bun test tests/web-client.test.ts`):
```
✗ toolbar on the instrument-rail language (A3) > active view-tab is an is-current ink signal rail, not a filled tab (Rule 1)
✗ toolbar on the instrument-rail language (A3) > the old filled-surface active-tab rule is gone (Rule 1)
✗ toolbar on the instrument-rail language (A3) > view-tab count badges render in mono (Rule 2: mono for values)
✗ toolbar on the instrument-rail language (A3) > select-toggle pressed state is an ink outline + tint, not a flood fill (Rule 1)
```
Failure reasons confirmed correct: `.view-tab.is-current` rule absent, `classList.toggle("is-current"`
absent from source; the `.view-tab[aria-pressed="true"] { ... background: var(--surface)` pattern
still present; `.view-tab .count` lacked `font-family: var(--font-mono)`; select-toggle still had
`background: var(--ink)` not `var(--sand)`.

**GREEN** — after implementation, focused block (`bun test -t "instrument-rail"`):
```
4 pass
89 filtered out
0 fail
```
Full suite (`bun run check`): typecheck clean, `241 pass, 0 fail` (237 baseline + 4 new), no skips.

## Files changed

- `src/web/styles.css` — 3 lines in the toolbar section (view-tab active rule, count rule, select-toggle rule).
- `src/web/app.js` — 3 lines in `renderTabs` (toggle `is-current`, keep `aria-pressed`).
- `src/web/index.html` — 1 line (default Now tab gains `is-current`).
- `tests/web-client.test.ts` — +38 lines (new describe block, 4 tests).
- `DESIGN-LANGUAGE.md` — added to lane root (Step 0 docs commit).

## Visual QA (gstack browse skill, preview :4711 via scripts/anthill-preview.sh)

Screenshots (browse write-scope is cwd/`/private/tmp` only, so captured to `/private/tmp`
then copied to the target dir):
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/a3-after-1440.png` (1440×900)
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/a3-after-375.png` (375×812)

Programmatic checks:
- No horizontal scroll at either viewport: `scrollWidth == clientWidth` (1440/1440, 375/375).
- No console errors.
- Active tab marker: `is-current=now aria-pressed=true` (both the styling class and the a11y attribute set).
- Alignment: `#views`, `.toolbar`, `.search-wrap` all left-align at 42px inside the ops-stage
  gutter; `.app-body` aligns to the `--frame` edge (32px = (375−311)/2). The 10px tab inset is
  `.ops-stage { padding: 0.6rem 0.85rem 5rem }` — a pre-existing shell gutter shared by all body
  content, untouched by this task (toolbar-only edits carry no horizontal geometry).
- Select-toggle pressed, computed styles at rest: `color rgb(18,24,32)=--ink`,
  `background rgb(232,237,242)=--sand`, `border rgb(18,24,32)=--ink` — flood gone. (Under hover
  the border reads `--muted` from the later `.btn:hover` rule at equal specificity — a pre-existing
  interaction identical for the old rule, not a regression.)

Preview server killed after QA (port 4711 confirmed free).

## Self-review

- **Completeness vs brief:** Steps 0–6 all done in order; docs commit first, RED before GREEN,
  visual QA at both viewports, final commit with findings/rules in the body.
- **No scope creep:** A4 (`.program-alias-tag`), A5 (`.usage-table`), A6 (44px sweeps for
  `.filter-chip`/`.program-details`/text inputs) all left untouched — confirmed by diff. Only the
  toolbar section, `renderTabs`, and the default-tab markup changed.
- **Conventions:** single-line CSS rules matching neighbors, custom properties only
  (`--signal-rail`, `--sand`, `--font-mono`), no inline styles, no new motion (guard block
  untouched), CSP-safe (class toggling only).
- **Touch targets / new interactive classes:** `is-current` is a state modifier on the existing
  `.view-tab` button — no new interactive element introduced, so the 44px-<1024px rule for *new*
  classes has no new surface. Pre-existing 30/32px min-heights are A6's sweep, per the brief.
- **Test quality:** each assertion keys off a specific source pattern that flips on a real
  regression (renaming the rail token, restoring the fill, dropping mono, restoring the flood);
  no hollow/snapshot assertions.

## Concerns

1. **"Alert count keeps `--ember` as ink, not fill"** (interface-contract bullet). Source today
   has **zero** ember on any `.count` — the Alerts (needs-you) tab count renders `--faint`/`--muted`
   like every other tab. I read "keeps" as a non-regression guardrail (do not turn the alert count
   into an ember flood) and satisfied it by not introducing any ember. I did **not** add ember *ink*
   to the alert count, because (a) it is not one of the brief's four required tests, (b) it would add
   JS/CSS beyond the single A3 audit finding, and (c) "keeps" implies preservation, not a new feature.
   If the controller intended the alert count to actively show `--ember` ink when count > 0, that is a
   small, clean follow-up (a `.view-tab[data-view="needs-you"] .count` ink rule gated on a nonzero
   count) — flag it and I'll add it. No guess baked into the shipped code either way.
