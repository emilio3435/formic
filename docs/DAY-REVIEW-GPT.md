# Adversarial review of the day

**Subject.** 58 commits in ~30 hours across health, the drawer, the attention layer, the
summary band, collectors and the burnbar — almost all reviewed only by the lane that wrote it,
or by me. This reviews the **day**, not a change: what got worse, what the condensation cost,
whether the honesty rules ate the board, and whether the fixes compose.

**Method.** Four Codex workers at high effort plus my own measurement, all against the
**rendered board** at `127.0.0.1:4701` with `/api/snapshot` as the truth to compare pixels
against. The board is live and moved during the review; every number names its read.

**Headline.** Individually the day was good — several of my own earlier critiques landed and
the attention layer in particular went from 0 real detections to 6–8 correct ones. But the
lanes composed badly in one specific way, and it is the single most serious finding here:
**the day added server-side intelligence that the client systematically does not consume.**

---

## Credit, because most of this day was right

- **The attention layer genuinely works now.** `handoff-stated` landed (my §4 recommendation)
  and fires on exactly the cases I proved were missed yesterday: *"publishing is your call"*,
  *"that's left to you"*, *"just say the word"*. `question-pending` now catches *"Which would
  help?"* and *"Want me to write…"*. The marker-spoofing false positives are gone —
  `fc72cd1 feat(attention): read the transcripts, and stop trusting text agents author` fixed
  the class rather than escaping it. Detection went from **0 true positives to 6**.
- **The honesty rule has NOT eaten the board.** Measured: **2 absence strings against 31
  number-bearing cells**, roughly 1:15. Burn correctly renders `417k/min` without inventing
  `$0`. The answer to that question is simply *no* — one casualty aside (§3).
- **`pulseStripModel`'s "a cell with nothing to report does not render"** convention closed four
  separate findings from the previous audit with one rule.

---

## 1. The day's flagship feature never reaches the operator

**Evidence.** The backend computes `attentionSignal` per agent, each carrying a `kind`,
quoted `evidence`, and a `nextAction`. In one atomic payload read:

```
agents with attentionSignal : 6
issues[]                    : 2
totals.attention            : 1
```

Rendered simultaneously on screen: the `Needs you` tab reads **1** and renders **1 row**; the
summary rail reads **2 findings**. A worker's synchronized read caught a worse moment — **8
actionable signals in the payload while the board rendered `All clear` and `Needs you 0`.**

**The cause is a one-line omission.** `grep -rn attentionSignal src/web/` returns **nothing**.
The client never reads the field. `alerting()` (`agent-model.js:150`) gates on
`deriveOutcome(agent) === "healthy"` — and an agent that simply asks the operator a question is
`outcome: healthy`, so it is excluded from every attention surface: the tab, the title badge,
the notifier, and the program alert cell.

**Why this is the worst finding of the day.** The single most valuable capability shipped —
knowing *which agents are waiting on a human and why* — is computed correctly, shipped on the
wire, and thrown away at the last step. An operator watching this board is told 1 while 6 agents
wait. This is precisely the false-negative direction I argued was dangerous, reintroduced one
layer higher: the detector was fixed and the surface was not.

**Fix.** Emit one canonical `operatorAttentionItems` (or `needsHumanAgentIds`) derived from
`attentionSignal`, and bind the tab, title, notifier and rollup cell to that one collection.
Keep system issues in separate vocabulary — `2 system findings` — rather than folding two
different populations into one word.

---

## 2. Server and client have drifted into two independent derivations of the same board

§1 is not an isolated slip. It is the visible instance of a systemic split that the day widened:
backend lanes shipped new authoritative fields while frontend lanes kept computing their own.

| Field | Computed at | Client reads it? | Consequence |
|---|---|---|---|
| `attentionSignal`, `attentionCoverage` | `snapshot.ts:85,152,277` | **No** | §1 — the whole feature is invisible |
| `pulse.momentum.stalledAgentIds`, `stallThresholdMs` | `pulse.ts:172` | **No** | Calm renderer reads neither; `15m+` is hardcoded in the UI |
| `AgentSnapshot.contextPct` | `snapshot-agent.ts:153` | **No** — row recomputes via `contextUsage()` | **340 agents** carry an unused value; the client accepts only latest-turn scope, so it can suppress a reading the server considers authoritative |
| `ProgramSnapshot.rollup` | `snapshot-programs.ts:45` | **No** — headers call `deriveRollup` | ~11.8 KB/payload shipped unused; two competing predicates |
| `modelConfig.displayLabels` | `snapshot.ts:270` | **No** — client hardcodes normalization | Config-owned labels can drift from pixels |
| `threadDepth`, `subagentCount` | `snapshot.ts:168` | **No** — lineage rebuilt from `parentAgentId` | Two competing swarm-depth models |
| `totals.ended`, `totals.attention`, `totals.needsYou` | `snapshot.ts:289` | **No** | These are exactly the competing count domains that disagree in §1 |
| `lastAgentClosing` | `snapshot.ts:159,172` | **No** | ~30 KB of transcript text shipped to the browser with no surface |
| Collector internals — `runtimeSessionId`, `processAlive`, `processIds`, `recordedTarget`, `transcriptEndedCleanly`, `transcriptOpen` | leaked by `...source` at `snapshot.ts:140` | **No** | **Not even declared on `AgentSnapshot`** — the wire accidentally exposes collector inputs already condensed into `processState`/`target` |

