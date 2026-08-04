# A fix emptied a whole test file, and the suite reported it as green

You asked which other checks today's fixes quietly emptied. **B8 was not the only casualty, and the
worst one is not mine — it is an entire test file in the suite.**

---

## `tests/completions-counter.test.ts` — every assertion on its subject is now unfalsifiable

`fbdf2c0` made `completionsLastHour` emit `null` when completions cannot be observed. Correct, and
I still think so. Here is what it left behind in the file named for that counter:

```js
:94   expect(pulse.momentum.completionsLastHour).toBeNull();
:95   expect(pulse.momentum.completionsLastHour).not.toBe(1);        // null is not 1 — trivially true
:106  expect(pulse.momentum.completionsLastHour).toBeNull();
:108  expect(pulse.momentum.completionsLastHour ?? 0).toBeLessThan(2); // null ?? 0 = 0 < 2 — always
:116  expect(pulse.momentum.completionsLastHour).toBeNull();
:117  expect(pulse.momentum.completionsLastHour).not.toBe(1);        // trivially true
:127  expect(pulse.momentum.completionsLastHour).toBeNull();
:136  expect(pulse.momentum).toHaveProperty("completionsLastHour");  // passes when null
```

**Not one assertion anywhere in the file expects a non-null completions count.** A file called
`completions-counter.test.ts` never tests a counter that counts.

Lines `:95` and `:117` are the sharpest. `not.toBe(1)` was **the original check** — the guard
against counting a pause as a completion, which is the defect `fbdf2c0` was written to fix. Now
that the value is `null`, `not.toBe(1)` cannot fail. **The assertion that proved the bug was fixed
is the one the fix disabled.**

And `:108` is `?? 0` inside an assertion — the exact pattern that manufactured a phantom finding in
my own harness this morning, living in the suite.

## `tests/broadcast-rotation.test.ts:285` — the same operator

```js
expect(momentum.completionsLastHour ?? 0).toBe(0);
```

`null ?? 0` is `0`. **This line passes unconditionally** and will keep passing if the counter
returns to reporting numbers *and reports them wrongly*, because a real non-zero count would fail
it — which sounds right until you notice the test's stated purpose is asserting the counter
**resets on restart**. It can no longer distinguish "reset correctly" from "not reporting at all."

## The general shape, stated for the suite

**A fix that removes a condition removes every assertion that depended on it, and the suite reports
the result as green rather than as reduced.**

The mechanism has three steps and none of them involve anyone doing anything wrong:

1. A value is found to be dishonest. The honest fix is to stop publishing it — `null` plus a
   provenance field. This project made that call four times today and was right each time.
2. The tests asserting on that value are updated to match. **Also correct** — a test expecting a
   number from a field that now returns `null` must be changed or it fails.
3. The updated tests assert `toBeNull()`, and the original behavioural assertions are left in
   place where they are now vacuous. **The file still runs, still passes, still counts toward
   coverage — and can no longer detect the defect it was written for.**

Step 3 is where it goes wrong, and it is invisible: the diff shows tests being *updated*, the suite
shows tests *passing*, and nothing anywhere shows checks being *retired*.

## What I checked and did not find

Reported so the scope is honest, not to pad the finding:

- **`notReadable`** (J6's vacuous term) is referenced in only **1** test file. One reference is too
  few for the pattern above to have taken hold, and I did not find trivially-true assertions there.
- **`aggregatedInvocations`** — 3 files, all added *with* `71d7cb3`, all asserting non-trivial
  values. New checks, not emptied ones.
- **`priorSpend`** — 6 files, added with `57add8a`, asserting real figures. Same.

So the damage is concentrated where a value was **nulled**, not where fields were **added**. That
is a usefully narrow rule: **audit the tests around every field a fix turns off, and none of the
fields a fix turns on.**

## Recommended, alongside the non-vacuity counter

1. **Ban `??` and `||` defaults inside assertions.** `expect(x ?? 0).toBe(0)` is not a test. This
   is a lint rule, it is mechanical, and it would have caught both files above. It would also have
   caught my own harness this morning.
2. **When a fix nulls a field, the tests on that field need a companion case that still exercises
   the non-null path** — or an explicit `test.todo` recording that the path is currently
   unreachable. Either is honest; silently keeping the vacuous assertions is not.
3. **`completions-counter.test.ts` needs one test where completions ARE observable** and the count
   is a real number, or the file should say plainly that it now tests only the unobservable case.
   Right now its name promises coverage it does not have.

## The inversion worth keeping

You named it and it is the through-line: **a suite should be able to say which of its checks have
ever fired.** Coverage counts lines executed; it should count assertions that have *discriminated*.
By that measure `completions-counter.test.ts` has zero coverage of its subject while reporting
eight passing assertions, and `B1`, `B2`, `I1` and `I3` — the checks that failed today — are the
most valuable things either of us wrote.

## Limits

- **I audited four fields**, chosen because today's fixes nulled or added them. There are roughly
  forty fixes; a full sweep would grep every field any of them touched, which I have not done.
- **I did not run mutation testing**, which is the rigorous version of this: change the production
  value and see which tests notice. Everything above is read from assertion *shape*, not proven by
  breaking the code. The two files named are unambiguous; a wider sweep would need mutation to be
  trustworthy.
