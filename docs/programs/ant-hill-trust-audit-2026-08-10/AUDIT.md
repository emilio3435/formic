# Ant Hill trust audit

Audit date: 2026-08-10

Audited baseline: `059cbbea670374a8778e20ef87f0582697efb42f`

Verified product/test head: `dd57d5027e905a96d872252b20b08a8789656f90`

Local integration branch: `fix/ant-hill-trust-audit-20260810`

## Executive verdict

The baseline failed the trust audit. The local candidate repairs every confirmed
high-severity defect found in the initial lanes and the combined-diff reviews:

- provider-local terminal evidence can no longer authorize a different provider
  that happens to use the same session UUID;
- failed discovery, failed identity enrichment, and cached PID evidence now
  withdraw write authority until a current scan re-attests it;
- old published routes are quarantined before persistence awaits, including a
  successful A-to-B target change and source-only terminal invalidation;
- the live accounting gate now understands Codex daily partitions, rejects mixed
  lifetime/daily identities, and states incomplete windows explicitly.

No confirmed High remains at the verified product/test head. Ten distinct
Medium roots remain registered and intentionally unrepaired under the locked
severity scope. Browser wheel/touch boundary proof is `BLOCKED`; the
time-specific Home/Cursor population is `UNAVAILABLE`; and one current OBB row
is `BLOCKED` from source adjudication because Codex has no independent per-call
series. None is relabelled green.

No high-severity browser defect was reproduced. The confirmed browser defect is
a 64 px mobile Usage overflow at `375x812` (Medium), documented with a
privacy-redacted screenshot and matching numeric geometry.

## Verdict matrix

Only `PASS`, `FAIL`, `BLOCKED`, and `UNAVAILABLE` are verdicts. Severity applies
only to failures.

| Claim | Baseline | Final scoped verdict | Evidence-backed conclusion |
| --- | --- | --- | --- |
| I-01 | FAIL (High) | FAIL (Medium) | Provider-qualified live evidence and bindings now prevent cross-provider Send/Interrupt. A providerless legacy binding can still yield a false `exact/remembered` Focus route after migration; terminal writes fail closed. |
| I-02 | PASS | PASS | Resolver order remains hook store, recorded target, session evidence, then unique cwd; diagnostics expose every attempted and matched tier. |
| I-03 | FAIL (High) | PASS | Shared-cwd ambiguity, unqualified multi-provider UUIDs, and qualified multi-provider claims all refuse writes; real control probes return 409 with no cmux command. |
| I-04 | FAIL (Medium) | FAIL (Medium) | The reserved Prime heartbeat monitor can gain a cached-scan unique-cwd Focus route. Send and Interrupt remain disabled. |
| I-05 | FAIL (High) | FAIL (Medium) | All reproduced stale-route Send/Interrupt/broadcast races are fixed. Two safe-scope residuals remain: browser controls appear enabled from 30–60 seconds while the server returns 409, and source-only terminal evidence can durably Focus the retained pane during history persistence while all input paths remain closed. |
| I-06 | FAIL (High) | PASS | Degraded discovery clears cached PID/start evidence and cannot republish `processAlive:true`; recovery restores only re-attested state. |
| I-LIVE | UNAVAILABLE | UNAVAILABLE | The identity lane could not enumerate the time-specific live Home/Cursor population from its sandbox. Deterministic admission, routing, and refusal checks pass; no count is inferred. |
| B-01 | FAIL (Medium) | FAIL (Medium) | Board, History, and Usage are reachable, but mobile Usage truth is clipped by the B-05 overflow. |
| B-02 | PASS | PASS | Drawer header, transcript, status footer, controls, and composer are visible or reachable through the measured scroll owner at every required viewport. |
| B-03 | PASS | PASS | Unavailable controls remain visible, natively disabled, keyboard-inert, and explained. |
| B-04 | BLOCKED | BLOCKED | Scroll-owner and repaint subproofs pass, but the installed browser driver cannot generate permitted wheel/touch boundary input. PageDown is not substituted. |
| B-05 | FAIL (Medium) | FAIL (Medium) | Board and History have no horizontal spill; mobile Usage spills 64 px. No drawer control is occluded. |
| B-06 | PASS | PASS | Names, roles, landmarks, focus order, and live/status semantics agree with visible capability state. |
| B-07 | PASS | PASS | Synchronized snapshot and browser captures agree for identity, model, status, context, tokens, age, controls, usage, health, and summary context. |
| M-01 | FAIL (Medium) | FAIL (Medium) | Factory emits cumulative session usage as `total`, not `sessionTotal`; fleet consumption is honestly labelled a floor but omits a measurable term. |
| M-02 | FAIL (Medium) | FAIL (Medium) | Server context accepts Factory cumulative session scope while the row renderer requires latest-turn scope, producing inconsistent context truth. |
| M-03 | PASS | PASS | Measured cost wins, derivation is labelled, and missing pricing remains a floor or unavailable rather than becoming `$0`. |
| M-04 | FAIL (Medium) | FAIL (Medium) | Pulse hard-codes four providers although the current union has six, so failed installed sources can be recorded as zero active rather than unmeasured. |
| M-05 | FAIL (Medium) | FAIL (Medium) | Factory and Prime take append order rather than maximum event time; an out-of-order event can move `updatedAt` backward. |
| M-06 | FAIL (Medium) | FAIL (Medium) | History export advertises compiled 30-day/5,000-record defaults while effective settings are 120 days/50,000 records. |
| M-07 | FAIL (High) | PASS | The gate recognizes `<uuid>#day-<epoch>`, applies MAX within a cumulative day and SUM across days, joins all current Codex rows, rejects mixed identity shapes, and labels incomplete windows. |
| M-OBB-ROW | BLOCKED | BLOCKED | One current Codex row is 79.54% lower in OBB than on the board (equivalently, the board is 388.8% higher than OBB). The gate names and excludes it, but no independent Codex per-call series exists to establish which source is correct. |

