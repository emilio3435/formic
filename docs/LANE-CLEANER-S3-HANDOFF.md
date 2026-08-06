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
