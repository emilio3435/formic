# Verification brief — SYNC-RB (adversarial, read-only)

You are the verification lane for SYNC-RB. Try to BLOCK it. Read-only: run checks/tests; write only `VERIFY-sync-rb.md` (worktree root) and scratch in `.lane-evidence/`. Never commit/push/revert. Work is STAGED, uncommitted (codex sandbox; expected).

Context: `docs/superpowers/plans/2026-08-13-sync/00-MASTER-PLAN.md` (§Contract routes), `KICKOFF-RB.md`, `02-GROUND-RULES.md`, `LANE-REPORT-sync-rb.md`. Base = merge-base with `feat/sync-integration` (the integration tip has master ledger commits the lane never saw — diff against `$(git merge-base HEAD feat/sync-integration)`).

## Checks

1. **Fence + master ruling.** Changed files must be only: `src/server/cmux-actions.ts` (rename verb only — close/notification verbs must remain untouched stubs), `src/server/app.ts` (SYNC route block only), `src/server/state.ts` (workspace.renamed registration), `src/server/cmux-sync.ts` (ONE accepted cross-fence exception: the `workspace.renamed` own-echo dispatch exception, master-ruled), `tests/cmux-rename.test.ts`, LANE-REPORT. Anything else = BLOCK.
2. **The seam exception is safe.** Attack `if (isOwnEcho(event) && event.name !== "workspace.renamed") return;`: (a) confirm the ONLY registered `workspace.renamed` handler is state-only (patches snapshot, never writes cmux); (b) confirm the adversarial pair test (ours-then-foreign, exactly ONE write issued, foreign title wins) genuinely counts issued cmux calls, not a proxy; (c) confirm E's own echo tests (notification.mark_read_requested etc.) still pass unmodified.
3. **Title asymmetry pinned (the rename-war rule).** A test must exist proving the board NEVER re-asserts titles (unlike TINT colors): foreign rename wins, board writes only on explicit user action. If the only guarantee is prose, BLOCK.
4. **Trap #4 normalize/trim.** Trim-identical title → `{ok:true}` no-op with NO cmux call (assert zero issued commands, not just ok). Empty/whitespace → `invalid_title`, no call.
5. **Anchors (trap #6).** Anchor workspace → `{ok:false, code:"anchor"}` with no cmux call; the production anchor lookup enumerates `window.list` (trap #1) — grep for window-scoped `workspace.group.list`.
6. **Failure honesty (trap #2).** stderr / non-zero / typed refusal → `{ok:false, code, detail}`, NO fingerprint recorded (assert `isOwnEcho` false afterward).
7. **Route.** `POST /api/sync/rename` same-origin loopback gated (rejected foreign Origin tested); 404 only for a PROVEN unknown workspace; request shape `{workspaceId, title}` exactly per contract.
8. **Exact params.** `workspace.rename {workspace_id, title}` — a test pins the exact param keys (TINT param-pinning precedent).
9. **Floor.** Run + paste: `bunx tsc --noEmit`, `bun test tests/cmux-rename.test.ts tests/cmux-sync.test.ts tests/cmux.test.ts tests/reference-docs.test.ts`. Any red = BLOCK.

## Output

`VERIFY-sync-rb.md`, findings per check, final line exactly `VERDICT: PASS` or `VERDICT: BLOCK — <reasons>`. Uncertainty = BLOCK.
