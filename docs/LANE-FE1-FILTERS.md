# Lane FE-1 — client filters hardening and cutover (Phases 0/2/3)

You are lane FE-1 in a multi-lane swarm executing
`docs/superpowers/plans/2026-08-05-unified-filtering.md`. That plan is the
spec: exact code, tests, fkey contracts, commit messages. Read it first.
Context: the Phase 0 slice already landed as commit `aeb8cec` — your job is
the hardening the plan lists as still missing, then the cutover and the one
Filters surface.

## THE CO-TENANCY GATE (read before anything else)

`src/web/app.js` and `src/web/styles.css` currently carry **live unstaged
hunks from another lane** (the notifications program). Until the orchestrator
types `GREENLIGHT app.js` into this pane:

- You may edit ONLY `tests/web-client.test.ts` (Task 0.1 is tests-only —
  start there).
- Do not edit or commit `src/web/app.js`, `src/web/styles.css`,
  `src/web/agent-model.js`, `src/web/client-state.js`.

After the green-light, before EVERY commit touching `src/web/*`: run
`git diff src/web/app.js src/web/styles.css` and confirm every hunk is one
you authored. If a foreign hunk is present, stop and write a BLOCKED status
line — a path-scoped commit of a co-tenanted file would bury the other
lane's work.

## Your tasks, in order

1. **Task 0.1** — pin the shelfFilter twin + count-vs-search semantics
   (tests only; allowed immediately).
2. *(wait for GREENLIGHT)* **Task 0.2** — extract `emptyListMessage(ui)`
   (fix the singular/plural copy per the plan's parenthetical, in this task).
3. **Task 2.1** — `sessionKindOf` with transition fallback
   (`agent-model.js` + gate swaps in `app.js` + seam exports).
4. **Task 1.5, client half only** (Steps 3–4) — `fetchSettings` adoption +
   `setShowReviewWorkers` → `postSettings({ showReviewWorkers })`, with the
   source-level tests. (The server half is lane BE-1's; if
   `settings.ts` doesn't yet return the field, your source-level tests still
   stand — write them against the plan's contract.)
5. **Task 3.1** — provider facet chips (activate `facetProvider`), including
   the deliberate fkey-order-pin extension.
6. **Task 3.2** — status lens chips + program clear-chip + drawer button.
7. **Task 3.3** — scan window becomes read-only collection status, plus the
   separate one-line `setView("now")` → `setView("board")` fix commit.

## File ownership (hard boundary)

Yours: `src/web/agent-model.js`, `src/web/app.js`, `src/web/client-state.js`,
`src/web/styles.css` (post-green-light), `src/web/client-catalogs.js` if a
task requires it, `tests/web-client.test.ts`. Never edit `src/server/*`,
`src/shared/types.ts`, server test files, `tests/health-card.test.ts`,
`src/web/notification-center.js`.

## Shared-worktree rules (non-negotiable)

- Branch is shared: re-run `git branch --show-current` immediately before
  every commit (expect `fix/cmux-control-health-lifecycle`); if it changed,
  stop and report.
- Commit path-scoped only: `git commit -m "…" -- <your exact files>`.
  Never `git add -A`.
- Foreign modifications in `git status` belong to other lanes — leave them.
- Do not push. Do not commit this kickoff doc or your status file.

## Verification gates

- Before each commit: `bunx tsc --noEmit` clean +
  `bun test tests/web-client.test.ts` green.
- Contract landmines (plan §8): the CSS census (every new class literal in
  source), the exact fkey-order pin (update it only deliberately, in Tasks
  3.1/3.3), counts ignore query (pinned in Task 0.1).
- A pre-existing documented failure may exist elsewhere in the full suite;
  failures in files you don't own get a status line, not a fix.

## Status protocol

After each task (and on any blocker), append one line to
`docs/LANE-FE1-STATUS.md`:

```
[HH:MM] T0.1 DONE <short-sha>
[HH:MM] T0.2 BLOCKED <one-line reason>
```

Finish line: `[HH:MM] LANE DONE`.
