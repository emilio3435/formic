# July 30: the label is all that changed

**Direct answer to your question: the figure is annotated, not corrected. It is still wrong.**

Claim type: **I drove the running API and read the individual rows**, then checked them against the
physical bounds derived in `9a66e62`.

---

## 1. `71d7cb3` changed no value — it added a count

The SQL diff, in full:

```sql
-         SUM(CASE WHEN provenanceConfidence = 'exact' THEN 0 ELSE 1 END) AS costMissing
+         SUM(CASE WHEN provenanceConfidence = 'exact' THEN 0 ELSE 1 END) AS costMissing,
+         SUM(CASE WHEN totalTokens > ? THEN 1 ELSE 0 END) AS aggregatedRows
```

`SUM(totalTokens)` and `SUM(costUsd)` are untouched. **The 30-day total is unchanged by this fix**,
and July 30 still contributes exactly what it did before. `aggregatedInvocations` is a new *count*
beside the old numbers, not a correction to them.

**And the classification is circular.** A row is labelled aggregated when
`totalTokens > <threshold>` — that is, *because it is implausibly large*. Its largeness is then
explained by the label. There is no independent evidence in the data that those rows are sessions
rather than corrupt; the anomaly is its own diagnosis.

## 2. The per-invocation figures are still outside physics

July 30's individual rows, against the bounds in `9a66e62`:

```
rows returned              : 50 (the day reports 58 invocations)
breaching B1 (>2M tokens)  : 11
breaching B2 (>$31.25)     : 7

largest rows:
  Claude Code   572.4M tokens   $726.65   2026-07-30 21:06:39
  Claude Code   537.1M tokens   $683.61   2026-07-30 19:50:15
  Claude Code   512.8M tokens   $651.18   2026-07-30 21:06:39
  Claude Code   483.1M tokens   $613.68   2026-07-30 14:38:01
```

**The largest single row is 572.4M tokens — 286× the 2M physical ceiling — and $726.65, 23× the
$31.25 ceiling.** No aggregation label makes a row legal against a 1M-token context window: even
read as a whole session, it asserts ~572 full-context calls billed as one entry, at a cost no
single API interaction can incur.

So: **cost-per-invocation does not fall inside the fleet norm.** It does not fall inside the
*physical* bound, which is the stronger test and the one the label cannot satisfy.

## 3. One confirmed duplicate — and a correction to my own first read

Grouping by `sessionId@startTime`:

```
distinct session@startTime : 49 of 50 rows
keys appearing twice       : 1
  04437b43-…  ×2  →  483M + 476M  =  $1,218.34
  excess if it should count once: 476M tokens, $604.66 — 15% of the day's $4,120.68
```

**I first read the largest-rows list as showing several duplicate pairs and it does not.** Two rows
shared a visible timestamp prefix but differ beyond the 19 characters I printed. Grouping properly
found **one** duplicate, not several. Correcting it here because a 15% finding overstated as a
50% one is the overclaiming failure mode, and the ledger's whole point is that my confident
readings need the same scrutiny as anyone's.

That single duplicate is real and worth routing: the same session, the same start time, two rows
carrying near-identical cumulative totals, summed as if they were separate work.

---

## What this means

| Question you asked | Answer |
|---|---|
| Do per-invocation figures now fall inside the fleet norm? | **No.** 11 of 50 rows breach the token ceiling, 7 breach the cost ceiling, the worst by 286× |
| Does the 30-day total change? | **No.** The fix touched no `SUM`; totals are identical |
| Is the label all that changed? | **Yes** — and the label is derived from the anomaly it explains |

`71d7cb3` is not a bad commit. Making the payload say that `invocations` counts two different units
is genuinely useful and it answered a question I had asked. **But it closed a documentation gap,
not the defect**, and the ledger entry should say so: July 30 stays in *diagnosed and unfixed*.

**The consequence is unchanged and still HIGH.** July 30 is ~23% of the 30-day cost figure Emilio
reads, built from rows that cannot describe real API calls. A reader who now sees
`aggregatedInvocations: 16` may reasonably conclude the number has been explained. It has been
labelled.

## Recommended fix, and why it is not "exclude the big rows"

The ingestion guard from `9a66e62` §"How to assert these" applies here rather than any smoothing:
**a row breaching B1 or B2 is a parse or ingestion error to surface, not a cost to record.** The
question to settle first is what those rows actually are — a session total written repeatedly, a
cumulative counter read as a delta, or a genuine multi-call batch that needs its own unit. Until
that is known, excluding them would trade an overstatement for an understatement, and the honest
interim is to render the figure with the breach count beside it, exactly as `costKnown` now sits
beside `estimatedCostUsd`.

## Limits of this read

- **The endpoint returned 50 rows against 58 invocations.** I did not establish whether that is a
  cap, a filter, or the difference between rows and invocations — so the breach counts are lower
  bounds over a partial view, not a census.
- **I did not determine what an aggregated row actually represents.** I established that the label
  is threshold-derived and that the values breach physics; I did not read the BurnBar writer to
  find out what produces them. That is the next question and it belongs with whoever owns
  ingestion.
