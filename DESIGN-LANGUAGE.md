# The Ant Hill Design Language — "techno orchestra"

Single source of truth for the body-restyle program (WS-A body language, WS-B inspector
revamp, WS-C agent-tree touch-up). Token names and rule names below are canonical:
tests and commit messages cite them verbatim.

**Provenance.** Extracted 2026-07-22 from the pulse worktree
`/Users/emilionunezgarcia/Developer/anthill-pulse/src/web/styles.css` (branch
`feat/pulse-strip` — the reference implementation; its header comment and `:root`
block are finished and stable) and compared against the pre-pulse main
`/Users/emilionunezgarcia/Developer/the-mountain-main/src/web/styles.css`.
Checklist cells are best-evidence assessments pending the follow-up audit;
genuinely uncertain cells are marked `?`.

**The thesis** (from the styles.css header comment): a cool control-room surface —
graphite light ground, instrument-panel rails, and clear status marks. Interventions
(act now) and advisories (be aware) use outline indicators and left-edge signal
rails, not filled hospital banners. Status is carried by shape, label, and color
together; monospace is reserved for identifiers, paths, timestamps, and token
values. All meters use SVG attributes, never inline style, so the strict CSP holds.
Light scheme only (`<meta name="color-scheme" content="light">`); no dark variant.

---

## 1. Vocabulary — the tokens

Every custom property in the pulse `styles.css`, with its exact name and current
value. 41 tokens in `:root`, 7 component-scoped (48 total).

### Ground — cool graphite control room

| Token | Value | Role |
|---|---|---|
| `--canvas` | `#f3f5f7` | page ground |
| `--surface` | `#fbfcfd` | band / card surface |
| `--raise` | `#ffffff` | raised chrome (shells, chips, inputs) |
| `--sand` | `#e8edf2` | recessed / hover wash |
| `--line` | `#d4dce4` | hairline dividers |
| `--line-strong` | `#aeb9c4` | structural borders |

### Ink scale

| Token | Value | Role |
|---|---|---|
| `--ink` | `#121820` | primary text, graphite cap rules, primary buttons |
| `--muted` | `#445260` | secondary text |
| `--faint` | `#5a6876` | tertiary text, micro-labels |

### Indicator inks — status color, never flood fills

| Token | Value | Role |
|---|---|---|
| `--ember` | `#c23b2e` | intervention / attention |
| `--amber` | `#9a6b12` | advisory / warning |
| `--moss` | `#1f6b4a` | working / healthy / ok |
| `--slate` | `#3f5f78` | idle |
| `--clay` | `#64707c` | ended |
| `--ember-soft` | `color-mix(in srgb, var(--ember) 9%, var(--surface))` | faint ember tint (edge-railed blocks only) |
| `--amber-soft` | `color-mix(in srgb, var(--amber) 10%, var(--surface))` | faint amber tint |
| `--moss-soft` | `color-mix(in srgb, var(--moss) 10%, var(--surface))` | faint moss tint (calm-cleared wash) |
| `--signal-rail` | `2px` | canonical left-edge signal-rail width |

### Semantic aliases (state → ink)

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `--working` | `var(--moss)` | | `--needs` | `var(--ember)` |
| `--idle` | `var(--slate)` | | `--blocked` | `var(--ember)` |
| `--ended` | `var(--clay)` | | `--failed` | `#b42318` |
| `--ok` | `var(--moss)` | | `--bad` | `#b42318` |
| `--warn` | `var(--amber)` | | `--terracotta` | `var(--ember)` (legacy alias) |

**Ruling: `--failed` is ink-only.** There is deliberately no `--failed-soft`
token; failed states that need a background tint borrow `--ember-soft` instead.
`.control-banner` mixing `--failed` ink (border/icon) with an `--ember-soft`
background tint is the sanctioned pattern, not a defect. (Decision: minimal
vocabulary — recorded 2026-07-23 by the program controller.)

### Provider inks — quiet, ink-forward marks

