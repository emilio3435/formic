# Numbers nobody could bound

Companion to `docs/MAGNITUDE-AUDIT-GPT.md`. That audit ranked what was wrong;
`tests/magnitude-bounds.test.ts` and `tests/token-plausibility.test.ts` bound
what admits an honest relation. This is the remainder: the numbers on the board
that **no assertion currently protects**, and why.

It exists because an unbounded number is a real result rather than an
incompleteness. `1.60B session tokens` sat unquestioned for a day past five
agents and one operator, and the reason no test caught it is that no test
*could* — nothing compared it to anything. The next one will sit somewhere on
this list.

## The rule that decides bounded from unbounded

Every number bounded so far compares two things the payload already carries.
Occupancy against context window. Cost against the configured price table.
Buckets against the window they claim. Sub-counts against their total.

**A number is unboundable when the quantity that would bound it is not on the
wire.** In every case below the missing piece is a *field*, not a threshold —
which is why the fix belongs to whoever owns the schema, and why inventing a
constant here would be the same species of lie as the totals this work exists
to catch. A fabricated bound passes on today's data, fails on a legitimate
outlier, and teaches everyone to ignore the alarm.

## The register

### 1. `Elapsed` — measured at 87.1 days, overstating by ~204×

**Claims** how long the agent has been working. **Is** `updatedAt − startedAt`,
a span with all dormancy inside it. The arithmetic is correct and the audit
verified the `startedAt` dates are real.

**Why unbounded.** Dormancy is not recorded, so no relation between the fields
present separates 87 days of work from 87 days of a session lying open. The
obvious ceiling — "a session cannot exceed 36 hours" — is a guess about human
working patterns that a genuinely long-running agent would trip.

**What would bound it.** An active-time field on `AgentSnapshot`. Then
`activeMs ≤ updatedAt − startedAt` is physics, and the label can say which one
it means. *Requested; the backend lane holds it.*

### 2. `N done this hour` — true value may be 0

**Claims** completed tasks. **Is** transitions into a quiet state, re-countable
per agent, never verifying that anything succeeded.

**Why unbounded.** Success is not on the wire. Nothing over the payload
distinguishes a completion from a crash, an interrupt, or a silence, so no
assertion can check the count means what the word says. A ceiling on the count
would not help: the defect is not that the number is too large but that it
counts a different event.

**What would bound it.** An outcome on the transition — a completion record
that says whether the work landed. Until then this is the only number on the
board whose error has no upper limit.

The *window* half of this finding is bounded, in `magnitude-bounds.test.ts`: a
five-minute observation is no longer reportable as an hour.

### 3. Cumulative session usage — `sessionTotal`, `sessionCachedInput`

**Claims** tokens a session consumed. **Is** correct as of `4c008fd`, which
separated new tokens from cache re-reads.

**Why unbounded.** Occupancy has a hard ceiling — a call cannot place more
tokens in the context than the context holds — and that is asserted. Cumulative
usage has none: a long session legitimately exceeds any window many times over.
The natural bound is `sessionTotal ≤ turns × contextWindow`, and **there is no
turn count on the wire**. `AgentSnapshot` carries `startedAt`, `updatedAt`,
`elapsedMs`, `artifacts` — nothing countable.

Substituting `elapsedMs × some-tokens-per-second` would mean inventing a
throughput constant. A wrong one either misses real inflation or fails an honest
burst.

**What would bound it.** A turn count. All three parsers already iterate turns
to build their usage lists, so it is a counter they hold and discard.

### 4. Cost as a total

**Claims** spend. **Is** spend over *priced* invocations.

**Why unbounded.** The cost note concedes unpriced sessions, so a low figure is
legitimately low and there is no independent ceiling to check it against —
bounding cost would only restate the price table. `magnitude-bounds.test.ts`
therefore reconciles rate against cost **only when no such note is present**,
and excludes a stated subtotal rather than fudging it.

**What would bound it.** A priced/unpriced denominator, the same completeness
suffix pattern the audit flags as a repeat offender elsewhere.

## What is bounded, for contrast

So the shape of the gap is legible rather than the list reading as everything.

| Number | Bounded by | Where |
|---|---|---|
| Latest-turn occupancy | its own context window | `token-plausibility` |
| Fleet token total | sum of its parts | `token-plausibility` |
| BURN rate vs cost | this repo's configured price table | `magnitude-bounds` |
| Activity window | buckets × bucket size, `observedSince` | `magnitude-bounds` |
| Rollup counts | partition identity, no part above total | `magnitude-bounds` |
| Momentum window label | `observedWindowMs` | `magnitude-bounds` |

## How to use this

When a new number reaches the board, ask the audit's one-sentence check — *name
the population the unit implies, and the population the code sums* — and then
ask this file's: **what on the wire could contradict this number?** If the
answer is nothing, it belongs here, and it belongs here in writing rather than
in a gap.
