# Lane FE-2 — "three dropdowns and a sentence" filter redesign

You are lane FE-2. Emilio approved this redesign 2026-08-05 23:31 CDT
("GREENLIGHT"). This doc is the design contract — the orchestrator wrote it
from an approved proposal; where it is specific, follow it; where it is
silent, match the codebase's existing conventions (`tests/README.md`,
existing `renderFilterBar` idiom). Prior context you need for landmines:
`docs/superpowers/plans/2026-08-05-unified-filtering.md` §8, and commit
`8e6a66d` (the bar was just stripped of non-filter noise).

## The model (why, in three sentences)

The old bar flattened two layers into one row of identical chips: the
**working set** (view × time × fleet policy) and the **lenses** (provider /
status / program / query, all narrowing within it). Tab counts follow the
working set only, so lenses looked like they "didn't work" on the numbers.
The redesign draws that boundary visually: time becomes a working-set
control, lenses become dropdown menus, the shared review policy stops
dressing like a lens, and a self-writing sentence reconciles the numbers.

## Deliverables

### D1 — menu primitive

A framework-free dropdown for the filter bar. One open menu at a time,
`state.openFilterMenu ∈ "" | "time" | "provider" | "status"` (add to
`client-state.js`, thread into `programsPaintSig` so an open menu survives
repaints). Behavior:

- Trigger is a `filterChip`-styled button with a `▾`, `aria-haspopup="menu"`,
  `aria-expanded`, and its existing-style `data-fkey` (`lookback:menu`,
  `provider:menu`, `status:menu`).
- Menu is `role="menu"`; items `role="menuitemradio"` + `aria-checked`.
  Selecting an item applies the setter, closes the menu, focus returns to the
  trigger (fkey restore already handles this if the trigger keeps its fkey).
- Esc closes without selecting; click on the trigger toggles; a click
  elsewhere closes (document-level listener added once, guarded like the
  existing global listeners).
- Active state on the trigger: pressed ink + label carries the value
  ("Provider: codex", "Last 6h", "Status: waiting"). Inactive labels:
  "Provider", "Time", "Status".

New CSS classes must appear literally in `app.js` (census at
`web-client.test.ts:5649` region). Suggested: `.filter-menu-wrap`,
`.filter-menu`, `.filter-menu-item`, `.filter-menu-group`,
`.filter-menu-note`.

### D2 — Time menu (replaces the six lookback chips)

- Groups: **Hours** 1 · 6 · 12 · 24, **Days** 2 · 7 · 14 · 30, then
  **Everything** and **Custom…** (keeps the prompt flow). Days store as
  hours through the existing `setLookbackHours` (2d=48 … 30d=720) — the
  `mtn3-lookbackHours` persistence needs zero migration; a stored 36 simply
  renders as an active "Last 36h" custom value.
- Delete `LOOKBACK_PRESETS = [1, 6, 24, 36]` in favor of the new groups
  (`client-catalogs.js`; export the two groups; keep `DEFAULT_LOOKBACK_HOURS
  = 6`). The 36 preset dies deliberately: it was the server's scan constant
  leaked into operator vocabulary.
- Menu note under the Days group, Board only: "Days reach only sessions
  still on the live wire — History reaches the archive." (class
  `.filter-menu-note`).
- Placement: preferred at the right end of the tab-strip row (`#views` in
  `index.html`) — BUT `index.html` currently carries another lane's
  uncommitted hunks. If you can add the mount point with a one-line,
  clearly-yours hunk, do it; otherwise put the Time trigger as the
  right-aligned last control of the filter bar (`margin-left: auto`) and
  leave a status note. Do not gamble on a co-tenanted `index.html` for a
  layout nicety.

### D3 — Provider and Status menus (replace the chip groups)

- Provider menu: "All providers" + one item per provider on the wire, each
  with a working-set count: `codex (5)`. Rendered when ≥2 providers, as
  today. Setter stays `setFacetProvider` (toggle semantics move into the
  menu: selecting the active one, or All, clears).
- Status menu (Board only), items spell out what they encompass:
  - `All statuses`
  - `Working — running right now`
  - `Waiting — blocked on you or idle`
  - `Unverified — liveness not established`
  each with a count. Setter stays `setFacetStatus`. The shelf-suppression
  semantics under a lens are unchanged.
