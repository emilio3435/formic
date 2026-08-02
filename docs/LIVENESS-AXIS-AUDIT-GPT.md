# Routed fixes, and the third defect — the write gate reasons about identity, never liveness

You predicted a third instance of the shape. **There is one, it is in a surface I told you was
safe, and my earlier claim about it was wrong.**

First a correction on the ranking, because the structural lesson is worth more than the apology:
you said accepting my ranking was on you. It was not — **I authored the ranking**, called the
binding bridge "source-level and well-guarded", and put it below a finding with zero live
instances. The bug in my process was ranking by *how well-defended the code looked* instead of by
*what would be true if the defence failed*. Defence quality is evidence about likelihood; it says
nothing about severity. From here I rank residuals by consequence-if-real and state defence
quality separately, so a well-guarded item can still sort to the top.

---

# Part 1 — Routed for dispatch

## Fix A: refuse the binding bridge when the process is known dead

`identity-bindings.ts`, in `bridgeAgentsWithBindings`, before minting `recordedTarget`:

```js
if (processAlive === false) return withProcessEvidence;   // no recordedTarget
```

**`undefined` must still bridge.** That is the lsof race the mechanism legitimately exists for,
and treating unknown as dead would break the case it was built for. Only an affirmative `false`
— which `:337-347` computes only when `trustworthyProcessScan` holds — should block it.

**Acceptance criteria:**
1. Binding + empty-shell surface + `processAlive: false` → resolution is **not** `exact`, and
   `instruct`/`interrupt` are disabled. (Goes red today; this is the proven fixture from
   `4982058`.)
2. Binding + empty-shell surface + `processAlive: undefined` → still bridges to `exact`. The race
   case must keep working, or the fix trades one defect for an outage.
3. Live evidence present → binding never consulted, unchanged.
4. **Mutation:** blocking on `undefined` as well as `false` must fail (2); removing the clause
   must fail (1).

**Still-wrong-but-differently:** downgrading to `unique-cwd` instead of `missing`/`ambiguous`.
That would leave Focus pointing at a dead pane while implying a folder match that was never made.

## Fix B: make `exact` mean *currently* attested, not *ever* attested

Secondary but higher leverage than Fix A, and it subsumes it. `bindingBridged` already exists on
`/api/debug/identity` and `trace.bindingBridge` already exists in the trace — **the write gate
looks at neither.** Let a bridge authorise *display* and never *transmission*, which is the same
principle `547679e` established one tier down. If this lands, Fix A becomes belt-and-braces.

## Fix C (small, noted for the same dispatch): 19 of 20 surfaces report `tty: null`

Identity attribution therefore runs almost entirely through the `system.top` fallback rather than
the tty path, including for the 8 `exact` rows the write gate now trusts. I am not calling this a
defect — I do not know whether it is expected on this cmux version — but the fallback is carrying
essentially all of the load-bearing evidence and nobody has checked whether it is meant to.

---

# Part 2 — The third defect: `/api/attention` never got the fix

**`547679e` changed `control.ts`. It did not change `app.ts`.** The attention write path still
carries the pre-fix test:

```js
// app.ts:661-665
if (!agent.target.surfaceId || !["exact", "unique-cwd"].includes(agent.target.resolution)) {
  return responseError(409, "UNSAFE_TARGET", "The agent has no safely resolved cmux surface.");
}
// app.ts:668-672
await (await attentionStore).apply(agent.target.surfaceId, action, until);
```

**The write is keyed by `surfaceId`** (`cmux.ts:26` — `apply(surfaceId, action, snoozedUntil)`),
resolved from the agent the operator named. So acknowledging agent A's notification clears the
notification **on whatever pane A currently resolves to** — and `unique-cwd` is still accepted
here, which I proved misroutes.

**I already have the evidence that the gate passes.** In `0290014` I fired `acknowledge` and
`snooze` at a `unique-cwd` probe and recorded the result as a clean fail-closed refusal:

```
{"ok":false,"error":{"code":"ATTENTION_NOT_FOUND",
                     "message":"The agent has no observed unread cmux notification."}}
```

`ATTENTION_NOT_FOUND`, **not `UNSAFE_TARGET`** — the target gate was passed and the write was
stopped only by the absence of a notification. Unproven identity did not stop it; empty state did.
Give that pane a real notification and the write proceeds against a surface nothing attests.

