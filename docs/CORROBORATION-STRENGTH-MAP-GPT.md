# The corroboration map, graded by strength — including a regrade of my own

You asked me to carry the grading into the map, because *a board full of same-source agreement
would look thoroughly cross-checked and be exactly as blind as one with none.*

**Applying that to my own identities is the finding: eleven of thirteen are tier 1, and no tier-1
identity has ever caught anything.** The two that found real defects are both tier 2.

---

## The three tiers, stated so they can be assigned

| Tier | Definition | Catches | Blind to |
|---|---|---|---|
| **3 — independent** | two different inputs, two code paths, converging | most things | shared upstream assumptions |
| **2 — same source, different derivation** | one store, genuinely different computation | **aggregation errors** | a wrong store |
| **1 — same source, same derivation** | partition or subset of one object | arithmetic slips | **collection errors — everything upstream** |
| **0 — none** | no sibling exists | nothing | everything |

**Tier 1 is the trap.** If the collector drops a hundred agents, `live + ended == tracked` still
passes, `working + idle == live` still passes, every `attentionCoverage` part still sums. The board
looks internally perfect and is describing a fleet that is not there.

## Regrading my own identities

| Identity | Tier | Ever caught anything? |
|---|---|---|
| **I1** `window + prior = constant` | **2** — disjoint row sets, different code paths | **yes — the dedup defect** |
| **I3** `Σ byProvider == measuredCostUsd` | **2** — same query, different aggregation level | **yes — the $1.17** |
| **J8** `momentum.working == totals.working` | **2** — PulseTracker vs snapshot derivation | no |
| J1 `Σ program.agents == tracked` | 1 | no |
| J2 `live + ended == tracked` | 1 | no |
| J3 `working + idle == live` | 1 | no |
| J4 `contextReporting ≤ contextEligible` | 1 | no |
| J5 `tokenReporting ≤ tokenEligible` | 1 | no — **and vacuous** |
| J6 `attentionCoverage` parts sum | 1 | no |
| J7 `attentionCoverage.agents == tracked` | 1 | no |
| J9 `stalledAgentIds.length == stalled` | 1 | no |
| J11 `contextPeak ≥ contextMedian` | 1 | no |
| I5 / I6 subset counts | 1 | no |

**Two tier-2 identities, two real defects. Eleven tier-1 identities, nothing.** That is not proof
tier 1 is worthless — a partition check that has never failed is doing its job — but it is exactly
the pattern you predicted, and I had presented all thirteen as "the board is well corroborated."
**It is well corroborated against arithmetic and barely corroborated against anything else.**

---

## The four endpoints, mapped

### `/api/health`

```
verdict "healthy" · snapshot{ageMs 3608, maxAgeMs 60000} · data{complete, staleSources[], cmuxReachable, controlErrors}
```

| Figure | Tier | Note |
|---|---|---|
| `ageMs` vs `maxAgeMs` | **2** | recomputable from `snapshot.generatedAt` by another path |
| `verdict` | **1** | a summary of the fields beside it in the same object |
| `controlErrors` | **0** | nothing else counts them. It read **1** at 21:33 and **0** at 21:59 — it moves, and no second number moves with it |

### `/api/triage/queue` — and here is a real one

```
headline   "Re-establish one session identity per cmux surface"
rationale  "47 affected agents · 14 programs · claude, codex evidence…"
generatedAt 2026-08-01T06:45:57
```

**`47 affected agents · 14 programs` is a number frozen inside a generated string**, written 39
hours ago and never re-derived. The live board right now: **20 ambiguous-resolution agents, 142
programs.**

**Tier 0, and worse than tier 0** — it is not merely uncorroborated, it is **uncorroboratable**,
because the figure lives inside prose. No identity can reach it, no bound can test it, and the
operator reads it as the justification for queued work. The queue item may well still be worth
doing; **its stated reason is 39 hours out of date and says so nowhere.**

