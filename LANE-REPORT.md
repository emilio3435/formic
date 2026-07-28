# WAVE 3 / BE-G — cost accounting and durable history

Date: 2026-07-28
Branch: `ant-hill/be-cost-20260728`
Implementation commit: `52fbdfd`

## Verification

| Gate | Result |
|---|---|
| `bunx tsc --noEmit` | clean |
| `bun test` | **471 pass / 0 fail**, 2081 `expect()` calls, 29 files; no runtime skips, no `.only`, no filter |
| Focused cost/config tests | 13 pass / 0 fail, including the real SQLCipher helper |
| Live read-only source check | OpenBurnBar available; an empty 1h range returned `invocations:0`, `estimatedCostUsd:null`, `costKnown:false`, `costProvenance:"unknown"` |
| Push / merge / deploy / service restart | none |

Lockfile-pinned dependencies were installed in this worktree because it initially
had no `node_modules`. `package.json` and `bun.lock` are unchanged.

## Findings

### 1. Cost and token analytics fabricate `$0.00` — **BLOCKED (cost-truth slice fixed)**

- Commit: `52fbdfd`.
- Fixed:
  - An empty result is now unknown: `estimatedCostUsd:null`,
    `costKnown:false`, and `costProvenance:"unknown"`.
  - OpenBurnBar rows with `provenanceConfidence:"exact"` retain authoritative
    cost and are marked `measured`.
  - Non-exact rows are recomputed from measured input/output/cache token counts
    and the versioned per-model price table in `config/models.json`; they are
    marked `derived_estimate`.
  - An unpriced model poisons its provider and aggregate cost to unknown. It
    never becomes zero. A genuine exact zero remains measured zero.
  - Summary, provider, series, and invocation API records carry cost
    provenance; derived series/invocations also carry the pricing version.
- Proof:
  - `tests/burnbar.test.ts` — “derives only configured model costs and labels
    the estimate”; “authoritative source cost wins, including measured zero”;
    the SQLCipher test proves mixed unknown coverage, a derived priced row, and
    the empty-range regression.
  - `tests/model-config.test.ts` — “the shipped model facts include versioned
    non-negative pricing”.
  - A live read-only query proved the installed schema and empty-range result.
- Why the finding remains BLOCKED:
  - Program cost rollups require `collectors.ts`, `state.ts`, `snapshot.ts`, and
    shared/client contracts, all forbidden to this lane.
  - `pulse.ts` and `src/web/**` do not yet consume the new cost provenance, so
    the Burn widget/Usage copy cannot yet display “measured” versus “derived
    estimate”. Those files are forbidden.
- Deliberately left alone: no guessed prices were added for Sonnet 5, Fable 5,
  GPT-5.6 Sol, Grok 4.5, or Composer. Their cost remains unknown until a verified
  config price is supplied.

### 2. Session history dies with the scan window — **BLOCKED**

- Commit: N/A.
- Reason: no owned file receives collected agents, injects archived records into
  snapshots, or serves history/export routes. A functional implementation
  requires changes in forbidden `collectors.ts`, `state.ts`, `snapshot.ts`,
  `app.ts`/`http.ts`, `archive.ts`, and `src/web/**`.
- Test: none. A standalone store in `settings.ts` would be dead code and would
  not make history survive, so no hollow test was added.
- Required routed slice:
  - Persist compact ended-session records during collection/aging.
  - Use atomic temp-write/rename, an explicit retention window, and bounded
    compaction.
  - On corrupt JSON, log loudly and open empty rather than entering a crash
    loop.
  - Add a server-side history/search path and a downloadable JSON export.
- Deliberately left alone: the 36h default / 168h maximum scan window and the
  existing explicit operator archive.

### 3. OpenBurnBar + SQLCipher prerequisite is invisible — **BLOCKED (server health fixed)**

- Commit: `52fbdfd`.
- Fixed: usage summary now emits structured `sourceHealth`:
  `healthy`, `not_installed`, `misconfigured`, or `error`. Missing database or
  SQLCipher yields the exact operator-facing message “Cost source not installed.
  Install OpenBurnBar with SQLCipher support.” Keychain/codec failures are
  distinguished as misconfiguration. No unavailable state emits zero cost.
- Proof: `tests/burnbar.test.ts` — “missing OpenBurnBar reports an install
  health state instead of zeros”; the live read-only query proves `healthy`.
- Why the finding remains BLOCKED: the Usage tab ignores this server field and
  the allowed files exclude `src/web/**`; README/QUICKSTART are also forbidden.
- Deliberately left alone: no client or documentation file was edited.

## Documentation text to route

### Cost and usage prerequisite

The Burn widget and Usage tab require OpenBurnBar’s local usage database plus a
SQLCipher-capable SQLite library. Install OpenBurnBar so its bundled SQLCipher
framework and macOS Keychain item are present. Homebrew `sqlcipher` is also a
supported library source. The default database is
`~/Library/Application Support/OpenBurnBar/openburnbar.sqlite`; the Keychain
service/account are `com.openburnbar.database-encryption` /
`database-encryption-key-v1`.

For non-default setups, use `BURNBAR_DB_PATH`, `BURNBAR_DB_KEY`, and
`BURNBAR_SQLCIPHER_DYLIB`. Treat `sourceHealth:not_installed` as a missing
prerequisite, `misconfigured` as a missing/invalid key or codec, and `error` as a
source failure. Cost is measured only when OpenBurnBar marks the row exact.
Other rows are versioned estimates derived from measured tokens and
`config/models.json`; unpriced models remain unknown.

## Out-of-scope observations

- The installed OpenBurnBar schema uses `cacheCreationTokens` and
  `provenanceConfidence`; its newer repository schema documentation currently
  describes different column names. The implementation follows the verified
  installed schema because that is the production read path.
