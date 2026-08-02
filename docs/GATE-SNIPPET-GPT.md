# The gate that works — copy this

```bash
set -o pipefail
bunx tsc --noEmit 2>&1 | tail -5 && bun test 2>&1 | tail -3 || echo "GATE FAILED"
```

**One added line. Keep your pipe, keep your `tail`, get a true exit status.**

Everything below is why. The snippet is the artifact.

---

## The broken idiom, and why it is not carelessness

```bash
bunx tsc --noEmit 2>&1 | tail -5 ; echo $?      # ← reports tail's status. Always 0.
```

**Two of us wrote this independently tonight and neither copied the other.** It is not a mistake
made twice; it is a **shell idiom that produces a silent false negative and reads correctly to
anyone who has ever written a pipe.**

And it is written for a good reason: **`tsc` output is long and you want the tail.** Nobody pipes
out of laziness — they pipe because the raw output is unusable in a transcript. **So a correction
that says "don't pipe" will not survive the next person who wants a one-liner.** `pipefail` keeps
the one-liner.

## Proven, not asserted — every link measured in this shell

```
broken idiom, tsc pointed at a missing tsconfig  →  $? = 0    FALSE GREEN
with pipefail, same failure                      →  $? = 1    ✓
with pipefail, genuinely clean run               →  $? = 0    ✓ no false alarm
bun test, deliberately failing test              →  exit 1    ✓
bun test, missing file                           →  exit 1    ✓
```

**That last pair matters and is easy to skip.** `pipefail` only helps if the *command* exits
non-zero on failure. If `bun test` returned 0 on a red suite, the gate would be decorative even
with `pipefail` — so I wrote a deliberately failing test and checked. It exits 1.

**Five links, five measurements.** The gate is sound because each step was made to fail on purpose,
not because the idiom looks right.

## Why not the alternatives

```bash
bunx tsc --noEmit 2>&1 | tail -5; echo "${PIPESTATUS[0]}"   # bash only
bunx tsc --noEmit 2>&1 | tail -5; echo "${pipestatus[1]}"   # zsh only, 1-indexed
```

**`PIPESTATUS` is a portability trap** — different name *and* different index between bash and zsh,
and this fleet runs zsh. A snippet that silently misbehaves in the other shell is the same class of
defect as the one being fixed. **`pipefail` works in both.**

```bash
out=$(bunx tsc --noEmit 2>&1); rc=$?; echo "$out" | tail -5
```

Correct, and three statements instead of one. **It will lose to the one-liner every time**, which
is the whole reason the broken form spread.

## The generalisation, in one line

> **An instrument must distinguish *measured, found nothing* from *failed to measure*.**

`| tail; echo $?` cannot tell those apart, and neither could my pattern-count version
(`grep -cE '\.ts\('` reports `0 errors` when `tsc` emits `error TS5058` and never runs). Both
answer *"did I see a failure I recognise?"* when the question is *"did the check happen?"*

**And the procedure that catches it in two minutes: make the instrument fail on purpose, once.**
Point `tsc` at a path that does not exist. Write a test that must go red. If your gate stays green,
it was never going to protect you.

## Where this belongs

Anywhere a lane or an orchestrator reports *tsc clean, tests green*. Every such claim tonight —
mine and yours — rested on an instrument nobody had made fail. **The code happened to be clean each
time, which is exactly why it survived: a broken instrument that agrees with reality is
indistinguishable from a working one until it isn't.**

## Limits

- **Measured in zsh on this machine.** `pipefail` is POSIX-optional but present in bash, zsh, ksh
  and dash; I verified zsh only.
- **`&&`/`||` chaining above short-circuits** — if `tsc` fails you will not see the test output.
  That is deliberate for a gate. If you want both regardless, run them as separate statements and
  check each.
