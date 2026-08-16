# Operator states / live / Momentum / pulse chips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land [#74](https://github.com/emilio3435/the-ant-hill/issues/74) as **one PR, three stacked commits**: F5 chip omission → F1+F4 operator states + live predicate → F3 Momentum magnify.

**Spec (binding):** `docs/superpowers/specs/2026-08-16-operator-states-live-momentum-pulse.md`

**Sibling:** [#73](https://github.com/emilio3435/the-ant-hill/issues/73) (row primary text) is a non-blocker. Do not implement it in this PR.

**Architecture:** Keep `LifecycleState` on the wire. Add shared stall/live helpers on client and server that mirror `pulse.ts`’s stall rules. Remap status dyes to the locked table. Omit blind pulse readings in the health-rail paint. Momentum CTA stays; magnify is CSS + a small arm in `app.js` after class names exist.

**Tech Stack:** Bun + TypeScript (server), vanilla ES modules (web), bun:test. No new dependencies.

**Branch:** cut from `main` in a fresh worktree. Not `the-mountain-production`. Local commits only until the implementation PR is opened.

---

## Global constraints

- **Docs said, spec holds.** Do not reopen dyes, live, or commit order.
- **Three commits, this order only:**
  1. F5 — omit unavailable / not-observable chips (no dependency)
  2. F1 + F4 — operator states + dyes + live predicate (one commit)
  3. F3 — Momentum magnify (depends on commit 2 class names)
- **Do not land F3 on the old Waiting word.**
- Clay / indigo never become status. No sixth status hue. Waiting and Stalled share graphite.
- `processAlive` never feeds `isLive` / `totals.live`.
- Stalled rows **stay on Board**; they leave the live count only.
- Path-scoped commits (`git commit -m … -- <paths>`). Forward-only. No amend of shared tips.
- Gate per commit: `bunx tsc --noEmit` clean; `bun test` at parity with `main` aside from intentional invariant rewrites in commit 2.
- Do not deploy.

## Repository anchors (verified 2026-08-16 at `main` tip `6658737`)

| Surface | Anchor |
|---|---|
| Client live | `src/web/agent-model.js` `isLive` ~72–76; `deriveRollup` ~395–418; `viewMatches` ~430–461; `alerting` ~371–382 |
| Client words | `src/web/app.js` `rowStateWords` ~9400–9414; row classes ~9876–8902; `ACTIVITY_LABELS` / `OUTCOME_LABELS` in `src/web/client-catalogs.js` |
| Momentum CTA | `src/web/app.js` `summaryWidgetData("momentum")` ~1135–1173; burn ~1175–1267; `renderSummaryWidget` ~2817+ |
| Health rail | `renderHealthRail` / readings stack (same file; health-rail-v2 tests) |
| Dyes | `src/web/styles.css` `:root` `--working/--idle/--needs` ~48–59; `.act-*` ~2021–2030 |
| Tokens | `src/web/formic-tokens.css` status + gray scale; `DESIGN-LANGUAGE.md` status table |
| Server pulse | `src/server/pulse.ts` private `isLive` ~21–25; `STALL_THRESHOLD_MS` ~29; stalled filter ~213–223; momentum provenance ~243–250; cost provenance ~234–236 |
| Stall clock | `src/server/types.ts` `AGENT_IDLE_GAP_MS` ~227 |
| Rollup / totals | `src/server/snapshot-programs.ts` `rollupFor` ~48–72; `src/server/snapshot.ts` ~716–868; `src/server/state.ts` ~611–627 |
| Tests | `tests/health-rail-v2.test.ts`, `tests/pulse.test.ts`, `tests/lifecycle.test.ts`, `tests/process-liveness.test.ts`, `tests/snapshot.test.ts`, `tests/web-client.test.ts` (viewMatches / rollup / momentum), `tests/relations-reach-their-boundary.test.ts`, `tests/magnitude-bounds.test.ts` |

---

## Commit map

| Commit | Title (suggested) | Owns |
|---|---|---|
| 1 · F5 | `fix(pulse): omit blind cost and completions chips` | `src/web/app.js` (widget paint / summaryWidgetData only as needed), `tests/health-rail-v2.test.ts`, maybe `tests/web-client.test.ts` momentum/burn assertions |
| 2 · F1+F4 | `feat(board): operator states, stall-aware live, status dyes` | `agent-model.js`, `app.js` (`rowStateWords` + row classes), `styles.css`, `client-catalogs.js` (labels), `pulse.ts`, `snapshot-programs.ts`, `snapshot.ts`, `state.ts`, `DESIGN-LANGUAGE.md` status rows, lifecycle/pulse/snapshot/web-client/relations/magnitude tests |
| 3 · F3 | `feat(web): Momentum magnify lifts needs-you rows` | `app.js` (arm + class toggle), `styles.css` (lift/recede), focused web/health-rail tests |

---

### Task 0: Worktree + baseline

**Files:** none.

- [ ] **Step 1:** Fresh worktree from `main`; branch e.g. `feat/operator-states-74`.
- [ ] **Step 2:** Record baseline: `bunx tsc --noEmit && bun test 2>&1 | tail -5`.
- [ ] **Step 3:** Re-read the spec. Confirm #73 will not be touched (`git grep -n rowSummary` only if needed for awareness — no edits).

---

## Commit 1 — F5: omit unavailable chips

### Intent

When provenance is `not-observable` or `unavailable`, **do not mount** that reading. No dash. No `"cost unavailable"`. No fake completions. Momentum CTA (needs-you count) stays.

### Files

- Modify: `src/web/app.js` — `summaryWidgetData`, `renderSummaryWidget` / health-rail readings assembly (whichever currently forces a cell to exist)
- Test: `tests/health-rail-v2.test.ts`; adjust `tests/web-client.test.ts` only where it asserts the old unavailable copy

### Steps

- [ ] **Step 1: Failing tests**

  - Burn with `costProvenance: "unavailable"` and a present `tokensPerMin`: cell must **not** contain `cost unavailable`, `—` as cost placeholder, or `$0`.
  - Burn with unavailable cost **and** null `tokensPerMin`: Burn widget/chip is **omitted** from the painted readings (grid has no empty burn tile), or summary API returns a sentinel the painter skips — pick one mechanism and test the DOM outcome.
  - Momentum: with `completionsProvenance: "not-observable"` and `completionsLastHour: null`, painted Momentum must still show the needs-you CTA value, must **not** show a completions count, and must **not** show a dedicated “Completions are not measured” chip/tile. Stall/working sublabel facts may remain.

- [ ] **Step 2: Implement omission**

  - Prefer skipping widget mount over rendering `noDataWidget` for provenance-blind metrics.
  - Keep token rate on Burn when measured.
  - Do not change `pulse.ts` provenance publishers (already correct).

- [ ] **Step 3: Gate + commit**

```bash
bunx tsc --noEmit && bun test tests/health-rail-v2.test.ts tests/web-client.test.ts
git add -p  # app.js + tests only
git commit -m "$(cat <<'EOF'
fix(pulse): omit blind cost and completions chips

Health-rail readings with not-observable or unavailable provenance
are skipped entirely — no dash, no fake $0, no completions filler.
Momentum keeps its needs-you CTA.

EOF
)"
```

---

## Commit 2 — F1 + F4: states, dyes, live predicate

### Intent

Five operator states with locked dyes. Shared stall-aware `isLive`. Server rollup/totals/pulse converge. Board still lists stalled rows. Status words match the table.

### Shared helpers (add)

**Client** (`src/web/agent-model.js`):

```js
// Names are suggestions; keep them exported and tested.
export function stallThresholdMs(snapOrPulse) { /* pulse.momentum.stallThresholdMs ?? 15*60_000 */ }
export function isStalled(agent, nowMs, thresholdMs) { /* mirror pulse.ts exclusions */ }
export function operatorState(agent, nowMs, thresholdMs) { /* precedence in spec */ }
export function isLive(agent, nowMs?, thresholdMs?) { /* F4 definition */ }
```

**Server:** either

- extract a tiny shared pure helper used by `pulse.ts` + `rollupFor` + snapshot totals, or
- duplicate the predicate in `pulse.ts` and `snapshot-programs.ts` with **identical** unit tests on both sides.

Prefer one server module (e.g. extend `src/server/lifecycle.ts` or a small `src/server/live.ts`) so pulse and totals cannot drift.

`isStalled` must match today’s pulse rules:

- candidate is waiting/idle (not working, not finished/retained)
- not turn-complete / turn-complete-aged as stalled
- no `attention` / `attentionSignal`
- outcome healthy
- `now - updatedAt >= threshold`

Then: **stalled is excluded from live**; stalled is still Board-visible.

### Live pipeline in `pulse.report` (rewrite carefully)

Today: `liveAgents = filter(isLive)` then stalled ⊆ liveAgents.

After:

1. Collect observed non-done agents.
2. Compute `stalledAgentIds` from the waiting/idle healthy quiet pool.
3. `liveAgents = working ∪ alerting/needs-you ∪ (waiting \ stalled)`.

Do not filter stalled from an already-wrong live set.

### Dyes (`styles.css` + tokens)

| Token | Set to |
|---|---|
| `--working` | `var(--color-status-info)` / `--slate` (blue) |
| `--idle` (Waiting) | graphite (`var(--gray-500)` / `--ended-ink`) full |
| `.is-stalled` / `.act-stalled` | same graphite, lower opacity; age remains in existing quiet/ago UI |
| `--needs` | `var(--amber)` / `--color-status-warning` (**not** ember) |
| Done / settled green | keep moss / `--color-status-success` |
| Blocked/failed | keep danger / ember |

Update `DESIGN-LANGUAGE.md` status table rows so Waiting/Stalled → graphite and Working → info blue; needs-you → warning amber; do not steal clay/indigo.

### `rowStateWords` + row classes

- Emit Waiting vs Stalled vs Needs you vs Working vs Done per `operatorState`.
- Add literal classes `is-stalled` (and `is-done` if needed) as source text for the orphan lint.
- Retain `is-needs-you` / `is-alerting` semantics already used by strip/float.

### `viewMatches`

- **Do not** remove stalled from `"board"`.
- Route any “is this live work?” check through `isLive`.
- `"idle"` may continue to mean waiting|unverified including stalled (operator can still find them); document that idle lens ≠ live.

### `alerting` / schemaVersion 2

- Leave the terminal + running rescue arm and its schemaVersion 2 comment alone.
- Ensure `isStalled` never classifies an alerting row as stalled (precedence: needs-you first).

### Tests to add/update

| File | What |
|---|---|
| New preferred: `tests/operator-live.test.ts` (or extend agent-model coverage in `web-client`) | Matrix: working→live; fresh waiting→live; 28h waiting→stalled∧¬live; needs-you→live; declaredDone→¬live; processAlive stalled→¬live; processAlive finished→¬live |
| `tests/pulse.test.ts` | Stalled fixture leaves `live` population; still listed in `stalledAgentIds`; turn-complete long quiet still not stalled |
| `tests/snapshot.test.ts` / rollup | `rollup.live` matches stall-aware rule; idle count can still include stalled |
| `tests/relations-reach-their-boundary.test.ts` | Replace `working + idle === live` with stall-aware relation(s) |
| `tests/magnitude-bounds.test.ts` | Same — `live === working + idle` is retired |
| `tests/web-client.test.ts` | `viewMatches("board")` true for stalled; `isLive` false; `rowStateWords` / status class asserts Stalled |
| `tests/lifecycle.test.ts` | Only if helpers live next to lifecycle; do not change classifyLifecycle waiting band |
| `tests/health-rail-v2.test.ts` | Meta “N live” drops stalled; dye/class smoke if cheap |
| `tests/process-liveness.test.ts` | No change required unless a false coupling appears — processAlive remains orthogonal |

### Steps

- [ ] **Step 1:** Write the live/stalled matrix tests (red).
- [ ] **Step 2:** Implement server helper + wire pulse, `rollupFor`, `snapshot.ts`, `state.ts`.
- [ ] **Step 3:** Implement client `isStalled` / `operatorState` / `isLive`; update `deriveRollup`, keep Board membership.
- [ ] **Step 4:** `rowStateWords` + row classes + CSS dyes + design-language status rows.
- [ ] **Step 5:** Fix invariant tests; run full gate.
- [ ] **Step 6:** Commit

```bash
git commit -m "$(cat <<'EOF'
feat(board): operator states, stall-aware live, status dyes

Waiting inside the stall window stays live and graphite; past-stall
zombies are Stalled (same hue, dimmer) and leave the live count without
leaving the Board. Working is blue; needs-you is amber; done is green.
processAlive stays meta.

EOF
)"
```

---

## Commit 3 — F3: Momentum magnify

### Intent

Momentum chip remains the CTA. Activating it magnifies needs-you rows and recedes the rest. Depends on commit 2 classes (`is-needs-you` / strip alerting marks / `is-stalled`).

### Files

- `src/web/app.js` — arm Momentum (click on the Momentum reading toggles a short-lived or sticky `state.momentumMagnify` flag); on Board paint, add `is-momentum-hot` to needs-you rows and `is-momentum-recede` to other visible rows when armed
- `src/web/styles.css` — lift / recede (opacity, contrast, optional translate); respect reduced-motion
- Tests: health-rail or web-client — arming adds classes; disarming clears; stalled/working rows recede; needs-you lifts

### Steps

- [ ] **Step 1:** Failing test: with magnify armed and a mixed fixture, needs-you row has `is-momentum-hot`, non-needs-you has `is-momentum-recede`.
- [ ] **Step 2:** Implement flag + class wiring. Population helper defaults to `stripAlerting` / needs-you so a future Momentum count can reuse it.
- [ ] **Step 3:** CSS only — no new hues.
- [ ] **Step 4:** Gate + commit

```bash
git commit -m "$(cat <<'EOF'
feat(web): Momentum magnify lifts needs-you rows

The Momentum CTA keeps its needs-you count and now magnifies matching
rows while the rest of the Board recedes.

EOF
)"
```

---

## Risks checklist (implementer)

- [ ] Client `isLive` and server pulse/totals/rollup agree on one fixture file.
- [ ] Stalled still `viewMatches("board") === true`.
- [ ] `alerting` rescue arm untouched; schemaVersion still 1.
- [ ] `working + idle === live` tests rewritten, not silently deleted.
- [ ] `--needs` no longer red; blocked/failed still danger.
- [ ] `--working` no longer green; Done/settled still green.
- [ ] F5 has no `—` placeholder for blind cost/completions.
- [ ] Commit 3 is not squashed ahead of commit 2.
- [ ] #73 / `rowSummary` untouched.

---

## Done when

- Implementation PR open against `main` with exactly the three-commit stack (or an equivalent history that preserves the order and separations).
- Spec acceptance items 1–9 green.
- No deploy.
