# Adversarial audit of `TODAY.md` (f278120)

Every RELY ON sentence checked against the running product or the suite, not against the commit
that claimed it.

**Verdict: honest as written, with one sentence to strike and one to scope.** That is a better
result than I expected from a consolidation document, and I am saying so plainly because a null is
also a result.

---

## Verified — four claims, checked live

| Claim | How I checked it | Result |
|---|---|---|
| *"will not type into a pane it cannot name, into a session whose process is gone, or on stale routing evidence"* | I exercised all three gates today: `547679e` adversarially with a pane rotation, `ec5ac8f` live against a probe, `26a4585` at code level with the runner instrumented | **holds** |
| *"the button and the endpoint now answer from **one** predicate… agreement by construction"* | `control.ts:129` and `snapshot-agent.ts:43` **both call `transmitRefusal`** from `targets.ts` | **holds, and the wording is exact** |
| *"about $32,943… identical from a one-day window and a ninety-day one"* | measured 1h / 24h / 7d / 30d / 89d — **$32,942.99 at every one** | **holds** |
| *"Rename a symbol and the doc describing it fails the suite"* | ran `tests/reference-docs.test.ts` — **86 tests, 0 fail** | **holds** |

**The strongest claim in the document is the one I most expected to fail, and it is exact.** "One
predicate" could easily have meant "two copies that currently agree" — the state I found and
reported this afternoon. It is a genuine shared function.

**And the cost paragraph is the best-written thing in the file.** It gives a number, timestamps it,
then immediately says *"It is a reading, not a fact… Quote it with its timestamp or do not quote
it,"* and shows the earlier value that moved. That is the honest register applied to the document's
own headline figure.

---

## STRIKE — *"No cmux workspace was created or removed."*

**This is false as a reader will take it.** I created and closed **eleven** cmux workspaces today
running probe agents — `workspace:295` through `workspace:305` — for the write-path audit, the
broadcast rotation, the fix verification and the binding probe.

It may be true of the *particular* probes that paragraph describes, if they ran in an isolated
instance with no cmux. But it sits directly under a sentence about probe work generally, and Emilio
returning after ninety minutes will read it as **"nothing disturbed my cmux today,"** which is not
the case.

**Suggested replacement:** *"Those two states were produced in an isolated instance. Separately,
the GPT lane created and closed eleven cmux workspaces running probe agents against the live board;
all were removed and verified gone."* Which is both true and more reassuring than the absolute
claim, because it says someone checked.

## SCOPE — *"It now reads `4 of 4 collectors healthy`"*

**Not verifiable on this machine, and not verified by me.** The claim is about a first run on a box
with **no cmux installed**. Every provider is installed here, so I cannot produce the condition —
the same limitation that left `42d842e` unverified in my ledger.

Live health reads `verdict: healthy`, `complete: true`, `staleSources: []`, which is *consistent*
with the fix but identical to what I would see if it had never landed. **Check 4: an observation
identical under both hypotheses is not a check.**

Also worth knowing: the same payload carries **`controlErrors: 1`** right now. Not a contradiction
— control errors are not collector health — but a reader told "4 of 4 healthy" would not expect a
non-zero error count sitting beside it.

**Suggested softening:** *"…now reads `4 of 4 collectors healthy` on a machine without cmux
(verified against a fixture, not on a fresh box)."* If it was only ever tested by fixture, the
sentence should say so.

---

## The other two sections need nothing

**"Fixed, but not yet provable"** is exemplary and I would not touch it. *"The oldest stamped record
is 0.1 days old, because stamping began when the fix shipped. Nothing has been held thirty days and
observed to still be there… The clock starts in the right place; the full term is not proven."*
That is the distinction this lane spent all day trying to impose, stated better than I have stated
it. The `368 of 586` figure is the right shape too — a count with its denominator.

**"Still open"** correctly keeps the wrong-reason defect visible and says *"Nothing unsafe happens;
you are simply told to fix the wrong thing."* Accurate.

## What I could not audit

- **The "Still open" section beyond the first item** — I read the first 70 lines and the file is
  80. The tail is unaudited.
- **Anything requiring a rendered read.** The line *"The card does not print it, so a 30-day view
  still looks complete"* is a claim about pixels, and the frontend lane is blocked. It matches what
  I found in the payload, and I have not seen the card.

## Summary for the docs lane

**Four of six RELY ON claims verified live. One to strike, one to scope.** No overclaim in the
reasoning, one in the housekeeping — which is the opposite of where I expected to find it, and
worth noting: the document is careful precisely where the day was contentious, and loose in the
sentence nobody thought to question.