## Browser reproduction

The isolated preview ran at `127.0.0.1:4711`; production `:4701` was not
restarted or mutated. All captures used device scale factor 1.

The browser capture was made at combined head `e7d4ab6`. It is valid
carry-forward evidence for `dd57d50`: `git diff e7d4ab6..dd57d50 -- src/web`
is empty, and every later product change is server-side. The tracked screenshot
redacts local session names and telemetry values while preserving the viewport,
layout, clipped regions, and overflow boundary. The raw capture remains local
under `/private/tmp` and is not in branch history.

| Viewport | Board overflow | History overflow | Usage overflow | Drawer result |
| --- | ---: | ---: | ---: | --- |
| `1280x720` | 0 px | 0 px | 0 px | Complete drawer reachable by document scroll; composer 100% visible after `scrollY=225`. |
| `768x1024` | 0 px | 0 px | 0 px | Full-screen inspector; `.drawer-grid` owns scrolling; footer and composer 100% visible. |
| `375x812` | 0 px | 0 px | 64 px | Full-screen inspector; `.drawer-grid` owns scrolling; footer and composer 100% visible. |

At `375x812`, the document measured `clientWidth=375` and `scrollWidth=439`.
The Usage panel measured `clientWidth=290` and `scrollWidth=397`.
`.usage-kpis` ended at x=`438.96875`, or `63.96875px` beyond the viewport; the
table ended at x=`424.375`, or `49.375px` beyond it.

- [Privacy-redacted screenshot](evidence/mobile-usage-375x812.png)
- [Matching geometry](evidence/mobile-usage-375x812.json)
- Baseline screenshot: `/private/tmp/ant-trust-browser-ro/.lane-evidence/mobile-usage-375x812.png`
- Baseline geometry: `/private/tmp/ant-trust-browser-ro/.lane-evidence/mobile-usage-overflow-375x812.json`
- Synchronized render comparison: `/private/tmp/ant-trust-browser-ro/.lane-evidence/render-snapshot-compare.json`
- Focus/disabled behavior: `/private/tmp/ant-trust-browser-ro/.lane-evidence/focus-mobile-375x812.json`

Repaint preservation held after 6.5 seconds at desktop, tablet, and mobile. The
installed driver rejected `wheel` as an unknown command and exposes no permitted
CDP input dispatch, so B-04 remains `BLOCKED`.

