# Your three readings: two are exactly right, one I cannot reproduce — and there is a worse problem underneath

**You were right not to conclude the range is broken. It is not.** `range=` works correctly now —
it was fixed since this morning. But the investigation turned up something with a larger
consequence than a range selector, so it leads.

Ranked by consequence-if-real, with defence quality stated separately.

---

## 1. HIGH — one day holds 26% of the 30-day cost, at a token rate that is impossible

Per-day, measured with fixed absolute bounds:

| Day | total | Claude Code | invocations | tokens | **tokens/invocation** |
|---|---:|---:|---:|---:|---:|
| 2026-07-25 | $33.48 | $0.00 | 58 | 110M | 1.9M |
| 2026-07-28 | $234.70 | $179.02 | 93 | 321M | 3.5M |
| 2026-07-29 | $64.28 | $34.34 | 42 | 86M | 2.0M |
| **2026-07-30** | **$3,514.24** | **$3,474.66** | **58** | **2,759M** | **47.6M** |
| 2026-07-31 | $191.21 | $160.87 | 68 | 225M | 3.3M |
| 2026-08-01 | $99.47 | $35.53 | 158 | 193M | 1.2M |
| 2026-08-02 | $84.21 | $44.48 | 139 | 135M | 1.0M |

**July 30 is $3,514.24 — more than every other day in the window combined, at $59.91 per
invocation against a fleet norm of $0.32–$1.93.**

Check 5 asks what would have to be true for that to be correct. It would require each of those 58
invocations to process **47.6 million tokens**. Every model on this fleet has a **1,000,000-token
context window** (`config/models.json` → `claudeContextWindows`). Even counting input, output and
cache-read together, a single call cannot exceed a few million. **47.6M in one invocation is not
possible.** The neighbouring days on the same fleet run 1.0M–3.5M per invocation, so this is
13–25× the same system's own norm, not a plausible busy day.

So one of two things is true, and both matter:

- **`invocations` is not a call on that path** — it is a session, a batch, or a rollup — in which
  case per-invocation reasoning is invalid *and* the 24h count (175) is not comparable to the 30d
  count (3,006), because they would be counting different things; or
- **those rows are inflated**, and the headline $13,216 is materially wrong.

I cannot yet tell which, and I am not going to guess. **Either way, one day is 26% of the number
Emilio reads.** July 30 was a heavy day for this fleet, so the *direction* is right — which is
exactly what makes it dangerous, because a wrong number pointing the right way survives review.

## 2. HIGH — the growth is real, and it proves recent spend is invisible when it lands

Your ~$1,276-in-87-minutes observation **reproduces against my own recorded reads**, not a relayed
figure:

| | my 13:49 read | my 15:13 read | delta |
|---|---:|---:|---:|
| 30d cost | $11,961.21 | $13,217.32 | **+$1,256.11** |
| 30d invocations | 2,984 | 3,006 | +22 |
| 30d tokens | 26,226,805,893 | 27,226,339,109 | **+999,533,216** |

And the growth is almost entirely **Claude Code**: $6,968.91 → $8,225.51. Codex actually *fell*
(−$1.66), which is the sliding window correctly shedding old data.

**Here is why that cannot be new activity.** The 24-hour window covers that entire 84 minutes, and
it reports **$101.61 and 170M tokens**. A window must contain everything inside it. So ~1 billion
tokens and ~$1,256 **did not arrive with recent timestamps** — they landed on rows dated more than
24 hours ago.

The consequence is the finding, and it is worse than a wrong total: **spend becomes visible only
after it is booked to the past.** An operator reading "today" or "last hour" at the moment work is
happening sees a figure that is systematically low, and the true cost appears later attached to a
date that has already scrolled away. Today reads $84.21 for a five-lane Opus fleet running all
day — a figure I would call implausible on its face by check 5, and §1 shows where that missing
money eventually shows up.

**Defence quality, stated separately:** the API is *internally* consistent right now — I verified
containment (84min $13.75 ⊆ today $84.21 ⊆ 24h $101.61 ⊆ 30d $13,217.32), and fixed-bounds
windows were stable across re-reads 9 minutes apart. So this is not a query bug. It is an
**ingestion-timing** property, and the arithmetic above is what exposes it.

## 3. MEDIUM — the cost suppression bug's server half is still open

`estimatedCostUsd` is **null** at 24h, 7d and 30d, with `costKnown: false`, because 42 of 3,006
invocations are unpriced (Cursor). The dollars exist only in `measuredCostUsd` and `byProvider`.

You read the right field. Anyone reading the obvious top-level one sees **"not reported"** while
$13,217 sits directly beneath it. The render half landed in `c5c6a72`; **the server half never
did.** Still 1.4% of calls suppressing 100% of the headline.

## 4. LOW — your 1-hour reading: I cannot reproduce it, and your method is the likely cause

`range=` is no longer ignored. Measured one minute after your reading:

| query | cost | calls | window returned |
|---|---:|---:|---|
| `?range=1h` | **$4.58** | **10** | 12:13 → 13:13 |
| `?range=24h` | $101.61 | 175 | Aug 1 13:13 → Aug 2 13:13 |
| `?range=30d` | $13,216.15 | 3,006 | Jul 3 → Aug 2 |
| explicit `from`/`to`, 1h | $4.58 | 10 | identical to `range=1h` |
| **no parameters at all** | **$101.61** | **175** | Aug 1 → Aug 2 (the default) |

**Your 1h figure is exactly the no-parameter default.** `$101.61 / 175` is the correct answer to
the 24-hour question, returned to a query whose window did not apply. Your 24h and 30d readings
are **exactly right** — $101.61/175 and $13,216.15 both match mine to the cent.

I am **not** asserting which parameter you sent, because I did not see the command and check 6
says name the layer the claim rests on: I have reproduced the *symptom* from an unrecognised
window parameter and nothing more. If you still have the exact URL, that settles it in one look.

## 5. NOTE — two fields that should agree, differ by $1.17

`measuredCostUsd` = **13,217.32**; the sum of `byProvider[].costUsd` = **13,216.15**. Small, and
it is why your 30d figure and mine differ by a dollar — you summed providers, I read the scalar.
Two numbers for one quantity is the shape that has produced several defects this week, so it is
worth a look even at this size.

---

## What I would do next, in order

1. **Settle what an `invocation` is** on the Claude Code path, and whether July 30's rows are
   single calls. That one answer resolves §1 and tells you whether $13,216 is trustworthy.
2. **Land the server half of the cost suppression fix** (§3). It is already specified and it is
   the difference between a headline that reads "not reported" and one that reads the truth.
3. **Then** decide whether short-window under-reporting (§2) needs a fix or a label. A card that
   said *"last hour: $4.58 measured so far — provider data can arrive late"* would be honest
   without pretending to a precision the ingestion cannot give.

## Method, and its limits

All figures are my own reads against `127.0.0.1:4701` between 15:13 and 15:25 CEST, using explicit
`from`/`to` **and** `range=` cross-checked against each other. The 13:49 baseline in §2 is my own
recorded direct read from `docs/USAGE-TAB-AUDIT-GPT.md`, not your relayed figure — I checked that
deliberately, because comparing against a relayed number is how a growth claim gets built on sand.

**Not established:** whether §1 and §2 are the same defect. They are consistent with one story —
Claude Code usage arriving late and being booked to its session's start date, which would pile
spend onto whichever day a long session began — but I have not proven that mechanism, only that
the money is on July 30 and that it arrived after July 30. Calling them one defect would be a
conclusion drawn one layer above the evidence.
