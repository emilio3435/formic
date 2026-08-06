# Confidence Header + Notification Center — one reconciled plan

> **Status: RATIFIED 2026-08-05 20:30 — in execution. §9 ambiguities closed by the orchestrator; §10 carries live status, the landed base, and the S0 hold.**
> **Supersedes/absorbs:** `2026-08-05-notifications-dropdown.md` (its T1–T9 appear here as S0/S1 tasks).
> **Baseline:** working tree at `f3e044a`, branch `fix/cmux-control-health-lifecycle`. Line numbers below are **anchors as of this commit**; the worktree is shared and concurrently edited, so every lane re-reads the symbol before editing and never trusts a line number alone.
> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task, checkbox tracking. Shared-worktree conventions: path-scoped `git add` (never `-A`), re-run `git branch --show-current` before any git action, docs parity in the same commit, `launchctl kickstart -k gui/$UID/ai.imaginethat.anthill` to restart, assert the literal `0 fail` line before any deploy.

---

## 1. The thesis this reconciles to

Two surfaces, one rule, stated so a reviewer can falsify it:

- **The header is confidence.** Continuous, measured quantities about the fleet, each carrying its own provenance. It answers *"can I trust this board, and what is this costing me."* Nothing in it is a to-do.
- **The notification center is attention.** Discrete, actionable items, each carrying kind, severity, exact source, lifecycle, plain-English evidence, impact, and a route. It answers *"what needs me, and why."*

**The seam, in one line: the header never links, and the notification center never aggregates.**

Everything below follows from that. The Findings count is a *count of to-dos rendered as a metric* — it belongs to attention, not confidence, and the finding links a concurrent lane just added to `.reading-sub` (uncommitted, `styles.css:409-426`, `app.js` renderSummaryWidget) are the header reaching into attention's job. The Peak context reading is the same category error in the other direction: a single agent's extremum presented as a fleet reading.

---

## 2. What the wire already gives us (measured, this commit)

Read this before estimating. Four findings; two shrink the work, two constrain it.

| Need | Field | Status |
|---|---|---|
| Agents running | `totals.working` | ✅ on the wire |
| Token burn | `pulse.burn.tokensPerMin`, `.windowMs`, `.coverage{reporting,eligible,unknown}` | ✅ |
| Measured cost + provenance | `pulse.burn.costLastHourUsd`, `.costProvenance:"burnbar"\|"unavailable"`, `.costIsFloor`, `.costAsOf`, `.costNote` | ✅ provenance already modelled |
| Context median/average/coverage | `snap.contextMedian`, `.contextAverage`, `.contextPeak`, `.contextReporting`, `.contextEligible` | ✅ all three readings + coverage published from **one** population (`types.ts:721-732`) |
| Blocked-vs-noticed split | `AttentionSignalKind` (`attention-signal.ts:39-61`) | ✅ partition already computed; needs a **name** on the wire, not new detection |
| Evidence sentence for an item | `attentionSignal.evidence` ("the sentence a match sits in"), `lastAgentClosing` (attributed by construction) | ✅ likely a render, not a feature — confirm in S0-T4 |
| Impact line | `issueImpactLine()` `app.js:3303`, `affectedImpact()` `app.js:6241` | ✅ exists |
| Route to inspector | `selectEntity({kind,id})` `app.js:5879` → `DRAWER_RENDERERS` `app.js:6115` (`agent \| intervention \| advisory \| investigation \| resolved \| program`) | ✅ every route the center needs already has a drawer |
| **Ship rate / completions** | `pulse.momentum.completionsLastHour: number \| null` with `completionsProvenance: "not-observable"` | 🔴 **permanently null by design.** See Ambiguity A1. |
| **Dead time per stopped agent** | `hookLifecycleAt` derived from the hook record's `updatedAt` (`collectors.ts:1123`) — a **write** time | 🔴 may be a heartbeat. See S0-T1. |

The two red rows are the plan's real risk. Everything else is composition.

---

## 3. Stage plan

Migration order is chosen so **no window exists where a finding is unreachable**. The center ships and is verified *before* the header stops linking.

### S0 — Wire truth (be-dwell) · gates S2 numbers, not S1 structure