Measured payload: **1.326 MB**.

**Why it matters beyond waste.** Every duplicated derivation is a place the two halves can
disagree, and §1 proves they already do. The day's pattern — backend lane computes a better
answer, frontend lane keeps its own — means each new backend improvement lands inert.

**Fix.** Introduce an explicit wire DTO projection instead of `...source`, and adopt one rule:
*if the server computes it, the client renders it; if the client derives it, the server does not
ship it.* Pick per field, then delete the loser.

---

## 3. Two honesty strings are covering plumbing gaps

The rule is right; these two instances invert it.

**3.1 "No completion data yet" while completions exist.** The rail renders that sentence while
`pulse.momentum.completionsLastHour` is **2**. The entire sentence is gated on
`observedWindowMs > 0` (`app.js:692-706`), so a tracker that restarted reports *nothing known*
rather than *this much known, rate not yet established*. Principled language stating something
false.
**Fix.** `2 completions observed since restart · rate window not established`. Reserve
"No completion data" for an absent count.

**3.2 The lookback is now disclosed nowhere.** `History` reads **6** while the payload holds
**357** ended agents — correct behaviour (the 6-hour lookback), but the scope note that used to
say so is gone, so 351 sessions vanish with no indication they are being filtered.

**I contributed to this one.** My cockpit audit §8 argued the scope line
(`0 shown · 18 live · 310 tracked`) restated the tabs and should render nothing when no filter
is active. That was right about the counts and wrong about the lookback: the line was also the
only place the filter was disclosed. Removing it made the tabs *less* honest.
**Fix.** `History 6 · 6h` in the tab, or keep the scope note whenever any displayed count is
filtered — which is always true for History and Idle.

---

## 4. Smaller findings worth queueing

| # | Finding | Evidence | Fix |
|---|---|---|---|
| 4 | Context coverage uses the wrong population | The coverage ratio labels `totals.tokenReporting/tokenEligible` (working **token** reports) as **context** coverage (`app.js:759-767`) | Ship `contextReporting/contextEligible` from the same live population as `contextPeak` |
| 5 | Program rollup `1.15B tokens` is not comparable to row figures | Cell sums cumulative `sessionTotal` across all agents including ended; rows show latest-call | Rename to `session tokens` and expose the population, or use the live/latest-call metric |
| 6 | Stalls still cannot break calm | `stalledAgentIds` orphaned (§2); yesterday's ladder showed all-live-stalled keeps `calm: true` | Put `stalled` in the calm predicate, or rename the verdict |

---

## 5. Answering the four questions directly

1. **Do the fixes interact badly?** Yes, and it is the day's main defect — §1 and §2. Each lane's
   change is correct in isolation; the composition drops the best new capability on the floor.
2. **Did condensation remove information an operator needs?** Mostly no. One real loss: the
   lookback disclosure (§3.2), which I helped cause. Spend remains absent from the calm line,
   carried over from yesterday.
3. **Are the honesty rules over-applied?** **No** — 2 absence strings to 31 factual cells. The
   rule is working; two instances (§3) are misapplied, and both are plumbing gaps in principled
   clothing rather than excessive scruple.
4. **What regressed outright?** Nothing I could prove regressed from working to broken. The
   `History 6` scare is the lookback behaving correctly with its explanation deleted.

---

## 6. Where this review could be wrong

- **The board moved throughout.** Reads ranged 362 → 366 → 376 agents; the signal count ranged
  6 → 8. Ratios were stable across reads; single values name their timestamp.
- **§1's severity assumes those 6 signals are correct.** I spot-checked the evidence strings and
  they read as genuine operator-blocking asks, but I did not verify all six against their
  transcripts as I did yesterday for the false-negative work.
- **§2's "client reads it?" column is a grep over `src/web/`.** A field consumed through
  dynamic property access or a re-exported alias would be misreported as orphaned.
- **The 1.326 MB payload figure is one measurement** at one fleet size (376 agents) and scales
  with history retention, not a fixed cost.
