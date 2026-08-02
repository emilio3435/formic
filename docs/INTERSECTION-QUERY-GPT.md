# The intersection: what is both untested and uncorroborated

Run against the suite and the live board. **It found a live defect on its first pass, and
corrected one of my own routings.**

---

## The three zones

| Figure | Assertions | Corroborated? | Zone |
|---|---:|---|---|
| triage `affectedAgents` / `affectedPrograms` | **0** | no | **1 — both** |
| `quotaPressure.usedPercent` | **1, round-trip** | no | **1 — both** |
| `controlErrors` | 1 | no | **1 — both** |
| `activeMs` | 11 | no | 2 |
| `contextPeak` / `contextPct` | 12 / 7 | no | 2 |
| `observedWindowMs` | **14 across 13 files** | no | 2 |
| partition counts, provider sums, window+prior | many | yes | 3 |

## Zone 1, and one of them is wrong right now

### triage `affectedAgents` — 0 assertions, and stale

**First, correcting myself.** I routed *"carry the counts as fields rather than trapping them in
prose."* **The fields already exist:**

```
triage item keys: issueId, generatedAt, mode, headline, rationale,
                  affectedAgents, affectedPrograms, providers, evidence, …
affectedAgents: 47 · affectedPrograms: 14 · generatedAt: 2026-08-01T06:45:57
```

My recommendation was already satisfied. **But the finding is stronger than I made it, not weaker.**

Having them as fields makes them *checkable*, which was the whole point — **and nothing checks
them.** They are frozen at generation time, 39 hours ago:

```
recorded   : 47 affected agents · 14 programs
live now   : 27 ambiguous agents · 142 programs
```

`affectedPrograms: 14` against **142 programs on the board today**. The problem was never the
prose; it was that the numbers are **generated once and never re-derived**, and the structured
fields inherit that exactly. **0 assertions in the suite, no sibling on the board, and demonstrably
out of date** — the intersection's first hit.

*Caveat I will not skip:* I compared against `resolution === "ambiguous"` as the closest proxy for
"affected by cmux identity conflicts." The staleness is certain — the fields are frozen and 39
hours old. The exact current value depends on the intended population, which I have not confirmed.

### `quotaPressure.usedPercent` — one assertion, and it is a round-trip

```js
buckets: [{ key: "a", label: "5h", usedPercent: 80 }]   // fixture writes 80
expect(quotas.quotas[0]?.buckets[0]?.usedPercent).toBe(80);   // asserts 80
```

**It tests that a number survives serialisation.** It cannot fail if the quota source is stale,
wrong, or measuring a different quantity than the label claims. The highest-consequence
uncorroborated figure on the board has **one assertion, and that assertion is transport.**

## Zone 2 is the finding, and tonight's RED test proves it

`observedWindowMs` has **14 assertions across 13 files.** `contextPeak` has 12. `activeMs` has 11.
**All three remain tier-0 uncorroborated.**

**Being heavily tested does not make a figure corroborated.** Tests assert what the code produces;
they do not check it against the world. If the behaviour is wrong, **the tests pin the wrong
behaviour with more confidence.**

**And this is no longer an argument — it is tonight's result.** The board's token totals are
heavily tested, internally consistent, and passed every identity I wrote. Their **first external
check came back 161% high.** Zone 2 is exactly where that figure lived.

So the ranking that matters is not *untested → tested*. It is:

```
zone 1  untested and uncorroborated   →  nothing would notice
zone 2  tested but uncorroborated     →  tests would notice a CHANGE, nothing would notice it being WRONG
zone 3  corroborated                  →  something can disagree
```

**Zone 2 is the largest and most dangerous zone, because it looks like zone 3 from the inside.**
A green suite over a well-covered figure reads as confidence, and measures only that the figure has
not moved.

## On the 161%, offered as a hypothesis not a finding

The direction inverted from my afternoon measurement — I had burnbar **higher** than the board
(2.6–16.9×) comparing against `sessionTotal`; with the bridge field it is the board higher by 161%.
That inversion is expected, since the two comparisons use different left-hand sides.

**One named candidate for whoever is determining it:** `collectors.ts` sums a per-call total as
`input + output + cachedInput + cacheCreationInput`. If BurnBar counts cache *creation* once per
cache rather than once per call that reads it, the board's per-call sum would run high by
approximately the cache-creation share — and that share is large on this fleet. **Testable by
splitting the comparison per component** rather than on the total. Offered because it is cheap to
check, not because I have evidence for it.

## What I would add to the intersection query itself

The query as I ran it counts **assertions mentioning a field**, which is exactly the metric my own
vacuity audit says is insufficient — `usedPercent`'s single assertion proves the point, since it
mentions the field and discriminates nothing.

**The version worth building** joins three columns per figure: *assertion count*, *non-vacuous
evaluation count* (the counter already routed), and *corroboration tier*. A figure with many
assertions, zero non-vacuous evaluations and tier 0 is the worst cell in the table, and nothing
today would show it as different from a healthy one.

## Limits

- **Assertion counts are `grep` over `expect(` lines near a field name** — a lower bound and a
  crude one. `ratio` scored 36 files because the word is common.
- I ran the intersection over **my** uncorroborated list. The tests lane's untested-paths map is
  the other half and I have not seen it; the real intersection needs both.
- The triage population caveat above.
