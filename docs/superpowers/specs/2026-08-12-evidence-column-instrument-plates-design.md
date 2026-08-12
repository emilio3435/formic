# Evidence column instrument plates — design spec

**Date:** 2026-08-12
**Status:** Approved. Visual signed off on the Evidence mockup (“that’s the ticket”) after dropping the desk gradient and desk shadow.
**Parent product spec:** `docs/superpowers/specs/2026-08-12-evidence-column-exhibits.md` (exhibit set, omit-empty, icon law, Route hydration, CWD-COPY-1). That spec still wins on data and copy. This spec wins on chrome.
**Implementation plan:** `docs/superpowers/plans/2026-08-12-evidence-column-instrument-plates-grok46.md`
**Implementation model:** Cursor Grok 4.6 Extra Extra High Fast
**Authoritative visual:** `docs/rhs-shots/evidence-dossier/mockup.html` + `mockup-delta.css` + `marks/`
**Not the target:** specimen-sheet files (`desktop.html`, `state-*.html`, `dossier.css`).

## Goal

Conversation stays the messenger. Evidence is a stack of instrument plates on a flat desk.

Each plate is a nameplate (16px mark + 14.5px title) over an inset readout well. Copy chips stay visible. In-tree files show the path relative to cwd and copy the absolute filesystem path. The desk sits level with chat: sand/slate fill, 2px ink rail, no gradient, no desk shadow.

Lineage stays the spine under the plates. Header, dock, and chat do not change.

## What this is not

Rejected during the visual pass. Do not revive.

| Rejected | Why |
|---|---|
| Cool gradient + inset highlight on `.drawer-desk` | The only part of the instrument-panel pass that failed review. The desk looked like a second raised object next to chat. |
| Drop shadow on `.drawer-desk` | Same. Plates may lift. The desk may not. |
| Hover-reveal copy | Operators scan and copy. A 28px chip that is always there is the control. |
| `detail-grid` with a “Workspace” dt when cwd is the only path | Duplicate label. Lone cwd is the value. |
| Muted paths sitting on sand with no plate | The first exhibits ship looked worse than the old column. Values need a well. |
| Sticky “Evidence” head | Parent spec. First nameplate is the start of the column. |

## Anatomy

Product DOM (what `renderAgentDrawer` emits):

```text
.drawer-desk                         role="region" aria-label="Evidence and lineage"
└── .drawer-evidence-body
    ├── .inspector-panel             renderEvidence()
    │   ├── .exhibit                 Workspace, Git, PR, History
    │   │   ├── .exhibit-head        nameplate
    │   │   └── .exhibit-body        readout + files + notes
    │   └── .identity-block.exhibit  Route (same plate chrome)
    └── .dw-spine                    Lineage — unchanged owner
```

The static mockup omits `.drawer-evidence-body` and parks Lineage as a desk sibling. Product wraps both in `.drawer-evidence-body`. CSS must style both shapes:

- `.drawer-desk .drawer-evidence-body` — padding 12px, column gap 0.7rem (this is the gap before Lineage).
- `.drawer-desk:not(:has(.drawer-evidence-body))` — same padding and gap, for the mockup.

Do not invent a `.has` class. `:has(.drawer-evidence-body)` is legal because that class is emitted.

## Desk

The desk is a well, not a card.

**Keep (already in product layout CSS):**

- Fill: `color-mix(in srgb, var(--slate) 4%, var(--sand))`
- 1px slate/line border and `--radius-sm` from the drawer grid rules
- `box-shadow: none` on the desk (the container-query rule already sets this)

**Add (delta only):**

```css
.drawer-desk {
  border-left: 2px solid var(--ink);
}
```

**Forbidden on `.drawer-desk`:**

- `linear-gradient(...)`
- any `box-shadow` other than the existing `none`
- a second fill that fights the sand/slate mix

The 2px ink rail is the only new desk ornament. It marks Evidence as the instrument column without lifting it off the page.

## Plate

Every exhibit is `.exhibit` with two children: `.exhibit-head` then `.exhibit-body`.

```text
┌─ nameplate ──────────────────────────────────┐
│ [16px mark]  Title              [chip] [↗]   │
├──────────────────────────────────────────────┤
│  ┌─ readout ──────────────────────────────┐  │
│  │  value                          [copy] │  │
│  └────────────────────────────────────────┘  │
│  files / bind rows / notes                   │
└──────────────────────────────────────────────┘
```

