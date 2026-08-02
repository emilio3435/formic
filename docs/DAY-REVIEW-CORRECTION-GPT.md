# Correction to the day review §1

**What I published.** `docs/DAY-REVIEW-GPT.md` (`26454c6`) §1: *"The day's flagship feature
never reaches the operator… an operator watching this board is told 1 while 6 agents wait,"*
ranked as the worst finding of the day.

**What the operator challenged.** That the impact was wrong: every agent carrying an
`attentionSignal` had `status: "archived"`, so a low needs-you count was not hiding live asks —
it was a detector firing on dead sessions. A different bug, and a more interesting one.

**Verdict: the operator is right on the evidence, and my headline claim is falsified.** The
mechanism survives as a latent defect. There is also a third thing neither of us said, and it
is the one I would actually fix.

---

## 1. What the measurements say

Across **15 of my reads plus 21 worker reads**, spanning 09:59–10:06:

| Measurement | Result |
|---|---|
| Signal-carrying agent observations | **176** |
| …with `activity` working or idle | **0** |
| …with `activity: ended` / `status: archived` | **176** |
| Reads containing at least one live signal | **0** |

The single exception in my entire record is one read at 09:36 where `claude:c3ebef38…` carried
`permission-requested` with `activity: "idle"`. It did not reproduce in any subsequent read —
and it does not support my claim anyway, because that agent was already `status: "attention"`
and `outcome: "needs-you"`, so it surfaced through the existing `outcome` path. The client
omission cost that agent its *evidence string*, not its visibility.

**The "8 signals against All clear" evidence was recovered and it refutes me.** A worker
retrieved the sub-worker's synchronized capture: `signals: 8`, `signalVisibility.needs: 0`, and
**`ended: 8`**. All eight were dead. The most damning number in my review was eight archived
sessions, and I published it without checking their activity — even though `activity` was in my
own earlier output.

---

## 2. Claim-by-claim

| Claim from §1 | Verdict |
|---|---|
| "The day's flagship feature never reaches the operator" | **FALSIFIED as an operational claim.** True of the field's evidence; false as a statement that live work is hidden. |
| "An operator is told 1 while 6 agents wait" | **FALSIFIED.** Five of six were ended; the sixth was already visible via `outcome`. |
| "This is the worst finding of the day" | **FALSIFIED.** No measured live false-negative impact. |
| "Knowing which agents are waiting on a human is computed correctly" | **FALSIFIED.** The field currently asserts that *dead* sessions need action. |
| "The cause is a one-line omission" | **FALSIFIED as a complete causal account.** The omission is real but did not cause the 8-vs-0 gap; the server produced eight dead-session signals and the client correctly kept ended agents out of live views. |
| "`grep -rn attentionSignal src/web/` returns nothing; the client never reads the field" | **SURVIVES.** Re-verified. |
| "`alerting()` gates on `deriveOutcome(agent) === 'healthy'`" | **SURVIVES.** |
| "A live agent that merely asks a question stays `healthy` and is excluded from every attention surface" | **SURVIVES as a reachable code defect; UNPROVEN as current impact.** No such live instance was measured. |
| "6 signals / 2 issues / `totals.attention: 1` in one payload" | **SURVIVES as arithmetic** — but they are three different populations, not three answers to one question. My framing implied a contradiction where there is a definitional difference. |

So: **the mechanism is real and latent; the impact I attached to it was not.**

---

## 3. The bug that is actually real — and the contradiction under it

The server emits actionable signals on sessions whose process has exited. That is bug (B), and
it is confirmed. But two details complicate the obvious fix.

**3.1 "Archived" here does not mean the operator dismissed it.** All five signal-carrying
agents in my atomic read had `archiveKind: null` and `archivedAt: null` — **none was
operator-archived.** They are `status: "archived"` via `collectors.ts:184`:

```ts
if (exited) return { status: "archived", reason: "Source recorded a session exit." };
```

`archived` means *the process exited* — which is simply how a Claude or Codex turn ends. Every
agent that finishes its turn and waits for you lands in this state.