## Measurement evidence

The read-only measurement floors used explicit file lists, no name filter, and
reported no skip, todo, or only markers:

- token/context: 82 pass, 0 fail across 6 files;
- cost: 101 pass, 0 fail across 7 files;
- health/time: 270 pass, 0 fail across 12 files;
- archive/reconciliation: 155 pass, 0 fail across 8 files.

The baseline live gate was non-vacuous and failed: 48 settled joined sessions
agreed exactly, but seven current Codex rows had unclassified daily keys and
`codex=0/7`. A fully paged seven-day read found 396 Codex partitions representing
386 base sessions; all 386 base identities joined Ant Hill. The correct contract
is MAX among cumulative rows inside one day and SUM across covered days. A
bounded sum is not lifetime usage when the board session predates the query.

At `dd57d50`, the current live gate is green with 15 pass, 0 fail, and 44
assertions:

```text
settled=48; unknown=0
codexRows=7; codexIdentityJoined=7/7
codexComparable=6; codexWindowIncomplete=1
unexplained disagreements=0
```

The old session `019fe713…` is explicitly `unadjudicable-window` because its
board start predates the rolling query. Separately, `019fe929…` reports
151,523,235 tokens on the board versus 31,000,914 in OBB, 388.8% board-high.
The gate classifies that row as unadjudicable rather than weakening the 5%
agreement rule or declaring a source correct.

## Prioritized defect register

| Priority | Root | Claims | Status / smallest owner fence |
| ---: | --- | --- | --- |
| P0 | Cross-provider UUID evidence authorized the wrong terminal | I-01, I-03 | Repaired and verified in identity/cmux/binding/target code and focused tests. |
| P0 | Failed discovery reused prior route and PID authority | I-05, I-06 | Repaired and verified in `src/server/state.ts` and `tests/state-health.test.ts`. |
| P0 | Published stale routes remained writable across persistence awaits | I-05 | Repaired and verified at both pre-binding and post-bridge/history seams. |
| P0 | Daily OBB partitions were rejected or could mix with lifetime identities | M-07 | Repaired and live-verified in `tests/cross-source-token-agreement.test.ts`. |
| P1 | Providerless legacy binding can false-Focus another provider's old pane | I-01 | Medium; binding/target migration fence; Send/Interrupt fail closed. |
| P1 | Source-only terminal history barrier can durably Focus the retained pane | I-05 | Medium; shared-surface semantics need separate design; input and broadcast remain 409. |
| P1 | Browser/server stale-control ages differ (60s/30s) | I-05 | Medium; `src/web/app.js` plus client freshness test; server refusal is safe. |
| P1 | Prime heartbeat monitor gains cached unique-cwd Focus | I-04 | Medium; Prime collector/routing test; terminal writes remain closed. |
| P1 | Mobile Usage intrinsic-width spill | B-01, B-05 | Medium; `src/web/styles.css` plus a 375x812 geometry regression. |
| P1 | Factory cumulative usage omitted from aggregate | M-01 | Medium; `src/server/factory.ts` plus accounting tests. |
| P1 | Context numerator accepts cumulative session scope | M-02 | Medium; snapshot context contract and tests. |
| P1 | Pulse provider denominator is stale | M-04 | Medium; `src/server/pulse.ts` plus unmeasured-provider tests. |
| P1 | Factory/Prime event time can regress | M-05 | Medium; collector timestamp reducers and focused tests. |
| P1 | History export metadata ignores effective settings | M-06 | Medium; export endpoint and retention tests. |
| Watch | Wheel/touch scroll-boundary proof unavailable in installed driver | B-04 | BLOCKED; preserve as an explicit browser capability gap. |
| Watch | Current OBB Codex row differs without an independent adjudicator | M-OBB-ROW | BLOCKED; investigate OBB capture separately without changing the Ant Hill gate. |
| Watch | Time-specific Home/Cursor population count | I-LIVE | UNAVAILABLE from the identity sandbox; deterministic checks remain green. |

## Red-first repair record

