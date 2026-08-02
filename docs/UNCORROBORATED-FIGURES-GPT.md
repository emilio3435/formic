# The map of uncorroborated figures — numbers with nothing to disagree with

You are right that this is a different map from untested paths, and that we only had one of them.
Every mechanism built today — the identities, the bounds, the button/endpoint invariant — works by
**comparing two things that should agree**. A number with no sibling is invisible to all of them.

Ranked by consequence. Measured against the running board at 21:55.

---

## First, a nuance `getUsageSeries` adds to your framing

The series defect is the proof of the thesis, and it sharpens it: **series and summary shared a
source and still disagreed**, because they applied different aggregation — the summary
deduplicated cumulative snapshots and the series did not.

So corroboration comes in three strengths, and only the third is worth much:

| | Catches | Misses |
|---|---|---|
| **No sibling** | nothing | everything — the defect survives until someone reads the code |
| **Sibling from the same source** | transport and rounding errors | **aggregation errors — exactly the series defect** |
| **Sibling from an independent derivation** | most things | shared upstream assumptions |

**The ward is an example of the middle case.** I cross-checked it just now: ward says Cursor is at
7,610 tok/h; summary `byProvider` says 7,610 tok/h. They agree — **because they read the same
table**, not because two derivations converged. That agreement would not have caught the series
bug, and should not be counted as corroboration.

---

## 1. HIGHEST — `quotaPressure.usedPercent`

```
/api/usage/ward → quotaPressure: [{ provider: "Cursor", label: "API usage", usedPercent: 81.428 }]
/api/usage/quotas → source: "provider_quotas.json", confidence: "exact" | "unavailable"
```

**Nothing on this board can check that number.** It arrives from `provider_quotas.json` — a
*different source* from the usage table every other figure derives from — and no other published
value is a function of it.

What the board independently knows about Cursor, at the same moment:

```
tokens 182,650   invocations 2   cost null (unpriced)
```

**81.4% of a quota, from 2 invocations.** The units are not stated — requests, tokens, dollars,
seats — so even the operator cannot reconcile it by hand. And it is the *one provider whose cost
the board cannot report*, so the two facts it publishes about Cursor come from different sources
and neither constrains the other.

**Why it ranks first:** it is a number an operator acts on directly — throttle, switch provider,
buy more — and it is the only figure on the board with **both** an independent source **and** no
sibling. Every other uncorroborated number at least derives from data the board holds.

**Cheapest corroboration:** publish the quota's own denominator and unit alongside the percentage.
Then `usedPercent × denominator` has to agree with something, even if only with itself over time.

## 2. HIGH — `contextPct`, and therefore `contextPeak` and `contextMedian`

```
contextPeak 71 · contextMedian 4 · reporting 9 of 10 live agents
```

`contextPct` is `tokens ÷ contextWindow`, and **the denominator is a constant in
`config/models.json`.** Nothing on the board re-derives occupancy by another route, so a wrong
window produces a wrong percentage **that agrees with itself perfectly** — I checked the arithmetic
and it is internally exact (707,139 / 1,000,000 = 71%).

**This one has already caused a defect.** `contextPeak` read null because the model table lacked
`opus-5` and `opus-4-7`. It was fixed by editing the constant, which is to say the defect was found
by a human noticing, not by any number disagreeing. **The next model this fleet adopts reintroduces
it silently.**

**Why it ranks second:** peak context is the board's main *"this agent is about to hit a wall"*
signal, and the failure is soundless in both directions — a too-large window under-reports and
nothing alarms.

**Cheapest corroboration:** treat an unknown model as unknown and suppress the percentage, which
the codebase already does for cost. A missing denominator should produce no figure, not a
confident one.

## 3. MEDIUM-HIGH — `activeMs` and elapsed spans

Nothing else on the board measures how long an agent has been working. **It already produced
`Elapsed 87.1d`** — a figure that survived because no second number contradicted it; it was caught
by a person reading it and finding it absurd.

`B7` bounds it (`activeMs ≤ now − sessionStartedAt`) and **nothing in the product asserts that.**
The sibling exists in principle and is not compared.

## 4. MEDIUM — `observedWindowMs`

The qualifier on the completion counter, and **nothing qualifies the qualifier.** If it is wrong,
the label that exists to make a number honest is itself the dishonest part. It resets on restart,
which is exactly when it is least checkable.

## 5. MEDIUM — `ratio: 999`

```
spikes: [{ currentTokensPerHour: 7610, baselineTokensPerHour: 0, ratio: 999 }]
```

**Uncorroborated by construction** — a sentinel standing in for division by zero, rendered as
`(new)`. No arithmetic relation holds between it and its own operands, so no identity can ever test
it. It is not wrong today; it is *untestable by design*, which is the same property that let the
series drift.

## 6. LOW — `burnRateTokensPerHour`

Ranked last **because it is the only one with a sibling already in the payload**:
`processedTokens ÷ (to − from)` must equal it. Nothing computes that comparison.

**This is the cheapest fix on the list** — one assertion over two fields the API already publishes,
and it is `I10` from `ace1a86`, proposed and not implemented.

---

## What is well corroborated, so the map is honest in both directions

Not everything is exposed. These each have a sibling that must agree, and the identities in
`ace1a86` test them: `totals.tracked` against the sum of program agents; `live + ended`;
`working + idle`; `attentionCoverage`'s three parts against its own total; `momentum.working`
against `totals.working`; `stalledAgentIds.length` against `stalled`; `costMissingInvocations` and
`aggregatedInvocations` against `invocations`; `Σ byProvider` against `measuredCostUsd`;
`window + prior` across every window size; and nested-window containment.

**The board's structural counts are in good shape. Its measurements of the outside world are not** —
and that is the pattern worth carrying: **every entry on this list describes something the board
cannot see twice.** Agent counts it derives itself, so it can check them. Quota, context window,
elapsed time and provider rates come from somewhere else, once.

## The rule this produces

**A figure with no sibling should not be rendered as a bare number.** It should carry its source
and its denominator, so a reader can at least attempt the check the system cannot. That is the same
move as `tokensMissing` beside the token sum and `costKnown` beside the cost — **but applied to
figures that have no gap to disclose, only an origin.**

## Limits

- **I enumerated from five endpoints** — `summary`, `series`, `invocations`, `ward`, `quotas` — plus
  `/api/snapshot`. I did not enumerate `/api/health`, `/api/attention`, `/api/triage/*` or the
  program-rollup fields, and any of those could hold an uncorroborated figure.
- **`quotas` and `ward` I opened for the first time tonight.** Everything I say about them is one
  reading old.
- **I have not checked whether the client renders any figure the server does not publish**, which
  would be an uncorroborated number that does not appear in any payload at all. That needs the
  rendered read the frontend lane is blocked on.
