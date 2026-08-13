# VERIFY-sync-cb

Adversarial read-only pass against `VERIFY-BRIEF-sync-cb.md`. Base: `656f2a9` (`git merge-base HEAD feat/sync-integration`). Work is staged, uncommitted, on `feat/sync-cb`. Scratch: `.lane-evidence/verify-cb-scratch.ts`.

## 1. Fence

**PASS.** Diff vs merge-base is only:

- `src/server/cmux-actions.ts` — close verbs + `configureCmuxActions` funnel seam. `markNotificationRead` / `dismissNotification` / `renameWorkspace` still `unimplemented("SYNC-NB"|"SYNC-RB")`.
- `src/server/app.ts` — two hunks: imports (`DEFAULT_CMUX_EXECUTABLE`, `cmuxCommand`, close verbs + configure) and the body inside the marked `/* SYNC routes */` block.
- `tests/cmux-actions-close.test.ts` — new.

`LANE-REPORT-sync-cb.md` is present and gitignored (`LANE-REPORT-*.md`). `src/server/state.ts` is byte-identical to merge-base: SYNC-E's `workspace.closed` / `surface.closed` registrations are untouched. No `ARCHITECTURE.md` / `cmux-sync.ts` / types edits.

## 2. Contract route shape

**PASS.** `POST /api/sync/close` accepts `{target:"surface"|"workspace", id, confirm?}`.

| Case | Observed JSON |
|---|---|
| `invalid_state` | `{ok:false, code:"invalid_state", detail, escalation:{workspaceId, siblingAgents:[{id,name}]}}` |
| workspace without `confirm:true` | `{ok:false, code:"confirm_required", escalation}` — no `workspace.close` |
| group anchor | `{ok:false, code:"anchor", detail}` — `window.list` / `workspace.group.list` only; no `workspace.close` |

Success is `{ok:true}`. Extra failure codes (`target_not_found`, `anchor_check_failed`) are additive, not a frozen-shape mutation. HTTP 409/502 ride beside the JSON; CF is specified against the body. Anchor "no cmux call" is the mutation (`workspace.close`); check 5 requires the discovery RPCs.

## 3. Failure honesty (trap #2)

**PASS.** `failedAction` does not treat exit 0 as success: it checks `executableMissing`, `timedOut`, stderr `code: detail` text, JSON `error` bodies, then non-zero, then leftover stderr. Fingerprint is recorded only after that returns undefined.

Lane tests cover non-zero, stderr-with-exit-0, and exit-0 JSON refusal, each with `isOwnEcho === false`. Timeout and missing executable are implemented but not in the lane file; scratch:

```
timeout result={"ok":false,"code":"timeout","detail":"cmux surface.close timed out after 10000ms"} isOwnEcho=false commands=1
missing-exec result={"ok":false,"code":"unavailable","detail":"cmux executable not found"} isOwnEcho=false commands=1
```

## 4. invalid_state is escalation, not retry (trap #5)

**PASS.** `write()` is a single `runner.run`. The route maps `invalid_state` onto escalation and returns. No retry loop on that code in `cmux-actions.ts` or the SYNC close block. Funnel test asserts `runner.commands` length 1; route test asserts one `surface.close`.

## 5. Anchors (trap #6) + windows (trap #1)

**PASS.** Workspace path enumerates `window.list`, then `workspace.group.list` with `{window_id}` per window, then refuses before `closeWorkspace`. The fixture is two windows with the anchor only on window 2 (`groupList()`, then `groupList("WORKSPACE-ANCHOR")`) and asserts the exact three-command walk. A single-window walk would miss the anchor, issue `workspace.close`, and fail `code:"anchor"`.

## 6. Fingerprints

**PASS.** Clean close records `surface.close` / `workspace.close` plus the RPC params (`surface_id` / `workspace_id`). `echoMethod` prefers embedded `payload.method`, else strips `_requested`.

Lane success test uses `surface.closed` / `workspace.closed` with embedded `method` — that path matches. Scratch against the live echo shape and the liveness event:

