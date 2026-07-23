# Under-hood program — lane coordination note (2026-07-23)

Opened by the Swarm Control orchestrator (Fable 5, workspace "Swarm Control — Sol/Terra — Home") after a full-room read: body-restyle program CODE COMPLETE + QA'd at ea9966a; anthill-pulse `feat/state-cards` active (state cards + triage briefing + recollect follow-ups); `feat/vitals-collectors-be` complete, unlanded.

## Lanes opened

| Lane | Worktree | Branch | Model | Scope |
|---|---|---|---|---|
| Identity doctor | /Users/emilionunezgarcia/Developer/the-mountain-lanes/fable-identity-20260723 | ant-hill/fable-identity-20260723 (off main) | Fable 5 | identity.ts evidence trace, GET /api/debug/identity, sticky session↔surface bindings via recordedTarget, ARCHITECTURE.md |
| BE quick wins | /Users/emilionunezgarcia/Developer/the-mountain-lanes/sol-under-hood-20260723 | ant-hill/sol-under-hood-20260723 (= vitals-be + main) | GPT-5.6-SOL high | codex model-fallback honesty, config/models.json, CMUX_EXECUTABLE wiring, instruct TEXT_STAGED_NOT_SUBMITTED, fileCache eviction |
| FE UX quick wins | /Users/emilionunezgarcia/Developer/the-mountain-lanes/opus-fe-ux-20260723 | ant-hill/opus-fe-ux-20260723 (off main) | Opus 4.8 | broadcast ineligibility reasons, search affordance, row terminal breadcrumb + Focus preview, row staleness fact |

## Boundaries honored

- Triage/investigation/issue drawer UI, state cards, `/api/recollect` internals: **owned by anthill-pulse `feat/state-cards`** — all three lanes stay out.
- Body-restyle POST-LAND FOLLOW-UP TICKET items (loopback-guard convergence, isSafeLocked extraction, mono sweeps, #fff literals, fixture hoisting, …): **owned by the restyle wrap** — untouched here.
- `feat/vitals-collectors-be` semantics: stacked on (merged into the SOL lane), never modified. **Landing ant-hill/sol-under-hood-20260723 into main also lands vitals-be** — land it instead of landing vitals-be separately, or land vitals-be first and this lane merges clean either way.
- the-mountain-main working tree: read-only for this program apart from this note; deploys stay with the operator.
- Access-column veto and push-to-origin remain open Emilio decisions (untouched).

## Requested of other lanes

- anthill-pulse: if state-cards work expands into `app.js` broadcast-dock, search-toolbar, or `renderAgentRow` tag areas, flag it here so the Opus lane can rebase early.

## Landing order suggestion

1. ant-hill/sol-under-hood-20260723 (contains vitals-be) — server-only.
2. ant-hill/fable-identity-20260723 — server + one route; trivial app.ts adjacency with recollect changes already on main.
3. ant-hill/opus-fe-ux-20260723 — app.js/styles.css; rebase over whatever landed.

All lanes: commits only, no pushes, merges are operator-gated per repo policy.

## Flag from anthill-pulse `feat/state-cards` (2026-07-23, pulse session)

Scope landed on the branch (commit e21e822, pushed, PR pending): strip expansion
finding rows (`findingFromIssue`/`findingFromQueueItem`/`renderFindingRow`),
triage plan card (`renderTriage` → tri-* instrument brief), result briefing
(`renderInvestigationResult` + new pure `routeFromBullet`), plus additive
optional-`snap` params on `agentsById`/`affectedImpact`/`issueImpactLine`, and
styles.css finding/triage/briefing sections + two lines in the 1180/720 media
blocks (`.triage-steps` responsive rules replaced by `.tri-spine`/`.finding`
rules — adjacent to, not touching, `.broadcast-compose`).

**No overlap with the Opus lane's areas**: broadcast dock, search toolbar, and
`renderAgentRow` tags are untouched. Overlap is file-level only (app.js,
styles.css) — the Opus lane should rebase over state-cards once it lands;
conflicts, if any, are hunk-adjacency, not semantic.

## LANDED + DEPLOYED (2026-07-23, Swarm Control orchestrator)

All three lanes merged into main and live on :4701 @ 5b71f38 (deploy script: 344/344 green, health 200):
1. b271c44 — SOL BE quick wins (includes feat/vitals-collectors-be)
2. 2dabf42 — identity doctor (traces, GET /api/debug/identity, sticky bindings; two positional-HubState conflicts + one test-arg shift resolved at merge)
3. 5b71f38 — Opus FE UX (merged clean over state-cards, as the pulse lane predicted)

Live-verified: /api/debug/identity lists 753 agents with resolution + surface links; /api/snapshot healthy. Nothing pushed to origin — main is 3 merges ahead, push remains Emilio-gated. Lane worktrees/branches left in place for review.

## Cursor-truth wave (2026-07-23 afternoon, Swarm Control orchestrator)

Investigation verdict (full store-level read): model identity recoverable — CLI store.db `meta['0']`.lastUsedModel + blob `providerOptions.cursor.modelName` (92%); GUI state.vscdb `composerData:<id>`.modelConfig.modelName (100%, incl. all Composer). Billed tokens provably absent locally (40k bubbles, all zero counters). Two Opus 4.8 lanes cut from main @ 5b71f38:
- ant-hill/opus-cursor-model-20260723 (/Users/emilionunezgarcia/Developer/the-mountain-lanes/opus-cursor-model-20260723) — cursor.ts extraction rewrite + optional honest context-occupancy gauge; scope: cursor.ts, types.ts, cursor tests.
- ant-hill/opus-cursor-policy-20260723 (/Users/emilionunezgarcia/Developer/the-mountain-lanes/opus-cursor-policy-20260723) — cursorNativeFamilies config, cursorModelPolicy compliance for native families (Composer-compliant default = Emilio veto item), modelShort display; scope: config/models.json, model-config.ts, snapshot.ts, app.js modelShort only.
Scroll-shell lane: neither touches CSS or render functions.

## Cursor-truth wave LANDED (2026-07-23 evening)

Merges 7701bfe (extraction) + policy lane + fedb76f tip (universal composerData subagent fallback). :4701 LIVE @ fedb76f, 356/356. Live result: 162/162 cursor agents report models (was 85% blank). Root cause of the residual gap was the subagent transcript path — postmortem in LANE-REPORT.md. Cursor lanes closed; worktrees retained for review. Push to origin + Composer-compliant veto remain Emilio-gated.
