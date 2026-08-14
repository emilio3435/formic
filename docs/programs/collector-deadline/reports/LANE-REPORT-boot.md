# Lane boot

## 1. What this lane was

Lane `boot` owns Phase 3 only: bound Cursor's retained caches as a **memory fix, not a latency fix**, and bind the configured HTTP port before starting the first fleet collection. The source fence is `src/server/cursor.ts` and `src/server/index.ts`; the owned regression files used are `tests/cursor.test.ts` and `tests/server-runtime.test.ts`.

## 2. Which claims went red first (named)

`bun test tests/cursor.test.ts -t 'prunes retained Cursor cache entries that are outside the current scan'`

```text
(fail) Cursor Agent persisted session truth > prunes retained Cursor cache entries that are outside the current scan [14.30ms]
error: the cache-pruning regression needs direct retained-entry evidence
Expected: "function"
Received: "undefined"
0 pass
61 filtered out
1 fail
```

`bun test tests/server-runtime.test.ts -t 'binds the HTTP port while the first fleet collection is still pending'`

```text
(fail) server runtime configuration > binds the HTTP port while the first fleet collection is still pending [146.34ms]
error: collection started before Bun.serve bound the configured port
Expected: "bound"
Received: "unbound"
0 pass
3 filtered out
1 fail
```

`bun test tests/server-runtime.test.ts -t 'a failed bind exits before starting the first fleet collection'`

```text
(fail) server runtime configuration > a failed bind exits before starting the first fleet collection [1515.08ms]
error: the second server stayed alive after its port bind failed
Received: null
0 pass
3 filtered out
1 fail
```

The cache correctness extension also went red before its guard landed:

```text
(fail) Cursor Agent persisted session truth > prunes retained Cursor cache entries that are outside the current scan [19.21ms]
Expected: "composer-2.5-fast"
Received: undefined
0 pass
61 filtered out
1 fail
```

### Mutation checks — broken rule, then restored rule

With the stale-store deletion disabled:

```text
(fail) Cursor Agent persisted session truth > prunes retained Cursor cache entries that are outside the current scan [20.64ms]
-   "stores": 0,
+   "stores": 1,
0 pass
61 filtered out
1 fail
```

With reduced-`composerData` fingerprint invalidation disabled:

```text
(fail) Cursor Agent persisted session truth > prunes retained Cursor cache entries that are outside the current scan [19.64ms]
Expected: "composer-2.5-fast"
Received: undefined
0 pass
61 filtered out
1 fail
```

With the old refresh-before-serve order restored, each runtime test failed independently by name:

```text
(fail) server runtime configuration > binds the HTTP port while the first fleet collection is still pending [485.21ms]
Expected: "bound"
Received: "unbound"
0 pass
3 filtered out
1 fail

(fail) server runtime configuration > a failed bind exits before starting the first fleet collection [1513.29ms]
error: the second server stayed alive after its port bind failed
Received: null
0 pass
3 filtered out
1 fail
```

After reverting every mutation:

```text
(pass) Cursor Agent persisted session truth > prunes retained Cursor cache entries that are outside the current scan [24.83ms]
1 pass
61 filtered out
0 fail

(pass) server runtime configuration > binds the HTTP port while the first fleet collection is still pending [950.77ms]
1 pass
3 filtered out
0 fail

(pass) server runtime configuration > a failed bind exits before starting the first fleet collection [73.48ms]
1 pass
3 filtered out
0 fail
```

## 3. What shipped — file and fence

- `src/server/cursor.ts`: after each Cursor scan, prune store, text, transcript, tracking, and `composerData` entries outside that scan. The small parsed-composer cache is pruned with its backing blobs. When `composerData` is reduced, its fingerprint is invalidated so a later wider scan rereads the authoritative store and restores reactivated session data.
- `src/server/index.ts`: construct the fetch stack and synchronously call `Bun.serve` before awaiting the first fleet refresh. A bind failure therefore throws before `state.refresh` or cmux-event startup.
- `tests/cursor.test.ts`: direct retained-entry regression covering all named caches plus reactivation correctness.
- `tests/server-runtime.test.ts`: isolated subprocess regressions with a deliberately pending collector and injected bind success/failure. The test continues to avoid importing `index.ts`.