- Counts are computed over the working set (viewMatches × passesLookback ×
  passesReviewVisibility, no query, no other lens) — the same population the
  tab number counts. One helper, used by both menus and the sentence.

### D4 — the review policy stops dressing like a lens

Replace the "Show review workers (N)" chip with a distinct fragment-style
control (not `filter-chip`): `⊘ 12 reviewers hidden` / `⊘ showing 12
reviewers` (class suggestion `.filter-policy`, keep fkey
`session-kind:review`, keep `setShowReviewWorkers`). Title states it is a
fleet-wide setting shared by every browser. Rendered Board-only when
`reviewWorkerCount > 0`, as today.

### D5 — the sentence (replaces scope-note content)

`#scope-note` (already `aria-live="polite"`) renders a self-writing line
ONLY when a lens or query narrows the list, or data is stale:

> Showing **working** **codex** sessions matching **"auth"** in **program X**
> — 8 of 21 · Clear

- Fragments render for each ACTIVE lens only; each is a real `<button>`
  (fkeys `sentence:status`, `sentence:provider`, `sentence:query`,
  `sentence:program`) that opens the corresponding menu (query fragment
  focuses `#search`; program fragment clears the program lens — there is no
  program menu).
- `8 of 21`: 8 = rows actually rendered (after every lens + query), 21 = the
  working-set count (the tab number). Reuse the D3 helper; never recompute
  with different semantics.
- `Clear` (fkey `sentence:clear`) resets `facetProvider`, `facetStatus`,
  `facetProgram`, `query` — NEVER `showReviewWorkers` (shared policy) and
  never the time window.
- "last refresh failed" stays appended when `state.fetchFailed`.
- The empty-state copy (`emptyListMessage`) keeps its own wording; do not
  couple the two beyond sharing lens vocabulary.

### D6 — tab-count rule, pinned

Counts stay working-set counts (view × time × review policy — the current
`renderTabs` math, unchanged). What changes is that this is now a DESIGNED
rule, not an accident: add a test that pins **lenses and query never move
tab counts** (set `facetProvider` + `facetStatus` + `query`, assert
`count-board` unchanged) with a comment stating the two-layer model. The
sentence owns "N of M".

## AMENDMENT 1 — operator scope expansion, 2026-08-05 23:42 (read BEFORE building D3)

**A1. Every lens menu is MULTI-SELECT.** Emilio: "make sure you can mix/match
toggles — having BOTH working and waiting enabled (or off) both must work."
This supersedes D3's radio semantics everywhere:

- Items are `role="menuitemcheckbox"` with `aria-checked`; selecting toggles
  membership and the menu STAYS OPEN (multi-select menus that slam shut on
  each toggle are hostile); Esc/outside-click closes.
- State becomes sets: `facetProviders: []`, `facetStatuses: []` (replace the
  scalar `facetProvider`/`facetStatus` — migrate every reader:
  `currentFilter`, `shelfFilter`, `emptyListMessage`, `programsPaintSig`,
  scope-sentence, `listUi` in tests). Empty set = lens off = show all. Within
  an axis: UNION (`working OR waiting`). Across axes: AND, as before.
- "All …" item clears the set. Trigger label: "Status: working+waiting" (or
  "Status (2)" if it overflows), pressed ink while non-empty.
- Shelf suppression: while `facetStatuses` is NON-EMPTY (same rule, set
  form). Both-off = empty set = shelf back, everything shown — pin this in a
  test: statuses {} shows all, {working} narrows, {working, waiting} is the
  union, and the union is strictly larger than either singleton.

**A2. Three new lens axes (D3's pattern, same menu primitive, same counts
helper, all multi-select):**

- **Model ▾** (`model:menu`, items `model:<value>`): one item per distinct
  `agent.model` on the wire, plus "unreported" for rows without one. Filter
  on exact model string.
- **Span ▾** (`span:menu`, items `span:<bucket>`): session length buckets
  over the same first-to-last-activity duration the SPAN cell renders —
  `under-1h`, `1-8h`, `8-24h`, `over-24h`. Reuse the row's elapsed source,
  do not invent a second duration.
