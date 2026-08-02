# Render-first audit: the Usage tab

The last structural gap I named. Same inverted method as `b285652`: start from the pixels, ask
what a reasonable operator would **believe**, then check whether that belief is true. Ranked by
how badly a correct reading misleads.

**Measured on** branch `fix/backend-silent-failures-and-freshness`, worktree
`/Users/emilionunezgarcia/Developer/the-mountain-main`, HEAD `b285652` at start, 7 files dirty.
Board at `127.0.0.1:4701`, 1440×900, Usage tab open. Three Codex workers plus my own probes.

**Headline: the cost figure reads `not reported` while $11,961.21 of measured spend sits in the
data behind it.** That is the one you read to decide spend, so it leads.

---

## 1. `ESTIMATED COST: not reported` — suppressing $11,961.21 of measured cost

**Rendered:** `ESTIMATED COST / not reported / cost missing on some rows`.
**Belief induced:** *we don't know what this cost.*
**True?** No. Most of it is known, measured, and rendered two lines below.

Measured at four windows, using the `from`/`to` parameters the client actually sends:

| Window | Tokens | Calls | Headline | Measured cost present in the same payload |
|---|---:|---:|---|---:|
| 1h | 44,588,816 | 50 | `not reported` | **$28.37** |
| 24h | 135,648,447 | 147 | `not reported` | **$86.31** |
| 7d | 2,695,349,099 | 536 | `not reported` | **$2,909.43** |
| 30d | 26,226,805,893 | 2,984 | `not reported` | **$11,961.21** |

At 30 days the priced breakdown is fully populated and `costProvenance: "measured"` on every
row: Codex **$4,754.27**, Claude Code **$6,968.91**, Hermes **$237.39**, Factory **$0.65**.
Unpriced: Cursor alone — **28,440,100 of 26,226,805,893 tokens (0.108%)**, 45 of 2,984 calls
(1.51%).

**Mechanism.** `burnbar.ts:33` states it plainly: `costKnown` mirrors false *"as soon as any
invocation in the window has no [price]"*. One unpriced provider at a tenth of a percent
collapses the headline for the other 99.892%.

