# Lane `tail` — bound what is unbounded

**Read `docs/programs/collector-deadline/GROUND-RULES.md` first.** Then spec §1, §2, §3 Phase 1.

## Mission

A refresh pass has no bound on its publishing tail and no way to stop a pass the watchdog has
given up on. One observed pass ran **16.7 minutes**. Make every await in a pass answer to a
budget, and make an abandoned pass actually stop.

## Your fence

`src/server/state.ts`, `src/server/cmux.ts`, and the test files covering them
(`tests/collector-deadline.test.ts`, `tests/state-health.test.ts`, `tests/cmux.test.ts`).

**Not yours:** `src/server/identity.ts` — its timeout constants belong to the `identity` lane
even though task 1b would otherwise reach them. Skip identity in your budget sweep and say so
in your report.

## Tasks

### 1a — deadline the publishing tail

Six awaits after the control deadline sit under no timeout at all (line numbers as of
`46b0aba`): `state.ts:1149` `updateBindingsFromScan`, `:1216` `senderTranscriptTailsFor`,
`:1225` `witnessStore.record`, `:1231` `archiveStore.record`, `:1299` `ackStore.reconcile`,
plus the transcript `readFile` in the same tail.

Evidence this is real: of 79 watchdog drops, 13 exceeded 60s and one reached 16.7 minutes.
**No sum of budgets produces 16.7 minutes** — only an unbounded await does.

Give the tail one budget. On overrun: publish what exists, and log which step was still
outstanding — same discipline as #59's `PENDING=[...]` line, which is what finally named the
real culprit after four failed theories. Log **only** on overrun.

### 1b — make nested budgets fit their container

`collectCmuxNotificationSummaries` is allowed **30s** of strictly sequential RPCs
(`cmux.ts:578`, `:600`, `:624`) and `collectCmuxSidebar` **20s** (`cmux.ts:660`, `:684`) —
each larger than the whole 10s control deadline they run inside, and both run *before* identity
starts. One wedged `notification.list` blows the deadline with everything else healthy.

Derive per-collector budgets from the deadline rather than hardcoding, so the relationship
cannot silently drift apart again. A sub-timeout larger than its parent is not a timeout; it is
an unbounded wait with paperwork.

**Judgement call, and say which way you went in your report:** where a collector genuinely needs
more time than the deadline allows, shrinking it may just convert a slow success into a fast
failure. That is an argument for moving it off the critical path (a later phase), not for
clipping it. Do not discard a documented rationale to satisfy an inequality.

### 1c — the watchdog must cancel, not abandon

`state.ts:717-735` clears `#refreshing` and starts a replacement pass while the old
`#performRefresh` keeps running. `#superseded` (`:745`) suppresses only its *writes* — never its
I/O, its subprocesses, or its fire-and-forget ticks. Two passes then share one event loop and
each makes the next slower: observed **12.1s → 13.5s → 26.6s**.

Thread an `AbortSignal` so a superseded pass stops working.

**Risk to handle explicitly:** a cancelled call must be distinguishable from a failed one, or
cancellation gets reported to the operator as fleet breakage. That distinction needs its own
test.

### Also

`PROVIDER_FINALIZATION_ALLOWANCE_MS` (`state.ts:108`) is dead at the current setting —
`max(10_000, 7500 + 1000)` is always the floor, so the `+1000` never binds. It only takes effect
above `providerWaitMs > 9000`, at which point the remainder *shrinks* to 1s while the provider
cap grows. Fix it or delete it; do not leave it looking load-bearing.

## Non-negotiables

- Every test mutation-checked, with the before/after pasted into your report. 1c's
  cancel-vs-fail distinction is the one most likely to produce a hollow test — a test that
  passes because the pass was never cancelled at all proves nothing.
- Do not change what the board *publishes* on a healthy pass. This lane changes lifecycle and
  budgets, not snapshot content.
- Absence of evidence is not evidence: a cancelled or timed-out step must not be published as a
  fact about the fleet.

## Definition of done

`bunx tsc --noEmit` silent · your test files green · full `bun test` at 3598 pass / 2 fail ·
lane report section 4 holding pasted output · committed locally, path-scoped, not pushed.
