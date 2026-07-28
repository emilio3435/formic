# BE-A runtime resilience lane report

Branch: `ant-hill/be-runtime-20260728`
Implementation commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

## Verification

- `bunx tsc --noEmit`: PASS
- `bun test`: PASS — 383 tests, 0 failures, 1,606 assertions across 26 files
- Skips/filters: none reported by the full run; no `.only` was added
- Runtime/service actions: none; `ai.imaginethat.anthill` was not restarted
- Publication actions: none; no push, merge, PR, or deploy

The first `bunx` attempt could not create its temp files in the sandbox. I installed the
lockfile-pinned dev dependencies from Bun's offline cache without changing
`package.json` or `bun.lock`, then reran the required command successfully.

## Findings

### 1. BunCommandRunner timeout never settles

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

`BunCommandRunner` now starts each command in a detached process group, races the
entire exit/stdout/stderr operation against a hard deadline, sends SIGTERM at the
deadline, schedules SIGKILL after 250 ms, and immediately resolves a
`{ exitCode: -1, timedOut: true }` result without awaiting streams beyond the
deadline.

Proof: `tests/command.test.ts` runs both hostile shapes required by the finding:
`trap "" TERM; sleep 60` and `(sleep 60) & exit 0`. Both settle at a 50 ms deadline
in about 51 ms. Before the implementation, the targeted test run was still pending
when an external 2-second harness killed it.

Deliberately left alone: no caller contracts changed; timeout results still use the
existing `CommandResult` shape.

### 2. HubState refresh promise permanently latches

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

`HubState.refresh()` records the pass start time. A future tick that sees the same
pass pending beyond 12 seconds logs a refresh-watchdog error, drops that reference,
and starts a clean pass. The stale pass's `finally` is identity-guarded so it cannot
clear a newer in-flight reference. Scheduled refresh rejections are now logged in
`index.ts`.

Proof: `tests/state-health.test.ts`, “a refresh pending beyond three tick intervals
is dropped so the next tick can complete,” uses a never-settling first collector and
proves the second pass completes and the watchdog logs. Before the implementation,
the targeted test remained pending until the 2-second harness killed it.

Deliberately left alone: the abandoned collector promise cannot be cancelled through
the current collector interfaces; the watchdog contains it and prevents a permanent
global latch.

### 3. Failed cmux RPC wipes surfaces and notifications

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

A failed terminal discovery no longer replaces the last confirmed surface set or
advances `controlHealth.lastCheckedAt`. A failed notification discovery no longer
replaces the unread notification set. The snapshot is marked stale through
`cmuxReachable: false` and the explicit discovery errors.

Proof: `tests/state-health.test.ts`, “a failed cmux poll preserves the last confirmed
surfaces and notifications without advancing check time,” starts from a linked,
notified agent, fails both probes, and proves the link, attention outcome, and last
successful check time survive while health becomes degraded.

Deliberately left alone: no new `surfacesAsOf` schema field or consecutive-failure UI
policy was added because those require shared snapshot/client files outside this
lane. Existing `controlHealth` carries the stale marker.

### 4. PulseTracker burn refresh permanently latches

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

Burn reads are raced against a 20-second deadline, which is longer than the current
2.5-second keychain plus 15-second query budgets. A timeout applies unavailable cost
state, clears the in-flight latch, and permits the next TTL retry; a late reader
cannot overwrite the result.

Proof: `tests/pulse.test.ts`, “a burn reader deadline marks stale cost unavailable and
permits a later retry,” injects a never-settling second read, proves cost becomes
unavailable, then proves a third read succeeds.

Deliberately left alone: the two subprocess implementations in `burnbar.ts` are
outside this lane's ownership. The separate unchanged-cost `costAsOf` behavior noted
by the skeptic is also a distinct finding and was not folded into this fix.

### 5. SSE heartbeat exceeds Bun's default idle timeout

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

`Bun.serve` now uses `idleTimeout: 120` seconds, safely above the existing 25-second
heartbeat.

Proof: `tests/server-runtime.test.ts` reads the actual server configuration and
heartbeat source and asserts the configured idle window is longer. It failed before
the `idleTimeout` option was added.

Deliberately left alone: the 25-second heartbeat in `app.ts` was not changed because
120 seconds already provides the required margin and this lane was not permitted to
edit that line.

### 6. BunCommandRunner has zero tests

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

Proof: `tests/command.test.ts` contains five real-process cases covering stdout and
exit zero, exit 7, spawn failure, a SIGTERM-ignoring child, and an exited parent whose
grandchild retains stdout.

Deliberately left alone: no missing-binary error taxonomy was introduced; the
existing `exitCode: -1`, diagnostic `stderr`, `timedOut: false` contract is now pinned.

### 7. Timeout branches have zero tests

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

Proof:

- `tests/control-http.test.ts`: focus timeout returns 504; send-text timeout stops
  before Enter; two Enter timeouts return 504 `TEXT_STAGED_NOT_SUBMITTED`; a timed-out
  first Enter with exit zero is retried and can succeed.
- `tests/cmux.test.ts`: terminal and notification timeouts are explicit errors, not
  successful empty discoveries.
- `tests/identity.test.ts`: `ps` and `lsof` timeout branches surface their errors and
  do not invent identity evidence.
- `tests/command.test.ts`: the real runner produces `timedOut: true` under hostile
  subprocess conditions.

Deliberately left alone: the production timeout branches in `control.ts`, `cmux.ts`,
and `identity.ts` were already correct, so this finding required tests only and those
out-of-ownership source files were not edited.

## Scope audit

Changed production files: `src/server/command.ts`, `src/server/state.ts`,
`src/server/pulse.ts`, and `src/server/index.ts`.

Changed test files only under `tests/**`. No other production, client, configuration,
documentation, package, script, or shared-runtime file was changed.
