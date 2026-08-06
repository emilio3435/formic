# S0-T1 dead-time measurement

Measured 2026-08-06 UTC (2026-08-05 CDT) from three live `/api/snapshot`
passes more than 60 seconds apart. The same Codex session,
`codex:019fd4b7-1984-7de2-9016-8228a9eef89d`, stayed `needsInput` and
`processAlive:true` throughout.

| Pass | `generatedAt` | needsInput rows | session `hookLifecycleAt` |
|---|---|---:|---|
| 1 | `2026-08-06T01:38:54.931Z` | 38 | `2026-08-06T01:38:51.896Z` |
| 2 | `2026-08-06T01:40:16.853Z` | 37 | `2026-08-06T01:39:16.199Z` |
| 3 | `2026-08-06T01:41:40.214Z` | 37 | `2026-08-06T01:40:41.667Z` |

The state held while `hookLifecycleAt` advanced
`01:38:51.896 → 01:39:16.199 → 01:40:41.667`. It is a hook heartbeat/write
clock, not the instant the current person-blocked interval began.

## Candidate entry signals

- `agent.hook.Notification.occurred_at` is readable but is not an entry edge.
  The same still-blocked session emitted sequence `99281` at
  `2026-08-06T01:38:51.958Z` and sequence `99477` at
  `2026-08-06T01:40:41.740Z`; the later notification repeated while the state
  already held. Treating it as entry would reset dead time during one wait.
- `Stop` can mark a hook or assistant-turn boundary, but not that the completed
  turn currently requires a person. It also was not available for every sampled
  blocked interval, so it gives both false entry candidates and missing ones.
- `UserPromptSubmit` marks the operator returning to a session: it is evidence
  that a prior wait may be ending, not that a new blocked interval began. A
  current unanswered wait naturally has no later submit event.
- Transcript message timestamps exist for some transcript-derived questions and
  handoffs, but they timestamp writing, not the attention transition. They do
  not cover control-plane permission/input requests, and partial, truncated, or
  unreadable transcripts cannot prove absence.
- The cmux journal is not durable blocked-state history. At measurement time,
  `events.jsonl.1` plus `events.jsonl` covered only from
  `2026-08-05T22:12:28.428Z` to roughly `2026-08-06T01:56Z`. Older entries had
  rolled away; restarts can leave gaps; rollover replaces `.1`; and some
  sessions had no matching event at all. A latest notification timestamp cannot
  repair those missing intervals.

**Recommendation: drop dead time entirely; do not ship `blockedSince` or
`pulse.standbyMs` from the current event sources.**
