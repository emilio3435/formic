# CLIS-B · Grok Build CLI (BE · Sol xhigh via Codex)

**Mission:** A live `grok` TUI session is a Formic row. Cursor-hosted Grok stays Cursor.

**Consumes:** A merged (union + stubs). **Do not edit `src/shared/types.ts`.**

Spawn only after A is on this branch.

## First action

Write `LANE-REPORT-clis-b.md` (five PENDING headings). Read one real `summary.json` + `signals.json` + a slice of `updates.jsonl` from `~/.grok/sessions/` (or `$GROK_HOME`) into `.lane-evidence/` before writing the parser. If none exist, write a fixture from the spec layout and say so in §5.

## Tasks

1. Path + command identity in `identity.ts`. Resume: `-r` / `--resume`. Continue: `-c`.
2. `src/server/grok.ts` parser. `summary.json` = name/model/times. `signals.json` = tokens. `updates.jsonl` = task / last message / end. Missing file = that field unknown, session still collected. Use `makeAgent` / `statusFrom`. Never Factory's always-`running`.
3. Replace A's stub in `collectSessionProvider("grok")`. Honor `GROK_HOME`.
4. `attachHookFacts` for grok (do not skip the way Cursor is skipped).
5. `scripts/anthill-grok` from the Cursor shim (TTY/`fg`), not Droid. `HOOK_STORE_PROVIDERS` += grok.
6. `config/models.json`: `grok-4.6` + aliases `cursor-grok-4.6`, `grok-build`.
7. `HARNESS_MARK.grok` is the CLI. Model badge `/grok/i` must not steal the harness icon on a grok row.
8. Tests: `tests/grok.test.ts` + process-recognition + hook-store-shims + collector-absence.

## Do not

- Map `cursor-grok-*` to `provider: "grok"`.
- Guess a flat `~/.grok/sessions/<uuid>.jsonl`.
- Invent prices.
- Touch Hermes files.

## Done when

Fixture (or live) grok session → `provider: "grok"` row with title + model. Missing `~/.grok` is absent. Floor pasted in report §4.
