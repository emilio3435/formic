# Formic source and model parity

A harness is not covered because a row appears. Covered means the same fields Claude Code and Codex already fill, or an honest unknown (never a guessed percent or a fake $0).

## For future agents

Every instruction set for Formic work includes all three, in the **same commit**:

1. The collector / catalog change.
2. This file, rewritten for the rows you actually changed. Not a follow-up PR. If the code and this table disagree, the table is wrong.
3. **Real logos.** Research and pull the official mark for every new or newly-wired harness and model provider. Cite the source URL in the PR. Put the file in `src/web/icons/` and wire `HARNESS_MARK` / `AGENT_MARK` / `PROVIDER_MARK` in `src/web/app.js`.

Do not generate a mark. Do not draw a stand-in. Do not reuse `formic-mark.svg` as someone else's logo. Do not ship a label with no `src`. If the vendor has no official public mark you can legally use, leave the icon unset, say so in this file, and do not invent one.

Keep the "watch is not coverage" rule. Do not claim coverage you did not ship.

Bar, from `makeAgent` / `CollectedAgent` on `main`:

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

Audited on `emilio3435/the-ant-hill` after the field-level window pass, the Copilot CLI collector, and official harness marks. Update this file when a collector, mark, or `config/models.json` changes.

## Harness marks

`HARNESS_MARK` / `AGENT_MARK` in `src/web/app.js`. A mark is an official file under `src/web/icons/` with a `src`. Do not generate a mark, do not use `formic-mark.svg` as a stand-in, and do not ship a harness label with no `src`.

