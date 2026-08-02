# Do other providers snapshot cumulatively? No — Claude Code alone, and it is not a July 30 anomaly

**Answer: not systematic across providers. Systematic across time within one provider.**

Both halves matter, and neither was the hypothesis going in — yours was that this might be
fleet-wide, mine had implied it was a July 30 event. It is neither.

Method: the same signature as `60b2aa9` — one session, several rows, totals growing with
`endTime` — applied per provider across **12 days** (22 July – 2 August), 472 rows.

---

## The result

```
provider      rows  sessions  multiRow  cumulative   excess$
Codex          243       243         0           0     $0.00
Claude Code    146       138         6           6  $1,440.26
Hermes          79        79         0           0     $0.00
Factory          3         3         0           0     $0.00
Cursor           1         1         0           0     $0.00
```

**Codex, Hermes, Factory and Cursor write exactly one row per session — `rows == sessions`, to the
row, across 326 sessions.** That is not a weak signal or a small sample for Codex: 243 sessions,
243 rows, zero repeats.

**Claude Code is the only provider with rows exceeding sessions**, and every one of its 6
multi-row groups shows the cumulative signature — 6 of 6, not a mixed picture. Whatever OpenBurnBar
does differently, it does only for Claude Code.

## So the framing changes, in both directions

**Against your hypothesis:** the double-count is *not* fleet-wide. Codex is the largest contributor
by row count and is clean, so the headline is not overstated across all providers, and the
correction is far smaller than "much more than $3,514."

**Against my own earlier framing:** it is *not* a July 30 anomaly either. **6 groups across 12
days** is roughly one every other day. July 30 was the largest instance because that day's sessions
were longest, not because that day was special in kind. **This is ongoing, and it will recur every
time a Claude Code session runs long enough to be snapshotted twice.**

That is the more useful shape for the dedup fix: it is not a historical cleanup, it is a standing
correction, and it should be verified against new data after it lands rather than only backfilled.

## Quantification, and why I trust it only as a floor

**≥ $1,440.26 excess across 12 days.** Two independent reasons it is a lower bound:

1. **8 of 12 days hit the endpoint's 50-row cap.** Rows beyond 50 are unseen, and July 30 alone
   reports 58 invocations against 50 returned. Multi-row groups whose partner row fell outside the
   cap are invisible to this method — they look like single rows.
2. **12 days of a 128-day record.** `earliestAt` is 2026-03-28. If the rate holds, the full-history
   excess is roughly an order of magnitude larger than what I measured, but I have **not** measured
   it and will not extrapolate a cost figure from a sample this truncated.

**What I will state:** the correction is real, ongoing, Claude-Code-specific, and larger than the
$1,256 I attributed to July 30 alone.

## A correction to my own method, which halved the finding

My first sweep grouped rows by **`sessionId@startTime`** and reported **3 groups, $643.60**. That
key is wrong: a session's cumulative snapshots do not always carry the same recorded `startTime`.
Re-keyed on **`sessionId` alone** the same 472 rows yield **6 groups, $1,440.26** — the correct
unit, and more than double the excess.

I caught it because the sweep's total contradicted the $1,255.84 I had already measured for July 30
alone. **An arithmetic impossibility in my own output was the only thing that flagged it** — a
12-day total cannot be smaller than one day inside it. Worth recording as the check that worked:
*when a new aggregate contradicts a measurement you already trust, the aggregate's method is the
first suspect, not the old number.*

## What this means for the dedup fix

The fix routed to the backend — keep the latest `endTime` per `sessionId` within the window, then
sum — is **correct and sufficient**, and this sweep sharpens two things about it:

1. **Key on `sessionId`, not `sessionId + startTime`.** My own first attempt shows how easy that
   error is, and it would silently halve the fix's effect while appearing to work.
2. **It can be applied unconditionally.** Since every other provider is strictly 1:1, deduplicating
   by session is a no-op for Codex, Hermes, Factory and Cursor — so the fix needs no
   provider-specific branch, and adding one would be an unnecessary place for the behaviour to
   drift.

## Limits

- **50-row cap, 8 of 12 days truncated.** Every count here is a floor.
- **12 days of 128.** The rate is measured; the full-history total is not.
- **I did not check whether a session can snapshot more than twice.** All 6 groups here are pairs;
  a longer session might produce three or more rows, which would compound the overcount rather
  than double it.
