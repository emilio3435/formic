# WAVE 3 / BE-F — collector cost, Cursor truth, and agent liveness

Implementation commit: `7087ff30d7f092d387ecaeff499fb8eca59b5f70`

## 1. Cursor collector has zero caching

Status: **FIXED**

Commit: `7087ff30d7f092d387ecaeff499fb8eca59b5f70`

- Cached `store.db` evidence by device, inode, size, mtime, and WAL fingerprint.
- Cached `meta.json`, transcript reads/summaries, transcript paths, batched AI-tracking models, and `state.vscdb` session/composer evidence.
- Proof: `tests/cursor.test.ts` — `caches unchanged stores and invalidates when their fingerprint changes`.
- Live proof: a 168-hour collection over 305 Cursor agents measured 135.4 ms cold and 31.3 ms unchanged, with 0 errors. Before the final cache work, the unchanged run measured 1136.4 ms.
- Left alone: settings, snapshot, client, and runtime-service files.

## 2. Cursor store full-blob scan on every tick

Status: **FIXED**

Commit: `7087ff30d7f092d387ecaeff499fb8eca59b5f70`

- Replaced the non-sargable full-table materialization with a newest-first `LIMIT 200` iterator that stops at the first real assistant content-part model.
- Unchanged stores return cached evidence without opening SQLite.
- Proof: `tests/cursor.test.ts` — `bounds fallback blob inspection to the newest 200 records` and the cache invalidation test above.
- Left alone: the pre-existing no-missing-model early return in `fillMissingCursorModels`.

## 3. Active transcripts are re-read and re-parsed in full

Status: **FIXED**

Commit: `7087ff30d7f092d387ecaeff499fb8eca59b5f70`

- Added resumable OMP, Codex, and Claude folds with device, inode, size, mtime, byte offset, partial-line remainder, and parser state.
- Reads only appended bytes for a stable growing file; resets on shrink, rotation/replacement, identity change, or same-size rewrite.
- Holds a trailing non-newline record until a later append completes it.
- Retains only the latest readable user and assistant messages while preserving exact cumulative usage state.
- Proof: `tests/collectors.test.ts` — `incremental collection matches a full re-read across append, rotation, truncation, and replacement`; the same test proves partial-line buffering.
- Left alone: public string-in/parser-out APIs; only file collection uses resumable state.

## 4. Human-message filtering deletes ordinary English and falls back to status prose

Status: **FIXED**

Commit: `7087ff30d7f092d387ecaeff499fb8eca59b5f70`

- Shell filtering now requires an explicit prompt marker or path-shaped line, so prose beginning with command words survives.
- `extractLastHumanMessage` may fall back to a readable task, never collector `statusReason`; absence returns `null`.
- Proof: `tests/human-message.test.ts` — `keeps ordinary instructions that begin with command words` and `returns null instead of presenting collector status as a human message`; `tests/collectors.test.ts` — `empty Codex transcripts report no readable human message`.
- Left alone: the client already renders the honest null state.

## 5. Cursor model can be invented from system-prompt prose

Status: **FIXED**

Commit: `7087ff30d7f092d387ecaeff499fb8eca59b5f70`

- Removed system-message prose inference.
- Models now come only from persisted `lastUsedModel`, real assistant content-part `modelName`, composer data, or AI tracking; otherwise they remain unknown.
- Proof: `tests/cursor.test.ts` — `does not invent a model id from English prose in a system prompt`; existing tests retain authoritative metadata and assistant content-part coverage.
- Left alone: model-policy and client provenance code because inferred prose no longer enters the model field.

## 6. No process liveness

Status: **BLOCKED**

Commit: none

- The owned collectors receive no recorded PID, process-table result, open-file result, cmux surface identity trace, or transcript-open evidence.
- The real `ps`/`lsof` evidence is produced in unowned `src/server/identity.ts`.
- The additive wire field requires at least unowned `src/server/types.ts`, `src/shared/types.ts`, `src/server/state.ts`, and `src/server/snapshot.ts`.
- Without those inputs, this lane cannot distinguish a live process, a clean exit, and a dead process across providers without guessing.
- Test: none, because no liveness behavior was implemented. The routed integration test must inject PID/process/open-file evidence through identity/state and assert the additive snapshot field.
- Left alone: all unowned identity, state, snapshot, shared-type, and client files.

## BE-F validation

- `bunx tsc --noEmit` — pass.
- `bun test` — **472 pass, 0 fail, 0 skipped**, 2088 expectations across 29 files.
- `git diff --check` — pass.
- No `.skip`, `.only`, filtered tests, secret findings, push, merge, deploy, or service restart.
- Scope: the six owned source/test files plus this required report; all prior content below is preserved.

---

# WAVE 2 / FE-B — client cost, dead weight, and the quarantine dead end

