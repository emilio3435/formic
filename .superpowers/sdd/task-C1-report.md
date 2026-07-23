# Task C1 — Row instrument cluster + de-noise — Report

**Lane:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-tree-glance`
**Branch:** `ant-hill/luna-tree-glance-20260722` (cut from `main` @ `21d1b5f`)
**Status:** DONE_WITH_CONCERNS (one surfaced contract-vs-source conflict, resolved + flagged; one dead-CSS deferral)

---

## Implementation summary

Every agent row now leads with identity on the left and a right-aligned **instrument
cluster** on the right: `status word · outcome` · `model + ctx%` · `tokens` · `elapsed`.
The `terminal:` / `source:` / `cwd differs` naming tags left the visible row; only a
cwd **mismatch** keeps a small ember dot (`role="img"` + accessible label), and the full
naming sentence folds into the row `title` + `aria-label` and stays in the drawer.

### Files changed
- `src/web/app.js`
  - `renderAgentColumnHeader` — renames the columns to `Agent/message · Status · Model · Ctx · Tokens · Elapsed`; instrument labels carry `.ri-col-label` (right-aligned).
  - `renderAgentRow` — de-noised identity tags (source-label ternary → single `.source-mismatch-dot`, mismatch-only); new `.row-instruments` cluster (status cell kept verbatim + `.ri-model` / `.ri-tokens` / `.ri-elapsed` cells); `line1 = [identity, instruments]`; row `title` = `fullSourceDetail(agent)`; `aria-label` augmented with **Tokens**, **Elapsed**, and the folded **source detail** (Model/Context/**Access** retained).
  - Reused derivations only — `modelShort`, `contextUsage` (ctx%), `tokenSummary`, `liveElapsedText`/`elapsedDataset`, and the drawer's `fullSourceDetail`. No forked naming logic, no invented numbers.
  - Removed three functions my change orphaned: `rowFact`, `contextFact`, `controlFact` (shared `CONTROL_ICONS` / `CONTROL_STATE_TEXT` kept — still used by the drawer status line and the row aria-label). Removed the now-unused `customLabel` local.
  - Exported `renderAgentRow` + `renderAgentColumnHeader` on `TheAntHill` for executable fixture tests (mirrors B3's `renderVitalsBand`).
- `src/web/styles.css` (`agent rows` section + its responsive entries only)
  - New shared 5-track grid (`minmax(rem, fr)` so tracks resolve identically per row → columns align + header sits above values); `align-items: start` so instruments ride the name line.
  - `.row-instruments { display: contents; }` — its cells stay direct grid items with explicit `grid-column` 2–5, so an omitted cell leaves its column empty rather than shifting neighbours.
  - `.ri-cell` / `.ri-value mono` (mono + `tabular-nums`, right-aligned) following the established `vital-big mono` idiom; `.ri-cell.is-unknown` faint fallback.
  - `.source-mismatch-dot` ember dot (indicator ink + soft ring, no flood).
  - **Alert-wash rails** (audit finding): `.agent-row.is-{needs-you,blocked,failed}:not(.is-selected) { box-shadow: inset 4px 0 var(--{needs,blocked,failed}); }`.
  - Responsive: `@1180px` tighter tracks; `@min-1180 body.inspector-open` keeps identity + status, drops model/tokens/elapsed (targets `.ri-*` classes now that the cluster is a `display:contents` wrapper); `@720px` collapses the cluster to **status + model only** (drops tokens/elapsed) via `grid-template-areas`, per the responsive-collapse contract — CSS only, no JS branching.
- `tests/web-client.test.ts` — updated the "five primary columns" test to the new labels; added the `agent rows: instrument cluster + de-noise (C1)` describe (a–e).

---

## TDD RED → GREEN

Executable `withDom` fixtures (same idiom as B3/B4) + source/style asserts.

- **(a)** executed `renderAgentRow` → `.row-instruments` present; contains `gpt-5-codex`, `20%` (40k/200k ctx%), `40k`, `2m`; ≥3 `.ri-value mono` values. → RED: `.row-instruments` null.
- **(b)** unknown tokens / no window → model cell shows `opus 4.8` with **no `%`**, **no** `.ri-tokens` / `.ri-elapsed` cells, **no** `not reported` text (honest omission). → RED: null.
- **(c)** source-absence: `renderAgentRow` source no longer emits `"terminal: " + terminal` / `"source: " + sourceName` / `" · cwd differs"`, still calls `fullSourceDetail(agent)`; executed cwd-mismatch fixture renders one `.source-mismatch-dot` with an `aria-label`, and `textOf(row)` has no `cwd differs` / `terminal:`; a calm fixture renders no mark. → RED: source still had `"terminal: " + terminal`.
- **(d)** executed `renderAgentColumnHeader` names `Agent`/`Status`/`Model`/`Tokens`/`Elapsed`. → RED: header text was `StatusAgent/messageModelContextAccess`.
- **(e)** each alert modifier now pairs a `color-mix` tint **with** an `inset … var(--needs|--blocked|--failed)` rail (Rule 1 / codified soft-wash threshold). → RED: no rail.

Verified all 6 fail for the right reasons, implemented, then GREEN.

**Final `bun run check`:** typecheck clean; **281 pass, 0 fail**, none skipped (276 baseline + 5 new C1 tests; the "five primary columns" test was updated in place, not added).

---

## Visual QA (gstack `browse`, headless; never mcp chrome)

Throwaway preview server (removed after) served the real `src/web` assets + a seeded
snapshot built through the real `buildSnapshot` (8 fixture agents: swarm parent + role
children, needs-you / blocked / failed alerts, observed+window vs unknown tokens, one
cwd-mismatch). Screenshots:

- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/c1-after-1440.png` — many agents fit without wrapping; `MODEL · CTX` / `TOKENS` / `ELAPSED` columns line up under their right-aligned labels; colored status; role chips; alert rails.
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/c1-after-720.png` — cluster collapses to status + model·ctx (tokens/elapsed dropped); rail intact.
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/c1-after-375.png` — same collapse; computed styles confirm `.ri-tokens`/`.ri-elapsed` `display:none`, `.row-state`/`.ri-model` shown.

