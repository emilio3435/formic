# Task A4 Report — Masthead + program section headers alignment

**Lane:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-body-language`
**Branch:** `ant-hill/luna-body-language-20260722`
**Commit:** `24a9538` — `feat(web): masthead + program headers share the frame + quiet header language` (on top of `b4f9d80`, A3)
**Status:** DONE

---

## Implementation summary

Task A4 is language conformance of the masthead and the program section headers to the
"techno orchestra" design language, guided by `DESIGN-LANGUAGE.md` and the single
A4-tagged audit finding. The real work is two additive `font-family: var(--font-mono)`
declarations in the `programs` CSS section; the frame requirement was already satisfied
and is locked in by regression tests.

**Changes (2 lines, `src/web/styles.css`, programs section):**

1. `.program-rollup` — added `font-family: var(--font-mono)`. This is the program
   header's only data-bearing element (it renders the derived counts, e.g.
   `2 alerts · 3 working · 1 idle`, via `rollupParts()`). Per the interface contract
   ("counts, timestamps, token values — whatever the header currently renders as data —
   in var(--font-mono)"), it now renders in mono, matching the A3 `.view-tab .count`
   badges. Kept its existing `font-variant-numeric: tabular-nums` (same pairing the
   `.view-tab .count` rule uses); font-family placed after font-size to match that
   rule's declaration order.

2. `.program-alias-tag` — added `font-family: var(--font-mono)` (**the A4 audit
   finding**). It is a 9px uppercase tracked micro-label visually identical in role to
   `.eyebrow` / `.agent-column-label` / `.vital-label` — the ratified mono micro-label
   idiom — but was the one outlier missing mono. font-family placed first to match the
   `.eyebrow` declaration order.

**Deliberately NOT changed:**

- **Masthead CSS** — the audit records "Masthead itself verified clean … frame-aligned.
  No findings," and `DESIGN-LANGUAGE.md` marks masthead R1–R6 all `pass`. `.masthead-inner`
  already caps content at `max-width: var(--frame)`. No change; test (a) regression-locks it.
- **`renderProgram` header markup (`app.js`)** — the header already applies the
  `.program-rollup` and `.program-alias-tag` classes, so the mono treatment is entirely
  CSS on existing classes. No JS change was required. The brief listed `app.js` as the
  *allowed* scope, not a mandate; touching it would have been unnecessary (rules #2/#3).
- **Frame alignment** — `.programs`/`#programs` aligns via its framed container `.app-body`
  (`max-width: var(--frame); margin: 0 auto`). Adding a redundant `max-width: var(--frame)`
  to `#programs` (which lives inside the narrower `.pane-list`/`.ops-stage` shell) would be
  incorrect double-framing, so the container rule is the correct target. Test (b) locks it.
- No new rollup data (Task C2), no agent-row edits, no A5/A6 findings.

---

## TDD evidence (RED → GREEN)

### Baseline (before)

```
$ bun run check
 241 pass
 0 fail
Ran 241 tests across 20 files.
```

### RED — after adding the four A4 tests, before implementation

Command: `bun test tests/web-client.test.ts`

```
✗ masthead + program headers share the frame + quiet header language (A4) > program-header rollup counts render in mono (Rule 2: mono for values)
    expect(rollupRule).toContain("font-family: var(--font-mono)")   ← FAILS

✗ masthead + program headers share the frame + quiet header language (A4) > program-alias-tag joins the mono micro-label idiom (Rule 2, A4 finding)
    expect(tagRule).toContain("font-family: var(--font-mono)")      ← FAILS
    Received: ".program-alias-tag { font-size: 9px; font-weight: 700; ... }"  (no font-family)

 95 pass
 2 fail
Ran 97 tests across 1 file.
```