- **S0-T1 · Measure `hookLifecycleAt` before anything renders it.** No code first: sample every session in `hookLifecycle:"needsInput"` across ≥3 collector passes ≥60s apart; post the raw table in the lane. If it advances while the state holds, it is a heartbeat. Deliver **`blockedSince?: string`** — the instant the session entered its current person-blocked state, stable across passes, persisted across a server bounce. **Absent when unmeasurable; never `updatedAt`, never `0`.**
- **S0-T2 · Name the partition.** `attentionClass?: "blocking" | "noticed"` beside `attentionSignal`. `blocking` = permission-requested, input-requested, fork-unresolved, handoff-stated, question-pending, assumption-stated. `noticed` = stalled-active. `nothing-wanted` / `out-of-scope` / `not-readable` ⇒ **no class at all** (absence, not a third value). A `parked`/`done` declaration never yields `blocking`; the atlas-hardening T6/T7 precedence is read, never reopened.
- **S0-T3 · Fleet counters.** `pulse.blocked` (count) and `pulse.standbyMs` (sum). **`standbyMs` absent — not partial — when any blocking agent lacks `blockedSince`.** A count is honest when a duration is not.
- **S0-T4 · Confirm the evidence sentence.** Measure whether `attentionSignal.evidence` is the *ask* for blocking kinds; compare to `lastAgentClosing`. **If sufficient, ship nothing.** Only add a bounded `blockedAsk?: string` if measurement forces it.
- **S0-T5 · A real fleet token total (new, per Emilio).** ⚠ `totals.tokens` **cannot** serve this. `snapshot.ts:614-617` sums `agent.tokens.total` over **working agents only**, and `tokens.total` is documented (`types.ts:161-162`) as *"Latest call's prompt+completion size, cache reads INCLUDED. Occupancy."* Summing an occupancy across agents and labelling it total usage is exactly the defect `types.ts:142-158` was written to prevent — the one that put 394M tokens on a single session against a 1M window.
  Ship a new, named aggregate: **consumption** — Σ `sessionTotal` over every session in the scan window, each token counted once. Chosen because it is the figure that pairs with the Cost reading beside it and answers "what did this cost." **Processed** (`sessionProcessed`, cache re-reads included — the only figure comparable to BurnBar's own store, typically 2.6–16.9× larger) and **cache re-reads** (`sessionCachedInput`) stay reachable in the drawer and must never be folded into this number. The card says "consumed"; it does **not** carry a window tag (see §4.1).

### S1 — Notification center at parity (fe-notify) · nothing removed yet

- **S1-T1 · `src/web/notification-center.js` (NEW file, sole writer fe-notify).** Pure derivation `notificationFeed(snap, queueItems, now)` → `NotificationItem[]`, mirroring how `pulseStripModel` keeps model and renderer testable together. Item contract in §4.
- **S1-T2 · The promotion predicate `hasCurrentImpact(item, snap)`** — one named function, one truth table, the only gate between live and history. Rules in §4.3.
- **S1-T3 · The panel.** `#notify-toggle` becomes a disclosure owning `#notifications-panel`, built to `mockups/notifications-dropdown-proposal-2026-08-05.html` rev 2: verdict header (`Waiting on you` → `Watch` → `All clear`, reusing `calmVerdict` `app.js:3455`), program-grouped handoff rows (title / `program · agent · provider` trace with Focus+Reply on it / evidence peek), quiet one-liners for dataflow + investigations, all-clear proof line.
- **S1-T4 · Badge ink = verdict.** Extend `notifyToggleView` (`notifications.js:93`) with a `tone` (`blocked | noticed | clear`). Ember filled **only** when a person is the blocker. **Frozen: `loadNotifyPreference`, `saveNotifyPreference`, `toggleNotifications`, `deliverNotification`, `NOTIFY_TAG`, `titleWithAlerts`, and permission-on-click-only.** Those are the delivery contract and this plan does not touch them.
- **S1-T5 · Delivery reads the blocking set.** `needsHumanIds` (`notifications.js:53`) currently reads `alerting()` (`agent-model.js:294`), which is broader than `wantsHuman` — it returns true for any non-healthy non-terminal row. Left alone, the OS notification fires for a stalled advisory while the button correctly stays amber, and the ember contract breaks at the one place the operator cannot see the screen to check it. Repoint at `attentionClass:"blocking"`. **Behavioral change to delivery *targeting*, not to permission or delivery mechanics** — call it out at review.
- **S1-T6 · Keyboard + focus.** Esc closes and returns focus to the toggle; outside-click closes; Up/Down between rows; Tab reaches Focus/Reply; `prefers-reduced-motion` honored; actions stand (no hover dependency) under `(hover: none)`.

**S1 acceptance gate — S2 may not start until this passes:** every finding reachable from the header today is reachable from the center, verified by enumerating `issuesOf(snap) ∪ queueItems` on the live board and confirming each id resolves to a center item or a documented history demotion.

### S2 — Header removals (fe-notify) · only after the S1 gate

- **S2-T1 · Remove the `needs-you` widget.** Drop from `DEFAULT_WIDGET_IDS` and `WIDGET_CATALOG` (`client-catalogs.js:175-190`), remove its branch in `summaryWidgetData` (`app.js:1008-1030`), and delete the finding-link renderer + `.reading-finding-*` CSS (`styles.css:409-426`). Saved layouts naming `needs-you` migrate silently (the `LEGACY_VIEW_ALIASES` precedent at `client-catalogs.js:152`).
- **S2-T3 · One global scan-window statement (gates the Tokens card).** The per-card "last 36h" tag comes off Tokens, so the board must say its scan window once, somewhere ambient and always visible — `scanWindowHours`/`lookbackHours` are already on the wire and the board already prints `lookback 6h · scan 36h` under the toolbar (`#scope-note`). Decide whether that line is promoted to serve as the global statement or a new ambient element carries it, then remove the per-card tag. **Order matters: the statement lands before the tag comes off, never after.**
- **S2-T2 · Health becomes a provenance qualifier, not a metric.** See Ambiguity A2 — recommendation: the header keeps **one non-linking, non-counting instrument-trust chip** ("Readings healthy" / "Readings degraded — 2 sources stale"), because a confidence header whose instruments are broken must say so or every number above it is unqualified. Its remedy, finding title, and Refresh control move to the center as a dataflow item.

### S3 — Context re-headline (fe-notify)

- **S3-T1 · Average headline, toggleable to median, peak demoted.** `summaryWidgetData("context-peak")` `app.js:1122-1181` currently headlines `snap.contextPeak`. The **headline becomes `contextAverage`**, with the existing `spread-toggle` (`app.js:2157-2172`) **kept and inverted**: it now switches the headline between average and median, defaulting to average, and `CONTEXT_SPREAD_KEY` (`client-catalogs.js:172`) persists the choice per browser as it does today. `contextPeak` leaves the headline entirely — it survives as a dial tick and in the drawer/audit. One reading leads at a time; the toggle is what makes the second reachable without spending a second sentence on it.
- **S3-T2 · Coverage, from the one population that has it.** Print `contextReporting/contextEligible` — the field comment at `types.ts:722-725` says this pair exists precisely because a coverage figure over a different population went wrong once already.
- **S3-T3 · Restrained accessible visualization.** Keep `svgGauge` (CSP-safe, SVG attributes not inline style). Accessible name enumerates every reading drawn, and the label stops saying "Peak" first. Hierarchy: median is the type-scale headline, average is secondary text, peak is a tick — one number leads, the others qualify.
- **Widget id note:** the catalog id stays `context-peak` so saved layouts survive; the **label** becomes "Context". Ids are storage keys, labels are copy — the `needs-you`/"Findings" comment at `client-catalogs.js:179-185` is the precedent.

### S4 — Cost and burn provenance (fe-notify)

- **S4-T1 · Cost is its own reading with provenance rendered, not implied.** `costProvenance:"unavailable"` reads "cost unavailable", never `$0`. `costIsFloor` keeps the `≥`. `costAsOf` prints as an as-of. Preserve the existing sentence-order fix at `app.js:1091-1103` (the rate's window sits next to the rate, not after the cost).
- **S4-T2 · Burn keeps its window qualifier and its blind spot** (`coverage.unknown` ⇒ "N not reporting tokens"). Coverage speaks only when incomplete.

### S5 — History / audit routes (harden-notify)

- **S5-T1 · Demoted signals stay reachable.** Resolved (`recentlyResolvedOf` `presentation.js:627` → the existing `resolved` drawer), verified-without-impact, and stale-without-current-impact all route to History/audit. The center's footer carries one honest link there.
- **S5-T2 · Sweep.** Golden fixture per attention kind; the promotion truth table; docs parity (ANT-GUIDE, DESIGN-LANGUAGE); a11y pass. Dead CSS is already enforced by the existing `every class in styles.css is emitted by the client` test.

### S6 — Clean up (new, per Emilio) · the instrument-trust chip gets an action

The header chip may say "Readings degraded — 3 abandoned worktrees" and then offer nothing; `healthRemedy()` (`app.js:761`) already computes a tidy-up with pane counts and nothing acts on it. S6 makes it actionable.

- **S6-T1 · The sweep agent.** A low-cost worker enumerates completed worktrees, merged branches, and dead panes and reports what it found. Model: see **A7** — a mechanical sweep is Grok 4.5 High Fast territory under the existing routing table.
- **S6-T2 · Propose, then confirm — never autonomous deletion.** ⚠ This deletes worktrees and branches. The precedent is in memory: the last manual pass pre-recorded a rollback SHA for every branch, used `git branch -d` and never `-D`, and verified each tree was clean and unoccupied first. **The agent produces a plan with per-item rollback SHAs and occupancy evidence; the operator approves; only then does anything get removed.** A live agent process inside a worktree is a hard stop. See **A8**.
- **S6-T3 · Minimal in-progress UX.** While the sweep runs: a small rotating indicator on the chip — nothing else, no banner, no progress bar — with a tooltip naming what is running, what it is examining, and that nothing will be deleted without approval. Honors `prefers-reduced-motion` (static indicator, same tooltip). The indicator states *a process is underway*; it never implies the fault is fixed.
- **S6-T4 · The result is a notification item, not a header state.** The sweep's findings route to the notification center as a `dataflow` item with evidence and impact, per §4.2. The header chip returns to its verdict.

---

## 4. The contract between the two surfaces

### 4.1 Header metric contract (fixed order) — **revised per Emilio 2026-08-05 20:07**

| # | Reading | Source | Provenance shown |
|---|---|---|---|
| 1 | **Running** | `totals.working` | — |
| 2 | **Burn** (rate) | `burn.tokensPerMin` | `windowMs` average · `coverage.unknown` when >0 |
| 3 | **Tokens** (consumed) | 🔴 **new server aggregate — see S0-T5** | "consumed" named on the card; **no per-card window tag** |
| 4 | **Cost** | `burn.costLastHourUsd` | `costProvenance` · `costIsFloor` (`≥`) · `costAsOf` |
| 5 | **Context** | `contextAverage` headline, **toggleable to** `contextMedian` | `contextReporting/contextEligible` |
| — | **Instrument trust** | `systemStatus` + `controlHealth` | non-linking chip + Clean up action (S6) |

Shipping/completions is **dropped** (Emilio, 20:07). **No counts of problems. No links. No to-dos.**

**Two different kinds of window, and only one of them leaves the cards.** The **scan window** (`scanWindowHours`/`lookbackHours` — how far back sources are harvested) moves to one global statement in the UX; the per-card "last 36h" tag comes off Tokens. **Each reading's own measurement window stays on the reading**: Burn keeps "10m average" (the comment at `app.js:1091-1103` records why it must sit next to the rate it describes) and Cost keeps "last hour" and its `≥`. Those qualify a specific number; the scan window qualifies the whole board.

⚠ **Prerequisite, not a nicety:** the Tokens card cannot ship an unlabelled aggregate before the global scan-window statement exists — that would be a number with an unstated population, which is the failure mode §2 catalogues. **S2-T3** below carries it.

### 4.2 Notification item contract

```
NotificationItem {
  id:        string                                   // stable across paints
  kind:      "handoff" | "dataflow" | "investigation"
  severity:  "blocking" | "warning"
  source:    { agentId?, agentName?, programId?, programName?, collector? }
  lifecycle: IssueLifecycleState | HookLifecycle | IssueWorkState
  evidence:  string        // plain English, whole sentence
  impact:    string        // consequence for the operator
  since:     string        // ISO
  route:     { kind, id }  // -> selectEntity(); kind ∈ DRAWER_RENDERERS
}
```

Three feeds, one list:
- **handoff** ← agents with `attentionClass:"blocking"` · route `{kind:"agent", id}`
- **dataflow** ← `issuesOf(snap)` (`presentation.js:363`) + `controlHealth.errors`/`staleSources` · route `{kind:"intervention"|"advisory", id}`
- **investigation** ← `state.queueItems` · route `{kind:"investigation", id}`

`route.kind` **must** be a key of `DRAWER_RENDERERS` — assert it in tests, so a new kind cannot ship without a drawer.

### 4.3 The promotion predicate

`hasCurrentImpact(item, snap)` is the only gate. Live iff **evidence-backed current data-flow or accuracy impact**:

| Condition | Live? | Goes to |
|---|---|---|
| `attentionClass:"blocking"` | ✅ | center |
| `lifecycle.state === "resolved"` | ❌ | history (`resolved` drawer) |
| `lifecycle.state === "verifying"` with no live affected agent | ❌ | history |
| `affectedAgentIds` resolve to zero **live** agents | ❌ | history (stale-without-current-impact) |
| source healthy / verified | ❌ | audit |
| `attentionSignal.kind === "nothing-wanted"` | ❌ | never surfaced |
| declared `taskState:"done"` with no newer `needsInput` | ❌ | history — **see A3** |

---

## 5. Ownership boundaries (shared worktree, concurrent edits live)

| Path | Sole writer | Note |
|---|---|---|
| `src/web/notification-center.js` **(new)** | fe-notify | Deliberately a new file: the big surface stays out of the contended `app.js`. |
| `src/web/notifications.js` | fe-notify | **`tone` on `notifyToggleView` + the `needsHumanIds` repoint only.** Permission/delivery functions frozen. |
| `src/web/app.js` | fe-notify | **Three named regions only:** `summaryWidgetData` (895-1183), `renderSummaryWidget` (2124-…), `renderHealthRail` (2643-2712). Re-read each before editing. |
| `src/web/client-catalogs.js` | fe-notify | One commit for the catalog change; coordinate — it is 3 lines and high-collision. |
| `src/web/styles.css` | fe-notify | Header block 323-520; panel styles appended at the end. |
| `src/web/index.html` | fe-notify | One added `#notifications-panel` node. |
| `src/server/**`, `src/shared/types.ts` | be-dwell | S0 only. |
| `tests/web-client.test.ts` | fe-notify | Existing convention. |
| fixtures, `scripts/**`, docs | harden-notify | |

**⚠ Live collision to resolve before S2:** the uncommitted working tree contains another lane's finding-links feature (`.reading-finding-link`, `summary-finding:` fkeys, `findings` on the needs-you widget data). S2-T1 deletes it. **Do not let a lane silently revert another lane's work** — this needs the orchestrator's word (Ambiguity A4), and if approved, the removal commit must name what it removes and why.

**Model routing:** be-dwell = GPT 5.6 SOL MAX (`codex -a never --sandbox workspace-write -m gpt-5.6-sol -c model_reasoning_effort=max`); fe-notify = Opus 5 xhigh (`claude --model opus --effort xhigh --permission-mode auto`); harden-notify = Grok 4.5 High Fast (`cursor-agent --model grok-4.5 --force`); orchestrator = Fable.

---

## 6. Claims-first tests

Each test names the claim the surface makes and fails when the claim stops being true.

**Header**
- "The header states no count of problems and links to none." — no `needs-you` in `WIDGET_CATALOG`; `renderSummaryWidget` output contains no `<button>`/`<a>` routing to `selectEntity`; `.reading-finding-link` absent from styles.
- "Every header number that could be partial says so." — `costProvenance:"unavailable"` ⇒ the string "cost unavailable" and never `$0`; `costIsFloor` ⇒ a leading `≥`; `coverage.unknown > 0` ⇒ the not-reporting clause; all three absent when complete.
- "The context reading describes the fleet, not one agent." — headline reads `contextMedian`; `contextPeak` appears only as a mark; the gauge's accessible name enumerates median, average, and peak.
- "A header with no context reports withholds rather than guesses." — all three context fields absent ⇒ the widget does not render (the existing `speaks()` convention at `app.js:3480`), never `0%`.

**Notification center**
- "Every live item names its kind, severity, source, lifecycle, evidence, impact, and a route." — schema assertion over `notificationFeed()` output on a fixture with all three kinds.
- "Every route resolves to a real drawer." — `route.kind ∈ Object.keys(DRAWER_RENDERERS)` for every item.
- "Nothing resolved, verified, or impact-free reaches the live surface." — the §4.3 truth table, one row per condition, including the stale-without-current-impact row.
- "A parked lane that then asks something re-alerts." — the atlas-hardening precedence case, unbroken.
- "The badge is ember only when a person is the blocker." — `noticed`-only fixture ⇒ amber outline; `blocking` fixture ⇒ ember fill; empty ⇒ grey with a rendered `0`.
- "An out-of-page notification fires only for a person-blocker." — `stalled-active`-only fixture ⇒ `deliverNotification` not called.
- "Permission is still requested from a click and never on load." — existing test, must stay green untouched.

**Truth-safety**
- "An unmeasurable duration is withheld, not zeroed." — one blocking agent without `blockedSince` ⇒ `standbyMs` absent and the hero withheld **with a reason**, while `pulse.blocked` still counts.
- "A heartbeat cannot reset dead time." — heartbeat-churn fixture; fails if any age drops.

## 7. Live verification (browser + AX, not just unit tests)

Run against a throwaway server from this worktree (`MOUNTAIN_PORT=4799 bun src/server/index.ts`) so the launchd instance on 4701 is untouched. Screenshot each.

1. **Parity enumeration (the S1→S2 gate).** On the live board, enumerate `issuesOf(snap) ∪ queueItems` in the console; assert every id is present in `notificationFeed()` or is a documented history demotion. Post the table.
2. **Console clean.** `browse console --errors` after open/close/route on the real board.
3. **AX tree.** `browse snapshot -i` with the panel open: the toggle exposes `aria-expanded`/`aria-controls`; every row is a named control; the gauge's name enumerates median, average, peak; the badge count is in the accessible name, not a bare digit.
4. **Focus contract.** Open → Esc → assert focus is back on `#notify-toggle`; Tab order reaches Focus/Reply; outside-click closes.
5. **Live field measurement before rendering.** S0-T1 and S0-T4 sample tables posted from the real board — the standing rule that FE live-measures BE fields before rendering them.
6. **Responsive + reduced motion.** `browse responsive`; `(hover: none)` shows actions standing.
7. **Notification delivery unchanged.** Permission prompt still fires from click only; `NOTIFY_TAG` still replaces rather than stacks; tab title count still updates with delivery muted.

**Acceptance criteria (all must hold):** the S1 parity gate passes · zero console errors · every header reading either renders with provenance or withholds with a reason · no header node routes to `selectEntity` · every center item satisfies the §4.2 schema and resolves to a drawer · the §4.3 truth table is green · `bun test` shows the literal `0 fail` line · `bunx tsc --noEmit` exit 0.

---

## 8. Decisions taken (Emilio, 2026-08-05 20:07)

- **A2 → resolved.** Header keeps one non-linking instrument-trust chip, **plus** a Clean up action (new S6) and minimal spinner UX while it runs.
- **A3 → resolved, my reading confirmed.** A lane's self-declared completion is a declaration, not a measurement; it never becomes a header metric. This forecloses the declared-done proxy for completions.
- **A4 → resolved.** Land the other lane's finding-links work, then remove it in a **named commit that credits it and says why**. Nothing silently reverted.
- **Context → revised.** Average is the headline, toggleable to median; the existing spread toggle is kept and inverted rather than retired. Peak leaves the headline.
- **Tokens → added.** A fleet token total joins the header; it needs a new server aggregate (S0-T5), because the existing field measures something else.
- **Completions → dropped.** No slot. The absence is recorded here, not spent on a header cell.
- **Scan window → goes global.** The per-card "last 36h" tag comes off Tokens; the board states its scan window once, ambiently (S2-T3). Each reading's *own* measurement window (Burn's "10m average", Cost's "last hour") stays on the reading.
- **Token quantity → consumed.** My call, not yours: you answered on the label, so I took the recommendation underneath it. Consumed pairs with the Cost reading beside it. Flip it to processed in one line if you want the BurnBar-comparable figure instead.

## 9. Ambiguities closed — orchestrator's call, 2026-08-05 20:30

All three were reserved for the orchestrator by §9 of the draft. Taken on ratify; each is a one-line reversal if Emilio disagrees.

**A7 · Cleanup sweep model → Grok 4.5 High Fast** (`cursor-agent --model grok-4.5 --force`). Emilio floated GPT 5.6 Luna; the routing table puts *mechanical sweeps* on Grok and reserves Luna for read-only investigation. Enumerate-and-report is a sweep. It is also already the harden-notify lane's model, so S6-T1 costs no new lane.

**A8 · Cleanup autonomy → propose-then-confirm.** The agent enumerates and reports with per-item rollback SHAs and occupancy evidence; the operator approves; only then does removal run. `git branch -d`, never `-D`. **A live agent process inside a worktree is a hard stop regardless of approval.** Full autonomy would mean an agent deleting branches with no human in the loop — the one thing the last manual pass was careful never to do.

**A5 · Board-side marks → separate plan, not this program.** The pip and `1 waiting` chip on program headers stay cut. This program ships one home for attention; decorating the board is the follow-on that gets to assume it exists.

---

## 10. Orchestration status — 2026-08-05 20:30

### Base landed (this branch, `fix/cmux-control-health-lifecycle`)

| Commit | What |
|---|---|
| `4bcbd84` | The concurrent lane's finding-links feature, committed unchanged and credited. **A4 satisfied**: it exists in history before S2-T1 removes it. |
| `8d01ecb` | The inline findings ledger deleted; tests rewritten to pin its absence. |

Baseline at these commits: `bunx tsc --noEmit` exit 0 · `bun test` **2542 pass / 1 fail**. The single failure is pre-existing and unrelated — `tests/cross-source-token-agreement.test.ts` "no uuid session silently falls out of the join" (27 unjoined against a 26.4 threshold), which imports only `src/server/burnbar`. **It predates this program and no lane may claim `0 fail` until it is separately fixed or quarantined; assert `1 fail` and this named test, or fix it first.**

### ⚠ S0 is held — a live agent occupies be-dwell's territory

At 20:26–20:29 a Codex session (ChatGPT app, pid 47362, cwd inside this worktree) was actively writing `src/server/collectors.ts`, `src/server/identity.ts`, `src/server/identity-bindings.ts` and creating `src/server/process-liveness.ts` + `tests/process-liveness.test.ts`, and running `bun test`. Those files are **uncommitted and half-written**, and `src/server/**` is exactly be-dwell's S0 territory.

**Spawning be-dwell into that is the collision this plan's §5 exists to prevent.** S0 does not start until that session's work is committed or abandoned. Re-check with `stat -f "%Sm" src/server/collectors.ts` before spawning.

Also left uncommitted deliberately, because they are not this program's to land: `src/server/snapshot.ts` + `tests/snapshot.test.ts` (a stalled BE change), and the untracked `src/server/process-liveness.ts` + `tests/process-liveness.test.ts` + `tests/fixtures/process-liveness-truth-table.json`. Those three are untracked *together*, so the committed suite is self-consistent and a fresh clone is fine — they are simply a feature still being written. The owning session commits them, not us.

### Progress — four tranches, three merged (PRs #9, #11, #12 merged; #13 open)

| Stage | State |
|---|---|
| S0 (all five tasks) | ✅ merged. T1 and T4 shipped **measurements, not code** — see the two docs below |
| S1 (all six + parity gate) | ✅ merged |
| S2-T1 Findings card removed · S2-T2 health becomes a qualifier | ✅ merged |
| S2-T3 global scan-window statement | 🔄 in flight |
| S3 context re-headline | ✅ in #13 |
| S4 cost + burn provenance | 🔄 in flight |
| S5 fixtures, truth tables, history routes, docs parity | ✅ merged |
| S6-T1/T2 sweep · read-only `propose` endpoint | ✅ merged |
| S6-T3/T4 chip spinner + result routing | ⬜ not started |
| a11y sweep | ✅ merged — 6 defects found, A11Y-1 fixed; A11Y-2 in flight; 3–6 queued |
| Mutation audit (2 rounds) | ✅ merged |

**Standing evidence, written down because it outlived the lanes that produced it:**
`docs/S0-T1-DEAD-TIME-MEASUREMENT.md` · `docs/S0-T4-EVIDENCE-SAMPLE.md` · `docs/S0-LIVE-FIELD-VERIFICATION.md` · `docs/A11Y-SWEEP-NOTIFICATION-CENTER.md` · `docs/TEST-HOLLOWNESS-AUDIT.md` · `docs/CLEANUP-SWEEP.md`

**Open, and the reason the Tokens card has not shipped:** `totals.consumption` is implemented, tested, and **still absent on a live board**. R3 relaxed the terms gate, but the field is withheld by `sessionCollectionComplete`, which reads `sessions[provider].errors` — a *different* population from the `controlHealth.errors` that reports healthy. So the board can show five healthy sources while session collection is incomplete, and the card silently never appears. Under diagnosis; **no third fixture-green-but-live-absent round.**

### Superseded — tranche 1 ledger, 2026-08-05 21:28 (PR #9, `75e1ed7`)

| Stage | State |
|---|---|
| S0-T1 measure dead time | ✅ measured; **no defensible clock** — `docs/S0-T1-DEAD-TIME-MEASUREMENT.md` |
| S0-T2 `attentionClass` | ✅ merged |
| S0-T3 `pulse.blocked` | ✅ merged (count only; `standbyMs` cut, see R1) |
| S0-T4 confirm evidence sentence | ⬜ not started — measurement only, may ship nothing |
| S0-T5 fleet token consumption | 🔄 in flight — **blocks the Tokens card and S2-T3's second half** |
| S1-T1…T6 + parity gate | ✅ merged, gate passed |
| S2-T1 remove `needs-you` · S2-T2 trust chip | 🔄 in flight |
| S2-T3 global scan-window statement | ⬜ first half free; second half blocked on S0-T5 |
| S3 context re-headline | ⬜ not started |
| S4 cost + burn provenance | ⬜ not started |
| S5-T1/T2 history routes, fixtures, docs parity | ✅ merged |
| S6-T1/T2 cleanup sweep | ✅ merged |
| S6-T3/T4 chip spinner + result routing | ⬜ not started |
| a11y sweep | ⬜ held until S2 is auditable |

**Lane health.** be-dwell and harden-notify both ran to ~89% of a 258K window and were retired with handoff docs committed first (`docs/S0-T1-DEAD-TIME-MEASUREMENT.md`, `docs/HARDEN-NOTIFY-STATE.md`). The lesson worth keeping: **the expensive artifact is the measurement and the reasoning, not the code** — write it to `docs/` before the window closes, or the next lane re-derives it from nothing. fe-notify's 1M window carries S2–S4 and S6-T3/T4 without a handoff.

**Not from this program, on the branch and merged in tranche 1:** `aeb8cec` "feat(web): add provider-neutral review filters". Coherent and tested, authored outside the three lanes. Recorded here so a later reader does not attribute it to this plan.

### Rulings made during execution

**R1 · Dead time is dropped entirely — FINAL. Evidence: `docs/S0-T1-DEAD-TIME-MEASUREMENT.md` (`5d1fa71`).** `blockedSince` and `pulse.standbyMs` do not ship. Three findings, each measured on the live board rather than reasoned about:

- `hookLifecycleAt` advanced `01:38:51.896 → 01:39:16.199 → 01:40:41.667` on a session that stayed `needsInput` and alive throughout. It is a write clock.
- `agent.hook.Notification.occurred_at` is **not an entry edge either** — the same still-blocked session emitted seq `99281`, then seq `99477` two minutes later, while the state already held. Using it would reset dead time in the middle of a single wait.
- The cmux journal is not durable history: `events.jsonl` + `.1` covered ~3.75 hours at measurement time, rollover replaces `.1`, restarts leave gaps, and some sessions had no matching event at all.

**Consequence for the panel: the standby hero and every per-row age are REMOVED, not withheld.** A slot that explains its own absence on every paint is noise, and it implies the number is coming. It is not coming. The verdict header carries the verdict word and `pulse.blocked`, which is real and measured. Rows sort by severity → kind → program → id: stable, explainable, and never dependent on a duration. §6's truth-safety claim *"an unmeasurable duration is withheld, not zeroed"* is superseded by *"the order is stable across paints and never depends on a duration."*

`pulse.blocked` still ships. A count is honest when a duration is not — and the count was always the thing the operator needed; the stopwatch was the part that could not be measured.

**R2 · The board never deletes.** The header chip's Clean up action runs the sweep's **`propose` phase only**. Its output becomes a notification-center `dataflow` item listing each removable item, its rollback SHA, what was refused and why, and the exact `confirm` command to paste. **No destructive server endpoint, in this program or later.** A click in a browser is not the same gate as a person reading a plan in a terminal, and the precedent being matched is a manual pass that was careful never to delete without a human in the loop. S6-T2's confirm phase stays a terminal action.

### Lane launch — the flag goes on the command, every time

| Lane | Launch |
|---|---|
| fe-notify | `claude --model opus --effort xhigh --permission-mode auto` |
| be-dwell | `codex -a never --sandbox workspace-write -m gpt-5.6-sol -c model_reasoning_effort=max` |
| harden-notify | `cursor-agent --model grok-4.5 --force` |

`--force` is Run Everything and is not optional — without it the cursor lane stalls on its first per-command approval and does nothing while nobody is watching. It belongs on the launch, not in `~/.cursor/cli-config.json`; a machine-wide `approvalMode` would apply to every cursor session, including ones no one is orchestrating.

⚠ **Spawning these from inside a Claude Code session is denied** — the auto-mode classifier reads `--force` and `-a never` as bypass flags. Both lanes here launched without them and stalled. The recovery is the operator's: `shift+tab` (Run Everything) in the pane, or a Bash permission rule so the flag survives the next spawn. Do not answer a lane's approval prompt on the operator's behalf.

### Start order

1. **fe-notify → S1** now. New file `src/web/notification-center.js` plus the three named `app.js` regions; no overlap with the live server work. Builds against fixtures behind gated tests, per §3.
2. **harden-notify → S5-T2 fixtures + docs parity** now. Fixtures can precede the wire.
3. **be-dwell → S0** on release of `src/server/**`.
4. **S2 only after the S1 parity gate in §3 passes.** No window may exist where a finding is unreachable.