**Plate shell** (`.drawer-desk .exhibit`):

- `background: var(--raise)`
- `border: 1px solid color-mix(in srgb, var(--slate) 22%, var(--line))`
- `border-radius: 8px`
- `padding: 0` (head and body own their padding)
- `overflow: hidden`
- Lift is allowed here:

```css
box-shadow:
  inset 0 1px 0 color-mix(in srgb, white 72%, transparent),
  0 10px 22px color-mix(in srgb, var(--ink) 8%, transparent);
```

**Nameplate** (`.exhibit-head`):

- `padding: 9px 12px`
- `background: color-mix(in srgb, var(--slate) 7%, var(--raise))`
- `border-bottom: 1px solid var(--line)`
- Mark 16px inline, no tile, no rail
- Title: `.section-title`, 14.5px UI face, sentence case, no hairline (`.rule { display: none }`)
- Route only: chip then stroke ↗, ↗ `margin-left: auto`

**Body** (`.exhibit-body`):

- `padding: 10px 12px 12px`
- `gap: 0.55rem`
- Owns every value, file list, directory note, and Route bind row. Heads do not contain values.

**Readout well** (`.exhibit-readout`):

- Inset sand well behind the primary value
- `background: color-mix(in srgb, var(--slate) 8%, var(--sand))`
- `box-shadow: inset 0 1px 2px color-mix(in srgb, var(--ink) 12%, transparent)`
- `border-radius: 6px`
- `padding: 0.55rem 0.5rem 0.55rem 0.7rem`

Where it goes:

| Exhibit | Readout |
|---|---|
| Workspace, cwd only | `<p class="evidence-value exhibit-readout">` with `<code>` + copy |
| Workspace, extra dirs | `<dl class="detail-grid exhibit-readout">` — dt labels locked by CWD-COPY-1 |
| Git | `<span class="git-line exhibit-readout">` |
| History | `<p class="evidence-value exhibit-readout">` with the provenance sentence |
| Pull request | no readout well; file cards in `.artifact-list` |
| Route | no readout well; `.route-bind` cards |

Lone cwd must not grow a `detail-grid` or a “Workspace” dt. The path is the value.

## Copy law

Copy chips are always visible. Never `opacity: 0`, never `visibility: hidden`, never hover-only. Size 28×28, stroke `icon("copy")`, class `artifact-copy`.

| Control | Visible text | Clipboard | `aria-label` | `title` |
|---|---|---|---|---|
| Workspace cwd | absolute cwd | absolute cwd | `Copy Workspace path` | `Copy full path` |
| Repository / Launch folder / Terminal shell folder | the path shown | that path | `Copy {label} path` | `Copy {label} path` |
| In-tree file | path relative to cwd | absolute filesystem path | `Copy full path` | `Copy full path` |
| Pull request | URL tail | full URL | `Copy URL` | `Copy URL` |

In-tree display still forbids reprinting the absolute cwd prefix (parent spec). The copy button’s `dataset.fullPath` is the absolute path. Helper:

```text
absoluteArtifactPath(cwd, path, shown)
  http(s) URL → return as-is
  path starts with "/" → return path
  else join cwd + "/" + shown
```

Workspace cwd copy keeps the CWD-COPY-1 aria-label. Do not rename it to “Copy full path”.

After a successful copy, the chip takes `.is-copied` for 900ms (moss border and icon). Product JS must contain the string `is-copied` — CSS alone fails the class-emission test. Wire it on the button, not inside `copyText` (that helper has no element):

```js
function markCopied(btn) {
  btn.classList.add("is-copied");
  setTimeout(() => btn.classList.remove("is-copied"), 900);
}
```

Call `markCopied(event.currentTarget)` after `copyText(...)` on exhibit copy buttons. Do not change toast copy.

## Git hash

Branch is the value. Head is secondary.

```html
<span class="git-line exhibit-readout">
  <code>docs/formic-evidence-ux-adversarial</code>
  <code class="git-rev">@a0368d5</code>
</span>
```

`.git-rev` is `var(--faint-strong)` at 11.5px. Do not paint the hash at the same ink weight as the branch. Dirty remains the 7px amber pip on `.exhibit-mark.git-dirty`. No “● uncommitted” text.

## Directory note

