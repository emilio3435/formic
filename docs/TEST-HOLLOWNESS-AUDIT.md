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
bun test tests/web-client.test.ts tests/harden-notify-fixtures.test.ts tests/notification-center-a11y.test.ts
# revert the edit before any commit
```

Never leave a mutation in the tree. Prefer `git diff --stat` on the mutated paths after revert.

---

## Footer

- New / updated tests: `tests/harden-notify-hollowness-guards.test.ts`, parked loop in `tests/harden-notify-fixtures.test.ts`
- This document: `docs/TEST-HOLLOWNESS-AUDIT.md`
- A11y sweep remains held (not started by this audit).
