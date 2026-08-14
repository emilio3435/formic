# Lane `identity` — find out which step costs 9.3 seconds, and stop hiding it

**Read `docs/programs/collector-deadline/GROUND-RULES.md` first.** Then spec §1, §2, §3 Phase 2.

## Mission

Identity enrichment spends ~9.3 of the board's 10-second deadline, and it hid through **four**
separate investigations because it never logs its failures. Instrument it so the board says
which of its three subprocess calls costs the time, and make its failures visible.

**This lane is a measurement, not the fix.** Phase 2b — moving identity off the critical path —
is gated on what you find. Do not attempt it.

## Your fence

`src/server/identity.ts` and its test files (`tests/identity*.test.ts`,
`tests/debug-identity.test.ts` — check which exist).

**Not yours:** `src/server/state.ts`, `src/server/cmux.ts` (lane `tail`). Identity's own timeout
constants ARE yours.

## Why this lane exists in this shape

Four theories about the deadline were argued confidently from reading code. All four died on
measurement:

| Theory | Predicted | Measured |
|---|---|---|
| Transcript walk over 2,507 ended sessions | O(all tracked agents) | 1 file, 2.6ms |
| Cursor's 7.54 GB `state.vscdb` | dominant cost | inside `providers=430ms` |
| Deadline < sum of nested budgets | missed by construction | arithmetic true, doesn't describe a healthy pass |
| — | — | **identity = ~9.3s, measured on the running board** |

So: do not design from the structure. Measure, then report. If your measurement contradicts the
9.3s figure, say so plainly — that is a finding, not a failure.

## Tasks

### 2a — sub-step timings

Identity is three sequential `await` sites, up to four subprocess spawns, none overlapped:

| # | Call | Budget | Site |
|---|---|---|---|
| 1 | `cmux rpc system.top` | 4s × up to 2 attempts | `identity.ts:425-443` |
| 2 | `env LC_ALL=C ps -axo pid=,tty=,lstart=,command=` | 8s | `identity.ts:479-482` |
| 3 | `/usr/sbin/lsof -a -p <pids> -Fn` | 10s | `identity.ts:559` |

`4 + 4 + 8 + 10 = 26 seconds of budget inside a 10-second deadline.` The `lsof` alone is allowed
more than the deadline containing it.

But probed by hand these took **0.16s / 0.08s / 1.14s** — total ~1.4s. Production takes 9.3s.
**That discrepancy is the finding this lane exists to explain.** Candidate explanations worth
instrumenting for, not assuming: the pid count passed to `lsof` is far larger in production than
in a hand probe; the attribution probe is retrying; contention with a second pass running
concurrently (the watchdog abandons rather than cancels).

Instrument each site the way #59 instrumented `capture()` in `state.ts` — read that commit for
the house pattern. Report elapsed **per site**, plus the input size that drives each (e.g. how
many pids `lsof` was handed). **Log only on overrun.** The error log is already a wall of
deadline lines; the real answer must not hide behind a new wall.

### 2c — identity must say when it fails

Its three failure paths return errors as source health and **never** write to stderr
(`identity.ts:431-447`, `:483-490`, `:563-570`). That silence is the direct reason this took
four investigations: identity could consume the entire budget without appearing in a log full
of complaints about the budget.

Make them log, at the same "only when it matters" discipline.

### Do NOT do

- Do not move identity off the critical path. That is 2b and it is gated on your numbers.
- Do not shrink identity's budgets yet. Once we know which call is slow, the fix may be
  batching or caching rather than a shorter timeout — and a shorter timeout converts a slow
  success into a fast failure, which for identity means controls switch OFF fleet-wide.
  Read the rationale at `identity.ts:410-423` before touching the 4s-with-retry constant.

## Non-negotiables

- Every test mutation-checked, before/after pasted into your report. The natural hollow test
  here is one that asserts a log line appears without asserting it names the right step —
  mutate by making the timing report a constant and confirm your test fails.
- A healthy pass must stay silent. Test that.
- Identity is what gates the operator's Send and Interrupt controls fleet-wide
  (`identity.ts:405-423`). Changing when it fails changes when those controls vanish. Do not.

## Definition of done

`bunx tsc --noEmit` silent · your test files green · full `bun test` at 3598 pass / 2 fail ·
**section 3 of your report names which subprocess call spends the time, with numbers** ·
committed locally, path-scoped, not pushed.
