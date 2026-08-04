# What a fresh reader would still get wrong — one gap, and two hypotheses of mine that were wrong

Done in the version available to me: **not "what would a reader find confusing" (guesswork) but
"do the reader-facing docs state the facts that fooled me?" (checkable).** I named three
hypotheses in `d59ac8c`. **One holds. Two were wrong — in exactly the direction I predicted.**

---

## The one real gap: `invocation` is never defined for a reader

**The word "invocation" appears in no reader-facing document.** Not `README.md`, not
`QUICKSTART.md`, not `ANT-GUIDE.md`. The Usage tab prints an invocation count; nothing tells a
reader what one is.

This matters more than a missing definition, because `ANT-GUIDE.md` **does** explain the underlying
mechanism — and explains it as a *cost* problem only:

> *"The cost source records some sessions as running snapshots — each one a fresh total for that
> session, not a fresh call — so a later snapshot already contains the earlier one and adding them
> counts the same tokens twice."*

That is correct and well written. **But it stops at the money.** The same fact means the
*invocation count* is not a call count, and the guide never says so. A reader finishes that
paragraph understanding that costs were double-counted and fixed, and still reasonably believes
`3,041 invocations` means 3,041 API calls.

**It is the exact belief that cost me two rounds today**, and I had the payload, the source, and
the row-level data. A reader has a number on a card.

**Named fix, small:** one sentence in the same block — *"For the same reason, the invocation count
is a count of usage records, not of API calls; `aggregatedInvocations` says how many are session
totals."* The field already exists; nothing needs building.

## Hypothesis 2 was wrong — and the guide's promise checks out

I predicted a reader would think the 30-day view is the whole record. **`ANT-GUIDE.md` already
covers it**, in the honest register:

> *"Cost figures do not yet say what falls outside your window. The server knows; the card does
> not print it."*

> *"Both halves are de-duplicated now, so a window and the spend before it add up to the same whole
> record whichever window you pick."*

That second sentence is a **promise about invariant I1**, made to the reader. I checked it rather
than assuming, since you measured a 90-day shortfall this morning:

```
1h  → $32,942.99      24h → $32,942.99      7d → $32,942.99
30d → $32,942.99      89d → $32,942.99
```

**It holds at every window including 89 days.** The gap you found has been closed since. The guide
says something true. **No finding — moving on.**

## Hypothesis 3 was misplaced, not wrong

"A green suite means its assertions discriminate" is a **contributor** misconception, not a
reader's. It belongs in whatever the tests lane keeps, not in a document for someone learning the
board. I put it on a reader's list because it was on my mind, which is the error this whole
exercise was designed to expose.

---

## The meta-result, which is the honest headline

**Two of my three hypotheses were wrong, and wrong in the way I predicted an hour ago**: I produced
a list of what *I* found confusing today, and the docs had already moved past most of it — because
other lanes wrote them **in response to my own findings**. I was reading my own week back and
mistaking it for a stranger's first hour.

**So the recommendation from `d59ac8c` stands and is now evidenced rather than asserted.** A fresh
lane with no history here, given the three documents and the board, asked what it believes after
twenty minutes, and checked against what is true. My hit rate on this was **1 of 3**, and the one
hit is a missing definition — the kind of gap you find by *not* knowing something, which is
precisely what I cannot simulate.

**What is worth handing that lane:** do not give it my three hypotheses. It should arrive without
them, or it will find what I found.

## Limits

- **Three documents audited** — `README.md`, `QUICKSTART.md`, `ANT-GUIDE.md`. I did not audit
  `docs/ARCHITECTURE.md`, `DEPLOY.md`, `SECURITY.md`, or the in-product copy, which is where a
  reader actually starts.
- **I tested my own hypotheses, not a reader's.** That is the whole limitation and no amount of
  care inside this session fixes it.
- **The `invocation` gap is checkable and confirmed**; that the belief would actually form in a
  reader is inference from it having formed in me.
