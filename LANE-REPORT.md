# Wave 1 / OPS — production-sensitive scripts

Date: 2026-07-28

Branch: `ant-hill/ops-scripts-20260728`

Code and regression-test commit: `078e016`

Nothing was pushed, merged, deployed, restarted, or run against the live
`ai.imaginethat.anthill` service. All mutation checks used disposable fixtures
under `/private/tmp/claude-501`.

## Finding results

### 1. Hygiene could repoint production at the wrong worktree

- **Status:** FIXED
- **Commit:** `078e016`
- **Change:** `anthill-hygiene.sh` now derives its default repo from its own
  location and requires that repo to be on `main` before any plist write,
  `launchctl` call, or listener handling. `ANTHILL_REPO` remains available for an
  explicit main-worktree override and is subject to the same branch guard.
- **Proof:** `tests/anthill-scripts.test.ts` — “hygiene refuses a feature-branch
  worktree before rewriting its LaunchAgent plist”. The fixture preserves a
  production-plist sentinel and proves the fake `launchctl` was never called.
- **Deliberately left alone:** no live plist, listener, service, or production
  worktree was inspected or changed.

### 2. Throwaway preview shared production persistence

- **Status:** FIXED
- **Commit:** `078e016`
- **Change:** `anthill-preview.sh` copies the invoking worktree's current `src/`
  and `config/` into a per-run `mktemp` root, creates a fresh `data/`, copies only
  `data/cmux-socket.env` when present, runs the server in the temporary root, and
  removes the root on exit. Preview writes therefore resolve beneath the
  temporary project root rather than the invoking worktree's `data/`.
- **Proof:** `tests/anthill-scripts.test.ts` — “preview writes only to its
  temporary data root and removes it after exit”. A fake server performs the
  same relative `data/archive.json` write that the real server performs; the
  production sentinel remains byte-identical and the temporary root is gone.
- **Deliberately left alone:** `src/server/index.ts` was not edited because
  `src/**` belongs to another lane. Preview state is intentionally not seeded
  from production; only cmux socket authentication is shared.

### 3. `bun start` discarded its PATH-resolved cmux executable

- **Status:** FIXED
- **Commit:** `078e016`
- **Change:** the in-shell path resolves cmux and exports
  `CMUX_EXECUTABLE`; the dedicated-workspace path includes the safely
  shell-escaped resolved executable in its server command.
- **Proof:** `tests/anthill-scripts.test.ts` — “start propagates a PATH-resolved
  cmux executable to both server launch paths”. The fake cmux binary lives in a
  directory containing a space; the test executes the captured workspace
  command and proves both server launches receive the exact resolved path.
- **Deliberately left alone:** `src/server/cmux.ts` is outside this lane and did
  not need modification once the launcher supplies the runtime override.
  `scripts/setup-cmux-password.ts` was also left unchanged: its config-reload
  executable selection is separate from the reported `bun start` propagation
  defect.

### 4. `bun start` could not run without cmux

- **Status:** ALREADY-FIXED / FIXED
- **Commit:** `b02f236`
- **Change:** none in this lane. The branch already contained
  `fix(start): honest shell fallback when cmux is absent`, which routes auto mode
  to `run_server_here` and reports that Focus/Send remain disabled.
- **Proof:** `git show b02f236 -- scripts/anthill-start.sh`, plus
  `tests/anthill-scripts.test.ts` — “start keeps the existing no-cmux fallback
  and binds the canonical port”. The scratch run has no cmux on PATH, exits 0,
  prints the monitoring-only warning, and invokes the fake Bun server.
- **Deliberately left alone:** the existing fallback implementation and wording
  were not rewritten or otherwise “improved”.

### 5. `bun start` defaulted to port 4702

- **Status:** FIXED for this lane's script side
- **Commit:** `078e016`
- **Change:** `anthill-start.sh` and its `--help` text now default to 4701,
  matching the server default. With production already answering on 4701,
  `already_up` reuses that instance instead of starting a second writer on
  4702.
- **Proof:** `tests/anthill-scripts.test.ts` — “start keeps the existing no-cmux
  fallback and binds the canonical port” proves the launched fake server
  receives `MOUNTAIN_PORT=4701`.
- **Deliberately left alone / docs handoff:** README's operator URL and DEPLOY's
  production table already say 4701 and need no script-lane edit. QUICKSTART's
  current fallback URL still says `http://127.0.0.1:4702`; its owner needs to
  change that URL to `http://127.0.0.1:4701`. No README, QUICKSTART, DEPLOY,
  package, config, or `src/**` file was edited.

