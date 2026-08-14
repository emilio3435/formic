# Collector deadline — design

**Date:** 2026-08-13
**Status:** awaiting review
**Goal (Emilio, this session):** controls stop going dead, memory stops growing, restarts stop false-alarming. Explicitly **not** "make the board faster" as an end in itself.

---

## 1. What is actually wrong

Every 20 seconds the board rebuilds its picture of the fleet inside a 10-second
control deadline (`state.ts:883-885`). When it misses, it publishes a *partial
snapshot* and withdraws every agent's terminal target
(`#publishQuarantinedRoutingEvidence`, `state.ts:341-370`). That withdrawal is
correct in itself — the board will not route a command at a terminal it can no
longer vouch for — but it is what makes focus/instruct/interrupt go dead, and it
is what dissolved the cmux repo groups until #56.

The log carries 464 of these misses.

### The measured cause

#56 and #59 landed first so that the answer would come off the running board
instead of off a reading of the code. The first steady-state pass after #59 went
live:

```
total=10001ms
  cmux sync notification collection  = 655ms
  cmux sidebar discovery             = 520ms
  providers                          = 430ms
  cmux discovery                     = 386ms
  cmux notification collection       = 385ms
  cmux workspace env discovery       = 137ms
  run manifest discovery             =   2ms
  PENDING=[cmux identity enrichment]
```

**Identity enrichment consumed roughly 9.3 of the 10 seconds. Every other
collector finished inside 700ms.**

A cold pass has a different shape — `providers=14395ms`, `cmux sync notification
collection=14347ms`, `PENDING=[identity, workspaceEnv]` — so boot is its own
problem, and it is why deploys report UNHEALTHY.

### Three theories this refutes

Recorded because the cost of this investigation was almost entirely spent on
them, and because each was confidently argued from code before it was measured.

| Theory | Predicted | Measured |
|---|---|---|
| Transcript walk over 2,507 ended sessions | O(all tracked agents) | 1 file, 2.6ms |
| Cursor's 7.54 GB `state.vscdb` | dominant per-pass cost | inside `providers=430ms` |
| Deadline < sum of nested budgets | missed by construction | true as arithmetic; provider settle is a `race` that returns fast, so it does not describe the healthy pass |

Identity was invisible for four investigations for a specific, fixable reason:
**its failures are returned as source health and never written to stderr**
(`identity.ts:431-447`, `:483-490`, `:563-570`). It could consume the entire
budget without leaving a line in a log full of complaints about the budget.

### Why identity is slow, structurally

Three sequential `await` sites, up to four subprocess spawns, none of them
overlapped (`identity.ts`):

| # | Call | Budget | Site |
|---|---|---|---|
| 1 | `cmux rpc system.top` | 4s × up to 2 attempts | `:425-443` |
| 2 | `env LC_ALL=C ps -axo …` | 8s | `:479-482` |
| 3 | `/usr/sbin/lsof -a -p <pids> -Fn` | 10s | `:559` |

**4 + 4 + 8 + 10 = 26 seconds of budget inside a 10-second deadline.** The
`lsof` alone is allowed more than the deadline containing it. Probed by hand
these took 0.16s / 0.08s / 1.14s — so the production 9.3s is not explained by
the structure alone, and **which** step is slow is not yet known. That is the
first task of Phase 2, not an assumption of it.

---

## 2. Design principles

1. **Absence of evidence is not evidence.** The same rule #56 established for
   grouping applies here: a late collector must not be read as a fact about the
   world. Extended to identity, being late this pass ≠ the target is gone.
2. **No budget may exceed the deadline that contains it.** A sub-timeout larger
   than its parent is not a timeout; it is an unbounded wait with paperwork.
3. **Slow evidence must not be able to spoil fast evidence.** Terminal targets
   are cheap to collect and expensive to lose.
4. **A guard that cannot fire, or that cries wolf, is worse than none.** Both
   appear below.

---

## 3. Phases

