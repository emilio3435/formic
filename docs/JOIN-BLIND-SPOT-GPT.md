# The four unmatched rows are a whole provider — and the join cannot see it by construction

You were right that the misses were the interesting part. **They are not noise, an id-format
quirk, or a timing gap. They are one provider the board does not model at all**, and they carry
**20.5% of measured cost.**

---

## What the unmatched rows are

Widening the sample to defeat the 50-row cap (twelve 2-hour windows over 24h):

```
rows 222 · matched 202 · UNMATCHED 20  (9.0%)
unmatched by id shape: { "cron_*": 20 }   ← every one, no uuid misses
```

All twenty are the same recurring job, all one provider:

```
cron_daily-watcher-001_20260802_210131   Hermes   184,371 tok   $0.59
cron_daily-watcher-001_20260802_195415   Hermes   151,011 tok   $0.50
cron_daily-watcher-001_20260802_184117   Hermes   550,470 tok   $1.71
…
```

**The join is clean on the uuid side.** Every uuid-shaped `sessionId` in 24 hours matched a board
`sourceSessionId`. There is no id-format bug and no partial-match problem. The blind spot is
entirely one shape, and that shape is a scheduled job with no transcript — so it can never be a
board session.

## It is not 9%, it is 20.5%

```
unmatched:   7.5M tokens   $23.99
matched  : 182.3M tokens   $93.17
dropped   :  4.0% of tokens · 20.5% of COST
```

**A join that drops 9% of rows drops a fifth of the money**, because cron rows are individually
large and expensive. Anyone reporting *"board and burnbar agree"* off this join would be agreeing
about 79.5% of the spend and saying nothing about the rest.

## And the reason is structural: the board does not track this provider at all

```
board agents by provider : claude 330 · codex 281 · cursor 14
burnbar cost by provider : Claude Code $74.65 · Codex $36.02 · Hermes $23.99 · Cursor null

agents mentioning cron or watcher anywhere: 0
share of Hermes spend with a board agent  : 0%
```

**The board tracks three providers. BurnBar bills four.** Hermes appears in the cost total, in the
provider breakdown, and in the ward's spike list, and has **zero representation as an agent**.
Sustained, not a one-day artifact — I measured Hermes at **$239.32 over 30 days** this afternoon.

This may be entirely correct as a product decision: a cron job is not an interactive session and
arguably should not occupy a row on a board about agents. **But it has a consequence nobody has
stated:** *"which agent cost this?"* is unanswerable for a fifth of the money, and the Usage tab
gives no hint that a whole provider has no counterpart on the board.

## The part that matters for the tier-3 check

The proposed board↔burnbar reconciliation joins **from the board side**, on `sourceSessionId`.
That join:

- **Cannot see Hermes at all** — there are no board rows to join from.
- Would report agreement while agreeing about 79.5% of the cost.
- **Cannot detect the failure it exists to catch.** Its purpose is finding spend the board does not
  know about. These twenty rows *are exactly that*, and the join's response is to drop them
  silently.

**So the one tier-3 check available has the same blind spot as the tier-1 checks it was supposed to
compensate for.** A left join from board to burnbar can only ever corroborate what the board
already has — which is the same reason `live + ended == tracked` cannot notice a missing collector.

**The fix is directional, and it is the whole value of the check:** run it as a **full outer join**
and treat *burnbar rows with no board counterpart* as **the finding, not the residue**. The line an
operator needs is not *"board and burnbar agree"* — it is *"$23.99 of spend in the last day belongs
to no agent this board can show you."* Configured that way it is the first check on this board that
could catch a collector failure. Configured as a left join it is decoration.

---

## Routed, both items

### 1. Collection cross-check — filesystem against collector output

Count transcript files on disk (`~/.claude/projects`, `~/.codex/sessions`) within the scan window
and assert against `totals.tracked`. **Genuinely independent** — filesystem versus collector — and
the first check that can fail when collection is wrong.

**Two things it must get right**, both learned today:
- **Scope it to the scan window.** The board tracks a 36-hour window by default; the disk holds
  everything. Comparing all files against `tracked` is the population error I made three times
  today, one layer out.
- **It will be tier 3 and non-vacuous from day one** — 625 sessions is a real number on both sides,
  so it discriminates immediately rather than passing at zero.

### 2. Board↔burnbar token reconciliation — with the join fixed

The bridge field the backend is landing makes the left-hand side constructible. **Two requirements
beyond the arithmetic:**

- **Reconcile the units first.** Compare burnbar's per-session sum against the board's
  **cache-inclusive per-call `total`** summed over the session — *not* `sessionTotal`, which
  deliberately excludes cache reads. Comparing the wrong pair produces a 2.6–16.9× ratio that looks
  like a defect and is a category error. I nearly filed it.
- **Full outer join, and report the unmatched side.** Per above. A per-session equality check over
  matched rows only is a tier-1 check wearing tier-3 clothes.

**Acceptance criterion for both:** the check must be able to fail when an agent is missing. If it
cannot, it is testing the same thing the partition identities already test.

## Limits

- **One 24-hour window**, twelve sub-windows, 222 rows. I did not test whether the cron/uuid split
  holds over 7 or 30 days, though the 30-day Hermes figure suggests it does.
- **I have not established that Hermes *should* have board rows.** The finding is that the join
  cannot see it and that a fifth of cost is unattributable — not that the product is wrong to model
  it this way.
- **The backend is mid-flight on `collectors.ts` and `types.ts`**, so the bridge field is not yet
  something I could test against. Everything here is measured against the current shape.
