# Archive: retention runs from when we took custody, and is measured rather than asserted

*Proposed body if the archive work is split out of PR #5. Commits `32ba5d6`
(audit) and `7be12d2` (fix). Four files: `src/server/archive.ts`,
`src/server/app.ts`, `tests/delivered-retention.test.ts`,
`docs/RETENTION-INTERACTIONS-GPT.md`.*

---

**This is a data-loss fix.** An operator archived things in order to keep them,
and the product kept them for less time than it said — sometimes for no time at
all, while returning success.

## The clock started before the operator did

`archiveCopy` stored the source agent's own `updatedAt`, and freshness was
measured from exactly that. Retention was therefore **30 days minus however
stale the session already was when you archived it**:

| you archive a session last active… | you actually kept it |
|---|---|
| today | 30 days |
| 20 days ago | 10 days |
| 31+ days ago | **pruned on the next save** |

The last row is the one that costs something. `Archive` returns `ok`, and the
record can be gone before the operator looks again. Nothing about the response
distinguishes it from a durable archive.

## And nothing could have noticed

Two properties made this undetectable rather than merely wrong.

**No record of custody.** Nothing stored *when* an agent was archived, so the
shortfall could not be measured even in principle — not by a monitor, not by an
operator, not by this audit until it read the assignment.

**A constant reported as a measurement.** The API published `retentionDays: 30`
computed from the retention constant. It would keep answering 30 no matter what
was delivered, because it was describing the policy rather than observing the
store. Measured against the live store at audit time: 539 records, **0 of them
carrying an archive timestamp**.

## The fix

- `archivedAt` is recorded when the record is stored, and preserved across
  re-archives so a later write cannot restart the clock.
- Retention runs from custody: `archivedAt ?? updatedAt`.
- The API now reports `deliveredRetention` **measured from the records
  themselves**, beside the policy figure rather than in place of it.

## What it does not fix, stated plainly

**The repair is forward-only by construction.** It works by stamping the moment
of archiving, so it cannot reach anything already archived. Those records have
no stamp and fall back to the old clock, exactly as before.

That is the honest shape of the fix and it is documented as such, because a
reader who hears "fixed" and concludes their existing archive is now safe has
been misled by the good news rather than the bad. `ANT-GUIDE.md` carries the
warning, the table above, and the forward-only caveat, and a test fails if that
caveat is removed while the fallback still exists.

Absent-first is preserved throughout: a record with no `archivedAt` is counted
as *unmeasurable*, never as *zero days*.

## Verification

`tests/delivered-retention.test.ts` covers the clock source, custody
preservation across re-archive, the pruning boundary, and that delivered
retention is derived from records rather than from the constant. The audit that
found it, with the live measurements, is `docs/RETENTION-INTERACTIONS-GPT.md`.

`tsc` clean; the suite is green at the branch head.
