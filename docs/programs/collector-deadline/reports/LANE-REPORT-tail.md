# Lane tail
## 1. What this lane was

Status: **BLOCKED on the prescribed full-floor/live-process proof; fenced implementation and focused verification complete.**

This lane bounded the refresh publishing tail, made the two owned sequential cmux collectors fit their parent control deadline, removed the dead provider-finalization allowance, and changed watchdog replacement from write suppression alone to cooperative cancellation.

Success criteria used:

- A stuck binding, witness, archive, transcript, or Ack await cannot hold publication past one shared tail budget.
- A tail timeout publishes completed evidence, never manufactures sender verification, and logs the outstanding step only on overrun.
- Notification-summary RPCs consume thirds of their parent deadline; sidebar RPCs consume halves.
- A watchdog-superseded collector observes an aborted signal, while its replacement publishes without reporting cancellation as fleet failure.
- `src/server/identity.ts` remains untouched and its documented timeout rationale remains owned by lane `identity`.

## 2. Which claims went red first (named)

Initial red-first run:

```text
$ bun test tests/collector-deadline.test.ts tests/cmux.test.ts
(fail) cmux collector budgets fit their parent deadline > notification summary RPCs divide one parent deadline across three sequential stages
Expected: [300, 300, 300]
Received: [10000, 10000, 10000]
(fail) cmux collector budgets fit their parent deadline > sidebar RPCs divide one parent deadline across its two sequential stages
Expected: [300, 300]
Received: [10000, 10000]
(fail) the publishing tail shares one bounded deadline > a stuck identity binding write cannot hold publication
error: refresh remained stuck in identity binding persistence
(fail) the publishing tail shares one bounded deadline > a stuck process witness write cannot hold publication
error: refresh remained stuck in process witness persistence
(fail) the publishing tail shares one bounded deadline > a stuck session history write cannot hold publication
error: refresh remained stuck in session history persistence
(fail) the publishing tail shares one bounded deadline > a stuck transcript read cannot hold publication or become a sender verdict
(fail) the publishing tail shares one bounded deadline > a stuck acknowledgement reconciliation cannot hold publication
error: refresh remained stuck in acknowledgement reconciliation
(fail) watchdog cancellation is not collector failure > the superseded pass observes abort while its healthy replacement publishes cleanly
^ this test timed out after 5000ms.
(fail) the derived control deadline is the collector container > the dead provider allowance cannot inflate a 10 second provider budget past its 10 second container
Expected: 10000
Received: undefined

27 pass
9 fail
```

Every new test was mutation-checked. Targeted broken-rule output, before restoring each mutation:

```text
(fail) ... notification summary RPCs divide one parent deadline ...
Expected: [300, 300, 300]
Received: [450, 450, 450]

(fail) ... sidebar RPCs divide one parent deadline ...
Expected: [300, 300]
Received: [600, 600]

(fail) ... aborting notification summaries stops before another sequential RPC starts
Expected promise that rejects
Received promise that resolved

(fail) ... a stuck identity binding write cannot hold publication
error: refresh remained stuck in identity binding persistence

(fail) ... a stuck process witness write cannot hold publication
error: refresh remained stuck in process witness persistence

(fail) ... a stuck session history write cannot hold publication
error: refresh remained stuck in session history persistence

(fail) ... a stuck transcript read cannot hold publication or become a sender verdict
error: refresh remained stuck in sender transcript tails

(fail) ... a stuck transcript read cannot hold publication or become a sender verdict
expect("senderVerified" in (recipient ?? {})).toBeFalse()
Received: true

(fail) ... a stuck acknowledgement reconciliation cannot hold publication
error: refresh remained stuck in acknowledgement reconciliation

(fail) ... a healthy publishing tail emits no overrun line
Received: ["[HubState] publishing tail exceeded 40ms deadline; PENDING=[none]"]

(fail) ... the superseded pass observes abort while its healthy replacement publishes cleanly
^ this test timed out after 5000ms.

(fail) ... the dead provider allowance cannot inflate a 10 second provider budget past its 10 second container
Expected: 10000
Received: 11000
```

After every mutation was reverted, the owned focused floor returned to `64 pass / 0 fail`; the pasted final run is in section 4.

## 3. What shipped — file and fence

Changed only the owned implementation files and their owned tests:

- `src/server/state.ts`
  - Creates one `AbortController` per refresh drain and aborts it when the watchdog supersedes that pass.
  - Threads the signal through collector seams, races the aggregate against cancellation, suppresses cancellation from operator-facing collection errors, and prevents superseded fire-and-forget group ticks.
  - Gives binding persistence, process-witness persistence, archive persistence, sender transcript reads, and Ack reconciliation one shared 5,000ms production tail budget. Test-injected aggregate deadlines may shrink, never enlarge, that cap.
  - Publishes completed evidence on tail overrun, leaves timed-out sender verification unavailable, and logs the sorted `PENDING=[...]` step only on an overrun.
  - Deletes `PROVIDER_FINALIZATION_ALLOWANCE_MS`; the control container is `max(10_000, providerWaitMs)`.
  - Passes the resulting parent deadline into the owned sidebar and sync-notification collectors.
- `src/server/cmux.ts`
  - Adds a deadline/signal budget to `collectCmuxNotificationSummaries` and `collectCmuxSidebar`.
  - Derives per-RPC caps as parent/3 and parent/2 respectively; per-window fanout remains parallel.
  - Stops the owned collector from issuing later sequential RPCs after cancellation.
