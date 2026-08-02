# Retroactive audit of the day review under the verification rule

Applying `docs/VERIFICATION-RULE-GPT.md` to every claim in `docs/DAY-REVIEW-GPT.md` (`26454c6`).
Each claim is **verified-by-me**, **verified-by-worker-and-checked** (a worker found it, I have
now opened the artifact), or **relayed-unverified**.

I did the checking as part of this audit rather than labelling from memory — the greps,
payload measurements and source reads below were run today.

## Counts

| Bucket | Claims |
|---|---:|
| Verified by me | **9** |
| Verified by worker, and checked by me | **13** |
| Relayed unverified | **5** |
| **Total** | **27** |

Of the 5 relayed-unverified: **1 withdrawn** (`4fbbaa0`), **2 since verified and upgraded**
(4.4 and 4.5 — both stand, see below), **2 still downgraded** (the absence-string ratio and the
per-field byte figures) — those two may not be cited until someone opens the artifact.

Post-verification the buckets read **9 / 15 / 2**, with 1 withdrawn.

Two verified claims are now **superseded** by fixes that landed after publication. They were
true when written; they are not true now, and the review should not be read as current.

---

## Verified by me (9)

| # | Claim | How |
|---|---|---|
| C1 | Attention layer went 0 → 6 true positives; `handoff-stated` fires on *"publishing is your call"*, *"that's left to you"* | I printed all 6 signals with their evidence strings |
| C3 | `pulseStripModel`'s "a cell with nothing to report does not render" closed four prior audit findings | Read the source comment citing §5/§11/§14/§20 |
| 1a | One payload: 6 signals, 2 issues, `totals.attention: 1` | My own atomic read |
| 1b | Screen showed `Needs you 1`, 1 row, rail `2 findings` | Browser measurement |
| 1d | `grep -rn attentionSignal src/web/` returned nothing | Ran it — **now superseded, see below** |
| 1e | `alerting()` gates on `deriveOutcome(agent) === "healthy"` | Read `agent-model.js:150` |
| 3.1 | `completionsLastHour: 2` while the rail says "No completion data yet" | Saw both in my own read |
| 3.2 | `History` shows the 6h lookback; 4 of 355 ended agents fall inside it | Ran the age bucketing myself |
| 4.6 | Stalls cannot break calm | My escalation ladder, re-verified today: `calm` still excludes `stalled` (`app.js:2645`) |

## Verified by worker, and checked by me today (13)

The §2 orphaned-field table was a worker's grep. I re-ran it per field:

| Field | Files in `src/web/` referencing it | Status |
|---|---:|---|
| `attentionCoverage` | 0 | orphaned — **stands** |
| `stalledAgentIds` | 0 | orphaned — **stands** |
| `stallThresholdMs` | 0 | orphaned — **stands** |
| `displayLabels` | 0 | orphaned — **stands** |
| `threadDepth` | 0 | orphaned — **stands** |
| `subagentCount` | 0 | orphaned — **stands** |
| `lastAgentClosing` | 0 (161 agents carry it) | orphaned — **stands** |
| `totals.ended` / `.attention` / `.needsYou` | 0 | orphaned — **stands** |
| `contextPct` | 2 hits, **both inside comments** | orphaned — **stands**, and my file-count method was too loose to show it |
| `ProgramSnapshot.rollup` | 4 hits, **all `deriveRollup` / local vars** — no `program.rollup` read; 109 programs ship it | orphaned — **stands** |
| 2a payload ≈ 1.326 MB | Measured today: **1,388,541 bytes = 1.324 MB** at 401 agents | **confirmed** |
| 2b `contextPct` on 340 agents | Measured today: **365** (fleet grew) | **confirmed, number drifts with fleet** |
| 2c collector internals leaked by `...source` | `runtimeSessionId` on **10** agents, `processAlive` on **18** of 401 | **confirmed, but my table implied fleet-wide — see corrections** |

## Relayed unverified (5)

| # | Claim | Disposition |
|---|---|---|
| 1c | "8 actionable signals while the board rendered `All clear`" | **Withdrawn** in `4fbbaa0` — the capture read `ended: 8` |
| C2 | "2 absence strings against 31 number-bearing cells, ~1:15"; "Burn renders `417k/min`" | **Downgraded.** I never counted cells on the board. The *conclusion* it supports — that the honesty rule has not eaten the board — I still believe, but this ratio is not evidence for it until someone counts. |
| 2d | "~11.8 KB/payload for `rollup`", "~30 KB for `lastAgentClosing`" | **Downgraded.** I confirmed both fields ship (109 programs, 161 agents) but never measured per-field bytes. The counts are evidence; the byte figures are not. |
| 4.4 | "Context coverage uses the wrong population — labels `tokenReporting/tokenEligible` as context coverage" | ~~Downgraded~~ → **verified, upgraded.** See below. |
| 4.5 | "Program rollup `1.15B tokens` sums cumulative `sessionTotal` across ended agents and is not comparable to row figures" | ~~Downgraded~~ → **verified, upgraded.** See below. |

---

## Corrections arising from the audit

**1. §2's first row is superseded.** `attentionSignal` is now read by the client:

```js
// src/web/agent-model.js:167
return Boolean(agent && agent.attentionSignal) && deriveActivity(agent) !== "ended";
```