Initial implementation lanes started from the locked baseline. Review-phase
lanes started from the exact combined candidate they were assigned to examine.
Every worker used an exclusive worktree and a declared file fence; the root
integration owner alone cherry-picked the commits.

| Repair | Lane commit | Integrated commit | Red proof before repair | Verified green proof |
| --- | --- | --- | --- | --- |
| OBB daily partitions | `735cfef` | `67e576e` | Two daily keys stayed split instead of one base identity; the bounded-window classifier was absent. | Current live gate: 15/0, 44 assertions; all 7 Codex rows join; MAX-across-days defeat fails. |
| Stale discovery quarantine | `819d51b` | `50c518b` | Failed cmux and identity scans retained running/exact/live state, prior PID truth, and writable controls. | State 15/0; broader state/control/broadcast/direct-link 106/0; recovery re-attests. |
| Provider-qualified routing | `f0b4182` | `e7d4ab6` | Claude evidence authorized a colliding Codex UUID; provider lookup also enumerated the binding store. | Focused 93/0; broader routing/control/snapshot 210/0; real wrong-provider control is 409 with zero commands. |
| Mixed lifetime/daily guard | `5881820` | `2c20737` | Defeating the mixed-shape guard let a lifetime and daily identity aggregate together. | Both input orders fail closed; live gate remains non-vacuous. |
| Provider collision hardening | `0b4d838` | `59b532f` | A stale/process-live other-provider claimant was ignored; a defeat authorized a dual-qualified surface. | Focused 159/0, 458 assertions; broader 210/0; all claimants are indexed once and ambiguity refuses writes. |
| Failed-publication barrier | `8189719` | `dcac0ab` | During a blocked archive write, control and broadcast returned 200 and emitted four stale `SURFACE-OLD` input RPCs. | Focused state/debug 22/0; relevant control/broadcast/direct-link 194/0; the pane remains visible as non-authoritative evidence with empty claims and a stale trace. |
| Invalidated-route barrier | `2afd56e` | `dd57d50` | A-to-B, failed-watchdog, and source-only barriers each returned control/broadcast 200 and emitted four stale `SURFACE-OLD` RPCs. | Focused state 18/0, 113 assertions; invariant bundle 197/0, 618 assertions; two independent defeat mutations reopen only their intended seam. |

The final state repair synchronously publishes an observed-only targeted
quarantine when canonical target, lifecycle, or control authority changes,
before binding and later history/witness/archive awaits. It preserves
`generatedAt`, archive state, A-to-A single-publication behavior, and A-to-B
Focus re-resolution to the new surface or 409.

## Combined exact-head verification

At product/test head `dd57d50`:

- `bun run check`: TypeScript passed, then 3,142 tests passed across 174 files,
  13,605 assertions, 0 failed;
- final state-focused suite: 18 pass, 0 fail, 113 assertions;
- final 16-file control/broadcast/direct-link invariant bundle: 197 pass,
  0 fail, 618 assertions;
- combined routing/control/state review bundle: 258 pass, 0 fail,
  784 assertions across 20 files;
- live OBB gate: 15 pass, 0 fail, 44 assertions, with 7/7 current Codex
  identities joined and zero unknown shapes;
- no web source changed after the browser capture, and the production service
  remained untouched;
- no final suite used skips, todos, `.only`, or test-name filters;
- diff whitespace, credential-shaped additions, worktree fence, and TypeScript
  checks passed in every repair lane.

The integration owner inspected every production diff and the combined exact
head. An independent read-only adversarial review of every changed production
file and added regression returned `NO FINDINGS`. The final branch-level
whitespace, secret, status, listener, and exact-diff checks are rerun after this
audit-only update; the final local commit and those results are reported in the
handoff rather than self-referenced here.

## Read-only lane records

- identity: `/private/tmp/ant-trust-identity-ro/LANE-REPORT-I.md`
- browser: `/private/tmp/ant-trust-browser-ro/LANE-REPORT-B.md`
- measurement: `/private/tmp/ant-trust-measurement-ro/LANE-REPORT-M.md`

The three read-only lane worktrees contain no product or test diffs. No push,
PR, merge, deployment, production restart, live control request, or remote
artifact publication was performed.