**Named fix:** carry `affectedAgents` and `affectedPrograms` as *fields* beside the rationale, and
re-derive them when the queue is read. Then they can disagree with the board, which is the whole
point. A number in a sentence is a number nothing can check.

### Program rollups

```
{ total 368, live 13, working 4, idle 9, ended 355, needsYou 1, blocked 0, failed 0, linked 6 }
```

Measured across all 142 programs against `totals`:

```
Σ live 15 = totals.live 15        Σ working 6 = 6        Σ idle 9 = 9
Σ ended 606 = 606                 Σ total 621 = tracked 621
Σ needsYou 0 = totals.needsYou 0  ← AGREES, but VACUOUSLY (both zero)
Σ linked 6 = controlState=="linked" 6
```

All **tier 1**. And the `needsYou` three-way agreement — the one `117c766` said nothing asserts —
**agrees at zero on a calm board**, so it is currently a vacuous pass. It needs the non-vacuity
counter before it means anything.

### `/api/snapshot` issues and `recentlyResolved`

`issues: 1`, `recentlyResolved: 4`. `triageSummaries` cross-references `issueId` into the triage
queue — **tier 2**, since the two stores are written independently and a dangling `issueId` would
show. Worth an assertion; there is none.

---

## A near-miss worth recording, because it is the discipline you named

I measured `Σ rollup.linked = 6` against *agents with a routable target* = **9** and had a
disagreement written down before I checked my own predicate.

`rollup.linked` counts `controlState === "linked"`, which is 6. The gap is that **3 of the 9
`exact` agents are archived**, and `operatorControlState` correctly returns `observed-only` for
those. **No defect. My predicate included archived agents.**

That is the **third** time today I have made the archived-versus-live population error — after the
day-review §1 claim and the `nextAction` claim. Same axis, three times, in a lane that wrote the
population check. I am recording it rather than quietly fixing the query, because the frequency is
the finding: **on this board, "all agents" and "the agents this figure is about" differ by 97%, and
that ratio makes the error nearly free to commit.**

---

## The revised ranking, now graded

| # | Figure | Tier | Why it ranks here |
|---|---|---|---|
| 1 | `quotaPressure.usedPercent` | **0** | independent source, no sibling, operator acts on it directly |
| 2 | triage `rationale` counts | **0, uncorroboratable** | inside prose; 39h stale and unmarked |
| 3 | `contextPct` / peak / median | **0** | denominator is a constant; already caused one defect |
| 4 | `controlErrors` | **0** | moves on its own, nothing moves with it |
| 5 | `activeMs` / elapsed | **0** | produced `Elapsed 87.1d`; B7 exists and asserts nothing |
| 6 | `observedWindowMs` | **0** | nothing qualifies the qualifier |
| 7 | `ratio: 999` | **0 by construction** | a sentinel has no arithmetic relation to test |
| 8 | `burnRateTokensPerHour` | **2 available, 0 used** | sibling is in the payload; nothing compares them |

**And the structural counts, previously reported as corroborated, are tier 1** — which means the
board can tell you its own arithmetic is consistent and cannot tell you whether it collected the
right agents.

## What I would build, in order

1. **The non-vacuity counter** (already routed) — without it, tier-1 agreement at zero is
   indistinguishable from tier-3 agreement.
2. **One tier-2 check on the collection itself.** Every current snapshot identity is downstream of
   one collection pass. Comparing the agent count against something derived *outside* that pass —
   the transcript file count on disk, say — would be the first check that could fail when the
   collector is wrong, which nothing currently can.
3. **Un-freeze the triage rationale numbers** into fields.

## Limits

- `/api/attention` I still have not enumerated — it is a write surface I exercised but never read
  for published figures.
- Tier assignments are my judgement from reading the derivations, not measured. **The tier-2 claims
  for I1 and I3 are the only ones with evidence** — they failed on real data, which is what proves
  a check can discriminate.
- One reading each for `health`, `triage/queue` and the rollups.