## Executable before/after evidence

Before the code change, the scratch regression run failed all four checks. These
are the relevant terminal lines captured from that run:

```text
LaunchAgent pointed at wrong tree:
  WorkingDirectory=<missing>
  ProgramArguments[1]=<missing>
Repointing to /private/tmp/claude-501/anthill-ops-tests-25500/hygiene-feature-branch

fake bun cwd=/private/tmp/claude-501/anthill-ops-tests-25500/preview-data-isolation data=/private/tmp/claude-501/anthill-ops-tests-25500/preview-data-isolation/data

Received: "MOUNTAIN_PORT=4702 bun run start:server"
Received: "port=4702 cmux=/private/tmp/claude-501/anthill-ops-tests-25500/start-no-cmux/missing-cmux args=run start:server"

0 pass
4 fail
```

After the code change, the same scratch test file produced:

```text
(pass) production-safe Ant Hill scripts > hygiene refuses a feature-branch worktree before rewriting its LaunchAgent plist
(pass) production-safe Ant Hill scripts > preview writes only to its temporary data root and removes it after exit
(pass) production-safe Ant Hill scripts > start propagates a PATH-resolved cmux executable to both server launch paths
(pass) production-safe Ant Hill scripts > start keeps the existing no-cmux fallback and binds the canonical port

4 pass
0 fail
19 expect() calls
Ran 4 tests across 1 file.
```

A direct post-fix invocation against this feature-branch worktree, with HOME
redirected to scratch, exited before any service action:

```text
error: Hygiene worktree must be on 'main' (currently 'ant-hill/ops-scripts-20260728'). Aborting.
```

## Final verification

- `bash -n scripts/anthill-hygiene.sh scripts/anthill-preview.sh scripts/anthill-start.sh` — passed.
- `bunx tsc --noEmit` — passed with no diagnostics.
- `bun test` — **371 pass, 0 fail, 1581 expect() calls, 25 files**.
  The conditional SQLCipher case ran and passed; no tests were skipped, focused,
  or filtered.
- `git diff --check` — passed.
- The repository has no lint script and `shellcheck` is not installed; no lint
  result is claimed.
- The first typecheck attempt could not use Bun's sandboxed temp/cache path, and
  the next exposed that this fresh worktree had no installed `@types/bun`.
  `bun install --frozen-lockfile` installed the tracked dependencies without
  changing `package.json` or `bun.lock`; the exact required commands then passed.

---

# Under-hood program lane reports — 2026-07-23

# SOL under-hood backend quick wins

Date: 2026-07-23

Branch: `ant-hill/sol-under-hood-20260723`

Base: `f4320f8`

## Changes

1. `be05c31 fix: preserve unreported Codex models`
   - Removed the synthetic `gpt-5.6-sol` fallback.
   - Added a model-free Codex JSONL fixture and regression test.

2. `fabe2a7 feat: load model knowledge from config`
   - Added `config/models.json` for Claude context windows, model-family aliases, and the expected Cursor root model.
   - Added a boot-time loader with compiled defaults for missing or malformed files.
   - Kept the explicit Claude `[1m]` marker rule in collector code.
   - Covered the shipped file, fallback behavior, and an overridden value reaching collector resolution.

3. `9899850 fix: honor runtime cmux executable`
   - Wired `CMUX_EXECUTABLE` through terminal/notification discovery and control/broadcast execution.
   - Preserved `DEFAULT_CMUX_EXECUTABLE` when the environment value is absent or blank.

4. `2027f3f fix: report staged instruction failures`
   - Retried Enter once after text was staged.
   - Added `TEXT_STAGED_NOT_SUBMITTED` with the retry's stderr and exit code after two Enter failures.
   - Preserved `CMUX_COMMAND_FAILED` for `send_text` failures.

5. `e9583ff fix: evict stale collector cache entries`
   - Evicted provider cache entries absent from the current scan.
   - Added a regression test that recreates a path with identical size/mtime and proves stale parsed data is not reused.

## Verification

- `bun run check` passed after every code commit:
  - `be05c31`: 300 tests passed
  - `fabe2a7`: 303 tests passed
  - `9899850`: 306 tests passed
  - `2027f3f`: 309 tests passed
  - `e9583ff`: 310 tests passed
- Final `bun run check`: typecheck passed; 310 tests passed, 0 failed.
- `git diff --check f4320f8..HEAD`: passed.
- `f4320f8` is an ancestor of the final code head.
- No `src/web/*` files changed.

