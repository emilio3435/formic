# Back-testing the form against my own phantoms: 6 of 8 caught, 2 missed

You warned that a form catching everything is a form fitted to the data. **It catches six of
eight, and the two misses share one shape — which is the useful result, because it names a line
the form is still missing.**

There were eight phantoms today, not five. Counting them honestly first, since undercounting my
own errors would be the wrong way to grade a tool for catching them.

---

## The back-test

| # | Phantom | Verdict | Which line catches it |
|---|---|---|---|
| 1 | "The range selector does nothing" | **CAUGHT** | **P3** |
| 2 | "Attention is structurally immune, it is id-keyed" | **CAUGHT** | **P3 and P4** |
| 3 | "Triage has no origin gate" | **CAUGHT** | **P4**, backed by **A1** |
| 4 | "Over-long ranges silently return $0.00" | **MISSED** | — |
| 5 | "`endTime` precedes `startTime`" | **MISSED** | — |
| 6 | "`nextAction` is universally absent" | **CAUGHT** | **A1** |
| 7 | "`completions-counter.test.ts` is emptied" | **CAUGHT** | **P5** |
| 8 | J10 — `needsYou` identity fires intermittently | **CAUGHT** | **P4** |

### The four decisive fills

**#1, P3** — *what would this command return if the claim were FALSE?* → *"Identical results."*
The form says **STOP** on that answer. The whole error was a check that returned the same signal
under both hypotheses.

**#6, A1** — *over what population is X defined?* → *live agents.* *Count over THAT population?* →
**3 of 21**, not 0 of 577. The blank cannot be filled without discovering the error; there is
nowhere to write "576 of 576" once the first line forces the word *live*.

**#7, P5** — *what encloses what I read?* → `describe("the withheld number, asserted where a number
would exist")`. Writing that sentence down refutes the finding in the act of recording it.

**#8, P4** — *which layer did I read, and what does the one under it say?* → *read: my own
identity → under: `snapshot.ts:355`.* That line is where `needsYou` is computed from
`attentionSignal`. The blank forces the lookup that shows my predicate was the discarded one.

---

## The two misses, and they are the same shape

**#4** — my script formatted an error body through `j.measuredCostUsd ?? 0` and printed `$0.00`.
**#5** — my script printed `.slice(11,19)` of two timestamps and I compared times of day across
different dates.

Walk the form for either:

- **P1 Population** — fine, no population error.
- **P2 Provenance** — *"what command produced this?"* I write my script's name. **The form is
  satisfied and the lie is intact.**
- **P3 Falsification** — *"what would it return if false?"* A non-zero cost; an `endTime` after
  `startTime`. Both are genuinely different from what I saw. **P3 passes, and confirms the
  phantom.**
- **P4 / P5 / P6 / A1** — all answerable without touching the defect.

**Every line can be filled correctly while the finding is false**, because the error is not in the
reasoning or the population or the layer. **The error is between the data and my eyes.** I did not
misread the system; I read my own rendering of it and treated that as the system.

## The line the form is missing

```
P7  Raw evidence  — paste the RAW response/line the claim    ______________________
                    rests on, unformatted, undefaulted.
                    No ??, no ||, no slice, no rounding.
```

Both misses die immediately: pasting the raw body shows `{"ok":false,"error":{"code":
"INVALID_RANGE"}}` where I had written `$0.00`, and pasting the raw timestamps shows different
dates where I had compared clock times.

**And this is the line that generalises past today.** Every other check asks whether I reasoned
correctly about the evidence. P7 asks whether what I am looking at *is* the evidence. That is a
prior question, and three of my eight phantoms — the `?? 0`, the `slice`, and the guessed field
names that turned out to be `priorSpend` — were all failures of it.

## The honest grade

**6 of 8 before P7; 8 of 8 after — but the second number is worthless as evidence**, because I
derived P7 by looking at the two it missed. That is precisely the fitting-to-data problem you
named, and I am flagging it on my own result rather than reporting the flattering figure.

**The defensible claim is the first one: the form, as it stood when I wrote it, catches six of
eight of the errors it was not designed against.** P7 is a hypothesis for future phantoms, and it
earns credibility only when it catches one I have not seen yet.

**One more honest note on the six:** #2, #3 and #8 are all "read the next layer" failures, and P4
was already written before any of them. So the form's demonstrated value is concentrated in P3, P5
and A1 — three lines, catching four phantoms, all added today after the errors they describe. The
form is doing real work, and less of it than 6/8 suggests.

---

## On the next question, and why I am not starting it

You asked what a fresh reader would still get wrong about this system — a different question from
what is defective in it, and the right one to ask at 62 commits above main with the suite green.

**I have too little budget left to do it properly, and it is exactly the kind of work that goes
wrong when rushed:** it needs reading the docs as a stranger would, not as their author, and my
whole context is the opposite of a fresh reader's. I would produce a list of what *I* think is
confusing, which is worth very little.

**The honest recommendation is a fresh lane with no history in this repository**, given the
README, `ANT-GUIDE.md`, `QUICKSTART.md` and the board, and asked what it believes after twenty
minutes — then checked against what is true. That is a genuine measurement of comprehension rather
than an author's guess at it, and this session's transcript would contaminate it.

If it helps whoever runs it, the three places I would expect a fresh reader to go wrong, offered as
**hypotheses to test rather than findings**: that `invocations` means API calls; that the 30-day
cost view is the whole record; and that a green suite means the assertions in it are
discriminating. All three fooled me today, and I had every advantage.
