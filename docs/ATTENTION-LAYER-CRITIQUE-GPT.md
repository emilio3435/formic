# Adversarial critique: the content-aware attention layer (`5e4e4eb`)

**Subject.** `feat(attention): say why an agent wants a human, from what it wrote` — six
deterministic detectors over `transcriptTail` and `lastAgentMessage`, replacing a
content-blind `nextActionFor` that printed "Review this session in history." on 248 of 275
agents.

**Method.** Four Codex workers at high effort attacking from separate angles, plus my own
measurement joining the live board to the transcripts on disk. Evidence is real: 1336
transcripts under `~/.claude/projects/`, `~/.codex/sessions/`, and repeated atomic reads of
`/api/snapshot`. The board drifted from 289 → 302 agents during the audit; each number below
names the read it came from.

**The question asked was false negatives, because they are invisible.** They are the headline.
But the same measurements produced a precision result that is worse.

---

## Credit first

The direction is right and the commit is unusually honest.

- **Deleting the filler was correct.** 248 of 275 agents carrying one identical sentence was
  noise dressed as advice, and the drawer lane had already stopped rendering it.
- **Refusing to ship `{kind:"unknown"}` on every row was correct.** Emitting a new string under
  every agent would have been the same bug in a different field. That instinct is right.
- **The commit self-disclosed its own biggest weakness** — the 500-character head truncation —
  and named the file and line. Most commits do not do this. Everything below sharpens that
  disclosure rather than discovering it.

The critique is not that the idea is wrong. It is that, measured against the live fleet, this
layer currently has **0% recall and 0% precision**, and its silence is not the honest silence
the commit claims.

---

## 1. The silence is blind, not honest — 96.6% of it

This refutes the commit's central defence.

**Evidence** (302-agent read). What the detector actually receives:

| Input condition | Count |
|---|---:|
| `transcriptTail` present | 301/302 |
| `transcriptTail` sitting exactly at its 800-char cap | **206** |
| `lastAgentMessage` present | 215 |
| `lastAgentMessage` visibly front-truncated with `…` | **205** |
| `lastAgentMessage` empty | **87** |

Classifying the silence itself:

| Silence classification | Count | Fraction |
|---|---:|---:|
| Correctly silent from fully visible text | 7 | **2.3%** |
| Blind — input empty or truncated | 288 | **96.6%** |
| Fully visible, detector logic still missed it | 3 | 1.0% |

**Why this matters.** The commit argues that unrecognised situations emitting nothing is the
honest choice. That is only true if "unrecognised" means *nothing to report*. Measured, it
means *the detector could not see the text*. 288 of 302 agents are silent because the input was
truncated or absent. A cockpit that stays quiet because its sensor is unplugged is not being
disciplined; it is being uninformative in a way no operator can detect.

**Fix.** Distinguish the two states internally. `unknown` should split into `nothing-wanted`
(text fully visible, no signal found — safe to stay silent) and `not-readable` (input truncated
or empty — the layer has no opinion). Keep emitting nothing to the UI for the first. For the
second, the layer should not claim coverage it does not have — at minimum it must not be
counted as a correct negative in any test or metric.

---

## 2. Recall is zero: every agent that asked for a human was missed

**My measurement.** I joined the board to the transcripts on disk and read the *real* final
assistant message for every agent I could match (116 matched). Applying a strict test — final
sentence is a question addressed to the operator:

- **3 agents ended their turn asking the operator a direct question.**
- **0 produced a signal.** All three read `outcome: healthy`, `activity: ended`,
  `nextAction: none`. The board says nothing is wanted.

The mechanism is visible in the data. For each, the real transcript versus the wire field:

| Real transcript ends with | `lastAgentMessage` on the wire holds |
|---|---|
| "Want the full accounting against all 79 findings, or is the working state enough?" | "Checked in. Here's the honest state. The program's work is landed and live…" |
| "Which would help?" | "That's an AI image-edit task — inpainting (removing the man on the right)…" |
| "…so you can drive the whole thing from one place?" | "Both plans are written to /Users/emilionunezgarcia/Developer/…" |

The wire carries the **head**. The question is at the **tail**. Independently, a worker
sampling 120 sessions found 5 human-wanting tails and **0 detected — 100% false-negative rate**.

---

## 3. The truncation is pointed the wrong way, and it is not an edge case

**Evidence** (106 agents where I could compare the real final message to the wire field):

- **86% of real final agent messages exceed 500 characters.**
- Median real final-message length: **1474 characters**.
- The 500-character window therefore covers **34% of a typical final turn — measured from the
  wrong end.**

**Why this matters.** Agents put their conclusion last. Summary, then the ask. Reading the first
third of a message to find a closing question is not an under-tuned detector; it is a detector
aimed at the wrong end of the text. `question-pending` cannot fire on a normal agent turn.