## Discovered and deferred

- The pre-existing modified `bun.lock` and untracked `LANE-BRIEF.md` were left untouched and excluded from all commits.
- Loopback/origin-guard duplication remains unchanged for the body-restyle follow-up ticket.
- No collector token or usage arithmetic was changed.
- Nothing was pushed or merged.

---

# Lane Report — fable-identity-20260723

Branch `ant-hill/fable-identity-20260723`, cut from main @ ea9966a. Goal: make the session↔surface identity chain inspectable and resilient (evidence trace, debug endpoint, sticky bindings, docs, tests).

## Commits

| Commit | Scope |
|---|---|
| `80cd183` | feat(identity): retain per-surface and per-agent identity evidence traces |
| `7c0e494` | feat(server): add read-only GET /api/debug/identity endpoint |
| `d9d3191` | feat(identity): persist sticky session-to-surface bindings |
| `a5f21f7` | docs: add ARCHITECTURE.md and fix README port drift (4702 → 4701) |
| `(this)`  | chore: lane report |

Not pushed; no merges. `bun.lock` has a pre-existing uncommitted modification from dep install — left untouched.

## Evidence

- `bun run check` green at every commit. Base: **295 pass**; final: **317 pass, 0 fail, 1329 expect() calls, 23 files** (`bunx tsc --noEmit` clean, TS strict).
- 22 new tests, existing tests untouched: `tests/identity-trace.test.ts` (7 — surface evidence for lsof match/conflict/command hint; tier trace for exact, cwd fallback, duplicate-cwd ambiguity, quarantine), `tests/debug-identity.test.ts` (4 — list, single agent, unknown-agent 404, POST falls through to API 404), `tests/identity-bindings.test.ts` (10 — fresh confirm via real enrichment output, re-confirm refresh, bridge on silent scan, live-evidence-outranks-binding, two-scan reassignment, conflict-stays-quarantined-with-binding, conflicted scans never record, HubState wiring end-to-end, store reopen, TTL pruning on load/save, corrupt-file fail-loud), plus 1 wiring test through `HubState.refresh`.
- Sample endpoint output (captured from a scratch run of the test fixture through `createMountainFetch`):

```json
GET /api/debug/identity
{
  "ok": true,
  "agents": [{
    "id": "claude:019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
    "provider": "claude", "resolution": "exact", "tier": "session",
    "surfaceId": "SURFACE-HEALTH",
    "quarantined": false, "cwdMismatch": false, "bindingBridged": false
  }],
  "surfaceCount": 1, "conflictedSurfaceIds": []
}

GET /api/debug/identity?agent=claude:019f86c4-1558-7000-aeb8-26e2cfd0e8ec
{
  "agent": { "...summary": "...", "target": { "resolution": "exact", "surfaceId": "SURFACE-HEALTH" },
    "trace": { "matchedTier": "session", "steps": [
      { "tier": "recorded", "outcome": "skipped", "detail": "No recorded cmux target IDs on this source." },
      { "tier": "session", "outcome": "matched", "detail": "Source session ID 019f86c4-… recorded by cmux on surface SURFACE-HEALTH." } ] } },
  "relatedSurfaces": [{ "surfaceId": "SURFACE-HEALTH", "tty": "ttys033",
    "identityTrace": { "outcome": "open-file-match",
      "processes": [{ "pid": 4242, "command": "claude --resume", "recognizedAgentProcess": true }],
      "openFileMatches": [{ "pid": 4242, "path": "/Users/me/.claude/projects/p/019f86c4-….jsonl", "provider": "claude", "sessionId": "019f86c4-…" }] } }]
}
```

## Design decisions