**My earlier claim was wrong and I am retracting it.** `WRITE-PATH-AUDIT-2-GPT.md` §4 says
attention is *"structurally immune to this defect"* because it is *"id-keyed… not transmissions to
a pane."* That was inferred from the **API shape** — the body takes `agentId` — without following
what the handler does with it. It resolves `agentId → target.surfaceId` and writes to the surface,
exactly like Send. I tested only refusal paths and generalised from the request contract to the
storage key. **Same failure mode as the two you have already caught me on: a conclusion drawn one
layer above where the evidence lives.**

## Why this one is arguably worse than a misrouted Send

A misrouted Send is **loud** — characters appear in a terminal, and someone eventually notices.

A misrouted acknowledge is **silent, and it deletes a signal.** Acknowledging A marks *B's*
notification read, so B's attention signal disappears from the board and no one is told. Snooze is
worse still: it can suppress another agent's signal for **up to seven days**
(`ACTION_LOG_RETENTION_MS` bound at `app.ts:697`).

That is a **false negative in the attention layer** — the failure direction I called "the
dangerous one because it is invisible" in `ATTENTION-LAYER-CRITIQUE-GPT.md`. The write path can now
manufacture exactly that, and the action log records it as a successful acknowledge.

**Named fix:** apply the `547679e` rule here. Attention state is a per-pane fact keyed by surface,
so it needs the same proof of surface ownership that typing does — `exact` only, and per Fix B,
not a bridged `exact`. Refuse with a reason that names the cause, as the control path now does.

## Related, smaller, same dispatch

**`operatorControlState` (`snapshot-agent.ts:98-107`) still collapses the tiers server-side:**

```js
if (target.surfaceId && (target.resolution === "exact" || target.resolution === "unique-cwd")) {
  return "linked";
}
```

The **client** was updated — `agent-model.js:56-58` now returns `"linked"` for `exact` and
`"unproven"` for `unique-cwd`. The server helper was not, so the two disagree about what an
unproven row is. Anything reading `operatorControlState` sees the pre-fix world.

**Room labels are also surface-keyed** (`program-aliases.ts:32` — `room:${target.surfaceId}`).
Lower risk, because the caller names the surface directly rather than having it resolved from an
agent, so an operator cannot be misrouted by identity resolution here. But `targetExists`
(`:149`) validates a room by `agents.some(a => a.target.surfaceId === target.surfaceId)`, so a
misrouted agent is what makes a surface look valid. Worth a glance, not a dispatch on its own.

---

# The pattern, stated so it can be searched for

**Every one of these decisions keys on `resolution` — an identity claim — while liveness evidence
sits unused in the same object.** `processAlive`, `processState` (`"died"`), `transcriptOpen` and
`runtimeSurfaceReady` are all computed, and all four are absent from every gate above.

Identity answers *"which pane is this agent's?"* Liveness answers *"is that still true right
now?"* The codebase models the first carefully — four tiers, quarantine, conflict detection — and
the second not at all at the point of decision. `exact` is a claim with **no tense**.

**The one place that gets it right, and should be the model:** `snapshot.ts:130` gates program
grouping on `target.resolution === "exact" && !target.cwdMismatch` — resolution **plus** a
corroborating signal, with a comment explaining the bug that taught them. The codebase already
knows the shape; it applied it to a *display* decision and not to the *write* decisions.

**The grep that finds the rest:** any use of `target.resolution` or `target.surfaceId` that
authorises a write or mutation and does not also read a liveness field. That is
`app.ts:661` (attention), `control.ts:100/123` (partly fixed), `snapshot-agent.ts:34/35/103`
(controls and state), and `program-aliases.ts:32/149` (room labels).

## What I did not check

- **The success paths of acknowledge and snooze remain unexercised.** I have proved the gate is
  passed; I have not watched a misrouted acknowledge delete a real signal, because that needs a
  genuine cmux notification on a probe pane and I have not found a way to raise one.
- **Triage (`/api/triage/queue`, `/api/triage/run`) is still completely untouched** — the last
  write surface with no audit at all.
- **`/api/settings` and `/api/publish`** were not examined for this pattern.
