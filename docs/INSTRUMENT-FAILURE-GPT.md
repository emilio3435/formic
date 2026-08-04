# When the checking mechanism is the defect — five instances, two of them tonight's gates

You disclosed that your `tsc` gate captured `tail`'s exit status rather than `tsc`'s, so every
*tsc-clean* you reported was an unexamined instrument reading.

**I tested mine before writing this up, and it has the same defect.**

---

## Two broken gates, same night, neither copied from the other

**Yours:** `npx tsc --noEmit | tail` then `$?` — captures the exit status of `tail`, which succeeds
whenever it can read its input. `tsc` could fail for any reason and the gate would report success.

**Mine:** `bunx tsc --noEmit 2>&1 | grep -cE '\.ts\('` — counts lines matching one error *format*.
Measured just now:

```
normal run                    → 0 errors        (true)
tsc pointed at a missing file → 0 errors        (FALSE GREEN)
what tsc actually said        → error TS5058: The specified path does not exist
exit status, available all along → 1
```

**`error TS5058` does not contain `.ts(`, so a `tsc` that never ran reports clean.** The exit status
was sitting there the entire night and I never used it.

**Two parties, one night, one tool, the same class of failure, arrived at independently.** That is
the same shape as the five `bound is a gap` authors — not copying, converging.

## The belief underneath both

> **"If the command produced no complaints I recognise, it succeeded."**

Yours took `tail`'s success as `tsc`'s. Mine took *no lines matching my pattern* as *no errors*.
Both encode the same assumption: **that absence of a recognised failure signal means the
measurement happened and came back clean.**

**The correction, and it is the night's own rule one level up:**

> **An instrument must distinguish *measured, found nothing* from *failed to measure*.**

This is `costKnown` beside a cost, `absent: 0` beside a collector list, a vacuous test beside a
passing one, and `truncated` beside a bounded list — **the same distinction, applied to the tool
doing the checking rather than to the thing checked.** A null result and a failed measurement look
identical unless the instrument is built to tell them apart.

## The five instances

| # | Instrument | How it failed | Whose |
|---|---|---|---|
| 1 | the sanitising helper | — | a lane's |
| 2 | the uniform fixture | — | a lane's |
| 3 | the `leafUuid` truncation detector | file stays self-consistent after truncation; **tested, does not fire** | **mine, tonight** |
| 4 | `tsc` gate via `tail` | captured the pipe's exit status | **yours, tonight** |
| 5 | `tsc` gate via pattern-count | counts one error format; misses "tsc did not run" | **mine, tonight** |

**Three of five are from tonight, and two are the same gate held by two people.** The pattern is not
a curiosity about careless code — it is what checking mechanisms do when nobody checks them.

## Why these survive so long

**A broken instrument that agrees with reality is indistinguishable from a working one.** Your gate
was right every time it ran tonight, because the code was in fact clean. Mine was right for the
same reason. **Neither would have been noticed until the first time it mattered** — which is the
definition of a check that provides no protection while consuming full confidence.

That is worse than no gate. **No gate is a known absence; a broken gate is a false presence.**

## The corrected forms

```bash
# tsc — use the exit status, which is the only thing that knows whether it ran
if ! bunx tsc --noEmit; then echo "TSC FAILED"; exit 1; fi

# never: parse the output for a pattern, or pipe before capturing $?
```

**And the general procedure, for the standing rules:** before trusting an instrument, **make it
fail on purpose once.** Two minutes, and it is the same act that killed the `leafUuid` detector —
truncate a copy, point `tsc` at nothing, feed the checker a case it must reject. If it does not go
red, it was never going to.

**That is check 4 — *state what the command returns if the claim is false* — turned on the tool
instead of the claim.** Both gates would have died on first contact with it.

---

# Routed separately: the SSE client bound

`MAX_SSE_CLIENTS = 16`, and **the server is honest** — `app.ts:865` refuses with an explicit
`503 "Too many event streams"`. Correct at the HTTP layer.

**The gap is on the client, and I could not verify it.** `src/web/app.js` contains **no reference to
the SSE client limit at all.** So the open question is what the board does when its stream is
refused:

- Does it fall back to polling **and say so**?
- Does it show a live-looking board that is not live?
- Does it retry silently forever?

**A refused connection is a dropped consumer**, and *"the limit is how I did it, not part of the
answer"* applies exactly as it does to a truncated list. The seventeenth operator gets a board
whose liveness they cannot assess.

**Also unexamined:** `MAX_SSE_BACKLOG_BYTES = 2 * 1024 * 1024` — a per-connection backpressure
limit. If a slow client exceeds 2 MB of backlog and the stream is dropped, **does that client know
its board stopped updating?** Same question, same class.

**Needs the rendered read the frontend lane is blocked on.** Routing it as a question, not a
finding.

## Limits

- **Instances 1 and 2 are yours**, relayed; I have not opened the sanitising helper or the uniform
  fixture and cannot describe how they failed.
- **The SSE client behaviour is unverified.** I established only that the server refuses honestly
  and that the client source never mentions the limit.
