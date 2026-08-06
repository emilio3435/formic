# Cleaner lane — S3/S4/S5 handoff

> **UPDATE 2026-08-06 09:45 — S3, S4 and S5 are COMPLETE and committed**
> (`6dbf0aa`, `9b27807`, `1aa30c8`, `d752154`). What follows below the next rule
> is the mid-stage note written while app.js was contended; it is kept because
> its rulings still bind. The corrections that supersede it are here.
>
> **What changed from the plan, and why:**
> - `resolving` was NOT shipped. No channel reports it — see below.
> - The button runs **propose then launch** in one press. Repointing it straight
>   at `/launch` left S4 with no source for counts, refusals or SHAs at all.
> - The paint signature signs `cleanerView(...).state`, the DERIVED answer, not
>   just `state.cleaner`. Signing the binding alone repaints on adoption and then
>   freezes for the rest of the run — CLEAN-1 one level down.
> - The landing beat reuses `cleanup-spin` with one iteration rather than adding
>   a keyframe, which keeps the A6 guard's exhaustive list true without editing
>   another lane's file.
> - `watching` holds an `is-alive` still ring. Spinning again after landing would
>   un-terminate the motion the beat exists to terminate.
>
> **Live vs fixture, stated plainly:** `idle → launching → failed` is MEASURED
> against the real route (404 and 503, both rendering the server's own sentence,
> neither leaving a spinner). `launching → watching → needs-you → resolved` is
> FIXTURE-ONLY: cursor-agent cannot authenticate under the throwaway HOME that
> makes the board degraded, so a live success needs a real-home server and means
> spawning a Cleaner against the live repo — an outward action that is the
> orchestrator's call, not a lane's. The S5 ring was measured in both motion
> branches.

---


**Written 2026-08-06 09:0x, mid-stage, because `src/web/app.js` has been under
continuous edit by the filtering program and this lane may be respawned rather
than resumed.** Everything below is what a fresh lane needs to finish S3 without
re-deriving it.

Plan: `docs/superpowers/plans/2026-08-06-cleaner-agent-flow.md`.
Contract: `docs/CLEANER-LAUNCH-CONTRACT.md` (read in full; distilled below).
My half is **S3, S4, S5, S6**. be-dwell has S1/S2 and has stopped.

---

## What is already landed

| Commit | What |
|---|---|
| `d240270` | **S6 complete.** The control moved from the verdict heading to the end of the detail line, right-aligned to the card edge, centred on that line. Measured at 1280 and 420. |
| `6dbf0aa` | **S3's derivation half** — `src/web/cleaner.js` + `tests/cleaner-binding.test.ts`, 19 tests. |
| `0ebc874` | (Previous program) the degraded chip names the source; the fault sentence reaches the screen. |

`src/web/cleaner.js` is a **new, uncontended file** and holds all of S3's logic:

- `cleanerAgentId(sessionId)` → `"cursor:" + sessionId`
- `cleanerFromResponse(body, httpOk)` → `{ sessionId, code, error }`
- `cleanerView(snap, cleaner)` → `{ state, message, sessionId?, agentId?, code? }`
- `CLEANER_FAILURES`, `ALREADY_RUNNING`, `CLEANER_LABELS`, `CLEANER_IN_FLIGHT`
- `cleanupCounts(view)`, `countsSentence(counts)`

It was made a separate file on purpose, the same reason `notification-center.js`
is one: the contended entry point keeps only the fetch and the paint.

---

## What is LEFT for S3 — the wiring only

All of it is small, and all of it is in files the filtering program is holding.

**1. `src/web/client-state.js`** — add the bound lane to `state`:

```js
cleaner: { sessionId: "", code: "", error: "", launching: false },
```

**2. `src/web/app.js` — a new `requestCleanerLaunch()`**, modelled on the
existing `requestCleanupProposal()` (same file, same shape: set state, `render()`,
`await apiFetch`, set state, `announceCleanup(...)`, `render()`).

```js
async function requestCleanerLaunch() {
  if (state.cleaner.launching || state.cleaner.sessionId) return;   // adoption, not a second lane
  state.cleaner = { sessionId: "", code: "", error: "", launching: true };
  announceCleanup("Starting a Cleaner lane…");
  render();
  let body = null; let httpOk = false;
  try {
    const res = await apiFetch("/api/cleanup/launch", {
      method: "POST", headers: { accept: "application/json" },
    }, 60_000);
    httpOk = res.ok;
    body = await res.json().catch(() => null);
  } catch { /* transport died; cleanerFromResponse states it */ }
  state.cleaner = { ...cleanerFromResponse(body, httpOk), launching: false };
  announceCleanup(state.cleaner.error || "A Cleaner lane is running. Watch for it on the board.");
  render();
}
```

