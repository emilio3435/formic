# Adversarial verification of 547679e — and one correction before it merges

**Verdict: the fix works. The misroute is refused, not merely less likely. It should merge.**

Two things you need before it does: the fix's stated premise names the wrong evidence source, and
there is one residual path to `exact` that no guard catches. Neither blocks the merge; both change
what the follow-up test must target.

**Method note first:** the running server had started at **14:21**, eight minutes *before* the fix
landed at 14:29. Verifying against it would have measured the old code. I restarted
`ai.imaginethat.anthill` via `launchctl kickstart -k` and confirmed the fix live by behaviour
rather than by pid timestamps, which were unreliable.

Fresh probes (`PROBE-A/B/C`, `/tmp/ANTHILL-PROBE-writepath3-20260802/`), all created and removed.
No control fired at any working lane.

---

## 1. The fix holds, under the exact experiment that broke it

**Client half** — all three probes resolved `unique-cwd` and the board withdrew the write
controls, with the reason attached:

```
A | unique-cwd | focus:true instruct:false interrupt:false archive:true
  reason: "This pane was matched by its working directory, not attested by cmux,
           so the session on it cannot be proven. Sending here could reach a
           different agent…"
```

**Server half** — an adversary does not trust a disabled button, so I called the API directly:

| Attempt | Result |
|---|---|
| `POST /api/control` `instruct` | `409 CONTROL_DISABLED` + reason |
| `POST /api/control` `interrupt` | `409 CONTROL_DISABLED` + reason |
| `POST /api/broadcast`, 3 recipients | `sent: 0, failed: 3`, all `CONTROL_DISABLED` |
| **marker file created** | **none — nothing reached any tty** |

**The rotation replay.** I re-ran the precise experiment from `0290014`: A's pane `cd`'d into B's
folder, B's into C's, C's into A's. Nothing closed, no agent ended.

```
agent A -> C-pane/ttys014 | unique-cwd | instruct=false
agent B -> A-pane/ttys006 | unique-cwd | instruct=false
agent C -> B-pane/ttys010 | unique-cwd | instruct=false

same broadcast, same recipients, same order:
ok:false  partial:false  sent:0  failed:3
codes: CONTROL_DISABLED, CONTROL_DISABLED, CONTROL_DISABLED
delivery: NO marker file created
```

**Refused, not less likely.** The misroute *condition* is still fully present — the board still
resolves every row onto the wrong pane — and every write is denied anyway. That is the correct
shape for a fail-closed fix: it does not pretend to have fixed routing, it declines to write on
unproven routing.

Broadcast is covered transitively, as designed: the gate is in `executeControl`, so
`/api/broadcast` inherits it. I verified that empirically rather than assuming it.

## 2. Correction: `exact` does not mean what the commit message says

The commit states *"`exact` means cmux attests the session is on that surface."* On this fleet
that is **not** where `exact` comes from.

```
cmux rpc debug.terminals  →  22 surfaces
                             carrying ANY session evidence:  0
                             identityConflict set by cmux:   0

/api/debug/identity        →  exact rows: 8,  all tier "session",
                              0 bindingBridged
```

Zero surfaces report a session ID through cmux, yet eight agents resolve `exact` at the
**session** tier. The evidence is added afterwards by `identity.ts → enrichCmuxIdentity`, which
inspects the pane's tty and the processes holding the transcript file open. cmux supplies the
terminal; **the hub infers the session by process and open-file evidence.**

**This does not weaken the fix.** Process-and-open-file evidence is enormously stronger than a
directory string — it is a live handle on the actual transcript, and `failedProbeSurfaces`
(`identity.ts:224`) fails closed by emptying `sourceSessionIds` and setting `identityConflict`
when the probe fails. The gate is still the right gate.

It matters for two reasons:

1. **The operator-facing reason string says "not attested by cmux."** On a fleet where cmux
   attests nothing, that phrasing points at the wrong system. When someone debugs why a row is
   unproven, it will send them to cmux instead of to the identity probe. Suggest: *"the session on
   this pane could not be positively identified."*
