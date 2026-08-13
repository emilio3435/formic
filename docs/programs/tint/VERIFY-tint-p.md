# VERIFY-tint-p — adversarial, read-only

Verifier ran 2026-08-13. Touched nothing except this file.
Sources: `docs/superpowers/plans/2026-08-13-tint/{00-MASTER-PLAN,GOAL-P-prompt}.md`, `LANE-REPORT-tint-p.md`, `src/shared/repo-color.ts`, `~/.claude/skills/orchestrate/SKILL.md`, `~/dotfiles/{scripts/repo-color,zsh/anthill-repo-chip.zsh,README.md}`, `~/.oh-my-zsh/custom/zz-anthill-repo-chip.zsh`. `git -C ~/.claude log` is not a repo; skill coherence read instead. `git -C ~/dotfiles log` → `14fbc57` on `feat/tint-repo-chip`.

## Findings, ranked

### Medium — truecolor guard ignores `TERM`; `TERM=dumb` + inherited `COLORTERM=truecolor` still emits 24-bit CSI

`~/dotfiles/zsh/anthill-repo-chip.zsh:36-38` keys off `COLORTERM` only:

```zsh
if [[ ${COLORTERM:-} != (truecolor|24bit) ]] || [[ ! $hex =~ '^[0-9A-Fa-f]{6}$' ]]; then
  print -rn -- "$tag"
  return 0
fi
```

GOAL-P trap and this brief's target 5: on a dumb `TERM` the chip must degrade to the tag with no escape garbage (logs/transcripts). This agent environment is exactly that pair (`TERM=dumb`, `COLORTERM=truecolor`).

Proved, `print -P "$(anthill_repo_chip)"` / raw fragment, both vars set to the brief's example (`ANTHILL_REPO=mtn ANTHILL_REPO_COLOR="#2E66A8"`):

| env | stdout (cat -v) | escapes? |
|---|---|---|
| `TERM=xterm-256color COLORTERM=truecolor` | `^[[38;2;46;102;168m▐^[[0m mtn` | yes (intended) |
| `TERM=dumb`, `COLORTERM` unset | `mtn` | no |
| `TERM=dumb COLORTERM=truecolor` | `^[[38;2;46;102;168m▐^[[0m mtn` | **yes** |

`38;2;46;102;168` is `#2E66A8`. Non-TINT shells are unaffected (vars unset → no chip). This is a TINT-shell + contradictory-env hole, not the machine-wide absent-vars case. Fix would be to treat `TERM=dumb` (and likely `TERM=unknown` / empty) as no-color regardless of `COLORTERM`.

### Low — `--permission-mode auto` is absent from the spawn example; no before-image that this edit dropped it

`~/.claude/skills/orchestrate/SKILL.md` has no `permission-mode auto` (spawn block `:67-70`, worker-stack table `:56` is `claude --model opus --effort high "<prompt>"`). `git -C ~/.claude` is not a repository; `~/.agents/skills/orchestrate/SKILL.md` is byte-identical (`md5 aaf4f590…`). Cannot prove a drop vs a pre-existing omission. Lane report §5 already flags it as out-of-fence. Coherence of the rules this brief named otherwise holds — see target 3 below.

No other findings.

## Target 1 — absent-vars safety (THE BIG ONE) — holds

Proved on this machine, vars explicitly unset:

```
$ unset ANTHILL_REPO ANTHILL_REPO_COLOR
$ zsh -ic exit
rc=0  stdout_bytes=0  stderr_bytes=0
```

Chip function, sourced in isolation (`~/dotfiles/zsh/anthill-repo-chip.zsh:25-28` returns 0 when either var is empty):

| probe | rc | stdout | stderr |
|---|---|---|---|
| neither, `anthill_repo_chip` raw | 0 | 0 bytes | empty |
| neither, `print -P "$(anthill_repo_chip)"` | 0 | `b'\n'` (`print` builtin newline; function itself empty) | empty |
| `ANTHILL_REPO` only | 0 | newline only | empty |
| `ANTHILL_REPO_COLOR` only | 0 | newline only | empty |
| `zsh -ic exit` with both vars **set** | 0 | 0 bytes | empty |

Interactive `zsh -is` (real `.zshrc` / oh-my-zsh / loader):