Phases 1, 3 and 4 need no further measurement and can proceed in parallel.
Phase 2 is gated on its own first task.

### Phase 1 — bound what is unbounded

Justified by evidence already in hand; independent of what turns out slow.

**1a. Deadline the publishing tail.** Six awaits after the deadline sit under no
timeout at all — line numbers as of `46b0aba`: `state.ts:1149`
(`updateBindingsFromScan`), `:1216` (`senderTranscriptTailsFor`), `:1225`
(`witnessStore.record`), `:1231` (`archiveStore.record`), `:1299`
(`ackStore.reconcile`), plus the transcript `readFile` in the same tail.
Evidence: of 79 watchdog drops, 13 exceeded 60s and one pass ran **16.7
minutes**. No sum of budgets produces 16.7 minutes; only an unbounded await
does. Give the tail one budget; on overrun, publish what exists and log which
step was outstanding.

**1b. Make nested budgets fit their container.** `collectCmuxNotificationSummaries`
is allowed 30s of sequential RPCs (`cmux.ts:578`, `:600`, `:624`) and
`collectCmuxSidebar` 20s (`cmux.ts:660`, `:684`) — each larger than the whole
10s deadline, both running before identity starts. One wedged `notification.list`
blows the deadline with everything else healthy. Derive per-collector budgets
from the deadline rather than hardcoding them, so the relationship cannot drift
apart again.

**1c. The watchdog must cancel, not abandon.** `state.ts:717-735` clears
`#refreshing` and starts a replacement pass while the old `#performRefresh`
keeps running; `#superseded` (`:745`) suppresses only its *writes*, never its
I/O. Two passes then share one event loop and each makes the next slower:
observed 12.1s → 13.5s → 26.6s. Thread an `AbortSignal` so a superseded pass
stops working.

Note in passing: `PROVIDER_FINALIZATION_ALLOWANCE_MS` (`state.ts:108`) is dead
at the current setting — `max(10_000, 7500 + 1000)` is always the floor. It only
binds above `providerWaitMs > 9000`, at which point the remainder *shrinks* to
1s while the provider cap grows. Fix or delete it; do not leave it looking
load-bearing.

### Phase 2 — identity off the critical path

**2a (gate). Sub-step timings inside identity.** Four theories have now died on
contact with measurement. Do not design the split blind: instrument the three
await sites the way `capture()` was instrumented in #59, log on overrun only,
and read which step costs the 9.3s. Everything below is written to be correct
whichever it is, but the *shape* of 2b depends on the answer.

**2b. Identity serves last-known-good.** Identity moves to its own cadence. The
snapshot carries identity evidence with an age. Targets are withdrawn when
identity evidence is *stale beyond a threshold*, not merely late this pass —
which is the Phase-1 principle applied to the specific field that was killing
the controls. Fast evidence (cmux surfaces, workspace membership) stays on the
10s path.

**2c. Identity says when it fails.** Its three failure paths return errors that
never reach stderr. That silence is why this took four investigations. They
should log, at the same "only when it matters" discipline as #59.

### Phase 3 — memory and boot

**3a. Bound the caches.** `cursorStoreCache`, `cursorTextCache`,
`cursorTranscriptCache`, `cursorTrackingCache`, `cursorStateCache.composerData`
(`cursor.ts:37-49`) are never pruned, unlike `fileCache`
(`collectors.ts:1137-1139`). Measured: 2.28 GB RSS at 13 minutes, +155 MB over
25 minutes. Prune on the same principle as `fileCache`. Note this is a *memory*
fix, not a latency fix — Cursor is not what is spending the deadline.

**3b. Bind the port before the first collection.** `index.ts:64` runs a full
`state.refresh({cmux: true})` before `Bun.serve` at `:101`. Consequences, both
observed tonight: the deploy health check reports UNHEALTHY while the server is
fine, and each of the 16,374 `EADDRINUSE` crash-loop restarts of a second hub
ran a complete collection before failing to bind. Serve first, collect after;
`/api/health` already distinguishes a fresh snapshot from a stale one.

