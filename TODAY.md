# What changed on 2 August, and what you can lean on

> **15 August correction — the provider roster now includes Hermes and Grok.**
> Hermes interactive JSONL sessions are collected as agents.
> Hermes cron is collected separately as scheduled spend on Usage.
> A cron job has no Focus, Send, lifecycle, or Board row because it is not an agent.
> Health can still read `8 of 8 collectors healthy` because it checks the eight provider homes;
> Usage separately lists any billed name outside that roster under **Unmodelled billed providers**.
> The dated Hermes statements below describe the 2 August
> roster before this collector existed.

> **3 August, 14:00 — two corrections landed on top of everything below.** Both
> were found by asking what a number's *membership* was rather than whether it
> looked right, and both are pushed (`0df7714`, `d546c02`).
>
> **`4 of 4 collectors healthy` was counting the wrong four.** The ratio was
> computed over codex/claude/cursor **plus cmux**; the breakdown printed beside
> it on the same card was built from codex/**omp**/claude/cursor. Two disjoint
> sets, both with four members, so the card looked self-consistent — but omp was
> never counted and a broken omp collector would have shown *healthy* in the
> header and *broken* in the drawer at the same time. cmux is the control plane,
> not a collector; it keeps its own `controlHealth` and no longer double-reports
> as a broken collector. **The number on screen is unchanged. Its membership is
> now true.**
>
> **The board's real-history checks were grading 7.4% of their window.** They
> asked for three months and got the most recent 500 rows — three days — because
> `getUsageInvocations` caps there. It had always published `truncated: true`;
> nothing read it. Two checks pinned to document real defects had gone *green*,
> which reads as fixed: measured properly, there are **140 long-span sessions in
> the window and zero visible in the capped page**. The defect never moved. They
> now page the whole window (6,762 rows, zero duplicates), which immediately
> surfaced two more defects truncation had been hiding — see **Open, with
> numbers** at the end.



Five lanes worked this board all day. Git has the changelog; this is the part
git cannot tell you — **which of these you can now rely on, and which you
cannot.** Five minutes — it was two when written at 18:00, and the evening
added a section that changes what you should believe. If you have only two,
read **Start here** and **What the last five hours changed**.

**Start here:** open <http://127.0.0.1:4701> and read the **Needs you** strip
pinned to the top of `Board`. It is the shortlist of sessions actually waiting
on a human, it is the first thing on the tab the board opens on, and if it says
no session is asking for you then none is and you can close the tab. Everything
below is context for when one does.

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
it, and you get the same whole. Measured at **22:12 CEST**: **$33,278.90** across
the recorded history, identical to the cent from a one-day window and a
ninety-day one.

That figure survived having its own foundations replaced four times today —
de-duplicating cumulative session snapshots, disclosing what falls outside the
window, a row cap and a range clamp. A number that lands in the same place after
its inputs are rebuilt underneath it has earned more than one that was never
questioned.

**It is a reading, not a fact.** Four readings today: **$32,471.40 at 17:21**,
**$32,942.99 at 17:35**, the same figure to the cent at **18:03 and 18:18**, then
**$33,278.90 at 22:12**. Half an hour of work moved it by $471; the next three
hours moved it not at all, then by $336. Quote it with its timestamp or do not
quote it.

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
be pruned on the next save after telling you `ok`. At 22:12, **406 of 624**
records carried an archive time.

Read the gap rather than the ratio: **218 records have no stamp and never will**,
because they were archived before the fix existed. That number has not moved
across six readings while the stamped count climbed from 377 to 406, so it is a fixed backlog
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

## What the last five hours changed

*This document was written at 18:00. Read this section before trusting the rest
of it — the verification story is less settled than the sections above imply.*

**The board was checked against an outside record for the first time, and it
held.** Until tonight every number here was verified against itself. A new test
joins per-session totals to OpenBurnBar's independent record, and it immediately
found a disagreement: one session where the board counted 293,235 and BurnBar
recorded 112,258, 161% apart. **Our collector was right.** 112,258 turned out to
be the sum of that session's first three calls of seven — BurnBar's cumulative
row had stopped advancing.

That is the strongest evidence produced today, and stronger than anything
self-verification could give you: an outside record disagreed, and the
adjudication went our way on the merits rather than by assumption.

