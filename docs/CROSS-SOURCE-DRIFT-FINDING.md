# The collector is right and OpenBurnBar's record is incomplete

Written for the tests lane, which owns `tests/cross-source-token-agreement.test.ts`.

## The failure

```
fe1d8020-259: this board counted 293,235 and OpenBurnBar recorded 112,258
(161.2% OVER — OUR collector is high, look in src/server/collectors.ts)
```

## The verdict

**The collector is correct. The number the board published is right to the
token, and OpenBurnBar's record for this session stops partway through it.**

This was not settled by reading the collector, which would only have confirmed
that it does what it was written to do. It was settled by recomputing the figure
from the raw transcript by hand, without touching `collectors.ts` at all.

`~/.claude/projects/-Users-emilionunezgarcia-Developer-the-mountain-main/fe1d8020-2592-4b99-bdd2-3d6974e79730.jsonl`
holds 31 lines, 12 of which carry a `usage` block, across **7 unique message
ids** — Claude rewrites a message as its turn streams, so 5 of the 12 are
duplicates. Summing per-call size over the 7 unique ids:

| | recomputed by hand | published by the board |
|---|---|---|
| processed (cache-inclusive) | **293,235** | **293,235** |
| consumption (cache-exclusive) | **13,775** | **13,775** |

Both exact. The dedup did its job: had it counted the 5 duplicate rows, the
figure would have been well above 293,235, not equal to an independent sum.

## Why 112,258 is not a disagreement

It is the sum of the session's **first three calls**, exactly:

| call | input | output | cache read | cache create | size | running total |
|---|---|---|---|---|---|---|
| 1 | 6 | 341 | 35,489 | 0 | 35,836 | 35,836 |
| 2 | 1 | 301 | 35,489 | 2,254 | 38,045 | 73,881 |
| 3 | 1 | 139 | 37,743 | 494 | 38,377 | **112,258** ← BurnBar |
| 4 | 1 | 1,173 | 38,237 | 4,871 | 44,282 | 156,540 |
| 5 | 1 | 199 | 43,108 | 1,385 | 44,693 | 201,233 |
| 6 | 1 | 139 | 44,493 | 408 | 45,041 | 246,274 |
| 7 | 1 | 1,266 | 44,901 | 793 | 46,961 | **293,235** ← board |

BurnBar's total lands **exactly** on a call boundary. That is the arithmetic
signature of a recorder that stopped writing, not of two applications disagreeing
about how to count. Two systems that genuinely disagreed about cache accounting
would differ by some ratio of the cached prefix; they would not agree to the
token for three calls and then diverge cleanly.

So this is neither of the two possibilities as posed. It is not the collector
overcounting, and it is not the join or the units — the join is right (session
ids match; 253 of 254 sessions agreed to within 5% in the same run) and the unit
is right (a wrong unit could not produce an exact prefix). It is a third thing:

**OpenBurnBar's cumulative row for a session can stop advancing while the session
keeps working, and the board is then the more complete source, not the wrong one.**

## It is not transient lag

The obvious benign explanation is that BurnBar was simply a few seconds behind.
Two measurements rule that out:

- Re-read minutes later: BurnBar's `endTime` for the row moved forward
  (`20:28:49.460` → `20:29:02.414`) while its token total stayed at 112,258. It
  touched the row and did not catch up.
- Widening the query window to 2, 7 and 30 days returns the same single row with
  the same total. There is no later row anywhere for this session.

Also worth recording, because it kills the tidiest proposed fix: **every one of
the 254 joined sessions had board activity after BurnBar's newest row**, the
agreeing 253 included. So "compare only settled sessions" does not narrow the
population — it empties it. Lag is the normal state; the question is only whether
BurnBar converges, and for 253 sessions it does.

## What this means for the test

The assertion is worth keeping and the tolerance should not be relaxed — 5% is
the claim, and 253 of 254 sessions met it. Two things are wrong around it:

1. **The failure message makes a false accusation.** When the board reads HIGH,
   `OUR collector is high, look in src/server/collectors.ts` is the wrong first
   hypothesis, and it costs whoever reads it a trip into the wrong codebase — the
   exact harm the message was written to prevent. When the board is high the
   leading hypothesis is an incomplete BurnBar record, and the evidence that
   settles it is whether BurnBar's total is a prefix-sum of our calls.

2. **The claim depends on a third party's write cadence**, which we do not
   control and cannot make deterministic. As written the test asserts "our number
   equals theirs"; what is actually true and defensible is "our number equals
   theirs, or exceeds it by a whole number of trailing calls."

The discriminator is precise and mechanical: **when the board is high, BurnBar's
total must equal a prefix-sum of the board's per-call sizes.** If it does,
BurnBar is behind and we are not wrong. If it does not — if it falls between call
boundaries, or exceeds our total — that is a real accounting disagreement and
belongs in `collectors.ts`.

### This is now mechanical — the series is published

`GET /api/debug/session-calls?agent=<id>` returns the board's per-call sizes and
their cumulative sums. Verified live against the session in question:

```
calls      [35836, 38045, 38377, 44282, 44693, 45041, 46961]
prefixSums [35836, 73881, 112258, 156540, 201233, 246274, 293235]
                          ^ OpenBurnBar's 112,258 — call 3 of 7
```

`sessionProcessed` is now reduced FROM that series rather than off the rows
separately, so a prefix check sums exactly the numbers the board totalled — one
derivation, not two that agree today. Codex reports the series as **absent**
rather than empty, because it publishes session-cumulative totals and has no
call boundaries; `[]` would assert it made no calls.

The series is deliberately not in the snapshot. A live snapshot is 2.25MB
against a 2MB SSE backlog budget and the largest session here has 1,575 calls,
so it is stripped where a CollectedAgent becomes an AgentSnapshot and served on
demand instead.

The failure message no longer names a culprit. It reports both figures, where
each came from, the direction, and points here.

## The part that should not be lost

The check did its job. It is the only assertion in this suite that can fail
because something outside this repository disagrees, and the first time it fired
it produced a genuine, previously unknown fact: **OpenBurnBar's per-session
totals can be silently incomplete.** Nothing internal to this board could have
discovered that, and any figure we ever reconcile against BurnBar inherits it.
