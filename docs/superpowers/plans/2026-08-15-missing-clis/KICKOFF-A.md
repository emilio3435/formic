# CLIS-A · Allow-list + stubs (BE · Sol xhigh via Codex)

**Mission:** One `PROVIDERS` list. Add `"grok"` and `"hermes"` as absent stubs so B and C can fill bodies without touching the union. Fix the bindings crash.

**Consumes:** spec §A. **Produces:** eight-member `Provider` union; stub collectors that never claim sessions; bindings that load factory/prime/grok/hermes.

## First action

Write `LANE-REPORT-clis-a.md` (five PENDING headings). Then red tests, then code.

## Tasks

### 1. Bindings crash

- Failing test in `tests/identity-bindings.test.ts`: persist `{ provider: "factory" }` and `{ provider: "prime" }`, reopen the file, both load. Same for `"grok"` and `"hermes"` after the union exists.
- Delete `identity-bindings.ts:85` local list. Import `PROVIDERS` from `src/shared/types.ts`.

### 2. Union + exhaustive maps

Add to `src/shared/types.ts`:

```ts
export type Provider = "codex" | "omp" | "claude" | "cursor" | "factory" | "prime" | "grok" | "hermes";
export const PROVIDERS = ["codex", "omp", "claude", "cursor", "factory", "prime", "grok", "hermes"] as const;
```

Authored sources: `grok-title`, `hermes-title`.

Every `Record<Provider, …>` must compile. Touch all of these:

| File | What |
|---|---|
| `src/server/identity.ts` | `PROVIDER_BINARIES`: `grok: "grok"`, `hermes: "hermes"` |
| `src/server/collectors.ts` | `PROVIDER_NAMES`, `AUTHORED_BY`, `collectSessionProvider`, `collectSessions`, `finalizeSessionProviders` |
| `src/server/naming.ts` | `PROVIDER_DISPLAY_NAMES` Grok / Hermes |
| `src/web/naming.js` | same keys |
| `src/web/text-formatters.js` | `PROVIDER_LABELS` |
| `src/web/app.js` | `HARNESS_MARK` keys (reuse `/icons/grok.svg` for grok; hermes can reuse a neutral mark for now) |
| `src/server/state.ts` | `#sourceHealth`, `unavailableSessions` — derive from `PROVIDERS`, do not hand-write eight keys |
| `src/server/app.ts` | `emptySnapshot`: `total` / `degraded` = `PROVIDERS.length`, `byProvider` from the same list |
| `src/server/cmux-hook-sessions.ts` | `HOOK_PROVIDERS` = shared list |
| `scripts/cmux-hook-store-compact.ts` | add prime + grok + hermes |
| `src/server/cmux.ts` | add `grok_session_id` and `hermes_session_id` to `parseCmuxTerminals` claims |

Do **not** add grok to `scripts/cmux-hook-store.ts` `HOOK_STORE_PROVIDERS`. B owns that.

### 3. Stub collectors

In `collectSessionProvider`:

- `grok` → if `~/.grok` (or `$GROK_HOME`) missing: `{ value: [], errors: [], absent: true }`. If present: `{ value: [], errors: [], absent: false }`. **Zero sessions. Zero "not implemented" errors.**
- `hermes` → same against `~/.hermes`.

Do not parse transcripts. B and C replace these bodies.

### 4. Tests + docs

- `tests/process-recognition-coverage.test.ts`: samples for `grok` and `hermes` binaries (bare process is recognized even without a resume id).
- `tests/collector-absence.test.ts`: missing homes are absent, not degraded.
- `ANT-GUIDE.md`: eight collectors. Keep the Hermes-is-billed sentence; C will rewrite the cron half.
- `ARCHITECTURE.md` rows if reference-docs requires them.
- `tests/reference-docs.test.ts`: union and guide stay in lockstep.

### 5. Floor + report

```
bunx tsc --noEmit
bun test tests/identity-bindings.test.ts tests/collector-absence.test.ts tests/process-recognition-coverage.test.ts tests/reference-docs.test.ts tests/naming.test.ts tests/naming-parity.test.ts
bun test   # full, canary-only red allowed
```

Paste output in report §4. Commit or leave dirt + report.

## Do not

- Parse `~/.grok/sessions` or `~/.hermes/**`.
- Write `scripts/anthill-grok`.
- Add `unmodelledProviders` (C).
- Push, deploy, or edit production.

## Done when

Bindings with factory/prime/grok/hermes load after restart. `tsc` 0. Stub collectors claim no sessions. Health total equals 8. Report §4 has pasted output.