**But read how it was settled.** A new endpoint publishes the board's per-call
series so a foreign total can be prefix-matched — if it equals a prefix, the
other side is behind; if it falls between call boundaries, the disagreement is
real. That mechanism is properly tested, in both directions.

**The verdict itself is not.** That the 112,258 was a three-call prefix was
established **by hand from the raw transcript** and lives in prose and comments.
No test re-derives it. So the machinery for adjudicating the next disagreement
is audited, while the one adjudication actually performed rests on a
recomputation nobody has repeated. If that hand arithmetic was wrong, nothing
here would catch it.

**Two things follow for a reader.** The board's numbers now have one external
corroboration rather than none, which is a real change in their standing. And
the verification story is *younger* than it looks: the first outside check ran
tonight, found something on its first pass, and its conclusion is one person's
arithmetic.

## Still open

- **The board is blind to two billed providers and one recurring job, and its
  own health card asserts nothing is missing.** That is the sentence. If you
  read nothing else here, read that one — it is the most expensive thing found
  tonight.

  **Hermes is billed and uncollected.** Your cost source reports five providers;
  the board collects five, but not the same five. Hermes' entire activity is a
  cron job called `cron_daily-watcher-001`: **$23.99 across 7,516,850 tokens in
  20 calls in the last 24 hours**, **$243.73 over thirty days**. It has no row,
  no agent, no session, and no collector.

  **Factory was the same and no longer is.** It gained a collector on
  2026-08-04 (`src/server/factory.ts`), so its sessions now carry rows, tokens
  and a model like any other provider. Half of this finding is closed; the half
  that remains is Hermes, and it is the expensive half.

  **And the board positively asserts nothing is missing.** It is not silent. The
  snapshot carries a field built to count exactly this — and it reads
  **`"absent": 0`** while two billed providers have no collector. The health line
  says `5 of 5 collectors healthy` beside it — a full count of a roster that
  does not include the provider being billed.

  Both are true of their own population and false of the question you would ask
  them. `sourceHealth` counts the collectors the board has; Hermes is not one,
  so it cannot register as an absent one. **A
  counter whose population excludes the thing you are looking for will always
  report zero, and zero reads as an answer.** That is what makes this dangerous
  rather than merely incomplete: silence invites a question, and `absent: 0`
  closes it. The only place the spend appears is the Usage tab's provider
  breakdown, which you have to already suspect to open.

  This is the opposite failure from the ones fixed today. Those were wrong
  numbers, and a wrong number announces itself by disagreeing with something. An
  absent one agrees with everything.
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

---

## Open, with numbers (3 August)

Four things are now measured rather than suspected. None is urgent; all are the
kind that vanish if nobody writes them down.

**31 rows are priced above the ceiling.** `GPT-5.5-High-[VibeProxy]-26` (30
rows, max $31.93/M) and `Claude Opus 4.8 Fast Mode` (1 row, $30.83/M) are model
names the price vector cannot recognise, so their blended rate is computed
against a card with no entry for them. Historical, not ongoing — the newest is
2026-06-08. The fix is a pricing decision: name them, normalise proxy-suffixed
labels, or accept them as unpriceable.

**The 24-hour session bound has about 2% headroom, not the 400% its comment
claims.** That figure came from the truncated page. The worst legitimate session
across the real window is 23.5 hours against a 24-hour ceiling, so the bound is
one ordinary long session away from firing on good data.

**One session's total dropped on our side.** BurnBar records 293,235 for
`fe1d8020-259` — the figure this board published when the disagreement was first
recorded, against BurnBar's 112,258 at the time. Its record was the truncated
one, for the second time, and our collector was right twice. But the board now
reports **13,775** for that same session, the agent is `stale`, and it falls
outside the joined set — so no assertion covers it. Unexplained, and invisible
to the cross-source check by construction.

**Hermes has billed rows and no collector.** Four and two long-span
rows respectively turned up in the paged window. The guide already says these two
are not watched; this is the first time the blind spot has had a number attached.

### Still yours, unchanged

PR #5 — 163 commits, open, `MERGEABLE / CLEAN`. The two commits main gained are
the squash-merges of #3 and #4, content this branch already carries. The
spend-blocked frontend lane still needs you. The Pilot plan is written and
amended and has not been started.
