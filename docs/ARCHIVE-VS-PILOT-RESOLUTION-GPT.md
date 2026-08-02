# The archive-test vs pilot-design "contradiction": there isn't one

**Asked:** resolve the contradiction between `tests/archive.test.ts` and
`docs/superpowers/specs/2026-08-01-pilot-design.md`, quoting both sides, and say which should
change — not a compromise.

**Answer: neither. The contradiction I reported in `4fbbaa0` §3.3 does not exist.** I relayed a
worker's reading of a comment without reading the assertions underneath it. Both artifacts have
always agreed. Separately, the *implementation* bug I measured was real, and it was fixed at
12:11 today by `b9dc19b`, which I confirmed against the live board.

There is one genuine loose end, and it is a wording problem in the design, not a behaviour
problem. It is in §4.

---

## 1. Both sides, verbatim

### The pilot design

`docs/superpowers/specs/2026-08-01-pilot-design.md`, "What the Pilot is not":

> - **Not a ranker of everything.** Dead, archived and long-idle agents are facts,
>   not decisions. The board already displays them well. Feeding 173 archived and
>   45 stale agents to a model buys tokens spent to be told nothing.
>
> Scope is: **agents that are live or recently live, and the decisions inside them.**

And the plan, `docs/superpowers/plans/2026-08-01-pilot.md`, specifying `collectCandidates`:

> ```typescript
> test("ended and archived agents are never candidates, however loud their signal", () => {
>   const dead = agent({
>     activity: "ended", status: "archived",
>     nextAction: "Review the failure and choose a repair.",
>     attentionSignal: { kind: "exited-unlanded", evidence: "I did not finish the migration." },
>   });
>   expect(collectCandidates([dead], Date.parse("2026-08-01T10:01:00Z"))).toEqual([]);
> });
> ```

### The archive test

`tests/archive.test.ts`. This is the passage I mischaracterised — note what the comment is
arguing *for*, and what the assertions immediately after it require:

> ```js
> /* Measured live after the restart: 133 archived agents carried
>    lastAgentMessage but no closing line, because this projection dropped it.
>    An archived session that ended by handing a decision back is exactly the
>    one still worth acting on, so the history was permanently unreadable to
>    the attention layer — reported honestly as "could not read", but
>    avoidably so. The round trip has to carry it. */
> expect(archived.lastAgentClosing).toBe(source.lastAgentClosing);
> /* The closing line survives as EVIDENCE a human can read in the drawer, not
>    as a signal. An archived row carries no attentionSignal at all now: its
>    controls are disabled, so any instruction on it would be one nobody could
>    carry out. Round-tripping the words is still worth doing; asking the
>    operator to answer them is not. */
> expect(archived.attentionSignal).toBeUndefined();
> expect(archived.nextAction).toBeUndefined();
> ```

---

## 2. What I got wrong

The sentence *"an archived session that ended by handing a decision back is exactly the one
still worth acting on"* is an argument for **preserving `lastAgentClosing` through the archive
round trip**, so the words remain readable in the drawer and the attention layer is not blinded
by a lossy projection. It is not an argument for emitting a signal.

The very next two assertions say the opposite of what I claimed the test asserts:

```js
expect(archived.attentionSignal).toBeUndefined();
expect(archived.nextAction).toBeUndefined();
```

Both artifacts hold the same position: **the words are worth keeping; the instruction is not.**
Evidence a human can read ≠ a decision a human is asked to take.

Your instinct was exactly right — a contradiction that has only been summarised is usually two
people meaning different things. Here it was one document being summarised by someone who
stopped reading at the comment. I published that summary without opening the file, which is the
same error as `4fbbaa0` in a different costume: I trusted a worker's characterisation of
evidence instead of the evidence.

---

## 3. The real bug was real, and is already fixed

What I measured — 176 signal-observations, all on `activity: "ended"` — was not imaginary. The
implementation disagreed with *both* documents.

