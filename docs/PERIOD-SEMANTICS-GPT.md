# Boundary rollovers: three period semantics, labelled identically

You asked whether any figure changes meaning at a boundary without saying so. **Yes — and the one
that does it worst inverts the reading rather than merely blurring it.**

Ranked by consequence-if-real.

---

## 1. HIGH — the newest bar on every chart is a partial period drawn at full height

`burnbar.ts:810-812` buckets by calendar alignment:

```sql
bucket === "1h" ? strftime('%Y-%m-%dT%H:00:00.000Z', startTime)
                : strftime('%Y-%m-%dT00:00:00.000Z', startTime)
```

Buckets snap to clock hours and UTC midnights. The **window** does not — it slides, ending at
*now*. So the final bucket always contains only the elapsed fraction of its period, while carrying
a label that names the whole one.

**Proven directly, same bucket, two windows:**

```
bucket labelled 2026-08-02T13:00, window ending 14:00 : 13,264,342 tokens
bucket labelled 2026-08-02T13:00, window ending 13:30 :  8,931,957 tokens  (67%)
```

**Identical label, different value, and no field anywhere says one is partial.** A bar labelled
"13:00" means *the 13:00 hour* in one chart and *the first half of the 13:00 hour* in another.

Daily buckets do the same, and here is why it matters more than a blurred edge:

```
median prior full day        : 275M tokens
today, at 58% elapsed        : 183M tokens  → renders as 67% of a median day
```

**The chart says today is a third below normal. Normalised for elapsed time, today is running
~15% above it** (183M ÷ 0.58 ≈ 315M). The newest bar — the one an operator reads to answer *is burn
rising* — does not merely understate, it **reverses the answer**. And it is wrong by a factor that
shrinks through the day, so the same chart tells a different story every time it is opened, with
nothing changing in the fleet.

**Defence quality: none, and the omission is pointed.** Each point already carries
`tokensMissing`, a field for *"this bucket's measurement is incomplete."* There is no counterpart
for *"this bucket's time is incomplete."* The authors modelled one kind of incompleteness in the
same payload and not the other.

**Named fix:** emit `coverage` per bucket — elapsed ÷ period — and let the chart render a partial
bar distinctly (hatched, faded, or normalised with the raw value on hover). This is the rule the
codebase already applies to cost and tokens: *carry the gap beside the value*. Buckets are the one
place it was never extended to.

## 2. MEDIUM — "done this hour" is neither sliding nor calendar; it resets at boot

Restating a known finding (`d903d20`) in this frame, because the frame is what makes it
comparable: the completion counter runs from process start via `observedWindowMs`. It does **not**
reset at midnight and does **not** slide. **It resets when someone deploys.**

So the board carries three different period semantics simultaneously:

| Figure | Period actually means | Label implies |
|---|---|---|
| Sparkline buckets | calendar-aligned, trailing edge partial | a whole hour / day |
| Burn rate (tokens/min) | sliding window average | an instantaneous rate |
| "N done this hour" | since process start | a wall-clock hour |

**Three semantics, one vocabulary.** Any comparison an operator makes across two of these cells is
comparing periods that do not mean the same thing, and nothing on the board distinguishes them.
`observedWindowMs` is a genuine partial mitigation for the third — it lets the label say
*"in 5m observed"* — which makes its absence from the other two more conspicuous, not less.

## 3. What I checked and did *not* find

Reporting the negative, since a boundary audit that only finds faults has not been calibrated.

- **The calendar arithmetic itself is correct.** `strftime` handles month lengths, month ends and
  the July→August rollover properly; buckets across 2026-07-31 → 2026-08-01 are contiguous and
  correctly dated. **There is no month-boundary bug** — the defect is edge-partiality, which is
  orthogonal to calendars and would exist with any bucketing scheme.
- **No timezone drift between bucket labels and window bounds.** Both are UTC (`…Z` in the
  `strftime` format string and in the echoed `from`/`to`). The `startTime` parsing defect I
  reported earlier (`USAGE-TAB-AUDIT-GPT.md` §2) is in the client's relative-time rendering, not
  in this bucketing.
- **Gaps are gaps, not zeros.** A 24-hour window returned **22** buckets, not 24 with two zeroed.
  Absent hours are omitted rather than fabricated as zero activity — the right choice, and the
  opposite of the `?? 0` mistake I made in my own harness earlier today.

---

## The shape, for the standing rules

This is the retention finding's sibling, and it fits the rule you extracted from it exactly. A
bucket labelled `13:00` **publishes a period** while the system **delivers a fraction of one**, and
there is **no measurement of the delivered fraction anywhere** — `coverage` does not exist. Policy
published, different thing delivered, counterpart absent.

Which suggests the rule generalises past constants: **any label naming a period is a claim about
coverage, and needs the same counterpart a total needs.** `tokensMissing` exists because someone
asked "what fraction of this value is real?" Nobody asked "what fraction of this *period* is real?"
— and the answer, for the most-read bar on the chart, is *"however far through the hour you
happen to be looking."*
