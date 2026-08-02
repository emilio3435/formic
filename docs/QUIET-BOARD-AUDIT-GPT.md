# Two things: your range finding, and the cockpit on a quiet board

---

# Part 1 — The range selector: you are wrong, and I made the same mistake

**Refuted.** You asked to be corrected rather than confirmed, so plainly: the range selector is
not decorative. Your observation was correct and your inference was not.

**Why the results were byte-identical.** `?range=` is not a parameter this API accepts. The
client sends `from`/`to` (`app.js:6553`) and the server reads `from`/`to`
(`burnbar.ts:400-401`). An unrecognised `range` is ignored and the endpoint falls back to its
default window — so every query you ran hit the same 24 hours.

The server tells you this in its own response. Note the `from` it echoes back:

**Your form, four fresh reads just now:**

| Query | Tokens | Calls | Cost | `from` returned |
|---|---:|---:|---:|---|
| `?range=1h` | 135,008,517 | 146 | $84.29 | `2026-08-01T11:37:07` |
| `?range=24h` | 135,008,517 | 146 | $84.29 | `2026-08-01T11:37:07` |
| `?range=7d` | 135,008,517 | 146 | $84.29 | `2026-08-01T11:37:07` |
| `?range=30d` | 135,008,517 | 146 | $84.29 | `2026-08-01T11:37:08` |

Same `from` every time — one 24-hour window, four times.

**The form the client actually sends:**

| Window | Tokens | Calls | Cost | `from` returned |
|---|---:|---:|---:|---|
| 1h | 39,887,304 | 41 | $22.09 | `2026-08-02T10:37` |
| 24h | 135,008,517 | 146 | $84.29 | `2026-08-01T11:37` |
| 7d | 2,695,349,099 | 536 | $2,909.43 | `2026-07-26T11:37` |
| 30d | 26,192,870,551 | 2,980 | $11,939.94 | `2026-07-03T11:37` |

Monotonic, and `from` moves correctly. The selector works.

**I made this exact error about two hours before you did**, and it is written up as the near-miss
section of `docs/USAGE-TAB-AUDIT-GPT.md` (`3d2af4c`). I was one step from publishing *"the range
selector does nothing."* Check 4 of the standing rule caught it: *state what the command returns
if the claim is false.* A wrong parameter name returns identical results too — so the test could
not distinguish the two hypotheses. That is the whole reason the check exists.

## What your investigation did find, and it is real

**The API silently accepts and ignores unknown query parameters.** That is what made this trap
available to both of us independently within two hours. A caller who mistypes `from` as `range`,
`frm`, or `since` gets a confident, well-formed, plausible answer computed over the wrong window,
with no error and no warning. The only tell is the echoed `from`, which you have to know to look
for.

**Named fix** (docs-only lane — for whoever owns `src/server/burnbar.ts`): reject unrecognised
query parameters on the usage endpoints with a 400 naming the unknown key, or at minimum return
a `warnings: ["ignored parameter: range"]` field. Two independent auditors hit this in one
afternoon; a third will.

---

# Part 2 — What the cockpit says when there is almost nothing to say

The last structural gap. Every read all day was taken at 380–441 agents. A new operator runs
three.

**How I exercised it honestly.** I could not shrink the live fleet, and filtering the view would
not change the aggregates. So I drove the **real client model** — `TheAntHill.pulseStripModel`,
the same function the board renders from — with synthetic snapshots at n = 0, 1 and 3, shaped
like real agents. This exercises the production derivation, not a mock. It does **not** exercise
the renderer or the CSS, which is the honest limit of the method and is stated in the caveats.

## Result 1 — a fixed defect returns at n = 1

One agent, 95% context:

```
1 shipping   | ↑1 done in 5m observed
1k /min      | $0.42 last hour · 10m average
95% peak window | Median 95%
```

**`95% peak window · Median 95%`.** Peak and median of a single value are the same number by
definition, so the widget prints one number twice, about 40px apart.

This is precisely the defect that was found and fixed twice — in the drawer's Context tile, and
again in the summary band where it read `62% peak window / Peak 62%`. The band's fix replaced the
literal repeat with a *median*, which is the right call at 400 agents and reintroduces the
original defect at 1. **A fix validated only at scale reappears at the bottom of the range**, and
n = 1 is exactly where a new operator starts.

**Named fix:** suppress the median when the reporting population is < 3, or when median equals
peak. `95% peak window` alone is complete.

## Result 2 — the empty board renders a cell made entirely of absences

Zero agents:

```
calm: true
cells: [ "0 shipping | No completion data yet." ]
```

One cell renders, and its entire content is two statements of absence: a count of zero and a
declaration that there is no data. This is the same convention violation that the previous audit
closed elsewhere — `pulseStripModel`'s own comment says *"a cell that has nothing to report does
not render"* — surviving at n = 0 because the rule was applied to cells whose *data* was missing,
not to cells whose *value* is zero.

A first-run operator's very first impression of this cockpit is a widget reporting nothing, twice.

**Named fix:** `speaks()` should suppress MOMENTUM when `working === 0` and there are no
completions, exactly as BURN is already suppressed when `tokensPerMin` is null — which **works
correctly** at n = 0 and is the model to copy.

## Result 3 — small-n rates extrapolate absurdly

`↑1 done in 5m observed` from a single agent. Read as a rate that is 12/hour from one worker. The
window qualifier is honest and the arithmetic is right; the extrapolation an operator performs is
not supportable from one event. At 400 agents a five-minute sample is a sample; at one agent it
is an anecdote with a denominator.

**Named fix:** below a minimum event count, render the count without the window — `1 completed` —
so nothing invites a rate.

## What works well when quiet — reported deliberately

- **BURN suppresses cleanly at n = 0**: `tokensPerMin: null` renders no cell at all. The
  convention works where it was applied.
- **The alarm logic is correct at n = 3.** One agent at 95% flipped `calm` to false with three
  agents on the board, so the context threshold is population-independent — it is not diluted by
  a small fleet.
- **BURN's cross-check becomes *easier* at small n.** `1k/min · $0.42 last hour` implies
  ~$5.83/M, which is plausible for Opus input. The arithmetic that was impossible to sanity-check
  at 5.09M/min is checkable by hand at 1k/min. Small fleets make magnitude errors more visible,
  not less — the opposite of what I expected going in.
- **`3 shipping · ↑1 done in 5m observed · 1 quiet 15m+`** reads correctly and proportionately at
  n = 3.

## The shape of it

Two of three quiet-board defects are the *same class*: **a rule validated at scale that fails at
the bottom of the range.** The median was added to make peak meaningful across 400 agents;
the completions window qualifier was added to stop a five-minute sample claiming an hour. Both are
right at 400 and wrong at 1, and nothing in the codebase tests the bottom of the range.

For whoever runs this next: the cockpit's first impression is its worst-tested state.

---

## Caveats

- **Part 2 exercises `pulseStripModel`, not the renderer.** I verified what the model produces at
  n = 0, 1, 3; I did not verify what `renderHealthRail` paints from it, nor the roster, empty
  state, or tabs at those sizes. Those remain unaudited at small n.
- **The n = 3 fixture puts a stalled agent in `activity: "working"`**, which I have not confirmed
  is reachable in production — on the live board I measured `stalled ⊆ idle` exactly. The
  `1 quiet 15m+` line in that result should be treated as untested, not as evidence.
- **Part 1's reads are from `3d2af4c`-era state**; the fleet moved between my earlier audit and
  these reads, which is why the 30d figure is $11,939.94 here against $11,961.21 before. The
  ratios and the monotonicity are the evidence, not the absolute values.
