# The audit ledger — state of everything, and the pattern in what goes unverified

You asked for the ledger because you merged a PR with an unexercised residual that turned out
real. **The pattern is clearer than any individual entry, so it goes first.**

---

# The pattern: I verify what I am asked to verify, not what I found

Sorting the day's work by whether I personally confirmed the outcome, one line separates the two
groups:

> **I verified `547679e` adversarially because you asked me to. I verified the range selector
> because you asked me to refute you. I have not personally verified a single fix that landed
> downstream of a finding I routed.**

Twenty-plus fixes landed today on the strength of these audits. **I have verified three.**

**The mechanism, and it is not laziness:** routing a finding *feels* like completing it. The
finding leaves my hands, I write the acceptance criteria, and the loop closes in my head before it
closes in the code. Every unverified item below sits on the far side of that false completion.

**The binding bridge proves it is the same mechanism you hit.** I ranked it second, called it
"source-level and well-guarded", and moved on — and when you finally asked me to exercise it, it
was real and worse than the defect we had shipped a fix for. **You accepted my ranking; I authored
it.** The thing I did to that residual is the thing I have done to twenty fixes: declared it
handled at the moment it stopped being mine.

**Two structural corrections, offered as rules rather than intentions:**

1. **A routed finding is not closed until its fix is exercised.** The ledger should carry an
   explicit "fix landed, unverified" state — as this one now does — so the gap is visible instead
   of implied by silence.
2. **Rank residuals by consequence-if-real, state defence quality separately** (already adopted,
   `4ae0673`) — and add: **the fact that a residual was ranked by me is not evidence about it.**

---

# 1. FIXED and verified by me personally — 3

| Finding | Fix | How I verified |
|---|---|---|
| `unique-cwd` authorising writes; Send reached the wrong terminal | `547679e` | **Adversarial replay.** Rotated three probe panes, called the API directly rather than trusting the disabled button, confirmed `sent:0 failed:3` and **no marker file at any tty** — refused, not merely less likely |
| Cost suppression: $11,939 measured, headline read "not reported" | `dcdb888` | **Just now.** `estimatedCostUsd: 14130.62` with `costKnown: false` carried *beside* it — value present, gap as qualifier. Exactly the specified shape |
| "The range selector is decorative" | n/a — was never broken | Measured `range=1h/24h/30d` returning distinct correct windows; refuted the claim twice, once yours and once nearly my own |

# 2. FIXED but NOT verified by me — 20

These landed downstream of findings I routed. **Every one is unconfirmed by me**; I am listing
them so the gap is a fact rather than an assumption.

`26a4585` exact must mean currently attested, dead process refuses · `ec5ac8f` close the second
write path 547679e left open · `aaaf323` Focus names the terminal it opens · `9493126` three
disabled buttons, three answers · `78c0041` folder-matched pane says so · `57add8a` a window says
what it cannot see · `58daea6` burn rate names its window · `71d7cb3` an invocation is not always a
call · `3fb9b45` provenance describes the cost reported · `c58d85c` one unpriced model must not
suppress the rest · `5ef8cf4` a floor and its gap · `fbdf2c0` stop counting pauses as completions ·
`8b31c96` BURN reports the hour it measured · `42d842e` never-installed is absent not degraded ·
`f13a730` a board that cannot take commands is not clear · `69d5c0d` header restating itself ·
`8edf115` stage ends where content ends · `70ed00b` empty cockpit must answer · `d877753` honour the
window asked for · `52df8c9` one collection, two honest words

**The three I would verify first, by consequence:** `26a4585` and `ec5ac8f` (both close write-path
holes I proved were real — and `ec5ac8f` closes the attention path I *wrongly cleared* before
catching it), and `57add8a` — I looked for a coverage field on `/api/usage/summary` just now and
**found none**, so either it lives elsewhere or that fix is incomplete. I could not resolve which.

# 3. DIAGNOSED and unfixed — 9

| Finding | Consequence-if-real | Note |
|---|---|---|
| **July 30 holds 26% of the 30-day cost at an impossible token rate** | **HIGH** | **Worsening.** Was 47.6M tok/inv and $59.91; now **55.9M and $71.27**. `71d7cb3` added `aggregatedInvocations` and **it does not explain this** — Jul 30 is 28% aggregated vs Jul 28's 43%, yet 16× the tokens per invocation. **Checked rather than assumed** |
| Archive retention runs from last activity, not from archiving | HIGH | Routed; `archivedAt` never stored, so past decisions are permanently unauditable |
| Partial-period bar drawn at full height, inverts the trend | HIGH | Reported `e7ee299` |
| Context windows: config constant as a percentage denominator | HIGH | Already caused the `contextPeak` null once |
| `maxRecords: 5000` overstates operator capacity | HIGH | Routed with the retention work |
| One surface naming two sessions resolves `exact` for both | MEDIUM | Routed `45d4ef3`; zero live instances |
| Archive (30d) and burnbar (90d) never reconcile | MEDIUM | 60 days of spend with no attributable agent |
| `pricingVersion` asserts currency, nothing checks it | LOW | Flagged, not claimed |
| Snooze success path — misrouted snooze silences another agent 7 days | **unknown** | **Could not exercise.** Needs a real cmux notification I cannot raise |

# 4. REPORTED then WITHDRAWN — 2 published, 5 caught pre-publication

**Published and retracted:**

- **Day review §1** — "6 agents wait while the board says 1." All signals were on ended/archived
  agents. The refuting field (`ended: 8`) was in the same object I quoted from.
- **"Attention is structurally immune, it is id-keyed"** — inferred from the request contract
  taking `agentId`, without following that the handler resolves it to `target.surfaceId` and
  writes keyed by the **surface**. This one is the worst of the day: I *cleared* a surface that
  had a live defect, and it took two more rounds to catch.

**Caught before publication** (each by a named check, which is the system working):

- "The range selector does nothing" — wrong parameter name; check 4
- "Archive test contradicts pilot design" — never opened the test file; self-caught
- "Triage has no origin gate" — stopped reading above `triage.ts:485`; check 6
- "Over-long ranges silently return $0.00" — **my own harness's `?? 0` applied to an error body**
- "`scanWindowHours` publishes a constant" — live path is settings-driven; setting sat at its
  default so both hypotheses looked identical

---

# What the withdrawals have in common — and it is the same pattern again

**Six of seven were conclusions drawn one layer above where the evidence lived.** Not misreadings —
every layer I read, I read correctly. I stopped at a layer that could not settle the question,
while the question felt settled. That is check 6, and it exists because of these.

And the connection to the unverified column: **both failures are the same act.** Stopping at the
layer that feels conclusive, and stopping at the routing that feels conclusive, are one habit —
**declaring completion at the point where my own involvement ends rather than where the evidence
does.**

**The single most useful change** is not another check. It is that "routed" and "verified" must be
different columns in whatever tracks this work, because I will otherwise keep collapsing them —
today's evidence is 20 fixes I treated as done and 1 residual you merged on my ranking.

## Honest limits of this ledger

- **The fixed-unverified list is derived from commit subjects**, not from reading each diff. A
  subject describing my finding is evidence the lane addressed it, **not** evidence it is correct
  — which is precisely the distinction this document is about, so I am not going to blur it in the
  document that names it.
- **I have not re-checked the earlier board findings** (roster, tabs, drawer, quiet board) against
  current code. Several fixes above touch them; whether they hold is unverified.
- **Counts are of findings I filed**, not of all defects found today — the other lanes filed their
  own and I have not read them.
