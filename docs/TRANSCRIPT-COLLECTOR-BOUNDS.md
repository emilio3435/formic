# Transcript collector memory bounds

Formic scans recent agent transcripts on startup and then incrementally reads
their appended bytes. A fleet can have hundreds of recent JSONL files, including
individual transcripts hundreds of megabytes long, so the collector must never
materialize the whole fleet at once.

The production invariants are:

- Providers may collect in parallel, but each provider processes its transcript
  files sequentially.
- A cold or reset transcript is read and parsed in 1 MiB chunks.
- Parsed rows are handed to the provider in batches bounded by the same 1 MiB
  source budget. A single oversized JSON record is the unavoidable upper bound;
  unrelated records are released immediately after that provider sees them.
- An incremental append is buffered only up to 1 MiB. A larger append is
  reparsed through the bounded cold-read path.
- File identity, size, and modification time are checked after a read. A file
  that changed mid-read is retried once from a fresh parser; a second change is
  reported instead of publishing a mixed snapshot.
- The final incomplete JSONL record remains cached as a copied remainder and is
  completed by the next append.
- Grok's nested project/session collector obeys the same sequential file bound.
  Its `updates.jsonl` parser retains only the first task, latest readable
  user/assistant candidates, latest assistant tail, clocks, and completion
  state; tool payloads and older message rows do not survive the streaming pass.

The general regression runs a 400-session cold scan with a 64-file-descriptor
limit. The Grok regression repeats that fleet under a 16-descriptor ceiling.
The pre-fix nested `Promise.all` Grok scan fails that test; the bounded collector
must return all 400 sessions with zero collection errors. Chunk-boundary tests
separately prove that records larger than one read chunk and the following
records or incremental append remain intact.

Focused verification:

```bash
bun test tests/collectors.test.ts tests/grok.test.ts tests/grok-extra-root.test.ts
bun run typecheck
```

On the 2026-08-22 production corpus, two isolated Grok passes each returned 74
sessions with zero errors in about one second. Maximum resident memory was
192,921,600 bytes across both passes, down from the pre-fix 8.1 GB peak. An
all-history stress pass returned 1,192 sessions with zero errors and stayed
below 414 MB.

When Formic is deployed as a background service, deployment verification must
also prove `/api/health`, observe the process through its first full scan, and
confirm a second refresh does not recreate the cold-start peak.
