# Routed to the docs lane: the invocation sentence, and one expensive cost gap

Two items for `ANT-GUIDE.md`, which is the docs lane's file — wording handed over, not written in.

Prioritised by **what it costs to be wrong**, not by what is confusing. One survives. **A third
hypothesis of mine did not.**

---

## 1. ROUTED — the invocation sentence

**Where:** the "three things that are still open" block, in the paragraph that already explains
cumulative snapshots.

**Why it belongs there:** that paragraph already tells the reader that some rows are session
totals rather than calls, and then stops at the money. The same fact governs the *count*, and
nothing says so.

**Suggested wording, yours to change:**

> **For the same reason, the invocation count is a count of usage records, not of API calls.**
> Some records are one call; others are a whole session's running total. `aggregatedInvocations`
> in the payload says how many are which. So "3,041 invocations" is not "3,041 calls", and a
> per-invocation average — cost per invocation, tokens per invocation — is averaging two different
> units and should not be read as a per-call figure.

**Why it is worth a sentence:** this exact belief cost me two rounds this afternoon *with the
payload, the source and the row-level data in front of me*. A reader has a number on a card, and
"invocation" means "call" everywhere else in the industry. The last clause matters most — the
per-invocation *average* is what turned a real but ordinary heavy day into an apparent 286×
physics violation.

## 2. NEW, and the more expensive one — the cost total is a floor, and no reader-facing doc says so

**Measured now:**

```
costMissingInvocations : 41 of 3,043
costKnown              : false
```

**41 invocations carry no price at all.** They are counted in the token totals and contribute
nothing to the cost. So the headline cost is a **floor**, not a total — and this is a *different*
gap from the window truncation the guide already covers well.

I searched `README.md`, `QUICKSTART.md` and `ANT-GUIDE.md`: **no reader-facing document explains
that some spend is unpriced and excluded.** The guide's cost caveats are about *what falls outside
your window* and *why a figure went down* — both good, both about a different mechanism.

**Why this is the expensive one.** A reader deciding whether a model is worth its cost is
comparing providers, and the unpriced rows are **not distributed evenly** — they are concentrated
in one provider (Cursor). So the comparison is not merely low by a fixed margin; it is **biased
toward whichever provider happens to be priced.** Being wrong here changes a spending decision,
which is the standard you set.

**Suggested wording:**

> **Some spend has no price and is left out.** A provider's model can be missing from the price
> table, in which case its calls are counted but cost nothing on the board. The total is a floor,
> not a full account, and the gap is not spread evenly — it sits with whichever provider is
> unpriced, so comparing providers by cost compares one that is fully counted against one that is
> partly counted.

**Limit I will not paper over:** the card may already render this — `5ef8cf4` is titled *"a floor
and its gap, in one glance"*. **I cannot check what the card shows**, because that needs the
blocked frontend lane and I am not substituting a payload read for a rendered one. **The claim
here is about the documentation, which I did check, and not about the UI, which I did not.**

## 3. My third hypothesis was also wrong — Focus is covered better than I expected

I expected a reader would not know that Focus stays enabled where Send is refused, and would land
in a terminal that might not be their agent's. `ANT-GUIDE.md` covers it at six places, including:

> *"**Send and Interrupt need more than Focus does**, and this is the one place the buttons
> deliberately disagree. Focus only moves your eyes — worst case you look at the wrong one…"*

> *"Focus stays on throughout precisely so you always have a way in."*

That is more thorough than the sentence I was going to propose, and it names the tradeoff the two
lanes disagreed about. **No finding. Moving on.**

---

## Running score on my fresh-reader guesses: 2 of 6

| Guess | Outcome |
|---|---|
| `invocations` read as calls | **right** |
| 30-day view read as the whole record | wrong — covered |
| green suite implies discriminating tests | misplaced — contributor concern |
| unpriced spend not explained | **right** |
| Focus/Send asymmetry not explained | wrong — covered thoroughly |
| — | |

**Two of six.** Both hits are in the same place: **the cost surface, where a fact is documented for
one mechanism and not carried to the mechanism beside it.** The guide explains snapshots for money
and not for counts; it explains window truncation and not unpriced rows. Neither is an omission of
care — both are the *edge* of a well-written explanation.

**That is a more useful pattern than my hit rate.** If someone continues this, the productive
question is not "what is missing" but **"where does an existing explanation stop one step short of
its own consequence?"** Both hits came from there, and both misses came from me guessing at
subjects the docs had already handled.

## Limits

- Three documents. Not `ARCHITECTURE.md`, `DEPLOY.md`, `SECURITY.md`, or the in-product copy.
- **§2's claim is about the docs, not the card.** Stated twice because the distinction is the
  whole of the standing constraint on the blocked lane.
- Still my hypotheses, not a reader's. 2 of 6 is a better calibration figure than 1 of 3, and it
  is still me grading my own model of someone else.