No implementation or test files outside the boot fence were edited; this required lane report is the only additional file. Cursor is treated only as a memory-bound issue; no deadline or latency claim is made.

## 4. Floor results — PASTED, not paraphrased

`bunx tsc --noEmit`

```text
(no output)
exit_code=0
```

The worktree initially had no `node_modules`, so `bunx` was unable to create its package-runner temp files. `bun install --frozen-lockfile` installed the lockfile's `@types/bun@1.3.14` and `typescript@7.0.2`; the exact command above then ran silently.

`bun test tests/cursor.test.ts tests/server-runtime.test.ts`

```text
66 pass
0 fail
200 expect() calls
Ran 66 tests across 2 files. [930.00ms]
```

`bun test`

```text
10 tests failed:
(fail) what this board counted is what a separate application recorded > a settled disagreement is either explained by BurnBar, or it fails [0.23ms]
(fail) per session-row: span divided by nothing, the only bound that fires > real history: the history was actually read, so no bound passes on an empty set [0.10ms]
(fail) identities that must hold whatever window you ask for > the identities were actually evaluated, so none of them passed on an empty read [0.09ms]
(fail) identities that must hold whatever window you ask for > I3: the provider breakdown sums to the scalar it breaks down, at every window [0.13ms]
(fail) (unnamed) [2.56ms]
(fail) (unnamed) [5002.41ms]
  ^ a beforeEach/afterEach hook timed out for this test.
(fail) (unnamed) [2.45ms]
(fail) (unnamed) [5002.53ms]
  ^ a beforeEach/afterEach hook timed out for this test.
(fail) (unnamed) [0.75ms]
(fail) (unnamed) [5002.53ms]
  ^ a beforeEach/afterEach hook timed out for this test.

3515 pass
10 fail
15246 expect() calls
Ran 3525 tests across 188 files. [75.39s]
```

Focused classification of the four live-data failures:

```text
tests/cross-source-token-agreement.test.ts:
[cross-source] SKIPPED: the board is not serving at http://127.0.0.1:4701/api/snapshot (Was there a typo in the url or port?)
19 pass
1 fail
55 expect() calls

tests/physical-bounds.test.ts:
[physical-bounds] SKIPPED every real-history assertion: BurnBar returned no readable rows for 2026-06-01T00:00:00.000Z..2026-09-01T00:00:00.000Z. The bound predicates below still run against fixtures.

tests/published-identities.test.ts:
[published-identities] BurnBar unavailable; identity assertions did not run.

18 pass
3 fail
13 expect() calls
Ran 21 tests across 2 files. [55.00ms]
```

## 5. Anything unverified, including what the sandbox refused

The sandbox refused a real loopback test listener with `listen 127.0.0.1:0: EPERM`. The runtime regressions therefore use an isolated subprocess preload that records the synchronous `Bun.serve` bind boundary and injects `EADDRINUSE`; no process was launched on port 4701.

- **Full-suite floor blocked:** the required 3598 pass / 2 named failures was not available. The sandbox refused loopback listeners in three unowned geometry gates (`docs/rhsp-geometry-gate`, `docs/header-collapse-geometry-gate`, `docs/a11y-geometry-gate`), producing six failures/setup timeouts. Production `:4701` was unavailable to the cross-source gate, and BurnBar returned no readable rows, producing four loud non-vacuity failures rather than the ground rules' two quiet-fleet baseline failures. These files are outside the boot fence and were not edited.
- **Live memory proof unavailable:** RSS was not observed for one hour with Cursor active. No production process was started, restarted, or touched. The unit regression proves retained cache entries are pruned and that a pruned session's authoritative model returns when it re-enters scope; it does not substitute for the spec's one-hour RSS criterion.
- **Real socket proof unavailable:** the sandbox refused all loopback binds. The subprocess regression proves the `Bun.serve` boundary precedes the deliberately pending collection and that injected `EADDRINUSE` exits before collection; it does not claim a live TCP health response.
- **Local commit blocked:** repository policy permits a commit after the verification floor is green. Typecheck and all owned tests are green, but the required full-suite baseline is unavailable for the reasons above, so no commit was created and nothing was pushed.
