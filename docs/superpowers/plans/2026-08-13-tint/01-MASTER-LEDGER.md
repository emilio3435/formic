# TINT · Master Ledger

> Owner: master orchestrator (Fable 5, `FORMIC · orch`). This is the only global view.
> Update on every state change; a stale ledger is a lie on the operator's board.

## My /goal (master)

**Goal:** Take TINT from approved plan to a floor-green, locally deployed, visually verified integration branch tonight, by orchestrating four sub-orchestrators — writing none of their code myself.

**Success means:** contract stub committed first; four sub-orchs spawned per plan §4 with correct model+vehicle verified on the live process; every merge floor-run by me; authority rules enforced in review; deploy + eyes-on check done; ledger current; debris swept under `TINT · `.

**Stop when:** plan §Stop is met, or an open decision blocks on Emilio.

## Program state

| Gate | State | Evidence |
|---|---|---|
| Plan approved by Emilio | DONE | "GO!" 2026-08-13 00:57 CDT |
| Open decisions 1–4 answered | DONE | groups ON at merge · all repo-mapped · piggyback collector · push+PR when green (standing) |
| `feat/tint-integration` cut from `main` | DONE | worktree tint-integration @ 625fd6c base |
| Contract stub committed (first commit) | DONE | 22e75d8 (tsc --noEmit 0); docs 06d385c |
| Sub-orchs spawned + model/vehicle verified | DONE | pids f=70978 s=71016 g=71062 p=71208, all `--model opus --effort high --permission-mode auto` via ~/.local/bin/claude, cwd = own worktree (ps+lsof 01:0x CDT) |
| F merged, floor green | PENDING | tsc/test output: — |
| S merged, floor green | PENDING | — |
| G merged, floor green | PENDING | — |
| P landed (skill + dotfiles) | PENDING | — |
| Deployed: kickstart + `?v=ah-tN` bump | PENDING | new tag: — |
| Live check: workspace.list ↔ /api/repo-colors agree | PENDING | — |
| Visual check with eyes (screenshot read) | PENDING | — |
| Sweep: `TINT · ` workspaces, worktrees, branches | PENDING | — |
| Push/PR (Emilio's word only) | PENDING | — |

## Lanes

| Lane | Goal doc | Branch / worktree | Workspace | Model · vehicle | Status | Report seen | Floor (my run) |
|---|---|---|---|---|---|---|---|
| TINT-F | GOAL-F-foundation.md | `feat/tint-f` · `../the-mountain.worktrees/tint-f` | workspace:26 `TINT · f-orch · opus · 08-13` | Opus 5 high · claude (pid 70978, verified) | DONE 01:35 — 4 commits, clean tree, traps fixed, cross-source red proven pre-existing at base | yes | pending |
| TINT-S | GOAL-S-sync.md | `feat/tint-s` · `../the-mountain.worktrees/tint-s` | workspace:27 `TINT · s-orch · opus · 08-13` | Opus 5 high · claude (pid 71016, verified) | DONE 01:41 — addendum 2f22c83 (anchor filter, live-probed), green | yes | pending |
| TINT-G | GOAL-G-groups.md | `feat/tint-g` · `../the-mountain.worktrees/tint-g` | workspace:28 `TINT · g-orch · opus · 08-13` | Opus 5 high · claude (pid 71062, verified) | REPORTED DONE 01:28 (2 commits, cross-session report) | yes — findings relayed | pending (verify-g ws spawned) |
| TINT-P | GOAL-P-prompt.md | `feat/tint-p` · `../the-mountain.worktrees/tint-p` | workspace:29 `TINT · p-orch · opus · 08-13` | Opus 5 high · claude (pid 71208, verified) | WORKING | — | — |

Sub-orch worker lanes appear in each sub-orch's own ledger section of its `LANE-REPORT`; master tracks sub-orchs only, but sweeps everything under the `TINT · ` prefix.

## Contract changes (none expected; log any)

| When | What changed | Why | Lanes notified |
|---|---|---|---|
| 01:3x | Behavioral addendum, no shape change: group ANCHOR workspaces (workspace.group.list anchor_workspace_id) are excluded from collection, repo-mapping, sync, and color fan-out; never written to, never rendered | G verified live: group.create spawns an anchor that reads as a repo-mapped workspace; group.remove on the anchor destroys the group; group.delete closes members | F, S, G |
| 01:35 | Additive envelope key: GET /api/repo-colors response gains repoNames (lowercased board repo name → canonical repoKey); additive-only, no TS shape change; only consumer is app.js | Browser cannot run git rev-parse to derive common-dir keys; board joins on the name it prints | F (author), P (endpoint consumer) |

## Incidents / rescues

| When | Lane | What | Resolution |
|---|---|---|---|
| 01:24 | master | Sentinel done-detection bug (grep -c double-echo; P repo-commit test unsatisfiable) | killed, patched, relaunched |
| 01:28 | G→F | workspace.group.set_color silently no-ops on {color}/{custom_color} param names; only {group_id, hex} works | relayed to F with order to test exact param names |
| 01:28 | G | Open question (orphan anchor rows after ungroup) | master locked: leave for operator; no auto-close |
| 01:3x | S | Reopened for anchor-filter addendum before merge (mirrorGroups ships ON) | landed 2f22c83; filter placed in cmux-color-sync.ts (better fence fit, accepted); skip-whole-window on group.list failure LOCKED |
| 01:37 | master | Grok verifier spawns broke: kickoff-length inline prompts truncated mid-string, zsh stuck at dquote> — Emilio caught it | 4 stuck workspaces closed; briefs rewritten as .lane-evidence/VERIFY-BRIEF-*.md files; respawned ws:41–44 with one-line commands; confirmed running (Grok 4.6 High autorun) |
| 01:41 | master | Tolerated-red correction (S+F both proved): tonight's expected red is cross-source-token-agreement (fleet-dependent, >20 join floor); a11y-geometry-gate PASSES on this machine tonight | floor runs use corrected list |

## Parked (carried from plan §8, grown tonight)

- Idea 1: repo sigils (shape coding).
- Idea 5: worktree shade steps.
- Group icons: probed by G — vocabulary is Apple SF Symbols ({group_id, symbol}); bogus names null out SILENTLY. Usable, unshipped.
- PRE-EXISTING BUG (S measured): collectCmuxSidebar is single-window blind — 10 of 15 workspaces collected; project root/branch/dirty/PR links missing a whole window for every consumer. Follow-up lane candidate.
- Funnel hole (S flagged, F's file): lastWrittenHex records the written hex, not cmux's echo; closed in practice today, breaks if cmux ever quantizes stored colors. Deploy check: grep deploy log for "NOT CONFIRMED" — correct-hex echo means F's strict value-check is wrong; null echo means the check earned its keep (F's own guidance).
- Sync cost: +1 RPC per window per cmux tick (group.list pairing).