```
success={ok:true} close_requested.params=true close_requested.top=true closed.bare=false closed.embedded=true
workspace close_requested=true closed.bare=false
```

So `surface.close_requested` / `workspace.close_requested` (params nested or top-level) match; a bare `*.closed` event does **not**, which is what SYNC-E's handlers need. Existing `cmux-sync.test.ts` already filters `*_requested` via `isOwnEcho` before dispatch.

## 7. Escalation sibling data

**PASS, with a residual.** Route reads `dependencies.state.get().programs` (the published HubSnapshot, i.e. `buildSnapshot` output in production). Siblings are derived, not a hardcoded list: live + `target.workspaceId` match + `{id, name}` from `identity?.name ?? displayName`. Surface escalation excludes the requested surface (`excludeSurfaceId`). Ended Curie and other-workspace Dijkstra are omitted; Babbage remains. Workspace `confirm_required` lists every remaining live exact agent (Ada + Babbage) because the frozen body has no current-agent id — that reading is forced by the request shape.

The test injects a hand-built HubSnapshot rather than calling `buildSnapshot()`. That is the same type `state.get()` returns; the assertion is still driven off those rows, not a parallel orphan list. Residual (not a shape break): sibling enumeration also requires `resolution === "exact"`, so a live `unique-cwd` agent in the same workspace is omitted from workspace-confirm impact data (scratch: only Ada named). Last-surface `invalid_state` cannot coexist with a second live surface, so that residual does not bite the primary escalation path.

## 8. Hollow-test check

**PASS.**

- Foreign Origin: asserts `403` + `error.code: "ORIGIN_REJECTED"` **and** `runner.commands` equal `[]`. Deleting `sameOriginLoopback` would run `surface.close` (empty MethodRunner → non-403 body, non-empty commands). Origin is checked before `configureCmuxActions` / any RPC.
- Confirm gate: asserts exact `{ok:false, code:"confirm_required", escalation:{...}}` **and** no `workspace.close`. Deleting `confirm !== true` would hit the funnel; this runner has no `workspace.close` reply, so the JSON would not match.

## 9. Floor

**PASS.**

```text
$ bunx tsc --noEmit
TSC_EXIT:0
```