### Phase 4 — the guards that cried wolf — **DONE, landed as #60**

Resolved independently before this program spawned: `#60` ("Pin deploy
docs-contract tests to the auto-ff runbook") re-pinned the `indexOf` to the
guard expression `[ "${ANTHILL_DEPLOY_QUIET_FLEET:-0}" = "1" ]` instead of the
usage comment, and re-pinned the DEPLOY.md wording. Verified green:
`tests/reference-docs.test.ts` 107 pass / 0 fail. Kept below for the record.

Both surfaced by tonight's deploy, both were overriding-bait.

**4a.** `tests/reference-docs.test.ts:732` uses
`deployScript.indexOf("ANTHILL_DEPLOY_QUIET_FLEET")`, which since #58 matches a
*usage comment* at line 20 rather than the guard at line 107. It reported
`Expected: > 3429, Received: 1032` — a real-looking safety failure with no real
defect behind it. Verified: occurrences are at lines 20 (comment), 107/108 (the
guard), 121 (help text); the guard is correctly positioned after the test gate
at line 85. Match the guard, not the prose.

**4b.** The same file expects DEPLOY.md to contain "freshly fetched
`origin/main`"; #58 rewrote that document and the wording moved. Re-pin to
current text.

These matter beyond tidiness: **tonight I waved both through with
`ANTHILL_DEPLOY_QUIET_FLEET=1`**, which is reserved for absence-of-data
failures, and these were not that. A guard that fires falsely trains the
operator to override it, and the next real failure rides through on the same
reflex.

---

## 4. Non-goals

- General board performance. Not a stated goal; passes are ~0.8-1.0s when healthy.
- The cross-source token drift (board 70.5M vs BurnBar 50.5M). Documented in
  `docs/CROSS-SOURCE-DRIFT-FINDING.md`, unrelated, and its test already passes.
- The crash-looping hub from `~/Developer/the-mountain-main`. Operational, not
  code; 3b removes most of its cost, but somebody should stop launching it.
- Reducing the 2,520 tracked agents. Retention is a product decision, and the
  measurement shows history is not what costs the deadline.

## 5. How each phase is verified

Every new test mutation-checked: break the rule it defends, confirm that
specific test fails, revert. This is not optional — three plan-supplied tests
were caught hollow earlier today, and two of my own in #56 passed identically
with and without the guard they claimed to defend until they were rewritten.

Live evidence comes from the #59 timing line, which now gives a direct read:

| Phase | Live success criterion |
|---|---|
| 1 | No watchdog drop beyond the tail budget; no pass over ~15s |
| 2 | No `PENDING=[cmux identity enrichment]` in steady state; controls stay enabled across a Cursor-active window |
| 3a | RSS flat across an hour |
| 3b | Restart answers `/api/health` within the deploy script's window, no override |
| 4 | Local-evidence gates green without `ANTHILL_DEPLOY_QUIET_FLEET` |

Fixture tests prove the code reads what it was told to read; they never prove
the source behaves. Each phase needs a reading off :4701 before it is called
done.

## 6. Risks

- **2b changes a freshness contract.** Identity data may lag. The mitigation is
  the age label and the staleness threshold; the risk is choosing a threshold so
  generous that a genuinely departed target stays actionable. Pick it from
  measured identity cadence, not by feel.
- **1c (abort) touches every collector's error path.** A cancelled call must be
  distinguishable from a failed one, or cancellation will be reported as fleet
  breakage.
- **1b changes timeouts that were each chosen for a reason.** The 4s-with-retry
  attribution budget in particular carries a documented rationale
  (`identity.ts:410-423`). Shrinking budgets to fit the parent must not silently
  discard that reasoning — where a collector genuinely needs more time than the
  deadline allows, that is an argument for moving it off the critical path
  (Phase 2), not for shortening it.
