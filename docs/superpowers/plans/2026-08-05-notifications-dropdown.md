# Notifications Dropdown Plan — one home for attention

> **⚠ SUPERSEDED by `2026-08-05-confidence-header-and-notification-center.md`**, which reconciles this dropdown work with the confidence-header redesign. T1–T9 below survive as that plan's S0 and S1 tasks. Kept for its measurement findings and rationale; do not execute from this file.
>
> **Status: DRAFT — awaiting Emilio's ratify.**
> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans, task-by-task, checkbox tracking. Same repo conventions as `2026-08-05-atlas-hardening.md`: shared worktree (path-scoped `git add`, never `-A`; re-run `git branch --show-current` before any git action), docs parity in the same commit, single-writer files per lane, `launchctl kickstart -k gui/$UID/ai.imaginethat.anthill` to restart (never a shell start), and the literal `0 fail` line asserted before any deploy.

**Goal:** The inline findings ledger is deleted (2026-08-05). Rebuild attention as one control — the masthead **Notifications** button plus a dropdown — that answers *who is stopped and waiting on me, and what did they ask*, and keeps everything nobody is blocked on in a skippable log.

**Design of record:** `mockups/notifications-dropdown-proposal-2026-08-05.html` (revision 2). Three-line rows: what stopped / where it is / what it is asking. Focus + Reply ride the middle line. Badge ink is the verdict: ember filled = a person is the blocker, amber outline = the watcher noticed something, grey outline = clear.

**The contract the whole thing rests on:** *ember appears for a person-blocker and nothing else.* Every task below is in service of making that sentence true and legible.

---

## What the wire already gives us (measured 2026-08-05, before planning)

Two findings that shrink this program and one that endangers it. Read them before estimating.

1. **The blocked-vs-noticed split is already computed.** `AttentionSignalKind` (`src/server/attention-signal.ts:39`) partitions cleanly: `permission-requested`, `input-requested`, `fork-unresolved`, `handoff-stated`, `question-pending`, `assumption-stated` are all *a human is the blocker*; `stalled-active` is *the watcher noticed*. No new detection is needed — only a name for the partition on the wire.
2. **The peek content probably already exists.** `attentionSignal.evidence` is documented as "the sentence a match sits in, so evidence quotes a whole thought," and `lastAgentClosing` carries the agent's closing words *by construction* rather than by tail-guessing. The peek is likely a render, not a feature.
3. **⚠ Dead time is the one number we do not have, and the obvious field is a trap.** `collectors.ts:1123` derives `hookLifecycleAt` from the hook record's `updatedAt` — a **write** time. If the hook store heartbeats while a session sits in `needsInput`, that clock resets on every heartbeat and every dead time on the panel reads near-zero, confidently and wrongly. The panel's hero number, its per-row age, and its sort order are all read from this. **T1 exists to measure it before anything renders it.**

---

## Lane assignments (model routing: the right model for the cause)

| Lane | Model / CLI | Territory |
|---|---|---|
| be-dwell | GPT 5.6 SOL MAX — `codex -a never --sandbox workspace-write -m gpt-5.6-sol -c model_reasoning_effort=max` | `src/server/**`, `src/shared/types.ts`, `tests/attention-signal*`, `tests/snapshot*` |
| fe-notify | Opus 5 xhigh — `claude --model opus --effort xhigh --permission-mode auto` | `src/web/**`, owns `tests/web-client.test.ts` |
| harden-notify | Grok 4.5 High Fast — `cursor-agent --model grok-4.5 --force` | fixtures, truth tables, `scripts/**`, docs parity, a11y sweep |
| orchestrator | Fable | contract design, the T1 measurement gate, merges + external re-verify |

`--force` on cursor is standing directive; claude lanes stay `--permission-mode auto`; codex stays `-a never`. Never `bypassPermissions`.

## Parallel structure (three tracks from minute one)

Track A (be-dwell): **T1 → T2 → T3**, with T4 branching off after T1.
Track B (fe-notify): **T5a → T5b/c/d → T6**, built against fixtures behind gated tests; **T7** last.
Track C (harden-notify): **T8** from minute one (fixtures can precede the wire); **T9** after T5 merges.

