# Third critique: the resting state

**Why this round is different.** Sixteen abandoned cmux panes were closed and `controlHealth`
errors went 17 → 0. For the first time the board has nothing wrong to display, so for the first
time the **resting** state can be judged rather than the alarmed one. Resting is what an
operator stares at 95% of the time.

**What resting looks like.** The summary collapses to one line —
`● 6 shipping · ↑52 done this hour · 149k tok/min` + an unlabelled sparkline + `✓ All clear` —
the rail carries `health-rail is-calm`, the board opens on `Needs you 0`, and the body renders
one sentence: *"Nothing needs you. Every tracked session is working or done — open Now for the
whole board."*

**Method.** Four Codex workers at high effort plus my own measurement. The transition was tested
by driving the real `TheAntHill.pulseStripModel` with synthetic snapshots through the live
page — no mutation, just the pure function with constructed inputs.

**Verdict up front.** The collapse is the north star working and it is a genuine improvement.
But the resting state currently asserts three things that are **not true**, and the calm/alarmed
response is **binary** — the board is silent until it screams, with the one graded input sitting
on a 1-percentage-point cliff.

---

## 1. Credit

- **The collapse is correct.** Five cells reporting absence around nothing was the exact defect
  the previous audit named; `pulseStripModel` now carries the convention explicitly — *"A cell
  that has nothing to report does not render"* — and cites the audit sections it closes.
- **`Needs you` as the default tab is right**, and it renders `0` honestly rather than hiding.
- **`Notifications off`** replaced the ambiguous `Alerts off`, removing the one-noun-two-systems
  collision.
- **The calm predicate refuses to claim calm on partial evidence** — `!queueError` is in the
  condition specifically so an unreachable triage queue cannot be mistaken for an empty one.
  That is the right instinct, and §2 argues it was not applied widely enough.

---

## 2. The resting state asserts three things that are false

### 2.1 "Every tracked session is working or done" — while 12 of 18 live agents are stalled

**Evidence.** `/api/snapshot` at the measured moment: `totals.live: 18` (6 working, 12 idle),
and `pulse.momentum.stalled: 12` with 12 entries in `stalledAgentIds`. `pulse.ts` marks a
**healthy live** agent stalled after 15 minutes without an `updatedAt` advance.

A stalled agent is neither working nor done. It is the third state the sentence denies exists,
and it is two thirds of the live fleet. The board is not merely silent about the stall — it
actively asserts the opposite.

**Fix.** `renderPrograms()` empty copy → *"Nothing needs you. 18 live: 6 working, 12 idle.
12 sessions quiet 15m+."*

### 2.2 "52 done this hour" — when the tracker has not observed an hour

**Evidence.** `pulse.momentum.observedWindowMs` was 2,400,000 ms — **40 minutes**. The old
MOMENTUM card carried the qualifier `in 45m observed` precisely so a partial window could not
be read as a full one. The collapsed line drops the qualifier and hard-codes `this hour`.

The collapse did not just lose a caveat; it **upgraded a partial observation into a stronger
claim than the data supports**. An orchestrator reading "52 done this hour" and extrapolating a
rate is being misled by rounding-up that the previous design deliberately prevented.

**Fix.** Render `↑52 done in 40m observed` until `observedWindowMs >= 3600000`.

### 2.3 "All clear" — a narrow predicate presented as a comprehensive verdict

**Evidence.** The calm condition (`app.js:2468`):

```js
const calm = !!snap && !!attention && attention.count === 0
  && status.key === "operational" && !(peak && peak.pct >= 85) && !queueError;
```

Four inputs. `stalled` is not one of them. Neither is `controlHealth.debris` (present on the
live board), nor `recentlyResolved` (3 entries). "All clear" is a claim about the whole board
computed from a predicate that never reads the fields most likely to contradict it.

**Fix.** Either narrow the words to the predicate — `No findings` — or widen the predicate to
the words. Do not keep a four-input boolean labelled as a verdict on everything.

---

## 3. The transition is binary, and the only graded input is a cliff

I drove `TheAntHill.pulseStripModel` with synthetic snapshots up an escalation ladder. Result:

| Rung | `calm` | cells | findings | Operator sees |
|---|---|---:|---:|---|
| 0 clean | `true` | 2 | 0 | `All clear` |
| 1 **12 of 18 live stalled** | **`true`** | 2 | 0 | **identical to clean** |
| 2 **all 18 live stalled** | **`true`** | 2 | 0 | **identical to clean** |
| 3 context peak **84%** | **`true`** | 3 | 0 | still the calm line |
| 4 context peak **85%** | `false` | 3 | 0 | full stressed grid |
| 5 one source degraded | `false` | 3 | 0 | full stressed grid |
| 6 cmux unreachable | `false` | 3 | 0 | full stressed grid |
| 7 one error issue | `false` | 3 | 1 | full stressed grid + finding |

Three things fall out of this table.