- `tests/collector-deadline.test.ts`
  - Adds red-first, mutation-checked coverage for all five tail seams, sender-verdict absence, healthy log silence, watchdog cancel-vs-fail, and the removed provider allowance.
- `tests/cmux.test.ts`
  - Adds mutation-checked derived-budget and cancellation coverage.
- `tests/state-health.test.ts`
  - Owned and run unchanged as a compatibility floor.

Judgment call: I shrank the two cmux collectors because blame/current source contains no documented reason for the old 10,000ms per-RPC values. Notification summaries now get three 3,333ms sequential stages under the default 10,000ms parent; sidebar gets two 5,000ms stages. I did not clip identity's documented retry budgets or edit `src/server/identity.ts`.

## 4. Floor results — PASTED, not paraphrased

TypeScript, exact final source:

```text
$ bunx tsc --noEmit
[no stdout/stderr]
exit 0
```

Owned focused floor, exact final source:

```text
$ bun test tests/collector-deadline.test.ts tests/state-health.test.ts tests/cmux.test.ts

64 pass
0 fail
239 expect() calls
Ran 64 tests across 3 files. [3.79s]
exit 0
```

Whitespace/diff floor:

```text
$ git diff --check
[no stdout/stderr]
exit 0
```

Full floor, exact final source:

```text
$ set -o pipefail; bun test 2>&1 | tail -40
error: Failed to start server. Is port 0 in use?
 syscall: "listen",
   errno: 0,
    code: "EADDRINUSE"

10 tests failed:
(fail) what this board counted is what a separate application recorded > a settled disagreement is either explained by BurnBar, or it fails [0.18ms]
(fail) per session-row: span divided by nothing, the only bound that fires > real history: the history was actually read, so no bound passes on an empty set [0.07ms]
(fail) identities that must hold whatever window you ask for > the identities were actually evaluated, so none of them passed on an empty read [0.11ms]
(fail) identities that must hold whatever window you ask for > I3: the provider breakdown sums to the scalar it breaks down, at every window [0.12ms]
(fail) (unnamed) [2.35ms]
(fail) (unnamed) [5002.09ms]
  ^ a beforeEach/afterEach hook timed out for this test.
(fail) (unnamed) [1.81ms]
(fail) (unnamed) [5002.29ms]
  ^ a beforeEach/afterEach hook timed out for this test.
(fail) (unnamed) [0.84ms]
(fail) (unnamed) [5002.21ms]
  ^ a beforeEach/afterEach hook timed out for this test.

3523 pass
10 fail
15259 expect() calls
Ran 3533 tests across 188 files. [63.73s]
exit 1
```

Exact-HEAD source snapshot control under `.lane-evidence/base`:

```text
$ git archive HEAD | tar -x -C .lane-evidence/base
$ (cd .lane-evidence/base && bun test)

3508 pass
14 fail
15231 expect() calls
Ran 3522 tests across 188 files. [64.23s]
exit 1
```

The snapshot has exactly 11 fewer tests (the 11 new lane tests) and reproduces all candidate listener/live-data failures. Its four additional failures are repo-identity checks that require `.git`, which `git archive` intentionally does not contain.

## 5. Anything unverified, including what the sandbox refused

- **BLOCKED local commit:** the required path-scoped staging was refused before any path was staged:

  ```text
  $ git add -- src/server/state.ts src/server/cmux.ts tests/collector-deadline.test.ts tests/cmux.test.ts
  fatal: Unable to create '/Users/emilionunezgarcia/Developer/the-mountain/.git/worktrees/cd-tail/index.lock': Operation not permitted
  $ git add -f -- LANE-REPORT-tail.md
  fatal: Unable to create '/Users/emilionunezgarcia/Developer/the-mountain/.git/worktrees/cd-tail/index.lock': Operation not permitted
  ```

  No files are staged and no local commit exists. The working-tree changes remain intact; nothing was pushed.
- **BLOCKED full floor:** the documented `3598 pass / 2 fail` result was not obtainable. The restricted sandbox refuses ephemeral listeners: all three geometry gates that call `Bun.serve({ port: 0 })` fail with `EADDRINUSE`, then their cleanup hooks time out, producing six failures. The exact-HEAD snapshot reproduces them.
- **BLOCKED live-data floor:** this session cannot reach the production board at `http://127.0.0.1:4701/api/snapshot`. The isolated cross-source file reports `cross-source check did not run: the board is not serving ...`; the remaining full-floor live-history/identity failures are also absence-of-data assertions. Nothing was launched on 4701 and no production checkout was touched.
- **Cancellation boundary:** the superseded `HubState` pass returns, publishes nothing stale, reports no cancellation fault, and the owned cmux collector issues no subsequent RPC. `CommandRunner.run` has no `AbortSignal` parameter and is outside this lane's file fence, so an already-started subprocess cannot be proven killed by this lane; it remains bounded by the newly derived RPC timeout. If process-group termination on watchdog abort is required beyond cooperative pass cancellation, the orchestrator must assign `src/server/types.ts` and `src/server/command.ts` to an owning lane.
- `src/server/identity.ts` was deliberately skipped as required. Its nested timeout work and rationale remain lane `identity`'s responsibility.
