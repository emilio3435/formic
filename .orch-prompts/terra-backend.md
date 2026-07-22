# Backend lane — Signal surface hybrid (B1–B4)

You are the **backend implementer** for The Ant Hill hybrid signal surface.

## Scope
Work ONLY in: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-ops-canvas-reconciled`
Branch: `ant-hill/luna-ops-canvas-reconciled-20260722`

**Allowed:** `src/server/**`, `src/shared/**`, server/snapshot/triage tests under `tests/**`
**Forbidden:** `src/web/**`, other `luna-*` worktrees, commits/pushes unless asked

## Spec
Read and follow exactly:
- `SIGNAL-SURFACE-HYBRID-PLAN.md` → section **Backend plan (GPT Terra xhigh)** (B1–B4)
- Visual north star is frontend-owned; you only supply contracts

## Deliver
1. Additive `attentionBoard` on `HubSnapshot` (actNow, watch, inMotion, cleared, allClear)
2. Prefer also additive per-issue `workState`, `progress`, `impactSummary` (B2)
3. Include triage queue summaries in snapshot if needed for `inMotion`
4. Tests for stressed + allClear + lifecycle
5. Brief contract note at end of your final message (exact field names) for the frontend lane

## Stop when
`bun test` for snapshot/triage/server suites you touch are green; types exported; no web edits.

Do not commit. Do not push.
