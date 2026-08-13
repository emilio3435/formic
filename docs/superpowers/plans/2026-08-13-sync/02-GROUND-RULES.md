# SYNC · Ground rules — every lane

Read `00-MASTER-PLAN.md` (contract, fences, your row in the stack table) and the spec's **Traps** section first. This file outranks your judgment on process; the master plan and spec outrank this file.

## First action, before any code

Create `LANE-REPORT-sync-<lane>.md` in your worktree root, five headings, each `PENDING`, filled as work lands: (1) what this lane was · (2) which claims went red first, named · (3) what shipped, file-and-fence · (4) floor results PASTED · (5) anything unverified incl. what a sandbox refused. Lanes die mid-flight; a report written at the end doesn't exist when they do.

## Git

- Commit locally, never push. Path-scoped: `git commit -- <paths>`. Forward-only; never amend. Scratch in `.lane-evidence/` (gitignored). Delete nothing.
- Codex lanes: the sandbox usually cannot take the linked-worktree lock — leave finished work as dirt + a complete report §3 file list; the master commits it and says so in the message. Do NOT fight the lock or work around the sandbox.

## Floor (paste output in report §4)

```
bunx tsc --noEmit    # 0
bun test             # green; only tolerated red: tests/cross-source-token-agreement.test.ts (fleet canary)
```

If your lane adds a `src/server/*.ts` module, `tests/reference-docs.test.ts` forces an ARCHITECTURE.md row — that edit is in-fence for you; keep it to your module's rows.

## The traps that fail silently (all live-verified 2026-08-13)

1. **Window-scoped lists.** `workspace.list {}` / `workspace.group.list {}` answer from the CALLER'S window. Enumerate `window.list` and pass `window_id`. This produced a false "workspace is gone" during the spec probes.
2. **Funnel only.** Every cmux mutation goes through `cmux-actions.ts`. Exit code alone is not evidence for RPCs — surface refusals (`invalid_state`) as typed failures, never success. TINT precedent: a wrong param name was ACCEPTED with exit 0 and did nothing.
3. **Notification params.** The key is `id` (NOT `notification_id`). `mark_read` selects exactly one of `id|tab_id|all`; `dismiss` one of `id|all_read`. Never send the `all` variants from sync code. Bodies are REDACTED in events — fetch via `notification.list`.
4. **Echo suppression.** Your own writes come back as `*_requested` events (params embedded). Match through `isOwnEcho` — never by comparing state you cached yourself (restart desync). Normalize titles (trim) before comparison; a spelling-only "drift" is a rename loop wearing a disguise.
5. **Last surface refuses to close** (`invalid_state`) — that's the escalation signal, not an error to retry.
6. **Anchors.** Group-anchor workspaces (`anchor_workspace_id` in `group.list`) are never close/rename/notify targets. TINT rules hold.
7. **Strict CSP** on the board: no inline `style=`; class + stylesheet custom properties, CSSOM `style.setProperty` where the codebase already does it.
8. **Gap = distrust.** `gap: true` on the event stream ack, or any reconnect, invalidates patching: full recollect. A gapped stream that keeps patching is a board that quietly diverges.
9. **Ack is not state.** An Ack hides a row from the alert list; it never mutates agent state, never writes to cmux, and self-revokes on a fresh alert fingerprint.

## Spawning / models

You do not spawn anything. You are a worker lane; the master spawns you and your verifier. If you are out of quota or stalled, stop and write it in your report — the master respawns per the fallback rule.

## Context

At ~60% of your window: commit (or stage-and-report, codex) what is green, finish your report, stop. The master respawns fresh from the doc.
