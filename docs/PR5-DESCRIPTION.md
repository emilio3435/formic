# Cost, custody and the write path: report what we measured, and refuse what we cannot prove

*Replacement body for PR #5. The PR was opened on the cost theme and has grown
to 32 commits across 43 files; the original description covers roughly a third
of it, which is the same defect the cost work is about.*

---

Three things this branch does, only one of which the original description
mentioned.

1. **Cost stops hiding money** — two defects fixed, one anomaly annotated and still open.
2. **The archive keeps what you asked it to keep** — retention ran from the wrong clock and silently under-delivered.
3. **The board never advertises a write it will refuse** — the button and the endpoint now answer from one predicate.

Underneath all three: a verification ledger, physical bounds the suite can
assert, and a documentation pass that says what each surface cannot show.

---

## 1. Cost

### The measured total was suppressed by 1.4% of calls

`costKnown` was set false the moment *any* invocation in a window lacked a
price. Cursor — 45 unpriced calls out of 2,980 — suppressed the figure for Codex,
Claude Code, Hermes and Factory together, so the card read **"not reported"**
while the payload carried five figures of measured spend.

The same file already did tokens correctly ten lines away: `tokensKnown` is
emitted as a **qualifier beside** the value, not a **gate on** it. Cost now
follows that precedent.

### An "invocation" was not always a call — open, not closed

One day held 26% of the headline: $3,514.24 across 58 invocations — **$59.91
each** against a fleet norm of $0.32–$1.93. A physical check settled it: each
would have had to process 47.6M tokens against a 1M-token context window.

Seven rows carry 243M–512M tokens apiece, and their session IDs are this board's
own agents. The leading explanation is that BurnBar records some Claude Code
sessions as one cumulative row per session alongside per-call rows from other
providers.

**Explained, not yet fixed.** The cause is now known: OpenBurnBar — a separate
application — writes some rows as **cumulative snapshots of a session** rather
than as records of a single call. A later snapshot already contains the earlier
one, so summing them counts the same tokens twice. Observable directly in the
invocations feed: one session appears at 164,393,131 tokens and again at
161,067,393, the second contained in the first.

`71d7cb3` annotated this and changed no total, and its `aggregatedRows`
classification is circular — a row counts as aggregated because `totalTokens`
exceeds the context-window bound, which is the same observation that made it
anomalous. Useful as a flag; not a correction.

The backend is implementing **per-session de-duplication**. Because the defect
is double-counting, **the corrected totals are expected to fall, not grow.**

**No cost figure in this branch should be read as final**, and none is quoted
here as a corrected one. What this branch changed is that the measured total is
*reported* rather than suppressed, and its horizon is *disclosed* rather than
implied. The arithmetic inside that total is a separate fix, in progress.

### A view that cannot show everything now says what it cannot see

The UI's widest preset is 30 days; **Custom** reaches 90; the store holds more
than either. `priorSpend { earliestAt, invocations, measuredCostUsd }` now rides
on every summary, so a window can state what sits before its own horizon.

Measured live against `/api/usage/summary`, 2026-08-02. **These are recorded
figures taken before per-session de-duplication lands, so every one of them is
expected to fall** — they are quoted to show the horizon gap, which is
structural and does not depend on their magnitude:

| window | inside | before it | earliest record |
|---|---:|---:|---|
| 30d | $14,130.44 | **$33,571.63** | 2026-03-28 |
| 60d | $32,593.49 | $11,208.92 | 2026-03-28 |
| 90d | $41,400.11 | $2,402.29 | 2026-03-28 |

**Correction to the original description.** It reported "roughly $24,000 of
queryable spend sits outside the widest view", derived as 90d − 30d. That treats
the 90-day *query cap* as if it were the record. The record reaches back 127
days, so the spend outside a 30-day view is materially larger than the body
claimed — measured at the time of writing, roughly $9,000 more, though every
figure here moves once de-duplication lands.
The old description made, about itself, precisely the error the PR was opened to
fix: it mistook the widest window it could ask for as everything there was.

Note the last row: even at 90 days, $2,402.29 remains outside. There is no
window in this product that shows the whole record.

