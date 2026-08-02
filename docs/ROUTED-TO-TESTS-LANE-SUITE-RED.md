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

**Why I think it is worth your attention tonight rather than tomorrow.** The
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
