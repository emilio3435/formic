# Physical bounds for every rate this system reports

Derived from what the machine can physically do, not from what it currently reports. Handed to
the tests lane as assertable bounds.

**The headline lesson, before the numbers:** *per-unit* bounds have teeth and *aggregate* bounds
do not. A cost-per-day ceiling would **not** have caught July 30 — I derive below that the
physical ceiling for a five-lane fleet is ~$45,000/day, and July 30 was $3,514. Only
**cost per invocation** and **tokens per invocation** caught it. Any bound computed by multiplying
a per-unit limit by a concurrency guess is too loose to fire. Assert the per-unit ones.

---

## The two hard constants everything derives from

| Constant | Value | Source |
|---|---|---|
| Context window **W** | **1,000,000 tokens** | `config/models.json → claudeContextWindows` — every model: opus-5, opus-4-8, opus-4-7, sonnet-5, fable-5 |
| Price extremes | **$0.50/M** (cacheRead) … **$25/M** (output) | `config/models.json → modelPricingUsdPerMillionTokens` |

Full price vector for the one priced model (`claude-opus-4-8`): input **$5**, output **$25**,
cacheRead **$0.50**, cacheCreation **$6.25** per million.

**The load-bearing physical fact:** every token a request *reads* — fresh input, cache reads, and
cache writes alike — occupies the context window. So **input-side tokens per call ≤ W**. That is
not a policy limit that can be raised by configuration; it is what the model can attend to.

---

## The bounds

### B1 — Tokens per invocation ≤ 2,000,000 `[HARD]`

Input side ≤ W = 1M. Output side has no configured cap in this repo, so take the most generous
possible reading, output ≤ W = 1M.

> **`tokensPerInvocation ≤ 2_000_000`**  — absolute, cannot be exceeded by any single model call
> **`tokensPerInvocation ≤ 1_100_000`** — practical (assumes ≤100k output); use as a *warning* tier

**July 30: 47.6M per invocation — 24× the absolute ceiling.** This is the bound that catches it.

### B2 — Cost per invocation ≤ $31.25 `[HARD]`

Worst-case-priced call: fill the entire window with the most expensive input tokens
(cacheCreation, $6.25/M → 1M = **$6.25**) and emit the most expensive possible output
(1M × $25/M = **$25.00**).

> **`costPerInvocation ≤ 31.25`** — absolute
> **`costPerInvocation ≤ 8.00`** — practical (1M cache-creation + 64k output ≈ $7.85); warning tier

**July 30: $59.91 per invocation — 1.9× the absolute ceiling.** Independently catches it, without
reference to tokens.

### B3 — Blended cost per million tokens ∈ [$0.50, $25.00] `[HARD]` — *and it does not catch anything*

Every token is billed at one of {0.50, 5, 6.25, 25} per million, so any blended rate must fall
inside the extremes.

> **`0.50 ≤ (costUsd / (tokens/1e6)) ≤ 25.00`**

**Assert it, but know what it cannot do.** July 30 computes to
$3,474.66 ÷ 2,759M = **$1.26/M — comfortably inside the range.** Cost and tokens were inflated
*together*, so their ratio stayed valid.

**This is the most important entry in the document.** A consistency check between two derived
numbers validates neither of them. The whole reason July 30 survived is that every internal
cross-check it could face — provider sums, window containment, blended rate — passed. Only a
comparison against an **external physical limit** exposed it.

### B4 — Context percentage ∈ [0, 100] and context tokens ≤ W `[HARD]`

> **`0 ≤ contextPct ≤ 100`**
> **`contextTokens ≤ 1_000_000`**

Definitional. Cheap to assert and it pins the numerator/denominator confusion that produced the
391M-vs-1.6B defect: any occupancy computed against the wrong population breaches 100 immediately.

### B5 — Cache reads ≤ total tokens `[HARD]`

> **`cacheReadTokens ≤ totalTokens`** and **`inputTokens + outputTokens + cacheRead + cacheCreation == totalTokens`** (± rounding)

A component cannot exceed its total. This catches double-counting, which is the mechanism most
likely to be behind an inflated day.

### B6 — Window containment `[HARD]`

For any two windows where **W₁ ⊆ W₂**, every additive metric must satisfy metric(W₁) ≤ metric(W₂).

> **`cost(1h) ≤ cost(24h) ≤ cost(7d) ≤ cost(30d)`**, and the same for tokens and invocations
> **`Σ byProvider[].costUsd == measuredCostUsd`** (± $0.01)

This is the check that proved the API self-consistent and localised the anomaly to a day. It also
catches the live **$1.17 discrepancy** between `measuredCostUsd` (13,217.32) and the provider sum
(13,216.15) — two numbers for one quantity, already reported.

### B7 — Active time ≤ wall-clock `[HARD]`

> **`activeMs ≤ (now − sessionStartedAt)`**
> **`sessionStartedAt ≥ <project inception date>`**

Catches the `Elapsed 87.1d` class directly: an elapsed figure exceeding the age of the session, or
of the project, is a parse error wearing a duration.

