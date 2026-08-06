# Lane BE-1 — server-owned sessionKind (Phase 1)

You are lane BE-1 in a multi-lane swarm executing
`docs/superpowers/plans/2026-08-05-unified-filtering.md`. That plan is the
spec: it contains the exact types, code, tests, and commit messages. Read it
before writing anything. This kickoff adds only lane discipline.

## Your tasks, in order

1. **Task 1.1** — shared types (`SessionKind`, `SessionKindSource`,
   `SESSION_KINDS`, `AgentSnapshot` fields, `CollectedAgent.launch`). Plan §5
   verbatim.
2. **Task 1.2** — claude parser captures launch evidence
   (`createClaudeParser` + `makeAgent` in `src/server/collectors.ts`), TDD per
   the plan.
3. **Task 1.3** — derive and publish `sessionKind`
   (`snapshot-agent.ts` beside `roleFor2`, `snapshot.ts` publish literal,
   `archive.ts` allow-list), including the fingerprint positive control and
   the one-sentence ARCHITECTURE.md addition in the same commit.
4. **Task 1.5, server half only** — `HubSettings.showReviewWorkers`
   (Steps 1–2: settings contract test + server implementation). Steps 3–4
   (client adoption in `app.js`) belong to lane FE-1 — do NOT touch
   `src/web/*`.
5. **Task 4.1** — skip out-of-band naming for sdk-launched sessions
   (`state.ts` `#nameNewSessions` filter), test-first.

Do **NOT** do Task 1.4 (deploy/server restart) — the orchestrator does that.
Do **NOT** do Task 1.2b wiring unless the orchestrator pastes lane EV-1's
marker report into this pane and says GO — the marker catalogue is EV-1's.

## File ownership (hard boundary)

Yours: `src/shared/types.ts`, `src/server/*`, `tests/collectors.test.ts`,
`tests/snapshot.test.ts`, the settings contract test file, `ARCHITECTURE.md`
(one sentence). Never edit `src/web/*`, `tests/web-client.test.ts`,
`src/web/styles.css`, `tests/health-card.test.ts` — other live lanes own them.

## Shared-worktree rules (non-negotiable)

- This worktree is shared by several concurrent lanes on branch
  `fix/cmux-control-health-lifecycle`. Re-run `git branch --show-current`
  immediately before every commit; if the branch changed, stop and report.
- Commit path-scoped only: `git commit -m "…" -- <your exact files>`.
  Never `git add -A`, never a bare `git commit -a`.
- `git status` will show foreign modifications (`src/web/app.js`,
  `src/web/styles.css`, `tests/health-card.test.ts`, untracked docs). They
  belong to other lanes. Leave them alone.
- Do not push, open PRs, or restart any service. Do not commit this kickoff
  doc or your status file.

## Verification gates

- Before each commit: `bunx tsc --noEmit` clean + the task's named test files
  green (`bun test tests/collectors.test.ts` etc. per the plan task).
- Contract landmines (plan §8): `snapshot.test.ts` clock-only fingerprint
  test must stay green; golden collector fixtures must not shift.
- A pre-existing documented failure may exist elsewhere in the full suite;
  if a failing test is in a file you don't own, report it in your status
  file and move on — do not fix other lanes' files.

## Status protocol

After each task (and on any blocker), append one line to
`docs/LANE-BE1-STATUS.md`:

```
[HH:MM] T1.1 DONE <short-sha>
[HH:MM] T1.2 BLOCKED <one-line reason>
```

Finish line when all five tasks are committed: `[HH:MM] LANE DONE`.
