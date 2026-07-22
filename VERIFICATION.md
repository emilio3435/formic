# The Ant Hill verification record

Date: 2026-07-22 America/Chicago
Scope: `/Users/emilionunezgarcia/Developer/the-mountain` on `127.0.0.1:4701`
Protected baseline: Mountain v2 at `/Users/emilionunezgarcia/mountain` on port 4700

## Automated gate

Command:

```bash
bun run check && node --check src/web/app.js
```

Latest result: exit 0. TypeScript was clean; Bun reported 117 passing tests, 0 failures, and 371 assertions across 12 files. Coverage includes deterministic triage generation, concurrent idempotent queueing, explicit single-run investigation launch and persisted completion, collector task-envelope cleanup, human naming, latest-request versus session-cumulative token semantics, Claude request deduplication, Cursor parent/child persistence and model policy, archived-only OMP history, active-token rollups, exact-only GUI control policy, pane identity, routing quarantine, notification age, durable archives, snapshot/SSE behavior, app disposal, fail-loud controls, same-origin HTTP boundaries, elapsed clocks, and web-client state/rendering invariants.

## High-acuity operator pass

Production-local browser QA at 1440x900 and 390x844 confirmed a 16px base, a six-metric command bar, prominent first intervention with compact secondary alerts, fixed-column agent facts for status/model/effort/update/latest-call/control, 44px mobile controls, and zero horizontal overflow. Now hides healthy idle sessions while retaining idle alerts; Idle remains an explicit one-click view. Recursive swarm rows render parent anchors, descendant counts, depth-colored rails, provider marks, compact quarantine glyphs, and observed latest-call/context bars. Repeated `Latest` summary labels were removed. Generated plans and results use collapsed progressive disclosure.

The production-local investigation proof launched the persisted cmux identity-conflict item through one fixed native `GPT-5.6 Luna · XHIGH` read-only command. A repeat request returned the same run instead of duplicating it. The result preserved quarantine, changed no sessions, and recorded the precise missing-live-access blocker. Two separately queued Cursor investigations remain queued and were not auto-launched.

## Ant Hill token, Cursor, and light-UX correction

The live v3 service now identifies itself as **The Ant Hill**. Its `the-mountain` technical program ID and filesystem path remain stable for compatibility, while the program name, document title, wordmark, server banner, empty states, README, and goal use the new name.

Token semantics were corrected at the provider boundary:

- Codex current usage comes from `last_token_usage`; `total_token_usage` is labeled as cumulative session history.
- Claude usage rows are deduplicated by request ID or message ID; the newest unique request drives current usage.
- The primary fleet number is the median latest request across working sessions. The sum of those requests is secondary, and archived/session totals cannot inflate either value.
- Cursor usage and cost remain `unknown` because local evidence does not expose authoritative billing data.

At `2026-07-22T05:47:50.783Z`, the live endpoint reported 33 current and 386 historical agents. The typical request was 93,984 tokens with 11/11 eligible working sessions reporting; their observed latest-request aggregate was 1,363,249 tokens. These are point-in-time values and change as agents work.

Cursor collection now parses parent-linked child transcripts as first-class sessions and audits each reported model against the Grok-only policy. The same snapshot reported seven current Cursor sessions: two compliant Grok sessions, zero confirmed active violations, and five unverified because Cursor did not report a model. Across the 36-hour retained scan, 105 child records were parent-linked and two ended non-Grok sessions were preserved as one historical warning. Ended aborted/failed children remain in History and do not inflate active attention.

Live browser QA against `127.0.0.1:4701` at 1440×900 and 390×844 confirmed:

- light ivory/parchment Hormiga styling with restrained terracotta, amber, and sage status cues
- no horizontal overflow, no console messages, no unlabeled buttons, and no raw UUID primary names
- `The Ant Hill` as the page and program identity, with source task text preserved unchanged
- a primary typical-request metric, secondary observed aggregate, and visible reporting coverage
- Cursor policy counts in the coverage strip and unverified/violation evidence in the inspector
- `last request` usage in the working-agent detail, with cumulative session total and context window confined to Technical
- a full-screen, usable inspector at mobile width

## Pre-correction point-in-time live snapshot

Command:

```bash
curl -fsS http://127.0.0.1:4701/api/snapshot
```

At `2026-07-22T03:30:19.019Z` the endpoint returned HTTP 200 with:

- `cmuxReachable: true`
- 17 programs, 39 live agents, and 237 tracked agents
- providers: 146 Codex, 15 Claude, 2 Cursor Agent, and 74 legacy OMP-history records
- Cursor billing shown as unknown/null, not estimated
- no unsafe enabled route and no duplicate enabled surface target in the verifier queries
- two identity-conflicted real surfaces (`ttys003` and `ttys005`), both quarantined from control

Counts are a point-in-time observation and will change as local sessions start and stop. This baseline exposed two temporary Cursor CLI reviewers but missed the user's live Cursor GUI agents; the correction and current evidence follow.

## Cursor GUI correction

The missing-card report was reproduced against the running v3 process. Cursor.app had live extension hosts for Elio, LaHormigaDormida, sem-hormiga-demo-night, and an Agents Window, while `pgrep -x cursor-agent` returned no CLI agent process. The original collector required `~/.cursor/chats/.../meta.json`, so it could see the two temporary CLI reviewers but not the GUI agents indexed elsewhere.

The collector now merges four authoritative local GUI sources:

- `conversation-search.db` for session ID, title, update time, and archive state
- `state.vscdb` local-agent membership for exact project cwd
- `ai-code-tracking.db` for the latest observed model when present
- `~/.cursor/projects/.../agent-transcripts` for task, tail, turn state, artifacts, and subagent count

At `2026-07-22T03:47:07.766Z`, the restarted v3 API reported nine Cursor records, five in the active view, and seven backed by GUI state. The active browser rendered `Cursor agent settings`, `Elio: SEM Night`, `Email assistant orchestration plan`, `Content Security Policy violation`, and the prior CLI review card. The count updated live as Cursor created the new settings session.

All GUI cards reported token provenance `unknown` and `cost: null`. A live query returned zero enabled focus, instruct, or interrupt actions for GUI cards; their reason is `Cursor GUI agents require exact cmux identity; cwd fallback is disabled.`

## Home attribution, human naming, and OMP history correction

The raw-source audit found 52 records whose recorded cwd was exactly `/Users/emilionunezgarcia` (46 Codex and six Claude) and zero records with an absent cwd. The source cwd was therefore real but too coarse for project presentation; it was not silently rewritten.

The snapshot now resolves presentation groups in this order: configured source cwd/ID, exact cmux surface cwd/title, configured meaningful task/name, then a raw-cwd fallback. This does not participate in control routing. At `2026-07-22T04:06:21.622Z`, after temporary audit workspaces were retired and archived, live checks returned 45 active and 279 tracked records with zero attention:

- zero active agents in `Home / Unassigned`; eight unmatched home records remained as non-active history
- zero UUID-fragment, prompt-file, `Session update`, absolute-path, or injected-instruction primary names
- zero injected `AGENTS.md`, environment, plugin, or subagent-notification envelopes exposed as tasks
- 11 Cursor records with unknown token provenance/null cost where local billing truth is unavailable
- zero non-archived OMP records; legacy OMP remains searchable history only
- active work contained 39 Codex and six Cursor records, with no OMP runtime card
- zero enabled mutating control whose target resolution was anything other than exact or unique-cwd

The masthead label is now `Active tokens`; archived history does not inflate that rollup. Expanded cards still show the raw source cwd and full provider session ID.

## HTTP safety probes

Read-only or rejected probes against the isolated v3 server produced:

- POST without `Origin`: HTTP 403, `ORIGIN_REJECTED`
- unsupported action or arbitrary field: HTTP 400, `INVALID_CONTROL_REQUEST`
- ambiguous Cursor focus request: HTTP 409, `CONTROL_DISABLED`
- a 27-second SSE observation received repeated named `snapshot` and `heartbeat` events while the browser remained Live

These probes did not invoke a real agent control.

## Disposable exact-control proof

The control test used only a temporary workspace and agent:

- cwd: `/private/tmp/mountain-control-probe.PfHhiO`
- cmux workspace: `workspace:63`
- Codex source session: `019f87d6-e9e3-7ca0-8848-d4e36f7885db`

The snapshot resolved one exact workspace/surface/pane target and enabled focus, instruct, and interrupt. The observed results were:

1. Focus returned HTTP 200 and selected only `workspace:63`; the previously selected `workspace:1` was restored.
2. Instruct returned HTTP 200; the disposable pane displayed `MOUNTAIN_CONTROL_OK`.
3. After instructing `sleep 60`, interrupt returned HTTP 200; the pane displayed `Conversation interrupted.`
4. `workspace:63` was closed and the empty temporary cwd was removed.

No Chronicle pane or other pre-existing workspace received a control action.

## Browser evidence

The current build was exercised in a headless browser at mobile (390px), tablet (768px), and desktop (1280px) widths:

- no horizontal overflow at any width
- zero unlabeled buttons and zero clickable `div` controls
- the default view rendered active agents rather than the full archive
- zero UUID-fragment, prompt-file, `Session update`, or absolute-path primary card names in the live desktop view
- the masthead showed `Active tokens`, and no active `Home / Unassigned` or OMP group was rendered
- Cursor Agent cards visibly showed `tokens — unknown`, `Cost: not reported`, transcript artifacts, and disabled-reason text when routing was ambiguous
- console errors were empty after the intentional server-restart history was cleared

## Direct stack and OMP removal gate

Commands:

```bash
agent-stack check
pgrep -x omp
```

`agent-stack check` returned PASS for direct Claude, Codex, and Cursor launchers and the generated policies. The always-applied Cursor rule and both Cursor custom-agent frontmatter files now pin `cursor-grok-4.5-high-fast`; Fable launches through Claude and Sol/Luna through Codex. `pgrep -x omp` found zero OMP processes. An exact search across the active stack, cmux skills, generated Cursor rule, and managed agent policies found no OMP routing terms. The Ant Hill OMP collector is archived, read-only historical compatibility and never contributes live status or active-token totals.

## Independent review

- Cursor/Grok 4.5 Fast: PASS after current static and live re-review; no release blocker.
- GPT-5.6 Sol: PASS on final re-audit. The independent current-code review and fresh gate produced 66/66 passing tests and 204 assertions with clean TypeScript. The supplied HTTP 200 runtime capture confirmed zero bad primary names, injected task envelopes, active Home / Unassigned cards, non-archived OMP records, unsafe Cursor billing, or unsafe enabled routes; responsive browser evidence was clean at 390px, 768px, and 1440px.

## Boundary

The refreshed v3 build is the local process on port 4701. Port 4700 remains untouched. No commit, push, external deployment, launchd edit, persistent service change, or port-4700 cutover was performed.
