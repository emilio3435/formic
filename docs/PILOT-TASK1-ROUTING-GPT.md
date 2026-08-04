# Routed: Task 1's remaining defect — and the answer about my own documents

---

# Part 1 — `5778272` verified, and what it did not cover

**Claim type: I read the diff and the current plan text.**

## The transmit gap is closed, and closed better than I specified

`5778272` adds what I asked for and two things I did not:

- `mayTransmit: boolean; refusalReason?: string` on `PilotCandidate` ✓
- *"come from the same predicate the drawer's controls use — **do not recompute them here**"* — **stronger than my version.** I said "carry the verdict"; recomputation is exactly how `controlsFor` and `executeControl` drifted apart in the first place.
- *"The reply control does not render at all when `mayTransmit` is false"*, with `refusalReason` in its place ✓
- *"When a reply IS sent, it goes through `executeControl`; the Pilot never writes to a terminal directly"* — closes the bypass hole ✓
- **And the judgement call I had not made:** *"A candidate whose Send the server would refuse is still a decision worth surfacing; it simply cannot carry a reply box. Surfacing it without the box is correct, hiding it is not: an agent waiting on a human it cannot receive an answer from is exactly the state an operator needs to see."*

That last paragraph is the right call and I had not thought it through. Suppressing those candidates would have made the queue quietly under-report the agents in the worst state.

**Nothing to add. Verified.**

## Still open: the Task 1 type defect

The update touched the write-gate half only. `PilotCandidate` still reads:

```ts
kind: AttentionSignalKind
```

**That union has nine members, three of which mean *there is nothing here*** — `nothing-wanted`,
`not-readable`, `out-of-scope`. `nothing-wanted` is literally *"we looked and nothing wants a
human."* A collector typed on it **type-checks while admitting non-candidates.**

`attention-signal.ts:326` already has the right type:

```ts
type ActionableKind = Exclude<AttentionSignalKind, "nothing-wanted" | "not-readable" | "out-of-scope">
```

**Two edits:** export `ActionableKind` from `attention-signal.ts`, and have `PilotCandidate` use it.
Then the collector cannot express a non-candidate and the filter is the type rather than a line
someone must remember.

**Also still to check:** Task 1's *Consumes* line claimed `AttentionSignalKind` comes from
`src/shared/types.ts`. It does not — it is at `attention-signal.ts:35`, and `shared/types.ts`
contains zero references. Line numbers shifted in the update so I could not confirm whether that
line was corrected; **worth one look.**

---

# Part 2 — Should I commit unreviewed, now that my documents are test fixture?

**Yes, unchanged — and not because the risk is imaginary. Because the review that matters already
exists, and it is in a better place than commit time.**

I went to answer this by reasoning and found the answer already measured.

## What the tests lane did with my bounds document

`tests/physical-bounds.test.ts:163` contains a test named:

> *"real history: a row is a session of many calls, so no per-call ceiling applies"*

with this comment:

> *"Why B1 and B2 cannot be asserted as written… Pinned rather than written up, because the next
> person to read the bounds document will reach for `tokens <= 2_000_000` per row and it will fail
> on [real data]."*

and it asserts `expect(max(row.tokens)).toBeGreaterThan(2_000_000)`.

**They pinned the refutation of my own bound.** And they did not pin **B5** (which I later found
unevaluable — the payload has no component fields) or **B9** (which I said to drop). The suite also
carries *"the bound is not tuned to the data it must not fire on"* and *"the history was actually
read, so no bound passes on an empty set"* — **the vacuity discipline, applied to my document, by
someone else.**

So the failure mode I was about to warn you about — **my errors laundered into green tests, where a
passing assertion confers credibility a wrong sentence never had** — is real, and **it did not
happen, because a second party read the document before pinning it.**

## Why commit-time review would be the wrong fix

1. **It gates everything to protect a little.** Most of what I write is reasoning, judgement and
   narrative. None of that is pinnable and none of it should be. Only the numeric and structural
   claims got picked up.
2. **I am the worst judge of which of my sentences is load-bearing** — the same reason I was the
   worst judge of what confuses a fresh reader. I would have told you B1 and B2 were my most
   assertable claims. They are the two that could not be asserted.
3. **Pinning-time review is done by someone whose job is scepticism**, on the specific sentence
   about to become executable, with the real data in front of them. That is strictly better
   information than a reviewer reading a document at commit time.

## What it *does* change, and this part is on me

**I should write knowing a sentence might be pinned, and mark which ones are meant to be.** My
bounds document mixed assertable claims with reasoning and did not distinguish them — B1 and B2
*read* as specifications, and were not. Someone had to work that out from real data instead of from
my document.

**The fix is labelling, not review.** Anything I intend as assertable should carry its population,
its provenance and what would falsify it — the publication form's P1, P2, P3 — inline, so whoever
pins it can see what it rests on without re-deriving it. Everything else should be visibly *not*
that.

**And one thing I would ask for rather than offer:** if a lane pins one of my claims and finds it
cannot be asserted as written, that correction should come back to me the way this one did — in the
test, where I will trip over it — and not only into the suite. I found this by grepping my own
document's identifiers. I would not have found it by reading the suite.

## Summary

- **Do not gate my commits.** The control is at the pinning, it works, and it has already caught me.
- **Do keep it there deliberately** rather than by accident, because today it depended on one lane
  choosing to read carefully.
- **I will label assertable claims as assertable**, which is the part that was actually missing.
