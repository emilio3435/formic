# Settings shell revamp

Repo: Formic. Branch from `feat/issue-67-discovery` (Collectors already exist). Not `the-mountain-production`.

**Goal:** Settings is a readable operator desk: you can see what is on, what is waiting, and what Import just did — without a stacked checkbox, an ISO timestamp, or a silent no-op.

**Success means:** Opening Settings on the preview board, an operator can (1) tell Collectors from Time from This browser, (2) Import a found home with a primary action that does not look like a leftover, (3) read a one-sentence result that names the board consequence, (4) still Save working/quiet the way they do today.

**Stop when:** DOM tests for section order, default-no-Off, Import outcome copy, and paint-guard are green; `tsc` is clean; a hard-refresh of the preview Settings at `ah-t36` matches the layout below on desktop and a 420px-wide viewport. Do not deploy. Do not start until Emilio approves this spec.

---

## Why this is not “fix the Import button”

Tonight’s Collectors block was bolted under the time fields. It reuses `.settings-field` (a one-column grid), so a found row stacks **checkbox → title → `kind · path · Needs a parser · 2026-08-16T05:22:50.194Z` → Ignore**. After Import, Grok Bot 2 joins **On now** next to Cursor and looks collected. The board does not grow a row. That is the product failure, not a missing CSS class.

The rest of the dialog has the same disease: one scroll, three authorities (Save / immediate POST / localStorage), a lede that only talks about silence, Advanced hiding retention, colours at the bottom.

---

## What exists (verified 2026-08-16)

`renderSettingsPanel` in `src/web/app.js` ~3959–4121. One modal (`role="dialog"`). Paint guard so a snapshot tick does not rebuild the form.

| Block | Authority | Today |
|---|---|---|
| Working / Quiet + presets + live preview | Fleet. **Save** POSTs `/api/settings` | First, and the only thing the lede describes |
| Collectors | Own store. GET/POST `/api/collector-instances` on open / Import / Ignore | Between time and Advanced. Rows are `.settings-field` |
| Advanced (scan window, provider wait, history) | Fleet. same Save | `<details>` |
| Needs-you display | This browser. `localStorage`. Instant | After Advanced |
| Repository colours | Own API. Instant | After Needs-you |
| Save / Reset all / Done | Save = time + Advanced only | Footer |

Collectors grouping today: ignored → unmet `needs-parser` → `default \|\| onboarded` → found. **Importing a parser-needed home moves it to On now.** That is what Emilio’s screenshot shows: “5 homes on. 0 found” and Grok Bot 2 sitting next to Cursor.

Importing Grok Bot / Claude-as-unknown **must not** create Board rows. That is #69 / later parsers. The shell has to *say* that.

---

## Locked decisions