1. **Traces are additive, resolution is untouched.** `resolveAgentTarget` became a thin wrapper over new `resolveAgentTargetWithTrace` so the returned `CmuxTarget` objects stay byte-identical (existing tests use exact `toEqual` on them). Surface evidence lives on `CmuxSurface.identityTrace`; the compact per-agent tier trace on `AgentSnapshot.identityTrace`. The full process/file dumps are NOT duplicated per agent — the debug endpoint joins agent trace + related surface traces at read time (via a new optional `MountainAppState.surfaces?()` accessor, implemented by `HubState`).
2. **`identityTrace` is excluded from `snapshotFingerprint`** (like `elapsedMs`) so evidence detail (pids, binding timestamps) never churns SSE pushes.
3. **Binding confirmation = lsof only.** Only surfaces whose trace outcome is `open-file-match` (single session, no conflict) record/refresh a binding; command hints and carried-over cmux metadata never move one. A session confirmed on two surfaces in one scan is contested and skipped.
4. **Bridge rules (fail-safe by construction):** bridging sets `agent.recordedTarget` (with `source: "binding"`, `reason: "Recorded binding, live evidence absent this scan."`) only when the agent is running/waiting, has no recordedTarget of its own, and the scan produced NO live evidence for the session. Live evidence always wins. A bound surface carrying exact evidence for a *different* session is a contradiction, not a gap — never bridged. A bound surface with `identityConflict` IS still bridged so tier 1 quarantines it visibly (binding can never un-quarantine; verified by test).
5. **Reassignment:** a scan showing the session exactly on a different surface increments `pendingReassignment` (reset if the candidate changes; cleared by re-confirmation of the current target); the binding moves only at 2 consecutive agreeing scans. A no-evidence scan leaves pending untouched (it neither agrees nor disagrees).
6. **Store:** `JsonIdentityBindingStore` copies `archive.ts`'s atomic write-temp-rename + serialized write-queue pattern, with injected file ops and clock for tests; 7-day TTL pruning on load and on save; corrupt records fail `open()` loudly (archive convention). Binding write failures surface in `controlHealth.errors` instead of breaking the refresh loop.
7. **`recordedTarget` extended** with optional `reason`/`source`/`confirmedAt` — the vehicle that makes targets.ts tier 1 live for active agents (previously dead code), exactly per the Luna diagnostic. Archive-written recordedTargets are unaffected.
8. **Endpoint uses `?agent=`** (not a path segment) because agent IDs contain a colon (`claude:<uuid>`); GET-only, `SECURITY_HEADERS` passed in from app.ts (avoids an import cycle), `no-store`, additive ~3-line route block in app.ts.

## Deferred / out of scope

- No UI for the debug endpoint or traces (lane is server-only by constraint).
- Bindings do not bridge sessions whose bound surface disappeared from discovery (tier 1 simply finds no match and falls through) — acceptable: cmux restart invalidates surface IDs anyway.
- The bridge-skip on a reclaimed surface (decision 4) is documented in ARCHITECTURE.md but not annotated as an explicit trace step; the related-surface evidence in the debug endpoint makes it visible.
- `collectors.ts`/`cursor.ts` token semantics, `control.ts` execution, triage/issue code, and all `src/web` files untouched per lane boundaries.

---

# Lane Report — opus-cursor-policy-20260723

Branch `ant-hill/opus-cursor-policy-20260723`, cut from `main` @ 5b71f38. Goal:
make the Cursor model policy and the row model display honest for Cursor's own
model families, ahead of a sibling lane's model-extraction fix that will start
reporting real strings (`composer-2.5-fast`, `composer-2`, `cursor-grok-4.5-high-fast`,
`grok-4.5-fast-xhigh`, `claude-…`, `gpt-…-sol`, …). Nothing pushed.
# Lane Report — cursor-model-20260723

Branch `ant-hill/opus-cursor-model-20260723`, cut from main @ `5b71f38`. Goal: fix
Cursor model detection using the fields the real stores persist, taking model
coverage from ~15% to ~92% CLI / 100% GUI (incl. Composer models). Scope limited to
`src/server/cursor.ts` + `tests/cursor.test.ts`.

## Commits

| Commit | Scope |
|---|---|
| `55a1695` | feat(model-config): `cursorNativeFamilies` list + `composer-2`/`composer-2.5` aliases + `cursorNativeFamily()` helper (config + defaults + tests) |
| `2cc52fa` | feat(snapshot): `cursorModelPolicy` treats any Cursor-native family as compliant (+ tests) |
| `02d4ff3` | feat(app): `modelShort` short forms for Composer and Grok (+ tests) |
| `(this)`  | docs: lane report |

## Behavior

- **Config**: `cursorNativeFamilies = [grok-4.5, cursor-grok-4.5, composer-2, composer-2.5]`.
  Matching mirrors the existing alias approach (exact or hyphen-bounded prefix),
  so `composer-2.5-fast` resolves to `composer-2.5`, never `composer-2`. Compiled
  `DEFAULT_MODEL_CONFIG` and the shipped `config/models.json` stay identical (the
  `toEqual` test enforces it); missing/malformed file → compiled defaults, the
  file-present/absent pattern preserved.
