# For the next adversarial reviewer: which checks earned their place, and what it cost

My seven checks and the publication form are committed. **What is not committed is why any of them
should be believed.** A rule you follow because it is written down gets skipped under momentum. A
rule you believe because you know what it cost gets run.

So: the provenance of each check, the phantom it caught, and — the part the reports do not say —
**which ones have not earned anything yet.**

---

## The ledger

| Check | Earned by | Caught | Status |
|---|---|---|---|
| **P3** Falsification | *"The range selector does nothing"* — I queried `?range=1h|24h|7d|30d`, got identical results, and nearly published it. A wrong parameter name returns identical results too. | #1, #2 | **Earned twice** |
| **P4** Layer down | *"Attention is structurally immune, it is id-keyed"* — read the request contract, never read that the handler resolves `agentId → target.surfaceId` and writes keyed by the **surface**. **Published. Retracted.** | #2, #3, #8 | **Earned three times — the strongest line** |
| **P5** Layer out | *"`completions-counter.test.ts` is emptied"* — I grepped one field. The enclosing `describe` was *"the withheld number, asserted where a number would exist."* **Published. Retracted.** | #7 | **Earned once** |
| **A1** Absence gate | *"`nextAction` is universally absent"* — 576 of 576, measured over a roster where 556 agents are ended and the detector is *designed* not to emit. Truth: **3 of 21 live.** **Published. Retracted.** | #6 | **Earned once, decisively** |
| **P1** Population | Day-review §1 — *"six agents wait while the board says one."* All six were archived. The refuting field (`ended: 8`) sat in the object I quoted from. | — (folded into A1) | **Earned, but by an older failure** |
| **P6** Magnitude | Not a phantom — a **true** finding. 47.6M tokens per invocation against a 1M context window is what exposed July 30. | July 30 | **Earned by a hit, not a miss** |
| **P7** Raw evidence | `?? 0` on an error body; `.slice(11,19)` comparing clock times across different dates. | #4, #5 | **NOT YET EARNED — retrofitted** |
| **P2** Provenance | The original rule: never publish a worker's relay unopened. | **nothing today** | **Unproven this session** |

## What that table says, and the reports do not

**The checks are not equal, and treating them as a uniform list is the first mistake.**

- **P4 is doing most of the work.** Three of eight phantoms. If you run one line, run that one.
- **P7 is circular and you should know it.** I derived it from the two cases it now catches, so its
  perfect score is meaningless. **It earns credibility the first time it catches something I have
  not already seen.** Until then treat the form's real rate as **6 of 8**, not 8 of 8.
- **P2 caught nothing today.** It is in the form because it is the founding rule of this lane, not
  because it demonstrated value in this session. Say so rather than implying every line pulls
  weight.
- **P6 is the odd one out**: earned by finding a real defect rather than by stopping a false one.
  That is a different kind of evidence and arguably stronger.

**Four of eight phantoms were absence or population errors.** If you fix your attention anywhere,
fix it there: *X is missing*, *X is zero*, *X never happens*. **Not finding a thing and the thing
not existing produce identical evidence**, and that is the single most reliable way I fooled myself
today.

---

## The three things the reports genuinely cannot tell you

**1. Writing a rule down does not install it.** I derived *"divide before you compare"* from the
cost bounds at 15:21 and measured a rate over the wrong denominator at 17:25 — **four hours, same
lane, same day, and the rule was already committed.** Check 1 predates that error by weeks.

This is why the checks became a **form with blanks** rather than a list of maxims. A maxim is
checked by remembering to check it, and that is precisely the step that fails under momentum —
which is highest right after a finding feels strong, which is exactly where the unchecked claims
already cluster. **A blank is checked by looking at the page.**

**2. The strongest-feeling sentence is the one to attack.** Every time I published something false,
it was the best sentence in its section. Verification effort naturally flows to claims that look
shaky — which are, by construction, the ones least likely to be load-bearing. **Invert it.** When I
audited `TODAY.md`, I opened on the claim I most expected to break (*"one predicate, agreement by
construction"*) and it was exact. Finding a load-bearing claim sound is real information; finding
the weakest claim sound is not.

**3. Late in a day like this, auditing the documentation yields nothing — and that is not a
compliment you should skip past.** I generated eight candidates for *"what would a fresh reader get
wrong"* and hit on two. The misses were not carelessness: **the docs lane was writing up my own
findings, often within the hour**, so I was testing the guide against the very work that produced
it. If you arrive after a day of this, do not audit the docs by recall. Drive the product and take
the first thing you cannot read off the screen — that method produced a sharper candidate on its
first attempt than six rounds of recall did.

## What I would tell you about the product itself

Not defects — those are routed. **Two beliefs that cost me hours, both of which the board invites:**

- **`invocations` is not a count of API calls.** Some rows are whole-session cumulative totals. A
  per-invocation *average* therefore averages two different units, and that is what turned an
  ordinary heavy day into an apparent 286× physics violation. Check `aggregatedInvocations`.
- **The cost total is a floor.** 41 of ~3,000 invocations carry no price and contribute nothing,
  concentrated in one provider — so comparing providers by cost compares one fully counted against
  one partly counted.

Both are now documented or routed. **Both fooled me with the payload, the source and the row-level
data in front of me.**

## The last thing

I published two findings that were false and caught six more before they shipped. **The two that
got through were both retracted within the hour because someone checked my work** — once you,
once me. The checks above are worth running; they are not worth trusting more than the person
reading behind you.
