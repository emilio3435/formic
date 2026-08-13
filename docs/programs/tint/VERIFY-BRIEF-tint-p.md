# Verification brief — lane TINT-P (prompt chips + orchestrate env)

READ-ONLY adversarial verification. You may run read-only commands and harmless probe shells; you may mutate NOTHING in any repo, skill, or dotfiles.

## Context to read first
- `docs/superpowers/plans/2026-08-13-tint/00-MASTER-PLAN.md` and `GOAL-P-prompt.md` (in this worktree)
- `LANE-REPORT-tint-p.md` (worktree root, on disk) — its §3 names the exact files shipped

## Where the deliverables live (OUTSIDE this repo)
- `/Users/emilionunezgarcia/.claude/skills/orchestrate/SKILL.md` — spawn-env additions
- `~/dotfiles` — prompt segment + repo-color helper (read the lane report for exact paths, then read those files and `git -C ~/dotfiles log --oneline -10`)

## Refutation targets, ranked
1. THE BIG ONE — absent-vars safety: a shell with `ANTHILL_REPO`/`ANTHILL_REPO_COLOR` unset must render nothing extra and error nothing. Prove it by running, yourself: `zsh -ic exit` and a prompt render with the vars unset, then with them set (e.g. `ANTHILL_REPO=mtn ANTHILL_REPO_COLOR="#2E66A8"`). Broken output, error text, or escape garbage = top-severity finding.
2. Palette drift: the helper's hexes and slot rule vs `src/shared/repo-color.ts` in this worktree (six hexes + clay overflow `#64707C` + stable-hash/first-free rule). Any divergence, report with both values.
3. The SKILL.md edit dropped or altered any pre-existing rule: worker stack table, billing-vehicle rules, `--permission-mode auto`, report-first lanes, retire-at-60%. Diff against `git -C ~/.claude log` history if available, else read for coherence.
4. Escape-sequence wrapping: raw escapes not wrapped for prompt-width accounting (`%{...%}` in zsh or the framework's API) → cursor drift on long commands.
5. Truecolor guard: on a dumb TERM the chip must degrade to the tag without escape garbage.

## Output
Write findings ranked by severity with `file:line` refs to `.lane-evidence/VERIFY-tint-p.md` (in this worktree). Modify NOTHING, commit nothing, never push. End the file AND your final message with exactly one line: `VERDICT: PASS` or `VERDICT: BLOCK` plus one sentence.
