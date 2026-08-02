# What no test touches in `src/server`

Derived from `bun test --coverage` at 1,488 passing tests, not from reading the
code and guessing. Ranked by what an operator loses if the path breaks
**silently** — a loud failure is a smaller problem than a quiet one.

The headline is that coverage is genuinely high, and the gaps are not where the
day's arguments were. `pulse.ts`, `snapshot.ts`, `snapshot-agent.ts`,
`attention-signal.ts`, `targets.ts`, `snapshot-programs.ts`,
`snapshot-operator-issues.ts` and `types.ts` are at **100%**.

**Everything on this list leaves the process.** A subprocess, a composition
root, real file writes, a heartbeat timer, a deadline path. The untested surface
is the I/O boundary, not the logic.

---

## Files no test imports at all

Two, found by checking which `src/server/*.ts` produce no coverage row — a file
nothing imports does not appear in the report, which makes absence easy to miss.

### 1. `burnbar-query.ts` — 91 lines — **highest stakes on the list**

Runs in its own Bun process (it must: `Database.setCustomSQLite` would collide
with the hub's plaintext Cursor opens). It is the only thing between the hub and
OpenBurnBar's encrypted database, and it carries three guards, none exercised:

- **`assertSelectOnly()`** — strips block and line comments, then requires the
  statement to start `with|select|pragma` AND rejects
  `insert|update|delete|drop|alter|attach|detach|rekey|vacuum`. The hub only
  ever reads BurnBar; this is what makes that true.
- **Key charset validation** — `^[A-Za-z0-9+/=_-]+$`. The passphrase is
  interpolated directly into `PRAGMA key = '${key}'`, so this is the injection
  guard, not a tidiness check.
- **The error path** — carries the comment *"Never include env secrets in the
  error payload"*, and nothing checks that the passphrase stays out of it.

**Silent-failure cost:** a mutated or dropped cost database belonging to another
application, or a leaked passphrase, from code whose own comments describe it as
a security boundary. Being a separate process is exactly why nothing imports it,
and exactly why nothing noticed.

### 2. `index.ts` — 85 lines — the composition root

`MOUNTAIN_PORT` validation, `loadCmuxSocketEnv`, and the wiring of nine stores
into `HubState`.

**Silent-failure cost:** low. The server fails to start or starts mis-wired —
loud, and we restart it constantly. Listed for completeness, not urgency.

---

## Largest untouched blocks inside covered files

| # | Location | What it is | Silent-failure cost |
|---|---|---|---|
| 3 | `burnbar.ts:927–1022` (**95 lines**) | the whole of `getUsageSeries` | **CLOSED — and it was already broken.** The chart summed cumulative session snapshots the summary had stopped counting: 4.65B tokens and $3,489.57 more than the headline over 30 days, from 28 rows. Fixed and pinned in `tests/usage-series.test.ts` |
| 4 | `cursor.ts:919–973`, plus ~40 scattered | Cursor GUI metadata parse, `hasConversation`, window filter | Cursor sessions silently absent from the board — the failure mode of two of the five reproduced defects |
| 5 | `identity.ts:577–584` | conflicting recognised-command identity conflict | a misattributed session, which is the write gate's input |
| 6 | `state.ts:259–263` | `unavailableSessions()` — what every collector reports when the aggregate deadline fires | on a slow machine the whole fleet reports failure at once; the shape of that report is untested |
| 7 | `app.ts:862–865` | the 25-second SSE heartbeat | **CLOSED.** No live defect, but the first test written for it was theatre — see below. `tests/sse-heartbeat.test.ts` |
| 8 | `debug-identity.ts:160–184` | per-provider transcript row extraction | the drawer transcript shows nothing, or the wrong role. Debug-only surface |
| 9 | `archive.ts:26, 29, 200–204` | real `mkdir`/`writeFile`, and `archivedAgents()` | history not persisted. Tests use in-memory file operations throughout, so the real ones are never run |

---

## How to read this list

It is a map, not a backlog. The tests lane decides what to close and in what
order; the value here is knowing the shape of what is unexamined rather than
closing the first entry.

One caveat worth stating: **coverage measures execution, not assertion.** A line
counted here as covered may be executed by a test that never asserts anything
about it. This list is therefore a lower bound on what is unexamined — it finds
what is never *run*, and says nothing about what is run but unchecked. Today
produced two defects that hid in exactly that second category, behind assertions
that measured a fixture rather than the producer.

## Progress

| Entry | State |
|---|---|
| 1 `burnbar-query.ts` | closed — `tests/burnbar-query.test.ts` |
| 3 `getUsageSeries` | closed — `tests/usage-series.test.ts`, **and it found a live defect** |
| 4 Cursor GUI admission | closed — `tests/cursor-gui-admission.test.ts`, **found a duplicated error report** |
| 7 SSE heartbeat | closed — `tests/sse-heartbeat.test.ts`. No defect in the code; one in the first test |
| 2 `index.ts` | **skipped deliberately.** Loud on failure, and it cannot be imported — `Bun.serve` runs at module scope. Testing it means asserting on source text, which is what broke `server-runtime.test.ts` |

Worth recording after four: **three of the four yielded a defect rather than only
coverage.** Entry 1's comment-stripping was covered only by accident, by a
neighbouring guard; entry 3's chart disagreed with the headline by a third;
entry 4 reported one unreadable directory as two faults.

Entry 7 is the exception, and it taught something the other three did not. The
code was correct; the first test written for it was not. It cancelled a stream
and asserted `expect(true).toBe(true)`, and it passed with the `clearInterval`
line deleted. The leak is genuinely invisible in-process — the next beat throws
into `enqueueClient`'s catch, which calls `removeClient` and swallows it — so
the assertion had to move to whether a subprocess can exit at all. **An
untested path can be closed by a test that examines nothing**, which is the
same failure the caveat above describes, arriving from the other direction.

---

## Which remaining entries produce figures nothing cross-checks

Entry 3 was a live defect precisely because `getUsageSeries` had no sibling
figure to contradict it: the chart and the headline were two views of one
window, and only one of them was ever checked. That property — *does anything
else on this board disagree if this breaks* — predicts risk better than line
count does, so the remaining entries are classified by it.

| # | Entry | Cross-checked by | Verdict |
|---|---|---|---|
| 9 | `archive.ts` real `mkdir`/`writeText`, `archivedAgents()` | **nothing** | **The only remaining entry in entry 3's position.** Persisted history has no second source by construction: after a restart the archive either holds what happened or it does not, and no other figure on the board would contradict a wrong one. The real file operations are additionally never executed — every test substitutes in-memory ones — so a fault in `nodeFileOperations` appears only on a real machine, and appears as history that quietly was not there |
| 6 | `state.ts:259–263` `unavailableSessions()` | partially | It reports `value: []` **and** an error per provider, so the health card contradicts a silently-empty board: an operator seeing zero agents also sees four unhealthy sources. What is *not* cross-checked is the **reason** — `collectionErrors[0] ?? deadlineError` publishes whichever error happened to land first, so a deadline can be reported under an unrelated collector's message. Presence is checked; attribution is not |
| 5 | `identity.ts:577–584` | the write gate | Cross-checked by construction rather than by a second figure. An `identityConflict` empties `sourceSessionIds`, so `resolution` is not `exact`, so `canWriteToTarget` refuses. A misattribution here cannot reach a write without also disabling the control |
| 8 | `debug-identity.ts:160–184` | n/a | Produces no figure — a debug drawer transcript. Wrong output is visible to whoever opened the drawer and read nowhere else |
| 2 | `index.ts` | n/a | Produces no figure. Fails loudly at startup |

So: **entry 9 is the one left worth ranking on this basis**, and it is the last
untouched entry on the list that sits where entry 3 sat. Entry 6 is worth
taking for its second half — the reason, not the presence — but a wrong reason
is a smaller loss than history that was never written.
