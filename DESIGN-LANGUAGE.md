# Formic design language

This is the implementation reference for the current Formic operator console.
It describes the shipped foundation in `src/web/formic-tokens.css`, its legacy
bridge in `src/web/styles.css`, and the stable anchors in `src/web/index.html`.
It is a guide to the product that exists; concepts still in mockups or plans are
not product commitments until they land in those files and their tests.

The public identity is Formic. Older code and historical records may still say
`The Ant Hill`; those internal names are compatibility surfaces, not a second
visual brand.

## The three color roles

Color is a business signal, not decoration. Every use belongs to one of three
roles, and status is always carried by a label or shape as well as color.

| Role | Meaning | Current aliases | Use | Do not use for |
|---|---|---|---|---|
| Brand | Formic identity | `--color-brand-primary` (clay), `--color-brand-secondary` (indigo) | mark, wordmark accent, and identity lockups | live state or error severity |
| Interaction | an operator can act or is focused | `--color-interactive`, `--color-focus-ring`, `--color-text-link` | focus, links, hover, selected controls, keyboard position | success, warning, danger, or information state |
| Status | what the system measured | `--color-status-success`, `--color-status-warning`, `--color-status-danger`, `--color-status-info` | live/healthy, waiting/needs-you, blocked/failed, and informational state | logo or generic decoration |

Clay is the warm Formic signature. Indigo is the cool interaction channel and
the secondary brand hue in the mark system; the semantic alias says whether a
use is identity (`brand-secondary`) or action (`interactive`). Neither hue is a
status substitute. A new component should be explainable by one row of this
table before it receives a color.

## Two tiers of tokens

`src/web/formic-tokens.css` is the canonical token file. It has two explicit
tiers:

1. **Primitives** are raw palette values and short scales: gray, clay, indigo,
   green, amber, red, blue, font families, radii, shadows, and spacing. They
   are the palette from which the system is built.
2. **Semantic aliases** name the job a value performs: surface, text, border,
   brand, interaction, status, tag, and control. Components reference these
   aliases, never a primitive hex value. A future theme can then change a role
   without searching every component.

The important primitive anchors are:

| Scale | Base values |
|---|---|
| Neutral | `--gray-0: #fff`, `--gray-25: #fbfbfc`, `--gray-50: #f6f7f8`, `--gray-100: #eef0f2`, `--gray-200: #e2e5e9`, `--gray-400: #9aa1ab`, `--gray-500: #6b7280`, `--gray-600: #4b515c`, `--gray-900: #16181b` |
| Brand clay | `--clay-500: #c1632b`, `--clay-600: #a8531f`, `--clay-700: #833f18` |
| Interaction indigo | `--indigo-500: #5b4fd1`, `--indigo-600: #4a3fb8`, `--indigo-700: #3b3294` |
| Status green | `--green-500: #1e9e5c`, `--green-600: #16824a`, `--green-700: #146744` |
| Status amber | `--amber-500: #d9a22e`, `--amber-600: #b6851f`, `--amber-700: #8a5100` |
| Status red | `--red-500: #d1453d`, `--red-600: #b23731` |
| Status blue | `--blue-500: #3172c4`, `--blue-600: #285d9f` |

### Semantic surface, text, and interaction aliases

| Family | Aliases and meaning |
|---|---|
| Surface | `--color-surface-canvas` and `--color-surface-card` are white; `--color-surface-subtle` is gray-50 for hover/code/nested content; `--color-surface-sunken` is gray-25 for recessed panels |
| Border | `--color-border-default` is the standard hairline; `--color-border-subtle` is the quieter divider |
| Text | `--color-text-primary` is gray-900; `--color-text-secondary` is gray-600; `--color-text-tertiary` is gray-400 for non-body microcopy; `--color-text-on-brand` is white; `--color-text-link` is indigo-600 |
| Brand | `--color-brand-primary`/`-hover`/`-tint` are clay 500/600/50; `--color-brand-secondary`/`-hover`/`-tint` are indigo 500/600/50 |
| Interaction | `--color-interactive` is indigo-500; `--color-focus-ring` is `0 0 0 3px rgba(91,79,209,.28)` |
| Controls | `--color-brand-control` and `--color-brand-control-hover` are clay-600/700 for normal-sized filled controls |

`src/web/styles.css` keeps a compatibility bridge while consumers migrate:
`--canvas`, `--surface`, `--raise`, `--sand`, `--ink`, `--body`, `--muted`,
`--faint`, `--line`, `--line-strong`, `--ember`, `--amber`, `--moss`, and
`--slate` resolve to semantic aliases. The old `--clay` name resolves to brand
clay only. Ended state has a separate `--ended-ink` (`--gray-500`) and
`--ended`; it must never inherit brand clay. This is the migration bridge, not
permission to introduce another raw-color vocabulary.