Instrumented checks (browse `js`):
- 3 role chips render; 1 `.source-mismatch-dot` with `aria-label` "Working directory differs from the terminal pane. Terminal: hormiga-dormida · x-…".
- needs-you row computed `box-shadow: rgb(194,59,46) 4px 0 0 0 inset` (ember rail — finding closed).
- `.pane-list` text contains **no** `terminal:` / `cwd differs`.
- **Keyboard walk:** first row `role=button` `tabindex=0`, focus lands; `Enter` opens the drawer (`body.inspector-open`, drawer title = agent name). Selection/rename flows untouched.
- **Aria parity:** normal-row aria-label carries `Tokens: 84k tokens. Elapsed: 4.4h. Access: View only.`; mismatch-row aria-label additionally carries the full `Terminal: … · Session cwd ≠ pane folder: …` sentence; the same sentence is the row `title`.

---

## Self-review

- **Contract complete:** one-line-per-agent instrument cluster, mono+tabular values, honest per-cell omission, de-noise mark + tooltip/drawer reuse, second-line summary preserved, header names the columns, responsive collapse via CSS. Rename button, selection checkbox, swarm anchor/notes untouched.
- **Aria/tooltip parity:** everything de-noised (naming detail + Access) survives in `aria-label` + `title`; the mismatch dot has its own label. Verified live.
- **Rules enforced:** R1 (alert rails — indicator ink, not flood), R2 (mono for values, `.ri-value mono` + tabular-nums; status word stays UI), R4 (CSP-safe — classes + `display:contents`, zero inline style), R5 (calm summary clamp kept; instruments omit-empty), R6 (no animation added).
- **Scope:** diff limited to the agent-row render path + the `agent rows` CSS section and its responsive entries. No drift.
- **Test output pristine.**

### Surfaced conflict (resolved, not silently adapted)
The contract's row line enumerates `[status·outcome][model+ctx%][tokens][elapsed]` and **omits the current Access/control column**; the "what operators scan for" list and the `<720px` collapse ("model + status only") also omit it. I followed the contract literally — **Access is no longer a visible cell; it folds into the row `aria-label` (already there) + the drawer's status line still renders it visibly.** The accessibility hard line holds. This is a one-line add-back if a visible Access instrument is wanted; flagging rather than guessing per the brief.