Both RED failures are for the right reason: `.program-rollup` and `.program-alias-tag`
lacked `font-family: var(--font-mono)`. The two frame tests (a) masthead and (b) programs
container **passed as regression guards** — the masthead (`.masthead-inner`) and the
programs container (`.app-body`) already reference `--frame`; the audit + design-language
checklist both confirm these were already conformant, so they lock existing behavior rather
than driving a change. This is the one deviation from "all four fail": 2 of the 4 tests are
conformance locks by design (the brief's own test (b) is phrased "`.programs` **or its
container rule**", acknowledging the container is the legitimate `--frame` owner).

### GREEN — after implementation

```
$ bun run check
$ bunx tsc --noEmit          (clean)
 245 pass
 0 fail
 932 expect() calls
Ran 245 tests across 20 files.
```

241 pre-existing + 4 new = 245, zero fail, zero skipped, typecheck clean.

---

## Files changed

| File | Change |
|---|---|
| `src/web/styles.css` | +2 lines (`font-family: var(--font-mono)` on `.program-alias-tag` and `.program-rollup`, programs section) |
| `tests/web-client.test.ts` | +42 lines — one `describe("… (A4)")` block with 4 tests at the bottom, following the A3 extract-the-rule-body regex idiom |

`git diff --stat`: `styles.css | 4 ++--`, `web-client.test.ts | 42 ++++`, 2 files, +44/-2.

The four tests:
- (a) `masthead aligns its content to the shared --frame (Rule 3)` — `.masthead-inner` has `max-width: var(--frame)` + `margin: 0 auto`.
- (b) `the programs band aligns to --frame through its .app-body container (Rule 3)` — `.app-body` frame rule + `#programs` lives inside it (index.html check).
- (c) `program-header rollup counts render in mono (Rule 2)` — `.program-rollup` has `font-family: var(--font-mono)`.
- (d) `program-alias-tag joins the mono micro-label idiom (Rule 2, A4 finding)` — replacement: alias tag has `font-family: var(--font-mono)`; absence: the old rule `.program-alias-tag { font-size: 9px` (no font-family) is gone; furniture kept (uppercase, faint ink).

---

## Visual QA

Served the lane with `scripts/anthill-preview.sh` (auto-picked port 4711; production :4701
untouched). Screenshots via the gstack `browse` skill (no mcp chrome tools). Browse sandboxes
writes to the repo toplevel / `/private/tmp`, so captured to `/private/tmp` then copied into
the qa-baseline dir.

- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/a4-after-1440.png` (1440×900)
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/a4-after-375.png` (375×812)

Verified:
- **Shared left content edge at 1440** — masthead ("The Ant Hill" / "LIVE MULTI-AGENT
  CONTROL ROOM"), the SUMMARY strip, the toolbar search box, and the program-header carets
  all sit on one ~48px left content edge (masthead/summary at frame+1.1rem; toolbar/programs
  at frame + ops-stage border + 0.85rem — coincident within ~3px, the intended design).
- **No horizontal scroll** at either width: `scrollWidth === clientWidth` (1440/1440 and
  375/375, `overflow: false`) confirmed via JS.
- **Mono rollup** — computed `font-family` of `.program-rollup` = `"SF Mono", ui-monospace,
  …` (the `--font-mono` stack); "2 working" / "1 working" render in mono in the screenshot.
- **No console errors** on load.
- Mobile 375: masthead + summary stack, view tabs wrap, no overflow, counts in mono.

Note: `.program-alias-tag` did not render in the live snapshot (no program had a renamed
label in the current data, so `state.aliases.has(...)` was false). Its CSS is verified by
test (d) and computed-style inspection is N/A when unrendered — not a blocker.

Preview server killed after QA (port 4711 confirmed free).

---

## Self-review

- **Completeness vs brief:** all 6 steps done — 4 failing/guard tests, RED confirmed, two
  surgical implementations, GREEN (245/245), visual QA at both viewports with screenshots,
  commit with finding + rules in the body.
- **Zero scope creep:** no A5 (`.usage-table` mono) or A6 (touch-target sweep) findings
  touched; no rollup-data aggregation added (Task C2); no agent-row changes; masthead CSS
  untouched (already conformant per audit).
- **Conventions:** font-family declaration order matches each section's neighbors
  (`.eyebrow` early on the alias tag; `.view-tab .count` order on the rollup). `tabular-nums`
  preserved on the rollup, mirroring `.view-tab .count`.
- **Test output pristine:** 245 pass, 0 fail, 0 skipped; typecheck clean.

## Concerns

- **Two of the four tests are conformance guards, not RED drivers.** Tests (a) masthead and
  (b) programs-container `--frame` passed immediately because the masthead and `.app-body`
  were already frame-aligned (confirmed by the audit "No findings" and the design-language
  checklist). They lock existing behavior. This is the honest state — the frame contract for
  these two bands was already met before A4; only the two mono treatments were genuine
  changes. Surfaced here rather than contriving artificial failures. If strict all-four-RED
  is required, that would mean introducing a real frame regression to "fix," which would be
  wrong.
- Minor, non-blocking: the browse binary's write sandbox required a `/private/tmp` → copy
  hop to land screenshots in the (out-of-repo) qa-baseline dir; same approach the A3
  screenshots used.

---

## Fix — DESIGN-LANGUAGE.md doc sync (post-review)

**Review finding (Important):** the A4 `font-family: var(--font-mono)` addition to
`.program-alias-tag` (styles.css:857) made the §2 "Mono-for-values" deviation sentence in
DESIGN-LANGUAGE.md factually wrong — it still described the tag as never setting
`font-family` and rendering in `--font-ui`. Fixed in **both** copies so they stay in sync;
neighboring `.vital-big` / `.reading-value` sentences untouched.

**Before (lines ~130–132):**

> `.program-alias-tag` deviates from the idiom: it has the same uppercase, tracked,
> faint-ink look but never sets `font-family`, so it renders in `--font-ui`, not
> mono.

**After:**

> `.program-alias-tag` historically deviated from the idiom — same uppercase,
> tracked, faint-ink look but no `font-family`, so it rendered in `--font-ui`, not
> mono — but as of Task A4 it sets `font-family: var(--font-mono)` and now conforms
> to the mono micro-label idiom.

**Both copies edited (identical `diff` → no output):**
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-body-language/DESIGN-LANGUAGE.md` (lane, committed)
- `/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md` (canonical, untracked — no git run there)

**Lane check (unchanged — no test pins the doc text):**

```
 245 pass
 0 fail
 932 expect() calls
Ran 245 tests across 20 files.
```

**Fix commit (lane only):** `e4b83a4` — `docs: program-alias-tag now conforms to the mono
micro-label idiom (A4)`. Not pushed.
