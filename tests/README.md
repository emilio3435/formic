# What this suite knows that reading it will not tell you

Written 2026-08-02 by the test lane, after sweeping every file in here. It records the things that
live in a person's head rather than in the code: which guards were bought with a real failure, which
assertions are load-bearing versus decorative, and what to distrust when something starts failing for
no visible reason.

Read this before deleting a test that looks redundant. Several of them look redundant.

---

## 1. Guards that exist because a defect reached the board

These are not hypothetical. Each one is the scar of something that shipped, and the comment at the
top of each file carries the detail.

| File | What got through |
|---|---|
| `control-advertisement-invariant`, `write-gate-dead-unarchived`, `write-gate-liveness` | A **live Send button on a row the same snapshot rendered as died**. `controlsFor` advertised `instruct` as enabled while `executeControl` refused it with 409. Both sides were individually correct and individually tested. |
| `burn-rate-denominator` | The **tok/min rate read half its true value** when one of the two recent buckets was unmeasured. An absent measurement counted as a zero. |
| `policy-verifiability` | **Archive retention measured from the agent's last activity, not from archiving.** An agent quiet 29 days and archived today was gone within one. Published 30 days, delivered 1. |
| `cumulative-session-rows` | BurnBar records a session's **running total** and re-records it. Summing the rows **double-counted 637M tokens and ~$1,462**. |
| `physical-bounds` | Sessions spanning **2.97 days billed to a single calendar day**. Nine such rows carried 92% of all cost in range. |
| `snooze-bounds` | A snooze with **no upper bound** — accepted, stored, and silently suppressing an agent for the life of the board. |
| `completions-counter` | `N done this hour` counted `working → idle` transitions. True value could be 0 while it rendered 17. |
| `published-fields-can-vary` | A fix hardcoded `completionsLastHour` to null and **every assertion in its test file became unfalsifiable in one commit**, while the suite reported green. |

Three files guard things that had **not** yet failed, which is the exception rather than the rule:
`triage-retention-clock` (the archive defect, caught before it happened), `recently-resolved-ttl`, and
`capped-queries-are-not-totals`.

**The single most important thing here:** the button/endpoint divergence was found, written up as
*deliberate design*, and left. It reached the field. A divergence between two sides is not a property
of either side, so no assertion about either one can see it. That is why
`control-advertisement-invariant` derives both sides from **one** `CollectedAgent` rather than
asserting them side by side.

---

## 2. Assertions that are hollow-prone, and why

Every one of these was found in a test written by someone competent, usually by the person who
then found it.

**Passes on an empty population.** `toBeNull`, `toBe(0)`, `toEqual([])`, `toHaveLength(0)`,
`toBeUndefined`, `not.toContain`. All of these hold on a fleet with nothing in it. If a test asserts
only these, ask what population it ran against — `[].every(anything)` is `true`.

**`not.toBe(X)`.** True for every value except X. When `completionsLastHour` became null,
`not.toBe(1)` — the assertion that had originally *caught* the bug — became the one proving nothing.

**Assertions on single-member unions.** `completionsProvenance` admits exactly one value, so tsc
already proves it and the runtime check is ceremony. There is one other in `shared/types.ts`
(`ControlDebris.kind`). Asserting these is not wrong, it just is not a test.

**`(x ?? 0)` under a loose bound.** `expect(x ?? 0).toBeLessThan(2)` is `0 < 2` forever once `x` is
null.

**A fresh store, or a fresh fixture, on each side of a comparison.** Two real examples:
- An attention-retention check filtered through a store that had **never acknowledged anything**. It
  returns the notification whatever retention does.
- A set-once check that opened **two fresh files at the same instant**. Both stamps matched no matter
  what the code did; the re-stamping mutation survived it.

**Global non-vacuity where per-case is needed.** Asserting "these four windows collectively differ"
passes while one of them contributes a vacuous `0 === 0`. Asserting "some widget was populated"
passes while one specific widget silently reports missing forever. **Count the cases that were
genuinely exercised, not the total.**

**A cross-check between two sides derived from one source.** This bit three times in one day:
- Deleting the `attestation !== "remembered"` rule changes **both** sides of the button/endpoint
  invariant, so they still agree and it stays green.
- Dropping a field entirely keeps the client/server contract satisfied — server omits, widget says
  missing, they agree.
- A `LIMIT` on the summary query would keep every window identity holding, because both sides shrink
  together.

Once two sides share a predicate, the cross-check can no longer see a *wrong* predicate — only a
*divergent* one. Each of those needed a separate companion assertion, and they are marked as such in
the files.

---

## 3. The two methods, and what each is for

**Mutation testing** asks: *can this assertion fail?* Break the implementation deliberately, confirm
a test goes red. A survivor is a coverage gap, an equivalent mutant, or a hollow assertion — and
those three are different, so check which before reporting.

**Vacuity / constant-collapse** (`scripts/constant-collapse.sh`) asks a different question: *given
what the product now emits, can it still fail?* These come apart when a fix collapses a field to a
constant. The assertion remains logically capable of failing; there is simply no longer any input
that makes it. Ordinary mutation testing is structurally blind to this.

`published-fields-can-vary.test.ts` is the automatic, cheap version that fires on the day of a
collapse. The script is the exhaustive, manual version. They are complements.