**3. `src/web/app.js` — `cleanupAction()`** (~line 2280) becomes state-driven.
It currently reads `state.cleanup.running` only. It should read
`cleanerView(state.snap, state.cleaner)` and use `CLEANER_LABELS[view.state]`,
`CLEANER_IN_FLIGHT.has(view.state)` for the `is-running` class, and render
`view.message` as the title/description when `state === "failed"`.
**Keep `aria-disabled` — never `disabled`** (CLEAN-2: a disabled control leaves
the tab order and strands focus mid-interaction).

**4. `src/web/app.js` — the paint signature.** `renderHealthRail`'s `sig` already
signs `state.cleanup.running/at/error` (added for CLEAN-1). It must **also sign
`state.cleaner.sessionId`, `.launching` and `.error`**, or the chip will freeze
mid-run exactly the way CLEAN-1 did. This is the single highest-risk omission in
the remaining work.

**5. `cleanupOffered()`** — unchanged. Still offers on a degraded chip only.

---

## The contract, distilled (so the next lane need not re-read it to start)

- `POST /api/cleanup/launch`, **no body**, requires exact same-origin loopback
  `Origin`. `curl` will get `403 ORIGIN_REJECTED`; the browser has the header.
- Success is `{ ok: true, sessionId }` and **the route returns only after a
  fresh snapshot already contains the lane.** So `watching` is observable at the
  response — it is never inferred.
- **Bind by `agent.id === "cursor:" + sessionId`.** Never by display name;
  `Cleaner` is presentation, not identity.
- `409 CLEANER_ALREADY_RUNNING` **carries a `sessionId`** — adopt it. This is why
  "double-click launches one Cleaner, not two" holds honestly rather than by
  debouncing the button.
- Eight other failure codes, all 405/403/503, each must be rendered **by name**.
- Progress channel is the ordinary session machinery only: transcript, hook
  lifecycle, attention detection, snapshot collector. **No Cleaner telemetry
  store exists.**

## The state-derivation mapping (implemented, tested)

| State | Evidence |
|---|---|
| `idle` | nothing bound |
| `launching` | request in flight, **or** bound to a session not yet in the snapshot |
| `watching` | that session is on the board, not terminal, not blocking |
| `needs-you` | `attentionClassOf(agent) === "blocking"` |
| `resolved` | that session is terminal |
| `failed` | a named refusal from the route |

**`resolving` is deliberately not shipped.** It was defined as "the Cleaner's own
reported step", and the contract closes that door: after approval the lane
returns to working with no `attentionClass`, which is observationally identical
to `watching`. Shipping it would advance a label by inference — the `setTimeout`
defect in a different hat. §2 governs: *if a state cannot be observed, it does
not exist in the UI.* **Do not re-add it without a real signal**, and measure any
such signal against a live Cleaner before trusting it.

A bound session the board cannot see **holds at `launching`**. The contract says
absence is not an ending, so advancing there is the optimistic read the rule
forbids. That is §6's first test and it is already written.

---

## S4 — the result item (not started)

Two halves, and the first is mostly *verification*, not construction:

1. **The ask is already a handoff item.** The Cleaner is an ordinary agent, so
   `notificationCandidates()` picks it up through the existing handoff feed the
   moment `attentionClass` is `blocking`. §7 of the plan is explicit that a
   board-level approve button would be a second approval mechanism. **Verify this
   on a live Cleaner rather than building anything**; if it does not appear, that
   is a finding about the feed, not a reason to add a surface.
2. **The result as a `dataflow` item** with counts, refusals *with reasons*, and
   rollback SHAs. `cleanupCounts()` / `countsSentence()` in `cleaner.js` already
   produce the sentence. Today the plan renders inside `renderInstrumentBlock()`
   in `app.js`; S4 moves it to a proper item so it has an id, an evidence
   sentence, an impact and a route.

⚠ **Counts must say `proposed`, never `removed`.** The board observes that a
session ended; it does not observe what was removed. `countsSentence()` already
enforces this and a test asserts the string contains no
`complete|success|done|removed`.

## S5 — the landing ring (not started)

