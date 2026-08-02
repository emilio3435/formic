# The write path: does an action reach the agent it names?

**Answer: sometimes provably, sometimes not, and the board does not make the difference load-bearing.**

I proved a misroute end to end against probes I created and removed. A `Send` naming one agent
executed in a different agent's terminal, the API returned `ok: true`, and the action log recorded
success against the agent that never received it.

**Method.** Two disposable cmux workspaces, `PROBE-ALPHA` and `PROBE-BRAVO`, under
`/tmp/ANTHILL-PROBE-writepath-20260802/`, plus one synthetic `claude` transcript. Delivery was
measured by making each instruction self-report the tty it executed on
(`tty > …/delivery.txt`), and the tty→pane mapping was established **independently** by asking
each pane directly through `cmux`, never through the board. So the board's claim of success and
the evidence of delivery come from different channels. **No control was ever fired at any of the
five working lanes.**

---

## 1. The mechanism: two tiers wearing one badge

`control.ts:100` permits a write when the resolution is `exact` **or** `unique-cwd`:

```js
if (!surfaceId || !["exact", "unique-cwd"].includes(agent.target.resolution)) {
  return failure(request, 409, "UNSAFE_TARGET", …);
}
```

Those two tiers are not the same kind of claim.

- **`exact`** — cmux itself reports the agent's own session ID on that surface
  (`cmux.ts:247-274`, `session_id` / `claude_session_id` / `codex_session_id` …). The pane
  attests to holding that session. This is **evidence**.
- **`unique-cwd`** — `targets.ts:213` selects surfaces where
  **`surface.sourceSessionIds.length === 0`**: panes with *no identity evidence at all*. The
  match is "same directory string, and the only unclaimed one." This is **inference**, and its
  own reason string says so: *"Matched one active source to the only unclaimed cmux surface with
  this exact cwd."*

`unique-cwd` routes a real instruction to a pane chosen by **folder name and process of
elimination**.

## 2. Proof that a fabricated agent becomes writable

I wrote one synthetic transcript for a session cmux has never seen, in a directory a probe pane
happened to sit in. One collection cycle later:

```
id         : claude:aaaaaaaa-0000-4000-8000-probe0000001
resolution : unique-cwd
surfaceId  : 62004512-88AD-462D-BC76-A84DBBBFC780
reason     : Matched one active source to the only unclaimed cmux surface with this exact cwd.
controls   : focus:true  instruct:true  interrupt:true  archive:true
```

**`instruct: true`.** Nothing linked that session to that pane except a matching path.

A `Send` through `/api/control` returned `ok: true` and executed on `/dev/ttys006` — which
independent interrogation confirmed *was* ALPHA's pane. **Correct, but correct by construction,
not by evidence.** It landed right because the folder happened to be unique and unclaimed.

## 3. Proof of misroute — the finding

I then did the most ordinary thing an operator does: I changed directories. ALPHA's pane `cd`'d
to `/tmp`; BRAVO's pane `cd`'d into ALPHA's folder. Nothing was closed, no agent ended, the
`PROBE-ALPHA` row stayed on the board.

Re-resolved:

```
agent cwd : /tmp/ANTHILL-PROBE-writepath-20260802/PROBE-ALPHA
routes to : 8DB6662D-2C35-4413-A891-ACE2918E1D76   ← BRAVO's pane
resolution: unique-cwd
instruct  : true
```

Sent to `PROBE-ALPHA`:

```
response         : {"ok":true,"action":"instruct","agentId":"claude:…probe0000001"}
named agent      : PROBE-ALPHA   (pane /dev/ttys006)
actually reached : /dev/ttys010  ← BRAVO's pane
```

**The instruction ran in a terminal belonging to a different session, and the API said `ok`.**
Nothing in the response, the status code, or the agent ID hints otherwise. PROBE-ALPHA's own
pane received nothing.

The root cause is that a pane's identity, at this tier, **is wherever its shell currently sits**.
A `cd` silently transfers a routing target from one session to another. In production this needs
no adversary: an agent ends, its pane closes or moves, another terminal is opened in the same
project folder, and a still-listed row now points at a stranger's terminal.

**The 30-second freshness gate (`http.ts:6`, `MAX_CONTROL_SNAPSHOT_AGE_MS`) does not help.** My
snapshot was seconds old. It guards against *stale* evidence, not against evidence that is fresh
and inferential.

## 4. The action log cannot detect this

Both sends were recorded identically:

```json
{"kind":"instruct","agentIds":["claude:…probe0000001"],"outcome":"ok",
 "detail":"instruct completed for 1 agent"}
```

The misrouted one is the second entry. **The log records the agent that was *named*, never the
surface that was *reached*** — no `surfaceId`, no resolution tier, no tty. After a misroute there
is no forensic path from the log to where the instruction actually went. An operator
investigating "why did that agent get an instruction meant for another" would find a clean record
of success.

## 5. What an operator can see

Not nothing, and I will not overstate it. `app.js:203` does distinguish the tiers in words —
`exact: "exact match"`, `"unique-cwd": "matched by folder"` — and `controlLinkSentence`
(`app.js:5964-5972`) renders *"Linked to terminal: … for Focus and Send · matched by folder."*

Three problems with that as a safeguard:

1. **The roster does not distinguish at all.** `agent-model.js:45` collapses both tiers to the
   single state `"linked"`. The row an operator acts from carries no tier.
2. **The sentence leads with reassurance and trails the qualifier.** "Linked … for Focus and
   Send" is the claim; "matched by folder" is an appended clause after a `·`.
3. **"Matched by folder" does not say what it risks.** It reads as *how* we found it, not as
   *this may not be the agent you named*.

This is the same shape as findings across the day: the honest datum exists, and is placed where
it cannot do its job. *(Source-verified; I did not photograph the drawer for this run.)*

## 6. Live exposure right now — small, and not structural

Measured on the live board, 488 agents:

| Resolution | Count |
|---|---:|
| `missing` | 451 |
| `ambiguous` | 28 |
| `exact` | 9 |
| **`unique-cwd`** | **0** |

**Today, every routable agent is `exact`.** The nine writable rows all carry cmux's own session
attestation, so no live agent is currently exposed. That is luck of configuration, not a
guarantee: my probe entered `unique-cwd` within one collection cycle of a directory existing.

Also worth recording: **2 of the 9 routable agents carry `cwdMismatch: true`** — cmux's session
evidence says one thing and the pane's folder says another. Those resolve `exact` and are
correctly still routable (session evidence outranks folder), but they are live proof that the two
signals do diverge in practice.

## 7. What holds up

Reported deliberately, because an audit that only finds faults has not been calibrated.

- **The ambiguity guards work.** With both probe panes in the same folder,
  `eligibleSurfaces.length > 1` correctly produced `ambiguous` and disabled controls. The unsafe
  case is a *single wrong* candidate, not multiple candidates.
- **Refusal after the source disappeared was immediate and correct.** When I deleted the probe
  transcript, the row went `resolution: missing`, all four controls `false`, with the honest
  reason *"cwd fallback requires a running or waiting source; source is archived."*
- **The request gates are real**: loopback + exact same-origin `Origin`, `application/json`,
  body-size cap, and newline rejection on instructions (`control.ts:112`) so a Send cannot inject
  a second command.
- **`archive` correctly bypasses surface routing** — it writes to the archive store and needs no
  pane, which is why it is exempt from the staleness gate.

## 8. Named fixes

1. **Do not permit `unique-cwd` to receive `instruct` or `interrupt`.** Restrict `control.ts:100`
   to `exact` for anything that transmits. Focus is arguably survivable — focusing the wrong pane
   is visible and harmless; sending to it is neither.
2. **Record the delivered surface in the action log**, not just the named agent — `surfaceId`,
   `resolution`, and tty if available. Without it a misroute is undiagnosable after the fact.
3. **Carry the tier into the roster**, not only the drawer, and word it as a risk
   (*"folder-matched — may not be this agent"*) rather than as provenance.
4. **Re-resolve the target at execution time** and abort if the surface changed since the
   snapshot the operator acted on. The freshness gate checks the snapshot's *age*; it never
   rechecks its *conclusion*.

---

## What I could not exercise safely, and why

Stated plainly rather than glossed:

- **Only `instruct` was fired.** `focus` and `interrupt` were never sent — both require a real
  pane, and firing them at a probe proves delivery I had already proven with `instruct`, while
  firing them anywhere else means firing at a working lane. `archive` was never fired **through
  the control path**; I observed the archive *state* arriving by another route (source
  disappearance), which is not the same thing.
- **The `exact` tier was not adversarially tested.** To do that I would have to make cmux attest
  a session ID it should not, and I found no way to do that without a real agent process. My
  claim that `exact` is evidence-based is a **source reading plus live observation**, not an
  attempted break. That is the highest-value remaining test on this path.
- **`/api/broadcast` was not fired.** Source-read only (`broadcast.ts:103-116`): it resolves each
  recipient from the same snapshot and calls the same `executeControl`, so it **inherits this
  defect and fans it out**. I did not exercise it because every available recipient was a working
  lane.
- **Acknowledge, Dismiss, Snooze, rename, and the triage queue** were not touched at all. This
  audit covers the cmux-routed controls and the action log only.
- **`control.ts:72`'s identity check is unreachable via HTTP.** `request.agentId !== agent.id`
  can never fire, because `http.ts:110` finds the agent *by* that ID. It is live defence for
  other callers, not a check on this path — worth knowing before anyone counts it as a guard.

## Probe disposal

- Both cmux workspaces closed by ID (`workspace:295`, `workspace:296`); surface count returned
  from 20 to pre-probe levels with **0 probe surfaces** remaining.
- Probe transcript and `~/.claude/projects/-tmp-ANTHILL-PROBE-…-PROBE-ALPHA/` deleted; probe
  directories under `/tmp/` deleted. Filesystem residue: **0**.
- The probe row is **inert** — `resolution: missing`, all four controls `false`, unroutable.
- **One residue remains, and I am not hiding it:** the record
  `claude:aaaaaaaa-0000-4000-8000-probe0000001` persists in `data/archive.json` (1 of 492
  records). I chose **not** to hand-edit that file: the server owns it, five lanes are live, and
  a read-modify-write race to delete one inert record risks losing real ones. It is
  unmistakably named and it prunes at the 30-day retention boundary — the same boundary I
  reported yesterday as never having fired. If you want it gone sooner, that is a one-line
  removal best run while the service is stopped.
