# Routed to the docs lane: three edits to `TODAY.md`, with reasoning

The rest of the document is verified honest — `b6e692e` has the checks. These are the only changes.

---

## 1. STRIKE — *"No cmux workspace was created or removed."*

**Why:** false as a returning reader will take it. The GPT lane created and closed **eleven** cmux
workspaces today — `workspace:295` through `workspace:305` — running probe agents for the
write-path audit, the broadcast rotation, the `547679e` verification and the binding-bridge probe.

It may be true of the specific probes that paragraph describes. But it sits under a sentence about
probe work in general, and Emilio returning after ninety minutes will read it as *"nothing
disturbed my cmux today."*

**Replacement:**

> Those two states were produced in an isolated instance. Separately, the GPT lane created and
> closed eleven cmux workspaces running probe agents against the live board; every one was removed
> and confirmed gone.

**Better than the original**, not just more accurate: it tells him someone checked, which the
absolute claim does not.

## 2. SCOPE — *"It now reads `4 of 4 collectors healthy`"*

**Why:** the claim is about a first run on a machine with **no cmux installed**. Every provider is
installed on this box, so the condition cannot be produced here. Live health reads `healthy`,
`complete: true`, `staleSources: []` — **identical to what I would see if the fix had never
landed**, which makes it an observation and not a check.

**Replacement, if it was tested by fixture:**

> …now reads `4 of 4 collectors healthy` — verified against a fixture, not yet on a real machine
> without cmux.

**One more thing for that paragraph:** the same health payload currently carries
**`controlErrors: 1`**. Not a contradiction — control errors are not collector health — but a
reader told "4 of 4 healthy" will not expect a non-zero error count beside it, and the sentence
sits in the RELY ON section.

## 3. TIMESTAMP the newer cost figure — do not swap it

**$32,942.99** supersedes the **$32,471.40** that has been quoted. **It must not silently replace
it**, because the paragraph's entire argument is that the total is *a reading, not a fact*. A
document that demonstrates that by showing two readings and then quietly overwrites one has
undercut its own point.

**Suggested form:**

> Measured **$32,942.99** at 17:35 CEST, identical across a one-hour, one-day, seven-day, thirty-day
> and eighty-nine-day window. The same total read **$32,471.40** at 17:21 — half an hour of work
> moved it by $471. Quote it with its timestamp or do not quote it.

**And a refinement I did not expect.** I re-measured at **18:03 CEST to demonstrate the drift, and
it had not moved** — $32,942.99 at all five windows, twenty-eight minutes later, to the cent.

So the figure does not drift continuously; **it moves in steps, when ingestion lands.** That makes
the timestamp *more* important rather than less: a number that has sat still for half an hour looks
settled, which is exactly when someone stops quoting the timestamp. The paragraph should say the
total moves in jumps, not gradually — otherwise a reader who checks twice and sees the same figure
concludes the caveat was over-cautious.

---

## Two things worth carrying past this document

**Verify the claim you most expect to fail, not the one that looks weakest.** *"The button and the
endpoint answer from one predicate"* was the sentence I opened the audit intending to break — it
asserts a structural property, and I had found the opposite state (two copies that happened to
agree) six hours earlier. It is exact: `control.ts:129` and `snapshot-agent.ts:43` both call
`transmitRefusal` from `targets.ts`.

The instinct generalises. Effort spent on the weakest-looking claim is effort spent where a
correction changes least. **The load-bearing sentence is the one to attack**, and it is also the
one whose author was most likely to be careful — so finding it sound is real information, not a
wasted check.

**A null stated plainly is a result.** Four of six RELY ON claims verified with nothing to change.
Reporting that is what makes the two corrections credible; an audit that always finds something is
an audit fitted to the expectation that it should.
