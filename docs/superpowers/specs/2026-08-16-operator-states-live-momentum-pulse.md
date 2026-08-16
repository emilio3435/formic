# Operator states, live ≠ waiting-forever, Momentum magnify, hide blind pulse chips

Repo: Formic (`the-ant-hill`). Branch from `main` in a fresh worktree. Not `the-mountain-production`.

GitHub: [#74](https://github.com/emilio3435/the-ant-hill/issues/74)

**Sibling (non-blocker, out of scope):** [#73](https://github.com/emilio3435/the-ant-hill/issues/73) — row primary text (F2). Open both from `main`. Merge #73 whenever. Do not spec or implement F2 here.

**Goal:** Five operator states with locked status dyes; a live predicate that excludes stalled zombies; Momentum as a CTA that magnifies needs-you rows; pulse chips that omit blind provenance instead of printing a dash or a fake number.

**Success means:** A later implementation PR lands F5 → F1+F4 → F3 as three stacked commits. After that PR, a 28h quiet waiting session is **Stalled** (not live, not amber), a session inside the stall window is **Waiting** (live, graphite), and the health rail never shows a cost or completions chip when provenance says the metric cannot be known.

**Stop when:** Spec + plan are merged. This planning PR changes **no** product behavior. Do not deploy.

**Implementation plan:** `docs/superpowers/plans/2026-08-16-operator-states-live-momentum-pulse.md`

---

## Why this exists

Waiting is doing four jobs today: calm pause, operator inbox, stalled zombie, and “still live.” `isLive` is `working || waiting`, so a session quiet for 28h still inflates `totals.live`, program rollups, burn denominators, and Momentum’s live-adjacent copy.

Momentum is already a CTA (operator decision 2026-08-06: the chip value is the needs-you count). It has no row effect. Unavailable pulse metrics still render as prose (“cost unavailable”, “Completions are not measured…”).

This issue is **F1 + F4 + F3 + F5**. One implementation PR, three commits, stacked. Do not land F3 on the old Waiting word.

---

## Locked decisions (do not reopen)

| Decision | Call |
|---|---|
| Public name | Formic. Repo stays `the-ant-hill`. Do not rename internals. |
| Operator states | Needs you · Working · Waiting · Stalled · Done |
| Status hues | Existing status tokens only. No sixth status hue. |
| Needs you | Amber (act) |
| Working | Blue / info (in flight). **Not green** — green is settled. |
| Waiting | Graphite, full opacity (alive, no ask, **inside** stall window) |
| Stalled | **Same graphite**, dimmer + age (past stall, no attention). Not amber, not a second red. |
| Done | Green (settled). If it still needs a read → needs-you, not done. |
| Red | Blocked / failed only (already in the rail). |
| Clay / indigo | Identity / interaction. Never status. |
| Waiting ≡ Stalled hue | On purpose. Distinguish with dim + age, not a new color. |
| Live (F4) | `working` OR needs-you OR waiting **inside** the stall window. |
| Not live | Stalled, finished, parked/declared-done, retained — even if `processAlive`. |
| `processAlive` | Process fact (meta). Never the live count. |
| Momentum (F3) | Keep the chip as the CTA. Magnify: needs-you rows lift; the rest recede. |
| Pulse (F5) | Omit chips whose provenance is `not-observable` or `unavailable`. No cost chip. No fake completions. **Omit — do not render a dash.** |
| Stall threshold | Reuse `AGENT_IDLE_GAP_MS` / `pulse.momentum.stallThresholdMs` (15 minutes). Do not invent a second clock. |
| Lifecycle wire | Keep `LifecycleState` as today (`working` \| `waiting` \| `unverified` \| `finished`). Stalled is an **operator derivation** over waiting + age, not a new wire enum in this PR. |
| Commit order | 1 F5 → 2 F1+F4 → 3 F3 |

---

## Verified current state (2026-08-16, tip `6658737`)

Hypothesis in the issue was mostly right. Corrections below are binding for implementers.

### Dual `isLive` (client vs server)

| Site | Predicate today | Notes |
|---|---|---|
| `src/web/agent-model.js` `isLive` | retained → false; lifecycle `working` \| `waiting` | **Not** `processAlive`. Bug is that `waiting` includes stalled zombies. |
| `src/server/pulse.ts` `isLive` (private) | retained → false; lifecycle `working` \| `waiting`, else activity `working` \| `idle` | Same zombie bug. Feeds burn coverage, activity buckets, stalled candidate pool, Cursor-unknown count. |
| `src/server/snapshot-programs.ts` `rollupFor` | activity `working` \| `idle` | **Third** spelling. No lifecycle read. |
| `src/server/snapshot.ts` `totals.live` | observed ∧ activity `working` \| `idle` | Same as rollup. |
| `src/server/state.ts` cmux-close totals refresh | same activity pair | Must stay in lockstep with snapshot.ts. |

Client and server already agree that live ≠ processAlive. They disagree with each other on **field** (lifecycle vs activity) and all of them treat every waiting/idle row as live.

### Stall already exists (server only)

- `AGENT_IDLE_GAP_MS = 15 * 60_000` in `src/server/types.ts`
- `STALL_THRESHOLD_MS = AGENT_IDLE_GAP_MS` in `src/server/pulse.ts`
- Published as `pulse.momentum.stallThresholdMs` / `stalled` / `stalledAgentIds`
- Stalled filter today (on **live** agents): not turn-complete provenance, no attention / attentionSignal, outcome healthy, `now - updatedAt >= threshold`
- Turn-complete quiet sessions are **excluded** from stalled (waiting on the operator by design)

The client has **no** `isStalled` helper. Row copy cannot say “Stalled”; Momentum only prints a stall count in a sublabel.

### Provenance already honest; UI still paints

- `pulse.momentum.completionsProvenance: "not-observable"` always; `completionsLastHour: null`
- `pulse.burn.costProvenance: "burnbar" | "unavailable"`
- `summaryWidgetData("momentum")` still returns a chip; sublabel explains completions are not measured
- `summaryWidgetData("burn")` still returns a chip; cost clause can read `"cost unavailable"`
- Health-rail v2 already uses `—` for some repo-scoped gaps — F5 forbids that pattern for blind provenance chips

### Existing predicates (keep; compose with F1/F4)

| Predicate | Meaning | Load-bearing uses |
|---|---|---|
| `wantsHuman(agent)` | Task/hook says human needed, and not terminal | Strip, Momentum CTA count, alerting arm |
| `declaredQuiet(agent)` | `taskState` parked\|done and no newer needsInput | Suppresses alerting |
| `declaredDone(agent)` | `taskState === "done"` and no newer needsInput | Drops from Board via `viewMatches` (`observed` requires `!declaredDone`) |
| `alerting(agent)` | wantsHuman ∨ (unhealthy non-terminal) ∨ (terminal + process running rescue) | Needs-you strip, board rescue, notifier |
| `isTerminal(agent)` | lifecycle finished ∨ scope retained | History, control stripping |
| `lifecycleOf` / server `lifecycle` | working / waiting / unverified / finished | Sections, isLive today |
| `processAlive` / `processState` | Process meta | alerting rescue arm; liveness chips; **never** live |
| Pulse stalled set | Age past threshold among “live” healthy quiet agents | Momentum sublabel only today |

`alerting`’s terminal + `livenessState === "running"` rescue “retires with schemaVersion 2” (`agent-model.js`). Schema on the wire is still `schemaVersion: 1`. Do not remove the rescue in this work; do not let stalled zombies ride that arm into amber.

### Board membership today

`viewMatches("board")` =

```
(observed && !declaredDone && (working || waiting || unverified)) || alerting(agent)
```

So every waiting row — including 28h zombies — stays on the Board. `viewMatches("idle")` is waiting|unverified. Landing roster / live counts read `isLive` / `totals.live`.

### Dyes today (must change in commit 2)

| Token / class | Today | Locked target |
|---|---|---|
| `--working` | `var(--moss)` **green** | Blue / `--color-status-info` (`--slate`) |
| `--idle` (Waiting) | `var(--slate)` blue | Graphite (`--gray-500` / `--ended-ink` family), full |
| Stalled | *(none)* | Same graphite, dimmer + age |
| `--needs` | `var(--ember)` **red** | Amber / `--color-status-warning` |
| Done / settled | moss via ended/healthy paths | Green / `--color-status-success` |
| Blocked / failed | ember / danger | Unchanged red |
| Clay / indigo | brand / interactive | Untouched |

`DESIGN-LANGUAGE.md` still groups “Waiting, needs-you…” under warning amber. **Product overrides that for Waiting/Stalled → graphite** and for Working → blue. Update the design-language status table in the implementation PR (commit 2), not this planning PR’s optional scope — call it out in the plan so the implementer does not leave the doc lying.

`OUTCOME_LABELS["needs-you"]` is currently `"Alert"`. Operator language is **Needs you**. Commit 2 may retitle the word where `rowStateWords` / strip labels speak to humans; do not churn every historical “Alert” string in tests unless the surface is operator-visible.

### Momentum CTA today

`summaryWidgetData("momentum")` value = count of `stripAlerting` agents; unit “needs you” / “need you”. Sublabel carries working count + stall text + (sometimes) completion window prose. F3 adds row magnify only; it does not reopen the CTA number.

---

## Operator state model (F1)

One state per row for status ink + status word. Precedence (first match wins):

1. **Needs you** — `alerting(agent)` after ack/mute presentation rules already used by the strip (`stripAlerting` / alertMuted). Amber. Act.
2. **Done** — `declaredDone(agent)` OR (terminal ∧ healthy ∧ not alerting). Green. Settled. A done lane that asks again is needs-you via the existing hook-newer escape.
3. **Working** — lifecycle `working` (observed). Blue.
4. **Stalled** — observed, lifecycle `waiting`, not needs-you, and quiet past `stallThresholdMs`, using the **same exclusions** as `pulse.ts` (no turn-complete-as-stalled; no attentionSignal). Graphite dim + age.
5. **Waiting** — observed, lifecycle `waiting`, not needs-you, quiet **inside** the stall window (or turn-complete waiting on the operator). Graphite full.

Unverified stays its own evidence band (dashed / `--unverified`). It is not one of the five operator states and is not live. Blocked/failed stay red outcome marks on top of / instead of calm activity ink — red is not a sixth operator state; it is already the rail’s break language.

### Words

| State | Status word |
|---|---|
| Needs you | Needs you |
| Working | Working |
| Waiting | Waiting |
| Stalled | Stalled |
| Done | Done |

`rowStateWords` must emit these. Do not leave a stalled zombie printing only “Waiting”.

### Class names (F3 depends on these)

Ship stable, literal class names (styles.css orphan lint reads source text):

- Row / state: `is-needs-you` (keep), `is-working` or retain `act-working`, `is-waiting` / `act-idle` mapped to waiting, **`is-stalled` (new)**, `is-done` (new or map from declared-done / ended healthy)
- Magnify (commit 3): `is-momentum-hot` on needs-you rows while Momentum CTA is armed; `is-momentum-recede` on sibling rows in the same paint

Exact spelling is fixed in the implementation plan; commit 3 must not invent a second vocabulary.

---

## Live predicate (F4)

### Definition

```
isLive(agent) ≡
  scope ≠ retained
  ∧ not declaredDone(agent)
  ∧ (
      lifecycle === "working"
      ∨ alerting(agent)          // needs-you is live work
      ∨ (lifecycle === "waiting" ∧ not isStalled(agent))
    )
```

`isStalled` is the shared helper (client + server) matching pulse’s stalled rules, keyed off `updatedAt` and `stallThresholdMs` (default `AGENT_IDLE_GAP_MS` when pulse has not spoken yet).

`processAlive === true` alone never makes a row live.

### What must consume the new predicate

| Consumer | Today | After |
|---|---|---|
| Client `isLive` | waiting ⊆ live | stall-aware |
| Client `deriveRollup().live` | via `isLive` | follows |
| Server `pulse.ts` `isLive` | waiting ⊆ live | stall-aware (one shared rule with client) |
| `rollupFor().live` | activity working\|idle | stall-aware live (prefer lifecycle + shared helper; keep wire field name `live`) |
| `snapshot.ts` / `state.ts` `totals.live` | activity working\|idle | same helper |
| TL;DR meta “N live” | `totals.live` | follows |
| Burn coverage live filter | pulse `isLive` | follows (stalled drop out of live burn denominator) |

### Invariant rewrite

Today’s tests assert `working + idle === live` (`tests/relations-reach-their-boundary.test.ts`, `tests/magnitude-bounds.test.ts`). That equality is **false** under F4 once stalled ⊆ idle/waiting.

New invariant (document in code comments + tests):

```
live ⊆ working ∪ waiting_fresh ∪ needs_you
stalled ∩ live = ∅
processAlive is orthogonal to live
```

Wire rollup fields `idle` / `working` keep their names (schema-2 job to rename idle→waiting). `live` changes meaning; callers that assumed `live === working + idle` must be updated in commit 2.

### Board membership (`viewMatches`)

**Keep stalled rows on the Board.** Operator states are useless if zombies vanish with no shelf.

What changes:

- Any membership or count that means “live fleet” must call `isLive`, not raw `lifecycle === "waiting"`.
- `viewMatches("board")` continues to include observed waiting **including stalled**, plus working, unverified, and `alerting` rescue — so stalled stays visible and dyeable.
- Optional later filter “hide stalled” is out of scope.

If an implementer “fixes” live by dropping stalled from `viewMatches("board")`, that is a **spec violation** unless a destination view is added in the same commit (not requested).

Parked / declared-done already leave Board via `!declaredDone`. Finished stay in History. Unchanged.

### What would break if live is redefined carelessly

- **Burn / token coverage** — liveAgents shrinks; reporting/eligible/unknown shift. Update pulse tests with an explicit stalled fixture that leaves the live set.
- **Program rollup “N live”** and masthead vitals — expect lower numbers; fixtures that used quiet idle as live must be restated.
- **`working + idle === live`** equality tests — must be rewritten, not deleted without replacement.
- **Momentum stall sublabel vs live** — today stalled ⊆ liveAgents; after F4, stalled is computed from waiting candidates then excluded from live. Order of filters in `pulse.report` must not count stalled as live and then also list them as stalled-from-live (rewrite the pipeline: derive stalled from waiting pool, then `live = working ∪ needs-you ∪ waiting\stalled`).
- **alerting rescue** — a terminal process-still-running ask remains live via needs-you; a healthy stalled zombie must not.
- **schemaVersion 2 comment** — do not conflate removing the rescue arm with this live fix.

---

## Momentum magnify (F3)

Depends on commit 2 class names.

- Keep Momentum chip as CTA (needs-you count). Do not revert to completions-as-value.
- When the operator focuses / activates Momentum (exact trigger: click or persistent “armed” state — plan picks the smallest hook; default = while the Momentum reading is the interaction target or a short-lived arm on click), needs-you rows get `is-momentum-hot` (lift: contrast, rail, or scale within existing motion budget); other Board rows get `is-momentum-recede` (opacity / de-emphasis).
- Later the same trick can follow whatever Momentum is counting — do not hard-code magnify only to `stripAlerting` if a shared `momentumPopulation(agent)` helper is cheap; default population is needs-you.
- No new status hue. No clay/indigo for magnify.

---

## Pulse chip omission (F5)

| Reading | Provenance gate | Behavior |
|---|---|---|
| Completions | `completionsProvenance === "not-observable"` (always today) | Do not render a completions number or “not measured” filler chip. Momentum CTA (needs-you) remains. |
| Cost | `costProvenance === "unavailable"` | Omit the cost chip / cost clause entirely. No `"cost unavailable"`, no `$0`, no `—`. |
| Token rate | measured `tokensPerMin` | May remain on Burn when present. |
| Fake completions | `completionsLastHour === null` | Never coerce to 0 for display. |

“Omit the chip” means: do not mount a reading cell whose only content is the blind metric. If Burn still has a token rate, keep Burn with rate only. If a widget would be entirely blind, skip that widget id in the paint for this snapshot (grid closes the gap — no empty dashed tile).

---

## Out of scope

- #73 row primary text (F2)
- Renaming wire `idle` → `waiting` (schema 2)
- Removing `alerting` process-running rescue (schema 2)
- New lifecycle enum value `"stalled"`
- Context window copy
- Deploy / production worktree
- Clay/indigo repurposing; sixth status hue

---

## Acceptance (for the later implementation PR)

1. A waiting session with `updatedAt` 28h ago, healthy, no attention → status word **Stalled**, graphite dim, **`isLive` false**, still on Board, not amber/red.
2. Same shape with `updatedAt` 5 minutes ago → **Waiting**, graphite full, **`isLive` true**.
3. Needs-you → amber, live, Momentum CTA count includes it; magnify lifts it (commit 3).
4. Working → blue (not green); Done/settled → green.
5. `costProvenance: "unavailable"` → no cost chip and no dash placeholder.
6. Completions never render as a number; no “not measured” chip.
7. `processAlive: true` on a stalled or finished row does not enter `totals.live`.
8. Client `isLive`, pulse `isLive`, `rollupFor.live`, and `totals.live` agree on fixtures.
9. #73 untouched.

---

## Risks (call out)

1. **Dual `isLive`** — client module vs server pulse private function vs activity-based rollup/totals. Commit 2 must converge all three (shared predicate or mirrored helpers with identical tests).
2. **Board membership** — do not eject stalled from Board while “fixing” live.
3. **`alerting()` rescue** — orthogonal; leave schemaVersion-2 comment intact.
4. **Invariant tests** — `working + idle === live` will go red on purpose; replace with stall-aware relations.
5. **DESIGN-LANGUAGE.md** — Waiting→graphite and Working→blue contradict the current status table; update in the implementation PR.
6. **`--needs` is red today** — remapping to amber changes row alert ink; blocked/failed must stay danger.
7. **F3 before F1** — forbidden. Magnify needs `is-stalled` / needs-you class vocabulary from commit 2.
