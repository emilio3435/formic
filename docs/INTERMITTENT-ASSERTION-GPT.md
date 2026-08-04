# J10 was my error — and the real hard class is not "intermittent", it is "vacuous"

You asked me to chase the one identity that fired once and could not be reproduced, and to name
why if it turned out irreproducible. **It is resolved, and not in my favour: the defect was in my
predicate, not the product.** What the chase turned up instead is a sharper description of the
class we have no method for.

---

## 1. J10 resolved: I asserted the wrong identity

`snapshot.ts:355`:

```js
needsYou: allAgents.filter((agent) => Boolean(agent.attentionSignal)).length,
```

**`totals.needsYou` counts agents carrying an `attentionSignal`. It does not count
`outcome === "needs-you"`, which is what I asserted.**

And `snapshot-programs.ts:52-62` documents that my predicate is the *discarded* one:

> *"It used to count any agent whose outcome was not healthy, which is a different population: a
> failed or blocked session is a fact about the work, not a request for a person. Meanwhile
> `totals.needsYou` counted system findings and the client counted attention signals, so one phrase
> had three meanings and they could not agree. All three now read the same collection."*

**I encoded a defect that had already been fixed, then reported the fix as a defect.** The one
moment it "fired" was a moment when an agent genuinely had a signal — precisely when a correct
board and my incorrect identity must disagree.

That is a fourth phantom finding from my side today, after `?? 0` on an error body, guessed field
names, and a time-of-day string comparison. This one has a distinct shape worth naming: **the
other three were bad measurement; this was a stale specification.** I asserted what the system used
to do.

## 2. Why it looked intermittent — and this is the finding

I sampled both predicates every 2.5 seconds for 75 seconds:

```
samples: 30
OLD predicate (needsYou == count outcome==="needs-you") violations: 0
NEW predicate (needsYou == count attentionSignal)       violations: 0
samples where anything was non-zero                    : 0
```

**Thirty consecutive green samples, and every one of them was `0 == 0`.**

The identity was not intermittent. It was **vacuous**. On a calm board both sides are zero and the
assertion passes without testing anything. It can only diverge when at least one agent carries a
signal — a state this fleet is in for a small fraction of the day. My single observation landed in
that fraction; every other look did not.

**So the wrong predicate was green 30 times in 75 seconds.** Continuous assertion, run exactly as I
recommended it this afternoon, would have reported that identity as healthy indefinitely.

## 3. The class we have no method for is not intermittency

I wrote earlier that *"an identity that fires intermittently is invisible to sampling and obvious
to continuous assertion."* **That was wrong in the second half.**

Continuous assertion catches a defect that *occurs* rarely. It does **not** catch an assertion
whose *preconditions* occur rarely, because a vacuous pass is indistinguishable from a real one in
every report it produces. Frequency of checking cannot fix an assertion that has nothing to check.

**The distinction, which the tests lane needs:**

| | Rare **defect** | Rare **precondition** |
|---|---|---|
| Behaviour | assertion is meaningful, mostly passes, occasionally fails | assertion is meaningless most of the time, passes always |
| Sampling | misses it | reports green |
| Continuous assertion | **catches it** | **still reports green** |
| Green result means | probably fine | **nothing at all** |

Everything I found today was in the first column or was a single-moment defect. **J10 was in the
second, and my own recommendation would not have caught it.**

## 4. What continuous assertion would actually need

Three properties, none of which are "check more often":

1. **Vacuity tracking.** Every assertion records whether it was *non-vacuous* — whether both sides
   were in a state where they could have disagreed. **An identity with zero non-vacuous
   evaluations must report as untested, not as passing.** This is the whole fix for J10: a
   dashboard saying *"`needsYou` identity: 30 evaluations, 0 non-vacuous"* would have told me
   immediately that I had learned nothing.

2. **Trigger on the transition, not the clock.** The informative moment is the edge — the first
   sample where `needsYou` becomes non-zero. Evaluating on state change catches every occurrence
   of a rare precondition; evaluating every 2.5 seconds catches a random subset and reports the
   rest as evidence of health.

3. **Manufacture the precondition.** The probe technique, applied to assertions rather than to
   features. To test the `needsYou` identity you need a board with a signal on it — which is
   exactly the `PROBE-` agent method that proved the write-path misroutes. **An assertion whose
   precondition you cannot create is an assertion you cannot trust**, and that is a design
   requirement on the product as much as on the test.

## 5. The corrected identity, for the tests lane

Replace J10 with:

```
totals.needsYou == count(agents where attentionSignal is present)
```

and add, as separate assertions, the three-way agreement the comment says was the point:

```
totals.needsYou == Σ program.rollup.needsYou == client-side "Needs you" tab count
```

**All three must read the same collection.** The comment records that they once had three
meanings; nothing currently asserts that they still agree, and the fix that unified them is
protected by no test I can find.

Every one of these needs the vacuity tracking above, because all three are zero on a calm board.

## Limits

- **My first sampler collected nothing.** I backgrounded it and the child was killed with its
  parent shell; the 30 samples above are a foreground re-run over 75 seconds. Recording it because
  "I sampled over time" would otherwise overstate what I did.
- **75 seconds is short**, and the fleet was calm throughout. I did not observe a non-zero state at
  all, so I have not *empirically* confirmed the corrected predicate holds when it matters — only
  that it holds vacuously. **That is exactly the limitation this document is about**, and I am not
  going to describe it as verification.
- **I did not test the client-side tab count**, which needs the blocked frontend lane.
