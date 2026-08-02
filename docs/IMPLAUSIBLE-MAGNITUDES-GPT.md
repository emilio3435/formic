# The 1.6B that nobody questioned

Two things in one document, because the second explains the first.

1. My judgement of `5ca05ff`, the frontend lane's response to day-review 4.4 and 4.5.
2. The question the operator actually asked: how did a number that wrong sit on the board all
   day, past six lanes auditing this exact surface — and does the standing verification rule
   need a clause for it?

---

## Part 1 — Judging `5ca05ff`

They did not reject the two claims; they verified both against the live board and fixed them.
Judged on the artifacts, not the commit message:

**4.4 — removing the coverage suffix was the right call, including the part they declined to
do.** The suffix rendered `8/9 reporting` while 32 live agents were reporting `contextPct`.
They removed it rather than recomputing client-side, because a client derivation would have
been a *third* population against a headline that comes from the server's own `liveAgents`
filter. They flagged `contextReporting/contextEligible` for the backend lane instead. That is
the correct shape: delete the wrong signal, name the right fix, hand it to the lane that owns
the data. Faking a plausible third number would have been worse than the bug.

One cost worth stating: the board now has **no** partiality signal on CONTEXT PEAK at all. An
operator cannot tell whether the peak is drawn from 2 agents or 32. That is better than a
confidently wrong ratio, and it is a real gap until the backend ships the pair.

**4.5 — the relabel is correct and does not go far enough, for a reason none of us had.**
`1.59B session tokens` beside `206 agents` is now internally consistent: same population, and
the vocabulary matches the drawer's "used this session". As a fix for *the defect I reported* —
cumulative and latest-turn sharing one word — it is complete.

But the number is still wrong in a way my finding did not reach, and their fix inherits it.

---

## Part 2 — What `sessionTotal` actually measures

`collectors.ts:335-338`:

```js
const cachedInput = Number(usage.cacheRead ?? 0);
const cacheWrite  = Number(usage.cacheWrite ?? 0);
const total = Number(usage.totalTokens ?? input + output + cachedInput + cacheWrite);
sessionTotal += total;
```

Cache reads are the whole conversation, re-read on every turn. Measured on the five largest
sessions on the live board:

| `sessionTotal` | latest turn `total` | `input` | `output` | `cachedInput` | cache share |
|---:|---:|---:|---:|---:|---:|
| 489,945,686 | 271,815 | **2** | 4,571 | 266,216 | **97.9%** |
| 394,199,049 | 942,718 | **2** | 1,153 | 940,601 | **99.8%** |
| 323,905,463 | 869,000 | **2** | 1,147 | 865,694 | **99.6%** |
| 258,390,361 | 755,127 | **2** | 1,057 | 753,225 | **99.7%** |
| 251,539,924 | 871,709 | **2** | 677 | 867,288 | **99.5%** |

Two uncached input tokens. Nine hundred and forty thousand cache reads. Summed every turn.

**The number is arithmetically correct and semantically wrong.** `sessionTotal` is not tokens
consumed — it is tokens *processed, counting each re-read of the same conversation as new*. A
400-turn session at ~900k cache read per turn produces ~360M by construction. The distribution
confirms it: median `sessionTotal` **643,525**, top **489.9M** — **761× the median**, with 7
agents over 100M.

So `391.4M` for one session is not a bug anyone introduced. It is the honest output of summing
a quantity that should never have been summed.

**This is why the relabel is insufficient.** "Session tokens" resolves *scope* and leaves
*meaning*: an operator reads tokens as consumption, and cache reads bill at roughly a tenth of
fresh input. A program headline of `1.59B session tokens` that is ~99% cache re-reads overstates
economic consumption by about an order of magnitude, and overstates *distinct content handled*
by about two.

**Handed to the lane that owns the fix** (I did not touch the code): the honest options are to
sum `input + output` and label it `1.6M tokens`, or keep the full figure and label what it is —
`1.59B processed · 99% cached`. Either beats a number whose unit is undefined.

