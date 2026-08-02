# Triage, and the answer you actually need: it is one fix, not four

**Direct answer first, because it changes what the backend should land:**

> **No authorisation decision anywhere in this codebase consults agent-process liveness.**
> Not one. `processAlive`, `processState` and `transcriptOpen` are computed, rendered to the
> operator, and read by **zero** gates. **This is a single structural fix, not four patches.**

Two qualifications that keep that honest, below. And triage is **clean** — I went in expecting the
pattern and it is not there.

---

## 1. Triage: hypothesis refuted, twice

You primed me to expect that triage reasons about identity while ignoring liveness, and that it
was simply missed when `control.ts` was fixed. **Both wrong, and I checked rather than confirmed.**

**It does not reason about identity at all.** `handleTriageRequest` is keyed by `issueId`
(`triage.ts:522-578`). It never calls `resolveAgentTarget`, never reads `target.resolution`, never
touches a `surfaceId`. There is no pane to misroute to, so the entire defect class is inapplicable
— not guarded against, *absent*. Nothing here needs the `547679e` fix.

**And I nearly filed a false finding against it.** Reading `handleTriageRequest` and the dispatch
at `app.ts:883` I found no origin check and was ready to report that triage — which spawns a
process — was ungated while every control endpoint requires same-origin loopback. I tested it
instead:

```
POST /api/triage/generate   Origin: https://evil.example.com  → ORIGIN_REJECTED
POST /api/triage/queue      Origin: https://evil.example.com  → ORIGIN_REJECTED
POST /api/triage/queue      (no Origin header at all)         → ORIGIN_REJECTED
```

Gated, with its own message. The check lives at `triage.ts:485` and `:512`, inside the handler but
below where I stopped reading. **Check 4 of the standing rule caught it again** — state what the
command returns if the claim is false. Third time it has saved a publication this week, and the
trap was the same each time: concluding from the layer where I happened to be looking.

**What triage does instead**, for the record: `/api/triage/run` spawns
`codex exec --sandbox read-only --ephemeral` with a 10-minute timeout, single-flight via
`this.active`, output to a file, `Bun.spawn` with an argv array rather than a shell. That is a
careful launcher. The one thing I would look at, and I am flagging rather than claiming: the
prompt handed to it comes from `buildTriageRecommendation(issue, snapshot)`, and snapshot issues
carry **agent-authored text**. Argv-passing rules out shell injection; it does not rule out prompt
injection into an `xhigh`-effort investigator. The read-only sandbox bounds the damage, which is
why I rank this low — but it is the one place agent-authored content reaches a spawned agent's
instructions.

**No probes were run this round.** Triage does not route to a pane, so there was nothing a probe
could have exercised that reading and the origin tests did not settle. Saying so rather than
staging a probe run for appearances.

## 2. The sweep: what *is* and *is not* consulted

Three distinct liveness-ish signals exist. They are not equally used, and collapsing them into
"none" would be wrong:

| Signal | Consulted? | Where |
|---|---|---|
| **Surface liveness** — `runtimeSurfaceReady !== false` | **Yes**, all tiers | `targets.ts:91` filters `routableSurfaces`; also `identity.ts:243/255/293/421` |
| **Evidence freshness** — 30s snapshot age | **Partly** | `http.ts` (control) and `broadcast.ts` **only** |
| **Agent-process liveness** — `processAlive` / `processState` / `transcriptOpen` | **No. Nowhere.** | 0 mentions in `control.ts`, `broadcast.ts`, `app.ts`, `http.ts`, `targets.ts`, `triage.ts`, `program-aliases.ts`, `settings.ts` |

The 5 mentions in `snapshot-agent.ts` are all in `activityFor` and `processStateFor` — **display
derivation**. `controlsFor`, the authorisation function in the same file, does not read them.
That is not inferred: I proved it live in `4982058`, where `processState: died` and
`instruct: enabled=true` came out of the same object.

**So the credit where due:** the codebase does check that a *surface* is alive before routing to
it. What it never checks is whether the *agent* is. It models the terminal's liveness and not the
tenant's.

## 3. A second gap the sweep turned up: attention has no freshness gate either

`MAX_CONTROL_SNAPSHOT_AGE_MS` appears in exactly two files — `http.ts` and `broadcast.ts`.
`/api/attention` reads `dependencies.state.get()` (`app.ts:657`) with **no age check at all**.

So attention can act on routing evidence of unbounded age. Combined with last round's finding —
that it still accepts `unique-cwd` and writes keyed by `surfaceId` — the attention path is now the
**least guarded** of the three pane-routed write surfaces, while being the one whose failure is
invisible. It missed the tier fix, it missed the freshness gate, and it never had the liveness
check nobody has.

## 4. Therefore: one fix, not four

The three defects you listed are three symptoms of one missing predicate. They share a shape:
**every pane-routed write asks "which surface is this agent's?" and never "is that answer still
true?"**

**Recommended: one shared authorisation helper**, used by `control.ts`, `broadcast.ts` (already
transitive) and `app.ts`'s attention branch:

```js
// the single question every pane-routed write should ask
function mayTransmit(agent, snapshot, now) {
  if (agent.target.resolution !== "exact")        return refuse("unproven target", …);
  if (agent.recordedTarget?.source === "binding") return refuse("attested in the past, not now", …);
  if (agent.processAlive === false)               return refuse("the process is gone", …);
  if (now - Date.parse(snapshot.generatedAt) > MAX_CONTROL_SNAPSHOT_AGE_MS)
                                                   return refuse("routing evidence is stale", …);
  return ok();
}
```

That one function closes **all four** open items at once: `unique-cwd` on attention, the binding
bridge on every surface, the liveness axis everywhere, and attention's missing freshness gate. It
also makes the next surface safe by construction rather than by remembering.

**Four separate patches would be worse than one**, for a reason this week has demonstrated twice:
`547679e` fixed `control.ts` and missed `app.ts`, and the client half of `operatorControlState`
drifted from the server half. Every additional site is another place to forget. A single
predicate with a single test suite is the difference between a fix and a habit.

**Scope it correctly, though — do not over-apply.** Triage, `/api/settings` and program/agent
labels are **not** pane-routed and must not be put behind this helper; gating them on pane liveness
would break working features to solve a problem they do not have. Room labels
(`program-aliases.ts:32`) are surface-keyed but caller-named, so they need review, not this gate.

## 5. What remains unexamined after this

Small and stated plainly:

- **`/api/settings` and `/api/publish`** — never audited for anything.
- **The acknowledge/snooze success paths** — still unexercised; I can prove the gate is passed but
  have not watched a misrouted acknowledge delete a real signal, which needs a genuine cmux
  notification on a probe pane.
- **The prompt-injection question in §1** — flagged, not investigated.

Every other write surface has now been exercised or read.
