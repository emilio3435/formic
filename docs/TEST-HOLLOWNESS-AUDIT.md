# Test hollowness audit — confidence-header + notification-center

**Lane:** harden-notify · **Method:** mutation probes (break implementation → expect RED → revert)  
**Scope:** plan §6 claims + shipped tranche work (PR #9 / #11): notification center model/gate, `attentionClass`, `pulse.blocked`, consumption aggregate, ledger removal, Findings card removal, health chip.  
**Rule:** a test that cannot fail when business logic changes is wrong. A **GREEN** row is a finding.

Mutations were applied to product code, tests run, then **immediately reverted**. Working tree product files match pre-audit state aside from concurrent in-flight edits owned by other lanes (`src/web/app.js` S3 context work; `src/server/snapshot.ts` sessionKind).

Verification of this deliverable (footer): `bunx tsc --noEmit` exit 0 · `bun run test:ci` **2632 pass / 0 fail**.

---

## Results — one row per §6 claim

| Claim | Test that should pin it | Mutation applied | Result |
|---|---|---|---|
| The header states no count of problems and links to none. | `tests/web-client.test.ts` — "the header states no count of problems: Findings is not in the catalog"; "the summary strip never grows its own findings ledger…"; `tests/ant-guide.test.ts` card labels | Reintroduce `needs-you` / Findings into `WIDGET_CATALOG` + `DEFAULT_WIDGET_IDS`; stub `renderPulseFindings` / `renderFindingRow` in `app.js` | **RED** |
| Every header number that could be partial says so. | `tests/web-client.test.ts` — BURN / cost unavailable; `tests/headless-render-verification.test.ts` — floor marker `≥` | Render `"$0.00 last hour"` when cost missing; drop `costIsFloor ? "≥$" : "$"` to always `"$"` | **RED** |
| The context reading describes the fleet, not one agent. | `tests/web-client.test.ts` FE-B context cells; `summaryWidgetData("context-peak")` | (Covered jointly with withhold row — average/median headline path exercised by 0% mutation) | **RED** (via withhold / omit tests) |
| A header with no context reports withholds rather than guesses. | `tests/web-client.test.ts` — "uses explicit No data…"; FE-B "(5a) a cell with nothing to report is omitted" | Return `{ value: "0%", … }` when average and median are absent | **RED** |
| Every live item names its kind, severity, source, lifecycle, evidence, impact, and a route. | `tests/web-client.test.ts` — "every live item names its kind…" | Omit `evidence` from `handoffItem` | **RED** |
| Every route resolves to a real drawer. | `tests/web-client.test.ts` — "every route resolves to a real drawer" | `handoffItem.route.kind = "handoff"` (not in `DRAWER_RENDERERS`) | **RED** |
| Nothing resolved, verified, or impact-free reaches the live surface. | `tests/harden-notify-fixtures.test.ts` §4.3 promotion table; `tests/web-client.test.ts` S1-T2 "resolved goes to history" | `hasCurrentImpact`: `resolved` → `return true` | **RED** |
| A parked lane that then asks something re-alerts. | `tests/harden-notify-fixtures.test.ts` "parked-then-asks precedence" *(was hollow)*; `tests/web-client.test.ts` "a lane that was stood down…" | Disable `declaredQuiet` veto in `attentionClassOf` (`if (false && declaredQuiet…)`) | **GREEN** on harden-notify parked suite · **RED** on web-client + promotion "declared done" |
| The badge is ember only when a person is the blocker. | `tests/web-client.test.ts` "the ember contract…"; `tests/notification-center-a11y.test.ts` ember badge; harden-notify matrix | Move `stalled-active` into `BLOCKING_KINDS` | **RED** |
| An out-of-page notification fires only for a person-blocker. | `tests/web-client.test.ts` "(4) an out-of-page notification never fires for a watcher-only board" | Same `stalled-active`→blocking mutation | **RED** |
| Permission is still requested from a click and never on load. | `tests/web-client.test.ts` "(4) permission is asked from a click and nowhere else" | Call `Notification.requestPermission()` inside `boot()` | **RED** |
| An unmeasurable duration is withheld, not zeroed. *(§10 R1: dead time dropped; `standbyMs` must not ship, including as `0`)* | `tests/pulse.test.ts` "pulse.blocked… publishes no dead-time field"; harden-notify `standby-unmeasurable` *(was hollow)* | Emit `standbyMs: 0` from `PulseTracker.report` | **RED** on pulse.test · **GREEN** on harden-notify standby fixture suite |
| A heartbeat cannot reset dead time. *(R1: handoff `since` permanently null; no per-row wait from write clocks)* | `tests/web-client.test.ts` "a handoff carries no dead time…"; harden-notify `heartbeat-churn` *(was hollow)* | `handoffItem.since = measuredSince(hookLifecycleAt \|\| updatedAt \|\| blockedSince)` | **RED** on web-client · **GREEN** on harden-notify heartbeat fixture suite |

### Suggested mutations (orchestrator list) — summary

| Suggested mutation | Result |
|---|---|
| `attentionClassOf` / kinds: `stalled-active` → `"blocking"` | **RED** (ember contract + out-of-page + matrix + a11y) |
| `hasCurrentImpact` true for lifecycle `"resolved"` | **RED** (promotion table + S1-T2) |
| `totals.consumption` falls back to occupancy `tokens.total` when the window or enumeration is unknown | **RED** (`tests/snapshot.test.ts` "fleet consumption stays absent…") — missing token terms instead publish a `sessionTotal` floor with same-population coverage |
| Notification route kind ∉ `DRAWER_RENDERERS` | **RED** |
| Reintroduce per-row wait from `hookLifecycleAt` (and peers) | **RED** (web-client walks every candidate clock — proven) |
| Emit `pulse.standbyMs` as `0` | **RED** (pulse.test) / **GREEN** (harden-notify standby fixture JSON-only) |

### Adjacent shipped claims (not §6 bullets, but in the program)

| Claim | Test | Mutation | Result |
|---|---|---|---|
| `pulse.blocked` counts person-blockers only | `tests/pulse.test.ts` | Count `noticed` as blocked | **RED** |
| Health chip qualifies instruments, not fleet all-clear | `tests/health-card.test.ts` | `"Readings healthy"` → `"All clear"` | **RED** |
| Fleet consumption is a `sessionTotal` floor with same-population coverage; absent only when the window or enumeration is unknown | `tests/snapshot.test.ts` | Missing terms → omit the floor/coverage, or unavailable scan → sum `tokens.total` | **RED** |

---

## GREEN findings — what was hollow, and the catch

### G1 · `parked-then-asks` fixture suite did not call `attentionClassOf`

- **Hollow behavior:** asserted `taskStateWantsHuman` (live) but compared `row.expect.attentionClass` to itself.
- **Mutation that stayed GREEN there:** disable `declaredQuiet` in `attentionClassOf`.
- **Catch:** `tests/harden-notify-hollowness-guards.test.ts` ("parked-then-asks — attentionClassOf must execute the fixture") and the strengthened loop in `tests/harden-notify-fixtures.test.ts`.

### G2 · `standby-unmeasurable` fixture suite never ran `PulseTracker`

- **Hollow behavior:** only checked fixture JSON flags (`presenceNotRequired`, `never: 0`).
- **Mutation that stayed GREEN there:** `standbyMs: 0` on the pulse report (pulse.test went RED; this suite did not).
- **Catch:** `tests/harden-notify-hollowness-guards.test.ts` ("standby-unmeasurable — PulseTracker must omit standbyMs").

### G3 · `heartbeat-churn` fixture suite never built a handoff item

- **Hollow behavior:** monotonicity over fixture `expect.deadTimeMs` / `blockedSince` strings; inert while the field is absent, and still inert for a live `since` regression.
- **Mutation that stayed GREEN there:** wire `handoffItem.since` from candidate write clocks (web-client dead-time test went RED; this suite did not).
- **Catch:** `tests/harden-notify-hollowness-guards.test.ts` ("heartbeat-churn — handoff.since must ignore every candidate clock").

Re-probed after writing the guards: applying G1+G2+G3 mutations together → **6 fail / 2 pass** in the new file, then reverted.

---

## How to re-run a probe

```bash
# example: stalled-active as blocking
# edit src/web/notification-center.js BLOCKING_KINDS / NOTICED_KINDS
bun test ./tests/web-client.test.ts ./tests/harden-notify-fixtures.test.ts ./tests/notification-center-a11y.test.ts
# revert the edit before any commit
```

Never leave a mutation in the tree. Prefer `git diff --stat` on the mutated paths after revert. Restore from a pre-mutation copy when other lanes have dirty edits in the same files — do not `git checkout --` over their work.

---

## Round 2 — header (S2-T1 / S2-T2 / S3 / A11Y-1)

**When:** after those landings merged to main. Same method: smallest false-making mutation → expect RED → revert.  
**Product files mutated and restored:** `src/web/client-catalogs.js`, `src/web/app.js`, `src/web/styles.css` (restored byte-identical to pre-probe copies).

| Claim | Test that should pin it | Mutation applied | Result |
|---|---|---|---|
| S2-T1 — Findings / `needs-you` stays out of the header catalog | `tests/web-client.test.ts` "the header states no count of problems…"; retired-card migration; `tests/ant-guide.test.ts` catalog parity | Put `needs-you` / Findings back in `WIDGET_CATALOG` + `DEFAULT_WIDGET_IDS`; clear `RETIRED_WIDGET_IDS` | **RED** |
| S2-T1 — the header never links | `tests/web-client.test.ts` "the summary strip never grows its own findings ledger…" (asserts `renderSummaryWidget` has no `selectEntity`, no `.reading-finding-link`) | Append a `<button class="reading-finding-link" onclick=selectEntity(…)>` inside `renderSummaryWidget` | **RED** |
| S2-T2 — health qualifies instruments, not the fleet | `tests/health-card.test.ts` "the chip qualifies the INSTRUMENTS…"; web-client health headline | `"Readings healthy"` → `"All clear"` | **RED** |
| S3 — context describes the fleet, not one agent | `tests/web-client.test.ts` FE-B "(8) CONTEXT PEAK reports the server's peak and median"; "(4b) the band reasons about the same context number" | Headline `peakPct` instead of average/median | **RED** |
| S3 — absent context withholds rather than guessing `0%` | `tests/web-client.test.ts` "uses explicit No data…"; FE-B "(5a) omitted"; "(8)" empty case | When average, median, and peak are all absent, return `{ value: "0%", … }` | **RED** |
| S3 — spread toggle preference persists (`CONTEXT_SPREAD_KEY`) | *(none — no test named the key)* | Drop `localStorage` get/set for `CONTEXT_SPREAD_KEY`; `loadContextSpread` always `"average"` | **GREEN** |
| A11Y-1 — panel does not clip at 420px | `tests/notification-center-a11y.test.ts` "A11Y-1: at narrow widths the panel FILLS its anchor…" | Revert `.masthead-signals` to `align-self: center` in the `@media (max-width: 760px)` block | **RED** on CSS-text assertion only |

### Orchestrator probe list — answers

| Probe | Result |
|---|---|
| Put `needs-you` back in `WIDGET_CATALOG` | **RED** — not "only deleted"; catalog + migration + ANT-GUIDE bite |
| `renderSummaryWidget` emits `<a>`/`<button>` → `selectEntity` | **RED** — "the header never links" is guarded in the strip source assertion |
| Health chip says `"All clear"` again | **RED** — health-card + headline weight tests |
| Headline `contextPeak` instead of average/median | **RED** — FE-B (8)/(4b) |
| Context card renders `"0%"` when all three readings absent | **RED** |
| Spread toggle non-persistent (drop `CONTEXT_SPREAD_KEY`) | **GREEN** — suite stayed 553 pass / 0 fail across web-client, a11y, health, ant-guide, headless |
| Revert `.masthead-signals` to `align-self: center` | **RED** on `/align-self:\s*stretch/` regex — **does not measure geometry** |

### GREEN / hollow findings this round

#### G4 · Context spread persistence was untested

- **Hollow behavior:** nothing in `tests/` referenced `CONTEXT_SPREAD_KEY`, `setItem`/`getItem` for it, or the spread toggle's write path.
- **Mutation that stayed GREEN:** remove persistence; preference resets every load.
- **Catch:** `tests/header-hollowness-guards.test.ts` — "CONTEXT_SPREAD_KEY is written on toggle and read on boot".

#### G5 · A11Y-1 regression test asserts CSS text, not on-screen fit

- **What the shipped test does:** regex on the narrow media block for `align-self: stretch`, `left: 0` / `right: 0` / `width: auto`, and absence of `100vw`.
- **What it does not do:** measure panel vs viewport geometry (no jsdom by policy; the file's own header says source assertions stand in for live measurement).
- **Important split:** reverting **only** `align-self` to `center` while keeping fill-anchor → CSS-text **RED**, but left overhang stays **0** (panel fills the narrower island; the original 24px clip was center **+** viewport-sized width). So a green CSS-text suite is not proof the panel fits, and a red `stretch` assertion is not proof clipping returned.
- **Catch:** `tests/header-hollowness-guards.test.ts` — pure layout model at 420px using the live-board numbers (372px island, 100vw panel → 24px left overhang); asserts the shipped strategy is stretch + fill-anchor + no viewport width + zero overhang. Re-probed: center-only fails stretch; viewport-width under stretch fails `panelFillsAnchor`; center+viewport model row expects overhang `24`.

---

## Footer

- Round 1 tests: `tests/harden-notify-hollowness-guards.test.ts`, parked loop in `tests/harden-notify-fixtures.test.ts`
- Round 2 tests: `tests/header-hollowness-guards.test.ts`
- This document: `docs/TEST-HOLLOWNESS-AUDIT.md`
- Round 2 verify: `bunx tsc --noEmit` exit 0 · `bun run test:ci` **2646 pass / 0 fail**.