```text
$ bun test tests/cmux-actions-close.test.ts tests/cmux-sync.test.ts tests/cmux.test.ts tests/reference-docs.test.ts
bun test v1.3.14 (0d9b296a)

tests/cmux-sync.test.ts:
(pass) cmux typed sync stream > parses every cursor field from the live nested ack resume shape [0.11ms]
(pass) cmux typed sync stream > dispatches JSONL events once in seq order and a throwing handler cannot kill the stream [1.63ms]
(pass) cmux typed sync stream > filters this process's action echo before registered handlers see it [0.07ms]
(pass) cmux typed sync stream > a gap recollects once, drops replay patches, and resumes only after a fresh ack [0.40ms]
[cmux-sync] cmux sync child exited with code 9
[cmux-sync] cmux sync child exited with code 9
(pass) cmux typed sync stream > an exit reconnects after the cursor and a second pre-recovery exit recollects [0.46ms]
(pass) cmux close events update HubState in the same dispatch > workspace.closed ends every bound agent with reason cmux-closed without a poll [7.93ms]
(pass) cmux close events update HubState in the same dispatch > surface.closed ends only its bound agent [1.90ms]
(pass) cmux close events update HubState in the same dispatch > workspace teardown surface events do not double-fire before workspace.closed [1.72ms]

tests/reference-docs.test.ts:
(pass) ARCHITECTURE.md stays true to the code it maps > it names every module that exists, and every module it names exists [2.74ms]
(pass) ARCHITECTURE.md stays true to the code it maps > the pipeline symbols it names are the ones the server exports [1.92ms]
(pass) ARCHITECTURE.md stays true to the code it maps > controlsFor is credited to the file that actually defines it [0.62ms]
(pass) ARCHITECTURE.md stays true to the code it maps > the endpoints it documents are registered, and the deploy gate is one of them [0.51ms]
(pass) ARCHITECTURE.md stays true to the code it maps > the cadence and windows it quotes are the ones the server runs [0.12ms]
(pass) ARCHITECTURE.md stays true to the code it maps > the fingerprint exclusions it lists are the fields actually dropped [0.11ms]
(pass) README.md stays true to the product > the honesty promise it leads with is one the client keeps [1.68ms]
(pass) README.md stays true to the product > the ports and failure mode it sends a stranger to are real [0.21ms]
(pass) ARCHITECTURE.md carries the contract detail README no longer does > the snapshot fields it names are fields the snapshot carries [0.29ms]
(pass) ARCHITECTURE.md carries the contract detail README no longer does > the two ends of a message it distinguishes are both real [0.15ms]
(pass) ARCHITECTURE.md carries the contract detail README no longer does > the commands and ports it sends a reader to are real [0.28ms]
(pass) ARCHITECTURE.md carries the contract detail README no longer does > every sibling document it links to exists [1.43ms]
(pass) QUICKSTART.md stays true to a first run > the messages it tells a beginner to expect are the ones that get printed [0.36ms]
(pass) QUICKSTART.md stays true to a first run > the board strings it quotes are strings the client renders [1.52ms]
(pass) QUICKSTART.md stays true to a first run > the lookback trap it warns about is the real one [0.15ms]
(pass) QUICKSTART.md stays true to a first run > every command and file it tells a reader to run or copy exists [0.25ms]
(pass) TRIAGE-WORKFLOW.md stays true to the triage subsystem > the endpoints it documents are registered [0.41ms]
(pass) TRIAGE-WORKFLOW.md stays true to the triage subsystem > the launch it describes is the launch that happens [0.05ms]
(pass) TRIAGE-WORKFLOW.md stays true to the triage subsystem > the four states it names are the four the store validates [0.03ms]
(pass) TRIAGE-WORKFLOW.md stays true to the triage subsystem > the server-side limits it promises are fixed in code [0.04ms]
(pass) TRIAGE-WORKFLOW.md stays true to the triage subsystem > the prompt contract it publishes is the prompt that gets built [0.04ms]
(pass) DEPLOY.md is a rulebook the scripts actually enforce > every script it tells an operator to run exists [0.96ms]
(pass) DEPLOY.md is a rulebook the scripts actually enforce > the guards it promises are the guards the deploy script has [0.05ms]
(pass) DEPLOY.md is a rulebook the scripts actually enforce > the ports it reserves are the ports the scripts use [0.02ms]
(pass) DEPLOY.md is a rulebook the scripts actually enforce > the launchd label it names is the one both scripts and the restart use [0.01ms]
(pass) DEPLOY.md is a rulebook the scripts actually enforce > the lane branches it names as sources exist [15.62ms]
(pass) SECURITY.md describes the boundary the code implements > the control surface is exactly the actions it lists [0.08ms]
(pass) SECURITY.md describes the boundary the code implements > instruct really does reject CR/LF and oversized text [0.11ms]
(pass) SECURITY.md describes the boundary the code implements > the 30-second freshness gate covers control and broadcast, and exempts archive [0.08ms]
(pass) SECURITY.md describes the boundary the code implements > every route family it claims is origin-checked has its own gate [0.24ms]
(pass) SECURITY.md describes the boundary the code implements > the loopback bind and the redacted diagnostics are real [0.09ms]
(pass) SECURITY.md describes the boundary the code implements > the design record it defers to still exists [0.27ms]
(pass) the publish surface is documented as what it actually is > the endpoint the guide tells you to curl is the one that is registered [0.07ms]
(pass) the publish surface is documented as what it actually is > the read-only git verbs it promises are the only ones it runs [0.46ms]
(pass) the publish surface is documented as what it actually is > there is no POST, so the guide's no-one-click claim holds [0.35ms]
(pass) the publish surface is documented as what it actually is > the guide describes it as an endpoint while no board UI consumes it [1.12ms]
(pass) the executable scripts do what DEPLOY.md says they do > DEPLOY.md accounts for every shell script that exists [0.09ms]
(pass) the executable scripts do what DEPLOY.md says they do > the on-main guard is a real comparison, not a comment [0.08ms]
(pass) the executable scripts do what DEPLOY.md says they do > a red typecheck or red test aborts before anything restarts [0.06ms]
(pass) the executable scripts do what DEPLOY.md says they do > the preview script cannot land on the production port [0.04ms]
(pass) the executable scripts do what DEPLOY.md says they do > the hygiene script's kill is scoped to the port it is freeing [0.07ms]
(pass) package.json scripts and config/ are documented as they execute > every npm script is documented somewhere a reader will look [0.25ms]
(pass) package.json scripts and config/ are documented as they execute > the port-binding scripts are named as port-binding [0.06ms]
(pass) package.json scripts and config/ are documented as they execute > start:external is documented as NOT binding externally [0.19ms]
(pass) package.json scripts and config/ are documented as they execute > the EADDRINUSE behaviour README promises is what the server does [0.07ms]
(pass) package.json scripts and config/ are documented as they execute > every key in config/models.json is read by something [1.37ms]
(pass) package.json scripts and config/ are documented as they execute > the example program config matches what the loader accepts [0.27ms]
(pass) README's closing gate line stays true > the gate it describes is the gate that runs [0.08ms]
(pass) the fail-closed write gate is documented as a deliberate capability change > cmux attesting the session enables every control [0.21ms]
(pass) the fail-closed write gate is documented as a deliberate capability change > a folder match permits Focus and refuses Send and Interrupt [0.11ms]
(pass) the fail-closed write gate is documented as a deliberate capability change > both onboarding docs describe that asymmetry, not a blanket cmux requirement [0.54ms]
(pass) the fail-closed write gate is documented as a deliberate capability change > the docs' recovery advice matches the evidence the code actually keys on [0.18ms]
(pass) day one on a machine without cmux > a machine with nothing installed reads calm, and still says something [0.30ms]
(pass) day one on a machine without cmux > a machine with one tool installed names the one and the absences [0.08ms]
(pass) day one on a machine without cmux > a fully-equipped machine keeps the documented count [0.03ms]
(pass) day one on a machine without cmux > a collector that WAS healthy and now is not still alarms [0.04ms]
(pass) day one on a machine without cmux > QUICKSTART quotes the empty-board strings the model renders [0.10ms]
(pass) day one on a machine without cmux > QUICKSTART names every collector the code has, with the path it reads [0.30ms]
(pass) day one on a machine without cmux > a missing cmux binary is detected as absent on the real first-run path [0.12ms]
(pass) the safety promises the docs make on the product's behalf > both docs promise the board refuses an unnameable terminal [0.52ms]
(pass) the safety promises the docs make on the product's behalf > both docs promise the board refuses a session that has exited [0.55ms]
(pass) the safety promises the docs make on the product's behalf > both docs promise Focus stays available so there is always a way in [0.50ms]
(pass) the safety promises the docs make on the product's behalf > the identity promise is the gate the code actually enforces [0.18ms]
(pass) the safety promises the docs make on the product's behalf > no write is authorised against a process the board knows is dead [0.07ms]
(pass) the guide describes the dead-row controls as they actually behave > controlsFor greys instruct on a process the gate will refuse [0.50ms]
(pass) README, QUICKSTART and ANT-GUIDE cohere as one set > one state, one name: the health verdict a reader is told to look for [0.46ms]
(pass) README, QUICKSTART and ANT-GUIDE cohere as one set > the identity promise is stated once per document, not three times [0.74ms]
(pass) README, QUICKSTART and ANT-GUIDE cohere as one set > the cost-honesty rule is not restated inside QUICKSTART [0.10ms]
(pass) README, QUICKSTART and ANT-GUIDE cohere as one set > every cross-document link resolves to a file that exists [0.18ms]
(pass) README, QUICKSTART and ANT-GUIDE cohere as one set > the cmux link points at the project this actually integrates with [0.01ms]
(pass) the cost window's limits are documented as the code enforces them > the guide lists the presets the UI actually offers, widest included [0.37ms]
(pass) the cost window's limits are documented as the code enforces them > both ceilings are documented as the code sets them [0.81ms]
(pass) the cost window's limits are documented as the code enforces them > the guide says the shortfall is silent, which is the whole finding [1.23ms]
(pass) no one-off measurement is presented as a standing fact > any cost total is dated and labelled a reading, not left as a fact [0.48ms]
(pass) no one-off measurement is presented as a standing fact > the token-scale warning describes a shape, not a multiplier [0.40ms]
(pass) what the docs promise about incompleteness > the prior-spend guarantee names the field the server actually returns [0.49ms]
(pass) what the docs promise about incompleteness > the guide says the card does not print it yet, while that is true [0.96ms]
(pass) what the docs promise about incompleteness > the archive warning matches the clock the code actually uses [0.65ms]
(pass) what the docs promise about incompleteness > the narrowed caveat no longer calls the whole board rough [0.68ms]
(pass) the guide separates what was observed from what was exercised > the gate table admits which rows have not been seen on a live board [0.67ms]
(pass) the guide separates what was observed from what was exercised > the collapsed summary line does not promise All clear unconditionally [0.65ms]
(pass) claims are re-measured after their foundations move > the archive warning reports both measurable and unmeasurable records [0.82ms]
(pass) claims are re-measured after their foundations move > the archive guide does not claim a term it has not yet observed [0.89ms]
(pass) claims are re-measured after their foundations move > the gate table's unobserved rows are still unobserved [0.99ms]
(pass) the catch-up summary stays true to the code it summarises > it carries the timestamp with the cost total, not just the total [0.27ms]
(pass) the catch-up summary stays true to the code it summarises > it does not claim the archive term has been observed [0.37ms]
(pass) the catch-up summary stays true to the code it summarises > it tells a returning reader what to do first, not only what to believe [0.22ms]
(pass) the catch-up summary stays true to the code it summarises > it keeps an open section rather than reading as a victory lap [0.33ms]
(pass) the catch-up summary stays true to the code it summarises > its cost claim rests on the same identity the guide pins [0.57ms]
(pass) the summary's scope survives an adversarial read > it does not claim no cmux workspace was touched [0.38ms]
(pass) the summary's scope survives an adversarial read > the day-one claim is scoped to what this machine can actually show [0.77ms]
(pass) the archive backlog is described as fixed, not as a shortfall > the summary separates the stuck records from the growing ones [0.21ms]
(pass) TODAY.md names the providers the board cannot see > the roster the board collects still excludes the providers named [0.21ms]
(pass) TODAY.md names the providers the board cannot see > it says this is an absent number, not a wrong one [0.17ms]
(pass) TODAY.md names the absent-zero assertion, not just the omission > the snapshot really does publish absent as a number [0.06ms]
(pass) TODAY.md names the absent-zero assertion, not just the omission > the summary says the board asserts absence rather than staying silent [0.24ms]
(pass) TODAY.md is honest about how young the verification is > it says the external check is new and that the board held [0.18ms]
(pass) TODAY.md is honest about how young the verification is > it separates the audited mechanism from the unaudited verdict [0.38ms]
(pass) ANT-GUIDE teaches the provider blind spot as a check, not a complaint > it names the second boundary on the cost figure [0.41ms]
(pass) ANT-GUIDE teaches the provider blind spot as a check, not a complaint > it gives the reader the check rather than the grievance [0.41ms]
(pass) ANT-GUIDE teaches the provider blind spot as a check, not a complaint > it explains why a green health line does not cover this [0.42ms]
(pass) ANT-GUIDE tells a reader how to find their own blind spot > the collectors it tells them to compare against are the real ones [0.51ms]
(pass) ANT-GUIDE tells a reader how to find their own blind spot > it tells them to widen the window BEFORE reading the list [0.52ms]
(pass) ANT-GUIDE tells a reader how to find their own blind spot > it states the check's own boundary rather than overselling it [1.78ms]
(pass) the guide's screenshots and their captions stay honest > every embedded shot exists on disk [0.39ms]
(pass) the guide's screenshots and their captions stay honest > the hero caption describes the picture rather than apologising for it [0.40ms]
(pass) the guide's screenshots and their captions stay honest > the provider shot is embedded where the check that needs it lives [0.09ms]

tests/cmux.test.ts:
(pass) parseCmuxTerminals — the surface rename becomes the terminal title > captures surface_title into title so the operator's /rename enters the model [0.75ms]
(pass) parseCmuxTerminals — the surface rename becomes the terminal title > strips the leading live-status glyph/spinner from an active surface title [0.46ms]
(pass) parseCmuxTerminals — the surface rename becomes the terminal title > strips ▪/● status markers too and leaves an untitled surface without a title [0.07ms]
(pass) parseCmuxTerminals — the surface rename becomes the terminal title > preserves provider qualification beside legacy session fields [0.10ms]
(pass) runtime cmux executable > uses a configured executable and otherwise preserves the default [0.03ms]
(pass) cmux timeout results > terminal and notification timeouts are errors rather than successful empty polls [0.48ms]
(pass) persisted notification attention state > acknowledgement suppresses current notifications but not a newer one [0.36ms]
(pass) persisted notification attention state > notification collection applies persisted acknowledgement before snapshot input [0.18ms]
(pass) persisted notification attention state > snooze expires from the clock without a clearing mutation [0.06ms]
(pass) persisted notification attention state > bounds persisted dispositions to the 500 newest surfaces [42.18ms]
(pass) persisted notification attention state > attention records survive reopen and corrupt state degrades loudly to empty [12.94ms]
(pass) cmux terminal discovery outcomes > reports a non-zero discovery exit with stderr [0.16ms]
(pass) cmux terminal discovery outcomes > reports invalid discovery output as an error [0.09ms]
(pass) cmux terminal discovery outcomes > returns parsed terminals and uses the bounded discovery command [0.18ms]
(pass) cmux sidebar repository facts > maps the installed sidebar snapshot shape to live repository facts [0.23ms]
(pass) cmux sidebar repository facts > collects sidebar repository facts through the caller window id [0.39ms]
(pass) cmux sidebar repository facts > enumerates every cmux window before collecting workspaces [0.14ms]

tests/cmux-actions-close.test.ts:
(pass) SYNC-CB close action funnel > surface.close records a fingerprint only after a clean RPC [1.05ms]
(pass) SYNC-CB close action funnel > workspace.close records a fingerprint only after a clean RPC [0.06ms]
(pass) SYNC-CB close action funnel > non-zero is a typed failure and records no echo fingerprint [0.13ms]
(pass) SYNC-CB close action funnel > stderr with exit zero is a typed failure and records no echo fingerprint [0.01ms]
(pass) SYNC-CB close action funnel > last-surface invalid_state is returned, not thrown or retried [0.05ms]
(pass) SYNC-CB close action funnel > an exit-zero RPC error body is still a typed refusal [0.07ms]
(pass) POST /api/sync/close > rejects a foreign Origin before any cmux call [2.08ms]
(pass) POST /api/sync/close > invalid_state names every other live agent in the target workspace [0.29ms]
(pass) POST /api/sync/close > a group-anchor workspace is refused before workspace.close [0.31ms]
(pass) POST /api/sync/close > workspace close requires server-side confirmation and returns impact data [0.13ms]
(pass) POST /api/sync/close > confirmed non-anchor workspace close reaches the funnel once [0.11ms]

 143 pass
 0 fail
 816 expect() calls
Ran 143 tests across 4 files. [197.00ms]
```

VERDICT: PASS
