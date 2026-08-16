# Missing CLIs — allow-list, Grok Build, Hermes

Repo: Formic. Branch from `main` in a fresh worktree. Not `the-mountain-production`.

**Goal:** One provider list. Grok Build sessions on the board. Hermes spend visible without lying that a cron job is an agent.

**Success means:** Factory/Prime bindings survive restart. A live `grok` process is a row, not `finished / process-absent`. Hermes cron spend has a named home on Usage. Health can say something is missing.

**Stop when:** A lands, B and C merge onto A, `tsc` is clean, provider-add tests are green, and a hard-refresh of a preview board shows a Grok harness row (or honest absence) plus a Hermes spend line. Do not deploy.

---

## Why three pieces, not one

Adding a CLI without fixing the allow-list can crash `:4701`. Adding Grok and Hermes as two sequential PRs fights the same `Provider` union twice.

So: **A is serial. B and C are a parallel group.** A adds both keys as absent stubs. B fills Grok. C fills Hermes. Neither B nor C edits `src/shared/types.ts`.

```
A  allow-list + stub grok + stub hermes
   ├─ B  Grok Build CLI
   └─ C  Hermes
```

---

## Locked decisions

| Decision | Call |
|---|---|
| Provider keys | `"grok"` and `"hermes"`. Binary names, not product slogans. |
| Grok ≠ Cursor Grok | Cursor-hosted `grok-4.5` stays `provider: "cursor"`. The new harness is the `grok` TUI. |
| Hermes cron is not an agent | No Focus, no Send, no Board row. Spend source on Usage. |
| Hermes interactive sessions are agents | `~/.hermes/sessions/` gets real rows if files exist. Do not call that the money fix. |
| Health `absent` | Still means "collector not installed." New field `unmodelledProviders` lists billed names with no collector. |
| Shims | Grok gets `scripts/anthill-grok` (copy Cursor TTY/`fg`, not Droid). Hermes gets none. |
| Models | Add `grok-4.6` + `grok-build` aliases. Do not invent xAI prices. |

---

## A — Allow-list + stubs (serial)

### Bug

`src/server/identity-bindings.ts:85` allow-lists four names. Scan writes factory/prime. Restart: file is invalid, `open()` throws, hub dies.

`emptySnapshot` still says 4 of 4 while `byProvider` has six keys (`src/server/app.ts:1740–1754`).

### Do

1. Delete the local list. Import `PROVIDERS` from `src/shared/types.ts`.
2. Add `"grok"` and `"hermes"` to `Provider` / `PROVIDERS` / `AuthoredNameSource` (`grok-title`, `hermes-title`).
3. Add binaries: `grok: "grok"`, `hermes: "hermes"`.
4. Stub collectors: if the home dir is missing, `absent: true` and zero errors. If present, empty `value` + one named `"not implemented"` error is **not** allowed — A must be honest absence, B/C fill the body.
5. Derive every `Record<Provider, …>` from `PROVIDERS`. No more handwritten four-or-six objects. `emptySnapshot.total` = `PROVIDERS.length`.
6. Hook reader + compact lists use the same `PROVIDERS`. Writer allowlist stays cursor/factory until B adds grok.

### Files

| File | Change |
|---|---|
| `src/shared/types.ts` | Union + list + authored sources |
| `src/server/identity-bindings.ts` | Import shared `PROVIDERS` |
| `src/server/identity.ts` | `PROVIDER_BINARIES` entries |
| `src/server/collectors.ts` | Switch cases + `collectSessions` keys |
| `src/server/state.ts` | `#sourceHealth`, `unavailableSessions` |
| `src/server/app.ts` | `emptySnapshot` |
| `src/server/cmux-hook-sessions.ts` | `HOOK_PROVIDERS` |
| `scripts/cmux-hook-store-compact.ts` | Add prime + grok + hermes |
| `src/web/naming.js` | Display names |
| `src/web/text-formatters.js` | `PROVIDER_LABELS` |
| `src/web/app.js` | `HARNESS_MARK` keys (icon can wait for B) |
| `ANT-GUIDE.md` | Eight collectors, not six |
| `tests/process-recognition-coverage.test.ts` | Samples for both binaries |
| `tests/identity-bindings.test.ts` | Factory + prime + grok + hermes load after restart |
| `tests/collector-absence.test.ts` | Missing `~/.grok` / `~/.hermes` is absent, not degraded |
| `tests/reference-docs.test.ts` | Guide names match union |

### A done when

- A bindings file with `provider: "factory"` and `provider: "prime"` loads.
- `bunx tsc --noEmit` clean.
- No collector claims Grok or Hermes sessions yet.
- Health total equals `PROVIDERS.length`.

---

## B — Grok Build CLI (parallel)

### Facts (from Grok's own guide, 2026-08-15)

Binary: `grok`. Home: `GROK_HOME` or `~/.grok`.

```
~/.grok/sessions/<encoded-cwd>/<session-id>/
  summary.json       title, model, timestamps, parent
  updates.jsonl      conversation + tools (authoritative)
  signals.json       token usage
```