| Decision | Call |
|---|---|
| Same dialog | One Settings modal. No new route, no tabs (the board already has three). |
| Section order | **Collectors → Time → This browser → Advanced.** Collectors is why the panel was opened tonight. |
| Three authorities, named | Each section states who it writes to. Save only covers Time + Advanced. Collectors and colours do not wait on Save. |
| No new visual language | Formic tokens, `.settings-inner`, rail notes (`.settings-saved` / `.settings-preview`), `.btn.primary`. No cards-in-cards, no new type scale. |
| Collectors row | Horizontal: `[checkbox?] [title + one status line] [Ignore?]`. Never stack a checkbox above a timestamp. |
| Status line is English | “Collecting from Application Support/Cursor.” / “Imported. No board rows — Formic cannot read this yet.” / “Found. Import to collect.” Drop ISO `lastSeenAt` from the row. |
| After Import | A rail note, same chassis as the time preview: **“Imported Grok Bot 2. No new board rows — this home has no parser yet.”** or **“Imported Cursor-2. Its chats should appear on the board after refresh.”** |
| Grouping after Import | Defaults + imported *collectable* homes = **On the board**. Onboarded + `needs-parser` / `needs-home-list` = **Imported, no rows yet**. Unmet extras stay **Found** / **Needs a parser**. Ignored last. |
| Defaults | Still no Off, no checkbox. |
| Import selected | `.btn.primary` in a `.settings-collectors-actions` row. Disabled until a box is checked. Hidden only when nothing is importable. |
| Ignore | Quiet text control, not a second full `.btn`. |
| Paint guard | Keep it. Add `collectorImportNote` to the signature. |
| Extract | Move the Settings dialog out of `app.js` into `src/web/settings-panel.js`. Collectors stay in that file or `src/web/settings-collectors.js`. `app.js` only opens/closes. |
| Cache-bust | `ah-t35` → `ah-t36` on every `?v=` in `src/web/index.html`. |
| No Zod, no ninth Provider, no production edit, no deploy | Same as #67. |
| Not this spec | Cursor-2 scan miss (wrapper `$HOME` + 2s budget). Extra Grok CLI collect (#70). Grok Bot blob wiring (#69). Muse / Antigravity (#71). |

---

## Collectors — target layout

```
Collectors
2 homes on the board. 2 imported with no rows yet. 0 waiting on you.

On the board
  Cursor
  Collecting from Application Support/Cursor

Imported, no rows yet
  Grok Bot 2
  Imported. No board rows — Formic cannot read this yet.
  Grok Bot
  Imported. No board rows — Formic cannot read this yet.

Found, not imported          (only if any)
  [ ] Cursor-2
      Found. Import to collect from Application Support/Cursor-2.    Ignore

Needs a parser               (only if unmet)
  [ ] Some unknown
      Found. Import records it; it will not appear on the board.     Ignore

[ Import selected ]     Select a home above.
```

After a successful Import of a parser-needed id:

```
Imported Grok Bot 2. No new board rows — this home has no parser yet.
```

After a successful Import of a collectable extra (`cursor-gui` without `needs-parser`):

```
Imported Cursor-2. Its chats should appear on the board after refresh.
```

If the operator clicks Import with nothing checked, do nothing. Do not flash an error.

---

## Time / This browser / Advanced

**Time** (second section): keep presets, Working, Quiet, live preview, unchanged field math. Lede moves here: “How long silence has to last before this board changes what it calls a session.” Section title: **Time**.

**This browser:** Needs-you radios + repository colours. Section title: **This browser**. Help already says Save does not apply; keep that.

**Advanced:** the current `<details>` contents (scan window, provider wait, history). Closed by default.

**Footer:** Save / Reset all / Done unchanged. Save still posts only the six fleet scalars. Add one muted sentence under the buttons: “Save applies to Time and Advanced. Collectors and colours apply when you change them.”

---

## Files

| File | Change |
|---|---|
| `src/web/settings-panel.js` | New. Dialog chrome, Time, Advanced, This browser, footer. |
| `src/web/settings-collectors.js` | New. Groups, rows, Import/Ignore, outcome note. |
| `src/web/app.js` | Delete inlined Settings render (~3024–4121 and collectors ~3108–3251). Import + `openSettingsPanel` / `closeSettingsPanel`. |
| `src/web/client-state.js` | `collectorImportNote: ""` |
| `src/web/styles.css` | `.settings-section`, `.settings-collectors-row`, `.settings-collectors-actions`, quiet Ignore. |
| `src/web/index.html` | `ah-t35` → `ah-t36` |
| `tests/settings-collectors-dom.test.ts` | Outcome copy, grouping after import, no Off, primary Import, row is not a stacked `.settings-field` |
| `tests/settings-panel-dom.test.ts` | Section order Collectors → Time → This browser → Advanced; Save footnote |

---

## Acceptance

1. Settings opens. First heading inside the dialog body after the title is **Collectors**.
2. Default Cursor: no checkbox, no Off, status contains “Collecting”.
3. Unimported Cursor-2 (fixture): checkbox, status contains “Import to collect”, Ignore is not `.btn` / `.btn.primary`.
4. Unimported Grok Bot 2: under **Needs a parser**, status says Import will not create board rows.
5. After Import of that Grok Bot 2 fixture: it leaves Needs a parser, sits under **Imported, no rows yet**, rail note names “Grok Bot 2” and “no … board rows”.
6. Import selected uses `.btn.primary` and is disabled when no box is checked.
7. Save footnote is visible. Saving time fields still works (existing settings tests stay green).
8. Paint guard: a snapshot tick with Settings open does not wipe a checked box.
9. Desktop (1280) and 420px-wide preview: rows stay one line of controls (checkbox + copy + Ignore), no stacked checkbox-over-timestamp.
10. `PROVIDERS` unchanged. No deploy.

---

## Out of scope

- Wiring #69 / #70 / #71
- Fixing the live Cursor-2 scan miss
- Redesigning Needs-you or repo-colour *controls* (they move sections, they do not get new widgets)
- A Settings page/route
- Dark-theme-only experiments

## Related

- #67 Collectors (in flight on `feat/issue-67-discovery`)
- #69 Grok Bot parser (unwired)
- Plan: `docs/superpowers/plans/2026-08-16-settings-shell.md`