CWD-COPY-1 sentence stays verbatim. Chrome is a slate rail, not a warning:

```css
.directory-relation-note {
  border-left: 2px solid color-mix(in srgb, var(--slate) 45%, var(--line));
  color: var(--muted);
  font-size: 11.5px;
}
```

Never ember. Never “mismatch”. Never “≠”.

## Empty desk

One `.inspector-note`, role status: “No evidence fields reported for this session.”

```css
.drawer-desk .inspector-note {
  padding: 1rem 0.85rem;
  border: 1px dashed var(--line-strong);
  background: transparent;
}
```

Dashed well, not a plate. Do not wrap the empty sentence in `.exhibit`.

## File and PR cards

`.artifact-list li` is a labeled card inside the plate: label, path, copy. Inside a plate they sit on `var(--sand)` with `box-shadow: none` so they do not stack a second drop shadow on the plate. Hover/focus-within inks the border. No motion when `prefers-reduced-motion: reduce`.

Route `.route-bind` uses the same sand card, not a readout well.

## Typography

`tests/formic-typography-weights.test.ts` is law.

| Face | Allowed weights in product CSS |
|---|---|
| UI (`var(--font-ui)`) | 400, 500, 600 |
| Mono (`var(--font-mono)`) | 400, 500 |
| Display | 700, 800 only on `var(--font-display)` |

The HTML mock may still show `font: 700` in `mockup-delta.css`. The product port **must** remap:

- UI `700` → `600` (exhibit titles, artifact labels)
- Mono `700` → `500` (route chips, bind kickers)

Do not add `font-weight: 700` to `src/web/styles.css` for these rules. Align `mockup-delta.css` to the same 600/500 values so the mock and the product do not drift.

## Icon law (unchanged)

Nouns: 16px filled `<img>` in `.exhibit-mark`. Verbs: stroke `icon()` on copy and Route ↗. Never mix in one control. No `data-ico` in section heads.

## CSS fence

- Append / replace the Evidence delta at the end of `src/web/styles.css`.
- Scope new rules to `.drawer-desk` / `.exhibit-*` so roster `.section-title` is untouched.
- No new `:root` tokens.
- No 28px mark tiles. Copy chips are 28px; marks stay 16px.
- Every new class must appear as a string in client JS (`exhibit-body`, `exhibit-readout`, `git-rev`, `artifact-copy`, `is-copied`, …) or the “every class in styles.css is emitted” test fails.
- `[hidden] { display: none !important }` — do not set `display` on nodes that use `hidden`.

## Settled visual calls

Do not re-open these.

1. **Desk is flat.** Ink rail yes. Gradient no. Desk shadow no.
2. **Plates lift.** Nameplate + inset readout + plate shadow yes.
3. **Copy is a chip, always on.** Not a hover reveal.
4. **Path-as-value** when cwd is the only Workspace row.
5. **Display relative, copy absolute** for in-tree files.
6. **Git hash is quiet.** `.git-rev`, not a second ink value.

## Out of scope

- Header facts, Conversation bubbles, command dock, Lineage spine visuals.
- Backend, SSE fingerprint, Verify / `agent.tests`.
- Specimen-sheet restyle.
- Push, PR, merge, deploy.
- Restarting production `:4701`.

## Acceptance

A test **fails** when the condition holds.

1. Any `.drawer-desk { ... }` rule contains `linear-gradient`.
2. Any `.drawer-desk { ... }` rule sets a `box-shadow` other than `none`.
3. `.drawer-desk .exhibit` has no plate `box-shadow`.
4. Lone cwd Workspace still emits a `detail-grid` or a `dt`.
5. An in-tree file under cwd reprints the absolute prefix in visible text, or its copy button’s `dataset.fullPath` is not the absolute path.
6. File copy `aria-label` is not `Copy full path`. Workspace cwd `aria-label` is not `Copy Workspace path`.
7. Git head `<code>` lacks class `git-rev`.
8. An exhibit value is a direct child of `.exhibit` instead of `.exhibit-body`.
9. Cwd / git / history values lack `.exhibit-readout`.
10. `.artifact-copy` default rule uses `opacity: 0` or `visibility: hidden`.
11. Product exhibit title or artifact-label rules request UI weight 700, or route-chip / kicker rules request mono 700.
12. New classes `exhibit-body`, `exhibit-readout`, or `git-rev` exist in CSS and are absent from client JS.
