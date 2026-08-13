# TINT-P · Prompt chips — repo identity below the workspace

You are the TINT-P sub-orchestrator (Opus 5 high). Read `00-MASTER-PLAN.md` first; contract §1 and fence §3 override anything here. A swarm of one is the right size unless you find otherwise.

**Mission (2 sentences):** Give individual terminals repo identity — the level cmux itself can't color — by injecting `ANTHILL_REPO` / `ANTHILL_REPO_COLOR` at workspace creation and rendering a colored chip in the shell prompt. cmux env is creation-time-only (verified: `workspace env` is read-only on existing workspaces), so your delivery is the spawn path plus the prompt segment, and it covers lanes going forward, not retrofits.

## Goal

`/orchestrate` spawns carry the env, and a prompt segment renders `▐ <repo>` (chip glyph colored `ANTHILL_REPO_COLOR`, repo tag in normal prompt ink — text never wears repo color) in every shell of such workspaces, degrading to nothing when the vars are absent.

## Success means

- `~/.claude/skills/orchestrate/SKILL.md` §3 spawn command carries `--env ANTHILL_REPO=<repoKey> --env ANTHILL_REPO_COLOR=<hex>`, with one sentence telling the orchestrator where the hex comes from: `GET http://127.0.0.1:4701/api/repo-colors` when the Ant Hill is up, else deterministic local fallback.
- The fallback is real, not prose: a tiny helper the spawn path can call (e.g. `scripts/repo-color <repoKey>` in dotfiles or the skill's dir) embedding the six contract hexes + overflow clay and the same stable-hash/first-free slot rule, with a header comment naming `src/shared/repo-color.ts` as canonical. Duplicated on purpose; the comment is the sync contract.
- Prompt segment in `~/dotfiles` for Emilio's actual prompt setup (read the dotfiles to see what that is — starship, p10k, or plain zsh — and match it; don't install a new prompt framework): chip renders when both vars set; absent vars → zero output, zero error, in both an interactive shell and a bare `zsh -c 'print -P ...'`.
- Verified end to end once, cheaply: one disposable `TINT · p-smoke` workspace created with the env flags; screenshot/paste of the chip rendering in its terminal; workspace closed afterward and noted in your report.
- Edits to the orchestrate skill preserve its Goal/Success/Stop structure and every existing rule (worker stack, permission flags, report-first) — you are adding env plumbing, not editorializing ([[surgical changes]]).
- No edits inside `the-mountain/src/**` — if you need something from the board it's the read-only GET above.

## Stop when

Skill + dotfiles edits in place, smoke evidence in `LANE-REPORT-tint-p.md` §4, dotfiles changes committed locally on whatever branch discipline `~/dotfiles` uses (never push), smoke workspace closed. Tell the master.

## Fence

Own: `~/.claude/skills/orchestrate/SKILL.md` (spawn env additions) · prompt segment + helper in `~/dotfiles`.
Never touch: `the-mountain/src/**`, other skills, `~/.claude/settings.json`.

## Consumes / produces

- Consumes: contract palette constants (copied, comment-linked); F's `GET /api/repo-colors` (optional path — your fallback means F is not a blocker, but final endpoint shape gates your last edit; confirm with master before closing).
- Produces: env contract `ANTHILL_REPO` / `ANTHILL_REPO_COLOR` — names are load-bearing; TINT-F/S/G don't consume them tonight, but future board features will, so they're locked in the master plan by this lane's landing.

## Traps that fail silently

- A prompt segment that errors when vars are unset breaks **every** non-TINT shell on the machine silently at the next terminal open — the absent-vars case is the one to test hardest.
- cmux protects `TERM`/`COLORTERM`/`CMUX_*` at spawn; your vars are fine, but don't be clever and try to piggyback protected ones.
- Chip color via 24-bit escape needs truecolor support — Ghostty has it; still, guard the segment so a dumb TERM renders the tag without the chip rather than escape garbage in logs and transcripts.
- `%{...%}` wrapping (zsh) around raw escapes, or the framework's own color API, or prompt width accounting breaks and cursor drift shows up only on long commands — cosmetic, unreported, and infuriating.
