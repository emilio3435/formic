# The Pilot — design

**Status:** design, not yet approved for implementation
**Date:** 2026-08-01

An LLM layer over the Ant Hill cockpit that turns many running agents into a short
queue of decisions that actually need a human.

---

## The problem

The board answers *what is every agent doing*. At 236 tracked agents that is a
reference, not an answer. The orchestrator's real question is narrower and the
board never answers it:

> Of everything moving right now, what needs **me**, and what exactly is being asked?

Today that question is answered by walking terminals. The information needed to
answer it already exists in `transcriptTail` and `lastAgentMessage` on every
agent — it is simply never read.

## What the Pilot is not

Three tempting features, deliberately excluded:

- **Not a narrator.** It does not write prose about what the swarm is "up to."
  Cross-agent narrative is the highest-hallucination, lowest-verifiability output
  this could produce. Earned later, if ever.
- **Not a ranker of everything.** Dead, archived and long-idle agents are facts,
  not decisions. The board already displays them well. Feeding 173 archived and
  45 stale agents to a model buys tokens spent to be told nothing.
- **Not an autonomous actor.** It never answers an agent on your behalf.

Scope is: **agents that are live or recently live, and the decisions inside them.**

---

## Architecture

Three stages. The split is the design.

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  DETECTOR    │──▶│    PILOT     │──▶│    QUEUE     │
│ deterministic│   │  LLM ranks   │   │  you act     │
│   finds      │   │  and phrases │   │              │
│  candidates  │   │  candidates  │   │              │
└──────────────┘   └──────────────┘   └──────────────┘
      free            cached              verbatim
                                       before action
```

### 1. Detector — deterministic, no model

Already exists in embryo and shipped today (`5e4e4eb`). Before that change,
`nextAction` read the filler string *"Review this session in history"* on **218 of
236** agents. After it, the live board reports:

| count | nextAction |
|---|---|
| 283 | *(none — cannot tell, says nothing)* |
| 4 | Answer it: cmux reports it is waiting on you. |
| 1 | Approve or deny the permission it is blocked on. |
| 1 | Resolve the cmux identity conflict to enable controls. |

That is the candidate set. Six items, not 236. The detector's job is to grow the
signal list — asked-a-question-then-stopped, stated-an-assumption-and-paused,
hit-a-fork, exited-without-landing — while keeping the discipline that **it emits
nothing when it cannot tell.**

Why deterministic: a regex knows whether someone typed a question mark. The model
should spend its budget on judgment, not on detection a function does better and
cheaper. This follows the house rule — *if a function can decide it, write the
function.*

### 2. Pilot — the model, on candidates only

Input is the candidate set plus each candidate's tail. Roughly 5–15 items at
~2 KB each — on the order of **5k input tokens per pass**, cents at most.

The model does exactly two things:

1. **Rank** — which of these is load-bearing versus a permission prompt that will
   resolve itself.
2. **Phrase** — an eight-word summary of what is being asked.

It does not decide *whether* something is a candidate. It cannot add items the
detector did not find, and it cannot silently drop one — a demoted item goes to
the bottom of the queue, never off it.

**Trigger:** on candidate-set change, debounced. Not on a timer.

**Cache:** every summary is keyed by content hash. An unchanged candidate is
never re-summarized. This is a correctness requirement, not an optimization —
without it, the same decision rewords itself while you are reading it, and a
queue whose text drifts under the cursor cannot be trusted.

**Degradation:** if the model call fails, times out, or there is no network, the
queue still renders, showing the raw candidate instead of the polished line.
Never a blank panel, never a spinner that lies. This is the first component in
the cockpit that can fail for reasons outside the machine, and it must fail the
way the rest of the product already does — by saying so.

### 3. Queue — where you act

Each item has three layers, and the order is the safety property:

```
┌────────────────────────────────────────────────┐
│ ● backend lane · asked 12m ago                 │
│   Wants a ruling: does cmux count as a source? │  ← model's summary (index)
│   ▾ show what it actually said                 │
├────────────────────────────────────────────────┤
│   "I can read this two ways and the tests      │  ← verbatim (truth)
│    disagree. Before I pick: should cmux be     │
│    treated as a source for health purposes?"   │
├────────────────────────────────────────────────┤
│   [ reply ................................. ]  │  ← action, under verbatim
└────────────────────────────────────────────────┘
```

**You never act on a paraphrase.** The reply box lives under the verbatim, not
under the summary. Expanding is the cost of acting.

**Short-verbatim exception:** when the agent's actual text is short enough to
render inline (a permission prompt: *"Do you want to proceed? 1. Yes 2. No"*),
show it in the collapsed row. Trivial approvals stay one click; there is no
paraphrase to be wrong about.

---

## How items leave the queue

The failure mode to design against is specific and this cockpit already lived it:
the health card said something was wrong every single time it was looked at, so it
stopped being looked at. A decision queue that fills faster than it drains becomes
that card within a week — and worse, it costs money to generate the noise being
ignored.

**Items auto-resolve on evidence.** The Pilot re-checks each open item against the
agent's current state: it asked and has since moved on, or exited, or the thing it
was blocked on changed. The item closes itself.

**Every auto-close is auditable.** Closed items go to a visible list with the
reason they closed. If the Pilot keeps closing things you would have wanted, the
pattern is visible instead of invisible.

**The queue's own health is a displayed metric.** If it drains slower than it
fills across a week, the Pilot is failing at its job and says so. The health card
never did this for itself; the Pilot must.

## The audit surface

Two views, one component, two filters:

- **What I skipped** — candidates the detector found and the Pilot scored as not
  worth surfacing. This is how a *miss* becomes discoverable. A false negative is
  invisible by construction, so it needs a place to be seen.
- **What closed itself** — auto-resolved items and their reasons.

Building these as one surface keeps the model's claims and the underlying evidence
in the same place, which is the property that keeps the whole feature honest.

## Instrumentation

Every run logs: input candidates, output ranking, latency, cost, cache-hit rate.

Not for operational tidiness. A prompt that cannot be graded cannot be tuned, and
in a month the question *"is the ranking good, or have I just gotten used to it?"*
needs an answer from data rather than memory.

---

## Risks

| Risk | Mitigation |
|---|---|
| Model invents an ask that was never made | Verbatim is always one click away and sits above the reply box |
| Model misses a real decision | Detector is deterministic and testable; "what I skipped" makes misses visible |
| Queue becomes permanent noise | Auto-resolve on evidence; queue drain rate is itself displayed |
| Summary text drifts between reads | Content-hash cache; unchanged candidate is never re-summarized |
| Model unavailable | Degrades to raw candidates; never blanks, never fakes |
| First LLM in the codebase | Auth, cost ceiling and failure paths are new surface area and need their own tests |

## Open questions

- **Which model.** Ranking and eight-word phrasing is not a frontier-model task;
  a small fast model is likely correct, and the latency matters more than the
  quality ceiling. Worth measuring both before committing.
- **Where auth lives.** No credential path exists in this codebase today.
- **Where the Pilot renders.** Its own tab, or the top of `Now`. Leaning to its
  own surface so the existing board is unchanged for anyone who does not want it.

## Build order

1. Grow the detector (deterministic, no model, independently valuable — the board
   is better even if the Pilot never ships)
2. Queue UI reading detector output directly, no model at all
3. Add the model for ranking and phrasing, with cache and degradation
4. Audit surface: skipped and auto-closed
5. Instrumentation and drain-rate metric

Stages 1 and 2 deliver value with zero model involvement. If the Pilot proves not
worth it, the work already landed still stands.