Date: 2026-07-28
Branch: `ant-hill/fe-quality-20260728`
Worktree: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/fe-quality-20260728`
Base: `53de671` (wave-1 merge)
Files touched: `src/web/app.js`, `src/web/styles.css`, `tests/web-client.test.ts` — nothing else.

## Verification

| Gate | Result |
|---|---|
| `bunx tsc --noEmit` | clean |
| `bun test` | **420 pass / 0 fail**, 1936 expect() calls, 26 files — no skips reported, no `.only`, no filtered runs |
| Baseline before this lane | 397 pass / 0 fail (so 23 tests added) |
| Pushed / merged / deployed | **no** — commits are local to this branch; `ai.imaginethat.anthill` was not touched |

`bunx` could not create temp files until the lockfile-pinned dev dependencies
were installed (`bun install --frozen-lockfile`). `package.json` and `bun.lock`
are unchanged.

### The tests are not hollow

Ten mutations were applied one at a time to the finished code and the suite
re-run. **10/10 were caught**, including each original bug: an always-rebuilding
reconciler (3 failures), `setAttribute("title")` back on the `<rect>`, a banner
that drops the reason and the next step, an un-memoized `agentsById`, a row
signature that stops tracking its own selection, `completed` reading "Complete"
again, `filterChip` losing its `fkey` (2 failures), the hard-coded `4701` hint,
the identity block dropped from Evidence, and the `state` shadow restored inside
`modelPolicyView`. No mutation slipped through.

## Commits

| Commit | Scope |
|---|---|
| `cf60337` | delete dead render aliases + three small client lies (findings 5, 9, 10, 11, 12) |
| `e400593` | explain quarantine instead of just refusing (finding 1) |
| `107060a` | keyed reconciliation of the agent list (finding 2) |
| `5560d56` | data-fkey on every repainted control (finding 3) |
| `939c67b` | one investigation vocabulary instead of five (finding 4) |
| `cd94cc7` | derive the fleet index and each widget once per paint (finding 7) |
| `46dab01` | delete the orphaned stylesheet + guard test (finding 8) |

## Per-finding status

### 1. Quarantine has no in-UI explanation or resolution path — **FIXED** (`e400593`)

I checked the premise against production before designing: `curl
127.0.0.1:4701/api/snapshot` returns **85/85 agents carrying `identityTrace`**
and **9 quarantined**, and the snapshot has **no `surfaces` key**. So the
skeptic was right on both counts — the per-agent trace really is in the payload
the client already holds (the fingerprint strips it, the payload does not), and
the pids/commands/open-files really are debug-endpoint-only.

- `identityTraceView(agent)` — pure, normalized view of the trace (tier steps
  with operator labels, matched tier, reason, binding bridge). Falls back to
  `agent.target` and never invents a step.
- `identityCause(view)` / `quarantineBrief(agent, control)` — the cause is read
  off **the tier that actually refused**, not off the resolution alone. Every
  quarantine resolves as `ambiguous`, but all 9 live ones refuse at the *cwd*
  tier ("2 active sources share this cwd"), not the session tier — so keying the
  copy off the resolution would have told every one of them to close a terminal
  that is not the problem. Three causes, three next steps.
- The control banner now names the cause and the operator's next move, and its
  "See routing evidence →" button also kicks off the evidence fetch. **It stays
  ID-free on purpose:** `controlUnavailableText`'s comment and the test at
  `tests/web-client.test.ts` already establish that raw cmux/session identifiers
  belong in Evidence, not in Operate chrome. I kept that rule rather than
  averaging it away, and there is a test asserting no UUID / no `ttys082` /
  no surface id reaches the banner even when the trace is full of them.
- Evidence grows an **Identity resolution** block: the ordered tier trail in the
  resolver's own words (this is where the identifiers belong), any
  persisted-binding bridge, and an opt-in "Show which terminals claim this
  session" that calls the existing read-only `GET /api/debug/identity?agent=<id>`
  and renders, e.g.
  `ttys082 — 2 sessions claim it: Codex 019f94a1… (pid 4242, codex resume …) · Claude c0eb6d3f… (pid 5150, claude --resume)`.
  A failure reads "Terminal evidence unavailable: <error>" with Retry; it is
  never smoothed into "no conflicts found".
- Every one of those strings is agent-controlled and is set through `textContent`
  via `el({ text })`. No `innerHTML` anywhere (the existing guard test still
  passes).
- Paint plumbing: `identityTrace` left `AGENT_SIG_TICKED` (the drawer paints it
  now, so a resolution that changes must repaint); only its clock-like
  `confirmedAt` stays out. `state.identity` joined `inspectorPaintSig`, without
  which the fetched evidence would never reach the screen.

Proven by five tests under `FE-B: harness-backed client behavior` — the
normalized view, the three causes (including the live cwd shape), the ID-free
banner, the rendered tier trail, the collision sentence, and the signature.

**Not done, and it is not mine:** `snapshot.ts:318` still filters
`affectedAgentIds` to `controlState === "quarantined" && activity !== "ended"`,
so `system:cmux-identity-conflicts` still links to zero agents. That is a
one-line change in `src/server/snapshot.ts`, which a backend lane owns this
wave. **Route it.**

### 2. Any single visible agent change tears down the whole list — **FIXED** (`107060a`)

Two levels of keyed reconciliation replace `root.textContent = ""`:

- `reconcileKeyed(parent, plan, cache)` — `plan` is `[{ key, sig, build }]`; a
  key whose signature held keeps its **existing node, attached**, and only
  changed/added/removed/reordered keys are touched. `build` is a closure, so
  nothing is constructed for an unchanged row. The cache outlives its parent, so
  even a rebuilt program section re-adopts its rows rather than reconstructing
  them.
- `programShellSig` covers what the program **head** paints (label, caret,
  rollup cells, selection row, rename form) and deliberately not the rows — so a
  token tick leaves the section, and every row inside it, alone.
- `agentRowSig` is the per-row signature: `agentRecordSig` (the same
  whole-record projection FE-A built for the drawer, so a field added to the
  snapshot is covered automatically) plus this row's slice of list state and its
  place in the swarm tree.
- `renderAgentRows` became `agentRowPlan`; `syncProgramList` is the extracted
  driver so the whole path is testable.

Proven by five tests: node identity through change/insert/remove/reorder; a
token tick moving exactly one row's signature; eighteen row-painted fields that
must move it (and two that must not); the shell signature staying still for a
tick and moving for a rollup/caret/label/selection/rename change; and an
end-to-end `syncProgramList` run over two programs asserting object identity of
the untouched sections and rows.

Two deliberate calls:
- **The live elapsed clock stays out of the row signature** (`tickClocks`
  rewrites it in place from `data-elapsed-base`; letting it in would rebuild
  every row every 5s and undo the whole fix). The >10-minute staleness fact,
  which does not tick, *is* in.
- **`renderProgram` keeps its exact signature and head-building code** because
  two existing source-regex tests pin them. Only its body-filling line changed.

### 3. Nine interactive controls omit data-fkey — **FIXED** (`5560d56`)

`filterChip` gained `opts.fkey`, and all nine sites carry one: the four Lookback
presets, All, Custom, the Scan window, the four Usage range chips + Usage
Custom, rename Save/Cancel/Reset, the dock confirm Cancel, the broadcast confirm
Cancel, triage Queue/Launch, usage Retry, usage session links. Keys name the
**control**, not the label, so "Custom" → "Custom 12h" cannot strand focus on
the very chip being clicked.

`renderFilterBar`, `renderTriage` and `renderUsagePanel` gained the `ui = state`
default parameter this file already uses (`programOpen(program, ui = state)`,
`summaryWidgetData(…, queueItems = state.queueItems)`), so the rebuilt controls
are asserted directly rather than grepped.

**Deliberately not a source-regex test.** The audit suggested "assert every
`el("button", …)` in app.js carries an fkey"; the brief forbids new source-regex
tests, and it would be hollow anyway. Instead: three tests over the rendered
DOM — `filterChip` carries the key it is given; every button `renderFilterBar`
produces has a **unique, non-empty, selection-stable** key in both Idle and
Usage modes; the rename form and the usage panel likewise.

**Honest gap:** three of the nine — the usage session link, the dock confirm
Cancel and the broadcast confirm Cancel — are gated behind `state.snap`,
`state.confirming` and `state.broadcastConfirming`, which this suite cannot set
(the client does not expose `state`, and I chose to follow the file's `ui =
state` convention rather than export mutable app state). They carry an fkey and
are covered **by inspection, not by test**. I left a comment saying so in the
test rather than writing a vacuous loop that asserts nothing.

### 4. Five copies of the queue-state → label mapping — **FIXED** (`939c67b`)

`INVESTIGATION_STATE_VIEW` is the single table (work key, label, tone, button
text, queue note, drawer status). All five sites read from it;
`INVESTIGATION_STATE_LABELS` is gone; `WORK_STATE_VIEW` stays the downstream row
vocabulary and is mapped into once. `completed` now reads **Verifying**
everywhere — that was the dominant existing answer (`issueWorkState`,
`findingFromQueueItem` and the old label table all already said it); the plan
chip's "Complete" and the button's "complete · verifying" were the outliers.

A sixth server state degrades to **the server's own word on every surface**
rather than a confident wrong label on one and a raw enum on the next. Proven by
a test that walks all four states across the chip, the button and the pulse row,
asserts the four labels are distinct, and drives an invented `cancelled`.

### 5. Five dead render functions kept alive by source-regex tests — **FIXED** (`cf60337`)

Proved dead first: `rg` over `src/` returned definitions only, zero call sites,
for `renderSwarmSection`, `renderPrimaryActions`, `renderPresentationLabels`,
`renderTechnical` and `renderTarget`. All five deleted (~60 lines), along with
the "it MUST stay defined immediately after renderOperate" comment that was
false.

The four assertions that kept them alive were **replaced, not loosened**:
- "transcript tail in Chat/Evidence, not Operate" → renders the three panels and
  reads them.
- "drawer omits empty fields" → renders with cost/tests/gates present and
  asserts no `$` figure and no gate/test text reaches any panel.
- "Names stay collapsed under a disclosure" → renders `renderAgentDrawer` and
  asserts `.names-disclosure` is absent while Evidence is collapsed and present
  inside `renderEvidence`.
- "Task only when meaningfully different" → renders both cases.

Plus a new test asserting the drawer builds exactly the Operate + Chat shelves
and the Evidence rail, with no `.swarm-section` / `.swarm-link` anywhere. Per the
brief I did **not** add a replacement source assertion that the deleted names
stay deleted — the regex and the function were removed together.

### 6. Client duplicates model display names — **BLOCKED** (no code change)

The finding's framing is wrong and the skeptic was right. I verified both ends:

- `config/models.json` has exactly four keys — `claudeContextWindows`,
  `modelFamilyAliases`, `cursorNativeFamilies`, `cursorRootModel`. **None is a
  display label.** Wiring `modelShort()` to today's config would supply nothing.
- The live snapshot's top-level keys are `controlHealth, generatedAt, issues,
  lookbackHours, programs, pulse, recentlyResolved, scanWindowHours,
  schemaVersion, totals, triageSummaries`. **There is no model config on the
  wire.**

So the real fix is additive and starts on the server: add a display-name map to
`config/models.json`, expose it on `HubSnapshot` (or a small
`GET /api/model-config`), and only then have `modelShort()` consult it with the
current table as the fallback. `config/**` and `src/server/**` are both outside
my ownership, and the brief says to report rather than guess. **The duplication
is real ("two places to edit"), but it cannot be closed from the client alone.
Route the server half.**

### 7. Finding derivations re-run ~4× per render — **FIXED, with one part deliberately not done** (`cd94cc7`)

- `agentsById(snap)` is memoized in a `WeakMap` keyed on the snapshot object.
  This is the quadratic: `affectedImpact` rebuilt a Map of the whole fleet **once
  per issue**. Adopting a new snapshot invalidates it for free, so a stale board
  can never be served out of the cache.
- `pulseStripModel` takes the context display, so `renderHealthRail` computes
  each widget's data **once** and the paint signature, the cell and the calm line
  all read that one result. Each of those calls used to re-derive the whole
  findings list underneath, so this removes a full `pulseFindings` pass per paint.

**Deliberately NOT memoized:** `issuesOf` and `pulseFindings`. Both read
`state.labels`, `state.triage` and `state.triagePending`, which move without the
snapshot changing — caching them on snapshot identity would freeze the board.
Said in the commit message too.

**Deliberately NOT done: the 120 ms search debounce.** The skeptic measured the
finding's ~30 ms claim as ~7× high (4.43 ms at 80 findings) and showed the
dominant per-keystroke cost is `renderPrograms` rebuilding all 254 rows — which
finding 2 now fixes. Adding a timer would be speculative, would put a visible
120 ms lag on filtering, and lives inside `boot()` where nothing can test it. I
would rather report the omission than ship untested UX drag. **If you want it
anyway, say so and it is four lines.**

### 8. ~40 dead CSS classes — **FIXED** (`46dab01`)

84 selector lines removed: the signal-surface board, the danger zone, the old
instruct form, the target/routing chips, the `tests-*` and `policy-*`
vocabularies, and the `swarm-section` / `swarm-link` rules this lane's own
dead-code deletion orphaned. Grouped selectors were edited to drop only the dead
members, never the whole rule.

The guard test extracts every class in `styles.css`, filters the **complete**
list of prefixes the client composes at runtime, and asserts the remainder all
appear in `app.js` or `index.html`. It is a **dead-asset lint, not a behavior
test** — nothing else can express "this rule has no emitter" — and adding a new
dynamic prefix to the allowlist has to be deliberate.

Three existing touch-sweep assertions quoted selector lists containing
`.inspector-tab`, `.swarm-link`, `.signal-trigger` and `.instruct-form input`.
They were updated to the live control set, **not loosened**: the 44 px
constraint still holds for every control that exists.

### 9. Local `const state` shadows the module singleton — **FIXED** (`cf60337`)

Renamed to `policyState`; the returned property name is unchanged. A test pins
the full returned shape for `violation`, `unverified` and `compliant` — including
that the summary is keyed off the **normalized** state, which is the thing a
careless rename would break.

### 10. Usage chart bars set a `title` attribute on `<rect>` — **FIXED** (`cf60337`)

SVG has no `title` content attribute. Added `svgTitle(text)` and a
`usageBarTitle(bucket, tokens)` helper; each bar now carries a real `<title>`
child. The test asserts both that the `<title>` child exists **and** that
`attributes.title` is undefined, so it cannot pass on the old code path.
`role="img"` was already set (the audit's suggestion there was redundant).

### 11. Error hint hardcodes port 4701 and "v3 server" — **FIXED** (`cf60337`)

`serverUnreachableHint(host)` is pure and exported; `renderEmpty` passes
`location.host`. A hostless context degrades to "at this address" rather than
claiming an address it does not know.

### 12. Dead code kept alive by a source-grep test that no longer exists — **FIXED** (`cf60337`)

`renderPrimaryActions` and its misleading comment deleted with the rest of
finding 5. Its justification was checkable and false: the tests that pin
`controlUnavailableText` are satisfied by `renderCommandDock`, and
`renderPrimaryActions` never contained that string.

The audit also asked me to audit the `TheAntHill` export list for names no test
consumes. **I did not do that**, and it would now be misleading: this lane added
~25 exports precisely so the replaced source-regex tests could assert on
behavior. Every export I added is consumed by a test I wrote.

## What I deliberately left alone

- **The remaining source-regex tests.** A later lane owns them. I touched exactly
  six assertions, and only because my changes made them fail; each was rewritten
  against rendered DOM or the real data model, never relaxed.
- **The search debounce** (finding 7) — reasoning above.
- **FE-A's live-input exclusions.** `drafts`, `renameDraft` and `broadcastDraft`
  are still out of every paint signature, including the two new ones I added, and
  the tests pinning that exclusion are untouched.
- **`renderBroadcastBar` and `renderDockTool` keep reading module state.**
  Threading `ui` through them would have meant unpicking `selectedRecipients`
  and the confirm-key plumbing for two test assertions. Not worth the blast
  radius; the coverage gap is named under finding 3.
- **Everything outside my three files.** No `src/server/**`, no `scripts/**`, no
  `config/**`, no `package.json`, no docs.
- **Nothing pushed, merged, deployed, or restarted.**

## Out-of-scope observations (not fixed, not mine)

1. **`snapshot.ts:318` `affectedAgentIds` filter** — finding 1's cheap half.
   Server-owned this wave. Route it to a backend lane.
2. **Model display names need a server + config change first** — finding 6.
3. **`renderHealthRail`, `renderTabs` and `renderFilterBar` still have no paint
   guard** (FE-A observation #1). Now that `reconcileKeyed` exists they are cheap
   to convert, but they were not in my findings and none of them holds a live
   input, so I left them.
4. **`tickClocks()` still extrapolates elapsed clocks while `conn === "stale"`**
   (FE-A observation #2). Unchanged; still needs a design decision.
5. **`agentRecordSig` now stringifies the agent record once per visible row per
   paint**, not just once for the open drawer. At 200 rows that is a few hundred
   KB of JSON per repaint — far cheaper than the ~5,400-element rebuild it
   replaced, and it only runs when the top-level guard already decided something
   moved, but it is the obvious next thing to profile if list paint cost is ever
   measured again.
6. **`swarmNote(agent, opts)` is called from both the row renderer and the row
   signature**, so a parent's display name changing repaints its children's rows.
   Correct, but it means a rename cascades further than it looks.

---

*Everything below this line is the previous program's report, carried forward unchanged.*

---

---

# WAVE 2 / BE-D Lane Report

Branch: `ant-hill/be-control-20260728`

Outcome: 6 FIXED, 3 BLOCKED by explicit file ownership.

## Verification

- `bunx tsc --noEmit`: PASS
- `bun test`: PASS — 417 tests, 0 failures, 1,762 assertions across 27 files
- Skips/filters: none (`rg '\.(skip|only)\(' tests` returned no matches)
- `git diff --check`: PASS before commits
- No service restart, push, merge, deployment, or live cmux control was performed.

## 1. Multiline instructions are typed verbatim

Status: **FIXED**

Commit: `3594baed32952a49e0bc885b9c83ff6da679078b`

`executeControl` now rejects any remaining CR/LF after trimming, before `surface.send_text`. Broadcast parsing rejects CR/LF with the precise `INVALID_INSTRUCTION` code before fanout.

Proof:

- `tests/control-safety.test.ts` — “rejects CR/LF instruction text before typing it into a terminal”
- `tests/broadcast.test.ts` — “rejects multiline instructions before dispatch”

Deliberately left alone: `src/server/http.ts` and `src/web/**` are owned by other lanes. The single-control HTTP path is still safe because it reaches the new `executeControl` guard; the broadcast path rejects during its owned parser.

## 2. A timed-out Enter is retried

Status: **BLOCKED**

Commit: N/A

The safe source change requires changing the Wave 1 regression at `tests/control-http.test.ts:293`, which explicitly asserts that a timed-out first Enter is retried and succeeds with three commands. `tests/control-http.test.ts` is outside this lane's ownership. Changing `src/server/control.ts` alone would intentionally break the mandatory full suite, so the unsafe retry remains unchanged for the orchestrator to route with ownership of that test.

Required follow-up: on first Enter timeout, return `TEXT_STAGED_NOT_SUBMITTED` with an unknown-delivery message and do not issue a second Enter. Keep retry only for a known, non-timeout non-zero exit.

Test needed in the owning lane: replace the contradictory test with one asserting status 504, the “may or may not have landed” message, and exactly two runner calls (`send_text`, one `send_key`).

## 3. Production triage persistence and runner are untested; corrupt data bricks boot

Status: **FIXED**

Commit: `cc90090d03ae9bda16e5d1c064d6fc97f1b84a1f`

`JsonTriageQueueStore.open` now logs a loud error, clears any partially loaded items, and returns an empty store for unreadable/corrupt data instead of throwing during boot. A valid persisted `running` item still recovers to `blocked` and is re-persisted. `NativeLunaInvestigationRunner` gained only an optional spawn seam so its guards can be tested without launching a real CLI.

Proof in `tests/triage.test.ts`:

- Missing file opens empty and add/reopen round-trips.
- Persisted `running` recovers to `blocked` and the disk record is updated.
- Invalid JSON opens empty and logs.
- An invalid record after a valid record opens fully empty and logs, proving no half-load.
- Missing investigation prompt rejects before spawn.
- A second native launch rejects while the first is active.

Deliberately left alone: the corrupt source file is not overwritten during fail-open recovery, preserving evidence for operator repair.

## 4. Control error and HTTP boundary branches lack tests

Status: **FIXED**

Commit: `3594baed32952a49e0bc885b9c83ff6da679078b`

Proof in `tests/control-safety.test.ts`:

- Wrong-agent execution returns `AGENT_IDENTITY_MISMATCH` without running cmux.
- Whitespace-only direct execution returns `INSTRUCTION_REQUIRED` without sending a bare Enter.
- GET returns 405 `METHOD_NOT_ALLOWED`.
- `text/plain` POST returns 415 `CONTENT_TYPE_REJECTED`.
- An 8,193-byte instruction returns the 8 KiB instruction-cap error before cmux.

The `CMUX_TIMEOUT` branch was already covered by Wave 1 at `tests/control-http.test.ts:130`. `INVALID_ACTION` has no runtime test by design: `ControlRequest.action` is a closed union and the branch is the TypeScript `never` exhaustiveness guard; reaching it requires an intentionally false cast, which would not test a supported contract.

## 5. `collectCmux` outcomes and `cmuxReachable: false` lack server coverage

Status: **FIXED**

Commit: `51074bbf70bc15a0f0da34a62dd3445261710fd4`

`tests/cmux.test.ts` now pins all four terminal-discovery outcomes: timeout, non-zero exit with stderr, invalid/schema-drift output, and valid parsed output. The valid case also proves the exact RPC argv and 10-second runner deadline.

The state-health half was already fixed on this branch by Wave 1 commit `4f503767ae2c24911637265b3f46714d9ddc7b45`: `tests/state-health.test.ts:94` drives failed cmux and notification collectors, asserts `cmuxReachable: false`, retains last confirmed surfaces, and exposes both errors.

No production source change was needed.

## 6. Mid-fanout runner failure and recipient cap are untested

Status: **FIXED**

Commit: `3594baed32952a49e0bc885b9c83ff6da679078b`

`tests/broadcast.test.ts` now scripts a failure on recipient 2 of 3 after text staging. It proves status 207, `TEXT_STAGED_NOT_SUBMITTED`, continued delivery to recipient 3, one `send_text` per recipient, and `afterControl` receiving only successful IDs. Separate boundary coverage proves 50 recipients are accepted and 51 are rejected before dispatch.

Deliberately left alone: the client has no staged-text-specific retry UX, and `src/web/**` is outside this lane.

## 7. Triage rejects valid IPv6 loopback

Status: **FIXED**

Commit: `cc90090d03ae9bda16e5d1c064d6fc97f1b84a1f`

The triage hostname allowlist now uses WHATWG URL's bracketed `"[::1]"` form.

Proof: `tests/triage.test.ts` — “accepts an exact same-origin IPv6 loopback triage request”.

Deliberately left alone: no shared-helper extraction was made because the other handlers are outside this lane and already use the correct spelling.

## 8. Investigation binary/model are hardcoded and undeclared

Status: **BLOCKED**

Commit: N/A

The requested fix belongs in prohibited `config/**` and its loader, then must be passed through prohibited startup wiring. This lane cannot honestly claim the model or executable is configurable without editing those owned surfaces. The existing hardcoded `codex` and `gpt-5.6-luna` values remain.

No regression test was added because there is no permitted implementation contract to test. Finding 3's Native runner tests cover only the existing prompt and single-flight guards.

## 9. Investigate lacks a pre-click capability and documented prerequisite

Status: **BLOCKED**

Commit: N/A

A visible pre-click unavailable reason requires capability data in prohibited server/snapshot wiring and a disabled state in prohibited `src/web/**`; documenting the prerequisite requires prohibited `QUICKSTART.md`. A `triage.ts` launch-time check alone would still fail only after clicking and would not satisfy this finding, so no partial workaround was shipped.

No test can prove the requested visible pre-click behavior within this lane's permitted files.

## Out-of-scope follow-up routing

1. Route finding 2 with ownership of `tests/control-http.test.ts` alongside `src/server/control.ts`.
2. Route findings 8/9 together with ownership of `config/models.json`, its loader/startup wiring, capability snapshot/API fields, `src/web/**`, and prerequisite documentation.

---

*Previous lane reports follow unchanged.*

---

# WAVE 2 / BE-C Lane Report

Branch: `ant-hill/be-boundary-20260728`

Implementation commit: `c1088c97d161d148df1b3049ea41bba7e722ab2a`

## Verification

- `bunx tsc --noEmit`: PASS
- `bun test`: PASS — 415 tests, 0 failures
- Focused boundary suite: PASS — 53 tests, 0 failures
- Skip/focus scan: `rg -n "\\.(skip|only)\\s*\\(" tests` returned no matches
- `git diff --check`: PASS
- No launchd service restart, push, merge, deployment, or live control action was performed.

## Finding 1 — Rich routes bypass the loopback Host gate

Status: **FIXED**

Commit: `c1088c97d161d148df1b3049ea41bba7e722ab2a`

Change: `createMountainFetch` now rejects non-loopback hostnames before any API route or static-file route runs. The accepted hostnames remain `127.0.0.1`, `localhost`, and `[::1]`. The existing per-handler checks in files owned by other lanes were deliberately left in place.

Proof: `tests/static-serving.test.ts` asserts 403 for a foreign host on `/`, `/api/snapshot`, `/api/events`, and `/api/debug/identity`.

Left alone: redundant checks in `burnbar.ts`, `settings.ts`, and `program-aliases.ts`, because those files are outside this lane.

## Finding 2 — Control requests trust an unbounded-age snapshot

Status: **FIXED**

Commit: `c1088c97d161d148df1b3049ea41bba7e722ab2a`

Change: cmux-targeting actions (`focus`, `instruct`, and `interrupt`) now reject routing evidence older than 30 seconds, or evidence with an invalid timestamp, with HTTP 409 and structured `STALE_SNAPSHOT` details (`ageMs` and `maxAgeMs`). The guard runs before agent lookup or `executeControl`, so no cmux command is attempted. `archive` remains available because it writes local archive state and does not target a terminal.

Proof: `tests/control-http.test.ts` proves an instruct request at 30,001 ms is rejected without invoking the runner, and separately proves stale evidence does not block archive.

Left alone: immediate target re-resolution would require `control.ts` and live surface collection, which this lane does not own. `/api/broadcast` needs the same freshness policy but is implemented in `broadcast.ts`, owned by the parallel CONTROL lane.

## Finding 3 — The control plane has no authentication

Status: **BLOCKED**

Commit: `c1088c97d161d148df1b3049ea41bba7e722ab2a` contains only the agreed defense-in-depth Host and freshness gates; it does not add authentication.

Blocker: the current exact-Origin check is browser CSRF protection, not caller authentication. A bearer token readable by the same macOS user does not provide a strong boundary against the cited same-UID agent/process threat, and the operator has not selected what compatibility or security tradeoff is acceptable.

Test status: no authentication test was added because no authentication contract was selected or implemented. Existing `tests/control-http.test.ts` coverage continues to pin the current loopback and exact-Origin behavior.

### Authentication options

1. **Local capability token**
   - Cost: generate/load a 32-byte credential, protect it at rest, add one shared verifier to every mutating route, add browser bootstrap and authorization headers, migrate local curl/scripts, and test expiry/rotation/error behavior.
   - Breakage: existing local callers without the token receive 401. Serving the token from an unauthenticated local GET defeats the boundary. A `0600` token file is still readable by the same-UID processes named in the finding, so this mainly blocks accidental or uncredentialed callers rather than a compromised same-UID agent.
2. **Human pairing or per-session approval**
   - Cost: add an explicit browser pairing/approval flow and short-lived scoped capabilities for control operations.
   - Breakage: unattended automation and page reloads need a renewal policy. It adds operator friction but makes ambient local access less useful.
3. **OS-enforced separation**
   - Cost: run the control broker as a separate user or privileged helper and use a Unix socket/native bridge with peer credentials and narrowly scoped cmux operations.
   - Breakage: substantially more installation, launchd, ownership, and browser-bridge complexity. This is the strongest option against same-UID dashboard processes only if the agent sessions are moved to a different OS identity.
4. **Accept the same-UID trust boundary**
   - Cost: document that loopback plus exact Origin protects against browser attacks, while any process running as the operator is trusted.
   - Breakage: none, but it explicitly accepts the audit's local-process risk.

## Finding 4 — SSE re-broadcasts the whole snapshot

Status: **BLOCKED**

Commit: `c1088c97d161d148df1b3049ea41bba7e722ab2a`

Compatible change: the retained fingerprint is now a compact SHA-256 digest instead of the full fingerprint JSON, and the current serialized snapshot event is reused for new connections. Accepted state changes still serialize once and fan out the same string to all clients.

Proof: `tests/app-lifecycle.test.ts` proves accepted updates still deliver the current full `event: snapshot` payload, pinning compatibility with the existing client.

Reason blocked: excluding ended agents or sending deltas would make the current `src/web/app.js` replace its complete state with an incomplete snapshot. The client is owned by another lane.

### Proposed compatible migration contract

- Keep `/api/events` unchanged for current clients.
- Add `/api/events?v=2` with `event: live-snapshot`. Its payload keeps the `HubSnapshot` top-level metadata but includes only non-ended agents and an `endedAgentIds` transition list.
- Add `GET /api/history?before=<cursor>&limit=<n>` returning immutable ended-agent pages plus stable program metadata.
- The v2 client keeps active agents in a map, removes IDs listed in `endedAgentIds`, and fetches history only when History opens.
- After the client lane ships and verifies v2, make it the default and retain v1 only for a bounded compatibility window.

## Finding 5 — Static serving and security headers are untested

Status: **FIXED**

Commit: `c1088c97d161d148df1b3049ea41bba7e722ab2a`

Change: added `tests/static-serving.test.ts`; production static behavior did not need correction.

Proof: the tests pin the exact CSP, `referrer-policy`, `x-content-type-options`, and `x-frame-options`; verify index, JavaScript, CSS, HTML, and fallback content types; verify HEAD has no body; and cover encoded traversal, normalized traversal, malformed escaping, and directory rejection.

Left alone: no static-serving implementation was refactored because the audited live behavior was already correct.

## Finding 6 — SSE fanout has no cap or backpressure

Status: **FIXED**

Commit: `c1088c97d161d148df1b3049ea41bba7e722ab2a`

Change: `/api/events` now admits at most 16 clients. Streams use byte-based accounting with a 2 MiB high-water mark; a client whose queue has exhausted that budget is removed, its heartbeat is cleared, and its stream is closed before another event is enqueued.

Proof: `tests/app-lifecycle.test.ts` proves client 17 receives 503 and that a deliberately stalled over-budget reader receives its queued initial snapshot and is then closed rather than receiving another snapshot.

## Finding 7 — cmux password appears in argv

Status: **FIXED**

Commit: `c1088c97d161d148df1b3049ea41bba7e722ab2a`

Change: `cmuxCommand` no longer adds `--password <secret>` to argv. The installed cmux CLI documents the precedence `--password`, then `CMUX_SOCKET_PASSWORD`, then Settings; Ant Hill already loads `CMUX_SOCKET_PASSWORD` into `process.env`, and `Bun.spawn` inherits that environment.

Proof: `tests/cmux-auth.test.ts` configures a password and asserts the resulting argv contains only the executable and requested cmux arguments. `cmux --help` was checked locally for the environment-variable contract. No live authenticated RPC was sent because restarting or exercising the production control plane was prohibited.

Left alone: `scripts/anthill-start.sh` and `scripts/setup-cmux-password.ts` still contain explicit `--password` uses and are outside this lane's ownership. A scripts owner must address those paths before claiming the repository has no password-bearing cmux argv anywhere.

## Finding 8 — Identity debug endpoint exposes process command lines

Status: **FIXED**

Commit: `c1088c97d161d148df1b3049ea41bba7e722ab2a`

Change: related surface traces returned by `/api/debug/identity` preserve PID and recognition evidence but replace every process command with `[redacted]`.

Proof: `tests/debug-identity.test.ts` supplies a command containing a fake API-key argument, asserts the response contains `[redacted]`, and asserts the fake secret does not occur anywhere in the serialized response.

Left alone: raw process evidence remains in the in-memory identity trace because `identity.ts` is owned by the parallel IDENTITY lane. The HTTP disclosure is closed; preventing raw argv from entering memory requires that lane.

---

*Everything below this line is the previous cumulative lane report, carried forward unchanged.*

---

---

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

---

# WAVE 1 / FE-A — dead controls and the lying Live badge

Date: 2026-07-28
Branch: `ant-hill/fe-controls-20260728`
Worktree: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/fe-controls-20260728`
Base: `8f4cf82`
Commit: **`1f60418`** — `fix(web): make the client stop lying about freshness and revive dead controls`

## Verification

| Gate | Result |
|---|---|
| `bunx tsc --noEmit` | clean |
| `bun test` | **381 pass / 0 fail**, 1667 expect() calls, 24 files — no skips, no `.only`, no filters |
| Baseline before this lane | 367 pass / 0 fail (so 14 tests added, 0 existing tests changed or loosened) |
| Files touched | `src/web/app.js`, `tests/web-client.test.ts` only |

### The tests are not hollow

Every new assertion was checked by mutation: the fix was reverted one bug at a
time and the suite re-run. **12/12 mutations were caught**, including the exact
original bugs (heartbeat-driven verdict, `setAttribute("value")` on a textarea,
the agent-less inspector signature, the override-less programs signature, a
`fetchFailed` nobody reads, a `CLOSED` stream nobody re-arms). No mutation
slipped through.

## Per-finding status

### 1. Agent drawer paint signature contains zero agent state — **FIXED**

CRITICAL. Extracted `inspectorPaintSig(sel, view, ui)` (app.js) and gave the
agent branch what the drawer actually paints:

- `agentRecordSig(agent)` — a JSON projection of the whole agent record rather
  than a hand-listed field set, so a field added to the snapshot is covered
  automatically instead of silently escaping the signature a year from now.
  Fields the live clocks own (`elapsedMs`, `updatedAt`, `lastCheckedAt`,
  `identityTrace`) are dropped, because `tickClocks()` rewrites those nodes in
  place from `data-elapsed-base` / `data-ago` — letting them in would rebuild the
  drawer every 4s and destroy the guard. Their *presence* is still tracked, so a
  tile appearing for the first time does repaint.
- `lineagePaintSig(agent, snap)` — ancestors + direct children, which the spine
  renders.
- Every interaction flag: `pending` (scoped to this agent), `feedback`,
  `confirming` (instance-scoped, so head and dock copies stay distinct),
  `renaming`, `renamePending`, `renameError`, `labelsLoading`, `labelLoadError`.

Proven by `FE-A: paint signatures cover the state their surfaces render` →
`(1) … every interaction flag its controls set`, `(1) … every agent field the
drawer paints`, `(1) tick-driven clocks and live inputs deliberately do NOT move
the signature`, `(1) the drawer tracks the lineage it paints`.

**Deliberate deviation from the suggested fix:** `state.drafts` is *excluded*.
Putting a live input's value into a paint signature is exactly the finding-3 bug
in another costume — it would tear the instruct composer down mid-sentence on
every SSE snapshot. `sendControl` is the only external writer of `drafts`, and it
deletes the draft in the same breath as it clears `pending` and sets `feedback`,
both of which *are* in the signature — so the composer still clears on success.
There is a test pinning the exclusion.

**`startRename`'s focus grab was left alone.** The audit suggested a
`queueMicrotask` for it. It is not needed: `render()` is synchronous and the
signature now changes when `state.renaming` is set, so the node exists by the
time `querySelector` runs. Adding timing machinery would be speculative.

### 2. "Live" badge driven by heartbeats — **FIXED**

CRITICAL. Freshness now keys off `snapshot.generatedAt`, which the server already
sends (no backend change, none permitted this wave).

- `snapshotFreshness(generatedAt, now)` → `fresh` ≤ 15s, `lagging` ≤ 60s,
  `stale` > 60s, `unknown` when there is nothing to measure. Future-dated
  snapshots clamp to age 0 rather than reporting negative age.
- `connVerdictFor({ open, lastEventAt, generatedAt, now })` is the whole rule,
  pure and exported. Heartbeats are no longer an input to it.
- The heartbeat listener and `es.onopen` now call `applyFreshnessVerdict()`
  instead of forcing `setConn("live")`, so a heartbeat can lift *Reconnecting*
  but can never clear a stale verdict.
- `connLabelText(conn, generatedAt, now)` puts the real age in the badge as soon
  as the data stops being fresh: `Live · snapshot 40s ago`,
  `Stale feed · snapshot 4d ago`.

Proven by `FE-A: snapshot freshness drives the connection verdict` — in
particular `a heartbeat that just landed cannot make a frozen snapshot read as
Live`, which asserts `lastEventAt === now` (a heartbeat one millisecond old,
the exact production condition) with a 91-hour-old `generatedAt` yields `stale`.

No new CSS was needed — `conn-stale` and `CONN_LABELS.stale` already existed. The
`lagging` band deliberately does **not** get its own conn state, because a new
state would need a `styles.css` rule and that file belongs to another lane; it
surfaces through the age suffix in the badge instead.

### 3. Broadcast textarea never shows its content — **FIXED**

HIGH. Two independent causes, both fixed:

- `el()` now assigns `value` as a **property** (`node.value = v`) instead of
  falling through to `setAttribute`. `HTMLTextAreaElement` has no `value` content
  attribute, so the old path set an inert unknown attribute and the box rendered
  empty. On a freshly created `<input>` the property assignment is equivalent, so
  the instruct composer and the rename input are unaffected.
- `renderBroadcastBar` had no paint guard and wiped itself on every snapshot. It
  now has one, via `broadcastPaintSig(recipients, eligible, ui)`, covering
  recipient identity + eligibility, per-recipient results (distinguishing sent
  from failed from gone), and the confirming/pending/error flags. The draft is
  deliberately out, for the same reason as `state.drafts` above.

Proven by `(3) el() assigns value as a property so a textarea actually shows its
text` (asserts `node.value` is set **and** `node.attributes.value` is undefined,
so it cannot pass on the old code path) and `(3) an idle snapshot does not tear
down a live broadcast composer`.

### 4. Program list signature omits expand/collapse and rename state — **FIXED**

MEDIUM. Extracted `programsPaintSig(visible, ui)` and added `programOverrides`
(serialized), `renaming`, `renamePending`, `renameError`, plus the resolved
open/shut state and display name per program — the last two because
`programOpen()` also reads the *unfiltered* agent list, which the per-agent part
of the signature does not cover. `programOpen(program, ui = state)` gained an
optional state argument purely so the signature is a pure function of its inputs
and can be tested; every existing caller is unchanged.

`renameDraft` is excluded, same live-input reasoning, and there is a test pinning
that too. Proven by `(4) the program list signature moves for expand/collapse and
rename state`, which also asserts open and closed are distinguishable from *each
other*, not merely from the default.

### 5. No recovery path when the SSE stream closes for good — **FIXED**

MEDIUM. The 5s interval now calls `pollConnectionHealth()`, which:

- re-arms a `CLOSED` (or absent) stream with exponential backoff capped at 30s —
  `reconnectPlan(readyState, now, attempts, dueAt)`, pure and exported. A
  `CONNECTING` stream is left alone (a retry is already in flight) and an `OPEN`
  one resets the backoff so the next outage starts clean.
- falls back to polling `/api/snapshot` once the feed has been unhealthy for
  longer than one stale window, throttled to every 10s —
  `fallbackPollDue(conn, now, changedAt, dueAt)`, also pure and exported.
- re-renders the badge each tick so the snapshot-age suffix keeps counting up
  while nothing else is painting.

Proven by `FE-A: the dead SSE stream recovers instead of painting hours-old
state`. Note the audit rated this PLAUSIBLE, not CONFIRMED — the *absence* of
recovery was confirmed but the trigger (a non-2xx on `/api/events`) was not
reproduced. This fix is therefore defensive; the pure rules are fully tested, but
I have **not** observed a real permanently-CLOSED stream to confirm the end-to-end
self-heal.

### 6. `state.fetchFailed` written three times and never read — **FIXED (read, not deleted)**

LOW. Now read in three places: `systemStatus(snap, conn, fetchFailed =
state.fetchFailed)` degrades the verdict to Degraded (which is what puts the
already-wired Refresh button on screen), the health widget sublabel names it
("Last snapshot refresh failed — showing the previous good snapshot."), and
`renderScopeNote` appends "· last refresh failed". The default-parameter form
matches the existing `queueItems = state.queueItems` idiom in the same function
and keeps all existing two-argument callers working.

Proven by `FE-A: a failed snapshot refresh is visible instead of swallowed`.

### 7. SSE path bypasses `applySnapshot` — **FIXED**

LOW. `handleEventPayload` now resolves the envelope via a small exported
`eventSnapshot(msg)` and calls `applySnapshot(snap)` inside a try/catch that
falls back to `scheduleRefetch()`; the hand-copied four-line fork is gone and the
comment above `applySnapshot` names the stream as a caller.

**Partial test coverage — stated plainly.** `eventSnapshot` is tested for both
envelope shapes and for unknown event kinds (`FE-A: every snapshot transport uses
the one apply path`). The other half of the claim — *that the stream reaches
`applySnapshot`* — is **not** covered by a behavioral test. Proving it requires
driving `render()`, which touches ~20 elements by id plus `classList`,
`scrollTop`, `querySelectorAll` and `CSS.escape`; this suite has no DOM harness,
and the brief bans adding source-regex tests. Building that harness is a
different piece of work from this finding and would have been scope creep. The
change itself is a de-duplication with no behavior delta today (the skeptic
confirmed the fork already performed an equivalent shape check), so the untested
part is low risk — but it is untested, and I am not calling it otherwise.

## What I deliberately left alone

- **`startRename`'s `queueMicrotask`** — unnecessary once the signature repaints
  (see finding 1).
- **The existing source-regex tests** (`tests/web-client.test.ts:1774-1783` and
  friends). None of them broke, so none were touched; a later lane owns them.
- **Everything outside my two files.** No `src/server/**`, no `styles.css`, no
  `scripts/**`, no `config/**`, no `package.json`, no docs.
- **The `lagging` freshness band has no conn state of its own** — that would need
  a `styles.css` rule, which is another lane's file.

## Out-of-scope observations (not fixed, not mine)

1. **`renderHealthRail` / `renderTabs` / `renderFilterBar` have no paint guard**
   and rebuild on every snapshot, same class of cost as the broadcast bar had.
   Not a correctness bug — no live input lives in them today — so I left them.
2. **`tickClocks()` keeps extrapolating elapsed clocks from `data-elapsed-base`
   regardless of the connection verdict.** With this lane's badge fix the
   operator is at least *told* the data is stale, but the clocks beside it still
   tick as if live. Freezing or dimming them when `conn === "stale"` would close
   the loop; it needs a CSS or design decision, so it is not mine.
3. **`agentRecordSig` stringifies the selected agent once per render.** For an
   agent with a large `transcriptTail` that is a few KB of JSON per paint —
   negligible against rebuilding the drawer, and it only runs for the one open
   drawer, but worth knowing if drawer paint cost is ever profiled.
4. **A malformed SSE event no longer promotes `conn` to "live".** Previously
   `handleEventPayload` set live *before* parsing. This is arguably more honest
   (a garbled event is not evidence of health) and the 5s poll corrects it within
   one tick — but it is a small intentional behavior change, flagged here rather
   than buried.

---

*Everything below this line is the previous program's report, carried forward unchanged.*

---

# BE-A runtime resilience lane report

Branch: `ant-hill/be-runtime-20260728`
Implementation commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

## Verification

- `bunx tsc --noEmit`: PASS
- `bun test`: PASS — 383 tests, 0 failures, 1,606 assertions across 26 files
- Skips/filters: none reported by the full run; no `.only` was added
- Runtime/service actions: none; `ai.imaginethat.anthill` was not restarted
- Publication actions: none; no push, merge, PR, or deploy

The first `bunx` attempt could not create its temp files in the sandbox. I installed the
lockfile-pinned dev dependencies from Bun's offline cache without changing
`package.json` or `bun.lock`, then reran the required command successfully.

## Findings

### 1. BunCommandRunner timeout never settles

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

`BunCommandRunner` now starts each command in a detached process group, races the
entire exit/stdout/stderr operation against a hard deadline, sends SIGTERM at the
deadline, schedules SIGKILL after 250 ms, and immediately resolves a
`{ exitCode: -1, timedOut: true }` result without awaiting streams beyond the
deadline.

Proof: `tests/command.test.ts` runs both hostile shapes required by the finding:
`trap "" TERM; sleep 60` and `(sleep 60) & exit 0`. Both settle at a 50 ms deadline
in about 51 ms. Before the implementation, the targeted test run was still pending
when an external 2-second harness killed it.

Deliberately left alone: no caller contracts changed; timeout results still use the
existing `CommandResult` shape.

### 2. HubState refresh promise permanently latches

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

`HubState.refresh()` records the pass start time. A future tick that sees the same
pass pending beyond 12 seconds logs a refresh-watchdog error, drops that reference,
and starts a clean pass. The stale pass's `finally` is identity-guarded so it cannot
clear a newer in-flight reference. Scheduled refresh rejections are now logged in
`index.ts`.

Proof: `tests/state-health.test.ts`, “a refresh pending beyond three tick intervals
is dropped so the next tick can complete,” uses a never-settling first collector and
proves the second pass completes and the watchdog logs. Before the implementation,
the targeted test remained pending until the 2-second harness killed it.

Deliberately left alone: the abandoned collector promise cannot be cancelled through
the current collector interfaces; the watchdog contains it and prevents a permanent
global latch.

### 3. Failed cmux RPC wipes surfaces and notifications

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

A failed terminal discovery no longer replaces the last confirmed surface set or
advances `controlHealth.lastCheckedAt`. A failed notification discovery no longer
replaces the unread notification set. The snapshot is marked stale through
`cmuxReachable: false` and the explicit discovery errors.

Proof: `tests/state-health.test.ts`, “a failed cmux poll preserves the last confirmed
surfaces and notifications without advancing check time,” starts from a linked,
notified agent, fails both probes, and proves the link, attention outcome, and last
successful check time survive while health becomes degraded.

Deliberately left alone: no new `surfacesAsOf` schema field or consecutive-failure UI
policy was added because those require shared snapshot/client files outside this
lane. Existing `controlHealth` carries the stale marker.

### 4. PulseTracker burn refresh permanently latches

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

Burn reads are raced against a 20-second deadline, which is longer than the current
2.5-second keychain plus 15-second query budgets. A timeout applies unavailable cost
state, clears the in-flight latch, and permits the next TTL retry; a late reader
cannot overwrite the result.

Proof: `tests/pulse.test.ts`, “a burn reader deadline marks stale cost unavailable and
permits a later retry,” injects a never-settling second read, proves cost becomes
unavailable, then proves a third read succeeds.

Deliberately left alone: the two subprocess implementations in `burnbar.ts` are
outside this lane's ownership. The separate unchanged-cost `costAsOf` behavior noted
by the skeptic is also a distinct finding and was not folded into this fix.

### 5. SSE heartbeat exceeds Bun's default idle timeout

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

`Bun.serve` now uses `idleTimeout: 120` seconds, safely above the existing 25-second
heartbeat.

Proof: `tests/server-runtime.test.ts` reads the actual server configuration and
heartbeat source and asserts the configured idle window is longer. It failed before
the `idleTimeout` option was added.

Deliberately left alone: the 25-second heartbeat in `app.ts` was not changed because
120 seconds already provides the required margin and this lane was not permitted to
edit that line.

### 6. BunCommandRunner has zero tests

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

Proof: `tests/command.test.ts` contains five real-process cases covering stdout and
exit zero, exit 7, spawn failure, a SIGTERM-ignoring child, and an exited parent whose
grandchild retains stdout.

Deliberately left alone: no missing-binary error taxonomy was introduced; the
existing `exitCode: -1`, diagnostic `stderr`, `timedOut: false` contract is now pinned.

### 7. Timeout branches have zero tests

Status: **FIXED**
Commit: `4f503767ae2c24911637265b3f46714d9ddc7b45`

Proof:

- `tests/control-http.test.ts`: focus timeout returns 504; send-text timeout stops
  before Enter; two Enter timeouts return 504 `TEXT_STAGED_NOT_SUBMITTED`; a timed-out
  first Enter with exit zero is retried and can succeed.
- `tests/cmux.test.ts`: terminal and notification timeouts are explicit errors, not
  successful empty discoveries.
- `tests/identity.test.ts`: `ps` and `lsof` timeout branches surface their errors and
  do not invent identity evidence.
- `tests/command.test.ts`: the real runner produces `timedOut: true` under hostile
  subprocess conditions.

Deliberately left alone: the production timeout branches in `control.ts`, `cmux.ts`,
and `identity.ts` were already correct, so this finding required tests only and those
out-of-ownership source files were not edited.

## Scope audit

Changed production files: `src/server/command.ts`, `src/server/state.ts`,
`src/server/pulse.ts`, and `src/server/index.ts`.

Changed test files only under `tests/**`. No other production, client, configuration,
documentation, package, script, or shared-runtime file was changed.

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

---

# WAVE 2 / BE-B — identity evidence and snapshot truth

Branch: `ant-hill/be-identity-20260728`

## Verification

- `bunx tsc --noEmit`: clean
- `bun test`: 402 passing, 0 failing, no skipped or filtered tests
- `git diff --check`: clean

## Findings

### 1. lsof failure was fail-open — **FIXED**

- Commit: `ae00ad2`
- A timed-out `lsof`, or a nonzero exit without usable identity output, now returns `probe-failed` traces, clears carried session IDs, and marks affected surfaces conflicted so cwd fallback and sticky bindings cannot re-enable controls. Nonzero output with a usable allowlisted session path remains accepted, including routine nonempty `lsof` stderr.
- Proof: `tests/identity.test.ts` — “a timed-out open-session lookup rejects truncated identity evidence and quarantines the surface” and “partial allowlisted lsof output remains usable when a target PID races away”.
- Left alone: `src/server/state.ts` is owned by another lane. Failed probes cannot satisfy `updateBindingsFromScan`, and the conflicted surface preserves the binding quarantine invariant.

### 2. Stale session elapsed time kept growing — **FIXED**

- Commit: `22fb155`
- Elapsed time now stops at `updatedAt` for stale sessions as well as archived sessions.
- Proof: `tests/snapshot.test.ts` — “stale elapsed time stops at the last observed activity”.
- Left alone: Client extrapolation was already limited to non-ended agents.

### 3. Archive copies dropped conversation fields — **FIXED**

- Commit: `22fb155`
- Archive copies now retain `lastUserMessage`, `lastAgentMessage`, and `allowCwdFallback`.
- Proof: `tests/archive.test.ts` — “persists enough source truth to render an archive after the live file leaves the scan window”.
- Left alone: The existing explicit-copy convention remains in place.

### 4. identityTrace was eagerly built and shipped — **BLOCKED**

- Commit: N/A
- A complete lazy implementation requires changing the target-only resolver in `src/server/targets.ts` and/or the on-demand consumer in `src/server/debug-identity.ts`. Neither file is owned by this lane, and `resolveAgentTarget` still delegates to the trace-building resolver. Removing the field only in owned `snapshot.ts` would retain the construction cost or break `/api/debug/identity`.
- Test: None, because no in-scope implementation can satisfy the finding without changing forbidden files.
- Left alone: `snapshot.ts` trace construction and fingerprint stripping remain unchanged.

### 5. Archived agents accumulated in live snapshots — **FIXED**

- Commit: `22fb155`
- Durable agent archive records are pruned on load and persist after 30 days, and archived agents older than the configured scan window are excluded from the live snapshot.
- Proof: `tests/archive.test.ts` — “agent archive records older than the retention window are pruned on load” and “persisting a new archive prunes records that expired after load”; `tests/snapshot.test.ts` — “archived sources outside the configured scan window stay out of the live snapshot”.
- Left alone: Legacy string-only archive IDs have no timestamp and cannot be aged safely; they do not enter snapshots.

### 6. Identity enrichment rebuilt indexes per surface — **FIXED**

- Commit: `ae00ad2`
- Agent identity and process-by-tty indexes are now built once per scan, and command-hint resolutions are cached across surfaces.
- Proof: The identity and identity-trace suites protect match, conflict, ancestry, command-hint, and no-evidence behavior. No timing assertion was added because it would be environment-dependent; the structural regression is directly reviewable in `enrichCmuxIdentity`.
- Left alone: The remaining prefix scan runs once per distinct hint and preserves matching semantics.

### 7. Binding persistence rewrote once per session — **FIXED**

- Commit: `9f402af`
- Stores now accept a batch, and one identity scan commits all confirmed bindings through one queued atomic write/rename.
- Proof: `tests/identity-bindings.test.ts` — “one scan persists all confirmed bindings with one atomic file write”. The existing conflict test still proves a binding cannot un-quarantine a conflicted surface.
- Left alone: No confirmation-time debounce was added; one write per scan removes the amplification without weakening freshness semantics.

## Out-of-scope observations

No additional out-of-scope defects were changed.

---

# WAVE 3 / BE-H — identity session tier

Branch: `ant-hill/be-identity2-20260728`

## Identity session tier resolves zero agents — **FIXED**

- Fix commit: `c27b4b8` (`fix: recover cmux identity without tty metadata`)
- Root cause proved:
  - `identity.ts` already inspected every recognized process sharing a reported surface TTY, regardless of ancestry depth. The proposed immediate-child hypothesis was not the cause.
  - Live `debug.terminals` data omitted `tty` for 17 of 19 runtime-ready surfaces. Identity enrichment returned `no-tty` before `ps` or `lsof` evidence could be associated with them.
  - cmux `system.top` returned an exact `cmux_surface_id` on the native Codex PID. That PID held the rollout files open, providing the missing exact surface-to-process link without using cwd.
- What changed:
  - A ready surface without TTY now uses only exact `cmux_surface_id -> pid` process attribution before applying the existing recognized-agent and `lsof` session-path checks.
  - Attribution failures remain visible in collection errors and `identityTrace` notes.
  - Conflicting open root identities remain quarantined. Persisted bindings still cannot un-quarantine conflicted surfaces.
- Proving test:
  - `tests/identity.test.ts` — `cmux process attribution recovers exact identity when terminal discovery omits the tty`

## Duplicate cwd source — **FIXED**

- Fix commit: `c27b4b8`
- Root cause proved:
  - The second source was guardian rollout `019fa807-a0f3-7d71-858f-8b66e90c98d7`.
  - Its metadata records `thread_source: "subagent"` and parent `019fa807-8df1-7e31-8b9f-0f0121f193cc`.
  - The same native Codex PID held both rollout files. This was an internal child record, not a second controllable terminal.
- What changed:
  - A child can still resolve through recorded or exact session evidence.
  - It cannot claim a terminal through cwd fallback and does not compete with its controllable parent.
  - Genuine top-level peers sharing a cwd remain ambiguous and fail closed.
- Proving tests:
  - `tests/targets.test.ts` — `an internal child source does not compete with its controllable parent for cwd fallback`
  - `tests/identity-trace.test.ts` — `a child source cannot claim its parent's surface through cwd fallback`
  - Existing target coverage still proves two genuine active sources sharing one cwd remain ambiguous.

## Live verification

Production `:4701` was queried read-only and never restarted or changed. The repaired branch ran on scratch `:4788`.

Simultaneous measurement at approximately `2026-07-28T09:34:26Z`:

| Server | Agents | Surfaces | exact | unique-cwd | ambiguous | missing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Production `:4701` | 94 | 20 | 0 | 1 | 14 | 79 |
| Repaired scratch `:4788` | 94 | 20 | 10 | 0 | 4 | 80 |

Usable routes moved from one weak cwd fallback to ten exact session routes. This lane's parent resolved `exact` through `session` to surface `0E3519FA-EA6B-4328-B685-68A9C7D6159D`; its guardian became observed-only with an explicit child-source cwd rejection.

## Verification gates

- `bunx tsc --noEmit`: clean
- `bun test`: **470 pass, 0 fail, 0 skipped**, 2,074 assertions across 29 files
- Owned focused tests: **43 pass, 0 fail**
- `git diff --check`: clean

## Deliberately left alone

- Four scratch surfaces remained quarantined because their open files reduced to conflicting root identities. Choosing among them would violate the fail-closed requirement.
- No production service, main worktree, endpoint, collector, configuration, package manifest, or web file was changed.
- No push, merge, deployment, or launchd action was performed.
