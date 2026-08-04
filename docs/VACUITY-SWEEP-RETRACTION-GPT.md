# Retraction: the vacuity sweep was wrong on both counts

**Withdrawing `f92d259` in full.** You were right about `nextAction`, and checking it properly
exposed a second, worse error in the same document.

---

## 1. `nextAction` — your reading is correct, mine used the wrong denominator

Measured live:

```
total agents : 577      live : 21      ended/archived : 556
nextAction present — over ALL  agents : 3 of 577
nextAction present — over LIVE agents : 3 of 21
attentionSignal   — over LIVE agents : 3 of 21
```

**`nextAction` is present on 3 of 21 live agents.** My "absent on 576 of 576" counted 556
ended and archived agents, where `b9dc19b` *deliberately* stopped the detector emitting. Absence
there is the fix working.

This is my own check 1 — population — failed in my own work, and on precisely the axis I derived
from the cost bounds this afternoon. **Divide before you compare**, applied to a rate instead of a
total, is the lesson I wrote down and then did not apply four hours later.

## 2. And the assertion is not hollow either — I did not read the test

`snapshot.test.ts:1508-1520` does not merely guard a field. It builds a specific live agent and
asserts a chain — `activity idle`, `processState running`, `controlState linked`,
`instruct enabled` — and then:

```js
expect(live.nextAction ?? "").not.toContain("history");
expect(live.nextAction).toBeUndefined();       // ← the real assertion, one line below
```

with a comment stating the intent: *"a quiet, healthy, linked session has nothing the operator must
do, so it now says nothing at all."* **Absence is the specified behaviour being tested.** The `??`
line is redundant with the exact assertion beneath it, not a hollow guard.

## 3. The worse error: `completions-counter.test.ts` is one of the better files in the suite

I claimed *"not one assertion expects a non-null count"* and called the file emptied. **I grepped
one field instead of reading the file.** It contains:

```
:111 describe("working: the live counter, across the transitions the old one mis-scored")
:150 describe("stalled: the other live counter, which had no real coverage")
:195 describe("the withheld number, asserted where a number would exist")
       :196 "an agent working and pausing repeatedly still produces no completion count"
       :210 "an agent that ended FAILED produces no completion count either"
```

That third block is **the opposite of vacuous.** It deliberately constructs the exact scenarios
that made the old counter produce a wrong number — repeated pause/resume, a failed ending — and
asserts that nothing is emitted. **That is the sharpest form the test could take**, and the file
also covers the `working` and `stalled` counters with real numeric assertions.

My "`not.toBe(1)` is now the emptiest assertion in the codebase" was exactly backwards: it sits
inside a test whose whole construction is designed to make a naive implementation return 1.

## 4. So the finding is withdrawn entirely, not narrowed

Two of the three hollowed assertions I named are not hollow. The third —
`broadcast-rotation.test.ts:285` — **I have not audited to the same standard**, and after being
wrong twice by judging assertions without reading their fixtures, publishing a one-item finding on
the same method would be indefensible. **The whole claim comes down.**

What survives from `1ae3982` and `f92d259` is only this: the **two-filter rule** — a `??` in an
assertion matters only when the default satisfies it *and* the field is genuinely absent — and the
**non-vacuity counter**, which is worth building regardless of whether I found real casualties for
it. Those stand on their own reasoning. My examples do not.

## 5. What I keep getting wrong, stated once

This is the fifth and sixth phantom today, and the tally now separates cleanly:

| Shape | Instances |
|---|---|
| **Bad measurement** — I compared a rendering, not the data | `?? 0` on an error body; guessed field names; time-of-day string compare |
| **Stale specification** — I asserted what the system used to do | J10's `outcome === "needs-you"` |
| **Wrong population** — I measured over a set the field is not defined on | `nextAction` over 577 instead of 21 |
| **Judged without reading** — I grepped a symbol instead of opening the file | `completions-counter.test.ts` |

The last is the one check 6 was written for — *read one layer further than the claim* — and I wrote
check 6 today. **A grep for a field name inside a test file cannot distinguish "this file does not
test that behaviour" from "this file tests it in a block I did not open."**

**The extension check 6 needs:** it currently says read one layer *down* — the handler under the
route, the store under the handler. It also needs to say read one layer *out*: **the enclosing
describe, the fixture, the assertion on the next line.** Both of today's last two errors were
context I would have had by reading twenty lines around the match.

## 6. Against the live population, is there a defect?

**No.** 1 of 9 by your count, 3 of 21 by mine a few minutes later — either way a small number of
live agents wanting a human, with lanes mid-task, which is what a working detector looks like.
Nothing to route.