| Token | Value | Provider |
|---|---|---|
| `--claude` | `#a64b2a` | Claude |
| `--codex` | `#2e6d58` | Codex |
| `--omp` | `#68469a` | OMP |
| `--cursor` | `#3d6585` | Cursor |

### Typography

| Token | Value |
|---|---|
| `--font-ui` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", system-ui, sans-serif` |
| `--font-display` | `var(--font-ui)` |
| `--font-mono` | `"SF Mono", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace` |

### Geometry, frame, and shadow scale

| Token | Value | Role |
|---|---|---|
| `--radius` | `8px` | card / shell radius |
| `--radius-sm` | `5px` | chip / control radius |
| `--frame` | `min(1680px, calc(100vw - 64px))` | the one shared canvas frame — every full-width band aligns to it |
| `--inspector-w` | `clamp(480px, 32vw, 520px)` | desktop inspector/drawer width (full-surface sheet below 1024px) |
| `--shadow-soft` | `0 1px 2px rgba(23, 33, 43, 0.04), 0 8px 22px rgba(23, 33, 43, 0.05)` | resting raise |
| `--shadow-lift` | `0 2px 6px rgba(23, 33, 43, 0.07), 0 18px 44px rgba(23, 33, 43, 0.12)` | floating overlays (broadcast dock) |

### Component-scoped custom properties (set by classes, never inline style)

| Token | Set by | Role |
|---|---|---|
| `--prov` | `.dw-provider--claude/--codex/--cursor/--omp` | one provider ink drives the drawer inset rail and the lineage current-node ring — the canonical CSP-safe variant pattern |
| `--role-color` | `.role-orchestrator/-frontend/-backend/-verifier/-tester/-automation` | role left-rail ink |
| `--role-surface` | same role classes | near-neutral role chip surface |
| `--role-ink` | same role classes | role chip text ink |
| `--tree-depth` | `.depth-1` … `.depth-4` | swarm-tree indent multiplier |
| `--tree-color` | `.depth-1` … `.depth-4` | swarm-tree connector/depth accent |
| `--inspector-pad-x` | `.pane-inspector` (1.2rem desktop, 1rem <1024px) | drawer gutter; the command dock bleeds by it |

---

## 2. Named patterns

**Mono-for-values.** `--font-mono` carries identifiers, paths, timestamps, and
token/cost values (`.row-fact-value`, `.swarm-chip`, `.artifact-path`,
`.transcript`, `.control-feedback`, `.gate-chip`, `.target-chip`). Observed idiom
throughout the pulse work: mono also carries uppercase micro-labels/kickers at
9–12px with letter-spacing (`.eyebrow`, `.agent-column-label`, `.dw-eyebrow`,
`.dw-block-label`, `.shelf-title`, `.vital-label`, `.chat-turn-role`,
`.detail-grid dt`, `.operate-meta-label`) — instrument labels, not prose.
`.program-alias-tag` deviates from the idiom: it has the same uppercase, tracked,
faint-ink look but never sets `font-family`, so it renders in `--font-ui`, not
mono. Large display numerals split: `.reading-value` stays `--font-ui` with
`font-variant-numeric: tabular-nums`, while `.vital-big` values are always mono —
every `renderVitals` call site in `app.js` pairs the class with `mono`
(`"vital-big mono"`). Mono never carries headings or sentence prose.

**SVG-attribute meters.** All meters are SVG whose geometry (rect width, `x`,
`stroke-dasharray` arc) is set via SVG attributes from JS — never inline `style` —
so the strict CSP (`style-src 'self'`) holds. Tone comes from classes: `.warn` /
`.hot` variants on the fill. Inventory: `.ctx-meter` (`.ctx-track`/`.ctx-fill`),
`.tm-track`/`.tm-fill` bar meter, `.dw-meter` segmented rollup
(`.dw-seg-work`/`.dw-seg-idle`/`.dw-seg-needs`/`.dw-seg-end` carry both `fill` and
`background` twins), `.vital-ring` donut (`.ring-track`/`.ring-fill`/`.ring-pct`),
`.vital-bar`, `.usage-bars-svg` (`.usage-bar-rect`).