2. **The exact-tier test I routed must be re-aimed.** I framed it around `cmux.ts:247`. The real
   trust boundary is `enrichCmuxIdentity`. The right questions become: what happens when the lsof
   probe is slow, partial, or races a process exit; can two sessions hold one tty's transcript
   open; does a dying process release the handle before the scan.

## 3. Residual path to `exact` that no guard catches — proven in the real resolver

I drove the production `resolveAgentTarget` with one surface carrying two distinct session IDs:

```
ALPHA  -> resolution=exact  surface=SURFACE-SHARED
          reason: Matched source session ID recorded by cmux.
BRAVO  -> resolution=exact  surface=SURFACE-SHARED
          reason: Matched source session ID recorded by cmux.
```

**Two different agents, both `exact`, both onto the same single pane.** A pane hosts one
interactive session, so at least one of those is wrong — and after this fix, **both are
authorised to write to it.**

The cause: `targets.ts:124-147` filters surfaces by `sourceSessionIds.includes(...)` and then asks
whether *the matched list* has length 1. It never asks whether **the surface** names more than one
session. `quarantined()` (`targets.ts:47`) trips only on `surface.identityConflict`, a flag the
collector must set — it is never *derived* from a surface reporting several distinct sessions.

**Reachability today: zero.** No live surface carries more than one session ID (0 of 22), so
nothing is currently exposed. But the fix has just made `exact` the sole authority for writing
into a terminal, and this is a way to reach `exact` that contradicts itself.

**Named fix, cheap:** in `quarantined()` or at the session tier, treat
`surface.sourceSessionIds.length > 1` as an identity conflict and resolve `ambiguous`. Two claims
about one pane is the definition of ambiguous, and the codebase already has the fail-closed
machinery for it.

## 4. Second residual path — source-level, not exercised

`bridgeAgentsWithBindings` (`identity-bindings.ts:317-372`) mints a `recordedTarget` from a
**persisted binding** when a scan produced no live evidence, and `targets.ts:92-113` turns that
into `exact`. So `exact` can be a **stored past observation** rather than a current one.

It is well guarded — 7-day TTL (`IDENTITY_BINDING_TTL_MS`), running/waiting only, skipped when
live evidence exists, and refused when the bound surface carries evidence for a *different*
session — and the comment at `:132-136` shows the authors thought about it (*"An expired binding
is not weaker evidence; it is no evidence"*).

The gap: `:361` returns early only when `bound.sourceSessionIds.length > 0`. A pane whose agent
ended and which is now an **empty** shell reports zero session IDs, so it does not trip that
guard, and the binding bridges onto it. Within the TTL that is `exact` on a pane nothing currently
attests. **I did not exercise this** — it needs a real agent to establish a binding and then exit
— so it is a source reading, ranked below §3 accordingly.

## 5. Evidence for the open disagreement about Focus

You left the tests lane's objection visible rather than averaging it away, so here is data for it.
After rotation, all three rows kept `focus: true` while routing was wrong — meaning **Focus on a
rotated row takes the operator to a stranger's terminal**, which is exactly where they then type
by hand.

The fix's counter-argument is also strengthened by the same run: with Send off, going to look at
the pane is the only way to find out what is on it. So the rotation supports both sides — Focus is
the recovery path *and* it lands you somewhere unproven. My read, offered not asserted: keep Focus
enabled, but have it say where it is about to send you when the target is unproven. That satisfies
both lanes without gating the recovery path. Emilio's call.

---

## Probe disposal

Three workspaces closed (`workspace:301/302/303`); **0 probe surfaces**; all transcripts and
`/tmp` directories removed (**0** remaining of each); scratch script deleted. Consistent with
earlier rounds, the inert archived probe rows persist in `data/archive.json` and prune at the
30-day boundary; I did not hand-edit a store five live lanes are writing to.

**One side effect to declare: I restarted the service.** It was necessary — the running process
predated the fix — but it dropped every SSE connection and reset `observedWindowMs` and the
completion counter for all lanes. Recoverable, and visible on the board as a short "in 5m
observed" window.
