# Today is clean, the behaviour stopped on 1 August, and my "ongoing" claim was wrong

**Direct answer: today is not double-counted. The figure Emilio is watching is not inflating as we
work.**

That reverses what I told you an hour ago, and the reversal is the finding.

---

## 1. Today: 126 Claude Code sessions, 126 rows, zero repeats

The first look showed zero, but the endpoint capped at 50 rows and today has more — so I queried
**hour by hour** to defeat the cap:

```
today, queried hour by hour → 173 unique rows (only 1 hour hit the cap)
Claude Code: 126 rows · 126 sessions · 0 multi-row sessions
rows-per-session distribution: { 1: 126 }
TODAY excess: $0.00
```

**Every session today has exactly one row.** Not a truncation artifact — this is a near-complete
census of today, and it is clean.

## 2. Why: the writer's behaviour changed on 1 August

Tracking the signature per day tells the story:

| Day | Claude Code rows | max row | rows >2M | multi-row sessions |
|---|---:|---:|---:|---:|
| 2026-07-22 | 44 | 66M | 13 | 1 |
| 2026-07-23 | 106 | 95M | 39 | 5 |
| 2026-07-28 | 22 | 39M | 8 | 0 |
| 2026-07-29 | 3 | 25M | 1 | 0 |
| **2026-07-30** | 23 | **572M** | 8 | **2** |
| 2026-07-31 | 36 | 164M | 2 | 1 |
| **2026-08-01** | 45 | **1M** | **0** | **0** |
| **2026-08-02** | 78 | **1M** | **0** | **0** |

**On 1 August the maximum row size drops from 164M to 1M and never returns.** Zero rows over 2M,
zero multi-row sessions, on both days since. Something in OpenBurnBar changed — it now writes
per-call rows.

So the dedup fix is **historical cleanup after all, not a live correction.**

## 3. Correcting myself: "ongoing" was an inference I did not check

An hour ago I wrote that this *"is ongoing, and it will recur every time a Claude Code session runs
long enough to be snapshotted twice,"* and recommended verifying the fix against new data rather
than only backfilling.

**That was wrong.** I had 12 days of data and read the *rate* — 6 groups over 12 days, roughly one
every other day — without ever plotting it against **time**. Had I done so, the last two days'
zeros would have been visible immediately. I extrapolated a trend from an average, which is the
same error as reading a partial bucket as a full one.

You gave me the check that caught it: *today's sessions have run three hours across five lanes, so
today should be producing the same shape right now.* It isn't, and that absence is what exposed the
change. **The prediction was the test**, and it failed in the useful direction.

## 4. A session can snapshot three times, not just twice

Answering the follow-up directly:

```
rows-per-session, Claude Code, 12 days: { 1: 132, 2: 4, 3: 2 }
maximum rows for one session: 3
```

So the overcount is not bounded at double. A three-snapshot session contributes its cumulative
total three times over. Small in this sample — 2 sessions — but it means any dedup must keep
*one* row per session, not merely drop a duplicate.

## 5. The more important thing this exposes: two separate defects, and dedup only fixes one

The per-day table shows a gap I had been treating as one problem:

- **Multi-row sessions** — 1, 5, 2, 1 across those days. These are **double-counted**, and dedup
  fixes them.
- **Rows over 2M that are single-row sessions** — 13, 39, 8, 1, 8, 2. These are **not**
  double-counted. One row, one session, a real cumulative total.

On July 30, 8 rows exceed 2M but only 2 sessions have multiple rows. **So most of the oversized
rows are singletons, and dedup will not touch them.**

The consequence matters for what you tell Emilio: **dedup will reduce the headline by roughly the
$1,440 I measured, not by the full weight of the anomalous days.** The remaining large rows are
genuine session totals that are *correctly summed* — the total is closer to right than my earlier
notes implied. What stays broken is the **unit**: `invocations` counts sessions and calls together,
so every per-invocation figure across that period is meaningless, and the physical bounds will keep
firing on rows that are not actually wrong.

## 6. What I would tell the backend now

1. **Dedup is still correct** — keep the latest `endTime` per `sessionId`, and keep *one* row, not
   "drop the second."
2. **It is backfill only.** Nothing since 1 August needs it, so it can be validated entirely
   against history and does not need to hold for new data.
3. **It will not fix the oversized-row problem**, which is a unit problem, not a duplication one.
   Those rows need a `unit` or `rowKind` field distinguishing session-total from call, which is
   what `aggregatedInvocations` gestures at without providing.

## Limits

- **I did not establish what changed in OpenBurnBar on 1 August**, only that its output did. It is
  a separate application and I cannot read it.
- **Sub-day sampling used 4-hour windows** for the 12-day sweep and 1-hour for today. One 4-hour
  window could still cap at 50 and hide rows, so the historical counts remain floors. Today's
  figure is the solid one.
- **Two days is a short "it stopped" window.** If a long session spanning 1 August produces a late
  snapshot, the behaviour could reappear. Worth one re-check in a few days rather than treating
  this as closed.
