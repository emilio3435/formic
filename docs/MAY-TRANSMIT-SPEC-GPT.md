# `mayTransmit` — the single predicate, specified for dispatch

One function replaces four patches. Every pane-routed write asks it; nothing else changes.

**What it closes, in one place:** `unique-cwd` still authorising attention writes; `exact` minted
from a persisted binding on a pane whose process is dead; the liveness axis absent from every
gate; and `/api/attention` having no freshness gate at all.

---

## Placement

**In `control.ts`**, exported alongside `executeControl` — it is the same concern and the same
file's job. `broadcast.ts` gets it transitively (it already calls `executeControl`);
`app.ts`'s attention branch must call it directly.

Do **not** put it in `targets.ts`. Resolution answers *"which surface is this agent's?"* and must
stay independent of *"may I write there right now?"* — a bridged `exact` is still the correct
answer to the first question, and display code depends on that. Keeping them separate is what
lets Focus stay enabled while Send is refused.

## The predicate

```ts
export interface TransmitVerdict {
  ok: boolean;
  code?: "UNPROVEN_TARGET" | "STALE_ATTESTATION" | "PROCESS_GONE" | "STALE_SNAPSHOT";
  message?: string;
}

/** The single question every pane-routed write must ask.
 *  Identity says which pane. Liveness says whether that is still true.
 *  Four defects came from asking only the first. */
export function mayTransmit(
  agent: AgentSnapshot,
  snapshot: Pick<HubSnapshot, "generatedAt">,
  now: number = Date.now(),
): TransmitVerdict {
  // 1. Identity must be attested, not inferred. (547679e, generalised.)
  if (!agent.target.surfaceId || agent.target.resolution !== "exact") {
    return refuse("UNPROVEN_TARGET",
      "This pane was matched by its working directory, not positively identified, so the session"
      + " on it cannot be proven. Sending here could reach a different agent. Focus still works,"
      + " and this returns as soon as the session is identified again.");
  }
  // 2. Attested NOW, not once. A bridged target is memory, not evidence.
  if (agent.target.bindingBridged) {
    return refuse("STALE_ATTESTATION",
      "This pane was identified earlier but not in the current scan, so the agent may no longer"
      + " be on it. Sending is off until the session is confirmed again.");
  }
  // 3. Only an affirmative `false` blocks. `undefined` means the probe could not
  //    tell, which is the race the binding bridge legitimately exists for —
  //    treating unknown as dead would turn a defect into an outage.
  if (agent.processAlive === false) {
    return refuse("PROCESS_GONE",
      "The agent's process is gone, so this pane no longer holds the session it is named for."
      + " Sending would type into whatever is there now.");
  }
  // 4. Routing evidence must be current. Previously on control and broadcast only.
  const generatedAt = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(generatedAt) || now - generatedAt > MAX_CONTROL_SNAPSHOT_AGE_MS) {
    return refuse("STALE_SNAPSHOT",
      `Routing evidence is ${Number.isFinite(generatedAt) ? now - generatedAt : "unknown"}ms old;`
      + " recollect before retrying.");
  }
  return { ok: true };
}
```

`bindingBridged` is not currently on `AgentSnapshot` — it exists on `/api/debug/identity` and as
`trace.bindingBridge`. **Surfacing it on the snapshot is part of this change**, and is the piece
that makes check 2 possible at all.

## Call sites

| Site | Change |
|---|---|
| `control.ts:123` | replace the `writesInput && resolution !== "exact"` clause with `mayTransmit` for `instruct` and `interrupt` |
| `broadcast.ts` | none — transitive through `executeControl`. **Verify, do not assume**; that assumption is what left attention behind. |
| `app.ts:661-665` (attention) | replace the `["exact","unique-cwd"]` test with `mayTransmit`. This is the surface that never got `547679e`. |
| `snapshot-agent.ts` `controlsFor` | derive `instruct`/`interrupt` enablement from the **same** predicate, so the button and the endpoint cannot drift — the drift that already happened in `operatorControlState` |

**Do not apply to:** `focus` (types nothing; deliberately still permitted on an unproven row —
the open disagreement is Emilio's call, not this fix's), `archive` (writes to a store, needs no
pane), triage, `/api/settings`, and program/agent labels (not pane-routed). Room labels
(`program-aliases.ts:32`) are surface-keyed but caller-named — review separately, not behind this
gate.

## Acceptance criteria

1. **Each clause fires alone.** Four fixtures, each satisfying every condition but one, each
   returning its own code. A single fixture that trips two clauses proves nothing about either.
2. **`processAlive: undefined` transmits.** The lsof-race case must keep working. This is the
   criterion most likely to be lost in review, and losing it converts a safety fix into an outage.
3. **Attention is gated.** `POST /api/attention` with `acknowledge` against a `unique-cwd` agent
   returns a refusal naming the cause — **and not `ATTENTION_NOT_FOUND`**, which is what it
   returns today and which is what disguised this defect from me for two rounds.
4. **Attention gets the freshness gate.** Same endpoint against a snapshot older than
   `MAX_CONTROL_SNAPSHOT_AGE_MS` returns `STALE_SNAPSHOT`. Goes red today.
5. **Button and endpoint agree.** For every fixture, `controlsFor(...).find(c => c.action ===
   "instruct").enabled === mayTransmit(...).ok`. Pin it as an invariant, not two assertions —
   this is the drift that already happened once.
6. **Broadcast inherits.** A 3-recipient broadcast where one recipient is bridged returns
   `sent: 2, failed: 1` with that recipient's code, not a blanket failure.
7. **Refusals explain themselves.** Each message names cause, risk and the way back, per the
   `547679e` standard.
8. **Mutation:** reverting any single clause must fail at least one test; blocking on
   `processAlive === undefined` must fail (2); reading `resolution` in `controlsFor` instead of
   calling `mayTransmit` must fail (5).

## Still-wrong-but-differently

- **Gating Focus by accident.** Focus is the recovery path when writes are off. If it disappears,
  an operator has no way to see what is actually on the pane.
- **Refusing on `processAlive === undefined`.** Turns every lsof race into a dead control. The
  binding bridge exists precisely because that race is common.
- **Putting the check in `targets.ts`.** Downgrading `resolution` itself would break Focus,
  display, and program grouping, which legitimately want the bridged answer.
- **One combined error code.** Four causes with one code loses the operator's next action:
  "recollect" and "the agent is gone" call for opposite responses.
