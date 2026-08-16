# Settings shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Do not start until Emilio approves the spec.

**Goal:** Settings is a sectioned operator desk. Collectors come first. Import has a primary action and a one-sentence board consequence.

**Architecture:** Extract the dialog out of `app.js` with no visual change, then restyle Collectors and reorder sections. Keep the paint guard. Three authorities stay three authorities.

**Tech Stack:** Existing `el()` DOM helpers, Formic tokens, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-16-settings-shell.md`

## Global Constraints

- Branch from `feat/issue-67-discovery`. Never edit `~/Developer/the-mountain-production`.
- `PROVIDERS` stays eight names.
- No Zod. No `Grok Bot 2.app` literals.
- Same Settings dialog. No new route, no tabs.
- Section order: Collectors → Time → This browser → Advanced.
- Save covers Time + Advanced only.
- Cache-bust `ah-t35` → `ah-t36`.
- Do not deploy. Do not push unless Emilio asks.
- Do not fix the Cursor-2 scan miss. Do not wire #69/#70/#71.

---

## File map

| File | Responsibility |
|---|---|
| `src/web/settings-panel.js` | Dialog, Time, Advanced, This browser, footer, paint guard |
| `src/web/settings-collectors.js` | Groups, rows, Import/Ignore, outcome note |
| `src/web/app.js` | Open/close only |
| `src/web/client-state.js` | `collectorImportNote` |
| `src/web/styles.css` | Section + row + actions |
| `src/web/index.html` | `ah-t36` |
| `tests/settings-collectors-dom.test.ts` | Collectors chrome + outcome |
| `tests/settings-panel-dom.test.ts` | Section order + Save footnote |

## Parallelization (after approval)

| Lane | Tasks | Depends on |
|---|---|---|
| A extract | 1 | — (serial) |
| B collectors chrome | 2 | 1 |
| C shell order + footnote | 3 | 1 |
| D cache-bust + preview | 4 | 2 and 3 |

B and C may run in parallel after A if they do not both edit `settings-panel.js` at once. Safer SDD: 1 → 2 → 3 → 4, one implementer at a time.

---

### Task 1: Extract Settings out of `app.js` (no visual change)

**Files:**
- Create: `src/web/settings-panel.js`
- Create: `src/web/settings-collectors.js`
- Modify: `src/web/app.js` (remove inlined Settings; re-export what tests import)
- Test: existing `tests/settings-collectors-dom.test.ts` + `tests/settings.test.ts` (if it paints the panel)

**Interfaces:**
- Produces: `openSettingsPanel`, `closeSettingsPanel`, `renderSettingsPanel`, `SETTINGS_PRESETS`, `settingsPreview`, `settingsPreviewText` (same exports `TheAntHill` already exposes around `app.js:14600`)

- [ ] **Step 1:** Confirm current tests still pass on the branch.

Run: `bun test tests/settings-collectors-dom.test.ts tests/settings.test.ts`
Expected: PASS (counts as of HEAD).

- [ ] **Step 2:** Move collectors functions (`collectorInstanceList` through `renderCollectorsBlock`) into `settings-collectors.js` unchanged. Move `renderSettingsPanel` and its helpers (`settingsField`, presets, verdict, repo-colour host wiring that the panel owns) into `settings-panel.js`. Import them from `app.js`. Do not change class names or copy.

- [ ] **Step 3:** Re-run the same tests. They must stay green with no assertion edits.

Run: `bun test tests/settings-collectors-dom.test.ts tests/settings.test.ts && bunx tsc --noEmit`

- [ ] **Step 4:** Commit

```bash
git add src/web/settings-panel.js src/web/settings-collectors.js src/web/app.js
git commit -m "refactor: extract Settings dialog from app.js"
```

---

### Task 2: Collectors chrome + Import outcome

**Files:**
- Modify: `src/web/settings-collectors.js`
- Modify: `src/web/client-state.js` (`collectorImportNote: ""`)
- Modify: `src/web/styles.css`
- Modify: `tests/settings-collectors-dom.test.ts`

**Interfaces:**
- Consumes: same instance shape as #67
- Produces: groups `{ onBoard, importedNoRows, found, needsParser, ignored }`; `collectorImportNote` string

```ts
// grouping
if (row.ignored) ignored
else if (row.reason === "needs-parser" && !row.default && !row.onboarded) needsParser
else if ((row.reason === "needs-parser" || row.reason === "needs-home-list") && row.onboarded) importedNoRows
else if (row.default || row.onboarded) onBoard
else found
```

Status copy (verbatim):

| State | Line |
|---|---|
| default or onboarded collectable | `Collecting from ${shortDir}` |
| onboarded + needs-parser / needs-home-list | `Imported. No board rows — Formic cannot read this yet.` |
| found collectable | `Found. Import to collect from ${shortDir}.` |
| unmet needs-parser | `Found. Import records it; it will not appear on the board.` |

Import rail (verbatim):

- collectable extra: `Imported ${label}. Its chats should appear on the board after refresh.`
- needs-parser / needs-home-list: `Imported ${label}. No new board rows — this home has no parser yet.`

- [ ] **Step 1:** Extend the DOM test.

```ts
test("an imported parser home does not look collected and names the board consequence", () => {
  // Cursor default + imported Grok Bot 2 (onboarded, needs-parser)
  // after render:
  expect(document.querySelector("[data-instance='cursor-gui:cursor'] input[type='checkbox']")).toBeNull();
  expect(document.querySelector("[data-instance='cursor-gui:cursor']")?.textContent).toMatch(/Collecting/);
  expect(document.querySelector("[data-group='imported-no-rows'] [data-instance='grok-bot:grok-bot-2']")?.textContent)
    .toMatch(/No board rows/i);
  expect(document.querySelector("[data-instance='grok-bot:grok-bot-2']")?.className).not.toMatch(/settings-field(?!-)/);
});

