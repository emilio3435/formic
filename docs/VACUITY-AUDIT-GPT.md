# Which of my own checks have never met a non-trivial case

Auditing the 18 identities and 10 bounds I handed over, using the lens J10 taught. **Six of
twenty-eight are vacuous or unevaluable.** One of them was made vacuous by a fix I praised this
afternoon, and that turns out to be a general hazard nobody has named.

---

## The six

| Check | State | Evidence |
|---|---|---|
| **B5** components sum to total | **unevaluable** | the payload exposes **no component fields at all** — no input, output, cacheRead or cacheCreation |
| **B8** completions ≤ observed population | **vacuous** | `completionsLastHour: null`, `provenance: "not-observable"` |
| **B9** invocations per hour | **never evaluated** | I marked it soft and never ran it |
| **J5** `tokenReporting ≤ tokenEligible` | **vacuous** | `5 vs 5` — the strict case has never occurred |
| **J6** `readable + notReadable + ended == agents` | **partly vacuous** | `notReadable = 0`; that term is never exercised |
| **J10** `needsYou` identity | **vacuous** | `0 == 0`, established in `117c766` |

**The other twenty-two are live**, and I checked rather than assumed: B4 at `peak 69 / median 4`,
B7 with `342 of 573` agents carrying a non-zero `activeMs`, B10 at `1,028,927` tokens/hour, J9 at
`stalled 11`, I5 at `41 of 3,008`, I6 at `1,083 of 3,008`. B1, B2, B3, B6 and I1–I3 are the
strongest of all — they have not merely been exercised, they have **failed**, which is the only
unambiguous proof an assertion works.

## The hazard: an honest null retires the assertion that watched it

**B8 is vacuous because of `fbdf2c0`** — the pulse fix I called *"better than what I asked for"*
this afternoon, and I stand by that. It stopped publishing a completions count it could not
observe, emitting `null` with `completionsProvenance: "not-observable"` instead. Correct for the
operator: a wrong number was replaced by an honest absence.

**And it silently retired the bound.** `completionsLastHour ≤ agentsObserved` cannot fail against
`null`. The check reports green forever, and nothing anywhere records that its subject no longer
exists.

This generalises, and it is the more valuable half of this document. **This codebase has converged
all day on "emit the gap beside the value, or emit nothing when unknown"** — `tokensMissing`,
`costKnown`, `costProvenance`, `completionsProvenance`. Every one of those is the right call. **And
every one of them potentially retires whatever assertion watched the field it nulls.**

So the two disciplines this project adopted today are in direct tension:

- *Never publish a number you cannot stand behind* → nulls proliferate
- *Assert identities and bounds over published numbers* → assertions over nulls go quiet

Neither is wrong. What is missing is the bridge: **when a value becomes null, its assertion must
become "untested", not "passing."**

## B5 is worse than vacuous — it is unevaluable by construction

The summary payload carries no `input`, `output`, `cacheRead` or `cacheCreation` fields. I noted in
`3d2af4c` that the query **zeroes the components for every measured row**, using them only for
fallback pricing, and that this makes the cache share unauditable. I then wrote B5 —
*components must sum to the total* — **against fields that do not reach the API.**

That is the same shape as J10 in a different direction: J10 asserted a rule the product had
abandoned; B5 asserts over data the product does not expose. **Both are specification errors in my
deliverable, not defects in the product**, and neither would ever have gone red.

## What the tests lane should do with this

1. **Every check reports a non-vacuity count, not just pass/fail.** `"B8: 30 evaluations, 0
   non-vacuous"` is the output that would have caught all six of these on day one. A check with
   zero non-vacuous evaluations must surface as **untested**, and untested must be visually
   distinct from green.
2. **Do not implement B5 or B9 as written.** B5 needs the component fields exposed first — which is
   a product decision, and worth making, since the cache-share question it would answer is the one
   the 1.6B defect turned on. B9 I could not make useful and would drop rather than ship as a
   permanently-green line.
3. **Rewrite B8 against what now exists.** The bound should assert the *provenance* contract rather
   than the value: when `completionsLastHour` is null, `completionsProvenance` must say why; when
   it is non-null, the old bound applies. That keeps the assertion alive across the honest-null
   fix instead of being silenced by it.
4. **J5 and J6 stay, flagged.** Both are correct and both are currently trivial. `tokenReporting <
   tokenEligible` and `notReadable > 0` are real states this fleet reaches — I measured
   `notReadable` at 74% earlier in the week — so they will become informative on their own. They
   just must not be counted as passing evidence until they do.

## The rule this earns

**A green assertion over an empty population is the same lie as a total over a truncated window.**
Both report a confident result computed over nothing, and both are indistinguishable from the real
thing in every output they produce.

Today's work found the second kind repeatedly — the 30-day window showing a third of the record,
the partial bucket drawn at full height, `priorSpend` undeduplicated. **The first kind was hiding
in my own deliverables the whole time**, and I only found it because J10 embarrassed me into
looking.

## Limits

- **Single-moment vacuity check.** A check that is vacuous now may be exercised later; `J5` and
  `J6` are exactly that. This audit says *"never exercised in the states I have observed"*, which
  is weaker than *"can never be exercised"* — and only B5 and B9 earn the stronger claim.
- **I did not re-derive the 22 live checks**, only confirmed each meets a non-trivial case.
- **The client-side identity from `117c766`** — the three-way `needsYou` agreement — remains
  unevaluated on the tab count, and is vacuous on the two server terms while the board is calm.
