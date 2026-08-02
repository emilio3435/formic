# The write path, part 2: broadcast, archive, attention, rename

Continues `docs/WRITE-PATH-AUDIT-GPT.md`. Same method — delivery proved by making each
instruction self-report its tty, with the tty→pane mapping established by asking each pane
directly through `cmux` rather than through the board. Three disposable probes (`PROBE-A/B/C`
under `/tmp/ANTHILL-PROBE-writepath2-20260802/`), all created and removed. **No control was fired
at any working lane.**

**Headline: broadcast multiplies the misroute exactly as you feared. One request, three
recipients, three instructions delivered to the wrong terminals, reported as `sent: 3, failed: 0`.**

---

## 1. Broadcast fan-out misroute — proven

Three probes, each resolving `unique-cwd` with `instruct: true`, each mapped to its own pane:

```
PROBE-A -> ttys010    PROBE-B -> ttys014    PROBE-C -> ttys016
```

**Baseline broadcast**, recipients in order A, B, C. Because `broadcast.ts:105` runs the loop
**sequentially**, arrival order in the append-only marker file identifies each recipient — and
the baseline validates that method:

```
1  /dev/ttys010   ← recipient A, A's pane   ✓
2  /dev/ttys014   ← recipient B, B's pane   ✓
3  /dev/ttys016   ← recipient C, C's pane   ✓
```

Then I rotated the panes' working directories — A's pane into B's folder, B's into C's, C's into
A's. Nothing was closed, no agent ended, no row left the board. The board re-resolved:

```
agent A -> C-pane/ttys016 | unique-cwd | instruct=true
agent B -> A-pane/ttys010 | unique-cwd | instruct=true
agent C -> B-pane/ttys014 | unique-cwd | instruct=true
```

**The same broadcast, same recipients, same order:**

```
response : {"ok":true,"partial":false,"sent":3,"failed":0,
            "results":[{...a,"ok":true},{...b,"ok":true},{...c,"ok":true}]}

1  /dev/ttys016   ← recipient A landed in C's terminal
2  /dev/ttys010   ← recipient B landed in A's terminal
3  /dev/ttys014   ← recipient C landed in B's terminal
```

A clean rotation. **Every recipient's instruction executed in a different agent's terminal, and
the API reported unqualified success.** `partial` was `false`, because from the server's side
nothing partial happened — all three `cmux` calls exited 0. Exit status measures transmission,
never destination.

This is the same `unique-cwd` defect from part 1, and broadcast does not add a second routing
bug — it adds **blast radius**. `broadcast.ts:112` calls the same `executeControl`, so the
dispatched fail-closed fix will close this too **provided it lands in `executeControl` and not in
the `/api/control` handler**.

## 2. The action log cannot tell the two apart

The correct broadcast and the fully-misrouted one were recorded identically apart from ID and
timestamp:

```json
{"kind":"broadcast","agentIds":[…a,…b,…c],"outcome":"ok","detail":"3 of 3 recipients delivered"}
{"kind":"broadcast","agentIds":[…a,…b,…c],"outcome":"ok","detail":"3 of 3 recipients delivered"}
```

*"3 of 3 recipients delivered"* is true in the sense that three panes received text. It is false
in every sense an operator cares about. **The log records intent, never destination** — no
`surfaceId`, no resolution tier, no tty — so a fan-out misroute is not merely undetected but
**unreconstructable after the fact**. Two identical rows, one benign and one that put three
instructions in three wrong terminals.

This is the single cheapest fix on the write path: `results[]` already exists per recipient, and
the delivered `surfaceId` and `resolution` are in hand at the moment of the call.

## 3. Archive — correct, and correctly boring

Fired through `/api/control` against PROBE-A:

```
{"ok":true,"action":"archive","agentId":"claude:…probe000000a"}
after → status: archived · activity: ended · controls: focus:false instruct:false
        interrupt:false archive:false
```

Right behaviour for the right reason: archive writes to the archive store and needs no pane, so
it never touches identity resolution (`control.ts:85-97`) and is legitimately exempt from the
staleness gate. It is the one control that cannot misroute, because it does not route.

**One small blemish:** the archived record retains `resolution: "unique-cwd"` and its
`surfaceId` — a routing target that outlives the thing it routed to. It is inert today because
every control is disabled on an archived agent, so this is a tidiness finding, not a live risk.
Anything that later re-enables a control on an archived record would inherit a stale target.