### Untagged observations
- **Dead CSS left in place (deferred cleanup):** removing `rowFact`/`contextFact`/`controlFact` orphaned their row-only CSS (`.row-fact*`, `.token-fact-value`, `.fact-control`, `.control-access*`, `.control-icon*`, `.control-{linked,observed-only,quarantined}` descendant rules). I removed the dead **JS** (zero-risk, keeps the source grep clean) but left the dead **CSS** untouched because it neighbours shared vocabulary — `.tm-track`/`.tm-fill` (used by `svgMeter`/`.vital-bar`) and `.status-line-item.control-*` (drawer) — and the usage-tab comment still cross-references `.row-fact-value` as the mono-value exemplar. It is inert (no element carries those classes now). Safe follow-up pruning, called out rather than smuggled into this diff.
- **Alert rail vs role rail:** on a row that is both an alert and a role (e.g. the verifier + needs-you fixture), the alert `box-shadow` supersedes the role's `inset 3px` rail (defined earlier) — attention wins the edge. Intentional and consistent with the audit's fix direction; the role identity still reads from the chip.
- **Context toggle:** the row's ctx% is always a percentage (contract: "ctx%"); the raw count rides the separate Tokens cell, so the row shows both lenses at once and no longer varies with the `contextDisplay` percent/tokens toggle. The toggle still drives the context-peak widget and the drawer. No information lost.

---

## Fix pass (review verdict: Needs fixes — one Important)

Reviewer confirmed the accessibility work, cluster contract, collapse, and alert rail
clean. The Important finding: the deferred dead-CSS cleanup — my "shared vocabulary"
rationale did not survive verification, so the own-orphan rule applies.

**Fix commit:** `19f1f5e fix(rows): drop CSS orphaned by the row-fact removal; reuse modelText`

### 1. Verified zero emitters, then deleted both dead blocks
Grep over `app.js` + `index.html` (class usage, not CSS) returned **0** for every deleted
selector: `row-fact`, `row-fact-value`, `fact-tokens`, `fact-context`, `context-fact-value`,
`fact-control`, `control-access`, `control-icon`, `control-access-text`. The row's
`"control-" + control` emitter was `controlFact`, already removed; the drawer emits
`"status-line-item control-" + control` (a distinct `.status-line-item.control-<state>`
selector), so the row-only `.control-<state> .control-icon`/`.control-access-text`
descendant rules also had zero emitters. No live emitter for any deleted selector — nothing
to stop/report.

Deleted from the `agent rows` section (styles.css):
- `.row-fact` / `.row-fact-value` / `.fact-tokens .row-fact-value` / `.row-fact.is-unknown .row-fact-value`
- `.fact-control` / `.control-access` / `.control-icon` / `.control-icon .ico` / `.control-access-text` / `.control-{linked,observed-only,quarantined}` `.control-icon`+`.control-access-text` descendant rules (11 rules).

**Left byte-untouched** (verified present after): `.tm-track`/`.tm-fill` (SVG meter fill,
used by `svgMeter` + `.vital-bar`), `.token-fact-value`/`.token-meter` (pre-existing dead,
not my orphans), `.status-line-item.control-linked`/`.control-quarantined` (drawer). The
reviewer's read was correct: distinct live families, not shared vocabulary.

### 2. Source-absence guards (B4 (d1) pattern), TDD RED first
Added test `(f)` to the C1 describe:
- `expect(source).not.toContain(cls)` for `"row-fact"`, `"control-access"` (app.js emitters).
- `expect(styles).not.toContain(rule)` for `.row-fact {`, `.row-fact-value {`, `.fact-control {`, `.control-access {`, `.control-icon {` (rule-shaped so the usage-tab **comment** mention of `.row-fact-value` never masks a real rule).
- Positive guards that the live neighbours stay: `.tm-track { fill: var(--line); }` and `.status-line-item.control-linked`.

RED verified against the not-yet-deleted CSS (the five styles rules matched → 1 fail); after
deleting the blocks → GREEN.

### 3. Minor fold-in (same function): reuse `modelText`
`renderAgentRow` now calls `modelShort(agent.model)` **once** (into `modelText`) and reuses
it for the `is-unknown` gate (`modelText === "not reported"`), the cell `title`, and the
row `aria-label` (was 4 calls). Verified: exactly 1 `modelShort(agent.model)` in the
function. Behavior preserved for known models; the unknown-model fallback now reads
`not reported` in the title + aria (was `Model not reported`), removing the
`Model: Model not reported` redundancy — no test pinned that string.

### Result
`bun run check`: typecheck clean, **282 pass, 0 fail**, none skipped (was 281 + test (f)).
Diff: app.js 6 lines (3 call-site reuses), styles.css −18 (two dead blocks), tests +15.
Not pushed.

**Out of scope (per coordinator):** the context-toggle visible/aria framing (roll-up). Left
as-is. The usage-tab comment still mentions `.row-fact-value` as a mono exemplar; it is a
comment (not a selector), out of the agent-rows scope, and the coordinator flagged it as
known — left untouched.