**Fix.** For attention detection, keep the message **tail**, not its head — `slice(-500)` rather
than `slice(0, 500)`, or carry a separate `closingText` field. This is a collector change and
therefore another lane's file; it should be requested rather than worked around here.

---

## 4. Fixing the truncation only recovers one miss in five

This is the finding that matters most for planning, and it is easy to miss.

Of the five human-wanting tails a worker found, **only one was hidden by truncation. Four had
the complete message available and were still not recognised.**

The reason: `question-pending` looks for a short closing line ending in `?`. Real agents hand
decisions back **declaratively**:

> "6 commits, unpushed — **publishing is your call.**"
> "…which I'd flag as a deliberate known limit rather than pretend is closed."
> "**two things for you**", "**left to you**", "**if you push**"

None of these end in a question mark. All of them are an agent stopping and waiting on a human.

**Fix.** Add a `handoff-stated` detector over the closing text, keyed on declarative
hand-back phrasing — *your call*, *up to you*, *left to you*, *let me know*, *waiting on you*,
*I'll hold*, *tell me which* — and on a trailing enumerated list of options with no selection.
Fixing truncation without this converts a 0% recall into roughly 20%.

---

## 5. Precision is also zero, and the false positive is self-amplifying

Every signal on the board is wrong.

**Evidence.** Three atomic reads: at 289 agents, 1 signal; at 297, 1; at 301, 3. In every read,
**true positives = 0.**

The first false positive fired on an agent *documenting this very vulnerability*:

> **`[Attention]` marker spoofing**: an agent transcript containing that literal would surface
> as a "permission-requested" pill in the operator UI…

The detector classified that prose as `permission-requested`, with `nextAction: "Approve or deny
the permission it is blocked on."` There is no permission request. The text warning about the
spoof performed the spoof.

**It then reproduced during this audit.** A worker writing up the false positive created a
second one — its own Codex transcript was classified `input-requested` on a *working* agent.
The more the swarm discusses the detector, the more false signals it manufactures. Three
transcripts on disk currently contain the literal in assistant prose.

**Root cause.** The marker is `[Attention] ${notification.body}`, synthesised in `snapshot.ts`
from an unread cmux notification — it is not emitted by any provider collector. The detector
then searches for `"[Attention]"` **anywhere in the text** via `lastIndexOf`. Any agent that
writes the string is indistinguishable from a real notification.

**Fix.** Do not pattern-match a marker inside free text that the agent controls. `snapshot.ts`
already knows whether a notification exists — pass that as **structured data**
(`notification?: {title, subtitle, body}`) to the detector instead of splicing a sentinel into
`transcriptTail` and grepping for it. This removes the entire spoof class rather than escaping
it. If the marker must survive on the wire, anchor it to the start of the field, not
`lastIndexOf` anywhere.

---

## 6. Two detectors are structurally unable to fire

- **`stopped-mid-work`** requires `processState === "died"`. On the live board `processState`
  is overwhelmingly `unknown` or `exited`; `died` requires the collector to have proven death
  via recorded PIDs. The detector's logic is never reached for most of the fleet.
- **`permission-requested` / `input-requested`** depend entirely on a cmux notification
  existing. No provider collector emits the marker; it is synthesised only when an unread cmux
  notification is associated with a resolved surface. For any agent whose session is not routed
  to a cmux pane — which includes every quarantined and observed-only agent — these two can
  never fire regardless of what the agent wrote.

**Fix.** Neither should be counted as coverage until its precondition is measurably present.
Report per-detector fire rates alongside preconditions, so a detector that cannot fire is
visible as such rather than being indistinguishable from a detector that found nothing.

---

## 7. Recommended order of work

1. **Split `unknown` into `nothing-wanted` and `not-readable`** (§1). Everything else is
   unmeasurable until the layer can tell "I looked and saw nothing" from "I could not look."
2. **Pass the notification as structured data** (§5). Kills the only signals currently on the
   board, all of which are wrong, and closes a spoof that is actively self-amplifying.
3. **Add `handoff-stated` for declarative hand-backs** (§4). Four of five real misses.
4. **Request the collector keep the message tail** (§3). The remaining one of five, and it
   unblocks `question-pending` generally.
5. **Publish per-detector fire rates and preconditions** (§6).

---

## 8. Where this critique could be wrong

- **The board moved under me.** 289 → 297 → 301 → 302 agents across reads. Counts are per-read
  and labelled; ratios are stable across all of them, but no single table is a snapshot of one
  instant.
- **My "asks the operator a question" test is a regex.** It found 3 in 116; a stricter human
  reading might accept 2 or find 6. The worker's independent sample found 5 in 120, which
  agrees in order of magnitude. The 0-detected side of the ratio is not in doubt.
- **This swarm is an unrepresentative corpus.** These agents write about the detector, which
  inflates the self-reference false positive beyond what a normal fleet would see. The spoof is
  still real; its live frequency here is not typical.
- **§6's claim about `died` is inferred from the board's `processState` distribution**, not
  from forcing a process death and observing the detector.