- **Policy**: an observed model in ANY native family → `compliant`; a reported
  non-native model → `mismatch`; missing model → `unreported`. The subagent
  parent-inheritance branches (expected = parent model, `cursor-ai-tracking`
  evidence, unverified-parent → unreported) are unchanged. Summaries name the
  family that matched.
- **Display**: `composer-2.5-fast → "composer 2.5 fast"`, `composer-2 → "composer 2"`,
  `cursor-grok-4.5-high-fast → "grok 4.5"`, all within the existing 18-char bound
  and mono style. Anthropic/Codex/Sol/Luna/Fable short forms unchanged. The bare
  `["grok","grok"]` `MODEL_SHORT` entry was replaced by the versioned Grok branch.

## Verification

`bun run check` green: **350 pass / 0 fail** (344 base + 6 new), `tsc --noEmit`
clean, TS strict, no `any`. New coverage: composer compliant, cursor-grok
compliant, claude/gpt reported → mismatch, missing → unreported, config-absent
defaults, `cursorNativeFamily` matching, and the `modelShort` cases.

## DECISION AWAITING OWNER CONFIRMATION

**"Composer counts as compliant native" is a DEFAULT, not a settled ruling —
Emilio may veto.** If Composer should NOT be an approved native family, it is a
one-line config reversal: remove `"composer-2"` and `"composer-2.5"` from
`cursorNativeFamilies` in `config/models.json`. No code change needed — Composer
sessions then read as `mismatch`. Aliases/short-forms can stay regardless so the
names still render cleanly.

## Out of scope / untouched

- `bun.lock` (pre-existing uncommitted dep-install change) left untouched, not
  buried in any commit.
- No CSS, no render functions (active layout/sticky-header lane elsewhere).
- README "Data truth" section was read for policy intent but not edited (outside
  the allowed file set). Its wording still says "Grok-family … compliant" and
  should be widened to "Cursor-native (Grok + Composer)" if this default holds.
| `cfbf902` | feat(cursor): detect real models from live CLI and GUI stores |
| `(this)`  | test(cursor): pin Cursor out of token/burn rollups + lane report |

Not pushed; no merges. The pre-existing modified `bun.lock` (from dep install) was
left untouched and excluded from all commits. No `src/server/types.ts` change was
needed — `CollectedAgent.effort` already existed; the only new field is `effort` on
the module-local `CursorStoreEvidence` in `cursor.ts`.

## What changed

**CLI** (`~/.cursor/chats/<hash>/<uuid>/store.db`), in `readCursorStoreEvidenceFrom`:
1. PRIMARY: meta key `'0'` hex-JSON `lastUsedModel` (e.g. `grok-4.5`, `composer-2.5`),
   present on newer sessions only (7/89 today); used when present.
2. FALLBACK: newest assistant blob's `content[].providerOptions.cursor.modelName`
   (e.g. `cursor-grok-4.5-high-fast`, `composer-2.5-fast`). Blobs (`data` byte `0x7B`)
   walked newest-first by `rowid`; the model lives on content PARTS (`reasoning`/
   `redacted-reasoning`/`text`), not on message-level `providerOptions.cursor` (which
   holds only `modelProviderMessageId`/`requestId`).
3. TERTIARY: the old `powered by (Cursor X.Y)` system-prompt regex, last resort only.

**GUI** (`state.vscdb` → `cursorDiskKV`), in `collectCursorGuiSessions`:
1. PRIMARY: `composerData:<conversationId>.modelConfig.modelName` (all families incl.
   every Composer variant; sentinel `"default"` treated as unreported).
   `modelConfig.selectedModels[0].parameters` (`[{id,value}]`) surfaces the `effort`
   tier into the agent's `effort` field. The `state.vscdb` handle now stays open
   through the loop; the `cursorDiskKV` table is probed via `sqlite_master` and the
   query is guarded for older installs.
2. FALLBACK: existing `ai-code-tracking.db` lookup (for `"default"` / missing table).

External JSON parsed as `unknown` behind guards (`asRecord`, `nonEmptyString`,
`contentPartModelName`, `composerEffort`); no `any` added. Live-store reads are
read-only (`readonly:true`, with `immutable=1` only as a WAL-sidecar fallback).

## Coverage evidence (measured on this machine, new code, read-only)

| Surface | Metric | Result |
|---|---|---|
| CLI | store.db with a resolved model | **85 / 89 = 96%** (7 via `lastUsedModel`, 78 via blob/system) |
| CLI | old baseline (system regex only) | 56 / 89 = 63% today |
| GUI | local conversations with a `composerData` entry | **234 / 234 = 100%** |
| GUI | explicit composerData model | 213 / 234 = 91% (21 `"default"` → ai-tracking) |

