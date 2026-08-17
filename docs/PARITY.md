# Formic source and model parity

A harness is not covered because a row appears. Covered means the same fields Claude Code and Codex already fill, or an honest unknown (never a guessed percent or a fake $0).

## For future agents

Every instruction set for Formic work includes all three, in the **same commit**:

1. The collector / catalog change.
2. This file, rewritten for the rows you actually changed. Not a follow-up PR. If the code and this table disagree, the table is wrong.
3. **Real logos.** Research and pull the official mark for every new or newly-wired harness and model provider. Cite the source URL in the PR. Put the file in `src/web/icons/` and wire `HARNESS_MARK` / `AGENT_MARK` / `PROVIDER_MARK` in `src/web/app.js`.

Do not generate a mark. Do not draw a stand-in. Do not reuse `formic-mark.svg` as someone else's logo. Do not ship a label with no `src`. If the vendor has no official public mark you can legally use, leave the icon unset, say so in this file, and do not invent one.

Keep the "watch is not coverage" rule. Do not claim coverage you did not ship.

## Logos

Two badges per row: **harness** (where it ran) and **agent** (what thought). Maps live in `src/web/app.js`.

| Key | Role | File | Honest? |
|---|---|---|---|
| claude | harness | `claude-code.svg` | yes |
| claude | agent | `claude.svg` | yes |
| codex | harness | `codex.webp` (official raster) | yes |
| openai / sol / luna | agent | `openai.svg` | yes |
| cursor | both | `cursor.svg` | yes |
| factory | harness | `factory.svg` | yes |
| prime | harness | `prime-orch.svg` | yes |
| omp | harness | `omp.svg` | yes |
| grok | harness | `xai.svg` | yes |
| grok | agent | `grok.svg` | yes |
| spark | agent | `meta.svg` | yes (Meta, not a Muse wordmark) |
| muse | harness | **no `src`** | missing official Muse Code mark |
| antigravity | harness | **no `src`** | missing official Antigravity / Gemini mark |
| copilot | harness | **no `src`** | missing official Copilot mark |
| hermes | harness | `formic-mark.svg` | **fake. Replace.** |
| gemini / google | agent | **none** | missing |

Also on disk, unused as a harness mark: `anthropic.svg`, `spark.svg`.

In-flight CLI work (Muse window / Copilot window / Antigravity + Gemini catalog) must pull official Muse, Copilot, and Antigravity/Gemini marks in that same commit and wire them. Hermes stays on the Formic mark until its own end-evidence pass replaces it with Nous Research's official mark.

## Bar

From `makeAgent` / `CollectedAgent` on `main`:

- first user / task
- last-close / transcript tail
- model id
- cwd and originCwd
- tokens (observed, or `{ scope, provenance: unknown }`)
- context window (so `contextPct` can be honest)
- startedAt / updatedAt
- end evidence (session-exit or turn-complete) when the harness actually ends
- resume identity
- Send / Focus / Interrupt: cmux-exact, same as the other CLIs, unless a dedicated surface exists
- official harness mark + official model-provider mark (or an honest unset)

Cost is fleet BurnBar, not per-row USD. `CollectedAgent.cost` is almost never set. Missing source reads `unavailable`, never `$0`.

Audited on public `emilio3435/formic` `6307167` (Copilot CLI) plus icon maps in `src/web/app.js`.

## Harness fields