**3.2 Two of them are minutes old and carry real, unactioned decisions.** By age at one read:

| Age | Kind | Evidence |
|---|---|---|
| 30m | `handoff-stated` | "Branch fix/console-alerted-rows-and-health-severity, 6 commits, unpushed — **publishing is your call.**" |
| 30m | `handoff-stated` | "Nothing pushed or merged — **that's left to you.**" |
| 1655m | `handoff-stated` | "…if you want the file leaner I can downsize…" |
| 1655m | `question-pending` | "Which would help?" |
| 1655m | `question-pending` | "Want me to write a one-page docs/sem-engine/README.md umbrella…" |

Six unpushed commits waiting on a publish decision, thirty minutes old, is not noise. Three
signals at **27 hours** are.

**3.3 Two committed artifacts disagree, and nobody has resolved it.**

- `tests/archive.test.ts:164` explicitly asserts an archived agent emits `handoff-stated`, with
  a comment calling such an agent *"exactly the one still worth acting on"* — added **Aug 2** in
  `d509c9e`, *after* the design below.
- `docs/superpowers/specs/2026-08-01-pilot-design.md:23` explicitly scopes dead and archived
  agents **out** of the decision queue.
- `src/shared/types.ts:170` describes wire signals as **ACTIONABLE**.

So the archived behaviour is intentional at the unit level and out of contract at the design
level. That is the finding worth publishing: **not a client bug and not a server bug, but an
unresolved disagreement about whether an exited turn that handed a decision back is actionable.**
I mislabelled it as a client bug because I never checked `activity`.

**My recommendation, stated as an opinion rather than a finding:** the design's blanket
"archived is out" is too coarse now that `archived` means `exited`. Scope the queue by
**recency and dismissal**, not by liveness — surface an exited handoff for some window (an hour,
say), suppress it once the operator archives it explicitly (`archiveKind: "operator"`) or it
ages out. That keeps the 30-minute publish decision and drops the 27-hour ones.

---

## 4. My methodological error

I had `activity` in my own printed output — the 09:36 read showed `activity: ended` on five of
six agents — and I did not carry that distinction into the claim. I counted signals and compared
the count to a UI number, without checking whether the populations were comparable.

The reusable form: **when a count on the wire disagrees with a count on screen, establish that
the two populations are the same before calling it a bug.** `totals.attention`, `issues.length`
and "agents with a signal" are three different populations; I presented their disagreement as a
contradiction. Three numbers that measure different things are allowed to differ.

Second, smaller: I published a sub-worker's number — "8 signals against All clear" — as evidence
without verifying it myself. It was accurate and it did not mean what I said it meant. A number
I have not checked the shape of is not evidence, however precise it looks.

---

## 5. What §1 should have said

> **The client never reads `attentionSignal` (latent), and the server emits it on exited
> sessions (live).**
>
> `grep -rn attentionSignal src/web/` returns nothing; `alerting()` gates on
> `outcome === "healthy"`, so a live agent whose only distinguishing feature is an attention
> signal would be invisible to every attention surface. **No such live agent was observed** —
> in 176 signal-observations, every one was on an exited session — so this is a latent defect,
> not a current outage.
>
> What *is* current: the server emits actionable signals on exited sessions, including three
> that are 27 hours old. `tests/archive.test.ts` asserts this is intended; the pilot design
> scopes archived agents out of the decision queue. Those two disagree and should be resolved
> before either side is called a bug.

---

## 6. What survives from the rest of the day review

§1's demotion does not touch the other findings, which were measured differently:

- **§2 (server/client derivation drift)** stands, and this correction is evidence *for* it —
  `attentionSignal` joins `stalledAgentIds`, `contextPct` (340 agents), `ProgramSnapshot.rollup`
  and the leaked collector internals as fields shipped and unread. The severity framing changes:
  it is architectural debt, not an active outage.
- **§3 (honesty strings covering plumbing gaps)** stands unchanged — "No completion data yet"
  with `completionsLastHour: 2`, and the undisclosed History lookback that I helped cause.
- **§4–§5** unchanged.

The corrected top finding for the day is therefore **§2**, not §1.
