# Task A5 Report — Peripheral surfaces (empty state · toast · broadcast dock · usage tab)

**Lane:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-body-language`
**Branch:** `ant-hill/luna-body-language-20260722`
**Base tip:** `e4b83a4` (A3 toolbar + A4 headers) → **new commit `d516ad7`**
**Status:** DONE

---

## Implementation summary

Closed exactly the two A5-tagged audit findings from
`qa-baseline-20260722/AUDIT.md` (§"A5 — empty state / toast / broadcast dock /
usage tab", finding count A5 = 2). No other changes; the empty-state and
broadcast-dock sections were audit-verified clean and left untouched.

### Finding 1 — `.usage-table` Tokens/Cost/Session cells (Rule 2, Important)
The "Recent invocations" table rendered the Tokens, Cost, and Session-ID cells —
token/cost values and a literal identifier, the exact subjects of Rule 2 — in
plain `--font-ui`, unlike `.row-fact-value` / `.swarm-chip` / `.artifact-path`
elsewhere in the app. The finding offered "give the Tokens/Cost `<td>` a mono
class (or extend `.usage-table` with a `.mono`-equivalent modifier scoped to
those columns), and render the session-id text with the same mono treatment as
`.artifact-path` / `.swarm-chip`."

Chosen fix (the scoped-modifier option, which keeps the cells at the table's
12.5px rather than the global `.mono` utility's `0.86em` shrink):
- `src/web/styles.css` (usage tab section): added
  `.usage-table td.usage-val { font-family: var(--font-mono); }` with a Rule-2
  comment. Specificity `(0,2,1)` so the session cell's `.linkish` button — which
  sets `font: inherit` — inherits mono from its `td` regardless of source order.
- `src/web/app.js` (`renderUsagePanel`): added `class: "usage-val"` to the
  Tokens `<td>`, Cost `<td>`, and Session `<td>`. When/Provider/Model tds are
  untouched (left as prose, per the finding). This also honors the settled
  split verdict: the `.usage-kpis .reading` tiles keep ui `tabular-nums` (the
  display-numeral idiom) — I did not touch them.

### Finding 2 — Toast `#f4c9bd` hardcoded hex (§5 "non-token hexes", Minor)
`.toast.err` carried a hardcoded `#f4c9bd` text color outside the token
vocabulary (DESIGN-LANGUAGE §5 open q5). The finding's fix text is "tokenize as
part of the restyle's color-vocabulary cleanup."