| Mark | File | Used as | Official source |
|---|---|---|---|
| Muse Code | `icons/muse.svg` | harness `muse`; agent `spark` (Muse Spark) | Favicon SVG on [Muse Code](https://developer.meta.com/ai/products/muse-code/) (`https://static.xx.fbcdn.net/rsrc.php/yf/r/-7pQO6hUGK_.svg`) |
| GitHub Copilot | `icons/copilot.svg` | harness `copilot` | `Copilot_Icon_Black.svg` from [GitHub Logos](https://brand.github.com/GitHub_Logos.zip) ([Copilot brand](https://brand.github.com/brand-identity/copilot)) |
| Google Antigravity | `icons/antigravity.png` | harness `antigravity` | Icon – Full Color on [Antigravity press assets](https://antigravity.google/press) (`https://antigravity.google/assets/image/brand/antigravity-icon__full-color.png`) |
| Gemini | `icons/gemini.svg` | agent `gemini` | Official Gemini sparkle (`https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg`) |

Hermes still uses `formic-mark.svg` — that is a pre-existing gap, not this pass.

## Harness fields

| Source | Watch | Task | Close | Model | cwd | Tokens | Window | End | Send | Gap vs bar |
|---|---|---|---|---|---|---|---|---|---|---|
| claude | yes | yes | yes | yes | yes | observed when usage present | only with usage | turn-complete (`end_turn`) | cmux-exact | Window missing when usage missing. `end_turn` is a yield. |
| codex | yes | yes | yes | yes | yes | observed session-cumulative | observed from payload | turn-complete | cmux-exact | No per-call series. |
| cursor | yes | yes | yes | yes | yes | latest-turn occupancy | needle table | archive / turn-complete | cmux-exact; no hook attach | Cost forced `null`. Child rows have no `startedAt`. |
| factory | yes | title or first user | yes | settings.json | yes | session totals if settings exist | needle table | **none** | cmux-exact | Silent unknown if settings missing. No clean-end. |
| prime | yes | yes | yes | yes, **defaults `"prime"`** | yes | observed when usage present | needle table (grok = catalog 500k) | **none** | cmux-exact | Invented model label when the transcript omits one. |
| omp | yes | yes | yes | yes | yes | observed; corrupt → estimated | needle table | session-exit | cmux-exact | Legacy. |
| grok (Build CLI) | yes | yes | yes | yes | yes | occupancy `total`, not billed in/out | signals only | turn-complete | cmux-exact | Catalog 500k unused if signals omit window. |
| grok-bot | extra root only | yes | yes | **never** | instance home | **never** | **never** | **never** | gateway send; focus opens app; interrupt off | Not a `Provider`. No source-health slot. |
| hermes | yes | yes | yes | yes | yes | **never** | **never** | **none** | cmux-exact | Session tokens never. Cron is spend-only. |
| muse | yes | yes | yes | yes | yes | observed on `model_completed` | catalog needle when the model matches | session-exit / turn-complete | cmux-exact | Session-scope counts only — no latest-turn `total`, so `contextPct` stays blank even with a window. Unknown model → no window. Missing usage → unknown tokens, never `$0`. |
| antigravity | yes | yes | yes | sqlite `last_selected_agent_model` if that column is present | yes | **never** | catalog needle when that model matches | **none** | cmux-exact | Inspected schema (collector + fixtures + live conversation DBs): `trajectory_meta` has id/type/source only; usage/window live in protobuf blobs. No decoder. Transcript JSONL has no usage fields. Leftover `~/.gemini` (non-antigravity) is not a session source. |
| copilot | yes | yes | yes | model_change / shutdown | yes | **only on shutdown** `modelMetrics` | catalog needle when the model matches | session-exit | cmux-exact | Live sessions stay unknown-tokens (honest). Window can still attach from `session.model_change`. Terra matches no window (see catalog). Local CLI only — not the VS Code extension. |

Not modelled (discover / `needs-parser` or absent): Cline, OpenCode, Amp, Kiro, Devin Desktop / Windsurf, Goose, OpenHands, Aider. Cloud-only (Jules, Bolt, v0, Codex/Claude web with no local dir): out.

## US model catalog

`config/models.json` + `model-config.ts`. Needles apply to Claude / OMP / Prime / Cursor / Factory / Muse / Copilot / Antigravity. Hermes and Grok Bot do not use this table. Grok CLI uses signals.

| Model | Label | Window | Priced | Used as |
|---|---|---|---|---|
| GPT-5.6 Sol | sol 5.6 | 258,400 | yes | model behind Codex / Cursor / Copilot |
| GPT-5.6 Terra | terra 5.6 | **missing** | yes | same; cannot compute `contextPct` from catalog. OpenAI API lists 1,050,000 ([GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)); this catalog's Sol/Luna 258,400 is Codex occupancy, a different unit. Do not guess 258,400. |
| GPT-5.6 Luna | luna 5.6 | 258,400 | yes | same |
| Claude Opus 5 | opus 5 | yes (`opus-5` / `opus 5`) | yes ($5 / $25, cache 0.5 / 6.25) | source = Claude Code. Price from [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing). `claude-opus-4-8` stays labeled opus 4.8. |
| Claude Sonnet 5 | sonnet 5 | yes | no | model |
| Claude Fable 5 | fable 5 | yes | no | model |
| Gemini 3.7 Flash | gemini 3.7 flash | 1,048,576 | **no** | source = Antigravity / Copilot. Window from [Gemini 3.7 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash). Official $0.75/$3.75 is introductory through 2026-12-31, then $1.50/$7.50 — catalog has no effective-date, so price is omitted. |
| Gemini 3.6 Flash | gemini 3.6 flash | 1,048,576 | **no** | same. Window from [Gemini 3.6 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash). Same intro/standard split; no price. |
| Gemini 3.1 Pro | gemini 3.1 pro | 1,048,576 | **no** | same. Window from [Gemini 3.1 Pro Preview](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview). No single stable list price cited here. |
| Muse Spark 1.2 | spark 1.2 | yes | no | source = Muse; collector attaches the catalog window when the model needle matches |
| Grok 4.6 / 4.5 | yes | 500,000 | no | source = Grok Build. Prime no longer invents 131k. |
| Composer 2.5 | composer 2.5 | 131,072 | no | Cursor product; Kimi-based weights |
| MAI-Code / Nova / Llama 4 | no | no | no | not a Formic source; Llama is not Muse. |

## Work order (field parity, then new harnesses)

1. Muse: attach Spark window from the catalog when a model needle matches. **Done.**
2. Copilot: attach a window when the model is known; keep live-session tokens unknown until shutdown (honest). **Done.**
3. Antigravity: parse usage if the sqlite actually has it; if not, keep unknown and add Gemini 3.7/3.6/3.1 to `models.json` so a model string can still get a window. **Done** — schema has no usage fields; Gemini labels + windows added; prices omitted (unconfirmed as a single catalog rate).
4. Catalog: Opus 5 label + price (cited), Terra window left missing (API 1.05M ≠ Codex occupancy), drop Prime's 131k grok fallback. **Done.**
5. Hermes / Factory / Prime: end-evidence only when the file has a real close. Do not invent one. Replace the Hermes Formic-mark stand-in with Nous Research's official mark. Same-commit PARITY.md.
6. New watchers (Cline, OpenCode, Amp) must ship at this bar, not watch-only. Official mark each time. Same-commit PARITY.md.

Do not add a Llama provider. Do not treat Composer 2.5 or SWE-1.7 as US-origin weights.
