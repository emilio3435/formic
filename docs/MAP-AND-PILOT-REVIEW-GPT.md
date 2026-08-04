# Where the map drifted, and whether the Pilot plan still fits

Two questions, answered against the running system at 21:33.

**Context that colours both:** the last commit landed at **18:38**. Nothing has moved in three
hours, and the board shows **6 live agents of 612 tracked, 0 carrying an attention signal.** Some
of what follows would read as drift on a busy fleet and is simply a quiet one. I have separated
those.

---

# Part 1 — The ownership map

## The reassignment you already made is real, and the surface went quiet with it

`src/web` moved to the docs lane. In the last 14 commits it appears **once**
(`fix(day-one)`, 18:18). Across the whole day `src/web` took 85 changes — nearly all before the
block. **The ownership transferred; the throughput did not.** Nothing wrong with that, but if you
sized the docs lane's load expecting `src/web` volume, it did not arrive.

## The real drift: docs and tests are no longer separable, and it is structural

`tests/reference-docs.test.ts` reads and asserts against **eight reader-facing documents**:

```
ANT-GUIDE.md  README.md  QUICKSTART.md  TODAY.md
ARCHITECTURE.md  DEPLOY.md  SECURITY.md  AUTH-OS-SEPARATION-DESIGN.md
```

And three further test files assert against `docs/*.md`:
`magnitude-bounds.test.ts`, `physical-bounds.test.ts`, `published-identities.test.ts`.

**So a docs-lane edit can fail the tests lane's suite, and a tests-lane refactor can invalidate a
docs claim.** That is a bidirectional coupling that path-based ownership cannot express. The map
says *docs lane owns `docs/`, tests lane owns `tests/`*; the territory is that each lane can break
the other by editing only its own files.

**This is not a mistake — it is the pinning working as designed**, and it caught the undocumented
`scripts/` file this evening. But it means "who owns this" is now a wrong question for these two
lanes. The right one is *"who is allowed to change a claim?"* — and the answer has to be one lane,
whichever it is.

**And a consequence I did not expect, which is about me:** `physical-bounds.test.ts` and
`published-identities.test.ts` derive from documents **I** wrote today. I signed off believing my
output was inert commentary. **It is now load-bearing test fixture.** If you keep a GPT lane
tomorrow, its documents need the same review gate as its findings, because they are executable now.

## Smaller: commits crossing three domains

`fix(day-one)` (18:18) touched **reader docs + `src/web` + `tests/`** in one commit. Under a
five-lane path-scoped model that is either one lane holding three ownerships or a boundary being
crossed silently. Worth knowing which; I cannot tell from the outside.

## What is NOT drift

Prefix-vs-path disagreement — `docs(today)` landing in `tests/`, `docs(tests)` landing entirely in
`tests/` — looks like drift and is the coupling above, correctly handled. I would not chase it.

---

# Part 2 — Does the Pilot plan still fit?

**Mostly yes. The design's core judgement has aged well. One thing under it moved and the plan
does not know.**

## What still holds, and holds better than when written

- **"Detector deterministic, model only ranks and phrases."** Today's work is a sustained argument
  for exactly this split. Every defect I found in a derived number came from inference where a
  function would have done.
- **"Emits nothing when it cannot tell."** The product moved *toward* the plan here, not away.
  `completionsLastHour: null` with `completionsProvenance: "not-observable"` is the same principle,
  implemented after the plan was written.
- **"Degrade, never blank."** Matches `apiFetch`'s deadline contract and the day's honesty rules.
- **"Agent transcripts are untrusted input."** Now stronger than the plan knows: today I flagged
  that `/api/triage/run` passes agent-authored issue text into a spawned investigator's prompt.
  **The Pilot would be the second such path**, and the plan's delimiter-and-never-an-instruction
  discipline is the right answer for both. Worth cross-referencing so they are fixed as one class.
- **"Not a ranker of everything — ended and archived agents are facts, not decisions."** The
  product independently arrived here (`b9dc19b` stopped the detector emitting on ended agents).

## The hard gap: the Pilot is a fourth write surface, and the plan predates the gate

**The plan mentions `transmitRefusal`, `controls[]`, `executeControl`, `/api/control` and
`UNSAFE_TARGET` exactly zero times.** Its only "instruction" references are about prompt injection.

Task 3 produces `renderQueue(queue, { onReply })`. **`onReply` is an undefined callback** — the
plan never says what happens when the operator clicks send. Its tests assert only DOM structure
(*the reply control is a descendant of the verbatim block*), which is a good safety property about
paraphrase and says nothing about delivery.

So as written, the plan permits both of:

1. **A reply box rendered on an agent whose Send the server will refuse.** Today's gate requires
   `resolution === "exact"`, not binding-bridged, process alive, snapshot fresh. A live agent
   asking a question on a folder-matched pane is a *perfectly good candidate* and an *ungated
   write target*. The operator types an answer and gets a 409 — the "enabled control that answers
   409" failure `547679e` was explicitly written to avoid.
2. **A reply path that bypasses `executeControl` entirely**, since nothing in the plan requires
   going through it.

**This is precisely the `ec5ac8f` shape.** `547679e` fixed `control.ts` and missed `app.ts`'s
attention path, because nobody enumerated the write surfaces. **The Pilot would be the next one
missed, and it is being designed now, which is the cheap moment.**

**Named fix, small:** Task 1's `PilotCandidate` should carry the agent's transmit verdict, and
Task 3 should render the reply box only when it is permitted — with the refusal reason in its
place otherwise, which the operator can already read everywhere else on the board. One field, one
conditional. Task 5's model wiring does not change.

## The medium gap: one of Task 1's tests is now vacuous

Task 1 asserts *"ended and archived agents are never candidates, however loud their signal."*
Since `b9dc19b`, **the detector no longer emits on ended agents at all** — so the fixture cannot
be built from real data, and against production the assertion passes because the input is
unreachable, not because the filter works.

Keep the test — the filter should still exist — but it now needs a **synthetic** signal on an
ended agent to be non-vacuous, and it should say so. This is the vacuity class from `1ae3982`,
appearing in a plan written before that lesson existed.

## Two concrete defects in Task 1, both a worker would hit on step 3

**The import path is wrong.** Task 1 says:

> *Consumes: `AttentionSignalKind`, `AgentSnapshot` from `src/shared/types.ts`*

`AttentionSignalKind` **is not in `src/shared/types.ts`** — grep count is zero. It is declared at
`src/server/attention-signal.ts:35`. A worker following Task 1 literally fails to resolve the
import at step 3, which is recoverable but wastes a cycle and, worse, invites them to *create* the
type in `shared/types.ts` and end up with two.

**The type is the wrong population — and this is the interesting one.** The plan types the
candidate as `kind: AttentionSignalKind`. That union has **nine** members, three of which mean
*there is nothing here*:

```
permission-requested  input-requested  fork-unresolved  handoff-stated
question-pending      assumption-stated
nothing-wanted        not-readable      out-of-scope        ← not decisions
```

`nothing-wanted` literally means *"we looked and nothing wants a human."* A collector typed on the
full union **type-checks while admitting non-candidates**, and the guard against it would have to
be a runtime filter someone remembers to write.

**`attention-signal.ts:326` already defines exactly the right type:**

```ts
type ActionableKind = Exclude<AttentionSignalKind, "nothing-wanted" | "not-readable" | "out-of-scope">
```

**Task 1 should consume `ActionableKind`.** Then the collector cannot express a non-candidate, and
the filter is the type rather than a line of code. It also needs exporting — it is currently
module-private.

Worth naming what this is: **a population error encoded in a type.** The same mistake I made today
counting `nextAction` over 577 agents instead of 21 live — the wrong denominator, one layer
earlier. It is much cheaper to fix here.

## The soft one: candidate volume is unmeasured, and stages 2–3 rest on it

The design assumes **5–15 candidates per pass** and computes its token economics from that.
Observed:

| when | candidates |
|---|---|
| design's own table, 1 Aug | 6 |
| live board, 17:25 today | 3 of 21 live |
| live board, 21:33 today | **0 of 6 live** |

**The upper end has never been observed.** The plan is not wrong — stage 1 exists precisely to
grow the detector, and today's 0 is an idle fleet at 21:33, not a broken detector. But **stages 2
and 3 are only worth building above some volume, and nobody has measured what a working day
actually produces.** Stage 1 should emit that number as its own output: candidates per hour, over a
day. It is one counter and it decides whether stages 2–3 are worth their cost.

## Verdict

**Build stages 1–2 as planned.** They are more clearly right than when written — the day's whole
argument was *deterministic where possible, silent when unsure*, which is stage 1's thesis.

**Before stage 3, add the transmit verdict to the candidate and gate the reply box on it.** It is
one field and it stops the Pilot from being the fourth surface that had to be retrofitted.

**And have stage 1 report its own candidate volume**, so the decision to build stage 3 is made on
a measurement rather than on the estimate in the design.

## Limits

- I read the design in full and the plan's structure, Task 1 in full, and Tasks 3–4 in part. Tasks
  5–7 I skimmed for control-gate references only and found none.
- The 0-candidate reading is one moment on a quiet fleet. I have stated the range I observed
  rather than treating tonight's zero as typical.
- The kinds check is now closed: nine kinds exist, six actionable. The design says "8 kinds",
  which is off by one and immaterial next to the `ActionableKind` point above.