- The ring completes **one rotation and lands** — motion that terminates. Today
  `cleanup-spin` is `infinite` (`styles.css`, `.verdict-cleanup.is-running`).
- The Cleaner arrives as a **named row on the board** — that is the delight, and
  it needs no new code: it is a real lane.
- The verdict is a **count**, not an adjective. Already done in `cleaner.js`.
- **Reduced motion must be MEASURED, not asserted.** `Emulation.setEmulatedMedia`
  is in the browse allowlist as of 2026-08-06. The method:

  ```
  browse cdp Emulation.setEmulatedMedia '{"features":[{"name":"prefers-reduced-motion","value":"reduce"}]}'
  ```

  **Assert `matchMedia("(prefers-reduced-motion: reduce)").matches === true`
  before measuring anything** — otherwise you measure the `no-preference` branch
  and report a false pass, which is worse than the NOT RUN it replaced. Note
  `dist/browse` is a Jul 15 binary without the symbol; the daemon that enforces
  the allowlist is `dist/server-node.mjs`, so a **daemon restart** is what picks
  the change up. `hover`/`pointer` still cannot be emulated — that needs
  `Emulation.setTouchEmulationEnabled`, which is not allowlisted.

---

## Environment

- **Degraded demo board: `http://localhost:4796`, my pid `33150`.** Genuinely
  degraded, not forced: started with `HOME` pointed at
  `<scratch>/fakehome`, whose Cursor GUI store is an unreadable file, with
  `.cmuxterm/.claude/.codex/.anthill/Developer` symlinked to the real home so
  **only Cursor fails**. Side effect: BurnBar cost reads unavailable.
- `4799` is held by pid `7124`, **which this lane did not start** — left alone.
- `4701` is the operator's board. Never touched.
- Reproducing the degradation from scratch is ~4 commands; see the fakehome
  recipe above.

## Verification standard for this lane

`bunx tsc --noEmit` **and** `bun run test:ci`, every commit. `bun test` on one
file is not a gate — it was green while this lane shipped a `TS7016` and, later,
a literal NUL byte that `check-nul-files` caught in the full suite.

Report **which transitions were measured against a live Cleaner and which are
fixture-only.** As of this note, *all* of S3 is fixture-only: no live Cleaner has
been launched yet, because the wiring that would launch one is the part still
blocked.

---

# Retirement note — 2026-08-06 11:0x

Everything below is what is NOT in a commit message. The commits carry what was
built and why; this carries what a fresh lane would otherwise learn the hard way.

## The chip state machine — what is not obvious from the code

**`cleanerLastState` is a module-scoped variable in `app.js` mutated inside
`cleanupAction()`.** That is a render-time side effect, and it is load-bearing:
it is how the landing beat fires on a transition rather than on a clock. Two
consequences a refactor will not see coming:

- If `cleanupAction()` is ever called **twice in one paint** (two chips, or a
  micro chip plus a full one), the second call reads the state the first just
  wrote and the landing is swallowed. Today only one call site can be live at a
  time because the health cell is either micro or full-width, never both.
- If the control stops rendering for a paint, the variable freezes at its last
  value rather than resetting. That is intentional — the binding survives — but
  it means `idle` is not re-entered by the chip disappearing.

**`cleanerView()` is called twice per paint**: once inside the paint signature
and once in `cleanupAction()`. It is pure, so this is free and correct. It is
also a trap: making it stateful or expensive would break the signature's meaning
and double any cost. Keep it pure.

**`cleanupOffered()` gates the whole control, and it is keyed on the chip being
degraded — not on whether a Cleaner is running.** So a board that recovers while
a Cleaner is mid-run hides the control, and with it the Cleaner's state, even
though the lane is alive. The lane is still visible as an ordinary row (which is
the R2′ gate, so nothing is lost that matters), but the CHIP will not tell you.
Nobody has decided whether that is right. It is worth a ruling rather than a
silent fix: keeping a control visible only while a fault persists is exactly the
anti-scold rule S6 was built on, and overriding it for the Cleaner may be
correct or may be the scold returning by the back door.

**`resolved` is reachable but never yet seen.** It requires the bound session to
go terminal. No live Cleaner has ended while the chip was bound to it, so the
`resolved` label and its counts have been exercised by fixture only.

## Live vs fixture, per transition — the honest ledger

