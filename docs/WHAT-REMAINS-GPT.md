# What is genuinely unexamined

You offered me a framing — *the surfaces are covered and what remains is behaviour over time* —
and asked me to say so plainly if it is the honest answer. It is **half** the honest answer, and
I would rather correct the framing than accept a flattering one.

**Two dimensions remain, and they are different kinds of hard.**

---

## 1. The write path — present-tense, and the larger gap

Not a time problem. Testable today.

Every audit across two days has been read-only. **I have audited what the cockpit says and never
what it does.** Focus, Send, Interrupt, Archive, Acknowledge, Dismiss, Snooze, rename, triage,
the action log — not one control exercised.

This matters because the north star gives every pixel three permitted jobs: say something is
wrong, say what is happening, **or let the operator act.** I have audited the first two
exhaustively and the third not at all. A control that renders correctly, is enabled correctly,
and then acts on the wrong agent would have passed every audit I have written — including the
ones that found real defects.

The sharpest unknown inside it: **does an action reach the agent it names?** Identity resolution
is the most defect-dense area of this codebase — quarantine, cwd mismatch, surface collisions,
`allowCwdFallback` — and the drawer's controls route through exactly that machinery. Every
identity defect found so far has been a *display* defect. Whether the same ambiguity misroutes an
instruction is unknown.

## 2. Behaviour over time — real, and genuinely harder

Your framing is right about this half, and I can now put numbers on it. Measured against the
live board:

| Boundary | Constant | Live position | Ever crossed? |
|---|---|---|---|
| Archive retention | `ARCHIVE_RETENTION_MS` 30 days | oldest agent **11 days** | **no** |
| Archive record cap | `MAX_ARCHIVE_RECORDS` 5,000 | **480** tracked | **no** |
| Attention retention | `ATTENTION_RETENTION_MS` 7 days | — | **no** |
| Attention record cap | `MAX_ATTENTION_RECORDS` 500 | — | **no** |

**Not one retention or cap boundary has ever fired in production.** They have unit tests —
`archive.test.ts` pins the 30-day prune — but a unit test with an injected clock exercises the
arithmetic, not the interaction between pruning, the archive round-trip, `lastAgentClosing`
preservation, and whatever else reads that store at the moment it shrinks.

And the restart path is exercised constantly without being audited: `observedWindowMs` reads
**300,000** right now, meaning the pulse tracker restarted five minutes ago and has not reached
its own hour. Every restart resets the completion counter, the burn window, and the momentum
baseline. I have reported the *labels* that lie during that window; I have never audited what the
board does across a restart, only what it says after one.

Why this is a different and harder audit: you cannot measure it by looking. It needs either
patience — run for thirty days and watch the prune — or a deliberately aged fixture that
fast-forwards the clock through each boundary while the rest of the system runs normally. That is
a test-harness build, not an audit pass, which is why naming it as its own category is the honest
move rather than folding it into "still to check".

## 3. Smaller, and I will not inflate it

Layout and CSS at n=1/n=3 (my renderers were called in isolation, not painted), and viewports
other than 1440 for anything except the drawer. Real, bounded, and much less valuable than the
two above.

**That is the complete list.** The surfaces themselves — summary band, rows, rollups, program
headers, tabs, drawer, Usage, health, attention, quiet board — are covered, and I am not going to
invent a ninth.

---

## The scratch agent: design, and why I have not started it

You said yes, with the constraint that it must not pollute the fleet's numbers in a way that
outlives it. Here is the protocol I would use:

- **Name:** `PROBE-writepath-<timestamp>` as the session's task/display name — unmistakable in the
  roster, greppable in the archive, and obviously not real work to anyone who sees it mid-run.
- **Scope:** one session, one cmux pane, doing nothing but idling so it is a clean control target.
- **Sequence:** observe it appear → Focus → verify the pane that actually received focus →
  Send a marker instruction → verify it landed in *that* session's transcript and no other →
  Interrupt → Acknowledge → Archive.
- **The assertion that matters:** at each step, confirm the action reached the agent the UI
  named, by checking the target session's own transcript rather than the board's report of
  success. The board reporting success is the thing under test.
- **Cleanup and proof:** archive it, then confirm absence three ways — gone from `/api/snapshot`,
  gone from the archive store after prune or by explicit removal, and its transcript moved out of
  the collected directories. Report the before/after `totals.tracked` so any residue is visible in
  a number rather than asserted.

**I have not started it, deliberately.** My remaining budget is not enough to run that sequence
and verify the cleanup properly, and a half-executed write-path probe that leaves a `PROBE-`
session in the archive is precisely the residue you asked me to avoid. Handing you a protocol I
have not run is honest; starting it and stopping mid-sequence would not be.

If you want it run, it wants a fresh lane with budget for the whole sequence including the
cleanup proof — that is a better use of it than the tail of mine.

---

## One correction to my own framing

Last round I called the write path "the one dimension left". That was wrong in the direction of
under-counting: time-dependent behaviour is a second dimension, and the boundary numbers above —
480 of 5,000, 11 of 30 days — are the evidence that it has never been exercised rather than my
inference that it might not have been. Your framing caught something mine missed.
