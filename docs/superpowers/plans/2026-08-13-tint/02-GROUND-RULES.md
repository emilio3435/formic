# TINT · Shared ground rules — every lane, sub-orch and worker alike

Read `00-MASTER-PLAN.md` first. Its contract (§1), authority rules (§2), and fences (§3) outrank this file; this file outranks your own judgment on process.

## First action, before any code

Create `LANE-REPORT-<lane>.md` in your worktree root with five headings, each marked `PENDING`, filled in as work lands — never at the end:

1. What this lane was
2. Which claims went red first (named)
3. What shipped, file-and-fence
4. Floor results — **pasted, not paraphrased**
5. Anything unverified, including what a sandbox refused

A lane is not done until §4 holds real output. Lanes die to quota and sandbox refusals; a report written "at the end" doesn't exist when they do.

## Git discipline

- Commit locally, **never push**. Path-scoped commits only: `git commit -- <paths>` — a bare `git add . && git commit` sweeps other agents' staged work into your commit.
- Forward-only: never amend or rebase, even your own tip.
- Delete nothing. Scratch lives in `.lane-evidence/` (gitignored).
- Your branch already contains the contract stub (`src/shared/repo-color.ts`) and these docs.

## Floor (Definition of Done includes running it and pasting output)

```
bunx tsc --noEmit    # → 0 errors
bun test             # → green; the ONLY tolerated red is docs/a11y-geometry-gate (documented local-only)
```

## Spawning your own workers (sub-orchs)

- Worker stack and launch commands: master plan §4. Model AND billing vehicle both matter; verify on the live process with `ps -o args= -p <pid>`.
- `claude` workers always carry `--permission-mode auto` and an explicit `--model` pin.
- Spawn `cursor-agent --force` lanes via `cmux workspace create --command ...`, never as a direct shell exec from your own process — the direct form gets blocked by the command classifier and stalls on a human keystroke.
- Every workspace you create is named `TINT · <task> · <model> · 08-13` — task, not territory. The prefix is how the sweep finds it; an unprefixed workspace becomes invisible debris.
- Workers share your worktree by default (path-scoped commits); cut `feat/tint-<goal>-<worker>` worktrees only if your workers collide.
- Codex workers usually cannot commit in a linked worktree (sandbox can't take the lock) — expect finished work as dirt + report, and commit it yourself with a message saying so.

## Traps that fail silently (all lanes)

- **Strict CSP:** inline `style=` attributes die silently on the board. Tint via class + stylesheet custom properties or the existing SVG-attribute pattern — read how meters do it first.
- **Failure honesty:** a shelled `cmux` command that prints to stderr or exits non-zero is a failure everywhere in this program — it must never surface as success (house rule since the first GOAL.md).
- **Hex case:** normalize before comparing colors. `#2E66A8` vs `#2e66a8` read as "drift" produces an infinite write loop dressed as a string bug.
- **`workspace.list` is per-window.** Enumerate `window.list` for full coverage; one-window testing hides the gap.
- **Context:** at ~60% of your window, commit what is green, write your handoff into your lane report, and stop; the master respawns fresh from the doc. At 90% the handoff is written by an agent that can no longer think.

## Contract changes

You do not change `src/shared/repo-color.ts` shapes (TINT-F implements bodies without changing shapes). If a shape is wrong, stop, write the problem and your proposal in your lane report, and flag it — the master owns the contract.
