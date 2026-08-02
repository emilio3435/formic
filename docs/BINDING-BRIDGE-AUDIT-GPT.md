# `exact` can be minted without live attestation — confirmed

You asked me to exercise the residual rather than leave it as a source reading. **It is real.**

The write gate that just merged rests on `resolution === "exact"`. `exact` can be produced for a
pane that attests **nothing**, sits in a **different directory** from the agent, and whose bound
process the system has already classified as **`died`** — and Send and Interrupt are **enabled**
on it.

```
recordedTarget minted : yes (source=binding)
processAlive          : false
resolution            : exact
surfaceId             : PANE-1
reason                : Recorded binding, live evidence absent this scan. Pane cwd
                        (/somewhere/else) differs from session cwd (/original/project)…

agent cwd  : /original/project
pane cwd   : /somewhere/else       ← a different project entirely
pane attests: []                   ← no live evidence whatsoever

=== does the post-547679e write gate permit this? ===
processState: died
  focus      enabled=true
  instruct   enabled=true      ← Send into a pane nothing attests
  interrupt  enabled=true
  archive    enabled=true
```

Produced by driving the **production functions** — `bridgeAgentsWithBindings`,
`resolveAgentTarget`, `controlsFor`, `processStateFor` — not by reasoning about them.

---

## The sharpest part: the refuting evidence is computed and ignored

`bridgeAgentsWithBindings` calculates `processAlive` **in the same pass** that mints the binding
bridge (`identity-bindings.ts:337-347`). It attaches it to the agent. `processStateFor` then
renders it as **`"died"`**, which the board shows the operator.

And the write gate never consults it. `controlsFor` keys on
`target.resolution === "exact"`; `executeControl` keys on the same. **The strongest available
evidence that the binding is stale is produced, displayed, and not used by the only decision it
should govern.**

That is a different and more troubling shape than the `unique-cwd` defect. There, the system had
no better evidence. Here it has it, in hand, in the same object.

## Why the guard misses

`identity-bindings.ts:361`:

```js
if (bound && !bound.identityConflict && bound.sourceSessionIds.length > 0) return withProcessEvidence;
```

It declines to bridge when the bound surface carries evidence for a **different** session. A pane
whose agent exited and which is now an **empty shell** reports `sourceSessionIds: []`, so
`length > 0` is false and the bridge proceeds. The guard was written against *contradiction* and
is silent on *absence* — which is the far more common case, because a pane usually ends up empty,
not reassigned.

## Is it reachable in production?

**Not right now, and I checked rather than assumed:**

```
live exact rows          : 9   (all processState: running)
exact rows with a dead process : 0
bindingBridged rows      : 0
```

But the *sequence* that reaches it is completely ordinary, not adversarial:

1. An agent is properly attested; a binding is recorded. **Normal.**
2. The agent's process exits. Its transcript is seconds old, so `statusFrom` still reports
   **running** (the <3min window). **Normal.**
3. This scan finds no live evidence — because there genuinely is none now. **Normal.**
4. The pane is still open, now an empty shell reporting no sessions. **Normal.**

→ the bridge fires, `exact` is minted from memory, and for the remainder of the `running` window
the board offers Send into a dead agent's terminal. Nothing unusual has to happen; an agent simply
has to finish.

Note that the bridge exists for a **good** reason — bridging lsof race gaps, where the evidence is
momentarily missing but the agent is genuinely alive. That is a real problem and the mechanism is
the right idea. The defect is that it cannot distinguish *"the scan missed it"* from *"it is
gone"*, and `processAlive` is precisely the signal that distinguishes them.

## Bounds, stated fairly

This is narrower than the `unique-cwd` defect and I will not inflate it:

- **7-day TTL** on bindings (`IDENTITY_BINDING_TTL_MS`), with an explicit comment that an expired
  binding *"is not weaker evidence; it is no evidence."* Someone thought about this.
- Bridges only for `running`/`waiting` agents, and never when live evidence exists.
- Never bridges over a surface holding a *different* session's evidence.
- Zero live instances today.

And unlike `unique-cwd`, the target is not arbitrary: it is the pane the agent genuinely occupied.
The failure is temporal (the binding outlives the session) rather than spatial (a stranger's pane
by folder name). A misroute here reaches *your own old terminal*, which is less dangerous than
reaching someone else's — unless cmux has since reassigned that surface.

## Named fix

**Do not mint `exact` when the bridge's own evidence says the process is gone.** In
`bridgeAgentsWithBindings`, refuse the bridge when `processAlive === false`:

```js
if (processAlive === false) return withProcessEvidence;   // no recordedTarget
```

`undefined` must still bridge — that is the lsof race the mechanism exists for, and treating
"unknown" as "dead" would break the legitimate case. Only an affirmative `false`, which the code
already computes only when the process scan was trustworthy
(`trustworthyProcessScan`, `:333`), should block it.

**Secondary, and worth more than it looks:** a bridged `exact` should be distinguishable from a
live-attested one at the point of decision. `bindingBridged` is already carried on
`/api/debug/identity` and `trace.bindingBridge` already exists — the write gate simply never looks
at either. Requiring live attestation for transmitting actions, and letting a bridge authorise
only display, is the same principle `547679e` established one tier down.

## What this means for the merge

**It does not undo `547679e`.** That fix closed a defect that was live, reachable, and proven to
misdeliver; this one is latent with zero current instances. Landing it was right.

But the claim we made — that Send now requires cmux to have positively identified the session — is
**stronger than the code delivers**. Two paths reach `exact` without a current attestation: this
one, and the multi-session surface routed in `45d4ef3`. Both should be closed before `exact` is
described to operators as proof.

---

## Method, and its limit

**Stated plainly: this is logic-level proof using production functions, not an end-to-end live
reproduction.** I tried the live route first and could not complete it, for a reason worth
recording on its own:

**19 of 20 cmux surfaces report `tty: null`.** Identity attribution needs either a tty or the
`system.top` process-attribution fallback, and my probe pane — a plain shell with a `tail -f`
holding the probe transcript open — never obtained session attribution, so it stayed `unique-cwd`
and no binding was ever recorded for it. Establishing a real binding appears to require a real
recognized agent process, which I did not spawn.

So: the **logic** is confirmed against real code with real inputs; the **live reachability** is
argued from the ordinariness of the four steps above, not demonstrated. If someone wants the
end-to-end version, it needs a genuine short-lived agent in a probe pane, allowed to exit while
its transcript is still fresh.

That 19-of-20 tty gap is also worth a look by whoever owns identity: it means the
`system.top` fallback, not the tty path, is carrying essentially all identity attribution on this
fleet — including the 8 `exact` rows the write gate now trusts.

## Probe disposal

Workspace closed (`workspace:304`), transcript and `/tmp` directories removed, scratch scripts
deleted, no stray `tail` process, **0 probe surfaces** remaining.
