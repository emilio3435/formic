# The ledger, closed out — and the "not yet attempted" column was mostly mislabelled

Two verifications and one structural correction. **The correction matters more than either.**

---

## The correction: eight entries I called "not yet attempted" are blocked on the same lane

You asked me to record *why* an entry is unverified, because "blocked on an unavailable lane" is
information and "unverified" is not. Applying that to the remaining nine changed the ledger's
shape rather than just its wording.

I checked which files each touches:

| Fix | Files touched | Verifiable by me? |
|---|---|---|
| `3fb9b45` provenance describes the cost reported | `src/server/burnbar.ts` | **yes** |
| `9493126` three disabled buttons, three answers | `src/web/` only | no |
| `78c0041` a folder-matched pane is its own state | `src/web/` only | no |
| `aaaf323` Focus names the terminal it opens | `src/web/` only | no |
| `5ef8cf4` a floor and its gap, in one glance | `src/web/` only | no |
| `69d5c0d` header restating itself | `src/web/` only | no |
| `8edf115` the stage ends where its content ends | `src/web/` only | no |
| `70ed00b` an empty cockpit must answer | `src/web/` only | no |
| `2c12ef6` a spinner frame is not a name | `src/web/` only | no |

**Eight of nine are render-layer.** They were never "not yet attempted" — they are blocked on
exactly the same unavailable frontend lane as the four already recorded that way. My earlier
column implied I had simply not got to them, which was wrong and flattered the ledger: it made the
remaining work look like my backlog when it is someone else's blocker.

**So the honest state is that I have verified everything I am able to verify.** What remains is not
a queue I am working through — it is twelve entries that require a lane that cannot take work, and
one that requires a machine configured differently from this one.

---

## `858a993` — the `controlsFor` residual — **CLOSED, verified live by me**

You verified it; I re-checked against the running board rather than taking the ledger entry on
your word, which is the whole point of the column:

```
dead-process agents            : 12
of those advertising instruct  : 0     ← residual closed
routable agents                : 9
of those advertising instruct  : 6
```

**Zero agents with a dead process advertise Send.** The button and the endpoint now agree, which
was acceptance criterion #5 of the `mayTransmit` spec and the thing `547679e` had explicitly set
out to avoid getting wrong.

*One difference from your reading, and it is not a disagreement:* you saw 3 of 9 live agents
advertising instruct, I see 6 of 9. The board moved between our reads — agents cross the routable
threshold constantly. **The number that decides the question is identical in both: zero dead
agents advertising it.**

## `3fb9b45` — provenance describes the cost reported — **VERIFIED BY DRIVING THE RUNNING API**

```
top level : costProvenance "measured" · costKnown false · estimatedCostUsd 14,129.27
Codex 4754 measured · Claude Code 9135 measured · Hermes 240 measured
Factory 1 measured · Cursor null unknown
```

Every priced provider reports `measured`; the unpriced one reports `unknown`. **Provenance now
answers *how* the cost is known and `costKnown` answers *whether* it is complete** — two questions
that were conflated, in the fix's own words, so that a window with 2,931 of 2,973 invocations
priced claimed no measured cost at all.

This is the fourth instance today of the same principle landing: **the qualifier sits beside the
value instead of replacing it.** `tokensMissing`, `costKnown`, `completionsProvenance`, and now
`costProvenance`.

---

## Final ledger

| State | Count | Why |
|---|---:|---|
| **Verified** | **11** | driven against the running system, except `26a4585` (code-level, live impossible — stated at the time) |
| **Blocked — frontend lane unavailable** | **12** | render-layer fixes; the lane is stopped on its own usage limit and a payload read is not a rendered read |
| **Blocked — condition absent here** | **1** | `42d842e`: no never-installed provider exists on this machine, so the observation is identical whether the fix works or not |
| **Withdrawn by me** | 2 published, 5 caught pre-publication | recorded in `51ac1af` |

*Total is 24 by this enumeration against the 23 I used earlier; the earlier figure counted
findings and this one counts commits. Recording the discrepancy rather than quietly reconciling
it.*

**Verified went from 3 → 11 today.** The eight added are: `ec5ac8f`, `26a4585`, `57add8a`,
`71d7cb3`, `c58d85c`, `d877753`, `fbdf2c0`, `3fb9b45`, plus `858a993` closing the residual.

## What the closed-out ledger says about the three merged PRs

Every fix that governs **whether an instruction reaches a stranger's terminal** is verified:
`547679e`, `ec5ac8f`, `26a4585`, `858a993`. Every fix that governs **the cost number Emilio acts
on** is verified: `dcdb888`, `c58d85c`, `57add8a`, `71d7cb3`, `d877753`, `3fb9b45`.

**The twelve unverified are all presentation.** That is a real gap — this week's evidence is that
presentation defects mislead operators as reliably as arithmetic ones, and the render half is
where several of the worst findings lived. But it is a gap of a different kind from an unverified
write path, and it is the correct place for the remaining risk to sit.

## Still diagnosed and unfixed — unchanged

July 30's impossible token rate (**worsening**), archive retention measured from last activity,
`maxRecords` overstating operator capacity, partial-period bars, context windows as asserted
denominators, the two-session `exact` conflict, archive/burnbar attribution gap, `pricingVersion`,
and snooze's success path which I could not exercise.