- vars unset: `PROMPT=%(?:%{…➜…%} ) %{…%}%c%{…%} $(git_prompt_info)` — stock robbyrussell. `HOOKS=_omz_async_request omz_termsupport_precmd omz_termsupport_cwd`. No chip, no extra hook (`:74-80` gates registration).
- vars set: `PROMPT=%{ESC[38;2;46;102;168m%}▐%{ESC[0m%} mtn %(?:…` — chip prepended, same hook list (attach removes itself `:54-55`).

No error text, no escape garbage, no extra prompt in the unset case.

## Target 2 — palette / slot rule vs `src/shared/repo-color.ts` — no hex drift

| slot / name | `repo-color.ts` | `scripts/repo-color` |
|---|---|---|
| 0 olive | `:10` `#5F7F2A` | `:43` `#5F7F2A` |
| 1 storm | `:11` `#2E66A8` | `:44` `#2E66A8` |
| 2 sienna | `:12` `#B05F3A` | `:45` `#B05F3A` |
| 3 petrol | `:13` `#0E9494` | `:46` `#0E9494` |
| 4 garnet | `:14` `#9E3355` | `:47` `#9E3355` |
| 5 iris | `:15` `#8A4FC0` | `:48` `#8A4FC0` |
| overflow clay | `:19` `#64707C` | `:50` `#64707C` |

`assignSlot` in this worktree is still `export declare` (`repo-color.ts:42-47`); no hash body to diverge from. Helper FNV-1a 32-bit matches an independent Python check (`the-mountain` → `924000732` → slot 0 → `#5F7F2A`). First-free: `--taken 0` → `#2E66A8`; `--taken 0,1,2,3,4` → `#8A4FC0`; all six → `#64707C`. Helper wraps (`elio-intelligence-suite` hashes to 5; `--taken 5` → `#5F7F2A` slot 0). Stub text says “scanning upward” and “null when all six taken”; wrap is the reading that makes “all six taken” the overflow condition. Not a hex mismatch. Cross-lane risk remains if TINT-F implements a non-wrapping scan or a different hash — already in the lane report, not a P-vs-stub palette drift.

## Target 3 — SKILL.md pre-existing rules — structure intact; permission flag never present in this copy

`~/.claude/skills/orchestrate/SKILL.md` (mtime 2026-08-13 01:08):

| rule | status |
|---|---|
| Goal / Success / Stop | `:8-17` present |
| worker stack table + billing-vehicle | `:52-61` present, vehicles still claude / codex / cursor-agent |
| report-first `LANE-REPORT-<lane>.md` | `:35-39` present |
| retire-at-60% | `:92` present |
| `--permission-mode auto` | **0 hits** — see Low finding |
| spawn env | `:65-70` `--env ANTHILL_REPO` / `--env ANTHILL_REPO_COLOR`; `:73` board GET + local fallback |

No evidence this edit removed the worker stack, billing rules, report-first, or retire rule.

## Target 4 — `%{…%}` wrapping — present

`~/dotfiles/zsh/anthill-repo-chip.zsh:46-48`. Raw fragment with the brief's example vars:

```
%{ESC[38;2;46;102;168m%}▐%{ESC[0m%} mtn
```

Two wraps (`grep -c '%{'` = 2): color-on and reset. Glyph and tag sit outside the wraps. Interactive PROMPT (target 1) uses the same wrapped form, so zle width accounting sees the CSI as zero columns. `${#${(%%)chip}}=27` counts CSI *after* prompt expansion and is not the zle metric; do not read it as a wrap miss.

## Target 5 — truecolor / dumb TERM — partial; see Medium finding

Degrades to tag with zero escapes when `COLORTERM` is unset (even with both Anthill vars set) and on malformed hex (`not-a-hex` → `mtn`, no CSI). Fails the literal `TERM=dumb` requirement when `COLORTERM=truecolor` is inherited.

## Probe notes (not findings)

- `#2E66A8` → `38;2;46;102;168` on the glyph only; tag stays in prompt ink.
- `%` in the repo name (`we%ird`) round-trips through `print -P` as a single `%` (`:30-31`).
- Loader `~/.oh-my-zsh/custom/zz-anthill-repo-chip.zsh:7-9` is a 3-line `[[ -r ]] && source`; out of the `~/dotfiles` fence, as the lane report said.

VERDICT: PASS Absent-vars is silent (`zsh -ic exit` 0/0/0), the six hexes plus clay match `repo-color.ts`, and the only hole is `TERM=dumb` still coloring when `COLORTERM=truecolor` is inherited.