**Urgency-weighted cell.** Pulse-strip cells re-weight inside a flex rail instead
of a rigid grid: `.reading.cell-hot` grows (`flex-grow: 2.4`), takes ember ink and
a larger value (1.7rem); `.reading.cell-micro` collapses to a trailing chip
(0.95rem). Urgency earns space and ink; calm does not.

**Calm collapse.** When nothing needs attention, the whole cell row folds to one
moss line: `.pulse-calm` (framed to `--frame`), with `.pulse-cleared` washing
`--moss-soft` in once as a one-shot transition — no keyframe loop. Related resting
behaviors: `.row-summary` clamps to one line and expands to three on
hover/selection; `.agent-row.is-ended` fades to 0.66 opacity; vitals tiles are
omit-empty (absent tiles never render).

**Progressive disclosure (thin trigger → drawer).** Inline signal bands are thin
triggers (`.signal-trigger`) that open the matching drawer; `.pulse-more` is a
thin mono trigger row; `<details>`/`summary` disclosures (`.names-disclosure`,
`.dw-impact-sample`, `.triage-briefing-raw`, `.command-dock-more`,
`.affected-disclosure`, `.signal-tech`) keep secondary evidence folded;
`.program:not(.open) .program-agents` hides collapsed rosters.

**Signal rails and edge marks.** Status attaches to the left edge: 2px
(`--signal-rail`) or 3px inset rails (`.finding.pin` ember rail, `.dw-block--fix`
inset 2px ember, `.dw-work` state-colored left border, role/provider left borders
on `.agent-row`, `.dw-accent--ember/--amber/--moss/--slate/--ink` 2px top rule per
drawer type). Tints stay ≤10% soft mixes behind a rail or border — never a flood.

---

## 3. The six rules

Cite these names exactly in tests, audits, and commit messages.

1. **Indicator inks, not flood fills** — status via outline marks, colored text,
   2px left-edge signal rails; no filled hospital banners.
2. **Mono for values only** — `--font-mono` for identifiers, paths, timestamps,
   token/cost values; never headings or prose.
3. **Shared frame** — full-width bands align to
   `--frame: min(1680px, calc(100vw - 64px))`.
4. **CSP-safe rendering** — no inline `style`; meters via SVG attributes; variant
   colors via classes.
5. **Calm collapse / progressive disclosure** — quiet one-line resting states that
   expand on demand; thin triggers open drawers; urgency earns visual weight, calm
   does not.
6. **Motion respects `prefers-reduced-motion`** — every animation disabled inside
   the existing guard block.

---

## 4. Per-section conformance checklist

One row per body section of the `styles.css` section map. Columns R1–R6 are the six
rules above, in order. `pass` = best-evidence conformant today; `FAIL` = observed
gap; `?` = genuinely uncertain, audit to decide; `n/a` = the rule has no surface in
this section (counts as pass). Assessed against the pulse worktree copy (the
post-G0 baseline); among these sixteen sections only `responsive` differs from
pre-pulse main (strip wrap rules only) — all other fifteen are byte-identical in
both files, so the assessments hold for both.

