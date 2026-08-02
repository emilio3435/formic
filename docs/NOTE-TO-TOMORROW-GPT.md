# Note to the lane that starts this job tomorrow

You are me, one day earlier in the work. The checks are committed and I am not going to repeat
them. This is the part that is not in them: the judgement calls, and where mine went wrong.

**The headline: I produced eight false findings today. That is the number to beat, not the finding
count.** A lane that reports twelve findings of which three are wrong is worth less than one that
reports six that are all right, because every false one costs someone a dispatch, and two of mine
reached the operator before being pulled.

---

## When to stop looking

**Stop when your candidates start coming from memory instead of from the system.**

By late afternoon I was generating "what would a reader get wrong" by recalling what had surprised
*me*. Six candidates, two hits. The four misses were things the docs lane had written up — often
within the hour, from my own findings. I was testing the guide against the work that produced it
and calling the result an audit.

**The tell is that your candidates stop being surprising to you.** When you already know the answer
before you check, you are not auditing, you are reciting. Stop and say so. I stopped twice, both
times on my own initiative, and both were the right call — a null delivered early is worth more
than a ninth phantom delivered late.

## How to tell an exhausted method from a clean system

**This is the hardest call of the day and I got it right once by accident. The discriminator is
not the hit rate — it is the *shape of the candidates.***

- **Exhausted method:** candidates get vaguer, they cluster on things you personally found
  confusing, and the nulls come with "well, it's sort of covered."
- **Clean system:** the method still produces **sharp, specific, well-formed** candidates — and
  they turn out to be handled.

When I switched from recall to driving the product, the very first pass produced `Idle 12 · 6h` /
`History 198 · 6h` — a notation I genuinely could not read off the screen, on two tabs, with a
369-agent narrowing behind it. **A better candidate than any of my six recalled ones.** And
`ANT-GUIDE.md:239` covered it, twice.

**That is a clean system, and the method was fine.** If I had judged by hit rate alone (0 for 1) I
would have discarded a working method. **Judge the candidate, not the outcome.**

## What a finding that feels strong should make you do first

**Attack it. Immediately. Before writing a word of it up.**

Every false thing I published today was the best sentence in its section. That is not coincidence —
verification effort naturally drifts toward claims that look shaky, which are by construction the
ones least likely to be carrying the argument. So the strongest claim reaches publication with the
least scrutiny.

**Concretely: when a finding feels strong, run P4 first — read the layer beneath the one that
produced it.** Three of my eight phantoms died there and would have died before publication.
*"Attention is structurally immune, it is id-keyed"* felt airtight; the handler one level down
resolved `agentId → target.surfaceId` and wrote keyed by the surface. I had read the request
contract and stopped.

**And when it is an absence claim — "X is missing", "X is zero", "X never happens" — stop
completely and run A1.** Four of eight were absence or population errors. *Not finding a thing* and
*the thing not existing* produce identical evidence, every time.

## How to report a null so it is believed

**Show the candidate, then show exactly where it died.**

"I looked and found nothing" is indistinguishable from "I did not look." What makes a null credible
is evidence of the search:

> *Drove the board. Took `History 198 · 6h` — no title, no aria-label, needed `app.js:3114` to
> interpret, 369-agent narrowing behind it. `ANT-GUIDE.md:239` documents the lookback, and
> `QUICKSTART.md:76` lists the values. Null.*

That is believable because it is falsifiable — anyone can check line 239.

**Three more things that make nulls land:**

1. **Count your own errors honestly and generously.** I reported eight phantoms when five had been
   named. Grading the form as 6-of-8 rather than 8-of-8, and saying P7 was retrofitted from the
   cases it catches, is what made the two corrections in the `TODAY.md` audit credible.
2. **Report the null and the correction in the same document.** Four of six claims verified with
   nothing to change is what earns the right to say the other two are wrong.
3. **Never manufacture a ninth finding.** You will be asked to keep going. Say the method is
   exhausted and let the operator move you. Every time I did that today it was received better than
   a finding would have been.

## Two things about this system, so you do not lose the hours I did

- **`invocations` is not a count of API calls.** Some rows are whole-session cumulative totals, so
  a per-invocation average averages two units. That is what made an ordinary heavy day look like a
  286× violation of physics.
- **The cost total is a floor, not a total.** Unpriced invocations are counted in tokens and
  contribute nothing to cost, concentrated in one provider.

Both fooled me with the payload, the source, and the row-level data in front of me.

---

## The one thing I would most want you to believe

**Writing a rule down does not install it.** I derived *"divide before you compare"* at 15:21 and
measured a rate over the wrong denominator at 17:25 — same day, same lane, rule already committed.
Check 1 predates that error by weeks.

That is why the checks became a form with blanks rather than a list of principles. **You will not
remember to apply them at the moment it matters, because that moment is when a finding feels
strongest and momentum is highest.** Fill the form. The blank is the only part that works when you
are certain.

And the last thing, which is not a technique: **two of the eight got past me and were caught by
someone reading behind me.** Run every check, and still expect to be wrong in a way you cannot see
from inside. The counterweight needs a counterweight.
