# Standing verification rule — GPT counterweight lane

Binding on this lane and on every Codex worker it dispatches. Written after publishing two
findings that were wrong in the same way on the same day.

---

## The rule

**A claim is evidence only if I opened the artifact it rests on.**

Not the worker's quote of the artifact. Not the worker's characterisation. Not my own earlier
summary of it. The file, the payload, or the pixels.

Workers are for **breadth** — sweeping 1300 transcripts, enumerating 40 fields, running an
escalation ladder. They are not a chain of custody. Whatever survives into my document, I open
myself before it ships.

---

## What counts as evidence

| Tier | What it is | May I publish it? |
|---|---|---|
| **Direct** | I ran the command, read the file at that path, or measured the rendered DOM, in this session | Yes |
| **Checked relay** | A worker found it; I then opened the same artifact and confirmed it | Yes, and say a worker found it |
| **Unchecked relay** | A worker asserts it and I have not opened the artifact | **No.** Label it, or cut it |

An unchecked relay may still go in a document — as an open question, explicitly marked, never
as support for a conclusion.

## The publication form — answer with VALUES, not with yes

Written after a day in which I derived "divide before you compare" from the cost bounds and then,
four hours later, measured a rate over the wrong denominator in my own work. **Writing a rule down
does not install it.** Four of the day's five phantoms lived in the gap between deriving a
principle and applying it to myself.

So the checks below are **questions with blanks**, not maxims. A maxim is skippable because
nothing is visibly missing when you skip it. A blank is not. **No finding ships until every
applicable line has a value written next to it.**

```
FINDING: ______________________________________________

P1  Population    — measured over what set, and what is N?     ____ of ____ (set: ______)
P2  Provenance    — what command produced this, and when?      ______________ @ ______
P3  Falsification — what would that command return if the      ______________________
                    claim were FALSE?  (if "the same": STOP)
P4  Layer down    — which layer did I read, and what does      read: ______ → under: ______
                    the one under it say?
P5  Layer out     — what encloses what I read?  (the enclosing ______________________
                    describe / function / the next line)
P6  Magnitude     — what must be true for this value to be     ______________________
                    correct, and does that story hold?
P7  Raw evidence  — paste the RAW line the claim rests on,     ______________________
                    unformatted and undefaulted. No ??, no
                    ||, no .slice, no rounding, no summary.

A1  ABSENCE GATE — mandatory if the finding is "X is missing / null / zero / never happens":
    Over what population is X *defined*?                       ______________________
    What is the count over THAT population?                    ____ of ____
    Who deliberately made X absent, and where?                 ______________________
```

**P5 is new**, and it is what the last two phantoms needed: `nextAction` was pinned exactly by the
assertion on the *next line*, and `completions-counter.test.ts` was proven non-vacuous by the
`describe` block *enclosing* the line I grepped. Both were within twenty lines of my match. P4 says
read *down*; P5 says read *out*; a symbol match tells you neither.

**A1 is mandatory by default for absence claims**, because **three of my five phantoms were
absence claims** — "the range selector does nothing", "triage has no origin gate", "`nextAction`
is universally absent". Absence is the easiest thing to be wrong about, because *not finding* a
thing and *the thing not existing* produce identical evidence. The third line of A1 is the one that
would have saved the `nextAction` claim in a single lookup: `b9dc19b` deliberately stopped the
detector emitting on ended agents, so the absence I measured was a fix working.

**P7 exists because P1–P6 and A1 all share an assumption: that what I am looking at *is* the
data.** Every other line asks whether I reasoned correctly *about* the evidence. P7 asks the prior
question. Three of eight phantoms failed it — a `?? 0` applied to an error body, a `.slice(11,19)`
that compared clock times across different dates, and a grep for a field name I had invented.

## What this form does NOT catch — its own known blind spot

*A view that cannot show everything must say what it cannot see. That standard was imposed on the
product all day; it applies here.*

**Measured, not asserted: back-tested against 8 known phantoms, the form as first written caught
6.** The two it missed are recorded here rather than in commentary, because a tool that implies
completeness is the same defect as a total that hides its truncation.

| Blind spot | Example it let through | Mitigation |
|---|---|---|
| **The instrument between me and the data.** Every line can be filled correctly while the finding is false, if my *measurement* is what lied. | *"Over-long ranges silently return $0.00"* — my script defaulted an error body through `?? 0`. P2 was satisfied by naming the script; P3 was satisfied because a real non-zero cost genuinely differs from what I saw. | **P7**, added after the fact |
| **Fitting to known data.** P7 was derived by looking at the two cases it now catches, so its 8-of-8 score is circular. | — | P7 earns credit only when it catches a phantom **not yet seen**. Until then treat the form's demonstrated rate as **6 of 8** |
| **Concentration.** Of the 6 caught, 3 fell to P4, which predates them. Demonstrated value sits in **P3, P5, A1** — three lines, four phantoms. | — | Do not read 6/8 as evidence that every line pulls weight |

