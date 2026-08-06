# Confidence header + notification center

Goal ID: `confidence-header-notification-center`
Started: 2026-08-06T04:17:46Z
Parent goal: none
Mode: full
Ledger path: `.agent/runs/confidence-header-notification-center/`

## Objective

Land the remaining stages of the confidence-header and notification-center program: S4 cost/burn provenance, S6-T3/T4 cleanup chip UX, A11Y-2 through A11Y-6, the panel geometry test, and the Board all-clear defect — each verified, pushed, CI-green and merged to main.

## Goal Mode Coupling

When creating or updating the matching `/goal`, include this ledger pointer in the goal objective:

`Maintain the agent-owned ledger at /Users/emilionunezgarcia/Developer/the-mountain-main/.agent/runs/confidence-header-notification-center/ and keep implementation-notes.html current at checkpoints, before compaction, and before final handoff.`

## Finishing Criteria

Each item is landed only when it is **merged to main behind green CI**, not merely committed.

- [todo] **S4** — Cost and Burn render provenance rather than implying it. `costProvenance:"unavailable"` reads "cost unavailable", never `$0`; `costIsFloor` keeps its `≥`; `costAsOf` prints as an as-of; Burn keeps its window qualifier and speaks `coverage.unknown` only when incomplete.
- [todo] **S6-T3/T4** — the Clean up chip runs `propose` only, shows a minimal rotating indicator with an informative tooltip while it runs (static under `prefers-reduced-motion`), and routes the result to the notification center as a `dataflow` item. The board never deletes; `confirm` stays a terminal action.
- [todo] **A11Y-2..6** — focus never falls to `<body>`; the panel's name is one a role permits; each Focus button has a distinct accessible name; a quiet row's visible program name is inside its accessible name; Focus is a 44px touch target.
- [todo] **Panel geometry test** — measures the panel's real edges at 420px and fails on the number. The current guard only greps the stylesheet for `align-self: stretch`, which the round-2 mutation audit proved does not measure geometry. A documented NOT RUN with a reason is acceptable; a quietly abandoned test is not.
- [todo] **Board all-clear defect** — the rich all-clear is reachable at the default 6h lookback AND qualifies its claim rather than asserting it flatly, disclosing how many sessions the window hides. Prior art at `d527c75`; take the idea, not the diff.
- [todo] Ledger kept current at each checkpoint and before compaction.

## Validation (run before claiming any item done)

```
bunx tsc --noEmit          # exit 0 — CI typechecks BEFORE tests, so bun test passing is not sufficient
bun run test:ci            # 0 fail — NOT plain `bun test`; four suites assert against this machine
```

Then push, confirm CI green on the PR, and merge. Live checks use a throwaway server on a port you own — never restart the operator's board on 4701, and kill the PID you started, never the port.

## Standing rules this program runs on

- **Absence must mean one thing.** A reading that cannot be measured is withheld with a reason, never zeroed and never defaulted. `totals.consumption` never falls back to `totals.tokens` (occupancy).
- **Measure a field on a live board before rendering it.** An absence proves nothing until you know the serving process's PID and start time and have given it a full scan cycle.
- **The header never links; the notification center never aggregates.**
- **Ember means a person is the blocker**, and nothing else earns it.
- Shared worktree: `git commit -F - -- <paths>`, never `git add … && git commit`; check `git diff --cached --stat` first.
- A check that could not be run is reported as **not-run**, never as a pass.

## Escape Hatch

Pause, ask the user, or mark a scoped item `[blocked]` / `[incomplete]` if:
- validation contradicts the goal
- the goal requires a scope change
- the agent is looping without measurable progress
- the next step risks deleting or rewriting durable memory
- the PRD and actual repo disagree
- the ledger itself contaminates validation

