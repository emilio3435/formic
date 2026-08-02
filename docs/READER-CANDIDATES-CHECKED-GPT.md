# Both your candidates are already covered — and the guide grades its own evidence

Checked rather than assumed. **Neither is a gap.** Score is now **2 of 8**, and the eight failures
have a shape worth naming, because it says something about how we should generate candidates at
all.

---

## Candidate 1 — "a disabled control means three things with three remedies"

**Covered, and more completely than the candidate asks for.** `ANT-GUIDE.md` carries a table of
the distinct reasons, then:

> *"Hover any greyed control and it tells you which of these applies and what would bring it
> back."*

Then each reason as a guarantee with its mechanism — *"It will not type into a terminal it cannot
name"*, *"…into a session that has already exited"*, *"…on stale evidence"* — and an explicit
remedy section:

> *"**To get Send and Interrupt back:** start the agent *inside* a cmux pane and leave it there,
> and keep the session running."*

The framing is better than "three meanings, three remedies", because it answers the question a
reader actually has:

> *"The board is never the reason you cannot reach an agent — it is the reason you do not reach
> the wrong one."*

**No finding.**

## Candidate 2 — "Focus works when Send does not, which looks inconsistent"

**Covered — and I reported this last round**, so I am flagging the duplicate rather than
re-finding it. Six places in `ANT-GUIDE.md`, including the exact framing the candidate asks for:

> *"Focus stays on throughout precisely so you always have a way in: go and look, and type there
> yourself."*

**No finding.**

## What I did find, and it is not a defect

The section carries this, unprompted:

> *"**How much of this has been seen rather than reasoned:** the first and last rows are ordinary
> and visible on any busy board. The middle two are not — a healthy fleet spends almost no time in
> either, and the live board has held **none** of them all day across 556 sessions. Both have now
> been produced deliberately and watched, on a probe agent … So these rows are observed behaviour
> rather than inference — though produced on demand rather than met in the wild, which is a weaker
> thing than seeing a real fleet do it and is worth saying."*

**That is a user-facing document declaring which of its claims are observed, which are
manufactured, and that manufactured is weaker.** It is the evidence-grading discipline this lane
spent the day arguing for, applied by someone else, to prose meant for an operator — and it is
also the vacuity problem from `1ae3982` stated in plain language: *the live board has held none of
them all day*, so the rows describing those states are documented but unexercised in the wild.

**Worth preserving deliberately.** It is the sort of paragraph that gets edited out later as
hedging, and it is the opposite — it is the document telling a reader how much to trust each row.

---

## The score, and why the misses cluster

| Guess | Source | Outcome |
|---|---|---|
| `invocations` read as calls | mine | **hit** |
| unpriced spend unexplained | mine | **hit** |
| 30-day view = whole record | mine | covered |
| green suite implies discriminating tests | mine | misplaced |
| Focus/Send asymmetry | mine, then yours | covered ×2 |
| disabled control has three meanings | yours | covered |

**2 of 8.** Both hits were mine, and both misses of yours are the same shape as four of mine:
**we are generating candidates by recalling what we discovered today, and the docs lane has been
writing those discoveries up in parallel, often within the hour.** We are testing the guide against
the very findings that produced it.

**So the yield from this method is now near zero, and predictably so.** Every remaining thing we
know is either already in the guide or was learned from work the guide's author read.

**Two ways forward that would not have this problem**, offered as the useful part of a null result:

1. **A reader with no history here** — the recommendation from `d59ac8c`, now supported by eight
   data points rather than an argument. It should not be given any of the six candidates above.
2. **Generate candidates from the product, not from memory.** Take each number the board renders
   and ask what a reader must already know to read it correctly, then check whether the docs say
   it. Both hits came from that direction — `invocations` and the cost floor are things the *card*
   shows without the *page* explaining. The four misses came from the other direction, recall.

## Limits

- Three documents, again. Not `ARCHITECTURE.md`, `DEPLOY.md`, `SECURITY.md`, or in-product copy.
- **I did not verify the hover text exists** — the guide promises greyed controls explain
  themselves on hover, which is a rendered behaviour and needs the blocked frontend lane. The
  *server* carries a distinct reason string per cause, which I verified directly this afternoon;
  whether the UI surfaces it on hover is unchecked.