It was fixed today at **12:11:24 +0200** by `b9dc19b fix(attention): never instruct a session
nobody can answer`, in `src/server/attention-signal.ts`:

```js
if (input.activity === "ended") return { kind: "out-of-scope" };   // :304
...
if (input.activity === "ended") return {};                          // :489
```

Verified against the live board after the fix landed:

| Read | Signals | On ended agents |
|---|---:|---:|
| 09:59 – 10:06 (36 reads, pre-fix) | 5–8 | **all of them** |
| 10:18 (post-fix) | **0** | — |

`attentionCoverage` at 10:18: `{agents: 399, readable: 28, notReadable: 2, ended: 369,
signals: {}}` — 369 agents now correctly counted as out of scope rather than silently skipped.
The coverage field makes the exclusion auditable, which is better than the suppression alone.

**So: no side needs to change. One side already did, correctly, without a compromise.**

---

## 4. The one genuine loose end — and my recommendation

The design and the implementation now differ on a phrase, and it is worth settling before the
Pilot is built on it.

- **Design:** *"agents that are **live or recently live**"*
- **Implementation:** `activity === "ended"` → out of scope, full stop. No recency window.

These are not the same rule. A session that exited thirty minutes ago having written
*"6 commits, unpushed — publishing is your call"* is "recently live" by the design's words and
excluded by the code. I flagged exactly that case in `4fbbaa0` §3.2 and argued for a recency
window.

**I now think the implementation is right and the design's wording should change.** The reason
is in the code the fix added, and it is stronger than my recency argument:

> *its controls are disabled, so any instruction on it would be one nobody could carry out.*

The operative fact is not how recently the agent was alive — it is whether the operator can
**act through the board**. On an ended row every control is disabled. A queue whose entire
premise is *"here is a decision you can take"* cannot contain a row where the only available
action is "start a new session elsewhere." Surfacing it would be a false affordance, and the
Pilot design's own framing — *"you act"* as the third stage — depends on the queue being
actionable.

The decision the operator still owes on that 30-minute-old handoff is real. It just is not a
*board* decision, and the board already shows the session and its closing words in the drawer,
which `d509c9e` deliberately made sure survives archiving.

### Recommended change — docs, one line, owned by whoever owns the spec

**File:** `docs/superpowers/specs/2026-08-01-pilot-design.md`
**Change:** replace

> Scope is: **agents that are live or recently live, and the decisions inside them.**

with

> Scope is: **agents whose controls are still enabled, and the decisions inside them.** An
> ended session's closing words stay readable in the drawer; it is not a queue item, because
> nothing the operator could do from the queue would reach it.

I have not made this edit — it is another lane's spec and this is a shared tree. Hand it to
whoever owns the Pilot design.

### No change needed elsewhere

- `tests/archive.test.ts` — correct as written; my report was wrong.
- `docs/superpowers/plans/2026-08-01-pilot.md` — the `collectCandidates` test stays. It is now
  defence in depth rather than the only guard, and `src/server/pilot-candidates.ts` does not
  exist yet, so nothing to reconcile.
- `src/server/attention-signal.ts` — already fixed.

---

## 5. What this costs my earlier documents

- `4fbbaa0` §3.3 ("two committed artifacts disagree") is **withdrawn**. There was no
  disagreement.
- `4fbbaa0` §3.1–3.2 stand: `archived` does mean *process exited*, `archiveKind` was null on
  every signal-carrier, and two carried 30-minute-old decisions. That evidence is what makes §4
  above a real question rather than a pedantic one.
- `4fbbaa0` §1–§2 stand: the impact claim was falsified, the mechanism survives as latent.
- The client still never reads `attentionSignal` — `grep -rn attentionSignal src/web/` is still
  empty. Post-fix that field is correctly empty on ended agents, so the latent defect now has
  even less current impact, and `attentionCoverage` joins the list of shipped-and-unread fields
  from the day review's §2.
