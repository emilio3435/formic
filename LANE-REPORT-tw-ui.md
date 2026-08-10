# LANE-REPORT — TW-UI

## 1. What this lane was

Ship the Task Widget redesign DOM/CSS anatomy on `feat/tw-ui-anatomy` (worktree `tw-ui-grok`), consuming the already-landed `parseTaskEnvelope` parser and `rawTask` Foundation. Plan Tasks 1, 4–6 (Task 2+3 pre-landed); CSS amended: intrinsic closed face, Full brief body as sole scroller (`max-height: 18rem`), 25% cap removed.

## 2. Which claims went red first (named tests)

- `FE-C: … > Task widget anatomy: objective + meta + closed Full brief from one DOM` — failed before `_taskBlock` rewrite (`drawer-task-objective` absent; face still `drawer-task-full`).
- Adjusted claim in `the role chip tops the desk…` — empty task now expects honest `— no task recorded` face (was “no card”).

## 3. What shipped, file-and-fence

Fence: `src/web/app.js`, `src/web/styles.css`, `src/web/presentation.js` (untouched — parser already landed), `tests/web-client.test.ts`, `tests/task-envelope.test.ts` (untouched).

| Commit | Paths |
|---|---|
| `581f738` | `docs/rhs-shots/task-widget/BASELINE.md` |
| `9e88e16` | `src/web/app.js`, `tests/web-client.test.ts` |
| `bbe5a90` | `src/web/styles.css` |
| (this report + BASELINE closeout) | `LANE-REPORT-tw-ui.md`, `docs/rhs-shots/task-widget/BASELINE.md` |

Behavior:
- One anatomy: head → objective (2-line clamp / empty face) → meta → closed `<details>` Full brief.
- `rawTask` present → face = refined `task`; brief body = original envelope; meta parsed from envelope.
- Role badge stays on the desk (chat contract); not reintroduced into the Task card.
- Removed `.drawer-task-full` and the ≥861px 25% widget cap; `.drawer-task-brief-body` is the only widget scroller.

## 4. Floor results pasted, not paraphrased

```
$ bunx tsc --noEmit
TSC_EXIT:0

$ bun test
… (full log: .lane-evidence/final-floor.txt)

26 tests failed:
(fail) what this board counted is what a separate application recorded > the join drops a whole provider, and the size of that hole is pinned [0.14ms]
(fail) what this board counted is what a separate application recorded > no uuid session silently falls out of the join [0.06ms]
(fail) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > renderAgentRow surfaces transcriptTail containing [TL;DR [2.77ms]
(fail) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > row caps [TL;DR] via conciseText 120 even when wire tail is 800 [1.01ms]
(fail) collector identity and usage truth > OMP exposes its final observed turn separately from the cumulative session total [1.15ms]
(fail) collector identity and usage truth > OMP keeps the cumulative session total separate from the latest assistant turn [0.25ms]
(fail) every provider is visible to the process scanner > prime: an open transcript names its session [0.14ms]
(fail) a total collection failure never renders as a calm empty fleet > zero tracked agents from every dead source is reported as fully degraded [0.39ms]
(fail) a total collection failure never renders as a calm empty fleet > every dead source raises its own issue, so the cause is never anonymous [0.26ms]
(fail) ARCHITECTURE.md stays true to the code it maps > it names every module that exists, and every module it names exists [1.12ms]
(fail) the executable scripts do what DEPLOY.md says they do > DEPLOY.md accounts for every shell script that exists [0.25ms]
(fail) day one on a machine without cmux > QUICKSTART quotes the empty-board strings the model renders [0.21ms]
(fail) day one on a machine without cmux > QUICKSTART names every collector the code has, with the path it reads [0.13ms]
(fail) ANT-GUIDE tells a reader how to find their own blind spot > the collectors it tells them to compare against are the real ones [0.23ms]
(fail) byProvider carries history, which one snapshot cannot > a collector that has never been healthy has no lastHealthyAt [0.55ms]
(fail) byProvider carries history, which one snapshot cannot > a successful read records when it happened [0.20ms]
(fail) byProvider carries history, which one snapshot cannot > a collector that WAS healthy keeps its timestamp when it fails [0.15ms]
(fail) byProvider carries history, which one snapshot cannot > recovery refreshes the timestamp rather than keeping the stale one [0.15ms]
(fail) byProvider carries history, which one snapshot cannot > one collector's failure does not disturb its neighbours' history [0.16ms]
(fail) byProvider carries history, which one snapshot cannot > every provider the union declares appears on the wire [0.13ms]
(fail) every collected provider survives the refresh > a session from any provider reaches the board, not just the ones a literal listed [0.20ms]
(fail) every collected provider survives the refresh > a provider that collected cleanly is reported healthy [0.15ms]
(fail) a provider that was never installed is absent, not degraded > the fresh-clone board: two providers installed, the rest absent [0.20ms]
(fail) Cursor Agent persisted session truth > keeps Cursor sessions out of the token usage and burn rollups [0.22ms]
(fail) Ant Hill task refiner durability > the Python behavioral suite passes [325.25ms]
(fail) (unnamed) [20048.57ms]

 2982 pass
 26 fail
 12478 expect() calls
Ran 3008 tests across 161 files. [74.90s]
```

Named TW-UI suites (all green):

```
$ bun test tests/task-envelope.test.ts tests/web-client.test.ts tests/cwd-adversarial.test.ts tests/overhaul-guards.test.ts
 595 pass
 0 fail
Ran 595 tests across 4 files. [1.62s]
```

Baseline comparison: **no new failing test names** vs `.lane-evidence/baseline-floor.txt`. Fail count 30→26 (flaky env timeouts / one OBB assertion flipped); all remaining reds are outside the TW-UI fence. Ground-rules ideal (“exactly 3 OBB reds”) is **not** what this sandbox inherited.

## 5. Anything unverified, including what the sandbox refused

- Live board `127.0.0.1:4701` serves `/Users/emilionunezgarcia/Developer/the-mountain-main` (PID 88969), **not** this worktree. Ground rules forbid lane restart/deploy → Task 1/6 before·after screenshots and live anatomy QA blocked. Integration owner must serve this checkout (or merge) for visual stop-condition.
- Ideal floor (tsc + only 3 OBB fails) not achievable here without touching foreign suites / environment (docs paths, collectors, a11y board, Python refiner suite).
- Task 3 (`rawTask` publish) verified already present in tree (`src/shared/types.ts`, `src/server/snapshot.ts`, `tests/task-refiner-launch.test.ts`) — outside fence; not re-implemented.
