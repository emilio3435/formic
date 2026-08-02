# Magnitude audit: every unbounded number on the board

Applying check 5 of `docs/VERIFICATION-RULE-GPT.md` systematically rather than opportunistically,
after `1.60B session tokens` sat unquestioned for a day past five agents and one operator.

**Method — deliberately not provenance.** Provenance is what failed: the 1.6B was correctly
labelled `observed`, was genuinely `sum(sessionTotal)` over genuinely that program's agents, and
was still nonsense. So every number below is checked against a **hand-computed plausible range
from first principles** — agent counts, tokens/second, session durations, real pricing — and the
arithmetic is shown. Three of the hunted shapes: numbers that only grow, numbers summed across an
unbounded dimension, and numbers read as a magnitude rather than a value.

Three Codex workers at high effort plus my own measurement. Ranked **by how wrong the number is,
not how prominent** — a wrong tooltip outranks a slightly-off headline.

**Board moved during the audit** (382 → 419 → 441 agents). Each figure names its read.

---

## The ranking

| # | Number | Claims | Actually | Wrong by |
|---:|---|---|---|---|
| 1 | `N done this hour` | completed tasks | state transitions, re-countable per agent, never verifies success | **possibly ∞** (true value may be 0) |
| 2 | `Elapsed` / uptime | how long the agent has been working | wall-clock span first-touch → last-touch, dormancy included | **~204×** |
| 3 | BURN `tok/min` vs `$ last hour` | one widget, one swarm | two populations, two windows, two sources | **~140×** |
| 4 | `1.59B session tokens` | tokens the program used | conversation re-read once per turn, 99% cache | **~100×** as distinct content |
| 5 | activity sparkline "last hour" | 60 minutes | 12.7 minutes observed; first bucket counts silent sessions as active | **~4.7×** |
| 6 | `220 agents` (rollup) | the program | 38 live + 182 ended | **~5.8×** operational population |
| — | `tokens` vs `session tokens` | — | two correct numbers **1,077×** apart sharing a word | label, not value |

Checked and **found sound** — reported because a magnitude audit that only finds faults is not
an audit: context peak/median, the stall count, history/archive retention, the action log.

---

## 1. `N done this hour` — the only number whose true value might be zero

**Claims:** tasks completed in the last hour. **Actually:** counts state transitions into a
quiet/ended state. It can count the same agent more than once, and it never verifies that
anything *succeeded* — an agent that crashed, was interrupted, or went silent mid-work counts
identically to one that shipped.

**Hand-check.** In this swarm a "completion" would mean a lane finishing a unit of work and
committing. Observed commit rate over the audit window: roughly 5–15/hour across all lanes.
Displayed: `52 done this hour`, later `17`. But the failure is not the ratio — it is that the
quantity is not completions at all. **The true number of successful completed tasks could be 0
while this reads 17.** No other number on the board has an unbounded error in that sense.

**Glanceable?** No. "done" is the strongest success word on the board and it is the least
verified.

Compounding it: `observedWindowMs` was **300,000 ms (5 min)** on my read while the label said
"this hour" — a 12× window overstatement layered on top.

## 2. `Elapsed` — 87 days for an agent, and the arithmetic is correct

**Claims:** how long this agent has been running. **Actually:** `updatedAt − startedAt`, the
span from first to last touch, with all dormancy inside it.

**Hand-check.** This branch's work begins 2026-07-30; a continuous session cannot plausibly
exceed ~36 hours. Measured on the live board:

| Elapsed | started | activity |
|---:|---|---|
| **87.1 d** | 2026-05-06 | ended |
| 72.6 d | 2026-05-20 | ended |
| 37.6 d | 2026-06-24 | ended |

**19 agents exceed 36 hours; 8 exceed 30 days.** I verified the `startedAt` dates are real — so
`87.1d` is *arithmetically correct*. It is the sessionTotal disease exactly: a true number whose
label claims something else. Against a generous upper bound on actual activity it overstates by
**~204×**.

**Glanceable?** No — and worse than not-glanceable, it is *confidently* wrong. "87.1d" next to a
row reading `Working` invites the reading "this thing has been grinding for three months."

## 3. BURN — two numbers on one widget that cannot both be true

**Claims:** the swarm's burn. **Actually:** `tokensPerMin` is a pulse average over `sessionTotal`
deltas (so, including cache re-reads) from *any tracked reporter including ended agents*, over a
10-minute window. `costLastHourUsd` is a separate BurnBar query over priced invocations in the
preceding hour — a smaller, different population.

**Hand-check, both directions.** At one read, `5,089,747/min` beside `$4.41 last hour`:

- 5,089,747 × 60 = **305.4M tokens/hour**. $4.41 / 305.4M = **$0.0144 per M tokens** — about
  **35× below** the cheapest configured Claude rate ($0.50/M cache read).
