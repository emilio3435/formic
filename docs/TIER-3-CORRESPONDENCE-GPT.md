# Which figures have a tier-3 check: none, and exactly one is constructible

You asked plainly, so: **no figure on this board is currently checked against an independent
source. Everything we built today verifies internal consistency. Almost nothing verifies
correspondence with reality.**

That is worth stating exactly, because the near-miss below shows how easily it reads the other way.

---

## The one tier-3 check that is constructible — and why it does not work yet

The board derives agents from **transcript files on disk**. BurnBar derives usage from **its own
ingestion**, in a separate application, into an encrypted SQLite store this repo only reads. Two
genuinely independent paths to the same underlying fact.

**And they join.** 46 of 50 burnbar rows in the last 24h carry a UUID `sessionId` that matches a
board `sourceSessionId` exactly. The other 4 are `cron_*` jobs the board does not track.

So I ran it:

```
session        board sessionTotal   burnbar sum    ratio
978c3fd3-b161            7,601        128,172      16.86
7a3013d5-422a           20,937        152,555       7.29
bb9af125-b217           11,790        138,598      11.76
c8d5de07-7faf           38,055        100,533       2.64
```

**Two-to-seventeen times apart, on every session, in the same direction.** For about ninety seconds
that looked like the first correspondence failure anyone had found.

**It is not a defect. It is a unit difference, and both sides are right.** `collectors.ts:664-676`
says so in its own comment:

> *"Size of one call — cache reads **included**, because they occupy the window."* (`total`)
> *"Consumption over the session — cache reads **EXCLUDED**. Every call re-sends the whole cached
> prefix, so summing usageTotal charges the same token repeatedly."* (`sessionTotal`)

The board's `sessionTotal` measures **consumption**. BurnBar's `tokens` measures **processed** — the
Usage tab already calls it `PROCESSED TOKENS`, which I noted this afternoon was the honest noun.
The 2.6–16.9× spread is the cache multiplier, which is 97–99% of every call on this fleet.

**So the only available tier-3 check cannot discriminate, because the two sources deliberately
measure different quantities and nothing publishes the relationship between them.**

**To make it work:** burnbar's per-session sum should be compared against the board's
**cache-inclusive per-call `total` summed over that session's calls**, not against `sessionTotal`.
That relation is testable and would be **the first genuine correspondence check on this board.**
Today the board publishes `total` per call and `sessionTotal` per session and never the sum that
would bridge them.

## The one tier-3 mechanism that already exists — and it is not a number

`enrichCmuxIdentity` decides which session is on which pane by combining **cmux's terminal report**
with the **operating system's process table and open file handles** (`lsof`). Those are two
independent sources, and the convergence is what makes `exact` mean something.

**That is real correspondence checking, and it is the only instance I can find.** It is also not a
published figure — it is a *gate*. So the board does verify one thing against reality, and it
verifies identity rather than any quantity.

Worth noting because it explains why the write path ended up the most trustworthy surface today: it
is the one built on two sources.

## Everything else, by source

| Figure | Source | Second source? |
|---|---|---|
| agent counts, states, rollups | transcript files, one pass | **none** |
| `contextPct`, peak, median | transcripts ÷ config constant | **none** |
| cost, tokens, invocations, burn rate | burnbar store | **none** |
| `quotaPressure.usedPercent` | `provider_quotas.json` | **none** |
| `activeMs`, `observedWindowMs` | derived in-process | **none** |
| archive, attention, bindings, triage | this app's own stores | **none** |

**Every row is single-sourced.** The identities I wrote compare figures *within* a row, never
across rows — which is precisely why eleven of thirteen are tier 1.

## The honest statement of what today built

**We verified that the board's arithmetic is self-consistent, comprehensively.** Partition
identities, subset bounds, window containment, the button/endpoint invariant, physical bounds on
per-unit figures. All of it real work, and all of it internal.

**We verified almost nothing about whether the board's numbers correspond to the world.** The one
mechanism that does — identity resolution — was built for a different reason, and the one check
that could — board against burnbar — is blocked on a unit reconciliation nobody has written.

**That is not an argument the day was wasted.** Internal consistency is a precondition, and the
defects it found were real: the dedup bug, the $1.17, the suppressed $11,939, the misrouted Send.
**But it is the ceiling on what any of it can tell you.** If the collector misses a hundred agents,
every check we wrote today still passes.

## What I would route

1. **The collection cross-check**, already routed: count transcript files on disk against
   `totals.tracked`. Filesystem versus collector output — genuinely independent, and the first
   check that could fail when collection is wrong.
2. **The board↔burnbar token reconciliation.** Publish the per-session sum of cache-inclusive
   per-call totals, then assert it against burnbar's per-session sum. **46 sessions join today**, so
   it is testable immediately and non-vacuously.
3. **Nothing for the quota figure.** There is no second source and I cannot invent one. It should
   carry its denominator and unit so a human can attempt the check the system cannot.

## The near-miss, recorded because it is the fourth today

I had the 16.86× ratio and the words *"first correspondence failure"* before I opened
`collectors.ts` and found the comment explaining that the two numbers measure different things on
purpose.

**A cross-source comparison is only a check once the units are reconciled** — otherwise it is a
generator of alarming ratios. That is the same shape as the July 30 per-invocation figure, which
averaged sessions and calls together, and it is worth stating as its own rule: **before comparing
two sources, prove they measure the same quantity. A ratio between different units is not a
finding, it is a category error with a number attached.**

## Limits

- **One 24-hour window, 50 rows**, capped by the invocations endpoint.
- **I did not run the corrected comparison** — the board does not publish the per-session sum of
  per-call totals, so I could not construct the left-hand side without re-deriving it from
  transcripts myself.
- `/api/attention` remains unenumerated for published figures.
