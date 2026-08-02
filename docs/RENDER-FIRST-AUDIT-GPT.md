# Render-first audit: what the operator believes

Every prior audit started from `/api/snapshot` and asked *does the board render this
faithfully?* That method cannot catch a number wrong in both places, or a number read correctly
and interpreted wrongly. This one starts from the pixels and asks, of each figure: **what would
a reasonable operator believe, and is that belief true?**

**Ranked by how badly a correct reading misleads**, not by arithmetic error. `Elapsed` is the
template — `87.1d` was arithmetically right, the belief it induced was false, and no
payload-first audit would ever have flagged it.

**Measurement conditions.** Worktree `/Users/emilionunezgarcia/Developer/the-mountain-main`,
branch `fix/backend-silent-failures-and-freshness`. I began at HEAD `143556e` with 8 files
dirty; the tree moved under the audit and a worker ended on `fe54c05`. Port 4701 intermittently
dropped between reads. Every figure below names the read it came from, and where counts differ
between sections that is the board moving, not a contradiction.

**Almost every finding here is a figure whose arithmetic is correct.** That is the point.

---

## 1. Three attention counts, each correct, and the operator gets a false all-clear

Rendered simultaneously at one read: the summary rail `NEEDS YOU 1 finding`, the tab
`Needs you 0`, and the empty-state headline `Nothing needs you`.

**Belief induced:** *nothing requires me.* Two of the three surfaces say so outright.
**True?** No. There is 1 open finding. Each count is correct **for its own hidden population** —
the rail counts system findings, the tab counts agents with an attention signal, the empty state
renders when the tab's population is zero.

This is the worst misdirection on the board because it is wrong about **the single question the
cockpit exists to answer.** An operator who reads "Nothing needs you" and closes the tab has been
told the truth by three widgets and misled by their composition.

**Fix (named, not made):** split the vocabulary. `1 system finding` and `0 agents waiting` are
different sentences; the empty state must not render while any attention population is non-zero.

## 2. Row `TOKENS 128k` beside program `65.7M session tokens` — the qualifier is hover-only

**Belief induced:** *this row's 128k is part of that program's 65.7M.*
**True?** No. The row figure is the **latest model call**; the program figure is cumulative
`sessionTotal` across every agent including ended. They are not summable and differ by ~500×.

The row's own scope is disclosed **only in a `title` attribute**. A qualification visible only on
hover is a qualification that does not exist — no operator hovers a number that looks
self-explanatory.

This is the exact shape that hid 1.6B, one level down: correct arithmetic, correct label *if you
read the tooltip*, and a visible rendering that invites an impossible addition.

**Fix:** put the scope in the visible label (`128k latest call`), or place the two figures where
no reader would sum them.

## 3. BURN stopped being falsifiable

This is the finding I did not expect, and it is a genuine render-first result.

At an earlier read BURN showed `5,089,747/min` beside `$4.41 last hour`. That pair was
**self-falsifying**: it implied $0.0144/M against a $0.50/M floor, and 8,483 tokens/second/agent
against a generation ceiling of 50–100. Any operator who did the division caught it.

Today it renders `24k /min · cost unavailable · No priced invocations in this window · 10m
average`. The rate now sits in a believable range — 30 tok/s per working agent — and **the cost
that made the contradiction visible is gone.**

The unit did not change: `pulse.ts:168` still sums `sessionTotal`, which is ~99% cache re-reads.
So the widget went from *visibly wrong* to *invisibly wrong*. **The board lost its own error
detector.**

I deliberately do **not** claim the rate is now over- or under-counting: my hand-check says
23,660/min over 13 working agents implies 0.02 turns/agent/10min, which is 400–800× *lower* than
cache-inclusive counting should produce for genuinely active agents. That divergence could be
the rate under-reporting, or the 13 "working" agents not actually taking turns (see §5). I
could not distinguish those, and saying which would be exactly the unchecked-relay habit this
lane wrote a rule about.

**Fix:** render the rate's population and window in the visible string, and keep a cost or
another cross-check adjacent. A number nobody can check is worse than a number that is visibly
wrong.

## 4. Screen-reader operators get stale values and the old word

A worker found **5 of 13 rows whose accessible span text contradicted their visible clock** in
one capture, and the aggregate ARIA still says `Elapsed` after the visible label was changed to
`Span`.

