# Formic source and model parity

A harness is not covered because a row appears. Covered means the same fields Claude Code and Codex already fill, or an honest unknown (never a guessed percent or a fake $0).

## For future agents

Every instruction set for Formic work includes all three, in the **same commit**:

1. The collector / catalog change.
2. This file, rewritten for the rows you actually changed. Not a follow-up PR. If the code and this table disagree, the table is wrong.
3. **Real logos.** Research and pull the official mark for every new or newly-wired harness and model provider. Cite the source URL in the PR. Put the file in `src/web/icons/` and wire `HARNESS_MARK` / `AGENT_MARK` / `PROVIDER_MARK` in `src/web/app.js`.

Do not generate a mark. Do not draw a stand-in. Do not reuse `formic-mark.svg` as someone else's logo. Do not ship an invented `src`. If the vendor has no official public mark you can legally use, leave the mark `src` unset, say so in this file, and do not invent one.

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

Audited on `emilio3435/formic` after the field-level window pass, the Copilot CLI and Gemini CLI collectors, and official harness marks or honest unset states. Update this file when a collector, mark, or `config/models.json` changes.

## Harness marks

`HARNESS_MARK` / `AGENT_MARK` in `src/web/app.js`. A configured mark is an official file under `src/web/icons/` with a `src`; a label without one is an explicitly documented unset state. Do not generate a mark, use `formic-mark.svg` as a stand-in, or invent a `src`.