**The trap that cost a false finding, twice:** a collapse must move the value to something the field
**cannot currently hold**. Replacing `STALL_THRESHOLD_MS` with `900_000` is a no-op, because that
*is* its value — it reported SURVIVED against four perfectly good assertions. Similarly, a value that
looks constant across a sample may simply have had one input the whole time.

**A result worth knowing:** across roughly 160 logic mutants, the pre-existing suite produced **zero
hollow assertions**. It was thin in places, never decorative. Every hollow assertion found all day
was in a test written that same day, usually within the hour.

---

## 4. What to distrust first when something fails mysteriously

Roughly in order.

1. **Anything reading live data** — `physical-bounds`, `published-identities`,
   `capped-queries-are-not-totals`, and the BurnBar tests. They read the real
   `~/Library/Application Support/OpenBurnBar/openburnbar.sqlite` and the real archive. Their results
   move when the fleet moves. `published-identities` legitimately changed its answer **three times in
   one afternoon** as fixes landed.
2. **A `test.failing` that suddenly hard-fails.** `"marked as failing but it passed"` means someone
   fixed the defect. That is success. Remove the marker; do not weaken the test.
3. **The clock.** Several files pin retention and TTL boundaries. Fixtures use a frozen `T0`; if one
   starts failing near a boundary, check whether a constant moved rather than the logic.
   `MAX_RANGE_MS` went from 90 days to 400 days in one commit and changed what the API accepted.
4. **Concurrency in this checkout.** Five lanes share one tree. A suite that is red for one run and
   green the next is usually another lane mid-edit, not flakiness. I once measured a *stable*
   2-failure baseline across two consecutive runs that was purely another lane's broken intermediate
   state. Before debugging, run it twice more.
5. **`web-client.test.ts` and `clean-board.test.ts`.** Between them they hand-write **fourteen**
   `HubSnapshot` literals — shapes the server may never emit. They pass by testing the client against
   objects nothing produces. `client-consumes-server-snapshot.test.ts` exists to catch the drift, but
   the fixtures themselves have not been reconciled.
6. **Any fixture I wrote.** Writing `published-fields-can-vary` exposed **four** weaknesses in my own
   fixtures — `needsYou` stayed 0 because I set `status` without `attentionSignal`; `stalled` stayed 0
   because my "quiet" agents were dead rather than live and so left the population it counts; nothing
   produced an ended agent, so `totals.ended` and `totals.history` never moved. Each first presented
   as a collapsed product field.

---

## 5. Known limits, stated so nobody rediscovers them the hard way

- **`published-fields-can-vary` is fitted to one example.** B8 and the completions counter were
  believed to be two independent cases; `docs/VACUITY-AUDIT-GPT.md` shows they are the **same**
  collapse of the same field from the same commit. Replayed against the six known-vacuous checks it
  fires on **one**, and that one is the one it was designed from. It catches *a published scalar that
  stops varying* and nothing else.
- **The uncovered class is relationships, not fields.** `J5` (`tokenReporting ≤ tokenEligible`,
  observed at `5 vs 5`) and `J10` (`needsYou`, observed at `0 == 0`) are vacuous while **both** their
  fields vary healthily. Nothing here detects that. An assertion `a ≤ b` needs evidence that `a > b`
  was ever *possible* in the data it ran against — not merely that `a` and `b` each moved. That
  instrument does not exist yet and would be the highest-value thing to build next.
- **`published-fields-can-vary` can hide a defect it should catch.** Its fixtures manufacture
  variation production lacks. `needsYou` varies in its ten states and was vacuous live, so the file
  reports that field healthy while it is not.
- **The register in that file is only as good as the person adding to it.** Adding an entry is meant
  to be slightly annoying; the friction is the feature. An entry with no pointer to what still covers
  the field is a field nothing tests, with a paper trail that looks like diligence.
- **`RECENTLY_RESOLVED_TTL_MS` is not exported**, so `recently-resolved-ttl.test.ts` hardcodes 15
  minutes. Changing the constant does not fail that file unless the change crosses a minute either
  side.
- **The 400-day range guard lives at the HTTP boundary, not in `getUsageSummary`.** Every test in
  here calls the functions directly, so none of them exercises it. Only
  `capped-queries-are-not-totals` goes through `handleUsageRequest`.
- **Two open defects are pinned as `test.failing`** and will announce themselves when fixed: the
  session-span breach in `physical-bounds`, and identity I3 (the provider breakdown is $1.17 short of
  its own scalar at 30d, exact at every narrower window) in `published-identities`.

---

## 6. The house rules these files follow

- **Assert from both sides.** A test that only checks the refusal passes on a build that refuses
  everything. Every gate here has a control proving the permitted case still works.
- **Assert at the boundary, not near it.** A snooze test using "six days" passes whichever way the
  comparison points. Use exactly the window, and one millisecond past it.
- **`test.failing` documents a live defect** while keeping the shared suite green for four other
  lanes. It hard-fails the moment the behaviour is fixed, which is how the fix gets noticed.
- **Never weaken a test to make it pass.** If a test is load-bearing but ugly, leave it and say so.
- **Do not guess at a design decision.** Asserting that focus must be refused on an unproven target
  once contradicted a reasoned decision and would have removed the operator's only recovery path. A
  test that guesses at intent is worse than no test, for the same reason as one that cannot fail.
