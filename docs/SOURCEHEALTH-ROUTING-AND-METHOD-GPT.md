# Routing the sourceHealth gap — corrected — and what tonight says about method

---

# Part 1 — I was wrong about `absent`, and the fix is a different one

**Correction first.** I wrote that `sourceHealth.absent` is *"a field named for exactly this
condition, reporting zero."* **It is not.** Reading `snapshot.ts:278-307` before routing — check 7,
one layer out — shows `absent` means something else entirely, and means it deliberately:

> *"The ratio counts collectors that EXIST on this machine. Reporting '3 of 4 healthy' for a
> missing cmux still reads as a fault to the person it is shown to, and reporting '4 of 4 healthy'
> would claim we are watching four things when two are not installed… `absent` ships beside it so a
> card can name what is simply not here."*

`absent` counts **collectors whose tool is not installed on this machine** — a fresh clone with no
cmux binary and no `~/.cursor`. It was written after measuring a virgin clone that read *"1 of 4
collectors degraded"* and correctly calling that an underclaim. **The design is good and it is
answering a question I mistook for mine.**

So `absent: 0` is **true**: nothing is uninstalled here. That is a fifth phantom, caught before
routing because I read the block instead of the field name.

## The gap survives, in corrected form

`sourceHealth` cannot express **"a provider is billing us and we have no collector for it."** Not
because `absent` is broken — because **that condition has no field at all.** The existing design is
about *this machine's installed tools*; the gap is about *providers that spend money*. Different
questions.

```
collectorProviders = ["codex", "claude", "cursor"]   + cmux = 4 known
burnbar bills      =  Codex, Claude Code, Cursor, Hermes, Factory
```

**Hermes and Factory are not "absent" — they were never `Provider`s.** They cannot be missing from
a list they are not on.

## What to route

**Add a distinct concept beside `absent`, do not overload it.** Something like:

```ts
unmodelledProviders: string[]   // seen in usage, no collector exists
```

derived from the distinct providers in the burnbar window, minus `collectorProviders`. Today that
yields `["Hermes", "Factory"]`.

**Why it belongs here rather than only on the Usage card:** it is the same shape as the existing
comment's concern — *"we are watching four things"* is fine and true; what a reader cannot learn is
*"and something else is spending money that we are not watching."*

**And it upgrades the check from tier 1 to tier 3**, which is the part that outlives Hermes: the
numerator would come from the collector list in code and the denominator from observed usage — two
sources. `absent` today is computed entirely from the code's own list, so it can never surprise
anyone. This version can, which is the whole point of a health check.

**One design note, inherited from their comment:** do not let this reintroduce the underclaim they
fixed. A fresh machine with no Hermes should say nothing, not *"1 provider unmodelled."* Emit it
only when a provider **appears in usage** — presence is the trigger, not absence.

---

# Part 2 — The method finding, and I think the framing needs correcting too

You put it as *"we spent hours looking where we suspected problems and found phantoms; we spent one
hour looking where nothing had ever looked and found two live defects."*

**The second half is right and the first half is too harsh on the audits.** The audits found the
`unique-cwd` misroute proven end-to-end, the broadcast fan-out, the binding bridge, the attention
path `547679e` missed, the $11,939 suppression, July 30's double-counting, the archive retention
clock, the partial-period bars, the 30-day coverage gap, and Hermes. Those are real and several are
serious. **The audits were productive. They were also where every phantom came from.**

## The distinction that actually explains it

It is not *where* you look. It is **what form the finding is forced into before it is reported.**

- **An audit produces a claim.** A claim needs verification, can be wrong, and mine were wrong
  eight times.
- **A test produces a failure.** A failing test is self-demonstrating. It cannot be a phantom in
  the same way, because the thing being asserted has already happened in front of you.

**Writing a test forces the finding into falsifiable form *before* it is reported.** That is
precisely what the publication form tries to impose on prose *after* the fact — population,
provenance, falsification, raw evidence. **A test satisfies all of them by construction.** The test
*is* the form, executed.

And it explains the asymmetry exactly: **all eight of my phantoms were prose claims, and not one
would have survived being written as a test first** — because writing the test means constructing
the failing case, and for `nextAction`, `completions-counter`, the `?? 0` and the `.slice`, **the
failing case does not exist.** I would have discovered that at the keyboard instead of in your
reply.

## So the rule I would actually take from tonight

**Audit to discover what to test. Test to prove it. Never report from the first step alone.**

My best work today has that shape: the write-path audit ended in a **tty marker file** — an
artifact that either exists in the right pane or does not. That is a test in all but name, and it
produced zero phantoms. My worst work ended in a paragraph.

**And your yield observation stands in its stronger form:** the untested-paths map found two live
defects in an hour because *untested* and *uncorroborated* correlate — a path nothing exercises is
also a path nothing contradicts. `getUsageSeries` is the pure case: **the only consumer was a chart,
so no other figure ever disagreed with it, and it drifted for months.** That is the same "no
sibling" property from the corroboration map, arriving from the other direction.

**Which suggests the two maps should be one query:** *what is both untested and uncorroborated?*
That intersection is where the next one is, and both of tonight's defects were in it.

## Limits

- **64 fix commits landed today** and I have not traced which came from audits versus tests, so my
  "the audits were productive" claim is from memory of my own findings, not a count.
- **Two data points** for the untested-paths yield. A rate from two is not a rate.
- The phantom count is mine alone; I do not know the other lanes'.