**Still unknown:** whether the form catches anything on data it was not written against. Every
number above is retrospective. **The first prospective catch is the only one that will mean
anything**, and this section should be updated with it — or with the first phantom that gets
through despite a completed form, which would be worth more.

The six checks below remain the reasoning behind the form. The form is what gets filled in.

---

## Six checks before any claim becomes a finding

1. **Population.** When a number on the wire disagrees with a number on screen, prove the two
   count the same set before calling it a bug. `totals.attention`, `issues.length`, and "agents
   with a signal" are three populations. Three numbers measuring different things are allowed
   to differ.
2. **Scope of a quote.** When a comment appears to support a claim, read the code *under* it. A
   comment justifies the line beneath it, not the paragraph I wish it justified.
3. **Freshness.** Every count names the read it came from. A live board moves; a number without
   a timestamp is an anecdote.
4. **The check itself.** State what the verification command would return if the claim were
   false. A check that cannot fail is not a check — see the trap below.
5. **Magnitude.** For any number with no on-screen referent — no denominator, no bound, no
   neighbour it must agree with — state what would have to be true for the value to be
   *correct*, and check that story holds. **If I would have accepted any value within an order
   of magnitude, I have not checked it.**
6. **Follow the value to where it is used.** Before reporting that a guard, gate, or field is
   absent, name the layer I read and then read the next one down — the handler under the route,
   the store under the handler, the key the store is written by. **Say out loud which layer the
   claim rests on.** A claim of absence is a claim about *every* layer, so it is only earned by
   having looked at more than one.

Check 5 is not provenance and the first four do not catch it. A number can be measured by me,
quoted correctly, and still be meaningless — see "the magnitude blind spot" below.

Check 6 is not about numbers at all, which is why it needed its own line. It is stated as a
procedure rather than a warning because "be careful about layers" is not actionable and this is:
**read one layer further than the one that produced the claim, and name it.** Three separate
findings this week were wrong or nearly wrong in exactly this way, and the shape was identical
each time — a conclusion drawn from the layer I happened to be looking at:

- *"The range selector does nothing"* — read the client, did not read which parameter the server
  reads. Caught by check 4.
- *"Attention is structurally immune, it is id-keyed"* — read the request contract, did not read
  that the handler resolves `agentId → target.surfaceId` and writes keyed by the **surface**.
  **Published, then retracted.**
- *"Triage has no origin gate"* — read the route dispatch and the top of the handler, stopped
  above `triage.ts:485`. Caught before publication by testing it.

Note what the misses have in common: each layer I read was *correctly* read. The error was never
misreading — it was stopping at a layer that could not settle the question, while the question
felt settled. That is why the procedure is "read one further and name it" rather than "read
carefully."

---

## The failure mode this rule exists to catch

**Unchecked relays cluster where a finding feels strongest.**

This is a general property of working through subagents, not an observation about one day. A
worker's most striking sentence is simultaneously the most tempting to publish and the least
likely to be reopened, because it already reads as conclusive. Verification effort naturally
flows to claims that look shaky — which are, by construction, the ones least likely to be
load-bearing.

So the distribution is predictable: unverified claims will be few, and they will be the ones
carrying the argument. Both times this lane published something false, the bad claim was the
single best sentence in its section.

The counter is procedural, not attitudinal: **the check is mandatory at triage, before I know
which claim will end up carrying the argument.** Deciding what to verify after the shape of the
finding is clear is deciding too late — by then the strongest claim has already earned trust it
has not been audited for.

---

## The deeper trap: a re-verification method that cannot fail

Catching a wrong claim is one level. Catching a wrong *method for checking claims* is the level
underneath, and it is easier to miss because the check appears to have been done.

**The instance.** Re-verifying which server fields the client consumes, I ran
`grep -rl <field> src/web/ | wc -l` and read a non-zero count as "consumed". `contextPct`
scored 1 and I nearly marked it verified-as-consumed. Opening the hits showed **both were
inside comments** — prose *about* `contextPct`, in a file that never reads it. File presence is
not consumption. The claim was right and my method for confirming it was wrong, which would
have produced a confident correction in the wrong direction.

**The general form.** A verification step that returns a signal under both hypotheses verifies
nothing. `grep -l` answers "is this string in this file", not "does this code use this value" —
those diverge exactly where a codebase discusses itself, which this one does constantly.

**The guard is check 4:** before running a verification command, say what it returns if the
claim is *false*. If the answer is "the same thing", the command is not a check. Prefer reading
the hits over counting them; prefer the assertion over the comment; prefer the rendered value
over the field's presence.

## Worker brief requirements

Every dispatch must tell the worker: cite `file:line` or the exact command; quote the artifact
rather than describing it; and state what would falsify the finding. And every worker output
gets triaged into the three tiers above before I write a word.

---

## Worked example 1 — the "ended 8"