## 4. Attention — fail-closed, and structurally immune to this defect

`acknowledge`, `dismiss` and `snooze` are **id-keyed writes to a store**, not transmissions to a
pane. They never call `resolveAgentTarget`, so the entire misroute class does not apply. That is
an architectural property worth naming rather than a lucky one.

Guards exercised, all correct:

| Attempt | Result |
|---|---|
| `acknowledge` on a probe with no unread notification | `409 ATTENTION_NOT_FOUND` — *"no observed unread cmux notification"* |
| `snooze` on the same | `409 ATTENTION_NOT_FOUND` |
| `snooze` with `until` in 2020 | `400 INVALID_SNOOZE_UNTIL` |
| `acknowledge` on an agent that does not exist | `404 AGENT_NOT_FOUND` |

Every refusal names its reason. The endpoint requires exact key sets (`app.ts:637-640`), so a
typo'd or extra field is rejected rather than ignored — **the opposite of the silent
unknown-parameter acceptance I found on the usage endpoints**, and the right pattern.

**Limit, stated plainly: I never exercised the success path.** My probes carried no cmux
notifications, so I proved the refusals and not the acknowledgement. Whether an acknowledge
reaches the right *signal* is unverified.

## 5. Rename — fail-closed, with one message worth fixing

```
rename probe agent C          → 400 AGENT_NOT_ELIGIBLE
                                "The agent is not an unnamed child in the current snapshot."
rename claude:nope-nope-nope  → 400 AGENT_NOT_ELIGIBLE  (identical)
```

Renames are restricted to unnamed child agents, so my probes were correctly refused. Also
id-keyed, also no pane routing, also immune to the misroute class.

**The message is identical for "exists but not eligible" and "does not exist at all."** As an
anti-enumeration property that is defensible; as operator feedback it is not — someone who
mistypes an ID is told the agent is ineligible, which implies it exists. Given that two people
have now been burned this week by an endpoint quietly accepting a wrong identifier, the wording
should distinguish *unknown target* from *ineligible target*.

**Not exercised: program rename.** My lookup for the probes' enclosing program returned nothing
and I did not spend budget chasing it, so the `{programId, alias}` branch (`program-aliases.ts:199`)
is source-read only.

---

## What is now covered, and what is still not

**Covered:** `instruct` (single and broadcast), `archive` via control, `acknowledge`/`dismiss`/
`snooze` refusal paths, agent `rename` refusal path, the action log for both `instruct` and
`broadcast`.

**Still not exercised, and I am not going to imply otherwise:**

- **`focus` and `interrupt` have still never been fired.** Both need a pane; against a probe they
  would only re-prove delivery I have proved twice, and anywhere else means a working lane.
- **The `exact` tier is still unbroken-by-assumption.** Routed separately in
  `docs/WRITE-PATH-ROUTING-GPT.md`; it matters more now, because the dispatched fix makes `exact`
  the only permitted tier and therefore the sole thing the write path rests on.
- **Attention and rename success paths** — refusals proved, successes not.
- **Program rename**, and **`/api/triage/queue` and `/api/triage/run`** — untouched.
- **Broadcast's staleness defect was not measured**, only read: age is validated once before a
  sequential loop of 2–3 subprocess round-trips per recipient, so the 30s guarantee covers
  recipient 1 alone. The subprocess count is exact from source; the wall-clock is inference,
  because timing 50 recipients would have required 50 real agents.

## Probe disposal

- Three probe workspaces closed by ID (`workspace:298/299/300`); **0 probe surfaces** remain.
- All probe transcripts and directories deleted; **0** transcript dirs, **0** `/tmp` probe dirs.
- All 4 probe rows (3 from this run, 1 from part 1) are **archived and inert** — verified
  `controls enabled: none` on every one.
- Fleet is back to **9 routable, 0 `unique-cwd`** — i.e. no live agent is currently exposed to
  the defect this audit proved.
- Residue, disclosed as before: those 4 archived records persist in `data/archive.json`. Same
  reasoning as part 1 — I will not hand-edit a store five live lanes are writing to in order to
  remove inert rows. They are named `PROBE`/`probe…` and prune at the 30-day boundary.