| Section | styles.css header | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|---|
| utilities | `utilities` | pass | pass | n/a | pass | n/a | pass |
| masthead | `masthead` | pass | pass | pass | pass | n/a | pass |
| app body | `app body` | pass | n/a | pass | pass | n/a | n/a |
| toolbar | `toolbar: views, filter chips, search` | pass | pass | pass | pass | pass | n/a |
| programs | `programs` | pass | pass | pass | pass | pass | pass |
| agent rows | `agent rows` | pass | pass | pass | pass | pass | pass |
| inspector: layered drawer | `inspector: layered drawer` | pass | n/a | pass | pass | pass | pass |
| per-type drawer states | `inspector: per-type drawer states` | pass | pass | pass | pass | pass | pass |
| vitals band | `vitals band: the instrument tiles` | pass | pass | pass | pass | pass | n/a |
| controls | `controls` | pass | pass | n/a | pass | pass | n/a |
| broadcast dock | `broadcast dock` | pass | n/a | n/a | pass | pass | n/a |
| empty state | `empty state` | pass | n/a | n/a | pass | n/a | n/a |
| toast | `toast` | pass | n/a | n/a | pass | pass | pass |
| responsive | `responsive` | pass | n/a | pass | pass | pass | pass |
| usage tab | `usage tab` | pass | ? | pass | pass | pass | n/a |
| motion | `motion` | n/a | n/a | n/a | n/a | n/a | pass |

### Per-row evidence notes

- **utilities** — `.ok/.warn/.bad/.hot/.absent` are colored-text status helpers
  (R1 exemplar). `.skip-link` ink fill is a focus affordance, not status. `.ico`
  sizing is class-driven (R4). Skip-link transition covered by the motion guard.
- **masthead** — connection badge is an outline pill: colored dot + colored text +
  border-mix, no fill (R1 exemplar). `.masthead-inner` aligns to `--frame` (R3).
  `.eyebrow` is a mono uppercase micro-label — the instrument-label idiom, judged
  not-prose (see open question 1). `conn-beat`/`sun-pulse` keyframes killed by the
  guard (R6).
- **app body** — neutral shell; `.app-body` max-width `var(--frame)` (R3 exemplar);
  `.ops-stage` is the one docked instrument shell. No status color, no mono, no
  motion.
- **toolbar** — active chip is a solid border + 8% ink tint, not a flood (R1).
  Counts use tabular-nums in `--font-ui` (R2 fine — mono is reserved, not
  mandatory). Lives inside the framed `.app-body` (R3 inherited). Filter bar hides
  when empty (R5).
- **programs** — collapse/expand with caret + hidden roster is real calm collapse
  (R5 exemplar). `.program-select-row` 5% moss tint behind a border, no flood (R1).
  Caret transform transition guarded (R6).
- **agent rows** — provider/role identity via left border rails; alert rows use
  6–7% background washes plus rails — judged pass, but see open question 2.
  `.policy-chip` is a small solid `--failed` chip (deliberate top-severity mark,
  not a banner). Mono on `.row-fact-value` (model/tokens), `.swarm-chip` (workflow
  id), `.agent-column-label` (micro-label idiom) (R2). `--tree-depth`/`--tree-color`
  and `.token-meter` fills are class-set (R4). One-line summary expands on
  hover/selection (R5 exemplar). Rename-button opacity transition guarded (R6).
- **inspector: layered drawer** — width `min(var(--inspector-w), 100%)`; internal
  divider only, shell owns the frame (R3). `drawer-in` animation guarded (R6).
  Opening on selection is itself progressive disclosure (R5).
- **per-type drawer states** — accent channel is a 2px top rule + eyebrow color,
  "never rainbow color-coding"; `.dw-block--fix` = ember-soft tint + inset rail,
  explicitly "without a hospital flood" (R1 exemplar; `.control-banner` and
  `.state-pill.policy-mismatch` are the borderline cases — soft tint + border, and
  a small solid pill). Mono only on labels/identifiers/log content (R2).
  `.dw-provider--*` sets `--prov` by class, meters are SVG-geometry (R4 exemplar).
  Thin triggers + `details` disclosures throughout (R5 exemplar). `dw-pulse`/
  `status-pulse`/`sheet-up` animations guarded (R6).
- **vitals band** — ring/bar tone by `.warn`/`.hot` classes; stroke-dasharray arc
  is geometry, "CSP-safe" per source comment (R4 exemplar). `.vital-label`/
  `.vital-sub`/`.ring-pct` mono micro-labels; `.vital-big` numerals are always
  mono via the paired `mono` class (R2 pass). Omit-empty tiles (R5).