plus `presentation.js:345`, landed in `5839c62 feat(web): let an agent's own request for a
human reach the operator`. The predicate also excludes ended agents, matching the resolution in
`a44df6f`. **§1's mechanism claim and §2's first row are no longer true.** They were true when
written; the review must not be read as current.

**2. §2 overstated the scale of the collector-internals leak.** My table said the wire "exposes
collector inputs" without a number, which reads as fleet-wide. Measured: `runtimeSessionId` on
10 agents and `processAlive` on 18, of 401. The leak is real and the fix (an explicit wire DTO
instead of `...source`) still stands; the scale does not justify the emphasis I gave it.

**3. My own verification method was too loose once.** I first checked the orphaned-field table
with `grep -rl … | wc -l`, which counted `contextPct` as consumed because two *comments* mention
it. File-presence is not consumption. The tighter check — read the hits — is what the rule's
"open the artifact" clause means in practice.

---

## 4.4 and 4.5 verified — both stand, both sharper than written

I opened both artifacts. Neither was a relay worth doubting; both were worth stating more
precisely.

### 4.4 — the CONTEXT PEAK coverage clause counts a different population from its own headline

`src/web/app.js:828-831`:

```js
const partial = totals.tokenReporting != null && totals.tokenEligible != null
  && totals.tokenReporting < totals.tokenEligible;
const coverage = partial
  ? ` · ${totals.tokenReporting}/${totals.tokenEligible} reporting` : "";
```

Server-side the two quantities are built from different sets **and** different predicates:

| | Population | Predicate |
|---|---|---|
| Headline `pct` ← `snap.contextPeak` (`snapshot.ts:223`) | `liveAgents` — working **+ idle** | `contextPct` defined (requires `provenance: "observed"`, a non-zero window) |
| Coverage `N/M` ← `totals.tokenReporting/tokenEligible` (`snapshot.ts:307`) | `workingAgents` — working **only** | `tokens.total` is a number |

So `78% peak window · Median 59% · 12/13 reporting` invites the operator to read 12 of 13 as
*the agents behind that peak*. They are not: idle agents contribute to the peak and are absent
from the ratio, and the two predicates differ in strictness.

Sharper than I first wrote it: the widget's own comment three lines above cites audit §20 and
explicitly notes that *"the same suffix appears on BURN under a different population."* The lane
identified the population hazard, fixed the **rendering** of it (show the ratio only when
incomplete), and left the **source** wrong in the same block.

### 4.5 — the rollup's larger number carries the vaguer label

`programRollupCells` (`app.js:~223`):

```js
const withTokens = agents.filter((a) => a.tokens && typeof a.tokens.sessionTotal === "number");
const total = withTokens.reduce((sum, a) => sum + a.tokens.sessionTotal, 0);
cells.push({ value: fmtTok(total), label: "tokens", key: "tokens" });
```

`agents` is the program's whole list, ended sessions included. Meanwhile the row's cell comes
from `tokenSummary` (`agent-model.js:258`), which for `scope === "latest-turn"` renders
`tokens.total` and labels it **`latest call`**, with the tooltip `latest model call · …`.

On one screen, then: a row reading `444k tokens` (one model call) beneath a header reading
`1.15B tokens` (cumulative session totals summed across every agent, live and ended). Roughly
three orders of magnitude apart, and **the less specific label is on the larger number** — the
row says "latest call", the header just says "tokens".

The omission behaviour is honest — the cell disappears when no agent reports a `sessionTotal` —
so the defect is purely label and population, not fabrication.

---

## Section 4 re-ranked

Now that all three are verified, the original order was wrong. Re-ranked by exposure ×
consequence:

| New | Old | Finding | Why here |
|---:|---:|---|---|
| **1** | 4.6 | **Stalls cannot break calm** | Verified twice: `calm` at `app.js:2645` still excludes `stalled`, and my escalation ladder showed all-live-stalled keeps `calm: true`. Total swarm paralysis renders identically to perfect health. Nothing else in §4 can hide the whole fleet. |
| **2** | 4.5 | **Program rollup tokens** | Renders constantly — 109 programs carry a rollup — and misleads by ~3 orders of magnitude under a label vaguer than the row's. Highest exposure of the three. |
| **3** | 4.4 | **Context coverage population** | Renders only when token coverage is *incomplete*, so lower exposure. But it appears exactly when the operator is deciding whether to trust the reading, which is the worst moment to describe a different population. |

4.6 was ranked last and is plainly first. I ordered §4 by how recently I had found each item
rather than by what it costs an operator — the same ordering error the cockpit audit was written
to correct, committed inside the review that corrected it.

---

## What the buckets say about the process

The two errors the rule was written for were both in the **relayed-unverified** bucket, and
that bucket is the smallest — 5 of 27. The problem was never volume. It was that the unchecked
claims were the *load-bearing* ones: 1c was the single strongest sentence in §1, and the archive
comment in `4fbbaa0` was the entire basis for a reported contradiction.

So the useful reading is not "18% of claims were unverified." It is that **unchecked relays
cluster in exactly the places where a finding feels strongest**, because a worker's most
striking sentence is the most tempting to publish and the least likely to be re-opened. The rule
targets that: the check is mandatory at triage, before I know which claim will carry the
argument.
