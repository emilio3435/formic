# Server Lane Report

## What the lane was

Server-side classification and identity-prerequisite lane from exact head
`bad2ac431246fa30e99295cae3d10879e7d7c5b3` on local branch
`feat/rhsp-system-monitor-server`.

The lane had two independent contracts:

- declare only `prime:ant-heartbeat-monitor` as provider-neutral system
  infrastructure while inventing no route or runtime identity;
- recognize the current versioned Cursor wrapper only far enough to inspect
  its open files, leaving exact store/transcript evidence authoritative.

## Which claims went red first

Baseline before adding regressions:

```text
$ bun test tests/b2-render-proof.test.ts tests/cursor.test.ts
46 pass
0 fail
127 expect() calls
Ran 46 tests across 2 files. [285.00ms]
```

Prime exact-ID regression:

```text
$ bun test tests/b2-render-proof.test.ts
error: expect(received).toMatchObject(expected)

-   "sessionKind": "system",
-   "sessionKindSource": "declared",

(fail) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > the exact reserved Prime heartbeat monitor is declared system without routing authority [8.59ms]

11 pass
1 fail
45 expect() calls
Ran 12 tests across 1 file. [63.00ms]
```

The ordinary stable ID, UUID, and near-match ID safety controls all passed in
that same red run; only the exact reserved monitor was missing its declaration.

Cursor wrapper regression:

```text
$ bun test tests/cursor.test.ts
error: expect(received).toBeTrue()
Received: false

(fail) Cursor Agent live pane identity > recognizes only allowlisted Cursor stores, transcripts, resume argv, and versioned wrapper [1.00ms]

error: expect(received).toMatchObject(expected)

-   "resolution": "exact",
-   "surfaceId": "CURSOR-SURFACE",
-   "workspaceId": "CURSOR-WORKSPACE",
+   "reason": "2 unclaimed cmux surfaces share this cwd; controls are disabled.",
+   "resolution": "ambiguous",

(fail) Cursor Agent live pane identity > an open Cursor store maps the exact surface even when cwd is duplicated [3.84ms]

36 pass
2 fail
90 expect() calls
Ran 38 tests across 1 file. [284.00ms]
```

## What shipped, file and fence

- `src/server/types.ts`: typed the optional collected `sessionKind` and
  `sessionKindSource` evidence already preserved by snapshot publication.
- `src/server/prime.ts`: exact normalized equality against the one reserved
  source ID and a declared `system` classification. No prefix, stable-ID-shape,
  target, process, or surface rule was added.
- `src/server/identity.ts`: admitted only a generic `agent` executable paired
  with Cursor's versioned `.local/share/cursor-agent/.../index.js` entrypoint.
  The wrapper emits no identity hint; allowlisted open-file evidence is still
  required.
- `tests/b2-render-proof.test.ts`: exact monitor parse/snapshot proof plus
  ordinary stable, UUID, near-match, transcript-tail, and no-route assertions.
- `tests/cursor.test.ts`: positive wrapper/open-store regression and a negative
  generic `/tmp/index.js` control.
- `LANE-REPORT-server.md`: this evidence record.

No files outside the owned fence were edited.

## Floor results pasted

Focused floor:

