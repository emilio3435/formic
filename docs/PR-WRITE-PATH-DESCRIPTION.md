# The write path: one predicate decides whether we may type into a terminal

*Proposed body if the write-path work is split out of PR #5. Commits `858a993`
(fix) and `2660b62` (tests), against the invariant established earlier in
`547679e`, `26a4585` and `ec5ac8f`. Files: `src/server/targets.ts`,
`control.ts`, `snapshot-agent.ts`,
`tests/button-endpoint-agreement.test.ts`,
`tests/control-advertisement-invariant.test.ts`.*

---

**This changes what the product will do to a terminal on your behalf.** A
reviewer who reads nothing else should read that sentence.

## The board advertised a control the system would refuse

`controlsFor` returned `instruct` enabled for an agent whose process was known
dead, while `executeControl` refused the same agent with 409. The row showed a
`died` chip and a live **Send** button, and the refusal arrived only after the
operator pressed it.

Nothing unsafe shipped — the endpoint held, and it held for the right reason. But
a control the system will refuse is a promise the board should never have made,
and the failure is not really about liveness. It is that **two places were
deciding the same question**, so they could disagree, and had already done so
twice:

- `547679e` gated the endpoint on target attestation and left the client half of
  the same rule behind.
- `26a4585` gated the endpoint on process liveness and left `controlsFor`
  offering Send on a dead row.

Both were the same shape. Fixing the third site the same way would have bought
one round.

## One predicate

`transmitRefusal(agent)` is now the single authority, consulted by the
capability function the board renders *and* by the endpoint that executes. It
returns a refusal or null, and the button and the gate cannot disagree because
there is no second opinion to hold.

A write is authorised only when all of these hold:

| condition | why it is not optional |
|---|---|
| the target is **attested now**, not remembered | a binding that was true when written says nothing about this scan |
| the resolution is **exact**, not a directory match | a folder is not an identity; two panes in one project, one `cd`ing away as another `cd`s in, moves the match to the wrong terminal while the row still reads healthy |
| the process is **not known dead** | the pane outlives the agent and usually belongs to your shell by then, so the instruction lands on whoever took it over |
| the routing evidence is **fresh** | which terminal an agent is on has a short shelf life |

`Focus` is deliberately exempt from all of it. It types nothing, worst case you
look at the wrong terminal and immediately see that you have, and going to look
at the pane is how an operator recovers when the write controls are off. Leaving
Focus on is what keeps the guarantee from becoming a lockout.

`processKnownDead` is deliberately narrow: only `died` — the collector looked
and found the process absent. `unknown` keeps writing, because absence of
evidence is not evidence of death, and treating it as death would disable
controls on every agent the prober has not reached yet.

## What this is worth to an operator

Written as capabilities lost, these read as a broken install. Written as
guarantees they are the reason to trust the thing with a terminal at all:

- It will not type into a terminal it cannot name.
- It will not type into a session that has already exited.
- It will not act on a stale picture.

**The board is never the reason you cannot reach an agent — it is the reason you
do not reach the wrong one.**

## Verification

`tests/control-advertisement-invariant.test.ts` asserts the general property
rather than the three instances: **for every state, what the button advertises
is what the endpoint accepts.** That is the test that would have caught all
three drifts, including the two that shipped.

`tests/button-endpoint-agreement.test.ts` covers the specific pairings.
Exercised directly against `executeControl` with a recording runner, so nothing
could reach a real terminal: `processState: "running"` returns 200 and issues
the `send_text` command; `"died"` returns 409 and issues **zero commands** — the
refusal happens before a command exists.

**Honest limit on the evidence.** These states are rare on a healthy fleet. At
the time of writing, the live board held none of them across 556 sessions — no
folder-matched target and no dead process — so this behaviour is confirmed by
exercising the code that decides it, not by watching a row do it. Tested, not
yet witnessed, and the guide says so rather than implying otherwise.

`tsc` clean; the suite is green at the branch head.