### Status aliases and business meaning

The base 500 colors are useful for dots, rails, and other non-text marks. The
darker `*-text` aliases are the normal-text/control counterparts where the
canonical file provides them.

| State meaning | Visual role | Mark/tint aliases | Text/control alias | Business rule |
|---|---|---|---|---|
| Working, informational, in flight | info | `--color-status-info`, `--color-status-info-tint` | `--color-status-info-text` | Working is blue; green is settled, not in-flight |
| Needs you | warning | `--color-status-warning`, `--color-status-warning-tint` | `--color-status-warning-text` | Needs-you is amber (act). Waiting and stalled are not amber |
| Waiting, stalled | graphite | `--ended-ink` / `--gray-500` | secondary text | Same hue; stalled is dimmer + age. Not a second red, not amber |
| Done, settled, healthy, all clear | success | `--color-status-success`, `--color-status-success-tint` | `--color-status-success-text` | Green is settled. A done lane that still needs a read is needs-you |
| Blocked, failed, break, person-blocker | danger | `--color-status-danger`, `--color-status-danger-tint` | `--color-status-danger-text` | red means an operational intervention is required |
| Informational, neutral signal | info | `--color-status-info`, `--color-status-info-tint` | `--color-status-info-text` | informational blue never implies failure |
| Ended | neutral | `--ended-ink` | neutral/secondary text | ended is a lifecycle fact, not a brand treatment |
| Unverified | unresolved information | info-derived ink and dashed treatment | secondary text | unverified is not ended; the board did not establish liveness |

## Surfaces, edges, and hierarchy

The canvas and cards are white. A card separates from its surroundings with a
1px hairline and a shadow, not with a gray slab. Gray-50 is reserved for a
subordinate hover row, inline code block, or nested panel; gray-25 is the
sunken/nested surface. The scale is intentionally short:

- radii: `--radius-sm` 6px, `--radius-md` 10px, `--radius-lg` 14px,
  `--radius-pill` 999px;
- shadows: `--shadow-sm`, `--shadow-md`, and `--shadow-lg`;
- spacing: `--space-1` through `--space-6` at 4, 8, 12, 16, 24, and 32px.

The console spends visual weight in this order:

1. masthead identity and the connection/LIVE signal;
2. the white health rail and its TL;DR reading;
3. the repository → worktree → run board hierarchy;
4. the selected row's inspector and command dock;
5. secondary evidence, folded until requested.

The board remains dense by using alignment, hairlines, mono values, and compact
status marks. Calm states collapse; urgency earns ink, a rail, or a larger value.
The Finished shelf is quiet because ended work is history, not a live alert.

## Component rules that are shipped

### Masthead and health rail

The masthead uses the same-origin `icons/formic-mark.svg` and the
`Form<span class="wm-accent">i</span>c` lockup. Syne 800 carries the wordmark; only the
`i` receives brand clay. `LIVE` is a labeled green success pill/dot, never clay.
The stable controls and state hooks are `#notify-toggle`, `#settings-toggle`,
`#conn-badge`, `#conn-label`, and `#server-health`.

The health rail is a white surface with a Formic hairline. Its hierarchy stays
flat and readable: TL;DR remains a compact reading, the attention counter is a
tabular mono value, and the scan window qualifies the readings once. Needs-you
is warning amber; a real break or failed feed is danger red. `#cleanup-status`
is static in the document and remains the polite status announcement target.

### Board, tags, and inspector

Repositories, worktrees, and runs are separate levels. A status mark answers
what the session is doing; a role tag answers who or what owns the work. Do not
merge those channels into one rainbow chip. Provider marks identify provenance
and do not override the operational status rail.

The inspector is progressive disclosure: a selected row opens the detail surface,
the command dock stays with the selected session, and secondary transcript or
evidence stays foldable. Controls remain available only when the server has
proven the terminal target; disabled controls state why.

### Notification center badge and the danger-fill invariant

The badge ink is a verdict. **Ember fill is reserved for severity `blocking`**:
the person is the blocker. A `noticed` watcher state uses an **amber outline**;
dataflow and investigation warnings remain outlined as well. An all-clear badge
is a gray outline with a rendered `0`, not an empty or missing control. The
header's Clean up action proposes a sweep and exposes evidence for review; it
**never deletes**.

This distinction is deliberately narrower than the board's needs-you warning:
needs-you says a session is waiting for an operator, while a blocking
notification says the notification center has evidence that a person is the
blocking cause. Shape, label, and color together preserve that difference.

