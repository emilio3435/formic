# Foreign SQLite read contract

The hub reads databases owned and updated by other applications. Those files are evidence, not hub storage: a failed read makes the affected population **unknown**, never empty, and the hub must not write, migrate, checkpoint, or repair them.

## Incident measurement (2026-08-06)

Cursor's `~/Library/Application Support/Cursor/User/globalStorage/conversation-search.db` existed (20.6 MB, mode `0644`), was unlocked, and passed `PRAGMA quick_check`. Its header selected WAL mode, but `-wal` and `-shm` were absent. An ordinary read-only open returned `SQLITE_CANTOPEN`; an immutable read returned 251 conversations.

A later ordinary read-only probe created zero-length `-wal` and 32 KB `-shm` siblings at 07:52/07:53. The next board scan at `2026-08-06T12:52:59Z` cleared `controlHealth.errors`, removed Cursor from `staleSources`, and advanced `lastHealthyAt`. The seven-hour alert was therefore repeated WAL-sidecar failure, not a retained error: successful scans already replace per-scan errors and recover source health.

## Required behavior

- Open foreign SQLite only through `readForeignSqlite`, using a `file:` URI with `mode=ro`. No collector opens a foreign database read-write.
- When a WAL-header database has no sidecars, read an immutable snapshot and accept it only when the main file and both sidecar states are unchanged before and after the read. When live sidecars exist, use SQLite's ordinary read-only snapshot so uncheckpointed WAL rows are included.
- Return detached values and close the connection inside the helper. Never retain an immutable database handle across scans.
- Missing, permission-denied, locked/busy, corrupt/not-SQLite, incompatible-schema, or changing stores produce a collection error. The message names both the fault and which data could not be enumerated.
- Errors belong to one scan. A clean subsequent scan emits no old error; `HubState` marks the provider healthy and advances `lastHealthyAt`.
- A store that is not installed is optional only when its owning feature is absent. Once Cursor's `globalStorage` exists, a missing conversation index or project-state database is an unknown GUI population, not zero GUI sessions.

## Collector audit

Cursor's chat `store.db`, `state.vscdb`, `ai-code-tracking.db`, and `conversation-search.db` all use the shared reader. OpenBurnBar's SQLCipher helper uses it after loading the isolated SQLCipher library. Claude, Codex, OMP, and Factory collectors read files/JSONL rather than SQLite, so they have no SQLite open path to migrate.
