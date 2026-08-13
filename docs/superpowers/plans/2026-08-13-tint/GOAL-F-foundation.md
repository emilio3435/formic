# TINT-F · Foundation — board tint + assignment + cmux fan-out

You are the TINT-F sub-orchestrator (Opus 5 high). Read `00-MASTER-PLAN.md` first; its contract (§1), authority rules (§2), and your fence (§3) override anything here if they conflict. You run your own swarm inside your fence; the master merges your branch, you never merge into integration yourself.

**Mission (2 sentences):** Implement repo-identity color on the board: deterministic repo→color assignment persisted in settings, Whisper treatment for the grouped ALL view and Signal treatment for interleaving sorts, and the single funnel through which every cmux color write flows. You are the foundation — TINT-S and TINT-G integrate against the funnel and endpoint shapes you make real, so your first commit lands those pieces.

## Goal

Rows in the ALL view carry their repo's color per the approved design (artifact a902d450: Whisper = repo-group 2px spine at 45% + header dot + 4% `color-mix` row wash, 7% hover; Signal = per-row 3px tick at 55% + 4% wash + quiet repo pill when grouping is off), colors persist and are user-overridable via `PUT /api/repo-colors/:repoKey`, and every repo-mapped cmux workspace gets its hex through `src/server/cmux-color.ts`.

## Success means

- `src/shared/repo-color.ts` implemented exactly to the contract: `REPO_PALETTE` six fixed slots, `repoKeyForCwd` collapsing worktrees via git common dir, `assignSlot` deterministic (stable hash start, first-free scan, null on overflow → `REPO_OVERFLOW_HEX`).
- **First commit** on your branch = working `src/server/cmux-color.ts` funnel (`setWorkspaceColor` / `setGroupColor` / `lastWrittenHex`) + implemented shared module, so S and G can integrate early; message it clearly.
- Whisper: attention rows drop the repo wash entirely for ember rail + 6% ember wash (authority rule 5 — replace, never blend). Text never wears repo color (rule 6).
- Signal: on attention rows the ember rail evicts the repo tick.
- `GET /api/repo-colors` and `PUT /api/repo-colors/:repoKey` live, same-origin local-only like sibling mutating routes; routes inside a `/* TINT-F routes */` marked block.
- Settings persistence in `src/server/settings.ts` follows its existing patterns; `mirrorGroups` defaults **true** (locked decision 1), `syncFromCmux` defaults true.
- Tests you add and pass: assignment determinism (same repos in any discovery order → same colors; 7th repo → clay), repoKey worktree-collapse, funnel records `lastWrittenHex` and reports command failure as failure (never success on stderr/non-zero — house rule), render: grouped rows carry wash class/var, interleaved rows carry tick + pill, attention rows carry ember treatment and no repo wash.
- Floor green in your worktree: `bunx tsc --noEmit` → 0; `bun test` → green (tolerated red: `docs/a11y-geometry-gate` only).

## Stop when

Floor green, `LANE-REPORT-tint-f.md` §4 holds pasted floor output, work committed locally on `feat/tint-f`, nothing pushed. Then tell the master.

## Fence

Own: `src/shared/repo-color.ts` · `src/web/app.js` (row/group render; keep edits surgical) · `src/web/styles.css` · `src/server/cmux-color.ts` (create) · `src/server/settings.ts` · marked route block · your tests.
Never touch: `src/server/cmux.ts`, `cmux-groups.ts`, `cmux-color-sync.ts`, other lanes' files.

## Consumes / produces

- Consumes: contract stub (integration branch first commit).
- Produces (S and G build against these): the funnel's three functions with contract signatures; `GET /api/repo-colors` response shape; settings keys `assignments` / `mirrorGroups` / `syncFromCmux`.

## Suggested swarm (yours to size)

- FE worker (Opus 5 high via `claude --model opus --effort high --permission-mode auto`): app.js render + styles.css, against fixtures.
- BE worker (Sol xhigh via `codex -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -a never -s workspace-write`): shared module + funnel + settings + routes + tests. Codex can't take the worktree lock — expect dirt + report, commit it yourself with a message saying so.
- Shared worktree, path-scoped commits only: `git commit -- <paths>` ([[shared-worktree-commit-sweeps-the-index]]).

## Traps that fail silently

- CSS custom-property tint via inline `style` will die on the strict CSP — carry `--repo` via class + stylesheet or the existing SVG-attribute pattern; check how meters do it before inventing.
- `repoKeyForCwd` from plain `git rev-parse --show-toplevel` fragments worktrees into separate "repos" — use the common dir. The board itself runs from worktrees all day; you'd ship a bug that demos fine.
- The 4%/6%/7% mix percentages are design-approved values, not suggestions — don't "improve" them.
- Fan-out writes to cmux happen only for repo-mapped workspaces (authority rule 1/2); writing to unmapped workspaces is a defect S will then fight forever.
