# OPEN PROBLEM: docs and tests are entangled, and ownership does not fix it

*This file previously proposed a claim-based ownership boundary. **That proposal
is withdrawn.** It was scored against every collision that actually happened and
changed none of them. A boundary that does not change what anyone would have
done is worse than no boundary, because it leaves the impression the problem is
handled.*

*Status: **unresolved and structural.** Nobody owns a fix. Read this before
proposing another convention.*

---

## The problem, stated once

`tests/reference-docs.test.ts` (317 assertions) and `tests/ant-guide.test.ts`
read eight reader-facing documents at runtime. So a doc sentence and a test
assertion are frequently **the same claim written twice, in two files, either of
which can be edited alone.**

That is a synchronisation problem, and it has the shape all such problems have:
it is invisible while both copies agree, and the moment they disagree, the
cheapest repair is to change whichever copy the person touching it already owns.

**The coupling is not a defect.** It is the pinning working as designed, and it
caught a real omission this evening — an undocumented file in `scripts/`. The
defect is that nothing constrains the *repair*.

## Why ownership does not fix it — measured, not argued

The withdrawn proposal assigned each claim to one lane and required prose and
pin to move together. Scored against today:

| Collision | Would the rule have changed it? |
|---|---|
| Pin caught the undocumented `scripts/` file | No |
| `858a993` flipped a `test.failing` | No — the pin named its own retirement |
| `1617382` rewrote 23 lines of a pin file | No — mechanism, not claim; 316 → 317 assertions |

**Zero of three.** And it had three defects of its own: no enforcement, no
reduction in coupling, and a tiebreak that sends a claim which is *both* a suite
invariant and a reader promise to the lane **less able to detect its
falsification**.

A rule that renames the problem is worse than the problem, because the problem
at least announces itself.

## What it would actually take

Four options. Three are real; the fourth is what we have.

**A — One representation.** Generate the test from the doc, or the doc from the
test. Eliminates the synchronisation problem outright by deleting one copy.
*Cost:* tooling, plus prose that reads like generated prose — and the guide's
value is that it does not. Probably wrong for reader docs; plausible for
reference tables.

**B — Colocation.** The claim and its pin in one file, literate-test style.
Divergence becomes impossible because there is one artifact.
*Cost:* reader-facing documents become executable source. The guide stops being
something you can hand to a person.

**C — Make divergence mechanically detectable.** Keep both copies; add a check
that fails when assertion *strength* drops without a paired doc change —
matcher-shape and count per block, snapshotted. This is the only option that
addresses the actual failure mode, which is a weakened assertion rather than a
deleted one: `toBe` → `toBeTruthy` is invisible to every count we currently run.
*Cost:* one more instrument to maintain, and instruments are where three of
today's failures came from — see check 6 in
[`RUNNING-THE-FLEET.md`](./RUNNING-THE-FLEET.md). It would need its own mutation
proof before anyone trusted it.

**D — Reduce the surface.** Pin fewer claims. The coupling scales with the
number of pinned sentences, and 317 assertions against eight documents is a lot
of rope. Some of those pins protect claims that would be obvious if wrong.
*Cost:* the pins that would be dropped are exactly the ones nobody can prove are
unnecessary until one of them catches something.

**My honest read:** **C is the only one that pays for itself**, and it is worth
building only if someone first measures how often assertion strength actually
drops in this repo. If the answer is "never", C is an instrument guarding
nothing and D is the better move. **That measurement does not exist and should
come before any more design.**

## What to do until then

Nothing structural. The current arrangement works because the people editing
both copies are careful — `1617382` rewrote a pin file and strengthened it, and
nothing except care made that happen.

**Say that plainly rather than papering it:** this is held together by attention,
not by design. That is a fine state for a system to be in as long as it is
*known* to be in it, and a bad one to discover later while assuming a convention
was doing the work.

---

*Superseded content: the withdrawn proposal, its ten-second ownership test, and
the routing note to the tests lane at
[`ROUTED-TO-TESTS-LANE-CLAIM-BOUNDARY.md`](./ROUTED-TO-TESTS-LANE-CLAIM-BOUNDARY.md).
The correction it carried to `9c61193` still stands and is the one thing worth
keeping: **the three bounds tests read no documents at all** — two have zero read
calls, the third reads `config/models.json` — so the GPT lane's findings are not
load-bearing test fixture, and its prose needs no test-review gate.*
