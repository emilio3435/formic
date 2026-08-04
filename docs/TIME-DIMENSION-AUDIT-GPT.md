# Behaviour over time

You asked me to be honest if the answer is that time-dependent defects cannot be found without
waiting. **It mostly is not.** The fleet's own history *is* the second day and the hundredth
restart — 90 days of it sits in the burnbar database. Most of this dimension is reachable now;
only a narrow slice genuinely needs a clock to advance.

Ranked by consequence-if-real, defence quality stated separately.

---

## 1. HIGH — the widest view the cockpit offers now shows a third of the record, and the share falls every day

```
30d  (the UI's maximum window) : $13,217.32   3,005 calls
90d  (the API's maximum)       : $40,483.96   7,027 calls
→ the widest available view shows 32.6% of queryable spend, hiding $27,266.64
```

**This is the purest time-dependent defect on the board, because it did not exist when the project
was young and it worsens monotonically.** On day 30 the 30-day window showed 100% of the record.
Today it shows a third. In a year it will show a rounding error. Nothing in the UI says so — the
card reads `30 DAYS` and looks complete, because a window always looks complete.

The consequence is specific and it lands on the number Emilio acts on: **"our 30-day spend" is
being read as "our spend."** Every conclusion drawn from that card — is burn rising, which provider
dominates, is a model worth its cost — is drawn from a minority sample that silently shrinks. And
it compounds with the July 30 finding: a single anomalous day is 26% of a window that is itself a
third of the record.

**Named fix, cheap:** the usage card should state its coverage — *"30 days · 33% of recorded
history"* — and offer the 90-day window the API already supports. A window that cannot say what
fraction it covers is the same defect as a total that cannot say what it excludes, which this
codebase already fixed once for `tokensMissing`.

**Defence quality:** none. There is no guard, no warning, and no test — the value is correct and
the framing is what misleads, which is the class least likely to be caught by assertion.

## 2. HIGH — the board mixes two clocks: counters that reset on restart, compared against data that does not

I observed this directly rather than inferring it. Restarting the service at 14:35 to verify
`547679e` reset `observedWindowMs` to **300,000** (5 minutes) while the archive, the burnbar
database and every cost figure carried on unbroken.

So the cockpit routinely renders **process-lifetime** figures beside **all-time** figures with no
visual distinction:

| Resets on restart | Persists across restart |
|---|---|
| `observedWindowMs` | burnbar cost/token history |
| the completion counter (`N done this hour`) | archive records |
| pulse momentum baselines | attention records, identity bindings |
| SSE connection state | triage queue |

**"↑1 done in 5m observed" next to "$13,217 in 30 days" is two epochs in one glance.** The failure
is worst immediately after a restart — precisely when an operator is most likely to be looking,
because they just restarted something. A completion counter reading zero five minutes after a
deploy is indistinguishable from a fleet that has finished nothing all day.

This is also the mechanism behind the magnitude audit's worst-ranked item. `N done this hour` was
ranked worst there for having no bound; the deeper problem is that it has no **epoch** — it counts
from process start and is labelled with a wall-clock hour.

**Defence quality: partial and honest.** `observedWindowMs` exists precisely so the label can say
"in 5m observed" rather than claiming an hour, which is a real and thoughtful mitigation. The gap
is that the *neighbouring* figures never declare their epoch, so the qualifier on one cell does not
protect the comparison across cells.

## 3. MEDIUM — no retention boundary has ever fired, and the first one to fire will be unobserved

Measured against the live stores:

| Boundary | Limit | Now | Headroom |
|---|---|---|---|
| Archive records | 5,000 | **536** | 10.7% used |
| Archive retention | 30 days | oldest **11.4d** | 38% of the way |
| Attention retention / cap | 7d / 500 | — | never reached |
| Identity binding TTL | 7 days | — | never reached |
| Triage retention / cap | 7d / 500 | — | never reached |

Archive median age is **1.2 days**, so the store turns over fast and the 30-day edge is only
approached by a long tail. The first real prune is roughly **19 days** away for the oldest record,
and the record cap is not in sight.

**Why this is MEDIUM and not HIGH:** these paths have unit tests with injected clocks, and the
constants are conservative. What is untested is the *interaction* at the moment the store shrinks —
pruning while a snapshot is being derived, `lastAgentClosing` preservation across a prune, and
whether a pruned agent still referenced by an attention or binding record leaves a dangling key.
Those are integration properties that an injected clock in a unit test does not exercise.

**This is the one class that genuinely benefits from waiting** — or from an aged fixture that
fast-forwards a real store through the boundary while the rest of the system runs. That is a
harness build, and it remains the honest answer to your question: **a narrow slice of this
dimension cannot be settled by reading.**

## 4. What I could *not* find without waiting, stated plainly

- **The first prune actually firing**, with the interactions above.
- **SSE reconnection behaviour across hours or days** — whether a client that reconnects 100 times
  accumulates listeners, drifts, or silently stops updating. I can read the code; I cannot observe
  a hundred restarts.
- **Day-boundary and month-boundary rollovers** in the usage buckets. The 90 days of history would
  let someone check this properly against known dates; I ran out of budget before doing it, and I
  am recording it as *not done* rather than *not findable* — the data is there.
- **Long-run monotonic growth** — action log, attention store and archive at 10× the current
  fleet. Bounded by caps, but the caps have never been approached.

---

## The method finding, which I think outranks §3

**While auditing for a defect class, my own measurement harness manufactured that exact defect.**

Probing past the retention horizon, my script reported `$0.00 / 0 calls` at 120, 150, 180, 200 and
214 days. I was one step from filing *"over-long ranges silently return zero, indistinguishable
from no activity"* — a finding that would have fitted the day's pattern perfectly.

The API is well-behaved. It returns a clean **`400 INVALID_RANGE — "Range cannot exceed 90 days."`**
The zeros were mine: `j.measuredCostUsd ?? 0` and `j.invocations ?? 0` in my own formatter, applied
to an error body.

**A `??` default is the suppression pattern in one operator.** It converts "this failed" into a
plausible number, which is precisely what `costKnown` did to $11,939 and what I have been hunting
since this morning. I wrote one into my measuring instrument while looking for it in the
instrument's subject.

The rule this earns, offered for the standing document: **a measurement harness must fail loudly
where the system under test might fail quietly.** No defaults, no `??`, no fallbacks in audit
code — check the success flag and throw. I have since rewritten the query helper to
`if (!j.ok) throw`, which is how the §1 figures were produced.

---

## Answering your question directly

**Can time-dependent defects be found without waiting?** Mostly yes, and by three routes, in
descending order of what they yielded today:

1. **Read the history you already have.** 90 days of burnbar data settled §1 outright. The past is
   the second day; it does not need to be waited for a second time.
2. **Drive production functions with a fabricated clock.** This is how the binding bridge was
   proven in `4982058` — real code, synthetic timestamps, no waiting. It would settle most of §3.
3. **Observe the events that already happen constantly.** Restarts are not rare — I caused one
   today — so §2 was directly observable rather than hypothetical.

**What genuinely requires time** is narrow: the first prune's integration behaviour, long-run
accumulation, and reconnection over many cycles. That is a real remainder and I am not going to
pretend otherwise — but it is a much smaller residue than "behaviour over time is unauditable
without waiting," which is what I would have said this morning.