| Source | Watch | Task | Close | Model | cwd | Tokens | Window | End | Send | Gap vs bar |
|---|---|---|---|---|---|---|---|---|---|---|
| claude | yes | yes | yes | yes | yes | observed when usage present | only with usage | turn-complete (`end_turn`) | cmux-exact | Window missing when usage missing. `end_turn` is a yield. |
| codex | yes | yes | yes | yes | yes | observed session-cumulative | observed from payload | turn-complete | cmux-exact | No per-call series. |
| cursor | yes | yes | yes | yes | yes | latest-turn occupancy | needle table | archive / turn-complete | cmux-exact; no hook attach | Cost forced `null`. Child rows have no `startedAt`. |
| factory | yes | title or first user | yes | settings.json | yes | session totals if settings exist | needle table | **none** | cmux-exact | Silent unknown if settings missing. No clean-end. |
| prime | yes | yes | yes | yes, **defaults `"prime"`** | yes | observed when usage present | needle table; grok fallback **131k** (catalog is 500k) | **none** | cmux-exact | Invented model label. Wrong grok window. |
| omp | yes | yes | yes | yes | yes | observed; corrupt → estimated | needle table | session-exit | cmux-exact | Legacy. |
| grok (Build CLI) | yes | yes | yes | yes | yes | occupancy `total`, not billed in/out | signals only | turn-complete | cmux-exact | Catalog 500k unused if signals omit window. |
| grok-bot | extra root only | yes | yes | **never** | instance home | **never** | **never** | **never** | gateway send; focus opens app; interrupt off | Not a `Provider`. No source-health slot. |
| hermes | yes | yes | yes | yes | yes | **never** | **never** | **none** | cmux-exact | Session tokens never. Cron is spend-only. Icon is the Formic mark. |
| muse | yes | yes | yes | yes | yes | observed on `model_completed` | **never** | session-exit / turn-complete | cmux-exact | Spark 1.2 is in the catalog; collector does not attach it. No honest `contextPct`. No Muse mark. |
| antigravity | yes | yes | yes | sqlite if real | yes | **never** | **never** | **none** | cmux-exact | Tokens hardcoded unknown. No Gemini catalog. No Antigravity mark. |
| copilot | yes | yes | yes | model_change / shutdown | yes | **only on shutdown** | **never** | session-exit | cmux-exact | Live sessions have unknown tokens. No window. No Copilot mark. |

Not modelled (discover / `needs-parser` or absent): Cline, OpenCode, Amp, Kiro, Devin Desktop / Windsurf, Goose, OpenHands, Aider. Cloud-only (Jules, Bolt, v0, Codex/Claude web with no local dir): out. Each of those, when added, ships with an official mark in the same commit.

## US model catalog

`config/models.json` + `model-config.ts`. Needles apply to Claude / OMP / Prime / Cursor / Factory. Muse, Hermes, Copilot, Antigravity, and Grok Bot do not use this table. Grok CLI uses signals.

| Model | Label | Window | Priced | Used as |
|---|---|---|---|---|
| GPT-5.6 Sol | sol 5.6 | 258,400 | yes | model behind Codex / Cursor / Copilot |
| GPT-5.6 Terra | terra 5.6 | **missing** | yes | same; cannot compute `contextPct` from catalog |
| GPT-5.6 Luna | luna 5.6 | 258,400 | yes | same |
| Claude Opus 5 | **no** (label is opus 4.8) | yes (`opus-5`) | **no** (price is opus 4.8) | source = Claude Code |
| Claude Sonnet 5 | sonnet 5 | yes | no | model |
| Claude Fable 5 | fable 5 | yes | no | model |
| Gemini 3.7 / 3.6 / 3.1 | **no** | **no** | **no** | source = Antigravity |
| Muse Spark 1.2 | spark 1.2 | yes | no | source = Muse; collector ignores window |
| Grok 4.6 / 4.5 | yes | 500,000 | no | source = Grok Build |
| Composer 2.5 | composer 2.5 | 131,072 | no | Cursor product; Kimi-based weights |
| MAI-Code / Nova / Llama 4 | no | no | no | not a Formic source; Llama is not Muse |

## Work order (field parity, then new harnesses)

In flight on a local CLI (not a cloud agent): Muse window, Copilot window, Antigravity usage-if-real + Gemini catalog, Opus 5 / Terra / Prime grok catalog honesty, **plus official Muse / Copilot / Antigravity-or-Gemini marks**. That agent must update this file in the same commit.

Once that lands:

1. Hermes / Factory / Prime: end-evidence only when the file has a real close. Replace the Hermes Formic-mark stand-in with Nous Research's official mark. Same-commit PARITY.md.
2. New watchers at this bar, not watch-only: Cline, then OpenCode, then Amp. Official mark each time. Same-commit PARITY.md.
3. Then Kiro, then Devin Desktop / Windsurf. Same rule.
4. After public formic is the real board: point production :4701 at formic, or keep the-ant-hill as history only. Do not develop in both.

Do not add a Llama provider. Do not treat Composer 2.5 or SWE-1.7 as US-origin weights.
