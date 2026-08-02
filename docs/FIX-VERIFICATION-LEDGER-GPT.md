# Verifying the two write-path fixes — and the difference between my two claims

Working the ledger by consequence. The write-path fixes first, since they govern whether an
instruction reaches a stranger's terminal.

**Both fixes are real. One has a residual.**

Each verdict below states plainly which kind of claim it is, because collapsing them is the
habit the ledger named.

**Server freshness, established before measuring** (last time I nearly measured pre-fix code):
`dcdb888` is verified live and committed at **15:20**, *after* both `ec5ac8f` (15:01) and
`26a4585` (15:06). So the running server contains both. No restart needed — and that is an
inference from a live-verified fact, not an assumption.

---

## `ec5ac8f` — attention's write path — **VERIFIED BY DRIVING THE RUNNING SYSTEM**

**Claim type: I drove the live server against a probe agent I created and removed.**

Probe resolved `unique-cwd` — the unproven tier. Before this fix, that gate *passed* and the write
was stopped only by the absence of a notification, which is what disguised the defect from me for
two rounds.

```
acknowledge → 409 UNSAFE_TARGET
dismiss     → 409 UNSAFE_TARGET
snooze      → 409 UNSAFE_TARGET

"This pane was matched by its working directory, not attested by cmux, so the session on it
 cannot be proven. Acknowledging here could clear a different agent's request for a h[uman]…"
```

**This meets the acceptance criterion I wrote in `4ae0673` exactly** — a refusal naming the cause,
*and not* `ATTENTION_NOT_FOUND`. All three actions covered, not just `acknowledge`. The message
names the specific risk of *this* surface (clearing someone else's request for a human) rather than
reusing the Send wording, which is better than I specified.

**Verdict: real, complete, correct.** The silent-signal-deletion path is closed.

## `26a4585` — dead process refuses — **VERIFIED AT CODE LEVEL, NOT BY DRIVING THE RUNNING SYSTEM**

**Claim type: I drove the production functions with the fixture from `4982058`. I did *not*
reproduce it against the live server**, because that needs a real identity binding, which needs
real process evidence, which a synthetic transcript cannot produce — the same limit I hit when
this defect was found.

Re-running the exact fixture that proved the defect:

```
resolution: exact | processAlive: false | processState: died
executeControl → 409 UNSAFE_TARGET       ← was: ok, instruction delivered
                 (no cmux command executed — the runner's log line never fired)
```

**The defect I proved in `4982058` is closed at the endpoint.** An instruction addressed to an
agent whose process is gone can no longer reach the pane. That is the part that mattered.

### The residual, on the same fixture

```
controlsFor    → instruct enabled = true      ← the button is offered
executeControl → 409 UNSAFE_TARGET            ← the endpoint refuses
AGREE? NO
```

`26a4585` changed `control.ts` and `targets.ts`. **It did not change `controlsFor`.** So the board
offers Send on a row whose process is known dead, and the endpoint rejects it.

This is precisely what the `547679e` author set out to avoid, in their own words:

> *"Both halves, because fixing only the server would move the lie rather than remove it:
> control.ts refuses, AND controlsFor stops offering the button. An enabled control that answers
> 409 teaches an operator the cockpit is flaky; a disabled one with a reason teaches them what is
> true about the pane."*

And it is acceptance criterion **#5** from the `mayTransmit` spec, which asked for
`controlsFor(...).enabled === mayTransmit(...).ok` pinned **as an invariant rather than two
assertions** — for exactly this reason.

**Severity: LOW as a safety matter, MEDIUM as a trust matter.** Nothing unsafe happens — the write
is blocked. But the operator sees an available button, presses it, and gets an error; the row still
reads healthy while being unusable. Given that `processState: "died"` is already computed and
rendered, `controlsFor` has everything it needs.

**Named fix:** have `controlsFor` and `executeControl` call one predicate, which is what
`mayTransmit` was specified for. The two are now enforcing the same policy from two copies of it,
and they have already diverged once.

---

## Ledger movement

| | Was | Now |
|---|---|---|
| `ec5ac8f` | fixed, unverified | **fixed, verified — running system** |
| `26a4585` | fixed, unverified | **fixed, verified — code level**, with a client-side residual |
| Verified total | 3 of 23 | **5 of 23** |

**Still unverified: 18.** By consequence, the next three are the cost fixes — `71d7cb3`
(invocation semantics), `57add8a` (window coverage, where I already looked for the field and
**found none**), and `58daea6` (burn rate window). Those govern the number Emilio acts on.

## What turned out already correct, stated and moved past

- The attention fix covers **all three** actions, not only the one I named.
- Its refusal text is **surface-specific**, not copied from the control path.
- `26a4585` blocks at the endpoint with **no cmux command issued** — verified by instrumenting the
  runner, not inferred from a status code.
- The server was already running both fixes; no restart was needed, and I did not perform one.

**Probe disposal:** workspace closed (`workspace:305`), transcript and directories removed, all
three scratch scripts deleted, **0 probe surfaces** remaining.
