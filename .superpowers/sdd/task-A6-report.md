# Task A6 Report — Motion + responsive conformance sweep (final WS-A task)

**Status:** DONE
**Lane:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-body-language`
**Branch:** `ant-hill/luna-body-language-20260722` (base tip `d516ad7`)
**Commit:** `2905133` — `feat(web): motion + responsive conformance for the restyled body`

---

## Implementation summary

Closed exactly the two A6-tagged findings from the audit
(`/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/AUDIT.md`,
section "A6 — motion / responsive"). Both findings verified against source before
touching anything — the audit's quantified gaps matched the live CSS exactly (no
NEEDS_CONTEXT).

### Finding 1 — incomplete 44px touch-target sweep (Important)

The binding constraint is "44px touch targets <1024px". Three concrete gaps, all
confirmed in source:

| Selector | Source min-height | Was swept | Fix |
|---|---|---|---|
| `.filter-chip` (toolbar) | 30px (styles.css:781) | never, any breakpoint | added to <1024px sweep |
| `.program-details` (programs) | 30px (styles.css:869) | only ≤720px (styles.css:2073) | moved into <1024px sweep |
| `.command-composer input` | 40px (styles.css:1650) | never | added to <1024px sweep |
| `.instruct-form input` | 38px (styles.css:1875) | never | added to <1024px sweep |
| `.rename-form input` | 36px (styles.css:879) | never | added to <1024px sweep |

Fix location: the single `{ min-height: 44px; }` sweep rule inside
`@media (max-width: 1024px)` (styles.css:2007-2011). `.program-details` was
removed from the now-redundant `@media (max-width: 720px)` drawer-controls rule
(styles.css:2073) — the audit explicitly sanctioned dropping it ("harmless either
way"); moving it keeps the diff free of a redundant selector and makes the test's
absence/replacement check meaningful. Because media queries are cumulative,
`.program-details` at 44px from the <1024px rule still covers ≤720px.

### Finding 2 — motion guard (Rule 6), locked as an honest regression guard

The audit reconfirmed the guard is universal and file-wide:
`@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }`.
A `git diff b4f9d80..d516ad7 -- src/web/styles.css` filtered on `@keyframes`/`animation:`
returned **zero** hits — WS-A (A3/A4/A5) added and removed no animation. So this
finding required **no code change**; it is locked by a regression test asserting
the universal guard still disables the full existing animation set (6 keyframes:
`conn-beat`, `drawer-in`, `dw-pulse`, `sheet-up`, `status-pulse`, `sun-pulse`).
Honest guard, no fabricated RED — the A4 precedent.

The motion section of `styles.css` is therefore byte-identical to base. Only the
responsive section changed.

---

## TDD evidence

**Step 1-2 (RED).** Added a `describe("... (A6)")` block with 4 tests, ran
`bun test -t "A6"`:
- `the <1024px touch sweep now covers the filter chip` → FAIL (sweep lacked `.filter-chip`) — genuine RED.
- `program-details gets its 44px treatment at <1024px, not just <720px` → FAIL (sweep lacked `.program-details`) — genuine RED.
- `the three text inputs clear 44px below 1024px` → FAIL (sweep lacked the inputs) — genuine RED.
- `reduced-motion universally disables the full WS-A animation set` → **PASS at base** — honest regression guard, disclosed (not a fake RED).

Result: `1 pass, 3 fail` — the three touch-target tests failed for exactly the
right reason (each asserted-selector absent from the extracted <1024px sweep rule).

**Step 3-4 (GREEN).** Implemented both findings. `bun run check` (typecheck + full
suite): **251 pass, 0 fail** (247 pre-existing + 4 new). No skips, no filtered-out
tests.

**Test design note.** The tests use the extract-and-assert idiom already in the
file (the `@media (max-width: 1024px)` → `@media (max-width: 720px)` slice from the
existing "operations canvas layout" test). A helper `touchSweep1024()` extracts the
single `{ min-height: 44px; }` rule from the <1024px block so assertions target the
sweep rule specifically, not incidental substring matches. The motion test
enumerates the full keyframe set and asserts every live `animation:` usage maps
onto it, so a future task that adds a keyframe must consciously re-confirm the
guard — a real intent lock, not a hollow snapshot.

---

## Visual QA (gstack browse skill, live preview :4711)

Preview via `scripts/anthill-preview.sh` (throwaway port 4711, prod :4701
untouched), killed after QA. Screenshots (browse sandbox restricts writes to
`/private/tmp` + repo root, so captured to `/private/tmp` then copied):

- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/a6-after-1440.png`
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/a6-after-1024.png`
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/a6-after-375.png`