---

## 2. Archive custody *(absent from the original description)*

**This is a data-loss fix and it was not mentioned at all.**

Retention was measured from the agent's **last activity**, not from the moment
the operator archived it, and nothing recorded when custody was taken. Delivered
retention was therefore 30 days *minus however stale the session already was*:

| you archive a session last active… | you actually kept it |
|---|---|
| today | 30 days |
| 20 days ago | 10 days |
| 31+ days ago | **pruned on the next save** |

The last row returns `ok` and the record can be gone before the operator looks
again, while the board reports `retentionDays: 30` from a constant that cannot
observe what was delivered.

Now: `archivedAt` is recorded, retention runs from custody, and the figure the
board reports is measured rather than asserted. The fix is **forward-only** by
construction — records stored before it have no stamp and fall back to the old
clock — which the guide states rather than letting "fixed" imply otherwise.

`src/server/archive.ts`, `tests/delivered-retention.test.ts`,
`docs/RETENTION-INTERACTIONS-GPT.md`.

---

## 3. The write path *(absent from the original description)*

**This branch changes what the product will do to a terminal on your behalf.**

The board offered `instruct` on an agent whose process was known dead while the
endpoint refused the same agent with 409. Nothing unsafe shipped — the endpoint
held — but a control the system will refuse is a promise the board should never
have made, and the two had already drifted apart twice.

Both now answer from **one predicate**. A write is authorised only when the
target is attested *now* (not remembered), the process is not known dead, and
the routing evidence is fresh. `Focus` is deliberately exempt: it types nothing,
and going to look at the pane is how an operator recovers.

`src/server/control.ts`, `targets.ts`, `snapshot-agent.ts`,
`tests/button-endpoint-agreement.test.ts`,
`tests/control-advertisement-invariant.test.ts`.

---

## 4. Bounds, ledger and docs *(absent from the original description)*

**Physical bounds as assertable limits.** Ten bounds derived from two constants
— a 1M-token context window and a price vector from $0.50/M cache-read to $25/M
output — handed to the suite. The reusable lesson is per-unit, not aggregate:

> A cost-per-day ceiling would not have caught the anomaly. The physical ceiling
> for a five-lane fleet is ~$45,000/day and the anomalous day was $3,514 — 7.8%
> of it. Only cost-per-invocation caught it. **Divide before you compare:** a
> total inherits the slack of every unit in it, while a per-unit figure must
> answer to a physical limit alone.

**A verification ledger.** Eleven audit documents recording, per fix, whether it
was verified against the running product, exercised against the code, or merely
landed — and what would settle the ones still open. `tests/policy-verifiability.test.ts`
enforces the discipline: a published policy must record what would verify it.

**Documentation.** `ANT-GUIDE.md` (+140), `QUICKSTART.md`, `README.md` and
`tests/reference-docs.test.ts` (+301). The three write-path refusals written as
guarantees rather than limitations; the cost window's ceilings and what lies
past them; the archive warning above; the collector count explained as
*collectors that can see, not tools installed*; and a first-run walk from a
virgin clone that found a newcomer's very first screen announcing itself
degraded on a supported configuration. Doc claims are pinned to the code that
produces them, so a rename fails the suite rather than quietly outdating a
paragraph.

**Also here:** burn-rate denominator (`tests/burn-rate-denominator.test.ts`),
snooze bounds (`tests/snooze-bounds.test.ts`), partial-period bars drawn at full
height, and a compose fix where a spinner frame was being read as a name.

---

## Scope note

This PR outgrew its title. It is coherent — every part is the same rule applied
to a different surface, *say what you measured and refuse what you cannot prove*
— but a reviewer expecting only cost will find a data-loss fix and a change to
terminal-write authorisation. Splitting §2 and §3 into their own PRs is
defensible; keeping them together is defensible too, since the write-path
invariant and the cost honesty rule share a test file and a vocabulary. Reviewer's
call, but it should be a call, not a surprise.

**43 files, 32 commits, 21 new. `tsc` clean, 1367 tests green** (the original
description said 1261) — measured at `fc0d047`; the branch is still moving, so
treat these as a reading, not a constant.
