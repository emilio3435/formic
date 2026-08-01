# Second critique: what actually shipped

**Subject.** `47379ef` "condense the agent drawer to what an operator acts on" (20 painted
fields → 9) and `7c5d25c` "fold the duplicated row summary on the selected row only".

**Method, and why it differs from the first pass.** The first critique judged assertions. This
one judges the rendered result. Four Codex workers at high effort read the shipped code
(information-loss ledger, abnormal-state coverage, responsive contract, Thread/dedupe), and I
drove the live board at `127.0.0.1:4701` through the headless browser at 1440 / 1100 / 1024 /
900 / 768 / 390px, opened real drawers, and measured the DOM. Several findings below are
invisible in the diff and only appear on screen.

**The question asked:** did the condensation remove NOISE, or INFORMATION an orchestrator
needs? **Answer: mostly noise, and it is a real improvement — but four things crossed the
line, one of them badly.**

---

## 1. Where I was wrong, and where they were right

Stated first, because a critique that never concedes is not a review.

- **My first critique feared they had deleted abnormal outcome along with the nominal word.
  They had not.** `outcome !== "healthy"` still renders `Alert` / `Blocked` / `Failed` in the
  drawer status line (`app.js:4612–4617`), on the roster, and in the issue surface. Suppressing
  only the nominal `Healthy` is correct: silence *is* the healthy state. That was the single
  biggest risk in the whole change and they handled it.
- **`7c5d25c` is correctly scoped.** I checked the DOM: `.row-description` is
  `display: none` on `.agent-row.is-selected` only; every other row stays scannable. Folding
  the whole column would have been the lazy fix.
- **Deleting the cache-hit tile was right and the reasoning was better than mine.** It computed
  `cachedInput/input`, but `input` is the *uncached remainder*, so the true rate is
  `cachedInput/(cachedInput+input)`. The wrong denominator could exceed 1 — which is what the
  `Math.min` clamp was hiding. It printed a constant 100%. That is not condensation, that is a
  bug fix found by condensing.
- **They reverted their own aggressive cut** when a parallel lane's guard required both token
  magnitudes visible, and said so in the commit. Resolving a conflict by picking the reading
  closer to the brief, rather than splitting the difference, is the right call.
- **`nextAction`, `headPrimaryAction`, the Operate panel and the uptime tile all deserved to
  go.** The uptime rationale in particular — it timed since *start*, not since *movement*, so
  it read 200h for an agent silent for an hour — is a better argument than the one I made.

The drawer is genuinely condensed. Head, one status line, a conditional banner, one Context
tile, Thread, collapsed Evidence, sticky dock. That is a cockpit.

---

## 2. Information that actually went missing

### 2.1 The activity word is gone below 1025px — measured, not theorised

This is the one that matters, and it is the exact failure mode both lanes flagged in advance.

`Working` / `Idle` / `Ended` was deleted from the drawer because "the roster row that opened
the drawer already prints activity". Measured in the live DOM:

| Viewport | Drawer geometry | Row occluded? | Drawer contains "Working"/"Idle"? |
|---|---|---|---|
| 1440px | docks at x=583, w=824 | no (row spans 48–568) | **no** |
| 1100px | docked | no | **no** |
| 1024px | **x=0, w=1024 (full sheet)** | **yes** | **no** |
| 900px | x=0, w=900 | **yes** | **no** |
| 768px | x=0, w=768 | **yes** | **no** |
| 390px | x=0, w=390 | **yes** | **no** |

At 1024px and below the drawer is a full-viewport sheet, the roster is completely covered, and
the word does not exist anywhere in the drawer. **An operator supervising at 1024px cannot tell
whether the agent they are looking at is running or parked.** 1024 is iPad landscape and a
common laptop window — not an edge case.

Cost to recover: one `Close` click, not a terminal. But "close the thing you are reading to
find out if it is alive" is the wrong trade in a cockpit.

**Worse, and invisible on screen:** the drawer encodes activity only as the *colour* of the
age text, and the `Session status` aria-label does not name it (`app.js:4580–4594`). For a
screen-reader operator the activity word is gone at **every** width, including 1440.

### 2.2 Three independent dedup rules compose into total erasure

The sharpest find. Each rule is defensible alone; together they can empty the drawer.

When `lastHumanMessage === task`, and `lastUserMessage` / `lastAgentMessage` are absent:

1. `taskMeaningfullyDifferent()` treats task-equals-message as duplication, so the head
   suppresses the task (`app.js:4390`, `4973`).
2. Thread reads only `lastUserMessage` / `lastAgentMessage`, so it prints
   **"No messages captured for this session yet."** (`app.js:5125`).
3. The row summary that would have carried it is folded on the selected row at ≥1025px
   (`styles.css:1667`) and covered by the sheet below that.

Result: a drawer that says the session has no task and no messages, for an agent whose `task`
is populated on the wire. Recovering it means `curl /api/snapshot` or devtools — **outside the
cockpit.** Each rule deletes "a duplicate"; nobody owns the invariant that at least one copy
must survive.

### 2.3 `dedupeTurns` matches on substring containment, not repetition

The commit says it "drops any turn whose text repeats one already shown". The code
(`app.js:5107`) is:

```js
prev === norm || prev.includes(norm) || norm.includes(prev)
```

