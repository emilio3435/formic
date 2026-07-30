# Retro: why per-task reviews missed two bugs

**Program:** body restyle, 2026-07-22/23 (three workstreams, 15 tasks, serial landing A→B→C)
**Written:** 2026-07-30, closing the follow-up ticket in `.superpowers/sdd/progress.md`
**Scope:** a reflection, not a change request. Concrete process changes are at the end.

## What happened

Fifteen tasks each got their own review. Every one passed. The final
whole-branch review then found two landing-blockers:

1. **A contract shipped with nobody using it.** Task B1 added
   `SourceHealth.lastHealthyAt` and `POST /api/recollect`. Nothing consumed
   either. The degraded header still called `fetchSnapshot`, and
   `lastHealthyAt` had zero readers. The record names the cause exactly:
   *"UNRECORDED decomposition gap: the degraded-header consumer was never
   assigned to any task."*

2. **A new alert style covered the keyboard focus outline.** Task C1's alert
   rails set the same property as the focus ring at higher specificity
   (0,3,0 vs 0,2,0), so on exactly the alert rows the focus outline
   disappeared.

Both were fixed before landing. The process caught them — just at the last
possible gate, which cost an extra fix wave.

## Why fifteen reviews missed both

**Neither bug is inside a diff.** A per-task review asks "does this diff do
what the brief said?" B1's backend was built exactly to spec. C1's rail CSS
was correct in isolation. Read either diff on its own and there is nothing to
find. Both bugs live in the *relationship* between two pieces of work — or
between a piece of work and an absence. Task-scoped review is structurally
blind to that, no matter how careful the reviewer.

**You cannot review an absence.** Bug 1 was a missing task. No diff existed
where the gap was, so no review had anything to look at. The defect was in the
decomposition, and nothing in the process reviewed the decomposition for
coverage. Fifteen reviews of fifteen tasks cannot detect the sixteenth task
that was never written down.

**Specificity collisions are emergent by nature.** Bug 2 needed a
whole-stylesheet question — "what else sets this property on selectors that
overlap mine?" — at a moment when the reviewer was scoped to one task's diff.
Each rule is individually right. The bug exists only when both apply to the
same element, which no single-file view shows.

**Serial landing looked like integration coverage and wasn't.** Landing A→B→C
means each lane merged onto a main that already carried the previous lanes,
which *feels* like integration testing. Tests stayed green the whole way
because no test asserted the pairing: none rendered an alert row and checked
its focus outline, and none asserted that a `lastHealthyAt` reader existed. A
contract with no consumer test passes forever.

**The tests encoded task intent, not program intent.** Each task's tests
asserted its own brief. Nothing asserted the program-level promise — "the
degraded header tells you since when." That promise belonged to no task, so it
belonged to no test.

## The honest summary

The per-task gate was working as designed. The mistake was expecting it to
catch a class of defect it cannot see. Both bugs were *integration* defects
surfacing in a program that only had *unit* gates until the very end. The
final whole-branch review is not a safety net that happened to help; for this
class it was the only gate that could ever have worked.

Second-order lesson from the same program, worth keeping next to these: two
claims in the design doc turned out to be backwards or unverified, and were
only caught when someone grepped for evidence. Assertions about the codebase
("every call site does X", "this never binds") need measuring, not asserting.

## What to change next program

1. **Pair every contract with a named consumer at decomposition time.** If a
   task produces an API, field, or event, some task must be named as the thing
   that reads it — in the plan, before dispatch. "Producer with no consumer"
   is a plan defect.

2. **Review the plan for coverage, not just for quality.** One short pass
   whose only question is: which promises in the plan are owned by zero tasks?
   This is the gate that would have caught bug 1, and it costs minutes.

3. **One integration assertion per program-level promise.** Not per task. If
   the program promises "degraded header shows since-when", one test asserts
   that end to end, and it fails until a consumer exists.

4. **Make the CSS collision check mechanical.** Any new rule setting a
   property that is already set on overlapping selectors gets a specificity
   comparison. This repo already asserts against stylesheet source text in
   tests, so a focus-outline guard is cheap to write and cannot rot.

5. **Keep the whole-branch review, and budget for it.** It found both. Plan
   the fix wave as expected work rather than as a surprise.

## Where the evidence lives

- `.superpowers/sdd/progress.md` — the full ledger; the final-review entry
  naming both bugs is under the WS-B/close-out lines.
- `.superpowers/sdd/task-B1-report.md`, `task-C1-*` — the per-task reviews
  that passed.
- `BODY-RESTYLE-PLAN-2026-07-22.md` — the plan whose decomposition omitted
  the consumer task.
