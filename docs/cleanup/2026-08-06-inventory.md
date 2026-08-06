# Cleanup inventory — 2026-08-06 ~07:25 CDT

Scope: debris after the unified-filtering + filter-redesign swarm (PR #18).
Classifier: ACTIVE = evidence of life; DONE = merged+landed+unoccupied;
UNKNOWN = kept untouched by rule.

## ACTIVE — kept, no action

| Item | Evidence |
|---|---|
| worktree `the-mountain` (main) | main worktree; clean; `feat/inspector-instrument-panel` checked out (another program) |
| worktree `the-mountain-main` | this session + notify program live here; PR #18 branch checked out |
| branch `fix/cmux-control-health-lifecycle` | PR #18 open |
| branch `feat/inspector-instrument-panel` | checked out in main worktree |
| cmux `workspace:97` "ANT - Classifier Agents" | this session's own pane |
| cmux window-6 `workspace:87` (Header & Notifications), `workspace:101` (a11y-sweep) | live spinners — actively working |
| untracked `.agent/runs/`, `.anthill/`, `docs/rhs-shots/lane6-be/` | other programs' scratch; cross-program = UNKNOWN-by-rule, kept |

## DONE candidates — this session's lane workspaces (3)

`workspace:106` fe2-filter-menus, `workspace:117` fe3-ripout,
`workspace:122` fe4-class-axis — all three LANE DONE, accepted by the
orchestrator, idle at their prompts (✳). Workspaces 103/104/105 (BE-1, FE-1,
EV-1) were already closed manually. Undo: none needed — closing a workspace
kills an idle CLI; the lanes' work is committed and their ledgers are in git
(`c28d9e5`).

## DONE candidates — branches fully merged into origin/main (26)

All satisfy: `git branch --merged origin/main`, no worktree, not checked out,
program landed. Preservation: `git tag zz-archive/<name>` before `-d`.

ant-hill/fe-capabilities-20260728 · ant-hill/fe-controls-20260728 ·
ant-hill/fe-quality-20260728 · ant-hill/lifecycle-contract-20260804 ·
ant-hill/lifecycle-evidence-20260804 · ant-hill/lifecycle-followups-20260804 ·
ant-hill/luna-body-language-20260722 · ant-hill/luna-inspector-totem-20260722 ·
ant-hill/luna-integration-20260722 · ant-hill/luna-scroll-shell-20260723 ·
ant-hill/luna-tree-glance-20260722 · ant-hill/w4-client-20260728 ·
ant-hill/w5-client-20260728 · docs/retro-review-gaps · feat/bookshelf-seam ·
feat/server-health-and-boot-export · feat/watch-only-dot ·
fix/anthill-start-shell-fallback · fix/backend-dashboard-pipeline ·
fix/backend-silent-failures-and-freshness · fix/board-liveness-truth ·
fix/console-alerted-rows-and-health-severity · fix/docs-config-onboarding ·
fix/factory-fixture-collision · fix/hygiene-optional-programs ·
fix/identity-scan-start-times · fix/triage-test-clock

Note: these span several OLD programs (luna/lifecycle/fe-waves), not just this
run — deletion proceeds only per-category approval.

## UNKNOWN — kept untouched

| Item | Why |
|---|---|
| 10 unmerged branches (`ant-hill/luna-*` ×9, `ant-hill/surface-title-wip-20260804`) | unlanded Luna-era work; unmerged commits exist |
| `stash@{0}` surface-title WIP | stashes always UNKNOWN; content also committed as `fa72d74` on `ant-hill/surface-title-wip-20260804` (kept) |
| `stash@{1}` WIP on main @ 4c80cde | stashes always UNKNOWN; wave5-era |
| cmux window-6 `workspace:94/95/96` (fe-notify, harden-notify, be-dwell — idle) | notify program's lanes; not this run's prefix — their conductor's call unless Emilio rules |
| cooper-scheduler ev2-* terminals/worktrees | different repo and program entirely |

## Approvals + outcomes (07:30 CDT)

Emilio ruled: close session lane panes YES · tag+delete merged branches YES ·
notify panes LEAVE · stashes LEAVE.

**Removed:**
- cmux workspaces 106 / 117 / 122 (fe2, fe3, fe4 — LANE DONE, idle). No undo
  needed; work is committed, respawn is a kickoff-doc launch.
- 26 branches, each tagged first — undo for any:
  `git branch <name> zz-archive/<name>`. `git tag -l 'zz-archive/*'` lists all.

**Refused and reclassified UNKNOWN:** `fix/backend-silent-failures-and-freshness`
— `git branch -d` refused it (unmerged relative to HEAD; it is also
`stash@{0}`'s origin branch). Kept, archive tag withdrawn.

**Kept (verified untouched):** both worktrees; both stashes; 10 unmerged
luna-era branches + the refusal; notify workspaces 94/95/96 and the two
active panes; cooper ev2-*; untracked scratch (`.agent/runs/`, `.anthill/`,
`docs/rhs-shots/lane6-be/`).

**Post-state:** 2 worktrees (unchanged) · 14 branches (was 40) · 2 stashes
(unchanged) · 26 zz-archive tags · window 7 holds only the session pane.
