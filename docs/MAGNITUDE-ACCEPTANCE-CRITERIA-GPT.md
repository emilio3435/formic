# Acceptance criteria for the six magnitude fixes

Companion to `docs/MAGNITUDE-AUDIT-GPT.md` (`58d523c`). The lanes are fixing these one at a
time; this states what each fix must satisfy, in a form the tests lane can pin, and — more
importantly — **what would count as still-wrong-but-differently**, because every one of these
defects is a correct number under a wrong label, and the natural fix for a wrong label is a
different wrong label.

**The general acceptance rule, applying to all six.** Every number must pass:

> **Name the population the unit implies, and the population the code sums. If they differ, the
> fix is not done.**

A test that asserts a *value* cannot catch these — the values were always right. A test that
asserts the *population* can. Where possible the criteria below are written as invariants over
constructed fixtures rather than as expected numbers.

---

## 1. `N done this hour` — what a correct completion counter must verify

**Current implementation** (`src/server/pulse.ts:80-89`):

```js
const completed = previous?.lastActivity === "working"
  && (agent.activity === "idle" || agent.activity === "ended");
```

`activity` derives from `status`, which `statusFrom()` derives from **transcript recency alone**
— under 3 minutes is `running`, under 45 is `waiting`, beyond that `stale`. So the counter
increments when an agent stops writing to its transcript for three minutes. That is the whole
test.

**Three independent defects, each needing its own assertion.**

### 1a. It counts pauses, not completions

A "completion" currently fires for: thinking for three minutes, waiting on a slow tool, blocked
on a build, rate-limited, crashed, or killed. None of those is a completed task.

> **Pin:** an agent that goes `working → idle` and then back to `working` must contribute **0**
> to the counter. Construct: one agent, three snapshots (working, idle, working). Assert the
> published count is 0, not 1.

### 1b. It can count one agent many times

Agent memory holds only `lastActivity`, so every `working → idle` edge counts. An agent that
pauses five times in an hour contributes five.

> **Pin:** an agent oscillating `working → idle` five times within the window contributes at
> most **1**. And: no single agent id may contribute more than one completion per *unit of
> work*, however that unit is identified.

### 1c. It never checks success

There is no reference to `outcome`, `gates`, `exited`, or `transcriptEndedCleanly` anywhere in
the counting path. A crashed agent and a shipped agent are indistinguishable.

> **Pin:** an agent transitioning `working → ended` with `outcome: "failed"` (or non-empty
> `gates`) must contribute **0** to a counter labelled "done".

**What a correct counter must verify — all four, or the label must change:**

1. **Terminality.** The agent is finished, not paused. `activity === "ended"` with corroborating
   process evidence (`processState === "exited"` or `transcriptEndedCleanly`) — not a recency
   inference that a quiet agent has stopped.
2. **Success.** `outcome === "healthy"` and no unresolved `gates`. A counter that says *done*
   must exclude *failed*.
3. **Idempotence.** One unit of work counts once, keyed on something stable — the agent id plus
   a work identity — never on an edge that can recur.
4. **Attribution.** The count must be reconstructible: which agents, so a reader can check it.
   An unbounded scalar with no drill-down is how this survived.

**Still-wrong-but-differently — the failure modes to pin against:**

- **Renaming instead of fixing.** Relabelling to `17 sessions went quiet` is *honest* and makes
  the number useless; relabelling to `17 finished` while still counting pauses is worse than
  today, because it launders a wrong number through a correction. Pin 1a/1b/1c regardless of
  label.
- **Deduplicating by agent id alone.** Fixes 1b, silently caps a genuinely productive agent at
  one completion per hour. Pin: two *distinct* units of work by one agent, both terminal and
  successful, must count 2.
- **Requiring `ended`.** Fixes 1a by excluding every agent that finishes a task and stays alive
  for the next one — which in this swarm is most of them. Pin: an agent that completes work and
  remains `working` must still be countable.
- **Trusting `exited`.** `statusFrom` sets `status: "archived"` on `exited`, so gating on that
  re-imports the same recency inference one field over.

**If none of that is achievable with the data available, the honest fix is to delete the
counter.** A number that cannot be defined cannot be corrected, and "no completion data" is a
true statement the board already knows how to render.

---

## 2. `Elapsed` — 87.1 days

**Claims** working time. **Is** `updatedAt − startedAt`, dormancy included.

> **Pin A:** for an agent whose `startedAt` is 30 days before its `updatedAt`, the rendered
> elapsed must not read as continuous activity — either the value reflects active time, or the
> label distinguishes span from activity.
> **Pin B:** elapsed for an `ended` agent must be computed from `updatedAt`, never from `now`
> (already true at `snapshot.ts` `elapsedEndMs`; pin it so it stays true).

**Still-wrong-but-differently:**
- **Clamping to a maximum.** `min(elapsed, 36h)` makes an 87-day session read as a 36-hour one —
  a fabricated value replacing a true one. Never clamp.
- **Relabelling to "age".** Accurate, and it silently drops the question an operator asks
  (*how long has this been working?*), which nothing else answers.
- **Switching to `now − updatedAt`.** That is staleness, already on the board, and it would make
  every ended agent read `0`.

---

## 3. BURN — rate and cost that cannot both be true

**Two populations on one widget.** `tokensPerMin` is a pulse average over `sessionTotal` deltas
from any tracked reporter including ended agents; `costLastHourUsd` is BurnBar's priced
invocations.

