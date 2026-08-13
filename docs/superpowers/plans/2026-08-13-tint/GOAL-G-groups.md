# TINT-G · Sidebar mirror — repo groups in cmux

You are the TINT-G sub-orchestrator (Opus 5 high). Read `00-MASTER-PLAN.md` first; contract §1, authority rules §2, fence §3 override anything here. Likely a swarm of one or two; size it yourself.

**Mission (2 sentences):** Materialize the board's repo grouping in the cmux sidebar: one named, colored group per repo, workspaces filed into it, cleaned up when empty — the board and cmux sharing one mental model. Everything sits behind `mirrorGroups` (default **true** at merge — locked decision 1) and must disable cleanly: flag off → groups this module created are ungrouped, nothing else's groups touched.

## Goal

`src/server/cmux-groups.ts` reconciles cmux workspace groups against repo assignments when `mirrorGroups` is true: create missing groups (`workspace.group.create`), name them by repoKey (`group.rename` as needed), color them through the funnel's `setGroupColor`, file repo-mapped workspaces (`group.add`), and delete a group this module created when its repo has no workspaces left.

## Success means

- Flag on (the merge default) → within one reconcile pass, `cmux rpc workspace.group.list` shows one group per repo with ≥1 mapped workspace, correct name and color, containing exactly that repo's workspaces. Membership: **all** repo-mapped workspaces (locked decision 2).
- Flag flip off → groups created by this module are ungrouped (`workspace.group.ungroup`); groups the user made by hand are never touched. Track provenance persistently (e.g. by the group ids this module created, stored alongside settings via whatever pattern `settings.ts` exposes — read F's shape, don't extend the settings interface beyond what the contract already declares).
- Group colors go through `setGroupColor` only — never a direct `workspace-action` / rpc shell from this module.
- Idempotence by test: two reconcile passes over the same state → second pass issues zero cmux mutations (fixture-level; count funnel + rpc calls).
- RPC honesty: `group.create`/`add`/`ungroup` failures surface as failures in logs and the lane report; a failed add never records the workspace as filed.
- Probe (cheap, report-only): does `workspace.group.set_icon` accept anything documentable? Note findings in your report; ship nothing icon-dependent.
- Floor green in your worktree: `bunx tsc --noEmit` → 0; `bun test` → green (tolerated red: `docs/a11y-geometry-gate` only). Reconcile logic tested on fixtures; one live smoke against your own `TINT · g-orch` workspace is allowed (create group → color → ungroup → verify via `group.list`), evidence pasted in the report.

## Stop when

Floor green, `LANE-REPORT-tint-g.md` §4 holds pasted floor output (+ live smoke evidence), committed locally on `feat/tint-g`, nothing pushed. Tell the master.

## Fence

Own: `src/server/cmux-groups.ts` (create) · one `/* TINT-G */` registration line · your tests.
Never touch: `src/web/**`, funnel internals (consume only), `cmux.ts`, `cmux-color-sync.ts`, `settings.ts` beyond reading.

## Consumes / produces

- Consumes: contract stub; F's `setGroupColor` + settings shape (stub funnel in tests until integration; real funnel at merge).
- Produces: reconcile pass invoked from the collector cycle when `mirrorGroups` is true; provenance record of created group ids.

## Traps that fail silently

- Groups are per-window. Decide once, from the data: file workspaces into groups **in their own window** (`workspace.list` is window-scoped — enumerate windows like S does). A one-window implementation looks done on your machine tonight and breaks the first time Emilio splits windows.
- Deleting vs ungrouping: `group.delete` on a group that still has workspaces may close or orphan them — never delete as cleanup for a non-empty group; `ungroup` is the safe inverse. Verify on your own workspace in the live smoke before writing the cleanup path.
- Provenance by name-matching ("group named like a repo = ours") silently annexes user-made groups; provenance is ids you recorded at creation, nothing else.
- Reconcile against `group.list` truth each pass, not your memory of it — the user can move workspaces between passes, and cmux, not your module, is the source of group state.
