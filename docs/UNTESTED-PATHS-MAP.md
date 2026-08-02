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
| 3 | `burnbar.ts:927–1022` (**95 lines**) | the whole of `getUsageSeries` | the Usage chart draws wrong or empty. Nothing else reads the series, so no other number contradicts it |
| 4 | `cursor.ts:919–973`, plus ~40 scattered | Cursor GUI metadata parse, `hasConversation`, window filter | Cursor sessions silently absent from the board — the failure mode of two of the five reproduced defects |
| 5 | `identity.ts:577–584` | conflicting recognised-command identity conflict | a misattributed session, which is the write gate's input |
| 6 | `state.ts:259–263` | `unavailableSessions()` — what every collector reports when the aggregate deadline fires | on a slow machine the whole fleet reports failure at once; the shape of that report is untested |
| 7 | `app.ts:862–865` | the 25-second SSE heartbeat | the board stops updating and looks merely quiet — "stale reads as calm", the class this project keeps removing |
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

Entry 1 is closed by `tests/burnbar-query.test.ts`.