### Buttons, links, and meters

Primary filled Formic controls use the accessible clay control aliases. Links,
selected controls, and focus use indigo interaction aliases. The current
`.btn.primary` compatibility selector remains neutral graphite until that
component migration lands; this guide does not describe that unfinished
selector as clay. Danger controls use the red status aliases and should not be
confused with brand clay. Meters put geometry in SVG attributes and use classes
for tone; no inline `style` is needed, which keeps the existing self-only CSP
intact.

## Typography

The local `@font-face` declarations in `formic-tokens.css` provide the official
OFL font binaries:

| Token | Family and weights | Use |
|---|---|---|
| `--font-display` | Syne 700/800 | wordmark and display headings |
| `--font-ui` | Inter 400/500/600 | body, controls, labels, and prose |
| `--font-mono` | JetBrains Mono 400/500 | paths, IDs, timestamps, token/cost/session values, and compact instrument labels |

Mono is a data channel, not a mood: prose and headings stay in Inter or Syne.
Values use tabular numerals when they must compare in a column.

## Motion

Motion reports activity without becoming a loading trap:

- the Formic mark's perimeter dash and node pulse use a 3.2s ambient loop;
- live connection breathing is slow and calm, while reconnecting is more urgent;
- hover/focus and panel transitions are short and state changes settle rather
  than bounce;
- counters and reading numbers do not animate merely to attract attention.

The client has a universal reduced-motion guard:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

Static contexts such as favicons and print use the still mark. The SVG mark's
own reduced-motion rule and the client stylesheet guard must remain in force.

## Accessibility and deterministic contrast

Status never relies on color alone: pair a status hue with a word, icon, border,
rail, or shape. Keep the existing semantic IDs, labels, `aria-live` regions,
keyboard focus path, and 24px minimum icon/control target. Migrated
focus-visible rules use the indigo interaction role or `--color-focus-ring`,
never a status hue; legacy exceptions remain migration work and are not claimed
as complete here. The UI is light-only (`color-scheme: light`).

The ratios below use the WCAG relative-luminance formula, compare against the
white card/canvas (`#ffffff`), and are rounded to two decimals. They are the
deterministic reason the token file exposes both base status colors and darker
text/control aliases.

| Ink | Hex | Ratio on white | Allowed use |
|---|---:|---:|---|
| gray-900 | `#16181b` | 17.79:1 | primary text |
| gray-600 | `#4b515c` | 7.98:1 | secondary text |
| gray-400 | `#9aa1ab` | 2.61:1 | tertiary/non-body microcopy only |
| clay-500 | `#c1632b` | 4.13:1 | identity mark, large text, and non-text brand marks |
| clay-600 / clay-700 | `#a8531f` / `#833f18` | 5.35:1 / 7.81:1 | normal text and filled brand controls |
| indigo-500 / indigo-600 | `#5b4fd1` / `#4a3fb8` | 6.03:1 / 7.79:1 | interaction and links; use the darker alias where a control needs it |
| green-500 / green-700 | `#1e9e5c` / `#146744` | 3.44:1 / 6.88:1 | success mark/rail; success text/control |
| amber-500 / amber-700 | `#d9a22e` / `#8a5100` | 2.29:1 / 6.45:1 | warning mark/rail; warning text/control |
| red-500 / red-600 | `#d1453d` / `#b23731` | 4.54:1 / 6.03:1 | danger mark/rail; danger text/control |
| blue-500 / blue-600 | `#3172c4` / `#285d9f` | 4.84:1 / 6.65:1 | info mark/rail; info text/control |

For normal text, use a ratio of at least 4.5:1; large text and non-text
indicators use the applicable 3:1 threshold. In particular, the canonical 500
status colors are not blanket normal-text approvals: green and amber need their
darker text aliases, and brand clay uses `--color-brand-control` or its hover
alias for normal-sized filled controls.

## Compatibility and change discipline

The public title, masthead, favicon, local token stylesheet, and local fonts are
Formic surfaces. `The Ant Hill` in server logs, scripts, module names, launchd
labels, historical docs, and stored/internal identifiers remains stable until a
separate rename decision expands the fence. The legacy bridge in `styles.css`
is likewise intentional migration scaffolding.

When extending the client:

1. choose a semantic role and alias before choosing a primitive;
2. preserve business status meanings and the stable DOM/ARIA hooks;
3. use edge, label, and shape before adding a filled surface;
4. check contrast and reduced-motion behavior at the rule level; and
5. record unfinished ideas as proposals instead of describing them as landed.
