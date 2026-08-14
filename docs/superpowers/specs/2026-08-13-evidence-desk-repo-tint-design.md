# Evidence desk repo tint — design spec

**Date:** 2026-08-13
**Status:** Design locked (Emilio). Re-verified against production `app.js` / `styles.css` / harnesses on 2026-08-13 after the first draft made several claims the code does not support.
**Parent chrome spec:** `docs/superpowers/specs/2026-08-12-evidence-column-instrument-plates-design.md` (flat desk, plates on `--raise`, no desk gradient, no desk shadow). That spec still wins on plate chrome. **This spec wins on the desk backdrop and left edge when a repo hex exists.**
**Parent exhibit spec:** `docs/superpowers/specs/2026-08-12-evidence-column-exhibits.md` (exhibit set, omit-empty, icon law). Unchanged.
**Repo identity already shipped:** TINT-F in `src/web/styles.css` and `paintRepoTint` / `repoTintFor` / `repoTintOfProgram` in `src/web/app.js`. This spec extends that vocabulary onto the Evidence desk. It does not invent a second colour system.
**Does not ship src until a lane lands it.** This file is the contract.

## Goal

When an operator expands a board row, the Evidence desk in the RHSP wears that row’s repository colour as a backdrop.

Today the selected row drops **both** its 4% wash and its 3px tick (`:not(.is-selected)` on every TINT-F row rule). The desk stays a slate/sand well with a 2px ink rail. Opening a session makes the repo colour vanish from the row and never appear in the drawer. The desk picks it up: same hex, same 4% / 45% marks, same CSP-safe `--repo-tint` property.

Conversation stays the messenger. Header, dock, Chat, and exhibit plates do not change.

## What this is not

Rejected in the design pass. Do not revive.

| Rejected | Why |
|---|---|
| Tint the whole `.pane-inspector` | Chat and pane chrome stay neutral. The operator asked for the Evidence desk only. |
| Tint Chat (`.drawer-doc`) | Same. The messenger does not wear place colour. |
| Mix the wash into `--sand` | Locked to `--surface`, the same paper the quiet rows use. |
| Stronger (~10%) wash | A large 10% fill fights the plates and reads as a second attention state. |
| Wash only, keep the ink edge | The 2px 45% spine is the band’s identity mark. The desk uses the same pair. |
| Drop tint on alerting / needs-you / blocked / failed | Status already lives on the row rail and the drawer head. The desk is how you still see which repo you opened. |
| Invent a default hue when no hex is assigned | `repoTintFor` returns `""` on purpose. A fallback colour would claim an identity the server has not assigned. |
| New `--evidence-tint` token or class | Same hex, same `paintRepoTint`, same `has-repo-tint`. Extra vocabulary is a second system. |
| Set `--repo-tint` on the pane and inherit | Desk-only CSS with a pane-level token is how Chat gets tinted by accident later. |
| `style="--repo-tint: …"` attribute | Board CSP has no `unsafe-inline`. `style.setProperty` is the only write that survives. |
| Text, titles, or plate chrome in repo colour | TINT-F rule 6: text never wears repo colour. Plates stay `--raise`. |
| Desk gradient or desk shadow | Instrument-plates spec. Plates may lift. The desk may not. |
| Look up the hex by `repo.repoKey` | That is the join bug TINT-F already shipped once. `repoTintFor` keys on the **printed name**. |
| Export `paintRepoTint` just so a test can call it | Not on `TheAntHill` today. Drive the desk through `renderAgentDrawer`, the same way the band is driven through `renderRepoSection`. |
| Put hex assertions in `tests/web-client.test.ts` | That fake node has **no `style`**. `paintRepoTint` does `node.style?.setProperty?.(...)`, so the hex write is silently skipped and a `--repo-tint` expect would pass over an untinted desk. |

## Locked decisions