Containment in **either** direction, after case-folding and whitespace collapse. So an
assistant turn that quotes the operator's instruction back before answering — extremely
common — is judged a repeat of the user turn and dropped **with its answer attached**. The
operator sees their own instruction and no reply, on an agent that replied.

Substring is not repetition. This one is a bug, not a taste call.

### 2.4 Elapsed is unreachable at ≤720px

Session age folds from the row when the drawer docks (`styles.css:1654–1658`) and is hidden
outright at ≤720px (`styles.css:2697–2706`), while the drawer's uptime tile was deleted.
Below 720px it is on neither surface. Time-since-update is not a substitute: "updated 3s ago"
does not tell you this session has been running for nine hours.

---

## 3. Two duplications the diff cannot show, and one the render exposes

Found only by reading pixels and the live DOM.

### 3.1 The Context tile prints the same ratio three times

The commit's stated achievement: *"Both numbers survive, each exactly once, and the numerator
is never bare."* The rendered tile, copied verbatim from `innerText`:

```
CONTEXT
20%
51k /258k
20% of the window · 148k used this session
```

`20%` appears **twice**, about 40px apart, and the ratio is encoded a third time as
`51k /258k`. The sentence added to disambiguate the two magnitudes re-states the ring it sits
under. The fix for the labelling defect was correct; it was applied *on top of* the existing
figures instead of replacing them. Keep the ring and the session clause; drop the bare
percentage or the fraction.

### 3.2 The quarantine sentence renders twice in one drawer

`"…this session's identity is ambiguous, so control routing is quarantined."` appears **2×**
in a single open drawer (counted in the DOM): once in the control banner, once again at the
dock. The banner already carries the reason, the remedy, and `See routing evidence →`. The
dock repeating it verbatim is the same class of defect this commit was commissioned to remove.

### 3.3 At 1440px the collapsed Evidence rail is wider than Thread

Measured from the screenshot: the Thread column renders at roughly 330px while the collapsed
Evidence rail — a decorative dotted circle with a cog — occupies roughly 390px beside it. **The
collapsed shelf is wider than the content it is collapsed to make room for**, and it is
competing for width with the only long-form reading surface in the panel, whose text is
clipped mid-sentence with a fade. At 1024px the rail becomes a sensible full-width bar; the
defect is specific to the docked layout.

### 3.4 The promoted task is boilerplate, directly under the title made unique to fix that

They fixed "four drawers, four identical headings" by riding the session tag on the title. The
line immediately beneath — the task promoted out of Operate, and the most prominent text in
the head — currently reads, on four different agents:

> **IMPORTANT: Do NOT read or execute anything under ~/.claude/, ~/.agents/, .claude/skills/, or agents/.**

The task field's first 140 characters are a safety preamble. Not their bug, but it means the
head's loudest line is identical across the agents whose titles were just disambiguated. A
first-meaningful-line heuristic, or preferring `lastUserMessage`'s opening when `task` starts
with a known preamble, would recover the intent.

---

## 4. One note on the "it is constant, so it is not a signal" method

The method is sound and I want more of it. One caution.

`outcome` is `healthy` on **264/264** agents right now — I re-measured. But it is not constant
because the fleet is healthy. `outcomeFor` can only return non-healthy from `gates[]` or a cmux
notification, and the generic collector that serves every Codex and Claude session hard-codes
`gates: []` (`src/server/collectors.ts:285`). Only `cursor.ts` ever populates it. On the live
board: 0 of 264 agents have gates, 0 have `status: "attention"`.

So the constancy measures a **collector gap**, not a UI redundancy. It happens not to matter
here — §1 confirms the abnormal branch still renders — but the inference "constant on the wire
⇒ safe to delete" would have been wrong if the display had been removed unconditionally.
Constancy is evidence about the *producer*; check the producer before concluding about the
*consumer*.

---

## 5. Recommendations, ranked

1. **Put the activity word back in the drawer status line**, or name it in the aria-label at
   minimum. It is one word and it closes both the ≤1024px hole and the assistive-tech hole.
2. **Fix `dedupeTurns` to compare equality, not containment.** Containment drops answers.
3. **Add a last-resort guarantee to the suppression chain:** if the head suppressed the task
   *and* Thread has no turns, render the task. Never show "No messages captured" for an agent
   that has prose on the wire.
4. **De-duplicate the Context tile** — ring + session clause, drop the bare percentage or the
   fraction.
5. **Stop the dock repeating the banner's quarantine sentence.**
6. **Shrink the docked Evidence rail** so Thread gets the width; it is the only long-form
   content and it is currently clipped.
7. Restore elapsed somewhere at ≤720px, or accept it as a documented mobile limitation.

Items 1–3 are the ones that removed information. The rest are the noise the condensation set
out to remove and did not quite finish removing.

---

## 6. Caveats on this critique

- **The working tree had uncommitted drawer changes while I measured.** The loss-ledger worker
  noted further condensation to task dedup, status-reason visibility and vitals that is not in
  `47379ef + 7c5d25c`. Findings in §3 come from the running build and may already be moving.
- **§2.2's hole is a reachable state, not one I saw fire.** I traced it through three code
  paths and confirmed each rule independently; I did not catch an agent in that exact field
  combination on the live board.
- **§3.3 is measured from one screenshot at one width** with one agent's content. The ratio
  will vary with Thread's text length.
- I did not review keyboard traversal or focus order, which a drawer this restructured
  deserves before it is called done.