The 4 unresolved CLI stores are sessions with no assistant blobs yet. Note the
system-regex-only baseline measured 63% on today's Grok-heavy session mix, not the
~15% the task cited (mix-dependent); either way it is a large, verifiable jump. GUI
model coverage is effectively 100% via composerData + ai-tracking fallback.

## Token / context-occupancy decision

**Cursor tokens left fully untouched** — `{scope:"unknown", provenance:"unknown"}`,
`cost: null`. Context occupancy (`contextTokensUsed`/`contextTokenLimit`, on 668/864
composerData) is **NOT surfaced.** After tracing consumers: `snapshot.ts` rolls up
usage off `tokens.total`; `pulse.ts` rolls up burn off `tokens.sessionTotal` +
`provenance==="observed"` and already drops `provider==="cursor"`; and the renderer
`src/web/app.js` prints `tokens.total / tokens.contextWindow` as **consumed** tokens.
Any honest occupancy display needs a "used" figure, and the only carriers
(`total`/`contextWindow`) are exactly what the renderer treats as billed usage — so a
truthful occupancy surface would require a new field plus an `app.js` change, which is
outside this lane's file scope. Rather than risk a context snapshot reading as billed
tokens, occupancy stays out. A pin test locks the invariant (no numeric totals,
unknown provenance) and asserts through `buildSnapshot` + `PulseTracker` that a
working Cursor agent adds 0 to the token sum/median/reporting and lands in burn
`coverage.unknown`, never `eligible`.

## Verification

`bun run check` — typecheck (strict) + full suite green: **349 pass, 0 fail**
(344 base + 5 new Cursor tests). New tests: meta `lastUsedModel` wins over blob
modelName; newest assistant blob modelName fallback detecting a Composer model; GUI
`composerData` model + `effort` overriding ai-tracking; GUI `"default"` → ai-tracking
fallback; plus the rollup-exclusion pin. The pre-existing WAL/mode-ro and GUI-fallback
tests continue to pass unchanged.

## Postmortem — live gap after deploy (subagent path missed)

After landing, live measurement showed the gap barely moved: **137 / 163 Cursor
agents were still model-less**, all with a fresh `updatedAt` (re-collected every tick,
not stale archives). Root cause, verified by running the *actual* collector against
the live home:

- **All 137 blanks were subagents** — `parentSourceSessionId` set, 0 blank roots.
  They are enumerated by `cursorChildAgents` (reads
  `<project>/agent-transcripts/<parentId>/subagents/<childId>.jsonl`) →
  `parseCursorChildSession`, whose model came **only** from `latestCursorModel`
  (ai-code-tracking), which is silent for subagents.
- The composerData PRIMARY lookup landed in the first commit was wired **only** into
  the conversation-search-driven loop in `collectCursorGuiSessions` — subagents (and
  any other blank) never reached it.
- The sample `94c107d8-…` (coordinator's example) has no `~/.cursor/chats` dir, no
  own `agent-transcripts` dir, and **no** conversation-search row — it is a subagent
  whose transcript lives under its parent `3b191f66-…`'s `subagents/` folder, and its
  model exists in `cursorDiskKV` as `composerData:94c107d8-…` = `cursor-grok-4.5-high-fast`.
  (The coordinator's "glass membership" hypothesis pointed at the right *fix* — model
  by session id — but the real *entry path* is the subagent transcript, not membership
  enumeration; there is no membership-enumeration code path.)
- **137 / 137 blanks were resolvable via `composerData:<childSessionId>`.**

**Fix (commit `697e052`):** `fillMissingCursorModels` — a universal last-resort pass
in `collectCursorSessions` that, after every entry path (chats store.db,
agent-transcripts, conversation-search, subagents), fills any agent still missing a
model + effort from `composerData:<sourceSessionId>`, keyed purely by session id.
`guiComposerModel` was renamed `composerModelForSession` to reflect the shared,
path-agnostic role. Tokens remain untouched (the pass only ever writes `model` /
`effort`). GUI conversation-search sessions keep composerData as their PRIMARY source;
this pass only touches sessions left blank.

**Live re-run of the collector against the real home: 162 / 162 agents now carry a
model (was 25 / 162); 0 blank.** Regression test added: a subagent absent from
conversation-search, with no ai-tracking row, resolves its `model` and `effort`
purely from `composerData`. Final `bun run check`: **356 pass, 0 fail** (typecheck
strict clean).
