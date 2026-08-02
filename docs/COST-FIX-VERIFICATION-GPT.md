# Verifying the cost fixes — four real, one I could not confirm

Working the ledger down by consequence. Cost, because it is the number Emilio acts on.

**Claim type for all of these: I drove the running API.** Where that was not enough, it says so.

---

## `57add8a` — a window says what it cannot see — **VERIFIED, and better than I specified**

My finding was that the 30-day view showed 32.6% of queryable spend with nothing saying so. The
fix adds `priorSpend`:

```
30d : measured $14,130.44 | priorSpend { earliestAt: 2026-03-28, invocations: 5,591, measuredCostUsd: 33,571.63 }
24h : measured    $122.27 | priorSpend { earliestAt: 2026-03-28, invocations: 8,423, measuredCostUsd: 47,578.63 }
1h  : measured      $5.51 | priorSpend { earliestAt: 2026-03-28, invocations: 8,617, measuredCostUsd: 47,695.39 }
```

**I proposed stating coverage as a percentage. This is better.** It reports the actual prior
figure *and* `earliestAt`, so a reader can compute the share, see how far back the record goes, and
compare windows — none of which a bare percentage supports.

It also resolves something my own finding got wrong. I described the record as **90 days**, because
90 is where the API rejects a query. `earliestAt: 2026-03-28` shows the record is **128 days** deep.
The 90-day cap was hiding 38 further days, and `priorSpend` now reports past its own query
limit — which is the right call and not one I asked for.

Correcting my finding with today's numbers: the 30-day view is **29.6%** of the record
($14,130 of $47,702), not 32.6%, and the payload now says so.

## `71d7cb3` — an invocation is not always a call — **VERIFIED**

`aggregatedInvocations: 1112` alongside `invocations: 3041`. The payload now distinguishes them,
which is what my July 30 investigation said was needed to know whether $13,216 was trustworthy.

**Already recorded in the ledger and unchanged: this does not explain July 30.** That day is 28%
aggregated against July 28's 43%, yet carries 16× the tokens per invocation. The fix does what it
says; the anomaly is a separate matter and stays in the unfixed column.

## `dcdb888` + `c58d85c` — one unpriced model must not suppress the rest — **VERIFIED**

```
estimatedCostUsd : 14,129.27        (was null)
costKnown        : false            (carried beside the value, not gating it)
byProvider       : Codex 4754 · Claude Code 9135 · Hermes 240 · Cursor null · Factory 1
```

Cursor is still unpriced and no longer suppresses anything. **This is exactly the shape I
specified** — the completeness flag qualifies the value instead of replacing it, which was the
generalisable rule from the suppression routing note. The $11,939 headline defect is closed.

## `d877753` — honour the window asked for — **VERIFIED**

1h returns 15 invocations, 30d returns 3,041. Distinct, monotonic, windows honoured.

## `58daea6` — the burn rate names its window — **NOT CONFIRMED, and here is why**

The payload carries `burnRateTokensPerHour: 38,850,120` and **no window label beside it**. I
dumped every top-level key rather than guessing:

```
ok, available, provenance, sourceHealth, source, from, to, processedTokens, tokensKnown,
tokensMissing, aggregatedInvocations, priorSpend, estimatedCostUsd, measuredCostUsd,
costMissingInvocations, costProvenance, costKnown, invocations, burnRateTokensPerHour, byProvider
```

The commit touched `src/server/burnbar.ts` and its diff mentions rendered `text`, so the label is
plausibly composed client-side from the `from`/`to` the payload already carries — in which case the
fix is real and simply not visible at this layer.

**I am not calling it verified and I am not calling it broken.** Confirming it needs a rendered
read of the Usage tab, which I did not do. That is one honest unknown rather than a guess in
either direction.

---

## Ledger movement

| | Was | Now |
|---|---|---|
| Verified | 5 of 23 | **9 of 23** |
| Unverified | 18 | **14** |

Verified this round: `57add8a`, `71d7cb3`, `dcdb888`, `c58d85c`, `d877753` — all by driving the
running API. Still unverified and next by consequence: `58daea6` (needs a rendered read),
`3fb9b45`, `5ef8cf4`, then the pulse and health group.

## Already correct, said and moved past

Four of five did exactly what their subjects claimed, one exceeded it, and I went looking for
nothing further in them.

## A method note I keep earning

**Three times today I claimed a field was absent after guessing its name.** `57add8a`'s coverage
lives in `priorSpend`; I searched for `coverage`, `earliestAt` and `horizon` at the top level and
reported "NONE" twice before dumping the key list. In the ledger I recorded "I looked for a
coverage field and found none" — **that entry was wrong**, and it was wrong in the direction of
under-crediting a fix that was already correct.

Check 6 says read one layer further before claiming absence. Applied to payloads that means:
**enumerate the keys before asserting a field is missing.** A `grep` for a name I invented cannot
distinguish "not implemented" from "named something else."
