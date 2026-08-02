# Two answers: where else a constant stands in for a measurement, and what I could not establish

---

# ONE — the pattern elsewhere

First, the pattern stated precisely, because "publishes a constant" is not quite it. `retentionDays: 30`
would be harmless if the delivered retention were 30. **The defect is a published value that
describes a *policy* while the system delivers something *different*, with no measurement of the
delivered behaviour anywhere.** The constant is not the bug; the absence of its counterpart is.

Searched on that definition. **Two further instances, one refuted, and one I am flagging as
unresolved rather than claiming.**

## 1.1 HIGH — `maxRecords: 5000`, one line below the finding, overstates what an operator can keep

`app.ts:598` publishes `maxRecords: MAX_ARCHIVE_RECORDS` — 5,000. The cap is genuinely enforced at
5,000, so at first read this is honest.

It is not, and my own §2 last round proves why. `#commit` (`archive.ts:157-160`) fills the budget
with full history records **first**, then gives bare operator-archive IDs only `remaining`:

```js
const remaining = MAX_ARCHIVE_RECORDS - retainedAgents.length;
```

So **the capacity available to operator archives is 5,000 minus however much history has
accumulated** — currently 5,000 − 533, and falling. The published figure describes a total the
operator does not have access to, and there is no field anywhere reporting the remainder they
actually get. Same endpoint, same shape, one line apart from the retention finding.

**Fix:** publish `recordsUsed` and `operatorCapacityRemaining` alongside the cap, or stop
publishing a number that only describes the union.

## 1.2 HIGH — context-window sizes are config constants used as the denominator of a percentage

`config/models.json → claudeContextWindows` is a static table. `contextPctFor`
(`snapshot-agent.ts:174`) divides live token counts by the window it supplies. So every context
percentage on the board is *measured numerator over asserted denominator*.

**This one has already caused a real defect.** The `contextPeak` card read null in part because the
model table was stale — `opus-5` and `opus-4-7` were missing — and nothing measured or noticed the
gap; the table simply asserted a world and the arithmetic followed. That was fixed by editing the
table, which is to say by correcting the constant, not by adding a measurement. **The next model
this fleet adopts reintroduces it**, and the failure will again be silent, because a missing entry
produces a plausible percentage rather than an error.

That is the archive shape exactly: a value that is right until reality moves, with nothing watching
for the move.

**Fix:** treat an unknown model as unknown — emit no percentage and say why — rather than falling
back to a default window. A missing denominator should suppress the figure, not invent one. The
codebase already applies exactly this rule to cost (`tokensMissing` carries the gap); context is the
place it was never extended to.

## 1.3 Refuted — `scanWindowHours` looked like an instance and is not

`app.ts:974-975` hardcodes `scanWindowHours: 36, lookbackHours: 36`, and `scanWindowHours` is a
configurable setting. That looked like the same defect.

**It is not.** The live path is settings-driven: `state.ts:72` and `:189` read
`settingsReader().scanWindowHours`, which flows through `snapshot.ts:318-326` into the payload. The
literal appears only in `emptySnapshot()`, the no-data fallback.

Worth recording *how* I nearly got this wrong. The live snapshot reports **36** and the setting is
**36**, so the observation is identical under both hypotheses — check 4 exactly, and the setting
sitting at its default is what made the trap available. Only reading the path settled it. The one
residue is cosmetic: if an operator sets a 12-hour window and the server has no data yet, the
fallback still claims 36.

## 1.4 Unresolved, flagged not claimed — `pricingVersion`

`config/models.json` publishes `pricingVersion: "2026-07-28"`, five days stale as of today, beside
a price table containing **exactly one model**. Costs on this fleet arrive *measured* and bypass the
table, so the blast radius is limited to rows without a measured cost — which is precisely how
Cursor ends up null and suppresses the headline.

I am not calling it an instance because I have not established that the real prices have moved. But
a version string is an assertion about currency, and nothing checks it against anything. If prices
upstream change, this file will keep saying 2026-07-28 and the fallback arithmetic will keep
producing confident numbers.

---

# TWO — what I could not establish, stated plainly

You asked whether waiting would resolve it or whether it is structurally unanswerable. **The two
are different categories and both are present.** That distinction turned out to be the most useful
thing in this reply.

## Waiting (or a fixture) genuinely resolves these

None of these are unanswerable — I ran out of budget or the clock has not turned:

| Not established | What resolves it |
|---|---|
| **Day- and month-boundary rollovers in usage buckets** | **History already held** — 90 days against known dates. This needs *no* waiting; I flagged it last round as not-done rather than not-findable and it is still exactly that. **Highest-value remaining item.** |
| The first prune's integration behaviour — pruning while a snapshot derives, `lastAgentClosing` across a prune, dangling attention/binding keys | Waiting ~19 days, **or** an aged fixture fast-forwarding a real store through the boundary. A harness build, not an audit. |
| SSE reconnection across many cycles — listener accumulation, drift, silent stall | Waiting, or a loop harness driving reconnects. |
| Long-run monotonic growth at 10× fleet | Waiting, or synthetic load. |

## Structurally unanswerable — and this is the category worth naming

**Waiting produces future data. It cannot reconstruct past state the system never recorded.**

The archive is the live example. **0 of 539 records store an `archivedAt`.** So:

- *Going forward*, adding the field makes every future retention decision auditable.
- *Backwards*, no amount of waiting, no fixture, and no cleverness recovers what retention any
  existing record was given, or whether any operator archive was silently pruned early. **The input
  to that calculation was discarded at write time.**

That is a genuinely different failure class from a wrong number, and it is the one your
observation named: a wrong number can be recomputed once you find it; **an unrecorded input cannot
be recovered at all.** Every other finding this week was recoverable — the misroutes, the
suppressed cost, July 30 — because the evidence still existed somewhere. This one is not.

**The general form, offered for the standing rules:** *when a system makes a decision from an input
it does not persist, that decision becomes permanently unauditable the moment it is made.* Worth
treating as its own review question — "if this were wrong, could anyone ever prove it?" — because
it is the only defect class where the cost of noticing late is unbounded.

The same question, asked of the rest of this system, has one other answer I already have: **no
epoch marker is persisted anywhere**, so which figures reset across a restart is likewise
unreconstructable after the fact. Same class, same remedy, and the remedy only ever works
prospectively.
