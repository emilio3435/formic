# Standing verification rule — GPT counterweight lane

Binding on this lane and on every Codex worker it dispatches. Written after publishing two
findings that were wrong in the same way on the same day.

---

## The rule

**A claim is evidence only if I opened the artifact it rests on.**

Not the worker's quote of the artifact. Not the worker's characterisation. Not my own earlier
summary of it. The file, the payload, or the pixels.

Workers are for **breadth** — sweeping 1300 transcripts, enumerating 40 fields, running an
escalation ladder. They are not a chain of custody. Whatever survives into my document, I open
myself before it ships.

---

## What counts as evidence

| Tier | What it is | May I publish it? |
|---|---|---|
| **Direct** | I ran the command, read the file at that path, or measured the rendered DOM, in this session | Yes |
| **Checked relay** | A worker found it; I then opened the same artifact and confirmed it | Yes, and say a worker found it |
| **Unchecked relay** | A worker asserts it and I have not opened the artifact | **No.** Label it, or cut it |

An unchecked relay may still go in a document — as an open question, explicitly marked, never
as support for a conclusion.

## Four checks before any count becomes a finding

1. **Population.** When a number on the wire disagrees with a number on screen, prove the two
   count the same set before calling it a bug. `totals.attention`, `issues.length`, and "agents
   with a signal" are three populations. Three numbers measuring different things are allowed
   to differ.
2. **Scope of a quote.** When a comment appears to support a claim, read the code *under* it. A
   comment justifies the line beneath it, not the paragraph I wish it justified.
3. **Freshness.** Every count names the read it came from. A live board moves; a number without
   a timestamp is an anecdote.
4. **The check itself.** State what the verification command would return if the claim were
   false. A check that cannot fail is not a check — see the trap below.

---

## The failure mode this rule exists to catch

**Unchecked relays cluster where a finding feels strongest.**

This is a general property of working through subagents, not an observation about one day. A
worker's most striking sentence is simultaneously the most tempting to publish and the least
likely to be reopened, because it already reads as conclusive. Verification effort naturally
flows to claims that look shaky — which are, by construction, the ones least likely to be
load-bearing.

So the distribution is predictable: unverified claims will be few, and they will be the ones
carrying the argument. Both times this lane published something false, the bad claim was the
single best sentence in its section.

The counter is procedural, not attitudinal: **the check is mandatory at triage, before I know
which claim will end up carrying the argument.** Deciding what to verify after the shape of the
finding is clear is deciding too late — by then the strongest claim has already earned trust it
has not been audited for.

---

## The deeper trap: a re-verification method that cannot fail

Catching a wrong claim is one level. Catching a wrong *method for checking claims* is the level
underneath, and it is easier to miss because the check appears to have been done.

**The instance.** Re-verifying which server fields the client consumes, I ran
`grep -rl <field> src/web/ | wc -l` and read a non-zero count as "consumed". `contextPct`
scored 1 and I nearly marked it verified-as-consumed. Opening the hits showed **both were
inside comments** — prose *about* `contextPct`, in a file that never reads it. File presence is
not consumption. The claim was right and my method for confirming it was wrong, which would
have produced a confident correction in the wrong direction.

**The general form.** A verification step that returns a signal under both hypotheses verifies
nothing. `grep -l` answers "is this string in this file", not "does this code use this value" —
those diverge exactly where a codebase discusses itself, which this one does constantly.

**The guard is check 4:** before running a verification command, say what it returns if the
claim is *false*. If the answer is "the same thing", the command is not a check. Prefer reading
the hits over counting them; prefer the assertion over the comment; prefer the rendered value
over the field's presence.

## Worker brief requirements

Every dispatch must tell the worker: cite `file:line` or the exact command; quote the artifact
rather than describing it; and state what would falsify the finding. And every worker output
gets triaged into the three tiers above before I write a word.

---

## Worked example 1 — the "ended 8"

**What I published** (day review §1): *"A worker's synchronized read caught a worse moment —
8 actionable signals in the payload while the board rendered `All clear` and `Needs you 0`."*
It was the strongest sentence in the review.

**What the record actually held.** The worker's capture was
`{signals: 8, signalVisibility.needs: 0, ended: 8}`. The `ended: 8` was sitting in the same
object as the 8 I quoted. Every one of those signals was on a dead session, so `Needs you 0` was
correct, not a failure.

**The failure.** I copied two fields out of a three-field object and published the two that
supported my thesis. I never opened the capture.

**What the rule would have caught.** Check 1, population: eight signals versus zero needs-you is
only a contradiction if both count live agents. One line of the evidence said they did not.

---

## Worked example 2 — the comment I quoted without opening

**What I published** (correction `4fbbaa0` §3.3): that `tests/archive.test.ts` and the Pilot
design contradict each other, citing a comment calling an archived agent *"exactly the one still
worth acting on."*

**What the file actually says.** That comment argues for carrying `lastAgentClosing` through the
archive round trip so the words stay readable. The two lines immediately beneath it:

```js
expect(archived.attentionSignal).toBeUndefined();
expect(archived.nextAction).toBeUndefined();
```

The test asserts the same position as the design. There was no contradiction.

**The failure.** A worker quoted the comment; I published the contradiction without opening
`tests/archive.test.ts`. Same error as example 1, one document later — and this time inside a
document whose whole purpose was correcting the first one.

**What the rule would have caught.** Check 2, scope of a quote: read the assertions under the
comment. They were four lines away.

---

## Why this is written down

Both failures were the same mechanism — trusting a characterisation instead of the artifact —
and resolving to be careful did not prevent the second. The rule exists so the check happens at
dispatch and triage time, not when I remember to be careful.

The tell, in both cases: **I could quote the finding but could not have quoted its
surroundings.** If I cannot say what is immediately above and below the line I am citing, I have
not read it.