**One serialization point:** T2's `attentionClass` and T1's `blockedSince` shape gate T5's *real data*. FE does not wait for them — it builds against the ratified shape with lock-tests gated, and the gates flip at integration (atlas convention).

---

### T1 — Measure `hookLifecycleAt` before anything renders it (be-dwell) ⭐ blocking

**Do not write code first.** Sample live: pick every session currently `hookLifecycle: "needsInput"`, record its `hookLifecycleAt` across ≥3 consecutive collector passes ≥60s apart, and post the raw table in the lane. If the value advances while the session stays in `needsInput`, it is a heartbeat and cannot be a state-entry clock.

Deliverable either way: **`blockedSince?: string`** on the wire — the instant this session entered its current person-blocked state, stable across passes. If `hookLifecycleAt` proves to be an entry time, this is a rename with a truth-table; if it is a heartbeat, it is a derived timestamp the server holds (first pass that observed the current blocking state, persisted across restarts so a server bounce does not reset every agent's dead time to zero).

Truth safety, non-negotiable: no hook record, no readable transition, or a server that has not been up long enough ⇒ **`blockedSince` is absent**. Never substitute `updatedAt`, never emit `0`. Unmeasurable ≠ zero (the T5.1 epistemics rule).

TDD: fixtures for entry / heartbeat-churn / restart-gap / absent. Live re-measure after the fix, posted in the lane.

### T2 — Name the partition on the wire (be-dwell)

Add `attentionClass?: "blocking" | "noticed"` beside `attentionSignal`, derived from `kind` per the table in *What the wire already gives us*. `nothing-wanted`, `out-of-scope`, `not-readable` produce no class at all — absence, not a third value.

Nothing new is detected. This exposes a partition that already exists so the client stops re-deriving it from a list of string literals it would have to keep in sync.

Truth safety: a `parked`/`done` declaration never yields `blocking`. The T6/T7 precedence from atlas-hardening is untouched — this **reads** the attention verdict, it never reopens a door T7 closed. The parked-then-asks re-alert must still work.

TDD: one truth-table row per kind, plus the parked-then-asks case and a declared-done-with-stale-prose case.

### T3 — Fleet counters, computed once (be-dwell, after T1 + T2)

`pulse.blocked` (count of `attentionClass: "blocking"` live agents) and `pulse.standbyMs` (sum of `now − blockedSince` across them). The badge, the header hero, and the sort order all read these instead of each walking the fleet.

**`standbyMs` is absent — not partial — when any blocking agent lacks `blockedSince`.** A sum presented as a total while one term is missing is the same lie the `queueError` guard already exists to prevent on the summary strip. `pulse.blocked` may still count; a count is honest when a duration is not.

### T4 — Confirm the peek before building one (be-dwell, parallel after T1)

Measure, do not assume: across live blocking sessions, is `attentionSignal.evidence` present, and is it the *ask* rather than a fragment? Compare against `lastAgentClosing`. Post the sample.

If evidence is sufficient, **this task ships nothing** and T5c renders it. Only if it is absent or unusable for the blocking kinds do we add a bounded `blockedAsk?: string`. Do not add a field that duplicates one that works.

### T5 — The panel (fe-notify) ⭐ the deliverable

Build to `mockups/notifications-dropdown-proposal-2026-08-05.html` rev 2. Until T1–T3 land, render from fixtures behind gated lock-tests; flip the gates at integration.

- **T5a — the button.** `#notify-toggle` becomes a disclosure owning `#notifications-panel`: `aria-expanded`, `aria-controls`, focus returns on close. Extend `notifyToggleView` with a `tone` (`blocked` | `noticed` | `clear`) driving badge ink — ember filled only when `pulse.blocked > 0`. Label stays "Notifications" in every state; the count stays in the accessible name. The existing "Notifications off / blocked / unsupported" branches keep working — delivery state and backlog are still different facts.
- **T5b — the shell.** Header verdict reusing the client's own vocabulary (`Waiting on you` → `Watch` → `All clear`, matching `calmVerdict`), standby hero from `pulse.standbyMs` (withheld, with a reason, when absent), `N quiet · N running below` tally.
- **T5c — the rows.** Grouped by program (reuse `programRollup` / `buildClusters`). Three lines: title, `program · agent · provider` trace with Focus/Reply right-aligned on it, and the peek. Space for the actions is reserved at rest so nothing shifts on hover; on touch they stand. Clicking the row calls the existing `selectEntity`.
- **T5d — the quiet lists + states.** `Watching` and `Running on its own` as one-liners carrying their program. All-clear shows the proof line (agents working · programs watched · last scan) rather than going blank — "watching, found nothing" and "not watching" must not render identically.

Constraints: strict CSP (no inline style, meters via SVG attributes), paint-signature discipline (the panel gets its own signature; do not hang it off the widgets guard — that is the bug the settings panel had), and the summary strip's expansion count stays at one.

fe-notify owns `tests/web-client.test.ts` for the whole program.

### T6 — Keyboard, focus, and honest delivery (fe-notify)

Esc closes and returns focus to the button; click-outside closes; Up/Down move between rows; Tab reaches Focus and Reply; `prefers-reduced-motion` respected.

And the part that is not cosmetic: **out-of-page notifications must fire on the blocking set only.** `needsHumanIds` currently reads `alerting()`, which is broader than `wantsHuman` — it returns true for any non-healthy non-terminal row. Left alone, the OS notification fires for a stalled advisory while the button correctly stays amber, and the ember contract breaks at the one place the operator cannot see the screen to check it. Move delivery onto `attentionClass: "blocking"`.

### T7 — Reply without leaving the panel (fe-notify, last)

Reply opens the existing composer targeted at that agent, reusing the command dock's send capability **and its fail-closed gate**. A session whose identity is unproven must not present an enabled Reply — the board already knows it cannot type into those rows, and a control that lies about capability is the defect this codebase names everywhere else.

If the capability check cannot be honored inline, Reply degrades to Focus-and-open-drawer and **says so on the control**, rather than shipping a button that sometimes does nothing.

### T8 — Fixtures, truth tables, parity (harden-notify, from minute one)

Golden fixture per attention kind; the blocked/noticed matrix; parked-then-asks re-alert; **a `blockedSince`-absent case asserting the standby hero is withheld with a reason rather than zeroed**; a heartbeat-churn fixture that fails if dead time resets. ANT-GUIDE + DESIGN-LANGUAGE parity for the dropdown's vocabulary. A11y pass: focus order, accessible names, the touch/hover divergence.

### T9 — Sweep what the panel replaces (harden-notify, after T5 merges)

The ledger is already gone. Open question for Emilio, not a lane decision: the `needs-you` summary widget still prints the top two finding titles as its sublabel, which the panel now says better. Keep it as an at-a-glance echo, or cut it so attention has exactly one home? Flag, do not decide. Dead-CSS is already enforced by `every class in styles.css is emitted by the client`.

---

## Verification

Per merge: external re-verify by the orchestrator, not the lane's own word (this caught 6-fail sandbox artifacts and two hollow-gate slips last program). Before any deploy: assert the literal `0 fail` line — `bun test | tail` masks exit codes. FE live-measures every BE field on the real board before rendering it; that rule is what T1 and T4 are.

## Stop conditions — escalate, do not improvise

- **T1 finds no stable entry clock** and a derived one needs cross-restart persistence: that is a bigger BE change than this plan scopes. Stop and re-scope. Shipping a dead-time number we cannot defend is worse than shipping the panel without the hero — the mockup works with the per-row ages alone.
- **T4 finds evidence unusable** for the blocking kinds: the peek is the row's third line and the reason the panel beats the old ledger. Escalate before designing around its absence.
- **Reply's capability gate cannot be reused inline**: take the T7 degradation, do not build a second send path.

## Open, for Emilio

1. Ratify or redirect **T9** (keep the NEEDS YOU sublabel, or cut it).
2. Board-side marks — the pip and `1 waiting` chip on program headers — were cut from the mockup as their own piece of work. Separate plan, or fold in as T10?
