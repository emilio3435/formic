# What changed on 2 August, and what you can lean on

Five lanes worked this board all day. Git has the changelog; this is the part
git cannot tell you — **which of these you can now rely on, and which you
cannot.** Two minutes.

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
probe agents in an isolated instance. No cmux workspace was created or removed.

**One cost total that means something.** Ask any window, add what sits before
it, and you get the same whole. Measured at 17:55: **about $32,943** across the
recorded history, identical from a one-day window and a ninety-day one.

That figure survived having its own foundations replaced four times today —
de-duplicating cumulative session snapshots, disclosing what falls outside the
window, a row cap and a range clamp. A number that lands in the same place after
its inputs are rebuilt underneath it has earned more than one that was never
questioned.

**It is a reading, not a fact.** At 17:21 the same total read $32,471. Half an
hour of work moved it. Quote it with its timestamp or do not quote it.

**A tool you never installed is absent, not broken.** A first run on a machine
with no cmux used to open on a board announcing itself degraded. It now reads
`4 of 4 collectors healthy`, because the count is of collectors that can *see*,
not of tools you own.

**The docs are pinned to the code.** Rename a symbol and the doc describing it
fails the suite. That is how the undocumented script in `scripts/` was caught
this evening — by a check written this afternoon, before anyone noticed.

---

## Fixed, but not yet provable

**Archive retention.** The clock now starts when you archive rather than when
the session last spoke, which was the bug: a session quiet for 31 days used to
be pruned on the next save after telling you `ok`. 368 of 586 records now carry
an archive time.

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