- **controls** — `.btn.primary` (ink) and `.btn.confirm-yes` (bad) are filled
  *action* buttons, not status banners — judged outside R1's scope (see open
  question 3). `.btn.danger` is outline + colored text (R1). Confirm strip appears
  only on demand (R5). `.control-feedback` mono = command output (R2).
- **broadcast dock** — floating fixed dock (`--shadow-lift`), not a full-width
  band, so R3 n/a. Recipient chips: outline + border-mix + colored state text
  (R1). Appears only in select mode, `[hidden]` otherwise (R5).
- **empty state** — clay-inked SVG mound via class color (R4), muted text. Calm by
  construction.
- **toast** — neutral ink surface; status carried by border color + text tint,
  not a status-colored flood (R1). Show/hide via `.show` class (R4); transition
  guarded (R6); transient by design (R5).
- **responsive** — full-surface drawer sheet below 1024px, 44px touch-target
  sweeps at 1024px and 720px, advisories collapse to title-only on narrow (R5).
  `sheet-up` guarded (R6). Frame math self-adjusts via `calc(100vw - 64px)` (R3).
- **usage tab** — `.usage-unavailable` = 6% ember tint + dashed border, no flood
  (R1). R2 is `?`: KPI and table token/cost values render in `--font-ui`
  tabular-nums, not `--font-mono` — whether Rule 2's positive direction ("mono
  *for* token/cost values") makes this a gap is for the audit (open question 4).
  `.usage-bar-rect` fill via class on SVG rects (R4). `[hidden]` panel (R5).
- **motion** — the guard block itself:
  `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }`
  — universal, so every animation/transition in every section above is disabled
  (R6 holds file-wide).

Sections outside the sixteen checklist rows: `health rail (single operational
summary)` and `pulse strip: urgency-weighted cells + inline expansion` (the
reference implementation, pulse worktree; pre-pulse main has `attention board:
conductor + two inbox lanes` instead), plus the `widescreen: reading-focused 40/60
split` and `horizontal bookshelf: Operate | Chat | Evidence rail/column` split
experiments (inspector workstream territory).

---

## 5. Open questions for the audit

1. **Mono micro-labels.** Rule 2's letter says values-only, but the pulse
   reference uses `--font-mono` pervasively for 9–12px uppercase tracked
   micro-labels (eyebrows, kickers, column labels, chip labels). Recommend
   ratifying the idiom as label furniture; otherwise dozens of cells above flip to
   FAIL, including in the finished pulse sections.
2. **Soft-wash threshold.** Alert rows and blocks use 5–10% `color-mix` tints
   behind rails/borders (`.agent-row.is-needs-you`, `.dw-block--fix`,
   `.control-banner`, `.usage-unavailable`). Recommend codifying: tint ≤10% mixed
   into `--surface`/transparent, always paired with an edge mark, never
   standalone — that is the line between indicator ink and flood fill.
3. **Filled action buttons.** `.btn.primary`, `.btn.confirm-yes`, `.triage-mode`,
   `.policy-chip` are solid fills. Judged action/identity affordances outside Rule
   1 (which governs *status* surfaces); audit should confirm.
4. **Usage-tab numerals.** Should token/cost values in `.usage-table` /
   `.usage-kpis` move to `--font-mono` for Rule 2 consistency with
   `.row-fact-value`, or is ui-tabular-nums the display-numeral idiom (as in
   `.reading-value`)?
5. **Non-token hexes.** Hard-coded values that bypass the vocabulary:
   `#34302a` (`.btn.primary:hover`, `.triage-generate:hover` — a warm dark that
   predates the cool graphite `--ink`), `#b42318` repeated literally as
   `--failed`/`--bad`, `#fff` on filled chips/buttons, `#f4c9bd` (`.toast.err`
   text), role-cue hexes (`.role-*`) and tree-depth hexes (`.depth-1..4`).
   Candidates for tokenization during the body restyle — flagged, not blocking.
