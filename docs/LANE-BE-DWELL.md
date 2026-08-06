# Lane kickoff — be-dwell (GPT 5.6 SOL MAX)

**Program:** `docs/superpowers/plans/2026-08-05-confidence-header-and-notification-center.md` — read §2, §3 (S0), §4 and §10 before anything else. This file is your fence and your start order, not the spec.

**Worktree:** `/Users/emilionunezgarcia/Developer/the-mountain-main`, branch `fix/cmux-control-health-lifecycle`. **Shared** — other agents are editing it right now. Re-run `git branch --show-current` before every git action and never `git add -A`; stage the exact paths you changed.

---

## ⚠ Read this before you write a single file

Another session has been writing `src/server/**` in this worktree tonight — it landed `4e16fc3` at ~20:33 and **is still resident**. `src/server/snapshot.ts` and `tests/snapshot.test.ts` are dirty from a third, stalled change that is **not yours to commit**.

So:

1. **Your first task is read-only by design.** Do it now; it needs no write access at all.
2. **Before your first edit to any file under `src/server/`**, check for a live writer:
   ```
   git status --porcelain -uall
   stat -f "%Sm %N" -t "%H:%M:%S" src/server/*.ts | sort
   ```
   If anything under `src/server/` was modified in the last ~5 minutes by someone other than you, **stop and report** rather than editing alongside it.
3. **Never commit `src/server/snapshot.ts` or `tests/snapshot.test.ts`.** They are someone's in-progress work. Leave them dirty.

---

## Your territory — sole writer

`src/server/**` (except the two files above), `src/shared/types.ts`, `tests/attention-signal*`, `tests/snapshot*` — **minus** `tests/snapshot.test.ts` while it is dirty.

## Not yours — do not open with an editor

`src/web/**` and `tests/web-client.test.ts` (fe-notify, all program long) · `tests/fixtures/**`, `scripts/**`, `docs/**` (harden-notify) · `tests/process-liveness.test.ts` (the other session's).

---

## Start order

### S0-T1 · Measure `hookLifecycleAt` before anything renders it ⭐ blocking, and **no code first**

`src/server/collectors.ts` derives `hookLifecycleAt` from the hook record's `updatedAt` — a **write** time. If the hook store heartbeats while a session sits in `needsInput`, that clock resets on every heartbeat and every dead time the notification panel shows reads near-zero, confidently and wrongly. The panel's hero number, every row's age, and the sort order all read from it.

**Sample it live before deciding anything.** Take every session currently in `hookLifecycle:"needsInput"`, record its `hookLifecycleAt` across **≥3 consecutive collector passes ≥60s apart**, and post the raw table. If the value advances while the session stays in `needsInput`, it is a heartbeat and cannot be a state-entry clock.

Deliver either way: **`blockedSince?: string`** — the instant the session entered its current person-blocked state, stable across passes and **persisted across a server bounce** so a restart does not zero every agent's dead time.

**Truth safety, non-negotiable:** no hook record, no readable transition, or a server that has not been up long enough ⇒ `blockedSince` is **absent**. Never substitute `updatedAt`. Never emit `0`. Unmeasurable ≠ zero.

**Stop condition:** if there is no stable entry clock and a derived one needs cross-restart persistence beyond what this plan scopes, **stop and re-scope**. Shipping a dead-time number we cannot defend is worse than shipping the panel without the hero — the mockup works on per-row ages alone.

### S0-T2 · Name the partition

`attentionClass?: "blocking" | "noticed"` beside `attentionSignal`. Read the kinds from `src/server/attention-signal.ts` — do not trust any list of string literals copied into a plan. `blocking` = permission-requested, input-requested, fork-unresolved, handoff-stated, question-pending, assumption-stated. `noticed` = stalled-active. `nothing-wanted` / `out-of-scope` / `not-readable` produce **no class at all** — absence, not a third value.

Nothing new is detected here. You are naming a partition that already exists so the client stops re-deriving it. A `parked`/`done` declaration never yields `blocking`; the atlas-hardening T6/T7 precedence is **read**, never reopened — and a parked lane that then asks something must still re-alert.

### S0-T3 · Fleet counters, computed once

`pulse.blocked` (count of live `blocking` agents) and `pulse.standbyMs` (sum of `now − blockedSince` across them). **`standbyMs` is absent — not partial — when any blocking agent lacks `blockedSince`.** A sum presented as a total while one term is missing is the same lie the `queueError` guard exists to prevent. `pulse.blocked` may still count; a count is honest when a duration is not.

### S0-T4 · Confirm the evidence sentence before building one

Measure, do not assume: across live blocking sessions, is `attentionSignal.evidence` present, and is it the **ask** rather than a fragment? Compare against `lastAgentClosing`. Post the sample. **If evidence is sufficient, ship nothing** — the client renders it. Only if it is absent or unusable for the blocking kinds do you add a bounded `blockedAsk?: string`. Do not add a field that duplicates one that works.

### S0-T5 · A real fleet token total

⚠ `totals.tokens` **cannot** serve this. It sums `agent.tokens.total` over **working agents only**, and `tokens.total` is documented as *"Latest call's prompt+completion size, cache reads INCLUDED. Occupancy."* Summing an occupancy across agents and labelling it total usage is the exact defect the token-field comments in `src/shared/types.ts` were written to prevent — the one that once put 394M tokens on a single session against a 1M window. Read those comments before you start.

Ship a **new, named** aggregate: **consumption** — Σ `sessionTotal` over every session in the scan window, each token counted once. **Processed** (`sessionProcessed`, cache re-reads included, the only figure comparable to BurnBar's own store) and **cache re-reads** (`sessionCachedInput`) stay separately reachable and must **never** be folded into it.

---

## Constraints that bite

- `src/server/naming.ts` contains two deliberate NUL bytes and is **grep-invisible**. Never trust a grep-negative that includes it; read it.
- `tests/reference-docs.test.ts` and `tests/ant-guide.test.ts` assert prose matches code — any enum or union you add must update `ANT-GUIDE.md` / `ARCHITECTURE.md` **in the same commit**.
- `tests/lifecycle-parity.test.ts` / `tests/naming-parity.test.ts` assert server↔client agreement. If one of your changes needs a client-side counterpart, **say so** — do not reach into `src/web/`.
- TDD per task: fixtures first. S0-T1 needs entry / heartbeat-churn / restart-gap / absent cases.

## Verify before each commit

`bunx tsc --noEmit` (exit 0) then `bun test`. **The suite is `2542 pass / 1 fail` at your baseline** — the failure is `tests/cross-source-token-agreement.test.ts` "no uuid session silently falls out of the join", pre-existing and unrelated. Assert that exact count and that exact test name. **Do not report `0 fail`, and do not touch that test to make it green.** Any *other* failure is yours.

## Stop and escalate — do not improvise

- S0-T1 finds no stable entry clock and a derived one needs more than this plan scopes.
- S0-T4 finds the evidence sentence unusable for the blocking kinds — it is the panel's third line and the reason the panel beats the old ledger.
- A live writer appears in `src/server/**` alongside you.