```text
$ bun test tests/b2-render-proof.test.ts tests/cursor.test.ts
bun test v1.3.14 (0d9b296a)

tests/b2-render-proof.test.ts:
(pass) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > the exact reserved Prime heartbeat monitor is declared system without routing authority [16.72ms]
(pass) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > an ordinary stable Prime session id is not declared system [0.17ms]
(pass) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > an ordinary UUID Prime session id is not declared system [0.11ms]
(pass) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > a near-match Prime heartbeat id is not declared system [0.13ms]
(pass) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > renderAgentRow surfaces transcriptTail containing [TL;DR [3.12ms]
(pass) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > renderAgentDrawer Chat surfaces transcriptTail [TL;DR] [0.46ms]
(pass) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > the header parser accepts bounded v3 JSON and keeps the legacy fallback [0.30ms]
(pass) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > wire caps non-envelope tails to 800; [TL;DR envelopes keep the 6000 backstop [15.29ms]
(pass) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > row caps [TL;DR] via conciseText 120 even when wire tail is 800 [1.00ms]
(pass) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > prime parser caps tail to MAX_TRANSCRIPT_TAIL_CHARS and retains [TL;DR] when under cap [0.27ms]
(pass) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > full transcript on disk is never truncated — jsonl retains all lines, only wire tail caps to 800 [0.61ms]
(pass) B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js > 6/6 healthy counts PROVIDERS (6: omp, codex, claude, cursor, factory, prime) not providers+cmux [0.35ms]

tests/cursor.test.ts:
(pass) Cursor Agent persisted session truth > parses exact session, cwd, model, task, tail, status, and unknown billing honestly [1.96ms]
(pass) Cursor Agent persisted session truth > keeps a fresh Cursor session working despite a stale turn_ended:success record [0.17ms]
(pass) Cursor Agent persisted session truth > a streaming transcript mtime keeps a session working when turn-boundary metadata is stale [0.05ms]
(pass) Cursor Agent persisted session truth > Cursor ignores tool output and diff text while retaining readable assistant prose [0.83ms]
(pass) Cursor Agent persisted session truth > publishes Cursor's role-attributed closing so a final approval fork remains readable [0.45ms]
(pass) Cursor Agent persisted session truth > parses a Cursor child as a real parent-linked session with its own model [0.40ms]
(pass) Cursor Agent persisted session truth > an aborted Cursor child reports the failure without being declared over [0.11ms]
(pass) Cursor Agent persisted session truth > a Cursor child that just finished a turn is waiting, not ended [0.06ms]
(pass) Cursor Agent persisted session truth > marks an old unended Cursor child stale instead of keeping it live for 36 hours [0.05ms]
(pass) Cursor Agent persisted session truth > does not invent a model id from English prose in a system prompt [6.50ms]
(pass) Cursor Agent persisted session truth > prefers meta lastUsedModel over the newest assistant blob modelName [3.47ms]
(pass) Cursor Agent persisted session truth > falls back to the newest assistant blob modelName, detecting Composer models [4.62ms]
(pass) Cursor Agent persisted session truth > caches unchanged stores and invalidates when their fingerprint changes [5.15ms]
(pass) Cursor Agent persisted session truth > bounds fallback blob inspection to the newest 200 records [75.47ms]
(pass) Cursor Agent persisted session truth > reads a WAL-mode store immutably when the read-only handle cannot create SQLite sidecars [6.79ms]
(pass) Cursor Agent persisted session truth > the shared foreign-store reader cannot mutate its source database [1.69ms]
(pass) Cursor Agent persisted session truth > rejects a store whose authoritative agentId conflicts with its session directory [0.18ms]
(pass) Cursor Agent persisted session truth > removes Cursor's transport envelope from the visible task and display name [0.14ms]
(pass) Cursor Agent persisted session truth > uses a readable project fallback when a generic Cursor session has no task [0.05ms]
(pass) Cursor Agent persisted session truth > silently skips retained stores whose chat metadata is gone [2.73ms]
(pass) Cursor Agent persisted session truth > silently skips Cursor metadata that marks a retained directory as non-conversation [2.02ms]
(pass) Cursor Agent persisted session truth > collects Cursor GUI agents from the live conversation index without CLI chat metadata [10.35ms]
(pass) Cursor Agent persisted session truth > a missing GUI conversation store is unknown rather than an empty population [42.01ms]
(pass) Cursor Agent persisted session truth > an unreadable GUI conversation store names permissions and the missing population [8.64ms]
(pass) Cursor Agent persisted session truth > a corrupt GUI conversation store names corruption and the missing population [5.70ms]
(pass) Cursor Agent persisted session truth > a locked GUI conversation store is unknown for one scan and recovers on the next [9.29ms]
(pass) Cursor Agent persisted session truth > an unsupported GUI conversation schema names the incompatible store [6.72ms]
(pass) Cursor Agent persisted session truth > reads a stable WAL conversation store without requiring writable sidecars [7.27ms]
(pass) Cursor Agent persisted session truth > reads the GUI model and effort from composerData, overriding ai-tracking [10.85ms]
(pass) Cursor Agent persisted session truth > an unreadable composerData record degrades the source instead of reading as no model [10.48ms]
(pass) Cursor Agent persisted session truth > a session that never wrote composerData stays silent [9.17ms]
(pass) Cursor Agent persisted session truth > falls back to ai-tracking when composerData reports the sentinel 'default' model [9.84ms]
(pass) Cursor Agent persisted session truth > fills a subagent's model from composerData by session id when no other source has it [8.05ms]
(pass) Cursor Agent persisted session truth > keeps Cursor sessions out of the token usage and burn rollups [2.10ms]
(pass) Cursor Agent live pane identity > recognizes only allowlisted Cursor stores, transcripts, resume argv, and versioned wrapper [0.78ms]
(pass) Cursor Agent live pane identity > an open Cursor store maps the exact surface even when cwd is duplicated [2.28ms]
(pass) Cursor Agent live pane identity > duplicate cwd without exact Cursor evidence remains ambiguous [0.26ms]
(pass) Cursor Agent live pane identity > a GUI-only Cursor agent cannot claim an unrelated cmux pane by cwd [0.05ms]

 50 pass
 0 fail
 144 expect() calls
Ran 50 tests across 2 files. [334.00ms]
```

Typecheck:

```text
$ bun run typecheck
$ bunx tsc --noEmit
```

Exit code `0`.

Diff check:

```text
$ git diff --check
```

No output; exit code `0`.

## Anything unverified

- Full cross-lane integration, browser geometry, live snapshot, and live debug
  identity are integration-owner responsibilities and were not run in this
  server-only lane.
- The first sandboxed typecheck was blocked from Bun's temp directory. An
  escalated retry then exposed the isolated worktree's missing `node_modules`.
  Linking the worktree to the repository's existing dependency tree made the
  exact `bun run typecheck` command pass. `node_modules` remains ignored and is
  not part of the lane diff or commit.
- No service was started or restarted, and no live port was touched.
