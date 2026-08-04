# Arithmetic identities between published numbers — derived, and run

Handed to the tests lane. **Not a proposal: I executed all 18 against the live product.** Three
usage identities fail, one snapshot identity fired once and is not reproducible, the rest hold.

**Your thesis is right and the results sharpen it.** A bound says a number is wrong. **An identity
says a number is wrong *and where*** — because the *pattern* of its failure across parameters
localises the defect. Both failures below did that without anyone reading code.

---

## Usage identities

| | Identity | Result |
|---|---|---|
| **I1** | `measuredCostUsd + priorSpend.measuredCostUsd` is constant across window sizes | **FAIL** |
| **I2** | `invocations + priorSpend.invocations` is constant across window sizes | **FAIL** |
| **I3** | `Σ byProvider[].costUsd == measuredCostUsd` | **FAIL at 30d, PASS at 24h** |
| I4 | `Σ byProvider[].invocations == invocations` | PASS |
| I5 | `costMissingInvocations ≤ invocations` | PASS |
| I6 | `aggregatedInvocations ≤ invocations` | PASS |
| I7 | nested windows monotone in cost | PASS |

### I1 — and how its shape names the bug

```
1h  47,700.90
24h 47,700.90
7d  46,238.51
30d 44,528.08
```

This is your finding, and the **pattern** adds something: 1h and 24h agree *exactly*, then the
total falls as the window widens. That is the precise signature of **the window being deduplicated
while `priorSpend` is not**. As the window grows, rows migrate from the raw `prior` side to the
deduplicated `window` side and their duplicates vanish, so the sum shrinks monotonically.

**A bound would have said "one of these is wrong." The identity says which side is untreated.**
The fix follows without reading `burnbar.ts`: apply the same dedup to `priorSpend`.

I2 shows the same shape at row granularity — `8632 → 8632 → 8629 → 8604` — confirming ~28 duplicate
rows, which is consistent with the 6 multi-row groups I measured plus those beyond the row cap.

### I3 — a second, independent residual

```
30d : Σ byProvider = 10,954.09   vs   measuredCostUsd = 10,955.26    ($1.17 apart)
24h : Σ byProvider =    122.27   vs   measuredCostUsd =    122.27    (exact)
```

**It fails only in the window containing pre-1-August rows.** Since that is where the cumulative
snapshots live, the scalar and the per-provider breakdown are being computed over differently
treated row sets. I reported this $1.17 earlier today as a curiosity; the window-dependence is new
and turns it from a rounding question into a localisation.

**Worth routing with the `priorSpend` fix — it is likely the same omission in a third place.**

## Snapshot identities

| | Identity | Result |
|---|---|---|
| J1 | `Σ program.agents.length == totals.tracked` | PASS (565) |
| J2 | `live + ended == tracked` | PASS |
| J3 | `working + idle == live` | PASS |
| J4 | `contextReporting ≤ contextEligible` | PASS |
| J5 | `tokenReporting ≤ tokenEligible` | PASS |
| J6 | `readable + notReadable + ended == agents` | PASS (23+1+541) |
| J7 | `attentionCoverage.agents == totals.tracked` | PASS |
| J8 | `momentum.working == totals.working` | PASS |
| J9 | `stalledAgentIds.length == stalled` | PASS |
| **J10** | `totals.needsYou == count(outcome == "needs-you")` | **fired once, not reproducible** |
| J11 | `contextPeak ≥ contextMedian` | PASS |

### J10, reported honestly rather than as a finding

On one read, **within a single payload**, `totals.needsYou` was `1` while zero agents carried
`outcome: "needs-you"`. On re-read both are `0`, along with `attentionSignal` and
`status: "attention"` — so the board moved and I cannot tell whether **my predicate is wrong**
(`needsYou` may count `attentionSignal`, not `outcome`) or **the payload was internally
inconsistent** at that moment.

**This is the strongest argument for putting these in the suite rather than running them by hand.**
An identity that fires intermittently is invisible to sampling and obvious to a continuous
assertion. I caught it once by luck; a test would catch it every time it happens, and the
ambiguity above would be resolved by whichever predicate stays green.

---

## For the tests lane

**Assert against live or recorded payloads, not fixtures.** A fixture satisfies whatever identity
its author had in mind; these are properties of real aggregation and only bite on real data.

**Parameterise I1–I3 over window size.** Every one of today's diagnoses came from *comparing
results across parameters*, not from a single evaluation. An identity checked at one window would
have passed I3 and missed the localisation entirely.

**Tier them:**
- **Structural** (J1–J3, J6, J7, I4): a part-sum that does not equal its whole is always a defect.
- **Ordering** (J4, J5, J9, J11, I5–I7): a subset larger than its superset is always a defect.
- **Invariance** (I1, I2): the same quantity computed two ways must agree. **These are the
  valuable ones** — both of today's real findings are here, and neither is expressible as a bound.

**And the general rule worth keeping:** wherever the product publishes **a whole and a part**, or
**a value and its complement**, the identity between them is free to assert and stronger than any
bound on either — because it needs no knowledge of what the right answer is. `window + prior`
required nobody to know the true total. It only required the two numbers to agree with themselves.

## Limits

- **18 identities is not a census.** I derived them from fields I already understood; `modelConfig`,
  `triageSummaries`, `recentlyResolved`, `issues` and the quota endpoints are unexamined for pairs.
- **J10 is unresolved**, and I have deliberately not picked whichever predicate would make it pass.
- **Single-moment reads.** Every PASS above is one evaluation; identities that hold now may fail
  under load, at a boundary, or when a store is mid-prune — which is precisely why they belong in a
  suite rather than in this document.
