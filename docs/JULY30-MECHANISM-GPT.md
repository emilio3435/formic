# July 30: the mechanism, named

**Answer: the rows are genuine cumulative session totals. They are not corrupt. The unit is wrong,
and summing them double-counts.**

You offered two outcomes — a nameable write path, or corruption and a $3,514 overstatement. **The
true answer is the third one**, and it is more actionable than either: real data, wrong
aggregation.

---

## 1. The writer is not in this repository

No `INSERT`, `UPDATE`, `CREATE TABLE` or `DELETE` exists anywhere in `src/server/burnbar*.ts`. The
hub only ever reads `token_usage` from `openburnbar.sqlite`, an **SQLCipher-encrypted** database
whose key lives in the Keychain (`burnbar.ts:374, 417-425`). **The writer is OpenBurnBar, a
separate application**, and no code path in this project can produce or alter those rows.

So the writer cannot be named from here. But the evidence you asked for is recoverable from the
data itself, and it is unambiguous.

## 2. The independent evidence: same start, advancing end, growing totals

Two of July 30's 48 sessions have more than one row. Sorted by **`endTime`**:

```
85ecd016…   endTime 12:32:48 → 513M tokens
            endTime 13:31:04 → 572M tokens      growing: YES
04437b43…   endTime 13:49:35 → 476M tokens
            endTime 14:00:36 → 483M tokens      growing: YES
```

Both pairs share an **identical `startTime`**, carry **advancing `endTime`s**, and their token
totals **grow monotonically**. That is the signature of a cumulative snapshot: a session's running
total, re-recorded as the session progresses, anchored to the moment it began.

**This is the mechanism, and it is evidence rather than inference.** A 572M-token row is not
impossible for a lane that ran all day on a 1M-context model with heavy cache reads — it is
impossible only as *one call*. Read as *one session*, it is ordinary.

## 3. So what is actually wrong

Three separable statements, which the current payload conflates:

1. **The rows are correct.** Each is a true cumulative total for its session at that moment.
2. **`invocations` is the wrong unit.** It counts snapshots. 58 on July 30 is not 58 API calls.
3. **`SUM(totalTokens)` double-counts.** Adding two snapshots of the same session adds the earlier
   one twice, because the later snapshot already contains it.

**Quantified, from the rows I can see:**

```
85ecd016  513M + 572M summed = 1,085M   true total 572M   excess 513M / $651.18
04437b43  476M + 483M summed =   959M   true total 483M   excess 476M / $604.66
                                        combined excess ≈ $1,255.84
```

That is **30% of July 30's $4,120.68**, from two sessions. **A lower bound**, not the answer — the
endpoint returned 50 of 58 rows, so sessions with snapshots outside that sample are uncounted.

**This also explains why it is July 30 specifically.** That was the 58-commit backend-wave day:
lanes ran long, unbroken sessions, so several accumulated large cumulative totals and got snapshotted
more than once. Days with shorter sessions have one snapshot each and look normal — which is
exactly the distribution I measured.

## 4. Correcting myself, again, and the same way

In my previous read I reported that rows had `endTime` **preceding** `startTime` — `startTime
21:06:39` against `endTime 13:31:04` — and was ready to file it as a data-integrity defect.

**It is my own display artifact.** I printed `.slice(11,19)`, the time of day only, and compared
across rows whose *dates* differ. Checking the full timestamps: **0 of 50 rows have `endTime`
before `startTime`.**

That is the third phantom finding my own formatting has produced today, after `?? 0` on an error
body and guessing field names that turned out to be `priorSpend`. All three share one shape:
**I compared a rendering of the data instead of the data.** The rule that follows is the same one
check 6 gives for layers — *compare the values, not your view of them* — and it belongs beside the
enumerate-the-keys note.

## 5. What to fix, and what not to

**Not a guard that drops large rows.** They are real. Dropping them would understate.

**The fix is to deduplicate by session before aggregating** — for each `sessionId`, keep only the
snapshot with the latest `endTime` within the window, then sum. That is a query change in
`burnbar.ts`, not an ingestion change, and it needs no cooperation from OpenBurnBar.

**And `invocations` should stop being one number.** It currently adds calls and session snapshots
together. `aggregatedInvocations` (`71d7cb3`) already identifies them by threshold — now that the
mechanism is known, they can be identified *properly*, by whether a session has multiple rows, and
counted separately rather than labelled.

**The physical bounds still apply, with their meaning corrected:** B1 and B2 bound a *call*. They
should be asserted against deduplicated per-call rows, and a row exceeding them should be read as
"this is a session, not a call" — which is now a testable statement rather than a circular one.

## 6. What this means for the headline

Once deduplicated, July 30 falls by **at least $1,256** of its $4,120, and the 30-day total by the
same amount — **roughly 9% of the $14,130 Emilio reads**, with the true figure lower still once the
8 unseen rows are included.

**It is not the full $3,514 you offered as the corruption case.** July 30 really was an expensive
day; it is overstated, not fabricated.

## Limits

- **50 of 58 rows.** I still have not established whether that is a cap or a filter, so every
  quantity here is a lower bound.
- **I did not read OpenBurnBar.** The cumulative behaviour is inferred from its output, which is
  strong evidence but not the writer's source. If someone has access to that project, confirming
  it there would close this completely.
- **I checked only July 30.** Whether other days carry multi-snapshot sessions is unmeasured, and
  it determines whether this is a one-day correction or a systematic one.