> **Pin A — the arithmetic invariant.** Given a rendered `tok/min` and `$ last hour`, the implied
> price `cost / (rate × 60)` must fall within the configured price table's range. Today it is
> `$0.0144/M` against a `$0.50/M` floor. This is one assertion and it catches any future
> divergence regardless of cause.
> **Pin B — population identity.** The rate and the cost must be derived from the same agent set
> and the same window, or the widget must not render them adjacently.
> **Pin C — physical ceiling.** `tokensPerMin / workingAgents` must not exceed a stated
> generation ceiling unless the unit says it counts cache reads.

**Still-wrong-but-differently:**
- **Fixing the cost to match the rate.** Multiplying cost by ~140 makes both wrong in the same
  direction and destroys the one number (BurnBar cost) that is currently sound.
- **Dropping the cost.** Removes the only figure an operator can act on and leaves the
  unbounded rate alone with no cross-check — the exact configuration that hid 1.6B.
- **Excluding cache from the rate without saying so.** Correct value, and a 100× drop with no
  explanation reads as an outage.

**Also in scope for this fix:** BURN's `N/M reporting` counts eligible *live* agents while the
rate sums deltas from *all tracked* agents. Same wrong-population coverage defect that was
removed from CONTEXT PEAK. Pin: a coverage denominator must be drawn from the population of the
figure it qualifies.

---

## 4. `1.59B session tokens`

**Claims** tokens used. **Is** the conversation re-read once per turn — 97.9–99.8% cache.

> **Pin:** for a fixture where `cachedInput` is 99% of `total`, the rendered figure must either
> exclude cache or carry a unit that says it does not. Assert on the rendered string, not the
> field.

**Still-wrong-but-differently:**
- **Summing `input + output` and keeping the word "tokens".** Correct value, and now
  incomparable to every other tokens figure on the board — including the row's latest-call
  total, which is the thing readers compare it to.
- **Excluding ended agents.** Fixes a different complaint and leaves the cache problem intact.

---

## 5. Activity sparkline "last hour"

> **Pin:** the window label must be derived from `observedWindowMs`, not hardcoded. Fixture with
> `observedWindowMs: 762000` must render `12m`, never `hour`.
> **Pin:** a bucket's `activeSessions` must exclude agents already past `stallThresholdMs` at
> that bucket's start.

**Still-wrong-but-differently:** suppressing the sparkline until an hour is observed — the data
is useful at 12 minutes, the *claim* was the defect.

---

## 6. `220 agents` in the rollup

> **Pin:** any agent count rendered beside a live-scoped figure must state its own scope, or use
> the same scope. `220 agents · 38 working` where 220 spans history and 38 does not is the defect.

**Still-wrong-but-differently:** switching the count to live-only, which makes the token cell
(which spans everything) inconsistent with the agent cell beside it. Both cells must move
together or neither.

---

# What I did NOT check

The audit ranked by wrongness and therefore looked hardest where I already suspected trouble.
The gaps below are where the next 1.6B is most likely, listed worst-first by my estimate of
**hiding power** — how well a wrong number there would avoid being noticed.

### 1. Which numbers are truncated, droppable, or hover-only — **entirely unaudited**

The fourth worker lost the shared browser and produced nothing. This is the single worst gap,
because it is *exactly* the property that hid 1.6B: it rendered in a cell whose own comment calls
it "the least critical, dropped first on narrow screens" and truncated to `680.4M t…`. Every
number living only in a `title` or `aria-label` is unaudited, and a number nobody can see is a
number nobody can question. **Highest priority for the next pass.**

### 2. The Usage tab — never opened, in any round

Four rounds of cockpit auditing and I have never rendered it. It is the one surface whose entire
purpose is aggregate numbers over time, which is precisely the shape that produced every finding
in this audit. I have no evidence about it either way.

### 3. Client-side-only derivations that never appear in the payload

I audited the payload and compared it to the screen. A number computed entirely in the browser —
from `state`, from a client-side reduce, from a formatter — never appeared in my enumeration. The
day review already established the client re-derives values the server ships; anything it derives
that the server *doesn't* ship was invisible to my method.

### 4. The drawer, this round

I audited the board surfaces. The drawer has its own token figures, its own context tile, its own
elapsed — and it was audited two rounds ago against *duplication*, never against *magnitude*.

### 5. Numbers that are correct now and will drift

`totals.tracked` at 441 is currently plausible. Monotonic counters are wrong *later*, and a
snapshot audit cannot see that. Nothing I checked establishes behaviour at 10× the fleet size.

### 6. The price table

My BURN arithmetic uses a $0.50/M cache-read floor from general pricing knowledge, not from this
project's configured rates. The *direction* of the contradiction is robust — $4.41 cannot buy
305M tokens at any real price — but the multiplier is not verified against the source of truth.

### 7. Whether these numbers are correct on a *quiet* board

Every measurement was taken on a busy fleet of 380–441 agents. Division-by-small-number and
empty-population behaviour — one working agent, zero reporters, a fresh restart — is where rates
and medians usually break, and I sampled none of it.

**Common shape of gaps 1–4:** I audited what the payload made easy to enumerate. The method was
`curl | python`, so anything not in the payload, not on the default tab, or not visible at 1440px
was structurally outside it. That is not a gap in diligence, it is a gap in *instrumentation* —
and it means the next audit should start from the rendered DOM and work backward, rather than
starting from the payload and working forward.