### B8 — Completions ≤ observed population `[HARD]`

> **`completedInWindow ≤ agentsObservedInWindow`**

You cannot finish more agents than existed. This is the bound the "N done this hour" counter —
ranked worst in the magnitude audit — has never had.

### B9 — Invocations per hour `[SOFT — state it, do not gate on it]`

`invocationsPerHour ≤ concurrentAgents × 3600 / minCallSeconds`. With `minCallSeconds ≥ 1`, that
is 3,600 per agent per hour, which nothing real will ever approach.

**I am marking this soft deliberately rather than dressing it up.** It requires a concurrency
input the system does not reliably know (9 routable of 488 tracked), and any value loose enough
to be safe is too loose to fire. Assert it only as a smoke alarm at an absurd threshold, or not
at all.

### B10 — Burn rate cross-check `[MEDIUM]`

> **`tokensPerHour × 0.50/1e6 ≤ costPerHour ≤ tokensPerHour × 25/1e6`**

Same family as B3 and the same caveat — it relates two reported numbers rather than testing either
against physics — but it is worth having because burn rate and cost are computed by *different*
code paths, so it catches divergence between them even though it cannot catch joint inflation.

---

## Why the aggregate bounds are worthless here, shown rather than asserted

A cost-per-day ceiling for this fleet, computed generously:

- One agent making back-to-back 1M-context calls at ~60s each: 60 calls/hour
- Worst-case price per call (all cacheCreation): 1M × $6.25/M = $6.25
- → **$375/hour/agent**, × 5 lanes × 24h = **$45,000/day**

July 30 was **$3,514** — 7.8% of that ceiling. **A day-level bound would have passed it without a
murmur**, and so would a fleet-level token bound. The anomaly was only ever visible per
invocation, which is why B1 and B2 are the two that matter and the rest are hygiene.

Generalising: **divide before you compare.** A total is the sum of many units and inherits their
slack; a per-unit figure has to answer to a physical limit on its own.

---

## Validation — I ran them before shipping them

Bounds nobody has executed are a wish list. Run against live data:

| Day | tokens/inv | B1 (≤2M) | $/inv | B2 (≤$31.25) | $/M | B3 (0.5–25) |
|---|---:|---|---:|---|---:|---|
| **2026-07-30** | **47.6M** | **FAIL** | **$60.59** | **FAIL** | $1.27 | pass |
| **2026-07-28** | **3.5M** | **FAIL** | $2.52 | pass | $0.73 | pass |
| 2026-08-02 | 1.0M | pass | $0.61 | pass | $0.63 | pass |

`B6 provider-sum: measuredCostUsd 13217.32 vs Σ byProvider 13216.15 → FAIL by $1.17`

Three things this validation established that the derivation alone could not:

1. **B1 caught a day I had personally cleared.** In `3e4f12a` I looked at July 28's 3.5M
   tokens/invocation and called it *"high but conceivable with cache."* It is not conceivable —
   it is 1.75× the hard ceiling. **My eyeball passed it and the bound failed it**, which is the
   entire argument for having bounds rather than judgment. July 28 is a second, smaller instance
   of whatever July 30 is, and it should go to the backend with the same dispatch.
2. **No false positive on a normal day.** August 2 passes every bound with room to spare
   (1.0M/inv against a 2M ceiling), so B1 and B2 are not so tight that ordinary traffic trips
   them. A bound that fires on healthy data would be turned off within a week.
3. **B3 passed on both bad days**, exactly as predicted. The ratio check is worth having and would
   never have found this.

## How to assert these

**Not as unit tests over fixtures.** A fixture asserts what the author already believed. These are
properties of *real* data and belong where real data flows:

1. **A property test over the live API** (or a recorded payload from it) that walks every window
   and every provider and asserts B1–B8. It should fail on today's data for B6's $1.17 and, if
   July 30's rows are unchanged, for B1 and B2.
2. **A guard at ingestion** in the BurnBar reader: a row violating B1 or B2 is not a cost to
   record, it is a parse error to surface. Recording it and rendering it is how one day became 26%
   of a headline.
3. **Tier the failures.** `[HARD]` bounds are physics — breaching one is always a defect.
   `[SOFT]` is a smoke alarm. Do not let a soft bound's false positives train anyone to ignore
   the hard ones.

## What I did not derive, and why

- **A per-model output cap.** Nothing in this repo configures one, so B1 and B2 assume output can
  fill the whole window. That makes them generous — a real output cap of 64k would tighten B2
  from $31.25 to about $7.85 and make it far sharper. **Worth someone confirming the real cap;
  it is the single highest-value tightening available.**
- **Bounds for Cursor, Hermes, Factory or Codex specifically.** `modelPricingUsdPerMillionTokens`
  prices exactly one model, so every rate above is derived from Opus 4.8's vector. For providers
  whose costs arrive measured this does not matter — measured costs bypass the table — but it does
  mean B2 and B3 are Anthropic-shaped and may not bound a provider with different economics.
- **Anything about latency or wall-clock per call**, which would tighten B9. I have no measured
  distribution of call durations and did not want to invent one.