- **Context ▾** (`context:menu`, items `context:<bucket>`): buckets over
  `contextUsage(agent.tokens).pct` (`agent-model.js:543`) — `under-25`,
  `25-50`, `50-75`, `over-75`, plus `unreported` when contextUsage returns
  null. Board AND History (both axes are meaningful on finished rows).
- Bar order: `Provider ▾ · Status ▾ · Model ▾ · Span ▾ · Context ▾` — five
  compact closed triggers replace fifteen open chips, so flat wins over a
  nested "More" menu. Sentence fragments extend accordingly ("long-running",
  "high-context" wording is fine; keep it English, not bucket keys).
- State: `facetModels: []`, `facetSpans: []`, `facetContexts: []` — same
  set semantics, same Clear behavior in the sentence.

**A3. Remove the tokens ⓘ.** The `ri-scope-mark` span (`app.js:6587`) and
its CSS class go. KEEP the aria-label's ", latest model call" qualification
and the cell title — the qualification survives for screen readers and
hover; only the visual mark dies. Update any test pinning `ri-scope-mark`
to pin its absence.

## AMENDMENT 2 — operator, 2026-08-05 23:49: the toolbar loses two buttons

Remove the **"Select to send"** and **"Action log"** buttons:

- `index.html:116-117` (`#select-toggle`, `#actions-toggle`) — note the file
  carries foreign hunks; atomic hunk staging applies.
- `app.js`: the `select-toggle` maintenance block in the toolbar renderer
  (~`:4360-4372`) and both buttons' `addEventListener` wiring (~`:10289`
  region). Guard-remove only what YOUR removal orphans at the wiring layer.
- Do NOT rip out the underlying machinery in this lane: `enterSelectMode`,
  `state.selecting` threading, `renderBroadcastBar`, `action-log.js`, and
  `#actions-panel` stay (dormant). Full subsystem removal is a separate
  ruling the orchestrator is putting to Emilio — your commit message should
  say the machinery is now UI-unreachable so the follow-up is discoverable.
- Update tests pinning the buttons' presence to pin absence; leave
  machinery-level tests untouched (dormant code keeps its coverage until the
  removal ruling).
- One commit, its own: `feat(web): the toolbar drops Select-to-send and Action log`.

## Tests (deliberate contract updates)

- The fkey-order pin updates deliberately: new order is
  `session-kind:review → provider:menu → lookback:menu (or tab-row) →
  status:menu → program fragments live in the sentence now`. Menu ITEM
  fkeys: `lookback:1`, `lookback:48`, `provider:codex`, `status:waiting`
  etc. — keep the existing namespaces so muscle-memory focus restore holds.
- Update the 3.x filter-bar tests (chips → menus) honestly — assert through
  real clicks (`withRequests`; the harness has `querySelector`/`querySelectorAll`
  on fake nodes since FE-1). Menu open → select → state → close → focus.
- New: sentence fragment tests (renders only-active lenses; Clear resets
  lenses not policy; "8 of 21" math), count-stability pin (D6), day-preset
  mapping test (2d → setLookbackHours(48)).
- CSS census: every new class literal in `app.js`. Run
  `bun test tests/web-client.test.ts` after each deliverable;
  `bunx tsc --noEmit` before each commit.

## Shared-worktree law (unchanged, and it bit twice today)

- Branch `fix/cmux-control-health-lifecycle`; re-check `git branch
  --show-current` before every commit.
- `app.js`, `styles.css`, `index.html`, and `tests/web-client.test.ts` are
  co-tenanted with live foreign lanes RIGHT NOW. The index is shared repo
  state: stage ONLY your hunks (`git apply --cached` of your hunk patch) and
  commit in the SAME shell invocation; verify foreign hunks survive after.
  If a contract test passes when it should fail, suspect a co-tenant
  overwrote your file — re-read from disk before diagnosing.
- One deliverable per commit (D1+D2 may combine if D1 alone is untestable).
  Do not push. Do not commit this kickoff or your status file.

## Status protocol

Append to `docs/LANE-FE2-STATUS.md`: `[HH:MM] D<N> DONE <sha>` /
`BLOCKED <reason>` lines, and a final `[HH:MM] LANE DONE`. Divergences from
this contract: implement your better idea ONLY if it is strictly more
faithful to the two-layer model, and log it as a DIVERGENCE line with the
reasoning.
