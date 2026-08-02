# What changed on 2 August, and what you can lean on

Five lanes worked this board all day. Git has the changelog; this is the part
git cannot tell you — **which of these you can now rely on, and which you
cannot.** Two minutes.

**Start here:** open <http://127.0.0.1:4701> and read `Needs you`. It is the
shortlist of sessions actually waiting on a human, it is what the board opens
on, and if it says nothing needs you then nothing does and you can close the
tab. Everything below is context for when it does.

---

## You can rely on this now

**The cockpit will not act on a terminal it cannot prove.** It will not type
into a pane it cannot name, into a session whose process is gone, or on routing
evidence that has gone stale. The button and the endpoint now answer from *one*
predicate, so the board cannot advertise a control the system would refuse —
that had drifted apart twice and is now agreement by construction rather than by
remembering to edit both places. Focus stays available throughout, on purpose:
looking costs nothing, and going to the pane is how you recover.

Both of the rare states behind that were produced deliberately and watched, on
probe agents in an isolated instance. Separately, the GPT lane created and closed
**eleven** cmux workspaces running probes against the live board; every one was
removed and confirmed gone. Nothing of yours was touched, but the machine was
not idle.

**One cost total that means something.** Ask any window, add what sits before
it, and you get the same whole. Measured at **18:18 CEST**: **$32,942.99** across
the recorded history, identical to the cent from a one-day window and a
ninety-day one.

That figure survived having its own foundations replaced four times today —
de-duplicating cumulative session snapshots, disclosing what falls outside the
window, a row cap and a range clamp. A number that lands in the same place after
its inputs are rebuilt underneath it has earned more than one that was never
questioned.

**It is a reading, not a fact.** The same total read **$32,471.40 at 17:21** and
**$32,942.99 at 17:35** — half an hour of work moved it by $471. Then it sat
perfectly still: identical to the cent at 18:03 and again at 18:18, across every
window. Quote it with its timestamp or do not quote it.

It moves in **steps**, when new usage is ingested, not gradually — so seeing the
same figure twice is not evidence the caveat was over-cautious. And the movement
is now the fleet, not the arithmetic: the corrections landed today. **The number
is no longer unstable; reality is.**

**A tool you never installed is absent, not broken.** A first run used to open on
a board announcing itself degraded, because a collector you had never installed
was counted against you. It now names the gap instead: with one tool installed
it reads `1 of 1 collectors healthy · 3 not installed`, and with none,
`No collectors installed yet`.

*Scope, because it matters here:* every provider is installed on this machine, so
that path cannot be produced on it. It is verified against fixtures, not observed
on a bare install — and the last change to it landed at 18:18, minutes before you
read this.

**The docs are pinned to the code.** Rename a symbol and the doc describing it
fails the suite. That is how the undocumented script in `scripts/` was caught
this evening — by a check written this afternoon, before anyone noticed.

---

## Fixed, but not yet provable

**Archive retention.** The clock now starts when you archive rather than when
the session last spoke, which was the bug: a session quiet for 31 days used to
be pruned on the next save after telling you `ok`. At 18:18, **377 of 595**
records carried an archive time.

Read the gap rather than the ratio: **218 records have no stamp and never will**,
because they were archived before the fix existed. That number has not moved
across four readings while the stamped count climbed, so it is a fixed backlog
rather than a shortfall — it shrinks only as those records age out on the old
clock. Everything archived from now on is measured.

But the oldest stamped record is **0.1 days old**, because stamping began when
the fix shipped. Nothing has been held thirty days and observed to still be
there, and nothing can be for thirty days. **The clock starts in the right
place; the full term is not proven.** If something matters, copy it out of the
drawer.

**The cost card does not yet show what it knows.** The server reports the spend
sitting outside your chosen window. The card does not print it, so a 30-day view
still *looks* complete. The number is available; the pixel is not.

---

## Still open

- **A row can give the wrong reason.** A dead agent's Send is correctly refused,
  but the explanation attached to it can be the wrong one — "cannot identify the
  pane" instead of "the process is gone". Nothing unsafe happens; you are simply
  told to fix the wrong thing. Routed.
- **Two claims nobody has confirmed.** The `setup:cmux` first-run message is
  read from the script, not run, because running it rewrites your cmux config.
  And the mis-routed Send that started the write-path work is evidenced in
  `adc1da0` but could not be reproduced today — the probe agents are gone.

---

*This file describes one day. When it stops being the most recent thing that
happened, archive it — a dated summary that outlives its date is exactly the
kind of stale claim the rest of this work spent the day removing.*
