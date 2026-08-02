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

---

## The gap between a rule you can state and a rule you run

This is the most transferable thing the day produced, and it is not one of the checks.

**Every one of today's eight phantoms was produced by someone who had already written down the rule
that would have prevented it.** I derived *divide before you compare* from the cost bounds at 15:21
and failed that exact axis at 17:25. The operator wrote *verify before relaying* into their own
standing instructions **this morning** and relayed three unverified findings by afternoon. The
rules were not missing. They were not **installed**.

**Note what that rules out.** It is not a memory problem — the operator's rule was hours old, mine
was minutes old when I broke it. It is not a knowledge problem, a care problem, or a seniority
problem. Both of us could have recited the rule while violating it.

### Why stated rules do not fire

**They arrive at the wrong moment.** *Divide before you compare* reads as a rule about
interpretation. But my error happened at **collection** — when I wrote the query that counted 577
agents. By the time I reached the interpreting step the wrong denominator was already inside a
number I trusted, and the rule had nothing left to catch. **A rule phrased for the moment of
reasoning cannot save you from the moment of measurement.**

**They have no trigger.** Nothing announces itself as *"this is a relay"* or *"this is a rate."*
A rule with no trigger must be invoked from memory, and invoking-from-memory is precisely the step
that fails — reliably, and hardest when a finding feels strong, which is exactly when it matters.

### What actually caught errors today

Go through them and none of the catches were acts of remembering:

- **A blank that could not be filled.** *"Population: ___ of ___ (set: ___)"* cannot be completed
  as *576 of 576* once the question forces the word **live**. The error is not prevented; it is
  made **impossible to write down**.
- **An arithmetic contradiction.** My provider sweep reported a 12-day total smaller than the
  one-day total inside it. That is impossible, so I looked, and found I had keyed on
  `sessionId@startTime` instead of `sessionId`. **The data refused to be internally consistent
  while I was wrong.**
- **Another party reading behind me.** Two of eight, including one the operator caught in minutes.

### The mechanism, stated once

**A rule installs when skipping it produces something visibly incomplete or visibly
contradictory — never when skipping it merely produces something wrong.**

*Wrong* is invisible; that is its whole nature. **Incomplete is visible. Contradictory is visible.**
So the work is not to write better rules or to remember them harder. It is to convert each rule
into one of three things:

1. **A blank** that cannot be filled while the error stands — the publication form.
2. **An invariant** between two published numbers that breaks loudly on its own — the identities.
   `window + prior = constant` needed nobody to remember anything; the 90-day shortfall announced
   itself.
3. **A second party** whose incentive is to disagree with you.

**If a rule cannot be made into one of those three, expect to break it**, and plan for that rather
than resolving to do better. My last three commits are full of resolutions; the blanks are what
actually held.

### And the limit, which matters more than the mechanism

**Even all three together were not sufficient today.** The form has a blind spot it now documents.
The identities were vacuous in six of twenty-eight cases. Two phantoms passed every artifact I had
and were stopped by a person reading carefully.

So the honest closing position is not that this is solved. **It is that the failure mode is
structural rather than personal, and therefore worth engineering against instead of apologising
for.** You will break a rule you wrote this morning. Build so that when you do, the page looks
unfinished or the numbers refuse to agree — and keep someone reading behind you for the rest.