| Decision | Value |
|---|---|
| Surface | `.drawer-desk` in the **agent** drawer only |
| Wash | `color-mix(in srgb, var(--repo-tint) 4%, var(--surface))` |
| Spine | `border-left: 2px solid color-mix(in srgb, var(--repo-tint) 45%, transparent)` |
| Attention | Tint whenever a hex exists, including alerting sessions |
| No hex | Keep today’s slate/sand fill and 2px ink edge |
| Paint | `paintRepoTint(desk, hex, "has-repo-tint")` |
| Hex source | `repoTintOfProgram(view.program)` — the same helper unbanded rows and the strip pill already use. Fallback only if `view.program` is missing: `repoTintFor(view.agent.repo && view.agent.repo.repoName)`. Never `repo.repoKey`. |
| Live Settings | `inspectorPaintSig` includes `String(repoColorsVersion)`. That is the field `fetchRepoColors` / `putRepoColor` bump; the agent record already rides `agentRecordSig`. |

## Surface

Product DOM **as `renderAgentDrawer` actually emits it** (the first draft omitted the shell head):

```text
.pane-inspector.dw-agent
├── .drawer-shell-head           verdict / session facts — never tinted
└── .drawer-grid
    ├── .drawer-mode-switch      Chat | Evidence (narrow only)
    ├── .drawer-doc              Chat — never tinted
    └── .drawer-desk             Evidence well — the only tinted node
        └── .drawer-evidence-body
            ├── .inspector-panel plates stay --raise
            └── lineage spine
```

- Narrow pane (Evidence as an in-flow tab) and wide pane (desk beside Chat) are the same `.drawer-desk` node. One rule covers both.
- Program, intervention, advisory, investigation, and resolved drawers do not get a repo desk tint. Paint only inside `renderAgentDrawer`.
- Do not add `--repo-tint` to `.pane-inspector`, `.drawer-shell-head`, `.drawer-doc`, or `.command-dock`. Their current fills stay (`--surface` / `--color-surface-card` are the same token; the dock is `--raise`).

### Paper change (intentional)

`--surface` and `--raise` both alias `--color-surface-card`. `--sand` aliases `--color-surface-subtle`.

Today’s unscoped desk is `4% slate` into `--sand`. A tinted desk becomes `4% repo` into `--surface`. That is a paper hop (subtle → card) plus the whisper of repo colour. Plates stay `--raise`, so on a tinted desk the well and the plates share a card-family paper and differ by the 4% mix. Do not “fix” this back to `--sand` — the mix target is locked.

## Marks

Unscoped `.drawer-desk` rules **do not change**. Existing tests pin them:

- `tests/web-client.test.ts` “desk CSS stays flat and plates lift” collects `/\.drawer-desk\s*\{/` blocks (this does **not** match `.drawer-desk.has-repo-tint {`), forbids desk `linear-gradient` and desk `box-shadow`, pins the `@container` slate/sand fill, and pins `border-left: 2px solid var(--ink)`.
- A later `.drawer-desk { min-height / overflow }` block inside a max-width query must also stay.

Tint is a more specific override, placed in the TINT-F block (today that block starts ~line 5886, **after** the `@container agent-drawer` restatement of the slate/sand fill at ~2698):

```css
.drawer-desk.has-repo-tint,
.drawer-grid .drawer-desk.has-repo-tint {
  background: color-mix(in srgb, var(--repo-tint) 4%, var(--surface));
  border-left: 2px solid color-mix(in srgb, var(--repo-tint) 45%, transparent);
}
```

Specificity facts, not vibes:

| Selector | Specificity | Where today |
|---|---|---|
| `.drawer-desk` (sand fill, ink edge) | 0,1,0 | ~5200 and ~5610 |
| `.drawer-grid .drawer-desk` inside `@container` (restates sand fill) | 0,2,0 | ~2689 |
| `.drawer-desk.has-repo-tint` | 0,2,0 | new, TINT-F |
| `.drawer-grid .drawer-desk.has-repo-tint` | 0,3,0 | new, TINT-F |