**Total swarm paralysis is indistinguishable from perfect health.** At rung 2 every single live
agent is frozen and the board renders the same one-line `All clear` as rung 0. If the whole
swarm stopped, the cockpit would not change a pixel.

**The one graded input is a 1-point cliff.** 84% → calm. 85% → stressed. An agent one
percentage point from exhausting its context window produces a fully calm board; the next
point flips the entire layout from a one-line murmur to a three-cell grid.

**There is no murmur.** Between rung 0 and rung 4 the rail state does not change at all. The
answer to "silent until it screams" is: yes, literally — `calm` is a boolean and the rendering
branches on it wholesale.

**Fix — add a watch tier.** A third state between calm and stressed, rendered as the same one
line with one appended clause rather than a layout change. Trigger it on the signals that
currently pass silently:

```
● 6 shipping · ↑52 done in 40m · 149k tok/min · ⚠ 12 quiet 15m+ · peak ctx 84%
```

Escalate to the stressed grid only when a finding needs a remedy. That gives the cockpit a
volume knob instead of a switch, and it costs one clause.

---

## 4. What the collapse took, field by field

Reconstructed from `WIDGET_CATALOG` (`client-catalogs.js:32`) and `summaryWidgetData`
(`app.js:591`).

| Field | Old card | In the collapsed line? |
|---|---|---|
| Findings count `0 findings` | NEEDS YOU | Degraded to `All clear` |
| Top finding titles | NEEDS YOU sublabel | **Dropped** |
| `6 shipping` | MOMENTUM | Carried |
| `↑52 done` | MOMENTUM | Carried, **with a false window** (§2.2) |
| **`12 quiet 15m+`** | MOMENTUM | **Dropped** |
| `149k /min` | BURN | Carried |
| **`$X last hour`** | BURN | **Dropped completely** |
| Burn coverage `N/M reporting` | BURN | Dropped |
| Burn provenance note | BURN | Dropped |
| **`75% peak window`** | CONTEXT PEAK | **Dropped below 85%** |

Three of these matter:

- **`12 quiet 15m+` was already being rendered.** The old card showed the stall count. The
  collapse dropped the one field that would have contradicted "working or done". This is not a
  missing feature; it is a regression.
- **Spend is gone entirely.** For an orchestrator running 310 sessions, a token *rate* is not a
  substitute for money. Recovering it means Usage → Custom 1h.
- **Context peak is invisible below 85%**, which is exactly the range where it is an early
  warning. Above 85% it is no longer early.

---

## 5. The empty board

**Measured** at 1440×900: masthead 75.4px, calm rail 75.2px, empty-result block 147.0px.
**83.7% of the viewport is blank**, with a contiguous blank tail of ~506px (56.2%). Zero
`.agent-row` elements render. The cockpit's landing state shows **0 of 310 sessions**.

The honest tension: silence-when-nothing-needs-you is the north star, and an empty `Needs you`
is that principle working. But a board showing zero rows also gives the operator no evidence
the swarm is alive or that the page is still connected to it — and `● LIVE` plus `All clear`
are exactly what a frozen client would also render.

**Middle path.** The 12 stalled agents are already computed and rendered nowhere
(`stalledAgentIds`). They are the ideal occupant of that space: not an alarm, but not nothing —
the murmur from §3, as rows rather than a clause. An operator seeing *"12 sessions quiet 15m+"*
with those rows listed can decide whether that is expected. An operator seeing white space
cannot decide anything.

---

## 6. Fixes, ranked

1. **Correct the false empty-state sentence** (§2.1). It is one string and it is currently
   wrong on two thirds of the live fleet.
2. **Restore the observation-window qualifier** (§2.2). One conditional; stops the line
   overstating its own evidence.
3. **Add the watch tier** (§3). One appended clause, no layout change. This is the fix that
   answers "silent until it screams".
4. **Put `stalled` into the calm predicate** — or explicitly document that calm means "no
   findings", and rename the words to match.
5. **Return spend to the calm line** (§4). `· $19.54/h` is eleven characters.
6. **Show peak context in the calm line above a low watermark** (say 60%), not only above the
   85% alarm.
7. **Fill the empty board with the stalled rows** (§5).

---

## 7. Where this critique could be wrong

- **The board moved during measurement.** It drifted from 18 live / 6 working / calm to 23 live
  / 11 working / Advisory while the workers were reading. Every number here names the read it
  came from; the escalation ladder in §3 is synthetic and therefore stable, and it is the load
  bearing evidence.
- **§3's ladder exercises `pulseStripModel`, not the renderer.** I verified `calm` and cell
  counts, not that `renderHealthRail` paints exactly what I predict at each rung.
- **"12 stalled" may be expected in this fleet.** Many of those sessions are ended-and-waiting
  by design. That strengthens the §2.1 copy fix and weakens any argument for alarming on
  stall — which is why §3 proposes a watch tier rather than an alert.
- **I did not test the reverse transition** — what the board looks like as a fault clears and it
  returns to calm. A cockpit that is slow to relax is its own problem.