**Belief induced (for a screen-reader operator):** the value read aloud is current, and it is
elapsed working time. **True?** Neither. This is both a value failure and a word failure, and it
lands on the users least able to cross-check it against the rest of the screen.

Worth noting the visible `Elapsed → Span` rename is a real improvement from the magnitude audit;
the accessible layer simply did not move with it.

## 5. `13 shipping` and `↑22 done in 10m observed`

**`shipping`.** Belief: *13 agents are producing work.* Truth: `activity === "working"`, which
`statusFrom` derives from **transcript recency alone** — anything written in the last 3 minutes.
An agent thinking, waiting on a build, or mid-tool-call is "shipping".

**`done`.** Belief: *22 tasks completed.* Truth: `working → idle` transitions, re-countable per
agent, never verifying success. Already documented in the magnitude audit.

**The render-first observation that is new:** adding the honest window qualifier
`in 10m observed` made this figure **more** misleading, not less. It previously overstated its
window and now states it precisely — which reads as a measured, verified rate and invites
extrapolation (`22 in 10m` → 132/hour). Precision about the denominator lends credibility to a
numerator that has not earned it.

**Fix:** the noun is the defect. `13 active` and `22 sessions went quiet` are true; `shipping`
and `done` are claims the data cannot support.

## 6. Subset grammar: `39 live · 8 working · 31 idle · 21 quiet 15m+`

**Belief induced:** four parallel buckets. **True?** `8 + 31 = 39` — the first three partition
correctly. But I verified `stalled ⊆ idle` exactly: all 21 quiet agents are inside the 31 idle,
with zero overlap into working.

Rendered as four comma-separated figures, the grammar makes 21 look like a fourth sibling. Sum
them and you get 60 against a stated 39.

**Fix:** grammar, not arithmetic — `39 live: 8 working, 31 idle (21 quiet 15m+)`.

## 7. Tab counts masquerade as disjoint

`Needs you 1 | Now 14 | Working 14 | Idle 30 · 6h | History 58 · 6h`.

**Belief:** five disjoint views. **True?** `Now` is a union (`working ∪ alerting`), alerts overlap
Working, and only Idle and History carry a lookback — the absence of `· 6h` on Now and Working
implies they are unfiltered, which is a claim nothing verifies. `Now 14` beside `Working 14`
implies two concepts while exposing one set.

## 8. `CONTEXT PEAK 98% · Median 6%` over a filtered list

**Belief:** *the fleet is under context pressure.* **True?** Partly — the two summary figures are
commensurable with each other (same all-live population, verified), but that population is
unlabelled and differs from the list below. A worker sampling the Working rows measured a median
of **41%** against the displayed **6%**. The headline describes one agent near the ceiling; the
operator reads a fleet condition.

---

## What this method caught that payload-first could not

Of the eight findings, **seven involve figures whose arithmetic is correct.** Payload-first
auditing would have passed every one of them, because in every case the payload was right and
the board rendered it faithfully. The defects live in four places a payload cannot contain:

- **the noun** (`shipping`, `done`, `Elapsed`)
- **the neighbour** (three attention counts; row tokens beside program tokens)
- **the grammar** (commas implying disjointness)
- **the absence of a cross-check** (BURN losing the cost that exposed it)

The last of these is the one I would carry forward hardest: **a fix that makes a wrong number
look plausible is worse than the wrong number**, because it removes the only signal an operator
had. BURN at 5M/min was self-reporting a defect. BURN at 24k/min is not.

---

## Caveats

- **The tree moved during measurement** — I started at `143556e`, a worker ended at `fe54c05`,
  and several of my own earlier findings landed mid-audit (`Span` replacing `Elapsed`, the window
  qualifier, tab lookbacks). Counts differ between sections for that reason.
- **Port 4701 dropped intermittently** between reads, so some captures are timed rather than
  simultaneous. Where a finding depends on two figures being on screen together (§1, §2), I have
  said so explicitly; those were single captures.
- **§3 deliberately stops short** of naming the direction of BURN's error. I established that the
  cross-check is gone, not which way the number is wrong.
- **§4's "5 of 13 rows" is a worker's capture** which I did not reproduce myself. The
  `Elapsed`-in-ARIA half I did confirm.
- **The Usage tab is still unaudited** — it was gap 2 in my previous list and remains open. This
  round covered the default view only.