The 0,3,0 selector is the durable pin: a later edit that restates `.drawer-grid .drawer-desk` after TINT-F cannot steal the fill. Do not use `!important`. Do not add a shorthand `border:` to the `@container` desk rule — `web-client` asserts that block has none.

`tests/repo-tint-render.test.ts` “status outranks identity” extracts **only** selectors that mention `.agent-row`. A desk rule without `:not(.is-alerting)` is correct and will not fail that test. **Do not broaden `repoRowSelectors()`** to every `has-repo-tint` rule — that would force attention exclusions onto the desk and undo the locked decision.

Rule 6 (no `color: … --repo-tint`) will see the new block. `border-left: … color-mix(...)` does not match that file’s `color:` declaration regex. Do not write `border-left-color`.

Percentages are the approved TINT-F values (45% spine, 4% wash). Do not retune them here. No selector in this feature sets `color`.

## Paint

`paintRepoTint` is **not** exported on `TheAntHill`. `renderAgentDrawer` is.

In `renderAgentDrawer`, after the desk node is created (today: `el("div", { class: "drawer-desk" + (evidenceExpanded ? " is-open" : "") })`) and before it is appended to the grid:

1. `const hex = repoTintOfProgram(program) || repoTintFor(agent.repo && agent.repo.repoName);`
   - `repoOf` reads a **program**, not an agent. `repoTintOfProgram` already does `repoTintFor(repoOf(program).repoName)`.
   - Band name is the same word: `repoGroups` sets `group.name = repoOf(first.program).repoName`, and the band paints with `repoTintFor(group.name)`.
   - `setRepoColors` maps printed name → repoKey → hex. `repoTintFor` looks up the printed name, lowercased. Passing `repo.repoKey` is the defect the TINT-F comment at `setRepoColors` exists to prevent.
2. `paintRepoTint(desk, hex, "has-repo-tint")`.
3. Empty hex: the helper already no-ops (`if (!node || !hex) return node`). Do not add the class by hand.

Keep `is-open` on its own `classList.toggle` (already in `setDrawerMode`). Do not bake `has-repo-tint` into that string.

`inspectorPaintSig` must include `String(repoColorsVersion)`.

Why that field and not “the hex”:

- `fetchRepoColors` and `putRepoColor` call `setRepoColors` then `render()`. `setRepoColors` bumps `repoColorsVersion` and nothing else.
- `renderInspector` early-returns when `paintUnchanged("inspector", inspectorPaintSig(...))`. Today the inspector sig does **not** mention `repoColorsVersion`. The board sig does (`programsPaintSig` ~line 8030). An open drawer therefore stays on the first paint’s untinted desk after colours land.
- `agentRecordSig` already JSON-stringifies the agent (minus clock fields). `agent.repo` is already in the inspector sig. Putting the hex in a second time does not catch the Settings/fetch clock. The version counter does.

Do not add a second colour path. Do not set `--repo-tint` on the pane.

## Authority

| Conflict | Winner |
|---|---|
| Desk fill / left edge when `has-repo-tint` | This spec |
| Desk fill / left edge when no hex | Instrument-plates spec (slate/sand, 2px ink) |
| Plate chrome, copy chips, marks, omit-empty | Existing evidence specs |
| Hex identity, CSP write, “text never wears repo colour” | TINT-F as shipped |
| Status vs identity **on the row** | TINT-F (`:not(.is-selected)` and attention exclusions stay) |
| Status vs identity **on the desk** | This spec (always tint when hex exists) |

## Tests

Hex and class assertions live in `tests/repo-tint-render.test.ts`. That file exists because web-client’s node has no `style`; this file’s `makeNode` implements `style.setProperty` into `props["--repo-tint"]`.

Drive the desk with the exported renderer, inside that file’s `withDom`:

```js
const pane = document.createElement("div");
M.renderAgentDrawer(pane, { kind: "agent", agent, program });
const desk = byClass(pane, "drawer-desk")[0];
```

Do not call `renderInspector` here — the tint `withDom` only registers `#settings-panel` / `#settings-toggle`, and `querySelector` is a permanent `null`. `renderAgentDrawer` does not need `#inspector`.

| Case | Assert |
|---|---|
| Assigned printed name | `useColors({ "the-mountain": "mtn" }, { mtn: SIENNA })` + default `agent()` (`repo.repoName: "the-mountain"`). Desk has `has-repo-tint` and `props["--repo-tint"] === SIENNA`. |
| Origin-named join | `setRepoColors(originEnvelope.repoNames, originEnvelope.settings)` + agent/program whose `repo.repoName` is `"the-ant-hill"`. Desk hex is `STORM`. This is the live board’s join, not the folder name. |
| Join refuses the key | Same origin envelope + default `agent()` (`repoName: "the-mountain"`). Desk has **neither** class nor property. A test that looked up `repo.repoKey` would go green here and ship a blank desk on :4701. |
| Unassigned repo | `setRepoColors({}, { assignments: {} })`. Desk untinted. |
| Alerting session with a hex | Agent that would be needs-you / alerting on the row. Desk still tinted. Do not put `is-alerting` on the desk. |
| Chat / pane / shell head | those nodes do not have `has-repo-tint` |
| `inspectorPaintSig` | `setRepoColors` twice (version bumps even with the same tables) changes the signature; the agent record can stay identical |
| CSS | `.drawer-desk.has-repo-tint` states the 4% `--surface` mix and the 45% left spine |
| CSS | unscoped `.drawer-desk` still states the ink edge and slate/sand fill |

`tests/web-client.test.ts` keeps its unscoped desk contract. It may assert the desk **class** if someone renders a drawer there, but it must not assert `props["--repo-tint"]`.

## Out of scope

- Changing row tint, band spine, Settings swatches, or origin-key identity.
- Tinting mobile full-viewport chrome around the desk.
- A mockup pass. The marks are the shipped TINT-F percentages on a known node.
- Deploy / 4701. Land through a PR like any other lane.

## Verification log (2026-08-13)

Checked against `~/Developer/the-mountain-production` (live `main` / #60), not against memory.

| Draft claim | Reality |
|---|---|
| Selected row drops the wash | True, and it also drops the tick. Every TINT-F row selector is `:not(.is-selected)`. |
| Desk is slate/sand + 2px ink | True. Fill at `.drawer-desk` ~5208 and again inside `@container` ~2698. Ink at ~5610. |
| `paintRepoTint` is the write | True. `classList.add` + `style.setProperty`. Not exported. |
| `repoTintOfProgram` is the join | True. Same helper as unbanded rows (`~8785`) and the strip pill (`~8263`). Band uses `repoTintFor(group.name)` and `group.name` is `repoOf(program).repoName`. |
| `repoOf(agent)` | **False.** `repoOf` takes a program. |
| Look up by `repo.repoKey` | **Would silently fail** the live join. `repoTintFor` keys on printed name. |
| Hex assertions in web-client | **Cannot work.** `makeNode` has no `style`. |
| `inspectorPaintSig` already tracks colours | **False.** Only `programsPaintSig` includes `repoColorsVersion`. `fetchRepoColors` does call `render()` after `setRepoColors`. |
| Put the hex in the inspector sig | Redundant. `agentRecordSig` already stringifies `agent.repo`. The missing clock is the version counter. |
| DOM is grid → doc + desk | **Incomplete.** `drawer-shell-head` is appended first. |
| Pane background is `--surface` | Alias-true: `--surface: var(--color-surface-card)`, and a later semantic rule sets `.pane-inspector { background: var(--color-surface-card) }`. Do not retoken it. |
| Rule 5 tests will demand `:not()` on the desk | **False** unless someone broadens `repoRowSelectors()`. Do not. |