- Inverted: $4.41 buys at most **8.82M tokens/hour = 147k/min**, even if every token were the
  cheapest possible.
- Per agent: 5,089,747 / 10 working = **8,483 tokens per second per agent**. A Claude agent
  generates 50–100 output tok/s. That is two orders of magnitude past physically possible for
  generation, and only reachable by counting cache re-reads.

At a later read a worker measured the same pair at **138.6×** apart: pulse `6,988,595/min`
against BurnBar's `3,025,675/hour = 50,428/min`. Reconciled onto one population the rate should
read **~50.4k/min**, or the cost should read **~$387/hour** — not `$2.79`.

**Glanceable?** No, and the widget actively invites the division: a rate and a cost, adjacent,
with `windowMs` present in the payload and never printed.

**Two extras found here.** The `N/M reporting` suffix on BURN counts *eligible live agents*
while the rate sums deltas from all tracked agents including ended — the same wrong-population
coverage defect just removed from CONTEXT PEAK, still live on BURN. And the cost note concedes
two Cursor sessions are unpriced, so `$2.79 last hour` reads as a total while being a subtotal
with no bound on the remainder.

## 4. `1.59B session tokens` — known, restated for the ranking

Documented in `docs/IMPLAUSIBLE-MAGNITUDES-GPT.md`. `sessionTotal` sums
`input + output + cacheRead + cacheWrite` per turn; measured cache share **97.9–99.8%**
(`input: 2` against `cachedInput: 940,601`). As a measure of distinct content handled it
overstates by roughly **100×**; as a measure of spend, by roughly an order of magnitude.

## 5. The activity sparkline

**Claims:** the last hour. **Actually:** at the read, only **12.7 minutes** of buckets existed —
a **4.7×** window overstatement in an accessibility label no sighted reader ever sees. Worse, the
first bucket counted **36 sessions as active** when at least 17 had already been silent 15+
minutes. The wrongness is small in ratio and invisible in placement, which is why it ranks here
rather than higher.

## 6. `220 agents` in the program rollup

**Claims:** the program. **Actually:** 38 live + 182 ended — **5.8×** the operational population,
with no ended denominator beside it. Internally consistent with the token cell (both span the
same set), so this is a labelling gap rather than an arithmetic one.

---

## Checked and sound

Reported deliberately. A magnitude audit that only returns faults has not been calibrated.

- **`contextPeak: 94` / `contextMedian: 5`.** A 19× spread looked suspicious. It is real: both
  come from the same 39-agent `liveAgents` population and the raw per-agent distribution
  independently reproduces both. Not a population mismatch. The only gap is the missing coverage
  denominator.
- **`stalled: 17`.** An independent recount from agent `updatedAt` ages reproduced the published
  count exactly. Sound; its weakness is that "18 quiet" renders without "of 41 live".
- **History and archive totals.** Monotonic for long stretches but genuinely bounded — 30 days /
  5,000 records — and the `History · 6h` qualifier now makes the scoped count legible.
- **Action log.** Bounded and currently accurate.

---

## What the ranking says about the class

The three shapes were the right hunting grounds, but the audit sharpened *why*:

**Every offender in the top four is arithmetically correct.** Not one is a calculation bug.
Each is a true number whose *label names a different quantity* — completions that are
transitions, uptime that is a span, burn that is throughput-including-cache, tokens that are
re-reads. A codebase can be fully correct and a cockpit fully wrong, because correctness is a
property of the computation and meaning is a property of the label.

**The tell is unit-population mismatch, and it is checkable in one sentence.** For each number:
*name the population the unit implies, and the population the code sums.* Where those differ,
the number is misread regardless of its accuracy. That check would have caught 1, 2, 3, 4 and 6
without measuring anything.

**Coverage suffixes are a repeat offender.** `N/M reporting` has now been wrong on two widgets
for the same reason — a completeness denominator drawn from a different population than the
figure it qualifies. Removing it from CONTEXT PEAK fixed one instance of a pattern, not the
pattern.

---

## Caveats

- **Every ratio names its read**; the board moved 382 → 441 agents during the audit. The BURN
  contradiction was reproduced at two independent reads (35× and 138.6×), so the defect is
  stable even though the ratio is not.
- **The $0.50/M cache-read floor is from general pricing knowledge**, not from this project's
  own price table. If the configured rate differs the multiplier moves; the *direction* does not,
  because $4.41 cannot buy 305M tokens at any real rate.
- **Finding 1's "true value may be 0" is an upper bound on the error, not a measurement.** I
  established what the counter counts, not that zero tasks completed.
- **The fourth worker (rendered-number inventory) produced no output** — it lost the shared
  browser to contention. Which numbers are truncated, droppable, or hover-only is therefore
  unaudited this round, and that is exactly the dimension that let 1.6B hide.
