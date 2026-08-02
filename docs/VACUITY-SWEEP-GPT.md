# The production-vacuity sweep — 3 hollowed assertions, from 2 fields, not 25

**First, plainly: I did not run the mutation sweep.** Your framing made clear they are different
questions, and with the budget I had I ran mine — *can this assertion still fail given what the
product now emits* — not the tests lane's — *can it fail in principle*. The two are complementary
and neither substitutes; I say which I ran so nobody reads this as the other.

**Result: far smaller than my last document implied.** 25 guarded assertions exist; **3 are
actually hollow**, from **2 fields**. Calibrating down, because overstating this would repeat the
morning's failure in a document about not repeating it.

---

## The two filters, both required

A `??` inside an assertion is only a problem when **both** hold:

1. **The default satisfies the assertion.** `expect(x ?? 0).toBe(0)` is hollow if `x` is absent;
   `expect(x ?? 0).toBeGreaterThan(100)` is **safe** — the default *fails*, so the guard behaves as
   a failure rather than a pass.
2. **The field is actually absent in production.** A guard that never fires is testing the real
   value.

Applying filter 1 to the 25: **8 have satisfying defaults**, 17 have defaults that fail their own
assertion and are safe by construction.

Applying filter 2 to those 8, live:

```
pulse.momentum.completionsLastHour  NULL           ← fires
agent.nextAction                    ABSENT on 576 of 576 agents  ← fires
snapshot.issues                     array(1)       ← never fires
totals.systemFindings               number         ← never fires
totals.sourceHealth                 object         ← never fires
```

**Three of the eight survive both filters.**

## The hollowed assertions, per field and per fix

### `completionsLastHour` → null · caused by `fbdf2c0`

| Assertion | Why hollow |
|---|---|
| `completions-counter.test.ts:108` `expect(x ?? 0).toBeLessThan(2)` | `0 < 2` always |
| `completions-counter.test.ts:95, :117` `expect(x).not.toBe(1)` | `null !== 1` always |
| `broadcast-rotation.test.ts:285` `expect(x ?? 0).toBe(0)` | `0 === 0` always |

Causal claim, stated as you asked — **`fbdf2c0` hollowed four assertions across two files.** It is
still the right fix. `:95` and `:117` remain the sharpest instance in the codebase: they were the
*original* guard against counting pauses as completions, and the fix for that defect is what
silenced its own regression test.

### `agent.nextAction` → absent on every agent

`snapshot.test.ts:1519` — `expect(live.nextAction ?? "").not.toContain("history")`. The empty
string contains nothing, and the field is absent on **576 of 576** agents, so this cannot fail.

**I have not established which change made `nextAction` universally absent**, and I am not going to
attribute it to one of today's forty on the strength of a guess. It may predate today entirely.
That is the honest limit of the causal claim here, and it is exactly the sort of gap the per-fix
framing is meant to expose rather than paper over.

### The five that looked bad and are not

`silent-failure-rendering:144`, `overhaul-guards:80/175`, `snapshot:663/786` all guard
`snapshot.issues`, which is **present as an array in production**. The `??` never fires; those
assertions test the real value. **Fragile — a future change making `issues` optional would silently
hollow all five at once — but not currently hollow.**

That distinction is the whole value of filter 2, and it is why the raw grep count of 25 would have
been a bad finding.

## What this says about the method

**Mutation and production-vacuity disagree in both directions**, which is the argument for running
both:

- `expect(x).toBeNull()` **survives mutation** — break the code so it returns `5` and the test goes
  red — while being **useless in production**, where the value is always null. Mutation calls it
  healthy.
- `expect(snapshot.issues ?? []).toEqual([])` would look **suspicious to my sweep's grep** and is
  perfectly discriminating today. Only checking the live value settles it.

**Neither lens alone is sufficient, and a suite reporting only "green" reports neither.** The
non-vacuity counter already routed is the missing instrument: it distinguishes *passed
meaningfully* from *passed vacuously*, which is precisely the axis mutation cannot see.

## Recommended, refined from my last note

1. **Ban only the dangerous form.** `expect(x ?? d)` where `d` **satisfies** the assertion. The
   17 safe instances should stay — a default that fails is a legitimate way to write "absent is not
   acceptable here." A blanket ban would delete good tests, which is what my previous document
   implied and I am correcting.
2. **Fix the three named assertions**, and give `completions-counter.test.ts` one case where
   completions are observable.
3. **`snapshot.issues` guards are a watch item, not a defect.** Worth a comment noting the
   assertion depends on the field remaining non-optional.

## Limits

- **I ran filter 1 by hand over 25 matches** and filter 2 against a single live snapshot. A field
  present now could be absent under other fleet states, which would hollow more assertions
  situationally — the same rare-precondition problem, one level up.
- **The sweep only catches the `??`/`||` signature.** Assertions hollowed without a default —
  `not.toBe(1)` against a null, which I found by reading — are invisible to this grep. I found
  those two by hand and there may be more.
- **Only 2 of the 40 fixes are implicated**, and one of those attributions is unproven. That is a
  much weaker causal result than "forty fixes, many casualties," and it is what the evidence
  supports.
