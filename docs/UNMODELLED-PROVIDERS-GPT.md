# Spend with no representation — what modelling Hermes takes, and why disclosure comes first

**It is two providers, not one, and the board does not merely omit them — it positively asserts
that nothing is missing.** That makes disclosure the urgent half and modelling the considered half.

---

## The board claims completeness, and the claim is false

```json
sourceHealth: { "healthy": 4, "degraded": 0, "absent": 0, "total": 4,
                "byProvider": { "omp", "codex", "claude", "cursor" } }
```

**`absent: 0`.** There is a field named for exactly this condition, reporting zero, while two
billed providers have no collector at all:

```
burnbar bills : Codex · Claude Code · Hermes · Cursor · Factory
board models  : claude · codex · cursor
never modelled: Hermes ($23.99/24h, $237.39/30d) · Factory ($0.65/30d)
```

**The denominator is the collectors that exist, so a missing collector cannot be counted.** That is
the same population error as every other one today — the wrong denominator — this time encoded in
the product's own health reporting. `omp` is in the denominator and produced zero agents; Hermes is
not in it and produced 20.5% of yesterday's cost.

**So this is worse than silent omission.** Silence would leave a reader uncertain. *"4 of 4
collectors healthy, 0 absent"* tells them the picture is complete.

## What modelling Hermes actually takes — and the trap in the obvious version

`~/.hermes/sessions/` exists and holds **184 `.jsonl` files**, the same shape `parseClaudeJsonl`
and `parseCodexJsonl` already consume. So the obvious move is a fourth `collectProvider(...)` line
pointed at it, a day's work on an established template.

**It would collect none of the money.**

```
~/.hermes/sessions/  184 files · 0 modified in the last 7 days   ← dormant
~/.hermes/cron/      jobs.json · output · ticker_heartbeat · ticker_last_success
```

**The $23.99 is `cron_daily-watcher-001`, and cron does not write to `sessions/`.** A collector
following the existing pattern would ingest 184 dormant interactive sessions and zero of the spend
in question. The natural implementation misses the thing entirely — the population error again, one
layer out: **the spend is in `cron/`, not `sessions/`.**

So the work is three separable pieces, not one:

1. **A `hermes` collector for `~/.hermes/sessions`** — cheap, templated, and *does not address the
   finding*. Worth doing on its own merits if Hermes is ever used interactively again; do not let
   it be mistaken for the fix.
2. **Scheduled work as a modelled thing.** `~/.hermes/cron/` is a different shape and a different
   category. **This is a product question before it is an engineering one:** the board's entire
   model is *an agent is a session with a transcript*, and cron work has no transcript, no pane, no
   controls, nothing to Focus or Send to. It cannot be an agent row without changing what a row
   means.
3. **Factory** — same class, unexamined. I did not check whether it has a session store.

**My recommendation on (2):** do not force it into an agent row. A cron job that cannot receive a
message does not belong in a queue of things that can. **Model it as what it is — a spending
source with no session** — and put it where cost lives rather than where agents live.

## The honest interim, and it is not a compromise

**Disclose it, and the machinery already exists four times over.** `tokensMissing` beside the token
sum, `costKnown` beside the cost, `priorSpend` beside the window, `completionsProvenance` beside
the absent counter. This is the same move, applied to a provider instead of a value:

> **Usage includes providers this board does not model.** Hermes ($23.99 in the last 24h) and
> Factory have no agents here; their spend is counted in the totals and belongs to no row you can
> open.

Two days of this project's own reasoning say a view that cannot show everything must say what it
cannot see. **This is the largest instance of that rule anyone has found — an entire provider — and
it is the one place the rule was never applied**, because everywhere else the gap was a *value*
and here it is a *category*.

## The fix that generalises beyond Hermes

**`sourceHealth` should compute its denominator from providers observed in usage, not from
collectors configured in code.** Then:

- `absent` becomes a real number instead of a structural zero
- the health line can *fail*, which today it cannot
- and the next provider added to the fleet announces itself instead of quietly costing money

That is one query — the distinct providers in the burnbar window — against the collector list the
code already has. **It converts the health check from tier 1 to tier 3**, because the denominator
would come from a different source than the numerator. It would be the second correspondence check
on this board, and unlike the token reconciliation it is not blocked on a unit question.

## Ranked, for dispatch

| | What | Why this order |
|---|---|---|
| **1** | Disclose the unmodelled providers on the Usage surface | The board currently asserts completeness; that is the falsehood, and it is one sentence |
| **2** | `sourceHealth` denominator from observed providers | Makes `absent` real, converts the check to tier 3, prevents recurrence |
| **3** | Decide what a non-session spender *is* on this board | Product question; blocks any modelling work |
| **4** | `hermes` collector for `sessions/` | Cheap and templated — but does not address the money, so it must not close this item |

## Limits

- **I did not characterise `~/.hermes/cron/output`**, so I cannot say how hard the cron path is to
  collect, only that it is not `sessions/`.
- **Factory is unexamined** beyond its presence in the billing list and on disk.
- **All figures are one 24-hour window** plus the 30-day provider totals measured this afternoon.
- **Whether Hermes *should* be modelled is not mine to decide.** I am confident about the
  disclosure and about `absent: 0` being wrong; the modelling recommendation is a suggestion with
  reasoning, not a finding.