**No horizontal scroll anywhere** (`scrollWidth === clientWidth`):
- 1440×900 → 1440 / 1440, overflow false
- 1024×900 → 1024 / 1024, overflow false
- 375×812 → 375 / 375, overflow false

**Drawer is full-surface below 1024** — computed style of `.pane-inspector` at
1024px: `position: fixed`, `inset: 0px 0px 0px 0px`, `border-left-width: 0px`.

**Touch targets comfortable below 1024** — live computed `min-height` probe
(injected elements with the swept classes, since the drawer/filter surfaces need
live interaction to render inline):

| Selector | @375px | @800px | @1440px |
|---|---|---|---|
| `.filter-chip` | 44px | 44px | 30px |
| `.program-details` | 44px | 44px | 30px |
| `.command-composer input` | 44px | 44px | 40px |
| `.instruct-form input` | 44px | 44px | 38px |
| `.rename-form input` | 44px | 44px | 36px |

The @800px column proves the exact 721-1024px tablet gap the audit flagged is
closed; the @1440px column shows the sweep correctly disengages above 1024px,
returning each control to its audited base height. Screenshots show the masthead
stacking cleanly at 375, toolbar tabs wrapping to two rows, and the tall
`#search` input (the already-swept sibling that made the input gap look like an
oversight) — the newly-swept siblings now match it.

Console note: the preview emitted repeated `ERR_CONNECTION_REFUSED` /
`triage queue fetch failed` — the app polling a live cmux control backend that is
not running in a throwaway preview. Not layout-related and not introduced by this
change; the main snapshot feed rendered real data (827 tracked, one program with
an alert row).

---

## Files changed

- `src/web/styles.css` — responsive section only, +5/-3 lines (the <1024px sweep
  rule grew by 5 selectors; `.program-details` moved out of the <720px rule; one
  comment updated to note the graduation). Motion section untouched.
- `tests/web-client.test.ts` — +61 lines, one new `describe("... (A6)")` block, 4
  tests. No existing test modified.

---

## Self-review

- Exactly two A6 findings closed: touch-target sweep (5 selectors) + motion guard
  (honest regression lock). ✓
- Deferred ~3px masthead/content left-edge offset: **untouched**. ✓
- Sections changed: only the responsive section of `styles.css`. The motion
  section is byte-identical (it was already conformant — disclosed, not silently
  skipped). ✓
- Test output pristine: 251 pass, 0 fail, 0 skipped. ✓
- No inline `style`, no feature flags, no new tokens, no non-token hexes
  introduced. ✓
- Diff reviewed, secret-free. Committed on the lane branch (never main, never
  pushed). ✓

---

## Untagged observations (unfixed, per scope)

1. **`#search` in the <720px sweep is redundant.** The `@media (max-width: 720px)`
   block still lists `.view-tab, .btn, #search, .inspector-tab, .swarm-anchor
   { min-height: 44px; }` (styles.css:2071), all of which are already 44px from the
   <1024px sweep above. Harmless (cumulative queries), pre-existing, out of A6
   scope — noting for a future responsive-section tidy, not fixing.
2. **Preview backend polling errors.** The throwaway preview has no cmux control
   backend, so `fetchTriageQueue` and the snapshot SSE spam `ERR_CONNECTION_REFUSED`
   in the console. Expected for a standalone preview; flag only so a future QA run
   doesn't mistake it for a regression.