This is the honesty rule inverted into a falsehood. "Say when data is missing" became "say
nothing is known when anything is missing" — and the string is *literally true* (`cost missing on
some rows`) while the belief it creates is false.

**Named fix:** render the known total with its coverage — `$11,961.21 measured · 1.5% of calls
unpriced` — and reserve `not reported` for a window with no priced rows at all. `costKnown`
should gate a *qualifier*, never the *value*.

## 2. Every invocation age is wrong by the UTC offset

**Rendered:** newest rows show `2.2h ago`.
**Belief induced:** *the most recent activity was two hours ago; this table is stale.*
**True?** No. The top row started `2026-08-02 11:15:48.670` UTC and was **~12 minutes old** at
the time of reading.

**Mechanism.** OpenBurnBar stores `yyyy-MM-dd HH:mm:ss.SSS` as UTC text **without a zone marker**
(`burnbar.ts:421-429`); the endpoint passes it through unchanged (`:700-740`);
`text-formatters.js:17-21` hands it to `Date.parse`, which reads it as Amsterdam local time. On a
UTC+2 browser, `11:15` becomes `09:15Z` — every row ages by exactly the offset.

This is the `Elapsed 87.1d` class exactly: correct relative-time arithmetic applied to a
misparsed input. Unlike §1 it is a genuine *value* error, and it silently makes the newest data
look stale — the one thing that would stop an operator trusting the tab.

**Named fix:** normalise at the API boundary — emit ISO `…T…Z` for `startTime`/`endTime` — and
add a regression test that runs under a non-UTC `TZ` with the real SQLite timestamp form.

## 3. `BURN RATE 5.7M/h` is a range average wearing a rate's clothes

**Rendered:** `BURN RATE 5.7M/h / tokens per hour`.
**Belief induced:** *the swarm is currently burning 5.7M tokens an hour.*
**True?** No. It is `processedTokens ÷ (to − from)` (`burnbar.ts:559,584`) — the average across
whatever window is selected. Measured across the selector:

| Range | "tokens per hour" |
|---|---:|
| 1h | **45.1M/h** |
| 24h | **5.7M/h** |
| 7d | 16.0M/h |
| 30d | 36.4M/h |

Same label, four answers, an 8× swing between adjacent selector positions. An operator clicking
`1h` after `24h` sees the rate jump 8× and reasonably concludes burn exploded. Nothing did.

A second-order consequence the worker caught: a gap in collection contributes **time** to the
denominator but no tokens, so a partially-observed window silently reads as a *lower* rate rather
than an unknown one.

**Named fix:** label the window in the value — `24h average · 5.7M tokens/hour` — and withhold or
qualify the average when the requested interval is not fully covered by data.

## 4. The spike ward fires on anything new

**Rendered:** `Cursor / grok-4.5 · 3k/h vs baseline 0/h (new)`.
**Belief induced:** *Cursor usage has accelerated and needs attention.*
**True?** No. `3k/h` is a 24-hour average against the *preceding* 24-hour average, not a burst.
`(new)` means the provider/model series was absent from that one baseline window — not that a new
model appeared.

**Mechanism.** `burnbar.ts:816-848` sets the baseline window equal to the selected range;
`:870-879` fires any zero-baseline series exceeding **1,000 tokens/hour** and encodes the infinite
ratio as sentinel `999`; `app.js:6752-6762` renders that sentinel as `(new)`.

To be precise — and against my own initial guess — **not every first use fires**: the series must
be fully measured and clear 1,000 tok/h. But that floor is low enough that ordinary first activity
gets promoted into a ward with no evidence of harm. In a cockpit whose whole premise is silence
unless a human is needed, an alert that fires on "something started" is a wolf-cry.

**Named fix:** only call it a spike when a non-zero baseline exists and a ratio threshold is
crossed. Route first-seen series to quiet telemetry unless they breach an explicit token, cost or
quota policy.

## 5. `PROCESSED TOKENS 135.6M` — the right word, and unauditable

`PROCESSED` is the honest noun (contrast the board's `tokens`), and it is doing real work. But
the composition cannot be checked from this tab: the summary query **zeros the input/output/cache
components for every measured row** (`burnbar.ts:488-509`), using them only for fallback pricing.
The UI receives a gross total with no breakdown.

So an operator cannot tell whether 135.6M is mostly fresh content or mostly re-read context — the
exact question the 1.6B defect turned on. The worker correctly declined to assert the cache share,
and so do I.

**Also worth recording as a correction:** the same worker found `sessionTotal` has since been
**repaired to exclude cache reads** (`collectors.ts:664-676`). My earlier documents describe it as
cache-inclusive; that is now historical.

## 6. The price table, verified

I listed this as unverified. `config/models.json` carries `pricingVersion: 2026-07-28` and prices
**exactly one model** — `claude-opus-4-8` (`input 5, output 25, cacheRead 0.5, cacheCreation
6.25`). My `$0.50/M` cache-read floor from the BURN arithmetic is **confirmed correct** against
this project's own config.

But its coverage is narrow: 7 of 457 agents on the live board run `claude-opus-4-8`. The fleet
runs `claude-opus-4-7` (173), `gpt-5.6-sol` (158), `codex-auto-review` (71), `claude-opus-5` (11).

**Important qualification I got wrong first:** this does **not** mean 98.5% of cost is unpriced.
Measured costs bypass the table entirely (`burnbar.ts:214` — `measuredCostUsd` wins), which is why
Codex and Claude Code show real dollars. The table is only the *fallback* for rows without a
measured cost. Its one-model coverage means any such row is unpriceable — which is precisely how
Cursor ends up null and triggers §1.

---

## A near-miss worth recording

My first range test queried `?range=1h|24h|7d|30d` and got **identical** results at every range.
I was one step from publishing *"the range selector does nothing"* — a catastrophic false finding.

Check 4 of the standing rule caught it: *state what the command returns if the claim is false.*
If the selector worked but my parameter name were wrong, I would see **identical results** — which
is exactly what I saw. The test could not distinguish the two hypotheses. The client sends
`from`/`to` (`app.js:6553`), the server reads `from`/`to` (`burnbar.ts:400-401`), and `range` is
ignored.

Retested correctly, the selector is **sound**: monotonic and sensible across all four windows.
That is the second time in two days the rule has caught me before publication, and both times the
trap was a check that returned the same signal under both hypotheses.

---

## Caveats

- **Every figure names its read**; the tab was measured over ~20 minutes while the fleet was
  active, so token counts differ between sections.
- **§5 deliberately does not claim a cache share** for `PROCESSED TOKENS`. The components are
  zeroed before they reach the API, so it is not auditable from this surface.
- **§2's timezone finding is a worker's measurement** which I did not independently reproduce in
  the browser; I confirmed the mechanism in source (`burnbar.ts:421-429`,
  `text-formatters.js:17-21`) but not the rendered offset.
- **The SERIES chart's bucket span** is only partly audited — I have the endpoint's `bucket`
  parameter (`1h` under 48h, `1d` above) but did not verify the rendered x-axis against
  `from`→`to`, which is the sparkline defect's exact shape and remains open.
