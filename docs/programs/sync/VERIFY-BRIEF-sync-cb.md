# Verification brief — SYNC-CB (adversarial, read-only)

Try to BLOCK this lane. Read-only; write only `VERIFY-sync-cb.md` (root) + scratch in `.lane-evidence/`. Never commit/push/revert. Work is STAGED, uncommitted (codex sandbox; expected). Base for diffs: `$(git merge-base HEAD feat/sync-integration)`.

Context: `docs/superpowers/plans/2026-08-13-sync/00-MASTER-PLAN.md` §Contract, `KICKOFF-CB.md`, `02-GROUND-RULES.md`, `LANE-REPORT-sync-cb.md`.

## Checks

1. **Fence.** Only `src/server/cmux-actions.ts` (close verbs + shared funnel config seam ONLY — notification/rename stubs untouched), `src/server/app.ts` (inside the marked `/* SYNC routes */` block + its imports only), `tests/cmux-actions-close.test.ts`, LANE-REPORT. Anything else = BLOCK. Confirm no edit to SYNC-E's close-event handlers in `state.ts`.
2. **Contract route shape.** `POST /api/sync/close {target:"surface"|"workspace", id}` → `ActionResult`; on `invalid_state` response carries `escalation.workspaceId` + `escalation.siblingAgents [{id,name}]`; workspace close without `confirm:true` → `{ok:false, code:"confirm_required", escalation}`; anchor → `{ok:false, code:"anchor"}` with NO cmux call. CF builds against exactly this JSON — any deviation from the frozen shape = BLOCK.
3. **Failure honesty (trap #2).** Non-zero, stderr-with-exit-0, timeout, missing executable, and JSON refusal bodies at exit 0 → typed failures, NO fingerprint (assert isOwnEcho false after). Check the funnel does not read only the exit code.
4. **invalid_state is escalation, not retry (trap #5).** No retry logic anywhere on invalid_state.
5. **Anchors (trap #6) + windows (trap #1).** Anchor discovery enumerates `window.list` and passes `window_id` to `workspace.group.list`; a second-window anchor is genuinely tested (fixture would fail on a single-window walk).
6. **Fingerprints.** Success records the RPC method+params so the later `workspace.closed`/`surface.closed` echo matches `isOwnEcho` — verify the recorded method matches what the echo events actually carry (the funnel records e.g. `surface.close`; check a `surface.close_requested`-shaped echo or embedded-method event would match through `echoMethod`).
7. **Escalation sibling data.** Sibling agents = every OTHER live agent with matching `target.workspaceId` from the snapshot, `{id, name}` exactly; the requested surface's own agent excluded on surface escalation. Check the test drives this from a produced snapshot, not a hand-authored list divorced from `buildSnapshot` reality.
8. **Hollow-test check.** Pick the foreign-Origin test and the confirm-gate test: would each fail if the gate were deleted? (Origin gate: server must reject `http://evil.example` BEFORE any cmux call — assert zero issued commands, not just a 4xx.)
9. **Floor.** Run + paste: `bunx tsc --noEmit`; `bun test tests/cmux-actions-close.test.ts tests/cmux-sync.test.ts tests/cmux.test.ts tests/reference-docs.test.ts`. Any red = BLOCK.

## Output

`VERIFY-sync-cb.md`, findings per check, final line exactly `VERDICT: PASS` or `VERDICT: BLOCK — <reasons>`. Uncertainty = BLOCK.
