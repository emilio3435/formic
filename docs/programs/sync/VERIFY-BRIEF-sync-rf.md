# Verification brief — SYNC-RF (adversarial, read-only)

Try to BLOCK this lane. Read-only; write only `VERIFY-sync-rf.md` (root) + scratch in `.lane-evidence/`. Never commit/push/revert. Work is COMMITTED locally at `7225867` (claude lane).

Context: `docs/superpowers/plans/2026-08-13-sync/00-MASTER-PLAN.md` §Contract, `KICKOFF-RF.md`, `02-GROUND-RULES.md`, `LANE-REPORT-sync-rf.md`.

## Checks

1. **Fence.** Commit touches only `src/web/app.js`, `src/web/client-state.js`, `src/web/styles.css`, `tests/web-client.test.ts`. Anything else = BLOCK. No rename affordance on rows/strip/program heads (one affordance, drawer only); agent display names offer NO rename anywhere.
2. **Never-re-assert, FE half (the rename-war rule).** After `{ok:true}` the field must render the SNAPSHOT title, never the typed draft. Attack: find any path where `wsRenameDraft` (or any local echo) survives into the rendered title after save. The lane claims a mutation test proves this — re-apply mutation "row prefers wsRenameDraft over snapshot title" and confirm test (4) actually fails.
3. **Gating.** Rename only when `workspaceId` present AND resolution ∈ {exact, unique-cwd} AND non-empty title; no-workspace agents get no control. Re-apply the "resolution gate deleted" mutation, confirm test (2) fails.
4. **Contract envelope.** POST `{workspaceId, title}` exactly; response handled as bare `ActionResult {ok, code?, detail?}`; refusal (`invalid_title`/`anchor`/`invalid_state`) → house quiet-error idiom, original title restored, editor open. Wrong-envelope test: a differently-shaped response must render nothing/not-success (fixtures-are-not-payloads).
5. **Keyboard + a11y.** Enter saves, Escape cancels, focus returns to trigger both ways; touch target ≥44px at mobile width; error uses `role="alert"`.
6. **Strict CSP (trap #7).** No inline `style=` introduced anywhere in the diff; new classes all have stylesheet rules (the lane's test 8 claims this — check the test actually enumerates new classes against the stylesheet).
7. **Duplication flag.** Report §5 flags a possible double-print (eyebrow "Terminal:" + workspace row) for sessions with no surfaceTitle whose workspace title differs from display name. Assess severity: is it reachable on real snapshots? Report severity; a cosmetic duplicate is a note, not a BLOCK, unless it misleads.
8. **Floor.** Run + paste: `bunx tsc --noEmit`; `bun test tests/web-client.test.ts`; then full `bun test` tail. Only tolerated red: `tests/cross-source-token-agreement.test.ts`. Anything else red = BLOCK.

## Output

`VERIFY-sync-rf.md`, findings per check, final line exactly `VERDICT: PASS` or `VERDICT: BLOCK — <reasons>`. Uncertainty = BLOCK.