Interpretation note (candid): the fix is under-specified — no target token or
value is named, and the brief's "only these sections" constraint forbids adding
a new `:root` token, so an in-scope "tokenize" can only mean expressing the color
via existing vocabulary. `#f4c9bd` (rgb 244,201,189) is not a pure tint of any
single token, so no expression reproduces it exactly; tokenizing inherently
accepts a near-imperceptible hue shift (that is the point of the "color-vocabulary
cleanup"). I replaced it with the file's dominant soft-tint idiom:
`color-mix(in srgb, var(--ember) 25%, var(--surface))` (resolves to ~rgb
237,204,201 — same lightness, slightly less orange). The `--bad` status border
is unchanged. The `25%` mix governs a *text* color, not a background wash, so the
codified ≤10% flood-fill threshold (open q2, which is about background tints
paired with an edge mark) does not apply here.

---

## TDD evidence (RED → GREEN)

**Baseline:** `bun test` → 245 pass, 0 fail.

**Step 1–2 (RED).** Added `describe("peripheral surfaces conform to the design
language (A5)")` with one intent test per finding, following the newest tests'
`styles.match(/\.selector\s*\{[^}]*\}/)?.[0]` extract-and-assert idiom, quoting
the offending pattern for absence checks. Ran the block — both failed for the
right reasons:
- usage-table test: `.usage-table td.usage-val` rule did not exist →
  `valRule === ""` → `expect(valRule).toContain("font-family: var(--font-mono)")`
  failed (received `""`).
- toast test: `expect(errRule).not.toContain("#f4c9bd")` failed (received
  `.toast.err { border-color: var(--bad); color: #f4c9bd; }`).

Both are genuine RED against a real gap (not contrived) — the source truly
lacked the mono modifier and truly contained the hex.

**Step 3–4 (GREEN).** Implemented both fixes. `bun run check` (typecheck +
`bun test`) → **247 pass, 0 fail, 0 skipped** (245 baseline + 2 new). Typecheck
clean.

The tests encode intent, not just presence: the usage-table test also asserts
the mono class is NOT applied to the Provider/Model cells
(`expect(source).not.toContain('class: "usage-val", text: row.provider')`), so it
fails if mono is over-applied to prose columns.

---

## Files changed

| File | Change |
|---|---|
| `src/web/styles.css` | +1 rule (`.usage-table td.usage-val` mono, +3-line comment); `.toast.err` color hex → token color-mix (1 line) |
| `src/web/app.js` | `renderUsagePanel` — `usage-val` class on Tokens/Cost/Session tds (3 lines) |
| `tests/web-client.test.ts` | +37 lines: 2 A5 intent tests |

Diff stat: 3 files, +45 / −4.

---

## Visual QA

Preview via `scripts/anthill-preview.sh` on `:4711` (throwaway; killed after).
Driven with the gstack `browse` skill (no mcp chrome tools). The preview was
connected to live colony data, so the Usage tab rendered a populated 40-row
invocation table.

- **Usage tab** (Finding 1) — clicked the Usage view tab (`@e10`). Live computed
  styles confirmed:
  - `.usage-table td.usage-val` → `SF Mono, ui-monospace, …` (mono).
  - Provider cell (prose) → `-apple-system, system-ui, …` (UI font).
  - Session cell `<td>` **and** its child span → `SF Mono` (inheritance works).
  - Screenshot shows Tokens (`345k`, `2.0M`, `5.5M`) and Cost (`$0.312`,
    `$2.543`) in tabular monospace next to proportional Provider/Model text.
  - `qa-baseline-20260722/a5-after-usage-tab.png` (KPI tiles + provider list),
    `a5-after-usage-table.png` (the mono invocation table),
    `a5-after-usage-full.png` (full panel).
- **Toast** (Finding 2) — an error toast requires a failing action to appear
  live, so I verified via computed style + a synthetic probe (injected
  `<div class="toast err show">`, screenshotted, removed):
  - computed `color` → `color(srgb 0.928 0.799 0.789)` (light ember mix); old
    `#f4c9bd` gone. `border-top-color` → `rgb(180,35,24)` = `--bad`.
  - `qa-baseline-20260722/a5-after-toast-err.png` — dark ink surface, light
    salmon text, red `--bad` border; reads clearly as an error.
- **Empty state / broadcast dock** — not modified by either A5 finding; the
  colony had live data so the empty state does not manifest. Left untouched;
  no after-shot needed (parallels A4's alias-tag CSS+test verification).

Console during QA showed only backend `ERR_CONNECTION_REFUSED` / triage-queue
fetch failures — expected for a throwaway preview with no live backend, unrelated
to the CSS/JS changes.

---

## Self-review

- **Exactly two findings closed:** usage-table mono (Rule 2) + toast tokenization
  (§5). Nothing else touched.
- **Zero scope creep:** did not touch the usage KPI tiles (settled: keep ui
  tabular-nums), did not touch When/Provider/Model cells, did not touch empty
  state / broadcast dock, did not add any `:root` token, did not fix the untagged
  observations below.
- **Conventions matched:** class-scoped variant (no inline style — strict CSP
  holds); mono via `--font-mono` on value/identifier cells only; color via the
  file's `color-mix(in srgb, var(--token) N%, var(--surface))` soft-tint idiom;
  test written in the extract-the-rule-body regex idiom of the A3/A4 tests.
- **Test output pristine:** 247 pass, 0 fail, 0 skip. RED was genuine, not
  contrived.
- **Binding constraints:** no feature flags; no `prefers-reduced-motion` surface
  added (no animation introduced); no new interactive class (no 44px touch-target
  obligation); frame rules untouched.

---

## Observations — untagged language outliers (reported, NOT fixed, per scope rule)

While working in these sections I noticed three micro-label idiom outliers of the
*same shape* as the A4 `.program-alias-tag` finding (uppercase, tracked, faint
9–13px labels that render in `--font-ui` instead of `--font-mono`, unlike the
ratified mono-micro-label idiom). The A5 audit did **not** tag any of these, so
per the scope rule I left them alone:

1. `.recipient-chip .rc-state` (broadcast dock, `styles.css` ~L1914) — 9.5px
   uppercase tracked micro-label, no `font-family: var(--font-mono)`.
2. `.recipient-result` (broadcast dock, ~L1916) — 9.5px uppercase tracked, no
   mono (same pattern).
3. `.usage-title` (usage tab, ~L2085) — uppercase tracked faint section label,
   no mono. Borderline: at 13px it sits just above the idiom's 9–12px band, so a
   reviewer could reasonably judge it a section heading rather than a
   micro-label.

These are candidates for whoever runs the mono-micro-label sweep (the same class
of fix as A4's alias-tag); flagging only, not requesting action here.
