# Collector deadline — shared ground rules

Read this before your kickoff. Everything here has already cost someone hours today.

**Spec:** `docs/superpowers/specs/2026-08-13-collector-deadline-design.md` — read §1 and §2 in full.

---

## The one thing this program is about

The board rebuilds its picture of the fleet inside a 10s deadline. When it misses, it
publishes a partial snapshot that withdraws every agent's terminal target, which disables
focus/instruct/interrupt fleet-wide. 464 misses in the log.

**Measured cause: identity enrichment spends ~9.3 of the 10 seconds.** Every other collector
finishes inside 700ms. You do not need to re-derive this; #59 instrumented it and the board
reports it directly.

## Traps that fail SILENTLY — the expensive kind

**1. Hollow tests. This codebase produces them repeatedly.** Five were caught today, two of
them written by the orchestrator. A test that passes identically with and without the code it
claims to defend is worse than no test, because it certifies the defect.

> **Mutation-check every single test you write.** Break the rule the test defends, run it,
> confirm THAT test fails by name, revert. Paste the before/after into your lane report.
> A test you did not mutation-check does not count as done.

The specific trap: when two guards both protect the same behaviour, deleting one leaves the
other covering for it and your test still passes. Design each test so it fails when *its own*
guard is removed — usually by pushing past the other guard's threshold first.

**2. Absence of evidence is not evidence.** The whole program is one instance of this. A
collector being late says nothing about the world. Never convert "we could not measure X" into
"X is gone/empty/zero". This is the rule #56 established for cmux groups after the board spent
today dissolving and rebuilding the operator's sidebar 14 times on exactly that mistake.

**3. Two known-failing tests are PRE-EXISTING. Do not "fix" them.**
`tests/cross-source-token-agreement.test.ts` fails two assertions on *absence of data*
(`settled=3 live=0`, `codexRows=0`). That is the fleet being quiet, not a regression. Full
suite baseline is therefore **3598 pass / 2 fail**. If you see exactly those two, you are green.

**4. Never launch anything on :4701.** It is production, served by launchd. `DEPLOY.md:17`.
If you need a board, pass an explicit `MOUNTAIN_PORT` (4710-4719) or use
`scripts/anthill-preview.sh`. Note that a process started with **no** `MOUNTAIN_PORT` defaults
to 4701 and will fight production.

**5. Never write into `~/Developer/the-mountain-production`.** It is the deploy checkout. An
untracked file there blocks the deploy gate.

**6. The git stash stack is shared with ~25 worktrees and several live agents.** Never bare
`git stash` / `git stash pop`. Path-scope every commit: `git commit -m "msg" -- <paths>`,
never `git add -A`. You will bury another agent's staged work otherwise.

## Your fence

Your kickoff names the exact files you own. **Do not edit a file another lane owns**, even if
the fix looks trivial and adjacent. If you believe you need to, write it in your lane report
and stop — the orchestrator resolves it.

| Lane | Owns |
|---|---|
| `tail` | `src/server/state.ts`, `src/server/cmux.ts` |
| `identity` | `src/server/identity.ts` |
| `boot` | `src/server/cursor.ts`, `src/server/index.ts` |

Test files: you own the test files that cover your fence. Say which in your report.

Identity's own timeout constants belong to the **identity** lane, not `tail`, even though
spec §1b (budgets must fit their container) would otherwise reach them.

## Your lane report — write it FIRST, not last

Your **first action** is to create `LANE-REPORT-<lane>.md` at the repo root with these five
headings, each marked `PENDING`, and fill them in as work lands:

```markdown
# Lane <name>
## 1. What this lane was
## 2. Which claims went red first (named)
## 3. What shipped — file and fence
## 4. Floor results — PASTED, not paraphrased
## 5. Anything unverified, including what the sandbox refused
```

This is load-bearing. Lanes die to quota limits and sandbox refusals mid-flight, and a report
written at the end produces nothing when they do.

## Definition of done — the floor

Run these yourself and paste real output into section 4:

```bash
bunx tsc --noEmit                    # must be silent
bun test <your test files>           # must be green
bun test                             # 3598 pass / 2 fail (the two named above)
```

Then: **commit locally, path-scoped. Never push. Never open a PR.** Delete nothing. Keep scratch
in `.lane-evidence/`.

Do not end your turn to check in. Keep going until the Definition of Done is met or you are
genuinely blocked, and if you are blocked, say so in section 5 and stop.
