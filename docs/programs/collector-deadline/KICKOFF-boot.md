# Lane `boot` — bound the memory, serve before you collect

**Read `docs/programs/collector-deadline/GROUND-RULES.md` first.** Then spec §1, §2, §3 Phase 3.

## Mission

Two independent defects with the same flavour: the board does unbounded work before it is ready
to be useful. Caches that never prune, and a cold start that collects the whole fleet before it
binds its port.

## Your fence

`src/server/cursor.ts`, `src/server/index.ts`, and their test files
(`tests/cursor*.test.ts`, `tests/server-runtime.test.ts`, `tests/anthill-scripts.test.ts` —
check which exist and apply).

**Not yours:** `src/server/state.ts` (lane `tail`), `src/server/identity.ts` (lane `identity`).

## Tasks

### 3a — bound the caches

`cursorStoreCache`, `cursorTextCache`, `cursorTranscriptCache`, `cursorTrackingCache`, and
`cursorStateCache.composerData` (`cursor.ts:37-49`) are **never pruned**. `fileCache` in
`collectors.ts:1137-1139` shows the house pattern for doing it right — follow that, do not
invent a second one. (`collectors.ts` is not your fence; read it, don't edit it.)

Measured: the live board holds **2.28 GB RSS at 13 minutes** and grew **+155 MB over 25
minutes**. The cache key for Cursor's store is a stat fingerprint that includes Cursor's
write-ahead log, so while Cursor runs the fingerprint changes constantly, every pass misses, and
each miss materializes **67 MB** of blob values into a retained Map.

**Read this carefully, it changes what "success" means:** Cursor is **NOT** what spends the
collector deadline. That was one of four theories that died on measurement — the whole Cursor
scan sits inside `providers=430ms`. **This is a memory fix, not a latency fix.** Do not justify
your changes by claiming deadline relief, and do not sacrifice correctness of the Cursor data
for speed it does not need.

Success is RSS flat across an hour, with Cursor's session data still correct.

### 3b — bind the port before the first collection

`index.ts:64` runs a full `await state.refresh({ cmux: true })` **before** `Bun.serve` at
`:101`. Two consequences, both observed:

1. The deploy script's health check reports `UNHEALTHY` while the server is fine — it retries
   ~10 times and gives up before the cold collection finishes binding. That happened on two
   deploys tonight and produces a false "revert the unhealthy change" instruction.
2. A second hub crash-looping on `EADDRINUSE` (**16,374** occurrences in the log) ran a
   complete cold collection — the 7.5 GB Cursor scan, the file walk, `ps`, `lsof`, five cmux
   RPCs — on **every one** of its restarts, before dying on the port it could never have.

Serve first, collect after. `/api/health` already distinguishes a fresh snapshot from a stale
one (`app.ts`, `maxAgeMs`), so an early-but-honest board is strictly better than a late one.

**Do not break this property:** a server that cannot bind must still exit rather than run as a
headless collector. Reordering must not turn a failed bind into a silent background process —
that would multiply the crash-loop problem rather than fix it. Test that case explicitly; it is
the one most likely to regress silently.

## Non-negotiables

- Every test mutation-checked, before/after pasted into your report. The likely hollow test here
  is a bind-order test that passes because nothing was ever slow — make the collection slow in
  the test and assert the port is already listening.
- `tests/server-runtime.test.ts` deliberately does **not** import `index.ts` (it reads the file
  as text) because importing it calls `Bun.serve` at module scope. Respect that; do not "fix" it
  by importing.
- Never launch on :4701. Any test board uses an explicit free `MOUNTAIN_PORT`.

## Definition of done

`bunx tsc --noEmit` silent · your test files green · full `bun test` at 3598 pass / 2 fail ·
lane report section 4 holding pasted output · committed locally, path-scoped, not pushed.