| Mark | File | Used as | Official source |
|---|---|---|---|
| Muse Code | `icons/muse.svg` | harness `muse`; agent `spark` (Muse Spark) | Favicon SVG on [Muse Code](https://developer.meta.com/ai/products/muse-code/) (`https://static.xx.fbcdn.net/rsrc.php/yf/r/-7pQO6hUGK_.svg`) |
| GitHub Copilot | `icons/copilot.svg` | harness `copilot` | `Copilot_Icon_Black.svg` from [GitHub Logos](https://brand.github.com/GitHub_Logos.zip) ([Copilot brand](https://brand.github.com/brand-identity/copilot)) |
| Google Antigravity | `icons/antigravity.png` | harness `antigravity` | Icon – Full Color on [Antigravity press assets](https://antigravity.google/press) (`https://antigravity.google/assets/image/brand/antigravity-icon__full-color.png`) |
| Gemini CLI | `icons/gemini-cli.svg` | harness `gemini` | Full-color icon from the official [Gemini CLI brand kit](https://geminicli.com/brand-kit/) (`https://geminicli.com/brandassets/gemini-cli-icon_full-color.svg`); imported byte-for-byte, SHA-256 `d2b511e4d9a97bb849526646cf1e7705ffa028a52eb53d847c6c3de1e9a40a73` |
| Gemini | `icons/gemini.svg` | agent `gemini` | Official Gemini sparkle (`https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg`) |
| Hermes Agent | — | harness `hermes` | **Unset / evidence-blocked.** The official [Hermes Agent repository](https://github.com/NousResearch/hermes-agent) and [site](https://hermes-agent.nousresearch.com/) inspected for this lane did not provide an accepted vendor-published reusable standalone mark with a stable source URL. The prior Formic stand-in was removed; no asset was invented. |

OpenAI-family agent models use `icons/openai.svg`. `agentKeyOf` keeps Sol, Luna, and Terra on distinct `sol`, `luna`, and `terra` keys for their UI labels; other raw `gpt-*` ids use `openai`. Terra still has no catalog context window.

## Harness fields

| Source | Watch | Task | Close | Model | cwd | Tokens | Window | End | Send | Gap vs bar |
|---|---|---|---|---|---|---|---|---|---|---|
| claude | yes | yes | yes | yes | yes | observed when usage present | only with usage | turn-complete (`end_turn`) | cmux-exact for CLI; Claude Desktop (`entrypoint: claude-desktop`) has no attested write | Window missing when usage missing. `end_turn` is a yield. Desktop GUI rows refuse Send without mentioning cmux; see [Claude Desktop Send evidence](CLAUDE-DESKTOP-SEND-EVIDENCE.md). Prefill is not Send. Inspector paints Thought rows from `thinking` / `redacted_thinking` (redacted stays redacted) and tool cards from `tool_use` / `tool_result`. Watch is not coverage. |
| codex | yes | yes | yes | yes | yes | observed session-cumulative | observed from payload | turn-complete | cmux-exact for CLI; Codex Desktop / `codex_work_desktop` use app-server `thread/resume` + `turn/start` or `turn/steer` | No per-call series. Open app-server FDs still do not prove a thread is live. Consumer ChatGPT is not this surface. Inspector paints Thought rows from attested `reasoning` summaries (encrypted or empty omitted) and tool cards from `function_call` / `custom_tool_call` joined to output on `call_id`. Watch is not coverage. |
| cursor | yes | yes | yes | yes | yes | latest-turn occupancy | needle table | archive / turn-complete | cmux-exact; no hook attach | Cost forced `null`. Child rows have no `startedAt`. |
| factory | yes | title or first user | yes | settings.json | yes | session totals if settings exist | needle table | **none** | cmux-exact | Silent unknown if settings missing. No clean-end. |
| prime | yes | yes | yes | only when the transcript reports one | yes | observed when usage present | needle table only for a reported model | **none** | cmux-exact | No authored title; the explicit `Prime · <session>` display fallback remains. A missing model stays absent and supplies no context window. |
| omp | yes | yes | yes | yes | yes | observed; corrupt → estimated | needle table | session-exit | cmux-exact | Legacy. |
| grok (Build CLI) | yes | yes | yes | yes | yes | occupancy `total`, not billed in/out | signals only | turn-complete | cmux-exact | Catalog 500k unused if signals omit window. Inspector already paints Thought rows and tool cards from ACP thought/tool_call updates. Watch is not coverage. |
| grok-bot | extra root only | yes | raw tail only; author unknown | **never** | instance home | **never** | **never** | **never** | gateway send; focus opens app; interrupt off | Untyped `send-message` text stays available as `transcriptTail` but never fills assistant-only fields. Not a `Provider`; collection errors feed Grok source health rather than minting a Bot slot. |
| hermes | yes | yes | yes | yes | yes | **never** | **never** | **none** | cmux-exact | Session tokens never. Cron is spend-only. |
| muse | yes | yes | yes | yes | yes | observed on `model_completed` | catalog needle when the model matches | session-exit / turn-complete | cmux-exact | Session-scope counts only — no latest-turn `total`, so `contextPct` stays blank even with a window. Unknown model → no window. Missing usage → unknown tokens, never `$0`. |
| antigravity | yes | yes | yes | sqlite `last_selected_agent_model` if that column is present | yes | **never** | catalog needle when that model matches | **none** | cmux-exact | Inspected schema (collector + fixtures + live conversation DBs): `trajectory_meta` has id/type/source only; usage/window live in protobuf blobs. No decoder. Transcript JSONL has no usage fields. Leftover `~/.gemini` (non-antigravity) is not a session source. |
| copilot | yes | yes | yes | model_change / shutdown | yes | **only on shutdown** `modelMetrics` | catalog needle when the model matches | session-exit | cmux-exact | Live sessions stay unknown-tokens (honest). Window can still attach from `session.model_change`. Terra matches no window (see catalog). Local CLI only — not the VS Code extension. |
| gemini (Gemini CLI) | yes | yes | yes | last non-empty per-message raw model | direct `.project_root`; exact hook overlay when available | observed latest-turn when present | catalog needle only when that raw model matches | no source-native end; exact hook overlay only | cmux-exact only | JSONL + legacy JSON are direct. Thought/tool rows are inspector-only. Effort, session totals, source-native end/process evidence, dedicated controls, and per-row USD are unavailable. |

## Gemini CLI source contract

The collector is pinned to official `google-gemini/gemini-cli` source commit [`e90c63fa158b8facd1872d32b34b07e516308f2b`](https://github.com/google-gemini/gemini-cli/tree/e90c63fa158b8facd1872d32b34b07e516308f2b) (upstream preview line `v0.57.0-preview.0`). The on-disk schema has no `schemaVersion`; admission requires the pinned `sessionId` + `projectHash` identity keys. JSONL replay handles `$set`, source-authoritative checkpoint `$set.messages`, exclusive `$rewindTo`, and duplicate native-message replacement. Each source mutation recomputes first-user identity when it changes a retained first-user event, while Formic-local replay trimming preserves the original first user even after that event leaves the bounded retained tail. Legacy `session-*.json` remains readable.

The default root is `~/.gemini/tmp/<hash-or-slug>/chats/`. `GEMINI_CLI_HOME` replaces only the default operator home, producing `$GEMINI_CLI_HOME/.gemini`; no XDG or `GEMINI_CONFIG_DIR` root is invented. Both 64-character hash project directories and current slug directories are scanned because migration can leave both. Copies are deduplicated by full `sessionId`, preferring newer `lastUpdated` and then mtime. Nested `<parent UUID>/<child UUID>.jsonl` rows keep their child identity and parent session id. The upstream retention default is 30 days, but Formic only applies its own live scan window and never deletes source files.

Direct fields are role-attributed user/assistant text, closing text, a bounded raw tail, native replay/tool identity, typed thought/tool inspector events, raw model, `.project_root` cwd/origin, latest-turn usage/cache, timestamps, and native parent identity. Naming uses an authored summary when present, otherwise the first resumable user task, otherwise a provider fallback explicitly marked non-authored. Partial/overlay fields are a catalog window only when the raw model has an independently documented catalog match and generic cmux hook/process facts only when exact provider-qualified identity supplies them. The synthetic pinned-schema fixture reports `gemini-3.7-flash`, whose existing 1,048,576 window is independently cited below; this lane adds no speculative catalog entry. The official schema publishes no enforced read-size ceiling, so Formic labels its 8 MiB single-record/legacy-document cap, 4,096-message replay cap, and 16 MiB retained-replay cap as local safety policy rather than vendor facts. JSONL remains streamed without a whole-file cap: one over-cap record is skipped with named source-health evidence, bounded replay preserves the first resumable task plus the newest safe state, and an over-cap legacy document is rejected because it cannot be replayed partially. The Inspector uses the same bounded reader and marks partial evidence truncated.

The debug-only `/api/debug/session-calls` endpoint re-reads a Gemini transcript through that same bounded Gemini reader and parser. The pinned fixture produces calls `[125, 150]`, a debug `sessionProcessed` sum of `275`, and prefix sums `[125, 275]`, with no unavailable reason. This on-demand call-prefix evidence is excluded from snapshots and does not become a Gemini dashboard session-total claim or per-row USD value.

Unavailable from Gemini chat files remain absent: `effort`, `launch`, `launchCwd`, process ids/liveness, session-cumulative token/cache/processed totals, `endEvidence`, transcript clean-end claims, a dedicated Gemini control surface, and per-agent USD. The generic finalizer may overlay `launchCwd`, hook lifecycle/end, or process evidence only from an exact provider-qualified cmux hook/process record; those remain overlays rather than Gemini-source claims. `gemini --resume <full UUID>` and full nested-session paths are exact identity. A main filename's eight-character UUID prefix becomes exact only when its full path equals one collected row's transcript artifact; a prefix alone authorizes nothing. Focus, Send, and Interrupt are enabled only for exact current cmux identity; cwd-only coincidence enables none.

A refresh-watchdog abort is orchestration cancellation, not Gemini source-health evidence. `HubState` rethrows an aborted provider result and discards the abandoned in-flight settlement before the replacement generation scans again; `tests/state-health.test.ts` and `tests/provider-settlement.test.ts` pin that the abort cannot publish red Gemini health, empty replacement rows, a late staged result, or abandoned success in place of prior last-known evidence after a replacement timeout.

## Known collector field incompatibilities

This is the standing ledger from the collectors and their tests. An unsupported field stays absent or `null`; a related timestamp, percentage, path, or text tail is not a substitute. Close a row only when the source format supplies direct evidence and the collector plus tests consume that evidence.

| ID | Source | Field boundary | Code-backed behavior |
|---|---|---|---|
| I-100 | Grok Bot | `lastAgentMessage`, `lastAgentClosing`, `lastAgentChatBody` | `parseReplica` admits only explicit `role:user` records to `humanMessages`. Untyped `send-message` text remains only in `transcriptTail`; `tests/grok-bot.test.ts` fails if it reaches assistant-only fields. |
| I-101 | Cursor | `tokens.sessionTotal` | `cursorTokensFromDatabase` can publish an observed latest-turn `total`. Otherwise `fillCursorOccupancy` copies Cursor's own `contextUsagePercent` to `occupancyPct` only; it does not manufacture `total` or `sessionTotal`. |
| I-102 | Grok Build CLI | `tokens.sessionTotal` and per-row cost | `tokenUsage` maps `signals.contextTokensUsed` to latest-turn `total` and optional `contextWindow`; it emits no cumulative session total or collector cost. |
| I-103 | Codex and Cursor | `callSizes` | `session-calls.ts` names both sources in `NO_PER_CALL_REPORTING`. `tests/session-calls.test.ts` directly requires the collected field to stay absent and the endpoint to return an explained `null`, never `[]`, because an empty series would falsely assert zero calls. |
| I-104 | Cursor | hook lifecycle and process facts | `finalizeSessionProviders` returns Cursor unchanged and runs `attachHookFacts` only for other providers. Cursor GUI processes are not treated as native session hooks. |
| I-105 | Grok Bot | process identity and process liveness | `collectGrokBotSessions` emits no process ids. `snapshot.ts` excludes Bot rows from complete-roster inference, so roster age never becomes process absence. |
| I-106 | Hermes | per-turn timestamps after the header | `createHermesParser` uses the JSONL header timestamp and the transcript mtime, choosing the later value for `updatedAt`; it does not invent timestamps for individual later turns. |
| I-107 | Prime | authored title and unreported model | `parsePrimeJsonl` has no source title and keeps `displayName` as `Prime · ${sessionId.slice(0, 8)}`. `tests/prime.test.ts` directly pins that display fallback while requiring an unreported model and context window to remain absent. |
| I-108 | Cursor child agents | `startedAt` | `parseCursorChildSession` publishes the observed transcript `updatedAt` but no `startedAt`; `tests/cursor.test.ts` directly rejects an invented field, so elapsed lifetime remains unavailable. |
| I-109 | Cursor GUI, Antigravity IDE, and Gemini CLI | cwd-only control identity | These collectors set `allowCwdFallback: false` where exact identity is required, and durable Focus reconstruction restores that false value before considering a unique-cwd shortcut. Gemini CLI enables Focus, Send, and Interrupt only after provider-qualified exact cmux evidence; cwd-only coincidence returns `409 CONTROL_DISABLED` and executes no cmux command. |
| I-110 | All collectors | per-agent USD cost | `makeAgent` has no collector cost input. Cursor explicitly publishes `cost: null`; fleet dollar handling is isolated to BurnBar, where missing or unpriced data remains unknown rather than `$0`. |
| I-111 | Antigravity v1 | token usage | `UNKNOWN_TOKENS` remains `{ scope: "unknown", provenance: "unknown" }`. A catalog match may attach `contextWindow`, but the protobuf usage blobs are not decoded into token totals. |
| I-112 | Antigravity legacy | `*.pb` conversations | `collectSurface` enumerates conversation `*.db` files only. `tests/antigravity.test.ts` places a legacy `*.pb` file in the scanned directory and requires zero rows, so the current scanner cannot claim it as parsed. |
| I-113 | Muse | sessions when the local store is absent | `collectMuseSessions` returns `{ value: [], errors: [], absent: true }` when the Muse root is missing. No session row is synthesized. |
| I-114 | Gemini CLI and Antigravity | parent `~/.gemini` settings | Parent `settings.json` may establish Gemini CLI configuration presence for discovery but creates zero rows and its values are never parsed. Gemini CLI owns only `tmp/*/chats`; `defaultAntigravityTrees` still owns only `antigravity-cli`, `antigravity`, and `antigravity-ide`. Both collectors are pinned to zero rows for a settings-only parent. |
| I-115 | Gemini CLI | effort, session totals, source-native end/process evidence, dedicated controls, per-agent USD | The pinned conversation records expose none of these fields. `gemini.ts` leaves them absent, never publishes a dashboard session total, never substitutes file retention for an ending, and never adds a write endpoint. The debug-only call endpoint may sum bounded, re-parsed call sizes for adjudication without mutating the snapshot claim. Exact generic cmux hook/process evidence may still overlay lifecycle, launch-cwd, and liveness without becoming a Gemini-file claim. |

Alternate-home onboarding is advertised only for the collector-wired `cursor-gui`, `grok-cli`, `grok-bot`, `copilot`, and `gemini-cli` kinds. Their default and onboarded extra roots feed the same provider collection result and source-health path. Instance IDs combine the readable root basename with a deterministic 16-hex digest of collector kind plus normalized absolute path, so two separately onboarded roots named `.gemini` (or any other shared basename) remain distinct without publishing their parent paths. Version-1 basename-only rows migrate in place by exact kind+path, preserving onboarding, ignore, custom-label, and discovery state. Other recognizable alternate roots remain visible as `needs-parser`; the store and API refuse to onboard them as working collectors.

Not modelled (discover / `needs-parser` or absent): Cline, OpenCode, Amp, Kiro, Devin Desktop / Windsurf, Goose, OpenHands, Aider. Cloud-only (Jules, Bolt, v0, Codex/Claude web with no local dir): out.

## US model catalog

`config/models.json` + `model-config.ts`. Needles apply to Claude / OMP / Prime / Cursor / Factory / Muse / Copilot / Antigravity / Gemini CLI. Hermes and Grok Bot do not use this table. Grok CLI uses signals.

| Model | Label | Window | Priced | Used as |
|---|---|---|---|---|
| GPT-5.6 Sol | sol 5.6 | 258,400 | yes | model behind Codex / Cursor / Copilot; distinct `sol` UI key with the OpenAI-family mark |
| GPT-5.6 Terra | terra 5.6 | **missing** | yes | same; distinct `terra` UI key with the OpenAI-family mark. Cannot compute `contextPct` from catalog. OpenAI API lists 1,050,000 ([GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)); this catalog's Sol/Luna 258,400 is Codex occupancy, a different unit. Do not guess 258,400. |
| GPT-5.6 Luna | luna 5.6 | 258,400 | yes | same; distinct `luna` UI key with the OpenAI-family mark |
| Claude Opus 5 | opus 5 | yes (`opus-5` / `opus 5`) | yes ($5 / $25, cache 0.5 / 6.25) | source = Claude Code. Price from [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing). `claude-opus-4-8` stays labeled opus 4.8. |
| Claude Sonnet 5 | sonnet 5 | yes | no | model |
| Claude Fable 5 | fable 5 | yes | no | model |
| Gemini 3.7 Flash | gemini 3.7 flash | 1,048,576 | **no** | source = Gemini CLI / Antigravity / Copilot. The Gemini CLI synthetic pinned-schema fixture carries raw `gemini-3.7-flash`; window from [Gemini 3.7 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash). Official $0.75/$3.75 is introductory through 2026-12-31, then $1.50/$7.50 — catalog has no effective-date, so price is omitted. |
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
4. Catalog: Opus 5 label + price (cited), Terra window left missing (API 1.05M ≠ Codex occupancy), drop Prime's 131k grok fallback and synthetic `prime` 1M window. **Done.**
5. Hermes / Factory / Prime: end-evidence only when the file has a real close. Do not invent one. **Done for the mark boundary:** the Hermes Formic stand-in is removed and the mark remains unset because official reusable-asset evidence was unavailable for this lane.
6. New watchers (Cline, OpenCode, Amp) must ship at this bar, not watch-only. Official mark each time. Same-commit PARITY.md.

Do not add a Llama provider. Do not treat Composer 2.5 or SWE-1.7 as US-origin weights.