test("Import selected is primary and disabled until a box is checked", () => {
  // unimported Cursor-2 present
  const btn = document.querySelector("[data-fkey='collectors-import']");
  expect(btn?.className).toMatch(/primary/);
  expect(btn?.disabled).toBe(true);
});
```

- [ ] **Step 2:** Run — FAIL on grouping / class / disabled.

- [ ] **Step 3:** Implement rows as `.settings-collectors-row` (grid: `auto 1fr auto`). Import button `.btn.primary` in `.settings-collectors-actions`. Ignore is a `<button type="button" class="settings-collectors-ignore">`. Set `state.collectorImportNote` on successful POST. Include the note in the paint signature.

CSS to add (Formic tokens only):

```css
.settings-section { display: grid; gap: 0.55rem; }
.settings-section + .settings-section { border-top: 1px solid var(--rule); padding-top: 0.75rem; margin-top: 0.15rem; }
.settings-collectors-row { display: grid; grid-template-columns: auto 1fr auto; gap: 0.35rem 0.65rem; align-items: start; }
.settings-collectors-copy { display: grid; gap: 0.12rem; }
.settings-collectors-actions { display: flex; align-items: center; gap: 0.65rem; }
.settings-collectors-ignore {
  border: 0; background: none; color: var(--muted); font: inherit; font-size: 0.8rem;
  padding: 0.15rem 0; min-height: 0; cursor: pointer;
}
.settings-collectors-ignore:hover { color: var(--ink); }
```

- [ ] **Step 4:** `bun test tests/settings-collectors-dom.test.ts && bunx tsc --noEmit`

- [ ] **Step 5:** Commit `feat: Collectors rows say what Import did to the board`

---

### Task 3: Section order + Save footnote

**Files:**
- Modify: `src/web/settings-panel.js`
- Test: `tests/settings-panel-dom.test.ts`

Order inside `.settings-inner` after the head:

1. `section.settings-section` **Collectors**
2. `section.settings-section` **Time** (lede + presets + fields + preview)
3. `section.settings-section` **This browser** (Needs-you + repo colours)
4. `details.settings-advanced` **Advanced**
5. verdict + actions + footnote `Save applies to Time and Advanced. Collectors and colours apply when you change them.`

- [ ] **Step 1:** Write `tests/settings-panel-dom.test.ts` that opens the panel and asserts heading text order is Collectors, Time, This browser, Advanced, and the footnote matches `/Save applies to Time and Advanced/`.

- [ ] **Step 2:** FAIL (order is still Time-first).

- [ ] **Step 3:** Reorder. Do not change field math.

- [ ] **Step 4:** `bun test tests/settings-panel-dom.test.ts tests/settings-collectors-dom.test.ts tests/settings.test.ts && bunx tsc --noEmit`

- [ ] **Step 5:** Commit `feat: Settings leads with Collectors, then Time`

---

### Task 4: Cache-bust + preview

**Files:**
- Modify: `src/web/index.html` (`ah-t35` → `ah-t36` on every `?v=`)

- [ ] **Step 1:** Replace all four `?v=ah-t35` tokens.

- [ ] **Step 2:** `bash scripts/anthill-preview.sh` from this worktree. Hard-refresh `http://127.0.0.1:<port>/?v=ah-t36`. Screenshot Settings at 1280 and 420. Confirm: Collectors first, default Cursor has no Off, Import (if anything is waiting) is the clay primary, imported Grok Bot sits under **Imported, no rows yet** with the no-parser sentence.

- [ ] **Step 3:** Commit `chore: cache-bust Settings shell to ah-t36`

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Extract from `app.js` | 1 |
| Horizontal collector rows | 2 |
| English status + Import rail | 2 |
| Grouping: On the board / Imported, no rows yet | 2 |
| Primary Import, quiet Ignore | 2 |
| Section order | 3 |
| Save footnote | 3 |
| `ah-t36` + preview | 4 |
| No deploy / no ninth provider | all |

## Out of scope

- Cursor-2 scan budget / `$HOME` expand
- #69/#70/#71
- Deploy