**What I published** (day review §1): *"A worker's synchronized read caught a worse moment —
8 actionable signals in the payload while the board rendered `All clear` and `Needs you 0`."*
It was the strongest sentence in the review.

**What the record actually held.** The worker's capture was
`{signals: 8, signalVisibility.needs: 0, ended: 8}`. The `ended: 8` was sitting in the same
object as the 8 I quoted. Every one of those signals was on a dead session, so `Needs you 0` was
correct, not a failure.

**The failure.** I copied two fields out of a three-field object and published the two that
supported my thesis. I never opened the capture.

**What the rule would have caught.** Check 1, population: eight signals versus zero needs-you is
only a contradiction if both count live agents. One line of the evidence said they did not.

---

## Worked example 2 — the comment I quoted without opening

**What I published** (correction `4fbbaa0` §3.3): that `tests/archive.test.ts` and the Pilot
design contradict each other, citing a comment calling an archived agent *"exactly the one still
worth acting on."*

**What the file actually says.** That comment argues for carrying `lastAgentClosing` through the
archive round trip so the words stay readable. The two lines immediately beneath it:

```js
expect(archived.attentionSignal).toBeUndefined();
expect(archived.nextAction).toBeUndefined();
```

The test asserts the same position as the design. There was no contradiction.

**The failure.** A worker quoted the comment; I published the contradiction without opening
`tests/archive.test.ts`. Same error as example 1, one document later — and this time inside a
document whose whole purpose was correcting the first one.

**What the rule would have caught.** Check 2, scope of a quote: read the assertions under the
comment. They were four lines away.

---

## The magnitude blind spot: a number everyone verified and nobody checked

Checks 1–4 are about **provenance** — did I open the artifact this rests on. There is a second
way to be wrong that provenance cannot reach.

**The instance.** A program rollup read `1.60B tokens`; a single session read `391.4M`. Six
lanes audited that surface across two days. I measured the number myself, quoted it in a table,
and wrote a finding about the cell it sits in — I flagged that it renders truncated as
`680.4M t…` and never asked whether `680.4M` could be true. It was `sum(sessionTotal)` over
genuinely the program's agents, so it passed every provenance question anyone thought to ask.
It was also ~99% cache re-reads of the same conversation counted once per turn: arithmetically
correct, semantically not tokens consumed. Full working in
`docs/IMPLAUSIBLE-MAGNITUDES-GPT.md`.

**The general form.** A number is checkable by inspection only when the screen carries something
to check it against — a bound, a denominator, or a neighbour it must agree with. `78% peak` is
bounded 0–100. `6 working` cannot exceed the agent count. `Needs you 1` must match the rows
below it. An unbounded aggregate has none of that, so it is read as a *magnitude* — big swarm,
big number — and any value within orders of magnitude passes unchallenged.

**The guard is check 5**, and the reason it must be separate: everyone *did* open this artifact.
Opening the file harder would never have caught it. The question that catches it is arithmetic,
asked once: *what would have to be true for this to be correct?* For 391M against a 1M context
window the only available story is "cumulative across turns, dominated by cache re-reads" —
which is a different quantity from the one the label claims, and noticing that takes one
sentence.

---

## Why this is written down

Both failures were the same mechanism — trusting a characterisation instead of the artifact —
and resolving to be careful did not prevent the second. The rule exists so the check happens at
dispatch and triage time, not when I remember to be careful.

The tell, in both cases: **I could quote the finding but could not have quoted its
surroundings.** If I cannot say what is immediately above and below the line I am citing, I have
not read it.

---

## Check 7 — read one layer OUT

Added after two phantoms that check 6 could not have caught, because both were context *around*
the match rather than *beneath* it.

**Before judging a line, quote what encloses it.** The enclosing `describe`, the function
signature, the fixture that built the value, and the assertion immediately following.

- `snapshot.test.ts:1519` looked like a hollow `?? ""` guard. The **next line** was
  `expect(live.nextAction).toBeUndefined()` — the exact assertion, making the guard redundant
  rather than empty.
- `completions-counter.test.ts` looked like a file of null-assertions. The **enclosing describe**
  was *"the withheld number, asserted where a number would exist"*, and its tests construct the
  precise scenarios that made the old counter return a wrong number.

**A grep result is a coordinate, not a claim.** It cannot distinguish "this file does not test that
behaviour" from "this file tests it in a block I did not open." Check 6 sends you down through the
layers; check 7 sends you out to the twenty lines around the hit. Today's last two errors were both
inside that radius.

## Why the form exists rather than more prose

Every check in this document was already written down before the phantom it would have caught.
Check 1 (population) predates the `nextAction` error by weeks. **I did not fail to know the rule; I
failed to run it.**

A maxim is checked by remembering to check it, which is exactly the step that fails under
momentum — and momentum is highest right after a finding feels strong, which is where unchecked
claims already cluster. **A blank next to a question is checked by looking at the page.** That is
the whole of the change: it moves verification from something I must remember into something I can
see is missing.