Resume: `-r` / `--resume <id-or-title>`. Continue: `-c`. New id: `-s` (not resume).

### Do

1. Path identity: `~/.grok/sessions/…/<uuid>/updates.jsonl` (and `summary.json`).
2. Command identity: `grok` plus `-r` / `--resume` / `-c`.
3. Parser reads `summary.json` for name/model/times. Reads `signals.json` for tokens. Reads `updates.jsonl` for task / last message / end evidence. Missing file = that field unknown, session still collected.
4. `statusFrom` / `makeAgent` — do not copy Factory's always-`running`.
5. Harness badge is Grok Build. Model badge still fires when `model` matches `/grok/i` on **other** harnesses. A Grok-harness row must not double-swap the harness icon.
6. cmux claims: add `grok_session_id` next to the existing four in `parseCmuxTerminals`.
7. `scripts/anthill-grok` via `anthill-hook-shim-common.sh`, including Cursor's TTY/`fg` path. Writer allowlist += `grok`.
8. `config/models.json`: `grok-4.6` window + aliases (`cursor-grok-4.6`, `grok-build`). Display "grok 4.6".
9. Empty-board copy lists Grok.

### Do not

- Treat Cursor `cursor-grok-*` as this provider.
- Guess a flat `~/.grok/sessions/<uuid>.jsonl`.
- Invent prices.
- Attach hook facts by skipping Cursor's pattern — use `attachHookFacts` for grok.

### B done when

- Fixture session under `~/.grok/sessions/…` becomes a `provider: "grok"` row with title + model.
- `isRecognizedAgentProcess("grok -r <uuid>")` is true.
- Missing `~/.grok` is absent, not degraded.
- `bun test tests/grok.test.ts tests/process-recognition-coverage.test.ts tests/hook-store-shims.test.ts` green.

---

## C — Hermes (parallel)

### Facts

BurnBar bills `"Hermes"`. Interactive store `~/.hermes/sessions/` is dormant. The spend is `~/.hermes/cron/` (`cron_daily-watcher-001`).

### Do

**1. Interactive collector** (cheap, not the money)

Same `collectProvider` template as Factory. Path `~/.hermes/sessions/`. Characterize one live file before writing the parser — do not assume Claude JSONL.

**2. Cron spend sources** (the money)

New shape, not `CollectedAgent`:

```ts
interface SpendSource {
  id: string;            // "hermes:cron:cron_daily-watcher-001"
  provider: "hermes";
  kind: "cron";
  label: string;
  lastRunAt?: string;
  tokens?: TokenUsage;
  costUsd?: number;
}
```

Read `~/.hermes/cron/` (`jobs.json`, output, ticker files). Put the list on the snapshot as `spendSources`. Usage tab renders them under cost, not on Board.

No Focus. No Send. No lifecycle. If you cannot parse tokens from cron, still emit the source and say "not reported" — the row existing is the finding.

**3. Disclosure**

`unmodelledProviders: string[]` on `sourceHealth` (or Usage summary): BurnBar provider names with no Formic collector. After C ships Hermes, Hermes drops off this list. Until then it must appear even if C is mid-flight (A can seed the field from a static billed-vs-collected diff; C makes Hermes collected).

### Do not

- Force cron onto the Board as a waiting agent.
- Close the Hermes finding by collecting only `sessions/`.
- Map BurnBar `"Hermes"` onto Claude.

### C done when

- A fixture cron job appears on Usage as Hermes, not as an agent row.
- A fixture interactive session appears as a Board row if present.
- Usage names Hermes even when Board has zero Hermes agents.
- Missing `~/.hermes` is absent, not degraded.

---

## Merge / conflict rules

- A merges first.
- B and C rebase on A. They may not touch `src/shared/types.ts`.
- If both must edit `collectors.ts` `collectSessions`, B owns the grok case, C owns the hermes case, no drive-by cleanup.
- Docs: ANT-GUIDE eight-collector sentence is A's. B adds Grok resume/path. C adds the cron-is-not-a-row sentence.

---

## Out of scope

Hook `livePids` false-death. Cursor hook attach. `priorSpend` pixel. Provider cost floor. Composer. Reply. Names UI. Pilot. Deploy to `:4701`.

---

## Acceptance (whole program)

1. Bindings file with factory + prime + grok + hermes loads after restart.
2. `Provider` has eight names. Health total is 8. `emptySnapshot` matches.
3. Live or fixture `grok` session → harness row, not Cursor, not dead.
4. Hermes cron → Usage spend source. Not a Send-able row.
5. Health can list a billed name with no collector (`unmodelledProviders`). After C, Hermes is not on that list.
6. `tsc --noEmit` 0. Named tests above green. No production deploy.

---

## Rollback

Revert the integration branch. Stubs are absent collectors; reverting them cannot leave half-recognized `grok` processes if B also reverts. Do not leave `"grok"` in the union without a binary map — that is the Factory-shipped-dead hole.
