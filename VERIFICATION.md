# What "green" means for the merge gate

Written 2026-08-04 by the test-isolation lane, after six full-suite failures blocked every landing
and turned out not to be a defect in anything they named.

The gate is `bun run check` — `bunx tsc --noEmit` followed by `bun test`. This file records what that
command actually depends on, because three of its tests read the operator's live machine and the
suite does not say so anywhere else. Somebody who does not know that will spend an afternoon
bisecting a branch that was never broken. That afternoon has now been spent twice.

---

## The gate is not hermetic, and that is deliberate

Most of this suite is fixtures. Three tests are not: they read
`~/Library/Application Support/OpenBurnBar/openburnbar.sqlite` — a 1.4 GB database belonging to a
separate application that has never heard of this repository — and the board serving on
`127.0.0.1:4701`.

| Test | File | What it reads |
|---|---|---|
| `a settled disagreement is either explained by BurnBar, or it fails` | `tests/cross-source-token-agreement.test.ts` | the live board's `/api/snapshot` and the real BurnBar database |
| `real history: the history was actually read, so no bound passes on an empty set` | `tests/physical-bounds.test.ts` | the real BurnBar database |
| `the identities were actually evaluated, so none of them passed on an empty read` | `tests/published-identities.test.ts` | the real BurnBar database |

Each of the three goes **red when it cannot read its source**, and each does so on purpose. They are
the anti-hollow canaries for the roughly twenty live-data assertions around them, every one of which
returns quietly when the database is unreadable — and `[].every(anything)` is `true`, so quiet means
green. Without these three, an unplugged database would take the whole BurnBar and history story
green while comparing nothing at all.

**So a red in one of those three does not mean the board is wrong. It means the gate did not
measure.** Those are different findings and the suite is built to keep them apart. Do not widen a
tolerance, delete a canary, or reach for `.skip()` to make one of them pass; the reason is written
out at length in `tests/README.md` §7.

### What the gate therefore requires

Run it on the operator's machine, with:

- OpenBurnBar installed, and its database readable (not mid-migration, not locked by a restore).
- The Ant Hill board serving on `127.0.0.1:4701`.
- BurnBar rows present in the trailing 24 hours and the wider bounds window.

A clean clone on a machine with no OpenBurnBar cannot produce a green `bun run check`, and it is
supposed to be honest about that rather than quietly reporting corroboration it never obtained.
`BURNBAR_DB_PATH` and `BURNBAR_SUPPORT_DIR` override the locations if the database lives elsewhere.

---

## The 2026-08-04 investigation: six failures that were one condition

Reported as "6 failures in unrelated BurnBar/history checks", blocking PR #6. They did not reproduce
on demand: the full suite was green at `facd112`, at `main` (`6b53f5d`), and at PR #6's tip
(`23f441c`), five runs each, in forward and reverse file order.

They reproduce exactly — same six, same names — when the BurnBar database cannot be read:

```bash
BURNBAR_DB_PATH=/tmp/nope.sqlite BURNBAR_SUPPORT_DIR=/tmp/nope bun test
```

One condition produced all six, through three different mechanisms:

1. **The canary in `cross-source-token-agreement`** throws when neither source is available. Correct,
   and left alone.
2. **Two non-vacuity canaries** (`physical-bounds`, `published-identities`) assert `available` and go
   red on an empty read. Correct, and left alone.
3. **Three `test.failing` tests** began `if (!available) return`. That is the right quiet for a plain
   test, but under `.failing` quiet means *passing*, and bun reports a passing `.failing` test as
   `"marked as failing but it passed"` — a red that accuses somebody of fixing a defect they never
   touched. This was the actual bug, and it is fixed: those three now assert `available` and throw,
   matching the sibling check in their own file and the rule already written in `tests/README.md` §7.

Six environment-dependent reds are now three, and the remaining three are the ones that are supposed
to be there.

### A second, unrelated defect found on the way

`tests/factory.test.ts` wrote its fixture to a **fixed path** in the shared system temp directory
(`factory-settings-fixture.settings.json`). Three tests wrote and deleted that one path. Five lanes
run this suite on this machine, so a concurrent run reaching its `finally` first deleted the file
another run was about to read — reported as `a session that has spent nothing reports zero, not
unknown`, because a missing settings sibling reads as `unknown` spend.

Reproduced at three concurrent suites, fixed with a per-call `mkdtempSync` directory (the convention
everywhere else in this suite), and five concurrent suites are now clean. This is the "red for one
run and green the next" that `tests/README.md` §4.4 attributes to lane concurrency.

---

## Commands, and what they returned

Run in a worktree off `main` at `facd112`, 2026-08-04, board up on `:4701`.

| Command | Result |
|---|---|
| `bun run check` | typecheck clean; **2130 pass, 0 fail**, 123 files |
| `bun test` ×5 consecutive | 2130 pass, 0 fail, every run |
| `bun test` ×5 concurrent | 2130 pass, 0 fail, every run |
| `bun test $(ls tests/*.test.ts \| sort -r)` (reverse order) | 2130 pass, 0 fail |
| `bun run check` at `main` `6b53f5d` | 2146 pass, 0 fail, 124 files |
| `bun run check` at PR #6 `23f441c` | 2073 pass, 0 fail, 120 files |
| `BURNBAR_DB_PATH=/tmp/nope.sqlite … bun test` (before fix) | 2124 pass, **6 fail** |
| `BURNBAR_DB_PATH=/tmp/nope.sqlite … bun test` (after fix) | 2127 pass, **3 fail** — the three canaries above |

There is no test-order dependence and no shared-state pollution left that these runs can find. The
suite is green in forward order, reverse order, five times consecutively, and five times
concurrently.

---

## When it goes red again

Work down this list before bisecting.

1. **Is the board up on `:4701`, and is OpenBurnBar readable?** If either is down, expect exactly the
   three canaries above and nothing else. That is the gate telling you it did not measure.
2. **Is another lane running the suite right now?** Concurrency here is normal; genuine collisions
   should be gone, but a new fixed-path fixture would bring them back. Run it twice more.
3. **Only then treat it as a defect** — and if the red is a `.failing` test reporting
   `"marked as failing but it passed"`, read it as good news: somebody fixed the thing it documents.
   Remove the marker, do not weaken the test.