---

## Part 3 — Why nobody caught it, including me

The operator's question is the sharper one, and the answers are uncomfortable.

**It was displayed in the cell most designed not to be read.** From `programRollupCells`:

> `// key "tokens" lets the header rollup drop this cell first on narrow screens`
> `// (it is the least critical; the alerts cell is never dropped).`

And my own cockpit audit measured it rendering, in the docked layout, as:

> `121 a…  10 wo…  0 al…  680.4M t…`

I flagged that truncation as a *legibility* finding — `0 al…` tells the operator nothing — and
never once asked whether `680.4M` could be true. The number was sitting in my own audit,
ellipsised, and I wrote about the ellipsis.

**Four lanes audited this surface and all of us checked the same axis.** Every review — mine
included — asked *is this number derived from the right population, under the right label, from
the right field?* Provenance. Nobody asked *could this number be true?* Magnitude. The rollup
passed every provenance check it was given, because it is genuinely `sum(sessionTotal)` over
genuinely the program's agents. It was correct by every question we thought to ask.

**And there is a class here.** A number is sanity-checkable when the screen carries something
to check it against:

| Number | Has a referent on screen? | Would a wrong value be noticed? |
|---|---|---|
| `78% peak window` | Yes — bounded 0–100 | Immediately |
| `6 working` | Yes — must be ≤ agent count | Immediately |
| `Needs you 1` | Yes — must match the rows below | Immediately |
| `1.59B session tokens` | **No** | **Never** |

`1.59B` has no denominator, no bound, and no neighbour it must agree with. It is read as a
magnitude — *big swarm, big number* — and any value from 100M to 100B would have passed. That
is the class: **unbounded aggregates with no on-screen referent.** The cockpit has one other
today (`149k tok/min`) and had a third before it was removed (`$X last hour`, which at least
had a unit an operator has intuitions about).

The failure was not inattention. Six of us looked straight at it. It is that **an unbounded
number cannot be checked by looking at it**, and every check we ran was a looking-at-it check.

---

## Part 4 — The rule needs this clause, and it is a different clause

This is genuinely distinct from what `docs/VERIFICATION-RULE-GPT.md` covers today. That rule is
about **provenance** — did I open the artifact this claim rests on. It catches a claim I relayed
without checking.

Every one of us *did* open this artifact. The number was verified-by-me by any standard: I
measured it, quoted it, and put it in a table. Provenance was never the problem. Plausibility
was, and no amount of "open the file" catches a number that is exactly what the file says.

The clause to add:

> **Check 5 — magnitude.** For any number without an on-screen referent — no denominator, no
> bound, no neighbour it must agree with — state what it would take for the value to be
> *correct*, and check that story holds. If a session reports 391M tokens against a 1M context
> window, the only correct story is "cumulative across turns, dominated by cache re-reads" —
> which is a different quantity from the one the label claims. A number that cannot be wrong by
> inspection must be justified by arithmetic instead.
>
> The tell: **if I would have accepted any value within an order of magnitude, I have not
> checked it.** That question is fast, and it is the one that would have caught 1.6B on the
> first read of the first audit.

I will add it to the rule as a separate commit rather than fold it in here, so the rule stays a
short standing document rather than a running log.

---

## Part 5 — Caveats

- **The cache-share table is one read** of five sessions at 12:36. The pattern is consistent
  across all five and the mechanism in `collectors.ts` is unconditional, so I expect it general;
  I have not sampled the whole fleet.
- **I have not verified the billing claim** that cache reads price at ~0.1× fresh input against
  this project's own cost data — `costLastHourUsd` was null on my read (`"No priced invocations
  in this window"`). The ratio is from general pricing knowledge, so treat the "order of
  magnitude on cost" statement as an estimate, not a measurement. The *token* arithmetic above
  is measured.
- **`5ca05ff` is not wrong.** It fixed the defect it was handed, correctly. Part 2 is a defect
  underneath the one I reported, which my finding did not reach and their fix therefore
  inherited.
