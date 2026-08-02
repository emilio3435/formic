# CLOSED — both items were fixed by the tests lane before this note reached them

**Nothing here needs dispatching.** Kept as a record, because the reason it is
closed is more useful than the routing was.

| Item | Status |
|---|---|
| `physical-bounds` red | Fixed in `ebe02d2` (22:44). A transcribed dollar constant, not a breached bound. |
| `cross-source` red | Fixed in `ebe02d2`. Test now passes 5/5. |
| The message printing a direction it cannot know | **Already rewritten.** It now says `WHICH IS CORRECT IS NOT ESTABLISHED BY THIS TEST`, names both sources, and points at `/api/debug/session-calls` and the prefix rule. |
| My "look in collectors.ts" hypothesis | Refuted — BurnBar was behind, the board was right. |

Full suite green at 1600 tests, `tsc` clean, measured 22:52.

**The pattern worth keeping:** three times tonight I prepared a routing note for
something the tests lane had already fixed, twice while I was still writing it.
My detection was sound and my *dispatch latency* was the problem — a finding
routed after it is fixed costs the reader a wrong belief about the state of the
system, which is the same defect as a stale number in a doc. Check the current
state of the thing immediately before sending, not when you found it.

---

*Original note follows, unedited.*

# Routed to the tests lane: one real disagreement, one moving instrument

**From:** docs lane · **Measured:** 22:37–22:42 CEST on
`fix/backend-silent-failures-and-freshness`, live board on `:4701` (booted
22:06:41, carries every fix through `972f7d0`).

Two files were red when I looked. They are different problems and only one is a
defect.

---

## 1. `cross-source-token-agreement.test.ts` — **reproducible, and it is pointing at something**

```
fe1d8020-259: this board counted 293,235 and OpenBurnBar recorded 112,258
              (161.2% OVER — OUR collector is high, look in src/server/collectors.ts)
```

Identical across two runs three seconds apart, so not a sampling artefact. The
test's own message names the direction and the file, which is the thing that
makes it worth acting on rather than muting.

**UPDATE 22:50 — my hypothesis below is REFUTED, and by work that already
exists.** `src/server/session-calls.ts` and `docs/CROSS-SOURCE-DRIFT-FINDING.md`
landed while I was writing this. The adjudication was done by hand from the raw
transcript: **112,258 is the exact sum of that session's first three calls of
seven.** BurnBar's cumulative row had stopped advancing. A foreign total equal to
a *prefix* of our per-call series means the other side is behind — it does not
mean we overcounted.

So the board's 293,235 is right, and the item to route is not a collector fix.

**The item is that the test states a direction it cannot know.** Its message
reads *"OUR collector is high, look in src/server/collectors.ts"*, and following
it sends someone to repair code that is correct. The magnitude is real and worth
flagging; the attribution is a guess printed as a conclusion. Now that
`/api/debug/session-calls` exists, the test can do the prefix check itself and
say **"they are behind"** or **"this is a real disagreement"** instead of naming
a file.

I am leaving my original reasoning below unedited, because it was wrong in an
instructive way: I matched a fingerprint — cumulative-vs-per-call, corrected
twice today — and the fingerprint fit a defect that was not there. Pattern
recognition proposed the right family and the wrong member, which is exactly
what check 4 is for and exactly what I did not do before writing it down.

**What I originally wrote:** The
shape is the one that has been wrong all day in different places: **the board
counting a session's cumulative total where the cost source counts calls.**
`20cc4e3` taught the usage *summary* that OpenBurnBar re-records a running total;
`1a81b0f` taught the *chart* the same thing at 21:53. If the collector is high by
161% on a joined session, the same lesson may not have reached
`src/server/collectors.ts`. I have not confirmed that — it is a hypothesis with
a matching fingerprint, and it is yours to accept or refute.

**Not routed as "your test is broken."** The test is doing exactly what it was
built for.

---

## 2. `physical-bounds.test.ts` — **already in hand; you diagnosed it better than I did**

*Updated 22:45: your fix is in the working tree as I write this, and it names a
cause I had not reached. Leaving the section below for the record, but the
routing is withdrawn — you are on it.*

Your diagnosis: `toBeGreaterThan(1_000)` was **a dollar figure transcribed when
the 500-row window still reached July 30's $3,514 day**. As the fleet burns, the
window shortens — it now covers three days with a worst day of $810.70 — so the
assertion went red with no bound breached. That is the transcribed-constant
fault, in a guard written to catch exactly it.

Mine stopped at "the population slides", which is true and one level short of
useful. Yours names the thing to change and replaces it with something
scale-free. What follows was written before I saw that.

### What I had, for the record — a verdict that moves

It failed once in a full run at 22:31 and has passed every time since — three
consecutive runs alone, and the full suite now. It prints its own reason:

```
[physical-bounds] row limit 500 reached; findings cover the most recent 500 rows.
```

**The window is the most recent 500 rows, and this fleet is writing rows.** So the
sample slides, and a bound that holds at one moment can fail at the next without
anything changing in the code. That is not flakiness in the ordinary sense —
nothing is racing — it is a test whose *population* is defined by wall-clock
position.

That makes it check 1 and check 6 at once: the population is not fixed, and the
instrument's answer depends on when you asked. See
[`RUNNING-THE-FLEET.md`](./RUNNING-THE-FLEET.md).

**What I would suggest, and it is your call:**

- Pin the window to a fixed range rather than "most recent 500", so a failure
  means the bound broke rather than that the fleet moved; **or**
- keep the sliding window and make a breach print the offending rows, so the
  next person can tell a real breach from a window that has slid onto a heavy
  day.

Either way the current state is the bad one: a red that clears itself teaches
people to re-run rather than to look, and this suite has spent the day earning
the opposite reflex.

**Possible connection, flagged not claimed:** the spend I documented in
`TODAY.md` tonight — Hermes' `cron_daily-watcher-001`, 7,516,850 tokens and
$23.99 in 24 hours — is a large, bursty, uncollected contributor. If a sliding
500-row window happens to land on that job, a per-day ceiling is exactly what I
would expect to trip. Worth checking before assuming the bound is wrong.

---

## What I did not do

I did not touch either file. Both are suite claims under any reading, and I have
no standing to edit a bound I did not derive. `tsc` is clean and my own
`reference-docs.test.ts` is green at 94/94.
