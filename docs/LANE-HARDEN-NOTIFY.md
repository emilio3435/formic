# Lane kickoff — harden-notify (Grok 4.5 High Fast)

**Program:** `docs/superpowers/plans/2026-08-05-confidence-header-and-notification-center.md` — read it first. This file is your fence and your start order, not the spec.

**Worktree:** `/Users/emilionunezgarcia/Developer/the-mountain-main`, branch `fix/cmux-control-health-lifecycle`. **Shared** — other agents are editing it right now. Re-run `git branch --show-current` before every git action and never `git add -A`; stage the exact paths you changed.

---

## Your territory — sole writer

- `tests/fixtures/**` (except `process-liveness-truth-table.json`)
- `scripts/**`
- `docs/**` — ANT-GUIDE and DESIGN-LANGUAGE parity

## Not yours — do not open with an editor

- `src/web/**` and `tests/web-client.test.ts` — fe-notify's, for the whole program.
- `src/server/**`, `src/shared/types.ts`, `tests/snapshot.test.ts` — be-dwell's, and a **live Codex session is writing `src/server/collectors.ts`, `identity.ts`, `identity-bindings.ts`, `process-liveness.ts` right now**. Touching them destroys someone's in-flight work.
- `tests/process-liveness.test.ts` and `tests/fixtures/process-liveness-truth-table.json` — that same session's.

---

## Start order — fixtures can and should precede the wire

1. **A golden fixture per `AttentionSignalKind`.** The enum lives at `src/server/attention-signal.ts:39-61` (read it; do not trust the plan's line numbers). One fixture per kind, including the three that produce **no** attention class at all — `nothing-wanted`, `out-of-scope`, `not-readable`. Absence is a case, not a gap.
2. **The blocked/noticed matrix** as data: which kinds are `blocking`, which are `noticed`, which are neither. This is the table `attentionClass` will be tested against when be-dwell lands it.
3. **The §4.3 promotion truth table** as a fixture: one row per condition, including `stale-without-current-impact` (affected agent ids that resolve to zero live agents) and declared-`done`-with-no-newer-`needsInput`.
4. **Two truth-safety fixtures that must fail loudly if the contract breaks:**
   - a blocking agent with **no** `blockedSince` ⇒ `standbyMs` is **absent**, the hero is withheld *with a reason*, and `pulse.blocked` still counts. Unmeasurable ≠ zero.
   - a **heartbeat-churn** fixture: a session that stays in `needsInput` while its hook record's `updatedAt` advances. The test fails if any dead time drops. This exists because `collectors.ts` derives `hookLifecycleAt` from a *write* time and it may be a heartbeat — S0-T1 is measuring that, and your fixture is what will catch the regression afterwards.
5. **The parked-then-asks case.** A lane that declared `parked`/`done` and then asks a question must re-alert. The atlas-hardening T6/T7 precedence must stay unbroken.
6. **Docs parity.** `tests/reference-docs.test.ts` and `tests/ant-guide.test.ts` assert prose matches code — any enum or union this program adds must land its ANT-GUIDE / DESIGN-LANGUAGE update **in the same commit**.
7. **S5-T1 · history routes.** Confirm resolved / verified-without-impact / stale-without-current-impact each still reach a real drawer via `recentlyResolvedOf` and the `resolved` renderer, so the center's footer link is honest.
8. **A11y sweep**, after fe-notify's S1 merges: focus order, accessible names, the touch/hover divergence, the gauge's accessible name enumerating every reading it draws.

Write the fixtures so they **encode why the behavior matters**, not just what the code currently returns. A fixture that would still pass if the implementation were rewritten arbitrarily is not a test.

## Verify before each commit

`bunx tsc --noEmit` (exit 0) then `bun test`. **The suite is `2542 pass / 1 fail` at your baseline** — the failure is `tests/cross-source-token-agreement.test.ts` "no uuid session silently falls out of the join", pre-existing and unrelated. Assert that exact count and that exact test name. **Do not report `0 fail`, and do not touch that test to make it green.** Any *other* failure is yours.

Note also: `src/server/naming.ts` contains two deliberate NUL bytes and is **grep-invisible**. Never trust a grep-negative that includes it; read it.

## Stop and escalate — do not improvise

- A fixture you write cannot be satisfied by any honest implementation → that is a contract problem, report it rather than weakening the fixture.
- You find yourself needing to edit a file outside your territory.
