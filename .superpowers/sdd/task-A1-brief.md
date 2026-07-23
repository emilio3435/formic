# Task A1: Codify the design language (pre-G0, Fable 5 xhigh)

**Files:**
- Create: `/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md` (repo root, alongside `DEPLOY.md`/`GOAL.md`)

**Interfaces:**
- Produces: the named vocabulary every later task cites in commit messages and tests — token names, the six rules below, and a per-section conformance checklist.

**Steps:**

1. **Extract the vocabulary from the pulse work.** Read `/Users/emilionunezgarcia/Developer/anthill-pulse/src/web/styles.css` header comment and `:root` block; document, with the exact custom-property names: graphite ground (`--canvas/--surface/--raise/--sand`), ink scale (`--ink/--muted/--faint`), indicator inks (`--ember/--amber/--moss/--slate/--clay` + `-soft` mixes), signal rails (`--signal-rail`), frame (`--frame`), inspector width, shadow scale, provider inks, mono-for-values rule, SVG-attribute meter rule, urgency-weighted cell + calm-collapse pattern, progressive disclosure (thin trigger → drawer).
2. **Write the conformance checklist** — one line per body section from the `styles.css` section map (`utilities`, `masthead`, `app body`, `toolbar`, `programs`, `agent rows`, `inspector: layered drawer`, `per-type drawer states`, `vitals band`, `controls`, `broadcast dock`, `empty state`, `toast`, `responsive`, `usage tab`, `motion`) with pass/fail columns for each of the six rules.
3. **No commit.** (Deviation from the plan's Step 3, decided by the controller: this checkout is on branch `main`, and the repo rule is never commit on main. Leave `DESIGN-LANGUAGE.md` untracked — the WS-A lane commits it as its first commit after Gate G0.)

**The six rules** (name them exactly this way in the checklist so audits and commit messages can cite them):
1. **Indicator inks, not flood fills** — status via outline marks, colored text, 2px left-edge signal rails; no filled hospital banners.
2. **Mono for values only** — `--font-mono` for identifiers, paths, timestamps, token/cost values; never headings or prose.
3. **Shared frame** — full-width bands align to `--frame: min(1680px, calc(100vw - 64px))`.
4. **CSP-safe rendering** — no inline `style`; meters via SVG attributes; variant colors via classes.
5. **Calm collapse / progressive disclosure** — quiet one-line resting states that expand on demand; thin triggers open drawers; urgency earns visual weight, calm does not.
6. **Motion respects `prefers-reduced-motion`** — every animation disabled inside the existing guard block.

## Global Constraints (from BODY-RESTYLE-PLAN-2026-07-22.md — binding)

- Strict CSP: never set inline `style`; meters/colors via SVG attributes and classes (e.g. `dw-provider--<provider>` pattern).
- Light scheme only (`<meta name="color-scheme" content="light">`); no dark variant work.
- Monospace (`--font-mono`) is reserved for identifiers, paths, timestamps, and token/cost values — never headings or prose.
- Indicator inks, not flood fills: status uses outline marks, colored text, and 2px left-edge signal rails (`--signal-rail`); no filled hospital banners.
- All full-width bands align to the shared frame: `--frame: min(1680px, calc(100vw - 64px))`.
- Inspector width stays `--inspector-w: clamp(480px, 32vw, 520px)` on desktop; full-surface drawer <1024px; 44px touch targets <1024px.
- `prefers-reduced-motion` must disable every animation added.
- Monospace only for identifiers/paths/timestamps/token values.
- Repo tests are string/regex-over-source intent tests; real layout proof is `@browse` screenshots (not relevant to this doc-only task).

## Hard boundaries for this task

- **Read-only everywhere except the one file you create.** You may read `/Users/emilionunezgarcia/Developer/anthill-pulse/src/web/*` (a live worktree other agents are using — READ ONLY, never write, never run git commands there) and `/Users/emilionunezgarcia/Developer/the-mountain-main/src/web/*` for comparison.
- Do not run `git add`, `git commit`, or any git state-changing command in any checkout.
- The only file you create or modify: `/Users/emilionunezgarcia/Developer/the-mountain-main/DESIGN-LANGUAGE.md`.
