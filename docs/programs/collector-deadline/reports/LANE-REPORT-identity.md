# Lane identity
## 1. What this lane was
Measurement-only instrumentation for the three sequential subprocess sites in
`enrichCmuxIdentity`: `cmux rpc system.top`, the full process-table `ps`, and
the PID-scoped `lsof`. The lane preserves their order, budgets, retry behavior,
and fail-closed routing semantics. Owned production file: `src/server/identity.ts`.
Owned test file added for this lane: `tests/identity-observability.test.ts`.

Assumption to verify in implementation: a single subprocess taking at least
2,000ms is an overrun worth logging. The existing hand probes total about
1,400ms, while one 2,000ms step has already spent 20% of the enclosing 10s
deadline. Failures log regardless of elapsed time.

## 2. Which claims went red first (named)
Red-first against untouched `src/server/identity.ts`:

```text
$ bun test tests/identity-observability.test.ts
(fail) identity subprocess observability > an overrun reports exact per-site elapsed time and the inputs that drive each subprocess [2.40ms]
error: the slow identity pass did not report its subprocess breakdown
(pass) identity subprocess observability > a healthy identity pass stays silent [0.19ms]
(fail) identity subprocess observability > each failed subprocess path writes its named source-health error to stderr [0.26ms]
error: expect(received).toBeTrue()

1 pass
2 fail
3 expect() calls
Ran 3 tests across 1 file. [21.00ms]
```

Mutation checks, each applied alone and then reverted:

```text
# Timing values replaced by constant 0ms
(fail) identity subprocess observability > an overrun reports exact per-site elapsed time and the inputs that drive each subprocess [2.14ms]
Expected to contain: "cmux_system_top=160ms(attempts=1,surfaces=1)"
Received: "[identity] probe timings: total=3240ms cmux_system_top=0ms(attempts=1,surfaces=1) process_table=0ms(rows=1) lsof=0ms(pids=1)"

0 pass
2 filtered out
1 fail
```

```text
# Overrun-only guard disabled so healthy passes logged
(fail) identity subprocess observability > a healthy identity pass stays silent [2.19ms]
Expected: []
Received: [ "[identity] probe timings: total=1ms process_table=0ms(rows=1) lsof=0ms(pids=1)" ]

0 pass
2 filtered out
1 fail
```

```text
# process-table failure log removed
(fail) identity subprocess observability > each failed subprocess path writes its named source-health error to stderr [1.72ms]
Expected to contain: "[identity] process identity lookup timed out"
Received: [ "[identity] cmux process attribution probe failed 2 times (...) ...", "[identity] open-session identity lookup timed out" ]

0 pass
2 filtered out
1 fail
```

Restored source:

```text
$ bun test tests/identity-observability.test.ts
(pass) identity subprocess observability > an overrun reports exact per-site elapsed time and the inputs that drive each subprocess [2.19ms]
(pass) identity subprocess observability > a healthy identity pass stays silent [0.15ms]
(pass) identity subprocess observability > each failed subprocess path writes its named source-health error to stderr [0.19ms]

3 pass
0 fail
9 expect() calls
Ran 3 tests across 1 file. [20.00ms]
```

## 3. What shipped — file and fence
`src/server/identity.ts` now measures the existing three sequential subprocess
sites without moving, overlapping, cancelling, or shortening any of them:

- `cmux rpc system.top`: aggregate elapsed time, attempt count, and ready-surface count.
- `env LC_ALL=C ps -axo ...`: elapsed time and parsed row count.
- `/usr/sbin/lsof ...`: elapsed time and exact PID count passed to `-p`.

If any one subprocess takes at least 2,000ms, one stderr line reports total and
per-site timings. Healthy passes remain silent. Each existing source-health
failure now also writes its already-returned error to stderr.

`tests/identity-observability.test.ts` is the lane-owned regression file. It
pins exact per-site values/input sizes, healthy silence, and all three named
failure logs.

**Live finding: BLOCKED.** This sandbox cannot name the production 9.3s
subprocess without inventing evidence. The kickoff's supplied independent hand
sample names `lsof` as the largest call (`1,140ms`, versus `system.top=160ms`
and `ps=80ms`), but that totals only about `1,380ms` and therefore does **not**
explain or prove which call spends the production `~9,300ms`. The instrumented
line is ready to answer that question in an environment allowed to read cmux
and the process table.

## 4. Floor results — PASTED, not paraphrased
```text
$ bunx tsc --noEmit

```

The command was silent and exited 0.

```text
$ bun test tests/identity-trace.test.ts tests/identity-bindings.test.ts tests/identity.test.ts tests/debug-identity.test.ts tests/identity-observability.test.ts

 64 pass
 0 fail
 220 expect() calls
Ran 64 tests across 5 files. [58.00ms]
```

```text
$ bun test

10 tests failed:
(fail) what this board counted is what a separate application recorded > a settled disagreement is either explained by BurnBar, or it fails [0.21ms]
(fail) per session-row: span divided by nothing, the only bound that fires > real history: the history was actually read, so no bound passes on an empty set [0.10ms]
(fail) identities that must hold whatever window you ask for > the identities were actually evaluated, so none of them passed on an empty read [0.09ms]
(fail) identities that must hold whatever window you ask for > I3: the provider breakdown sums to the scalar it breaks down, at every window [0.06ms]
(fail) (unnamed) [2.66ms]
(fail) (unnamed) [5001.41ms]
  ^ a beforeEach/afterEach hook timed out for this test.
(fail) (unnamed) [2.38ms]
(fail) (unnamed) [5002.69ms]
  ^ a beforeEach/afterEach hook timed out for this test.
(fail) (unnamed) [0.90ms]
(fail) (unnamed) [5002.59ms]
  ^ a beforeEach/afterEach hook timed out for this test.

 3515 pass
 10 fail
 15247 expect() calls
Ran 3525 tests across 189 files. [71.82s]
```

This is a blocked full floor, not the required baseline. The last six failures
come from three geometry gates whose `listen(0, "127.0.0.1")` calls receive
`EPERM`/`EADDRINUSE`, followed by their timed-out cleanup hooks. The first four
are live-data availability assertions; a focused rerun of
`tests/cross-source-token-agreement.test.ts` reported the board snapshot was not
serving and produced `19 pass / 1 fail`.

## 5. Anything unverified, including what the sandbox refused
- **Production sub-step measurement is unavailable.** `cmux` terminal discovery
  fails with `Operation not permitted` connecting to
  `~/.local/state/cmux/cmux.sock`; direct `ps` fails with `Operation not
  permitted`. The resulting zero surfaces/rows were treated as unavailable,
  never as a zero-cost measurement.
- Two attempts to run `scripts/anthill-preview.sh` stayed in the reserved range
  and left production `:4701` untouched, but `Bun.serve` was refused as
  `EADDRINUSE`; direct geometry probes identify the sandbox refusal as `EPERM`.
- Read-only production loopback was intermittent: `/api/health` briefly returned
  healthy, while repeated `/api/debug/identity` and snapshot reads were refused.
  No live surface fixture could be captured.
- The full suite is BLOCKED at `3515 pass / 10 fail`, not the prescribed floor.
- No timeout, call order, routing behavior, or critical-path placement changed.
  No push, PR, merge, deploy, production write, or port-4701 launch occurred.