| Transition | Status |
|---|---|
| `idle → launching` | **LIVE.** Real click, real POST, label "Starting…", focus retained. |
| `launching → failed` | **LIVE, twice, two different causes.** A 404 (server predating the route) and a real 503 `CLEANER_SESSION_CREATE_FAILED`. Both rendered a stated failure; neither left a spinner. |
| `launching → watching` | **FIXTURE ONLY.** |
| `watching → needs-you` | **FIXTURE ONLY** — and see the blocker below; it cannot happen live yet at all. |
| `watching/needs-you → resolved` | **FIXTURE ONLY.** |
| `409 → adopted → watching` | **FIXTURE ONLY.** No second launch has ever succeeded, because no first launch has. |
| S5 landing ring, normal motion | **LIVE-MEASURED** (`cleanup-spin`, 1 iteration, `forwards`, then held). |
| S5 landing ring, reduced motion | **LIVE-MEASURED** through `setEmulatedMedia`, gate asserted true first. |
| S6 geometry at 1280 and 420 | **LIVE-MEASURED.** |
| The ask becoming a handoff item | **FIXTURE ONLY**, and correct in fixture. |

**Why the success path has never run:** `cursor-agent` cannot authenticate under
the throwaway `HOME` that makes the board degraded, and the board must be
degraded for the control to appear at all. Those two requirements conflict.
Resolving it needs either a real-home server with the chip forced visible, or a
Cursor login inside the fake home. Spawning a Cleaner against the live repo is an
outward action and was left to the orchestrator deliberately.

**Defect 1 (the board cannot see the Cleaner's ask) is `src/server/cursor.ts`.**
`lastAgentClosing` is `0/93` for Cursor against `606/719` for Claude, and
`attention-signal.ts` states that field is what makes the content detectors
possible. Until it lands, `needs-you` cannot occur live for any Cursor lane.
be-dwell has it.

## Things that did not work — do not spend the time again

- **A standalone HTML fixture for measuring panel geometry.** Extracting the
  masthead into its own page drops the ancestor chain, so `.masthead-signals`
  landed at 8..412 instead of 48..372 and the defect did not reproduce. Measure
  the real app, or include the whole `<body>` chain.
- **Exempting `kind === "system"` from the stale-demotion rule.** Too broad —
  the abandoned-worktree row in the truth-table fixture is also `system`. The
  working discriminator is whether the index can RESOLVE the named agents at all:
  present-and-terminal is stale, unresolvable is the fault itself.
- **Flipping sublabel-over-severityDetail for every severity.** Only `advisory`
  has a constant detail; `blocking` and `stale` derive theirs from the fault and
  are better than their sublabel. The blanket flip swapped one specific sentence
  for another and broke a test that was right.
- **Adding a `cleanup-land` keyframe.** `tests/web-client.test.ts` carries an
  exhaustive `@keyframes` list whose whole purpose is to make a new animation's
  author confirm reduced-motion coverage. Reuse `cleanup-spin` with one iteration
  instead — a landing is a rotation that stops, not a different motion.
- **Scoping CSS on `.widget-health`.** That class is built as `"widget-" + id`
  and never appears literally in the client, so the orphan-CSS guard flags it.
  Scope on a class the code emits as a literal.
- **`String.replace` in mutation checks.** It takes the FIRST occurrence, and the
  rail and the notification panel have identically-worded signature lines — a
  mutation check reported a test as toothless when it had in fact edited the
  wrong copy. Use `lastIndexOf` and slice, and mutation-check the mutation.

## Environment traps

- **Served assets carry `Cache-Control: max-age=60`.** Every browser check after
  an edit needs `sleep 61` or a hard reload, or you measure the old bundle. This
  cost several wrong readings before it was noticed.
- **`agentsById()` caches by snapshot object identity.** Mutating `state.snap` in
  place does not invalidate it; replace the object
  (`st.snap = JSON.parse(JSON.stringify(st.snap))`) or the board will not see
  your fixture agent.
- **`browse` is one shared daemon.** Driving it changes the viewport and page for
  whoever else is using it. It also needs a restart to pick up a rebuilt
  `dist/server-node.mjs` — the CLI binary is stale and does not carry the CDP
  allowlist.
- **Demo board:** `http://localhost:4796`, pid noted at launch, `HOME` pointed at
  `<scratch>/fakehome` with an unreadable Cursor GUI store and the other
  collectors symlinked, so only Cursor fails. Side effect: BurnBar cost reads
  unavailable. `4799` was held by a process this lane did not start and was left
  alone; `4701` is the operator's board and was never touched.
