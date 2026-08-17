/* The Ant Hill v3 — operator console client.
   Consumes GET /api/snapshot + SSE /api/events, sends POST /api/control.
   No frameworks. All dynamic content is built via DOM APIs (no innerHTML with data).
   Pure helpers are exposed on globalThis.TheAntHill so tests can import this
   file directly; DOM wiring only runs when a document exists. */

import { $, contextPressureOf, el, icon, SVGNS, svgChild, svgGauge, svgMeter, svgSegmentMeter, svgSparkline, svgTitle } from "./dom-primitives.js";
import { agoText, fmtCompactAge, fmtElapsed, fmtTok, fmtWorkingDuration, modelShort, providerLabel, ROW_TIME_VERBS, rowTimeVerb } from "./text-formatters.js";
import { rowTimeBand } from "./row-time-band.js";
import { state, paintedEntityKey } from "./client-state.js";
import { setRepaint } from "./repaint.js";
import { tldrMarkupNodes } from "./tldr-markup.js";
import {
  clocksFrozen,
  feedAlarm,
  feedFrozen,
  snapshotFreshness,
  SNAPSHOT_FRESH_MS,
  SNAPSHOT_STALE_MS,
} from "./feed-freshness.js";
import {
  ACTION_KIND_LABELS,
  loadActions,
  normalizeActions,
  refreshActions,
} from "./action-log.js";
import {
  chatFeedStateNode,
  loadTranscript,
  normalizeTranscript,
  renderTranscriptFeedLead,
  isGrokBotAgent,
  shouldRefreshHeldTranscript,
  thoughtGroupNode,
  thoughtText,
  toolActivityNode,
  transcriptLineNode,
  transcriptThreadStamp,
  transcriptWindow,
  TRANSCRIPT_RENDER_CAP,
} from "./transcript.js";
import {
  applyNotifications,
  deliverNotification,
  loadNotifyPreference,
  needsHumanIds,
  notificationPlan,
  notifyToggleView,
  renderNotifyToggle,
  titleWithAlerts,
  toggleNotifications,
} from "./notifications.js";

/* The attention surface. Its derivation is a module of its own so the big new
   panel stays out of this contended file; what lands here is the wiring it
   cannot do for itself — the two resolvers that live in app.js, one render call,
   and one boot listener. */
import {
  attentionClassOf,
  blockingAgentIds,
  blockingCount,
  feedTone,
  hasCurrentImpact,
  notificationCandidates,
  notificationFeed,
  notificationPanelModel,
} from "./notification-center.js";

import {
  actionOutcomeView,
  agentLabelEligible,
  agentLabelTarget,
  agentName,
  operatorName,
  collisionLine,
  conciseText,
  controlUnavailableText,
  elapsedDataset,
  focusDestinationHint,
  focusButtonLabel,
  identityTraceView,
  investigationView,
  issueLifecycle,
  issueLifecycleNote,
  issueTimestamp,
  issuesOf,
  lastActionFor,
  liveElapsedMs,
  liveElapsedText,
  operatorReason,
  preferredRenameTarget,
  presentationLabelKey,
  provenanceLabel,
  quarantineBrief,
  recentlyResolvedOf,
  roleView,
  roleSourceView,
  parseSenderHeader,
  senderOf,
  senderClaimText,
  withoutSenderHeader,
  specialtyLabel,
  roomLabelTarget,
  snapshotAgents,
  sourceAgentName,
  staleControlNote,
  surfaceCollisions,
  terminalBreadcrumb,
  terminalIdentity,
  terminalSourceName,
  stripSpinnerFrame,
  workspaceLabelTarget,
  agentsById,
  IDENTITY_TIER_LABELS,
  INVESTIGATION_STATE_VIEW,
  ROLE_LABELS,
} from "./presentation.js";

import {
  actionsFailureText,
  actionsUrl,
  ACTIONS_DEFAULT_LIMIT,
  ACTIONS_MAX_LIMIT,
  apiFetch,
  API_READ_TIMEOUT_MS,
  API_TRANSCRIPT_TIMEOUT_MS,
  API_WRITE_TIMEOUT_MS,
  clampActionsLimit,
  clampTranscriptLimit,
  controlOutcome,
  nextTranscriptLimit,
  readEndpointOriginNote,
  serverUnreachableHint,
  transcriptFailureText,
  transcriptUrl,
  TRANSCRIPT_DEFAULT_LIMIT,
  TRANSCRIPT_LIMIT_STEPS,
  TRANSCRIPT_MAX_LIMIT,
} from "./api-client.js";
/* The Cleaner's whole derivation. app.js keeps the fetch and the paint; which
   state the chip is in is decided in cleaner.js against the live session. */
/* The previous derived state, so the landing beat can fire on the transition
   rather than on a clock. Module-scoped: it describes this board's last paint,
   not any one render call. */
let cleanerLastState = "idle";
import {
  cleanerFromResponse,
  cleanerLands,
  cleanerView,
  cleanupCounts,
  countsSentence,
  CLEANER_IN_FLIGHT,
  CLEANER_LABELS,
} from "./cleaner.js";
import {
  alerting,
  alertFirst,
  alertRecent,
  buildClusters,
  contextUsage,
  deriveActivity,
  deriveControlState,
  deriveOutcome,
  deriveRollup,
  isLive,
  isStalled,
  operatorState,
  stallThresholdMs,
  DEFAULT_STALL_THRESHOLD_MS,
  isReviewWorker,
  sessionKindOf,
  agentClassOf,
  isTerminal,
  isUnverified,
  lifecycleOf,
  lifecycleSection,
  LIFECYCLE_SECTIONS,
  provenanceOf,
  scopeOf,
  wantsHuman,
  declaredQuiet,
  declaredDone,
  LIVENESS_ENDED_UNKNOWN,
  LIVENESS_VIEW,
  LIVENESS_WORDS,
  livenessState,
  livenessView,
  lookbackApplies,
  parseLookbackHours,
  passesLookback,
  programRollup,
  tokenSummary,
  viewMatches,
  withinLookback,
} from "./agent-model.js";
import {
  ACTION_LABELS,
  ACTIVITY_LABELS,
  CONTROL_LABELS,
  DEFAULT_LOOKBACK_HOURS,
  DEFAULT_WIDGET_IDS,
  LEGACY_VIEW_ALIASES,
  LOOKBACK_DAY_PRESETS,
  LOOKBACK_HOUR_PRESETS,
  CONTEXT_SPREAD_KEY,
  LOOKBACK_STORAGE_KEY,
  NEEDS_YOU_DISPLAY_KEY,
  OPS_VIEWS,
  OPERATOR_STATE_LABELS,
  OUTCOME_LABELS,
  RETIRED_WIDGET_IDS,
  ROSTER_ROLE_ORDER,
  USAGE_RANGE_PRESETS,
  VIEWS,
  WIDGET_CATALOG,
  WIDGET_IDS,
  WIDGET_STORAGE_KEY,
  TLDR_VIEW_KEY,
  HEADER_COLLAPSED_STORAGE_KEY,
} from "./client-catalogs.js";
import {
  SETTINGS_PRESETS,
  settingsPreview,
  settingsPreviewText,
  renderSettingsPanel as paintSettingsForm,
  openSettingsPanel,
  closeSettingsPanel,
  requestCloseSettingsPanel,
  paintSettingsToggle,
  bindSettingsPanel,
} from "./settings-panel.js";

export { SETTINGS_PRESETS, settingsPreview, settingsPreviewText };

"use strict";

bindSettingsPanel({
  paintUnchanged,
  postSettings,
  setNeedsYouDisplay,
  fetchRepoColors,
  fetchTeamColors,
  paintRepoColorSettings,
  paintTeamColorSettings,
  render,
});

/* ---------- watch-only row mark ----------

   The Access column was dropped in 9d79c76 (instrument cluster) and left no
   sighted equivalent: control state survived only in the row aria-label, so an
   operator could not see which rows are watch-only without opening a drawer.
   This restores it as a compact mark plus a title/aria sentence, never a column.

   A dot on EVERY row carries no information. Observed-only is the common
   case (Grok Build, no cmux surface) and Send already stays disabled —
   painting a hollow ring restates the drawer. Quarantine is the remaining
   mark: a real, fixable identity conflict. */
/* D5. The hint is the SERVER's sentence when there is one. The generic line
   below is a guess about which of three different situations this is, and on the
   live board it guessed wrong on nearly every row: "Conflicting identity
   evidence" was shown over Grok chats sharing a host and over sessions sharing a
   folder, neither of which is conflicting evidence about anything. It stays as
   the fallback for a quarantine the server did not explain, because a row with a
   red mark and no words is worse than an imprecise sentence. */
function watchOnlyMark(control, agent) {
  if (control === "quarantined") {
    const reason = operatorReason(agent);
    return { key: "quarantined", label: "Controls quarantined", hint: reason || CONTROL_HINTS.quarantined };
  }
  return null;
}
const CONTROL_HINTS = {
  linked: "This session is linked to an exact cmux target; controls route safely.",
  "observed-only": "This session is visible but has no safe control route; controls stay disabled.",
  quarantined: "Conflicting identity evidence — controls are quarantined until the target is unambiguous.",
};

/* Plain-language glossary. dtdd() looks up a row's term here and, when found,
   renders it with a dotted underline + explainer tooltip (hover or keyboard
   focus). Learn-style one-liners stay contextual — only fields that render. */
const LATEST_CALL_HINT = "Tokens for the latest model call only — not the cumulative session total.";
const SESSION_TOTAL_HINT = "Cumulative tokens for this whole session. Differs from “latest call,” which is only the most recent invocation.";
const GLOSSARY = {
  // Operate
  "running for": "Wall-clock time since this agent started running.",
  "last update": "When this session last reported activity.",
  role: "Operator role assigned to this agent in the swarm (orchestrator, verifier, etc.).",
  model: "The model this agent is currently running on.",
  context: "How big the latest model call is against the model's context window.",
  // Evidence
  "Agent current folder": "The current working directory reported by the provider session.",
  "Agent launch folder": "The working directory recorded by the provider hook when the process launched.",
  "Terminal shell folder": "The current directory reported by terminal discovery.",
  "Target repository": "The resolved repository worktree that owns grouping and repository facts.",
  "session id": "The provider's own ID for this session, prefixed by the provider name.",
  git: "The branch and commit the agent's working copy is on; flags uncommitted changes.",
  "control link": "Which cmux terminal this session is wired to for Focus and Send, and how confidently it was matched.",
  "latest call": LATEST_CALL_HINT,
  "session total": SESSION_TOTAL_HINT,
};

const CONTROL_STATE_TEXT = {
  linked: "Ready",
  // Focus can reach this pane; nothing may be typed into it. "Ready" would have
  // told a screen-reader operator the row accepts input, which it does not.
  unproven: "Look only — session not proven",
  quarantined: "Quarantined",
  "observed-only": "View only",
};

const RESOLUTION_LABELS = { exact: "exact match", "unique-cwd": "matched by folder", ambiguous: "ambiguous", missing: "no link" };


/* At-a-glance rollup cells — the ONE aggregation source shared by the program
   drawer head (programRollupLine) and the left-tree program header
   (programHeadRollup). Counts are always client-derivable, so they always
   render; the token aggregate is omitted honestly when no agent reports a
   session total (never faked). Alert cells flag themselves for ink gating. */
/* `rollup` is the SERVER's figures for this program when it has them.

   Counts stay client-derived on purpose: the rollup's alert cell must agree with
   the Needs-you tab beside it, and that tab is necessarily client-side because it
   depends on the active filters and lookback. Deferring the count to the server
   would re-open exactly the divergence that produced the needsYou mess — one
   surface counting alerting() and its neighbour counting something else. They
   currently agree (measured: 215/215 total, 9/9 working, 0/0 needsYou), and the
   way to keep them agreeing is one derivation, not two that happen to match.

   The TOKEN total is the opposite case. It has no client-side invariant to
   preserve, it is a pure aggregate, and it is under active repair server-side —
   a session reporting 391.4M against a program reporting 1.60B, both wrong. So
   the moment the server ships a token figure in the rollup, this renders that
   instead of summing its own. Until then it sums, and says which quantity it
   summed. */
function programRollupCells(agents, rollup = null, snap = null) {
  const nowMs = snap && Date.parse(snap.generatedAt);
  const r = deriveRollup(
    agents,
    Number.isFinite(nowMs) ? nowMs : Date.now(),
    stallThresholdMs(snap),
  );
  if (snap) r.needsYou = agents.filter((agent) => stripAlerting(agent, snap)).length;
  const cells = [
    /* "230 agents" was 33 live and 197 ended — 5.8x the operational population
       with no ended denominator beside it, which is the needsYou defect in a
       different cell: two populations sharing one word. Both are named when both
       exist; a program with nothing finished still just reads "N agents".
       (Magnitude audit §6.) */
    ...(r.ended > 0 && r.live > 0 && r.live + r.ended === agents.length
      ? [{ value: String(r.live), label: "live" }, { value: String(r.ended), label: "ended" }]
      /* The split must ACCOUNT for everyone. deriveActivity also returns
         "unknown", and naming two cohorts that do not sum to the roster would
         silently drop the third — the same disappearing-population bug wearing
         the fix's clothes. When they do not add up, the total is the only
         claim that is true. */
      : [{ value: String(agents.length), label: agents.length === 1 ? "agent" : "agents" }]),
    /* "1 agent · 1 working" is one fact wearing two cells, and at n=1 the
       operator can see the entire program in the single row beneath it. The
       rule already lives in this function — `0 alerts` is suppressed at zero —
       it was simply never extended to a count that is trivially implied,
       because at 400 agents the case does not arise. (Quiet-board audit §3.)

       Deliberately narrower than the audit's "or when it equals the agent
       count". At n>=2, "2 agents · 2 working" is NOT a restatement: two agents
       could be none working, so the cell carries the fact that all of them are
       live-working, and a collapsed program does not show the rows that would
       say so otherwise. And "1 agent · 0 working" stays, because that cell is
       what proves the client derives this count itself rather than trusting a
       server figure — there is a test pinning exactly that drift. Only the
       tautology goes. */
    ...(agents.length === 1 && r.working === 1
      ? []
      : [{ value: String(r.working), label: "working" }]),
    ...(r.needsYou > 0
      /* Audit §11: "0 alerts" per program is one of three widgets that spent
         pixels asserting nothing needs you. An operator who learns a counter
         always reads 0 stops reading it, which is exactly when it turns 1. */
      ? [{ value: String(r.needsYou), label: r.needsYou === 1 ? "alert" : "alerts", alert: true }]
      : []),
  ];
  /* Server first. Two derivations of one number is the seam that produced every
     token defect on this board; when the wire carries the aggregate, the client
     has no business computing a second opinion about it. */
  const reported = rollup && Number.isFinite(rollup.sessionTokens) ? rollup.sessionTokens : null;
  const withTokens = agents.filter((a) => a.tokens && typeof a.tokens.sessionTotal === "number");
  if (reported != null || withTokens.length) {
    const total = reported != null
      ? reported
      : withTokens.reduce((sum, a) => sum + a.tokens.sessionTotal, 0);
    // key "tokens" lets the header rollup drop this cell first on narrow screens
    // (it is the least critical; the alerts cell is never dropped).
    /* "session tokens", not "tokens". This sums sessionTotal across every agent
       in the program — 35% of it from ended sessions on the live board — while a
       ROW's token cell shows that agent's latest-turn total. Two different
       quantities under one word invite the operator to read the program as the
       sum of its rows, which it is not: measured, 1.58B here against 682k on a
       row. Same vocabulary as the drawer's "used this session".
       (GPT lane day-review 4.5, downgraded to relayed-unverified — verified
       here, and it holds.) */
    /* One agent means no aggregation to explain the gap. This header reads
       "2.2M session tokens" beside its ONLY row reading "826k latest call" —
       thirteen-fold apart, with the whole population visible. At 400 agents
       "the header sums many rows" is at least an available explanation; at n=1
       there is nothing between the two numbers and the operator cannot
       reconcile them. The row already carries the figure, in the more honest
       unit, so the header stops competing with it. (Quiet-board audit §1.) */
    if (agents.length > 1) cells.push({ value: fmtTok(total), label: "session tokens", key: "tokens" });
  }
  return cells;
}


/* ---------- identity resolution: why a session is quarantined ----------
   The server ships `identityTrace` on every agent in the snapshot (it is only
   stripped from the SSE change-fingerprint, never from the payload), plus a
   read-only GET /api/debug/identity?agent=<id> that joins that trace to the
   ps/lsof evidence of every related terminal. Both were being discarded by the
   renderer, so the one failure mode that disables Focus and Send at scale
   surfaced as a fixed sentence with no reason and no way forward. */






const NO_READABLE_MESSAGE = "No readable message yet";

function formatLastHumanMessage(agent, limit = 120) {
  /* Without the envelope. A row gets ~120 characters and
     `[from claude:8c052fe9-… run agent-atlas-2026-08-05]` is 74 of them, so
     every lane in a swarm was spending more than half its line on machine
     addressing — and saying nothing an operator reads a row for. Who sent it is
     still shown, in the drawer, where there is room to name them. */
  const raw = typeof agent?.lastHumanMessage === "string" ? agent.lastHumanMessage : "";
  const message = withoutSenderHeader(raw).trim();
  return message ? conciseText(message, limit) : NO_READABLE_MESSAGE;
}




const programLabelTarget = (program) => ({ kind: "program", programId: program.id });

/* ---------- disambiguating identical rows ----------

   A live board carried 56 rows all reading "Claude · the-mountain-main": same
   provider, same working directory, several on the same model, nothing on the
   row to tell one from another. The name is genuinely not unique — one folder
   can hold any number of concurrent sessions — so no naming rule fixes this.
   The session id IS unique, and it is what the drawer, Evidence and every
   copy-id button already speak, so a short form of it is the disambiguator.

   Shown ONLY on rows whose name repeats: a hash on every row would be noise on
   a board where most names are already distinct. */
function sessionTag(agent) {
  if (!agent) return "";
  const raw = agent.sourceSessionId || String(agent.id || "").split(":").slice(1).join(":") || "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  /* The TAIL, not the head. Codex issues UUIDv7, whose leading segment is a
     timestamp — every session started in the same minute shares it. Tagging by
     prefix produced "#019fb496" on four different rows and disambiguated
     nothing; on the live board 20 of 27 duplicate-name groups collided that way.
     The trailing segment is the random part, so it is what actually separates
     two sessions. Verified against 213 live agents: no collisions. */
  const segments = trimmed.split("-").filter(Boolean);
  const tail = segments.length ? segments[segments.length - 1] : trimmed;
  return tail.slice(-8);
}

/* Names that appear more than once across the agents given. Built once per
   paint from the whole board, not per program — two twins in different programs
   are exactly as confusing as two in the same one. */
/* The names the landing screen offers for working sessions, at most three.

   NOTHING RENDERS THIS ANY MORE, and that is a result rather than a leak. It
   existed for THE ONE-GLANCE RULE — a working session must be NAMED on the
   landing screen, not merely counted there — which mattered because the board
   landed on the Needs-you tab, and a clear Needs you could hide three running
   sessions behind the number "3 working". Board cannot do that: a working
   session is a row on the view the operator lands on, so the layout keeps the
   rule and the roster it needed has no state left to render over.

   It survives as the executable statement of the rule, which the single-board
   layout has to keep satisfying and which is asserted directly in
   tests/sibling-panes-end-to-end.test.ts. If a future layout ever hides working
   sessions behind a count again, this is what it owes the operator.

   Siblings in one checkout collide here and nowhere else on that screen:
   agentName falls back to provider plus project basename, so two Claude
   sessions in the same directory are both "Claude · shared-checkout". A roster
   that says one name twice finds nobody, which is the incident the roster
   exists to close, wearing a different hat. The row list already solved this
   (see sessionTag); this reuses that answer rather than forking a second
   naming rule. */
function landingRosterNames(working, limit = 3) {
  const shown = (working || []).slice(0, limit);
  const ambiguous = ambiguousNames(working);
  return shown.map((agent) => {
    const name = agentName(agent);
    const tag = ambiguous.has(name) ? sessionTag(agent) : "";
    return tag ? name + " " + tag : name;
  });
}

function ambiguousNames(agents) {
  const seen = new Map();
  for (const agent of agents || []) {
    const name = agentName(agent);
    if (!name) continue;
    seen.set(name, (seen.get(name) || 0) + 1);
  }
  const repeated = new Set();
  for (const [name, count] of seen) if (count > 1) repeated.add(name);
  return repeated;
}

/* The two fleet-wide answers every row needs: who its parent is, and whether
   another session on the board is already using its name. Both are computed
   over the WHOLE snapshot rather than one program — a twin in another program
   is exactly as confusing as a twin in this one, and a swarm can straddle two
   programs — so they are built once per paint and handed down.

   Not memoised on the snapshot: `agentName` reads the operator's alias table,
   so a rename that lands between snapshots has to be visible in the next paint,
   not four seconds later. */
function boardIndex(ui = state) {
  const byId = new Map(snapshotAgents(ui && ui.snap)
    .map(({ agent }) => agent)
    .filter(dashboardVisible)
    .map((agent) => [agent.id, agent]));
  const agents = [...byId.values()];
  return {
    byId,
    ambiguous: ambiguousNames(agents),
    sharedNames: sharedRowNames(agents),
  };
}

/* The name a row actually PRINTS: the operator's label if they typed one, else
   the server's base — `identity.name` with the disambiguator taken back off.
   Kept beside sharedRowNames because the two only mean anything together. */
function rowDisplayName(agent) {
  return operatorName(agent) || (agent.identity && agent.identity.base) || agentName(agent);
}

/* Printed names more than one session on the board is using. Distinct from
   ambiguousNames, which counts the full resolved identity — that one is unique
   by construction for a server-named session, so it can never see the collision
   the operator is looking at. This is the collision on screen. */
function sharedRowNames(agents) {
  const seen = new Map();
  for (const agent of agents || []) {
    const name = rowDisplayName(agent);
    if (!name) continue;
    seen.set(name, (seen.get(name) || 0) + 1);
  }
  const repeated = new Set();
  for (const [name, count] of seen) if (count > 1) repeated.add(name);
  return repeated;
}

/* The disambiguator a surface prints beside a name, or "" for none.

   The server's tag is DURABLE by design: once a session has one it keeps it, so
   its name cannot churn when the twin that earned the tag goes away. That is
   right for `identity.name`, which has to stay unique for search, logs and
   aria — and wrong for the words on screen. Measured on the live board:
   `fe-regroup #8da7e056` was the only session carrying that base anywhere in an
   1186-agent snapshot, so eight characters of hex separated it from nothing.
   The fleet assigns the tag; the VIEW decides whether to print it.

   `collisions` is the pair boardIndex builds. Two questions, because there are
   two kinds of name here: the PRINTED name another session is using
   (sharedNames, which is what the operator is looking at) and the resolved
   identity another session is using (ambiguousNames, which catches archived
   records written before `identity` existed and which the client still has to
   tell apart itself).

   One function rather than one per surface, because "one session, one name" is
   only true if the row and the drawer it opens reach the answer through the
   same code. */
function visibleSessionTag(agent, collisions = {}) {
  const twinned = Boolean(
    (collisions.sharedNames && collisions.sharedNames.has(rowDisplayName(agent)))
    || (collisions.ambiguousNames && collisions.ambiguousNames.has(agentName(agent))),
  );
  if (!twinned) return "";
  /* A name the operator chose is theirs, and the server's hex never rides it —
     the disambiguator goes with the derived name it disambiguates. */
  return (operatorName(agent) ? "" : (agent.identity && agent.identity.disambiguator)) || sessionTag(agent);
}

/* The full name for a surface that prints it as ONE string — the drawer head,
   the swarm anchor, the roster, the lineage spine. The row builds the same two
   parts separately so it can style the hex quietly beside the loud words. */
function displayNameWithTag(agent, collisions) {
  const tag = visibleSessionTag(agent, collisions);
  return rowDisplayName(agent) + (tag ? " #" + tag : "");
}

/* `fallback` is what a program is called in the ONE place its own name would be
   a repetition: a worktree subsection under a repo band, where `program.name`
   is the repository name the band above it already prints. The operator's own
   label still outranks both — renaming a worktree has to mean something. */
function programName(program, fallback = "") {
  const alias = program && state.aliases.get(presentationLabelKey(programLabelTarget(program)));
  return alias || fallback || (program ? program.name : "");
}


function totalsOf(snap) {
  const t = (snap && snap.totals) || {};
  const agents = snapshotAgents(snap).map((x) => x.agent);
  const count = (pred) => agents.filter(pred).length;
  /* Prefer the lifecycle census, which is what the server actually counts now,
     and fall back through the legacy totals to a client recount. The fallback
     re-derives from `lifecycleOf`, not `deriveActivity`, so a recount cannot
     produce a different answer from the one the tabs are showing. */
  const byLifecycle = t.byLifecycle || {};
  return {
    working: byLifecycle.working ?? t.working ?? count((a) => lifecycleOf(a) === "working" && scopeOf(a) === "observed"),
    idle: byLifecycle.waiting ?? t.idle ?? count((a) => lifecycleOf(a) === "waiting" && scopeOf(a) === "observed"),
    unverified: byLifecycle.unverified ?? count(isUnverified),
    history: t.history ?? count(isTerminal),
    retained: t.retained ?? count((a) => scopeOf(a) === "retained"),
    /* Wrap the predicate: Array#filter would pass the index as nowMs and
       treat every waiting row as years past the stall threshold. */
    live: t.live ?? count((a) => isLive(a)),
    tracked: t.tracked ?? agents.length,
    tokens: t.tokens,
    tokenMedian: t.tokenMedian,
    tokenReporting: t.tokenReporting,
    tokenEligible: t.tokenEligible,
    sourceHealth: t.sourceHealth,
  };
}


/* ---------- views, search, facets ---------- */

const ROW_STALE_AFTER_MS = 10 * 60_000;
/* A running / waiting row whose last update is older than 10 minutes earns a
   dim "updated Nm ago" fact — a quiet nudge that a live-looking session has gone
   quiet. Fresh rows and ended rows return "" and render exactly as before.
   nowMs is injectable so the threshold is testable without wall-clock flake. */
function rowStalenessText(agent, nowMs = Date.now()) {
  const act = deriveActivity(agent);
  if (act !== "working" && act !== "idle") return "";
  const updated = Date.parse(agent && agent.updatedAt);
  if (!Number.isFinite(updated)) return "";
  const ageMs = nowMs - updated;
  if (ageMs < ROW_STALE_AFTER_MS) return "";
  return "updated " + fmtElapsed(ageMs) + " ago";
}

/* The Board's fifth column answers the question the operator is actually
   asking on a live lens — "how long has this been quiet" — not "how old is
   this session". Blank when fresh: fresh needs no number. */
function rowQuietText(agent, nowMs = Date.now()) {
  const m = /^updated (.+) ago$/.exec(rowStalenessText(agent, nowMs));
  return m ? m[1] : "";
}

function lookbackLabel(hours) {
  if (hours == null) return "all collected";
  return hours + "h";
}

function matchesQuery(agent, program, query) {
  if (!query) return true;
  const hay = [
    /* The name ON THE ROW, first. Search matched `displayName` only, which
       after the naming contract is no longer what the operator is reading —
       typing the name you can see returned nothing whenever the two differed,
       which is precisely the authored-name case the contract exists to fix.
       `displayName` stays in the list so the old string is still findable. */
    agentName(agent),
    agent.displayName, agent.nickname, agent.task, agent.cwd, agent.model,
    agent.provider, agent.role, agent.sourceSessionId, agent.statusReason,
    agent.transcriptTail, agent.status,
    ACTIVITY_LABELS[deriveActivity(agent)], OUTCOME_LABELS[deriveOutcome(agent)],
    program && program.name, program && programName(program),
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(query);
}

const CONTEXT_DISPLAY_LABELS = { percent: "Context %", tokens: "Context tokens" };

function contextDisplayLabel() {
  return CONTEXT_DISPLAY_LABELS[state.contextDisplay] || CONTEXT_DISPLAY_LABELS.percent;
}

// Claude transcripts carry observed token totals but no context-window size, so
// a truthful "% used" is impossible (a fabricated denominator would misreport
// 1M-context sessions ~5x). When the window is unknown but we have an observed
// total, show the absolute token count instead of "not reported".
function hasObservedTotal(tokens) {
  return Boolean(tokens && Number.isFinite(tokens.total) && tokens.total > 0);
}

function contextDisplayValue(tokens, display = state.contextDisplay) {
  const usage = contextUsage(tokens);
  if (usage) {
    /* A non-null usage no longer implies a token TOTAL: Cursor reports how full
       the window is and never how many tokens are in it, and those rows still
       carry a contextWindow stamped from the model. fmtTok ends in String(n), so
       the tokens toggle printed a literal "undefined / 500k" — into this cell's
       aria-label and the row's, reaching a screen-reader user whichever way the
       toggle is set. The percent is the only reading such a row has. */
    return display === "tokens" && Number.isFinite(tokens.total)
      ? fmtTok(tokens.total) + " / " + fmtTok(tokens.contextWindow)
      : usage.pct + "%";
  }
  if (hasObservedTotal(tokens)) return fmtTok(tokens.total) + " tokens";
  return "not reported";
}



function typicalRequestOf(snap) {
  if (!snap) return null;
  const t = snap.totals || {};
  if (t.tokenMedian != null) return { value: t.tokenMedian, source: "reported" };
  const totals = snapshotAgents(snap)
    .map(({ agent }) => agent)
    .filter((a) => deriveActivity(a) !== "ended" && a.tokens &&
      a.tokens.scope === "latest-turn" && a.tokens.total != null)
    .map((a) => a.tokens.total)
    .sort((x, y) => x - y);
  if (!totals.length) return null;
  const mid = Math.floor(totals.length / 2);
  const value = totals.length % 2 ? totals[mid] : Math.round((totals[mid - 1] + totals[mid]) / 2);
  return { value, source: "derived" };
}

/* ---------- shared elapsed-clock helpers ---------- */



/* ---------- summary widgets ---------- */

function defaultWidgetIds() {
  return [...DEFAULT_WIDGET_IDS];
}

/* A retired id is a MIGRATION, not corruption.

   This used to demand `ids[0] === "needs-you"` — Findings was pinned first and
   required — and returned the defaults for anything else. With that card gone,
   both halves would be wrong: the pin names a widget that no longer exists, and
   resetting on an unknown id would throw away the operator's whole ordering
   because one entry in it was retired. Drop the retired entries, keep the rest
   in the order they chose, and fall back to defaults only when nothing
   recognisable survives. Genuine corruption — not an array, a non-string, a
   duplicate, an id that was never real — still resets, because that is not a
   preference to preserve. */
function normalizeWidgetIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return defaultWidgetIds();
  const unique = new Set(ids);
  if (unique.size !== ids.length || ids.some((id) => typeof id !== "string")) return defaultWidgetIds();
  const kept = ids.filter((id) => !RETIRED_WIDGET_IDS.includes(id));
  if (!kept.length || kept.some((id) => !WIDGET_IDS.has(id))) return defaultWidgetIds();
  return kept;
}

function parseWidgetPreference(raw) {
  if (typeof raw !== "string" || !raw) return defaultWidgetIds();
  try { return normalizeWidgetIds(JSON.parse(raw)); } catch { return defaultWidgetIds(); }
}

/* Every widget is movable now, first slot included. The `index <= 0` and
   `target <= 0` guards existed to hold the required Findings card at the top;
   with it retired nothing is pinned, and leaving them would silently freeze
   whichever widget happened to land first. */
function reorderWidgetIds(ids, id, direction) {
  const ordered = normalizeWidgetIds(ids);
  const index = ordered.indexOf(id);
  const target = index + direction;
  if (index < 0 || !Number.isInteger(direction) || target < 0 || target >= ordered.length) return ordered;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return ordered;
}

/* D4. Readings is a verdict about INSTRUMENTS — collectors, the control plane,
   the snapshot feed — and identity routing is none of those.

   An identity conflict means Send is off for some rows. It does not mean a
   single number on the board is untrustworthy, which is the only thing this
   chip claims. Folding it in is what made the chip permanently red on Emilio's
   board (collectors 9/9 healthy, /api/health `healthy`, chip "Readings
   degraded") and trained him to stop reading it. Those strings stay findings in
   the notification center, where they have a route and a remedy.

   The three sentences are the server's, verbatim from identity.ts, and this
   list mirrors IDENTITY_CONFLICT_PATTERN in snapshot-operator-issues.ts — the
   client cannot import a server module, so the duplication is the seam. The two
   shared-host/two-owner reasons are matched defensively: the shared-host lane
   does not push them into `errors`, and if a later change did, this chip must
   not be how we find out. Match on the SENTENCE, not on a substring like
   "conflict" — a collector fault that happens to use the word is a real
   instrument failure and must still degrade. */
const IDENTITY_ROUTING_ERROR = /conflicting open agent session files|refused command identity:|conflicting recognized agent commands|share this terminal; Send stays off/i;

function instrumentErrors(control) {
  const errors = (control && control.errors) || [];
  return errors.filter((error) => !IDENTITY_ROUTING_ERROR.test(String(error)));
}

function systemStatus(snap, conn = "live", fetchFailed = state.fetchFailed) {
  if (!snap || conn === "offline") return { key: "offline", label: "Offline", tone: "offline" };
  const control = snap.controlHealth;
  const source = snap.totals && snap.totals.sourceHealth;
  const sourceDegraded = source && source.total > 0 && (source.degraded > 0 || source.healthy < source.total);
  const controlDegraded = !control || control.cmuxReachable !== true || instrumentErrors(control).length > 0 || control.staleSources?.length > 0;
  const feedDegraded = conn !== "live";
  // A snapshot poll that failed while a snapshot is already on screen used to be
  // swallowed into a console.warn and a flag nobody read, leaving stale numbers
  // looking authoritative. Degrade the verdict so the Refresh affordance appears.
  if (sourceDegraded || controlDegraded || feedDegraded || fetchFailed) return { key: "degraded", label: "Degraded", tone: "degraded" };
  return { key: "operational", label: "Operational", tone: "ok" };
}

/* "Degraded" answers WHETHER something is wrong and never the only question an
   operator actually has: am I blocked, or is this cosmetic? Those are wildly
   different — cmux unreachable means Focus and Send are dead and no amount of
   waiting helps, while 15 identity-conflict warnings mean the board is fully
   usable and someone should tidy up later. Both rendered the same word.

   Three classes, most severe first. Returns null when nothing is wrong, so the
   Operational card is untouched. */
const DEGRADED_SEVERITY = {
  blocking: { key: "blocking", label: "Blocking", detail: "Operator actions are unavailable." },
  stale: { key: "stale", label: "Stale", detail: "Numbers on screen may no longer be true." },
  /* DESCRIBES THE STATE, never a remedy. It used to read "evidence needs
     tidying", which asserts a fix — and on a live board whose actual fault was
     `cursor GUI conversations: unable to open database file`, tidying fixes
     nothing. A surface stating a conclusion its evidence does not support is the
     defect class this whole program removes; a severity label is the last place
     it should reappear, because it qualifies every reading beside it.

     The other six strings in this function were checked for the same mistake and
     are clean: they each name a condition ("Operator actions are unavailable",
     "showing the previous good snapshot") or a condition and its consequence
     ("cmux unreachable — Focus and Send cannot route"). None prescribes. */
  advisory: { key: "advisory", label: "Advisory", detail: "The board is usable; some evidence is incomplete." },
};

function degradedSeverity(snap, conn = "live", fetchFailed = state.fetchFailed) {
  if (systemStatus(snap, conn, fetchFailed).key === "operational") return null;
  const control = snap && snap.controlHealth;
  // Blocking: the control plane is gone, so Focus/Send cannot route at all.
  // This is the one state where waiting does not help.
  if (!snap || conn === "offline" || !control || control.cmuxReachable !== true) {
    return { ...DEGRADED_SEVERITY.blocking, detail: !snap || conn === "offline"
      ? "No snapshot connection — the board is not live."
      : "cmux unreachable — Focus and Send cannot route." };
  }
  // Stale: controls work, but the numbers being read may be out of date. Wrong
  // data an operator trusts is worse than data it knows to distrust.
  if (conn !== "live" || fetchFailed) {
    return { ...DEGRADED_SEVERITY.stale, detail: fetchFailed
      ? "Last refresh failed — showing the previous good snapshot."
      : "Live snapshot feed is not healthy." };
  }
  // Advisory: everything an operator does still works.
  return DEGRADED_SEVERITY.advisory;
}

function attentionSummary(snap) {
  if (!snap) return null;
  const findings = issuesOf(snap);
  return {
    count: findings.length,
    interventions: findings.filter((issue) => issue.severity === "error").length,
    advisories: findings.filter((issue) => issue.severity !== "error").length,
  };
}

/* The named reason behind a Degraded verdict: the most severe live finding, so
   the summary can say what is wrong (not just that something is) beside the
   verdict and its refresh action. Null when nothing is reported. */
function topSourceIssue(snap) {
  const findings = issuesOf(snap);
  if (!findings.length) return null;
  return findings.find((issue) => issue.severity === "error") || findings[0];
}

/* The third question the card never answered: what do I do about it?

   "CMUX identity conflicts" names a symptom in the collector's vocabulary and
   leaves the operator with nowhere to go. This turns the top finding into a
   consequence an operator recognises and an instruction they can carry out.

   CONTRACT WITH THE BACKEND LANE — when an OperatorIssue carries `remedy`, its
   wording wins and is rendered verbatim, so severity and phrasing stay owned by
   the lane reclassifying them:

     remedy?: { instruction: string; problem?: string }

   Until that field lands this derives both from evidence already in the
   snapshot, so the card is useful today and defers the moment it arrives.

   The derivation is deliberately narrow. It sizes the alarm by the sessions an
   operator genuinely cannot drive — live AND quarantined — not by every session
   the issue touches. Today's identity-conflict row implicates 37 sessions, but
   26 of them have already ended; counting all 37 is what made a tidy-up read
   like an outage. An instruction is only asserted for issues whose remedy is
   actually derivable; anything else falls back to the issue's own summary
   rather than inventing a next step. */
function healthRemedy(snap) {
  const control = (snap && snap.controlHealth) || null;
  const debris = (control && control.debris) || null;
  const issue = topSourceIssue(snap);
  if (!issue && !(debris && debris.count)) return null;
  const entries = snapshotAgents(snap);

  /* Which panes, in the operator's terms. The backend names the surfaces; this
     maps them back to the sessions that opened them so the list reads as pane
     titles rather than UUIDs. One pane can hold several ended sessions, so it
     is collapsed to one row — the operator closes panes, not sessions. */
  const debrisIds = new Set((debris && debris.surfaceIds) || []);
  const byPane = new Map();
  for (const { agent } of entries) {
    const surfaceId = agent.target && agent.target.surfaceId;
    const claimed = surfaceId && debrisIds.has(surfaceId);
    if (!claimed) continue;
    const existing = byPane.get(surfaceId);
    if (!existing || (agent.updatedAt || "") > (existing.updatedAt || "")) {
      byPane.set(surfaceId, {
        /* The pane's own title still wins — this row names a TERMINAL the
           operator is about to close, not the session inside it. Only the
           fallback changes, from the derived string to the resolved name. */
        name: (agent.target && agent.target.workspaceTitle) || agentName(agent) || surfaceId,
        updatedAt: agent.updatedAt,
      });
    }
  }
  let panes = [...byPane.values()];
  /* Before the split lands, or when a surface names no session we can resolve,
     fall back to the ended sessions the issue itself implicates. */
  if (!panes.length && issue) {
    const affected = new Set(issue.affectedAgentIds || []);
    panes = entries
      .filter((entry) => affected.has(entry.agent.id) && entry.agent.activity === "ended")
      /* Ended sessions are the worst case for the derived name: they are the
         population most likely to share one, so a list of them read as the same
         row repeated. */
      .map((entry) => ({ name: agentName(entry.agent) || entry.agent.id, updatedAt: entry.agent.updatedAt }));
  }

  const blocked = issue
    ? entries.filter((entry) => new Set(issue.affectedAgentIds || []).has(entry.agent.id)
      && entry.agent.controlState === "quarantined" && entry.agent.activity !== "ended").length
    : 0;

  return {
    // Nothing live is wrong when only debris remains, so this stays empty and
    // the card keeps its all-clear headline rather than inventing a complaint.
    problem: issue
      ? (blocked
        ? `${blocked} live session${blocked === 1 ? "" : "s"} can't take commands.`
        : issue.summary)
      : "",
    /* The instruction must answer the problem actually stated. The debris
       remedy says, in its own words, "this is tidying, not a fault" — printing
       it under "3 live sessions can't take commands" offers a fix for a
       different problem and reads as a contradiction. So it is reserved for the
       case where debris IS the complaint; a live fault uses its own remedy, or
       the summary the backend wrote for it, which carries the fix in prose.
       Either way the wording is the backend's, never paraphrased. */
    instruction: issue
      ? (issue.remedy || (blocked && issue.summary ? issue.summary : ""))
      : (debris && debris.remedy) || "",
    paneCount: (debris && debris.count) || panes.length,
    blockedCount: blocked,
    // The pane list is evidence for the tidy-up instruction. Offering it beside
    // a live fault points the operator at panes that would not unblock anything.
    panes: issue ? [] : panes,
    tidy: !issue,
  };
}

/* Local to the health card: the pane list is a disclosure on this cell, not
   board state, so it stays out of the shared client-state module another lane
   owns. */
let healthPanesOpen = false;

function toggleHealthPanes() {
  healthPanesOpen = !healthPanesOpen;
  renderHealthRail();
}

/* "Since when" for a Degraded verdict: the most recent moment a currently-degraded
   source was last healthy, as a relative suffix (" · last healthy 12m ago"). Reuses
   agoText. A source that has never been healthy (lastHealthyAt null) contributes
   nothing — claiming "never seen healthy" would be a lie — so an all-null or
   sourceless snapshot yields no suffix at all. */
function degradedSinceText(snap) {
  const byProvider = snap && snap.totals && snap.totals.sourceHealth && snap.totals.sourceHealth.byProvider;
  if (!byProvider) return "";
  let latest = null;
  for (const health of Object.values(byProvider)) {
    if (!health || health.healthy !== false || !health.lastHealthyAt) continue;
    const t = Date.parse(health.lastHealthyAt);
    if (Number.isNaN(t)) continue;
    if (latest === null || t > latest) latest = t;
  }
  if (latest === null) return "";
  return " · last healthy " + agoText(new Date(latest).toISOString());
}

function noDataWidget(sublabel) {
  return { value: "No data", unit: "", sublabel, tone: "missing" };
}

/* How long the completion tracker has ACTUALLY watched. A freshly restarted
   tracker must never let a partial window read as a full one: the MOMENTUM card
   carried this qualifier from the start, and the collapsed calm line dropped it
   and hard-coded "this hour". That did not merely lose a caveat — it upgraded a
   partial observation into a stronger claim than the data supports, which is
   exactly what an orchestrator extrapolating a rate would be misled by. Measured
   on the live board: observedWindowMs was 300000, five minutes, printed as an
   hour. One derivation now, shared by both surfaces. */
function completionWindowText(momentum) {
  if (!momentum) return "";
  const done = momentum.completionsLastHour;
  /* Null is the server declining to guess, not a zero. It counted `working ->
     idle` edges, which is "stopped writing for three minutes" — the audit's
     worst number, whose true value could be 0 while it rendered 17. Say nothing
     rather than print "↑null done". */
  if (done == null) return "";
  if (!(momentum.observedWindowMs > 0)) {
    /* A restarted tracker knows a COUNT before it has a window to rate it over.
       Saying "No completion data yet" while completionsLastHour is 2 states
       something false in the name of honesty — the honest sentence is what is
       known plus what is not. (GPT day review 3.1.) */
    return done > 0 ? "↑" + done + " done · rate window not established" : "";
  }
  const full = momentum.observedWindowMs >= 3_600_000;
  return "↑" + done + " done "
    + (full ? "this hour" : "in " + fmtElapsed(momentum.observedWindowMs) + " observed");
}

/* WHICH sources are down, by name, from the per-provider map the wire already
   carries. A count answers "how many" and the operator's question is "which one",
   because the answer decides whether the sessions they are watching are the ones
   that went missing.

   Degrades to the count when byProvider is absent rather than asserting names it
   does not have — an older snapshot ships the tallies without the breakdown. */
function degradedSourceNames(source) {
  const n = source.degraded;
  const count = `${n} degraded source${n === 1 ? "" : "s"}`;
  const by = source && source.byProvider;
  const down = by ? Object.keys(by).filter((p) => by[p] && by[p].healthy === false) : [];
  if (!down.length) return count;
  const names = down.map(providerLabel);
  const listed = names.length === 1
    ? names[0]
    : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  /* Name first, count second. The count is what web-client.test.ts pins as this
     line's contract and it is genuinely worth keeping — "how many" and "which"
     are different questions and the operator asks both. Leading with the name is
     what was missing. */
  return `${listed} · ${count}`;
}

function summaryWidgetData(id, snap, conn = "live", display = "percent", queueItems = state.queueItems, fetchFailed = state.fetchFailed, queueError = state.queueError) {
  if (id === "health") {
    // Merged system + source-health + routing-health verdict. OK renders as a
    // trailing micro-chip; degraded promotes to a full cell with its reason.
    const status = systemStatus(snap, conn, fetchFailed);
    const control = snap && snap.controlHealth;
    const source = snap && snap.totals && snap.totals.sourceHealth;
    const stale = (control && control.staleSources && control.staleSources.length) || 0;
    /* The same subset systemStatus judges on. Reading the raw list here would
       let the card blame an identity conflict for a degradation it did not
       cause — the chip would go amber for a stale collector and then quote
       "cmux … has conflicting open agent session files" as the reason. */
    const instrumentFaults = instrumentErrors(control);
    const errors = instrumentFaults.length;
    /* The card used to headline the bare word "Degraded" for all three
       severities, then contradict itself one line down with an ADVISORY badge
       and the sentence "the board is usable" — an advisory shouting in the same
       amber as an unreachable control plane. The headline IS the severity now,
       so the two cannot disagree, and `advisory` gets its own tone so the strip
       can render it at the weight it deserves. */
    const severity = status.key === "degraded" ? degradedSeverity(snap, conn, fetchFailed) : null;
    /* A healthy board has to read as actively clear, not merely silent. "All
       clear" is the operator's word for it; "Operational" described the system
       to itself and left a reader unsure whether the board was fine or just
       not talking. */
    const SEVERITY_HEADLINE = { blocking: "Blocked", stale: "Stale", advisory: "Advisory" };
    /* Computed even when the board is clear. Once the backend moves abandoned
       panes out of `errors` and into `debris`, a tidy-up no longer degrades the
       verdict — but it must still be discoverable, or the cleanup becomes
       invisible the moment it stops being an alarm. */
    const derived = healthRemedy(snap);
    /* Live rows the board can watch but not type into. Counted from the same
       control state the row chip and the drawer banner read, so the card, the
       chip and the banner cannot disagree about which sessions those are. */
    const unaddressable = unaddressableCount(snap);
    /* A blocking fault outranks any tidy-up: telling an operator to close panes
       while Focus and Send cannot route at all points them at the wrong problem.
       But suppressing the wrong instruction must not leave none — a card that
       says the board is Blocked and stops there is the symptom-without-a-remedy
       the whole rewrite exists to remove. These severities are decided here, in
       the client, so their next step is named here too. */
    /* The severity override moved out to instrumentRemedy(), which the
       notification center now renders. Left inline it would have been dead code
       here and a silent regression there: a blocked board would have offered
       "Close 17 cmux panes" — a fix for a different problem — because
       healthRemedy alone cannot know the control plane is down. */
    /* S2-T2. The headline was the SEVERITY word — "Readings healthy", "Blocked",
       "Stale", "Advisory" — which reads as a verdict about the fleet. It is a
       verdict about the INSTRUMENTS, and saying so is the card's whole job: a
       confidence header whose instruments are broken must admit it, or every
       number beside it is unqualified. "Readings degraded" cannot be mistaken
       for "the agents are degraded"; "Stale" could, and did. */
    return {
      value: status.key === "operational" ? "Readings healthy"
        : status.key === "offline" ? "Readings unavailable"
          : "Readings degraded",
      unit: "",
      /* No remedy on the card. It is a qualifier, not a controller: the fix,
         the finding's title and the Refresh control are in the notification
         center, where the fault is an item with a route. A chip that both
         states the instruments are broken AND offers three ways to act is a
         metric again. */
      remedy: null,
      sublabel: !snap
        ? (conn === "offline" ? "Snapshot connection unavailable." : "Waiting for the first snapshot.")
        : status.key === "operational"
          /* "Nothing needs you" is the whole point of the clear state, so it is
             only claimed when it is true. Pending tidy-up says so plainly and
             stays optional — offered, not demanded. */
          /* "controls reachable" is the exact sentence the docs lane had to write
             around. Documenting the fail-closed gate, their guide tells the
             reader twice that the board "looks healthy" and "reads perfectly
             healthy" while Send is greyed out — a document apologising for an
             interface is the interface failing to say something.

             cmux being reachable and a session being addressable are different
             claims. A row matched by folder alone has a reachable control plane
             and still cannot be typed into, so the clear state was asserting a
             capability the operator does not have. It now names the shortfall
             instead, and only when there is one. */
          ? (source && source.total > 0
            ? `${source.healthy}/${source.total} sources healthy · `
              + (unaddressable
                ? `${unaddressable} ${unaddressable === 1 ? "session cannot" : "sessions cannot"} take commands`
                : "controls reachable")
            : (unaddressable
                ? `${unaddressable} ${unaddressable === 1 ? "session cannot" : "sessions cannot"} take commands`
                : "Sources and controls healthy"))
          : conn !== "live" ? "Live snapshot feed is not healthy."
            : fetchFailed ? "Last snapshot refresh failed — showing the previous good snapshot."
            : control && control.cmuxReachable !== true
              ? "cmux unreachable — terminal titles and Focus/Send stay offline."
              /* The error TEXT, not just how many there are. The server writes
                 sentences here — "probe failed 2 times … so Focus, Send and
                 Interrupt stay off until it answers" — and the card rendered
                 only the count, so an operator watching Send disappear read "1
                 error" and could not tell a failed probe from a changed policy.
                 The message exists to be read; counting it is the same defect
                 as withholding it. */
              : errors > 0
                ? (errors === 1
                  ? instrumentFaults[0]
                  : `${instrumentFaults[0]} (+${errors - 1} more)`)
              /* NAMES the source and says where the fault sentence is.
                 This branch used to read "1 degraded source · 0 stale · 0
                 errors" — three counts and no cause. It is the line Emilio was
                 looking at when he said the indicator "just says Whoops": the
                 chip knew a source was down and would not say which, while the
                 collector's own sentence sat unrendered on the issue.

                 The chip stays a qualifier and still never links — the seam
                 holds — so it names the source and points at the surface that
                 has the sentence, rather than leaving the operator to hunt for
                 a panel they have no reason to suspect. */
              : source && source.degraded > 0
                ? `${degradedSourceNames(source)} — the collector's own words are in Notifications.`
                : "Source or control evidence needs review.",
      // An advisory is not an alarm: it takes its own tone so the strip shrinks
      // it to a micro cell instead of sizing it like a blocked control plane.
      tone: severity && severity.key === "advisory" ? "advisory" : status.tone,
      icon: status.key === "operational" ? "check" : status.key === "offline" ? "offline" : "warning",
      severityKey: severity ? severity.key : null,
      severityDetail: severity ? severity.detail : "",
    };
  }
  if (!snap) return noDataWidget("Waiting for the first snapshot.");

  const totals = totalsOf(snap);
  /* The "needs-you" branch stood here: a count of findings, the top two titles,
     and the ids behind them. It is gone with the card.

     The header answers "can I trust this board, and what is this costing me".
     Every reading in it is a continuous measured quantity carrying its own
     provenance, and none of them is a to-do. A count of things that need doing
     is attention's, and attention is the notification center — where each of
     those findings is now one item with its own evidence, impact and route,
     instead of two truncated titles and a number. */
  if (id === "momentum") {
    const momentum = snap.pulse && snap.pulse.momentum;
    /* Completions are not-observable on the wire. Do not mount a filler chip
       or a "not measured" sentence — omit that reading. The CTA stays the
       needs-you count; stall and shipping facts may still ride the sublabel. */
    const parts = [];
    if (momentum) {
      const windowText = momentum.completionsProvenance === "not-observable"
        ? ""
        : completionWindowText(momentum);
      if (windowText) parts.push(windowText);
      const stall = stallText(snap, momentum.stalled);
      if (stall) parts.push(stall);
    }
    /* Attention leads. The strip was the one surface with zero attention
       information — a header that summarizes everything except what needs a
       human is a header the operator learns to skip. The old rule ("nothing
       here is a to-do") is deliberately broken here, by operator decision
       (2026-08-06): this is a fleet console, and its first number is the
       number of sessions asking for a person. Shipping and the stall facts
       move to the sub, keeping their window-honest wording. */
    const asking = (snap.programs || []).reduce(
      (total, program) => total + (program.agents || []).filter((a) => stripAlerting(a, snap)).length, 0);
    return {
      value: String(asking),
      unit: asking === 1 ? "needs you" : "need you",
      sublabel: [totals.working + " shipping", ...parts].filter(Boolean).join(" · "),
      tone: asking ? "hot" : "ok",
    };
  }
  if (id === "burn") {
    const burn = snap.pulse && snap.pulse.burn;
    if (!burn) return noDataWidget("No burn data yet.");
    /* S4-T1. Cost renders its PROVENANCE rather than implying it.

       This read the number's null-ness and inferred the rest, which is one
       inference away from the defect it was guarding: a payload carrying
       costProvenance "unavailable" beside a numeric 0 would have printed
       "$0.00 last hour" — a fabricated total for an hour nobody could price.
       The provenance field exists precisely so the card does not have to guess,
       so it is read first and it wins.

       The "≥" is load-bearing, same as the Tokens card and the usage card: it
       travels with the number when the sublabel is skimmed or read aloud, and it
       is what stops a measured floor being banked as the hour's total spend. */
    const costKnown = burn.costProvenance !== "unavailable" && burn.costLastHourUsd != null;
    /* Blind cost is omitted, not replaced with "cost unavailable", a dash, or
       $0. Provenance wins: a payload that says unavailable beside a numeric 0
       still must not print a dollar figure. */
    const cost = costKnown
      ? (burn.costIsFloor ? "≥$" : "$") + burn.costLastHourUsd.toFixed(2) + " last hour"
      : "";
    /* Cost is the one figure on this card that does NOT come from this board's
       own collection cycle — BurnBar computes it over its own hour, which is why
       the guide warns against dividing the rate by it. So the as-of is not
       decoration: it says when that separate tool last spoke, and a cost with no
       as-of beside it is one whose freshness the operator cannot judge.

       Parenthesised ONTO the cost rather than added as its own clause. That is
       the same rule S4-T1 enforces one line down for the rate's window: a
       qualifier separated from its number by another number reads as qualifying
       the wrong one, which is exactly how "36k/min · $4.20 last hour · 10m
       average" came to cross its own sentence. Five sibling clauses on one line
       is also simply hard to read, and binding this one to what it describes
       costs nothing. */
    const asOf = costKnown && burn.costAsOf && !Number.isNaN(Date.parse(burn.costAsOf))
      ? " (" + agoText(burn.costAsOf) + ")"
      : "";
    /* No coverage suffix. It counted ELIGIBLE LIVE agents while the rate sums
       deltas from every tracked reporter including ended ones — the same
       wrong-population defect just removed from CONTEXT PEAK, and the same
       reason: a coverage ratio attached to a figure it does not describe reads
       as a completeness guarantee for a number it never measured.
       (Magnitude audit §3, "two extras found here".) */
    const coverage = "";
    /* The rate and the cost come from different places — the rate needs completed
       five-minute buckets, the cost comes from BurnBar — so one being absent says
       nothing about the other. Headlining "No data" above a real dollar figure
       and a claim of complete coverage left the operator unable to tell whether
       spend was unknown or $19.54. Only the missing half says it is missing. */
    const hasRate = burn.tokensPerMin != null;
    const hasCost = costKnown;
    /* Both missing: skip the chip. A missing-tone cell is how the painter
       omits a reading; do not mount a dash or an "unavailable" sentence. */
    const sub = [cost + asOf, coverage, burn.costNote].filter(Boolean).join(" · ");
    if (!hasRate && !hasCost) return noDataWidget("No burn data yet.");
    /* The rate is an average over a window the payload carries and the widget
       never printed. windowMs is 300000 here — a five-minute average shown as a
       bare "/min" invites reading it as an instantaneous rate, which is how a
       rate and an hourly cost end up divided against each other. Say the window.
       (Magnitude audit §3.) */
    /* The window sits FIRST, next to the rate it describes. It used to be
       appended last, after the cost clause, so the cell read
       "36k/min · $4.20 last hour · 10m average" — three fragments in which the
       rate's qualifier had the cost's window between it and the rate, and
       therefore read as qualifying the cost.

       That only became wrong when the cost came back. While costLastHourUsd was
       null the clause sat directly under the rate and was unambiguous; the
       backend restoring the figure put a differently-windowed number in
       between. Two fixes, each correct, composing into a crossed sentence. */
    const windowNote = hasRate && Number.isFinite(burn.windowMs) && burn.windowMs > 0
      ? fmtElapsed(burn.windowMs) + " average"
      : "";
    /* What the rate cannot see. This is the honest half of the coverage suffix
       deleted above: `unknown` counts LIVE agents whose provider reports no
       token totals at all — measured, all 3 are Cursor — so they contribute
       exactly zero to the rate, permanently, and the figure is a subtotal shown
       as a total. Naming an absence is safe where asserting completeness was
       not: it does not claim the rate's denominator, it only says who is
       invisible to it. Audit §20 — coverage speaks only when incomplete. */
    const blindNote = hasRate && burn.coverage && Number.isFinite(burn.coverage.unknown)
      && burn.coverage.unknown > 0
      ? ` · ${burn.coverage.unknown} not reporting tokens`
      : "";
    return {
      value: hasRate ? fmtTok(burn.tokensPerMin) : "Token rate unavailable",
      unit: hasRate ? "/min" : "",
      sublabel: [windowNote, sub].filter(Boolean).join(" · ") + blindNote,
      /* Neutral ink, not green: green on a burn rate asserted that spend is
         good news, when it only meant "a rate exists". Green is reserved for
         values inside a healthy band, and a spend rate has no band. */
      tone: hasRate ? "neutral" : "missing",
    };
  }
  if (id === "tokens") {
    /* CONSUMPTION over the scan window, and never occupancy.

       `totals.tokens` sums `agent.tokens.total` over WORKING agents only, and
       `tokens.total` is documented as "latest call's prompt+completion size,
       cache reads INCLUDED — occupancy". Summing an occupancy across agents and
       labelling it total usage is the defect types.ts:142-158 was written to
       prevent: it is what once put 394M tokens on a single session against a 1M
       window. Measured on the live board the two differ by 82.74x — 75,776,215
       consumed against 915,805 occupancy — so a fallback would not merely be
       imprecise, it would be a different quantity by two orders of magnitude.
       There is deliberately no fallback here for that reason.

       This is also NOT processed flow (`sessionProcessed`, cache re-reads
       included, typically 2.6-16.9x larger) or cache re-reads. Both stay
       reachable in the drawer and neither is ever folded into this number. */
    const totals = snap.totals || {};
    const consumed = Number.isFinite(totals.consumption) ? totals.consumption : null;
    /* The whole group is absent until the server completes a full session scan,
       which on a freshly started board takes a couple of minutes. That absence
       is correct and it is load-bearing: it means "we cannot count this
       completely", never zero. So the card withholds — no number, and no loading
       state either, because a spinner would promise an arrival the server has
       not committed to. */
    if (consumed == null) return noDataWidget("No complete token count yet.");

    const reporting = Number.isFinite(totals.consumptionReporting) ? totals.consumptionReporting : null;
    const eligible = Number.isFinite(totals.consumptionEligible) ? totals.consumptionEligible : null;
    /* A floor keeps its ≥, exactly as Cost does for costIsFloor. The sign is the
       whole disclosure: without it a subtotal reads as a total. */
    const floor = totals.consumptionIsFloor === true;
    /* Coverage speaks only when incomplete — the rule Burn uses for
       coverage.unknown. A complete reading needs no footnote, and a permanent
       one stops being read. */
    const missing = reporting != null && eligible != null ? eligible - reporting : 0;
    const coverage = missing > 0
      ? `${missing} session${missing === 1 ? "" : "s"} not reporting`
      : "";
    return {
      value: (floor ? "≥ " : "") + fmtTok(consumed),
      /* "consumed", named on the card, because the word is what separates this
         from the two other token quantities the board can show. No per-card
         window tag: the scan window is stated once in the rail header, and an
         aggregate carrying its own population statement while its neighbours do
         not is how the board came to have five windows and one explanation. */
      unit: "consumed",
      /* Silent when complete. Not even a reassuring "every session in the scan
         window": that would restate the population this card is forbidden to
         tag, one line under the statement that already says it once. */
      sublabel: coverage,
      tone: "ok",
    };
  }
  if (id === "context-peak") {
    /* S3. The card headlined `contextPeak` — ONE session's extremum presented as
       a reading about the fleet. Measured on the live board while this was
       written: peak 84%, average 29%, median 25%. An operator glancing at the
       header read "the fleet is nearly full" while the typical session sat at a
       quarter, which is the same category error the Findings card made in the
       other direction.

       The fleet's typical occupancy leads now. Peak leaves the headline
       entirely and survives as a tick on the dial and in the drawer, where it
       belongs — it is a real and useful number about ONE agent, and the drawer
       is where one agent is the subject.

       The catalog id stays `context-peak` so saved layouts survive; only the
       label becomes "Context". Ids are storage keys, labels are copy. */
    const peak = peakContext(snap);
    const reported = Number.isFinite(snap.contextPeak) ? snap.contextPeak : null;
    const median = Number.isFinite(snap.contextMedian) ? snap.contextMedian : null;
    const average = Number.isFinite(snap.contextAverage) ? snap.contextAverage : null;
    const peakPct = reported != null ? reported : (peak ? peak.pct : null);

    /* Withhold rather than guess — and specifically, withhold when there is no
       reading that DESCRIBES THE FLEET, even if a peak survives. Leading with a
       lone peak is the defect above, so a card that could only do that does not
       render at all: speaks() drops a missing tone. Printing 0% instead would be
       a measurement nobody took. */
    if (average == null && median == null) return noDataWidget("No live context reports.");

    /* The existing spread toggle, kept and INVERTED. It used to choose which
       secondary reading got words underneath a peak headline; it now chooses
       which reading IS the headline. Same control, same CONTEXT_SPREAD_KEY, same
       per-browser persistence. One reading leads at a time and the toggle is
       what makes the second reachable without spending a second sentence on it.

       Average leads by default: it moves with every session, where a median can
       sit perfectly still while half the fleet climbs. */
    const preferred = state.contextSpread === "median" ? "median" : "average";
    /* A preference, not a promise that both exist — whichever is present leads
       when the preferred one is missing. */
    const headlineMode = (preferred === "median" ? median : average) != null
      ? preferred
      : (average != null ? "average" : "median");
    const headline = headlineMode === "average" ? average : median;
    const second = headlineMode === "average" ? median : average;

    /* Coverage from the ONE population that has it. types.ts documents this pair
       as existing precisely because a coverage figure over a different
       population went wrong once already: this card could previously print token
       reporters (measured at 8/9) beside a context reading covering 32 live
       agents. It speaks only when incomplete — a complete reading needs no
       footnote, and a permanent footnote stops being read. */
    const reporting = Number.isFinite(snap.contextReporting) ? snap.contextReporting : null;
    const eligible = Number.isFinite(snap.contextEligible) ? snap.contextEligible : null;
    const coverage = reporting != null && eligible != null && reporting < eligible
      ? ` · ${reporting}/${eligible} reporting`
      : "";

    const secondLabel = second != null
      ? `${headlineMode === "average" ? "Median" : "Average"} ${second}%`
      : "";
    return {
      /* Always a percentage. The tokens display names ONE session's usage, which
         has no fleet-wide counterpart — an "average token count" would be an
         aggregate of occupancies, the exact substitution types.ts warns about.
         Tokens stay where a single agent is the subject: the CTX column and the
         drawer. */
      value: headline + "%",
      unit: headlineMode === "average" ? "average window" : "median window",
      /* The tone below colors by the PEAK while the headline is the average —
         a number that changes color without changing value teaches the
         operator to stop reading color. The peak it colors by is named. */
      sublabel: [secondLabel || "Single reading", peakPct != null ? "peak " + peakPct + "%" : ""]
        .filter(Boolean).join(" · ") + coverage,
      /* The alarm still reads the PEAK, not the headline. One session about to
         run out of room is worth colouring the card for even when the fleet's
         typical occupancy is comfortable — demoting peak from the headline is
         not the same as ceasing to watch it. */
      tone: peakPct != null && peakPct >= 85 ? "hot" : "ok",
      meterPct: headline,
      /* The dial's accessible name starts with the reading that leads, not with
         "Peak". Every reading drawn is enumerated, so nothing on the arc is
         visible only to someone looking at the picture. */
      meterLabel: `${headlineMode === "average" ? "Average" : "Median"} context ${headline}%`,
      gaugeMarks: [
        second != null
          ? { pct: second, cls: headlineMode === "average" ? "is-median" : "is-average",
              label: `${headlineMode === "average" ? "Median" : "Average"} ${second}%` }
          : null,
        peakPct != null ? { pct: peakPct, cls: "is-peak", label: `Peak ${peakPct}%` } : null,
      ].filter(Boolean),
      spreadMode: headlineMode,
      spreadToggleable: median != null && average != null,
    };
  }
  if (id === "mix") {
    const counts = new Map();
    const models = new Map();
    for (const program of snap.programs || []) {
      for (const agent of program.agents || []) {
        const prov = agent.provider || "unknown";
        counts.set(prov, (counts.get(prov) || 0) + 1);
        if (agent.model) {
          const short = modelShort(agent.model) || String(agent.model);
          models.set(short, (models.get(short) || 0) + 1);
        }
      }
    }
    if (!counts.size) return noDataWidget("No sessions to mix.");
    const parts = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .map(([prov, n]) => `${providerLabel(prov)} ${n}`);
    const topModels = [...models.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([model, n]) => `${model}×${n}`);
    return {
      value: parts.join(" · "),
      unit: "",
      sublabel: topModels.join(" · ") || "models not reported",
      tone: "ok",
      mixProviders: [...counts.entries()].map(([prov, n]) => ({ prov, n })),
    };
  }
  if (id === "spend") {
    const burn = snap.pulse && snap.pulse.burn;
    if (!burn) return noDataWidget("No spend data yet.");
    const costKnown = burn.costProvenance !== "unavailable" && burn.costLastHourUsd != null;
    if (!costKnown) return noDataWidget("No spend data yet.");
    const value = (burn.costIsFloor ? "≥$" : "$") + Number(burn.costLastHourUsd).toFixed(2);
    const asOf = burn.costAsOf && !Number.isNaN(Date.parse(burn.costAsOf))
      ? agoText(burn.costAsOf)
      : "";
    return {
      value,
      unit: "",
      sublabel: [burn.costProvenance || "", asOf].filter(Boolean).join(" · "),
      tone: "neutral",
    };
  }
  return noDataWidget("Widget evidence is not available.");
}

const AFFECTS_SAMPLE_LIMIT = 6;
// Server-owned work state → the single row vocabulary (label + visual key +
// tone). issueWorkState prefers live optimistic signals, then this map, then a
// severity default, so the board always names who (if anyone) is on a finding.
const WORK_STATE_VIEW = {
  needs_triage: { key: "needs", label: "Needs triage", tone: "error" },
  watching: { key: "watching", label: "Watching", tone: "warn" },
  triaging: { key: "triaging", label: "Triaging", tone: "warn" },
  planned: { key: "planned", label: "Plan ready", tone: "info" },
  queued: { key: "queued", label: "Queued", tone: "info" },
  investigating: { key: "investigating", label: "Investigating", tone: "info" },
  verifying: { key: "verifying", label: "Verifying", tone: "warn" },
  blocked: { key: "blocked", label: "Blocked", tone: "error" },
  cleared: { key: "cleared", label: "Cleared", tone: "moss" },
};



const PROGRESS_BY_WORK = {
  needs: 0, watching: 0, triaging: 15, planned: 35, queued: 50,
  investigating: 70, verifying: 85, blocked: 70, cleared: 100,
};

// Four-tick stage rail: Watch → Triage → Verify → Cleared.
const STAGE_BY_WORK = {
  needs: 1, watching: 1,
  triaging: 2, planned: 2, queued: 2, investigating: 2,
  verifying: 3, blocked: 3,
  cleared: 4,
};

/* ---------- test surface ---------- */

globalThis.TheAntHill = {
  deriveActivity, deriveOutcome, deriveControlState, deriveRollup, programRollup,
  lifecycleOf, provenanceOf, scopeOf, isTerminal, isLive, isStalled, operatorState, stallThresholdMs, DEFAULT_STALL_THRESHOLD_MS, isUnverified, wantsHuman,
  declaredQuiet, declaredDone,
  controlUnavailableText,
  totalsOf, issuesOf, alerting, alertFirst, alertRecent, viewMatches, matchesQuery, buildClusters, tokenSummary,
  issueLifecycle, issueStateLabel, recentlyResolvedOf,
  contextUsage, contextDisplayValue, typicalRequestOf,
  roleView, formatLastHumanMessage, rowSummary, rowSummaryParts, NO_READABLE_MESSAGE,
  // Message provenance and role confidence: the parser is pure and lives in
  // presentation.js; these are re-exported here so the client's own test
  // surface can drive parser and renderer through one handle.
  parseSenderHeader, senderOf, senderClaimText, withoutSenderHeader, roleSourceView, specialtyLabel,
  elapsedDataset, liveElapsedText, fmtTok, fmtElapsed, fmtWorkingDuration, fmtCompactAge,
  ROW_TIME_VERBS, rowTimeVerb, rowTimeBand, modelShort, agentName,
  sourceAgentName, presentationLabelKey, agentLabelEligible, programName, sessionTag, ambiguousNames, landingRosterNames,
  preferredRenameTarget, terminalSourceName, stripSpinnerFrame, terminalIdentity, terminalBreadcrumb, focusDestinationHint, focusButtonLabel,
  quietSourceLine, fullSourceDetail, verdictGate, conciseText,
  renderAgentRow, renderAgentColumnHeader, renderSummaryWidget,
  captureRowFlights, playRowFlights,
  renderProgramDrawer, programRollupLine, programRollupCells, programHeadRollup,
  ACTIVITY_LABELS, OUTCOME_LABELS, CONTROL_LABELS, VIEWS, OPS_VIEWS,
  withinLookback, parseLookbackHours, lookbackApplies, lookbackLabel, rowStalenessText, rowStateWords,
  isReviewWorker, sessionKindOf, agentClassOf,
  agentContextPct, rosterName,
  DEFAULT_LOOKBACK_HOURS, LOOKBACK_HOUR_PRESETS, LOOKBACK_DAY_PRESETS,
  CONTROL_STATE_TEXT,
  WIDGET_STORAGE_KEY, DEFAULT_WIDGET_IDS, WIDGET_CATALOG,
  normalizeWidgetIds, parseWidgetPreference, reorderWidgetIds,
  // The header disclosure: strict parser, fail-soft storage, the one toggle
  // writer, and the mode-sync all four surfaces share.
  HEADER_COLLAPSED_STORAGE_KEY, parseHeaderCollapsed, loadHeaderCollapsed,
  saveHeaderCollapsed, toggleHeaderCollapsed, syncHeaderDisclosure,
  pulseStripModel, issueWorkState, issueStage, affectedImpact, issueProgress, issueImpactLine,
  INVESTIGATION_STATE_VIEW, investigationView,
  usageCostReading, usageTokenReading, usageRateWindowText, burnbarInstant, emptyBoardVerdict,
  systemStatus, degradedSeverity, healthRefreshAction, completionWindowText, watchClauses, unaddressableCount, calmVerdict, stalledCount, stallText, calmSpendText, bandContextPct, sparklineLabel, attentionSummary, summaryWidgetData, topSourceIssue, degradedSinceText,
  healthRemedy, instrumentRemedy,
  parseInvestigationResult, routeFromBullet,
  serverUnreachableHint, usageBarTitle, renderUsageSeriesChart,
  renderAgentDrawer, renderChat, dedupeTurns, drawerSessionTag, renderEvidence, renderNamesDisclosure,
  parseHeartbeatStructured, programForTldrRepo, deterministicRepoStats, tldrAttentionCount, fleetFallbackLine,
  heartbeatTldrAgent,
  renderHealthRail, renderHealthTldrLane, repoScopedReadings, tldrRepoOrder,
  identityTraceView, quarantineBrief, surfaceCollisions, collisionLine, operatorReason,
  renderControlBanner, renderIdentityBlock,
  el,
  // CONN_LABELS and the freshness thresholds stay out of this block on purpose:
  // they are declared below it, so listing them here would be a TDZ error.
  snapshotFreshness, connLabelText, connVerdictFor, reconnectPlan, fallbackPollDue, eventSnapshot,
  feedAlarm, clocksFrozen, feedFrozen, elapsedTickText, staleControlNote, feedAlarmNode, tickClocks,
  renderCommandDock, renderDockTool, composerCanSend, resizeComposer,
  /* SYNC-CF. The gate, the envelope reader and the two renderers: the request
     functions are driven for real against a fake fetch, and the pure halves let
     the gating and the envelope rules be asserted without a DOM. */
  syncCloseView, syncCloseReason, syncCloseEscalation, syncCloseVerdict,
  renderSyncCloseTool, renderSyncCloseDialog, cancelSyncClose,
  // The TRANSCRIPT_* limits stay out for the same TDZ reason as CONN_LABELS:
  // they are `const`s declared below this block. Assert the behavior instead.
  transcriptUrl, clampTranscriptLimit, nextTranscriptLimit, normalizeTranscript,
  transcriptFailureText, transcriptWindow, renderTranscriptFeedLead,
  // The wire contract for Grok Build reasoning: `Thought\n` on a system line.
  thoughtText,
  chatBubbleNode, renderChatFeedBody, shouldAutoLoadTranscript, shouldRefreshHeldTranscript, isGrokBotAgent, transcriptThreadStamp, maybeRefreshHeldTranscript, chatScrollPlan, saveChatScrollFrom,
  chatSpeechNeedsCollapse, isCollectorWindowText, previewChatTurns, rowClosingText,
  captureDrawerScroll, restoreDrawerScroll,
  actionsUrl, clampActionsLimit, normalizeActions, actionsFailureText,
  controlOutcome,
  actionOutcomeView, lastActionFor,
  needsHumanIds, notificationPlan, titleWithAlerts, notifyToggleView, deliverNotification,
  // The attention surface. NOTIFY_DEPS is a `const` and stays out of this
  // hoisted block for the same TDZ reason CONN_LABELS does; it is exported from
  // the test seam at the foot of the file.
  attentionClassOf, hasCurrentImpact, notificationFeed, notificationCandidates,
  notificationPanelModel, feedTone, blockingCount, blockingAgentIds,
  programOpen, programsPaintSig, inspectorPaintSig, agentRecordSig, lineagePaintSig, renderLineageSpine, agentsById,
  // Single-board surfaces: the pinned strip, the lifecycle dividers, swarm
  // collapse, the history provenance chips, and the fleet index all three read.
  lifecycleSection, LIFECYCLE_SECTIONS, needsYouStrip, renderNeedsYouStrip, stripSig,
  // The Needs-you display preference: where alerting rows are drawn.
  needsYouDisplayOf, loadNeedsYouDisplay, setNeedsYouDisplay,
  // The strip chip's words and its jump, assertable without a DOM.
  stripChipLabel, jumpToProgramGroup, teamIdOfProgram,
  swarmOpen, toggleSwarm, historyProvenance, historyChips, renderRowFacts,
  boardIndex, sharedRowNames, rowDisplayName, landingView, LEGACY_VIEW_ALIASES,
  // ROW_NAV_KEYS is deliberately absent — it is a `const` declared below this
  // block, exactly the TDZ hazard the comment above describes. The behavior it
  // gates is asserted through handleRowNavigation instead.
  nextRowIndex, handleRowNavigation, nextViewIndex, handleCockpitKeys, isTypingTarget, firstLoadPending, renderSkeleton, renderEmpty,
  reconcileKeyed, agentRowSig, agentRowPlan, programShellSig, syncProgramList,
  // The repo → worktree/run grouping, as pure functions: what the board's
  // sections ARE and what each subsection is CALLED, decidable without a DOM.
  // (RUN_GROUP_PREFIX stays out — it is a `const` declared below this block,
  // the TDZ hazard the note above is about.)
  repoGroups, teamGroups, worktreeLabel,
  /* TINT-F. The colour join, the two paints, and the three surfaces that wear
     them — exported so the treatments are assertable as functions rather than
     as substrings of this file. */
  setRepoColors, repoTintFor, repoTintOfProgram, tintOfProgram, normalizeRepoHex, fetchRepoColors,
  fetchTeamColors, renderTeamColorSettings, paintTeamColorSettings,
  liveRepoSig, maybeRefreshRepoColors, openSettingsPanel, closeSettingsPanel,
  renderRepoSection, repoShellSig, stripRowOpts, renderStripGroupHead,
  // The shelf's governor. Exported because the lookback clause inside it is the
  // only thing standing between a 24-row shelf and a 446-row one, and a
  // property that load-bearing has to be assertable directly.
  shelfFilter, shelfOpen,
  dashboardVisible, dashboardPrograms,
  currentFilter, passesReviewVisibility, reviewWorkerCount, emptyListMessage, hiddenByLookback, renderTabs, filterChip, renderFilterBar, renderScopeNote, renderLabelForm, renderTriage, renderUsagePanel,
  setGrouping, toggleSelectMode, defaultGroupingName, groupingWorkspaceIds,
  groupingSharedWindowId, createGroupingTeam, startTeamRename, submitTeamRename, ungroupTeam,
  /* The two-layer model's own seam. `workingSet` is the population every count
     on the page is taken over, and the menus are the surfaces that report it —
     both are reachable so "a lens never moves the tab number" can be asserted
     against the real derivation rather than against a copy of it. */
  workingSet, findSelected, resolveSelection, closeFilterMenu, lookbackValueLabel, isOfferedLookback,
  passesEveryLens, activeLenses,
};

/* ---------- state ---------- */

const STALE_AFTER_MS = 60_000;



function elapsedTickText(base, fromIso, now, frozen) {
  const b = Number(base);
  if (!Number.isFinite(b)) return null;
  if (frozen) return fmtElapsed(b);
  const drift = now - Date.parse(fromIso);
  if (!Number.isFinite(drift)) return null;
  return fmtElapsed(b + Math.max(0, drift));
}


/* S3 flipped the default to AVERAGE. The toggle used to pick which secondary
   reading got words under a fixed peak headline; it now picks which reading
   LEADS, and the average is the better default because it moves with every
   session — a median can sit perfectly still while half the fleet climbs.

   An explicitly stored "median" is still honoured: it is a choice the operator
   made, and this key exists to remember choices. Anything else falls to the
   documented default rather than trusting a value the product may no longer
   speak. */
function loadContextSpread() {
  try {
    const raw = localStorage.getItem(CONTEXT_SPREAD_KEY);
    state.contextSpread = raw === "median" ? "median" : "average";
  } catch {
    state.contextSpread = "average";
  }
}

/* Where the board draws its alerting rows. "pane" is the strip at the top;
   "inline" leaves them in their program groups. Only the exact other word is
   honoured — a value this client never wrote falls back to the pane, which is
   the behavior every operator has already learned. The accessor takes a ui so
   the list helpers stay drivable without the module's state, and an absent
   field (every existing test fixture) reads as the default. */
function needsYouDisplayOf(ui = state) {
  return ui.needsYouDisplay === "inline" ? "inline" : "pane";
}

function loadNeedsYouDisplay() {
  try {
    const raw = localStorage.getItem(NEEDS_YOU_DISPLAY_KEY);
    state.needsYouDisplay = raw === "inline" ? "inline" : "pane";
  } catch {
    state.needsYouDisplay = "pane";
  }
}

function saveNeedsYouDisplay() {
  try {
    localStorage.setItem(NEEDS_YOU_DISPLAY_KEY, state.needsYouDisplay);
  } catch { /* storage unavailable */ }
}

function setNeedsYouDisplay(mode) {
  const next = mode === "inline" ? "inline" : "pane";
  if (next === state.needsYouDisplay) return;
  state.needsYouDisplay = next;
  saveNeedsYouDisplay();
  render();
}

function loadLookback() {
  try {
    const raw = localStorage.getItem(LOOKBACK_STORAGE_KEY);
    if (raw == null) {
      state.lookbackHours = DEFAULT_LOOKBACK_HOURS;
      return;
    }
    state.lookbackHours = parseLookbackHours(raw);
  } catch {
    state.lookbackHours = DEFAULT_LOOKBACK_HOURS;
  }
}

function saveLookback() {
  try {
    localStorage.setItem(
      LOOKBACK_STORAGE_KEY,
      state.lookbackHours == null ? "all" : String(state.lookbackHours),
    );
  } catch { /* storage unavailable */ }
}

function setLookbackHours(hours) {
  const next = hours == null ? null : parseLookbackHours(hours);
  if (next === state.lookbackHours) return;
  state.lookbackHours = next;
  saveLookback();
  render();
}


/* The tab a stored `defaultView` should land on, or null when it names nothing
   this client can show. Pure so the alias table is assertable without a fetch. */
function landingView(stored) {
  if (VIEWS.includes(stored)) return stored;
  const aliased = LEGACY_VIEW_ALIASES[stored];
  return VIEWS.includes(aliased) ? aliased : null;
}

async function fetchSettings() {
  try {
    const res = await apiFetch("/api/settings", { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    if (!res.ok) throw new Error("settings " + res.status);
    const body = await res.json();
    const hours = Number(body.scanWindowHours ?? (body.settings && body.settings.scanWindowHours));
    if (Number.isFinite(hours)) state.scanWindowHours = hours;
    /* Review-worker visibility is a SERVER setting, not a per-browser lens: the
       fleet's default board should look the same from any machine. Skipped while
       a save is in flight, so a refetch racing the operator's own toggle cannot
       flip the chip back under their finger. */
    if (typeof (body.settings && body.settings.showReviewWorkers) === "boolean" && !state.settingsPending) {
      state.showReviewWorkers = body.settings.showReviewWorkers;
    }
    state.settings = body.settings || null;
    /* The operator's landing tab, applied only on the FIRST read — after that
       they have navigated and moving them would be the board overriding a
       choice they just made. */
    /* Through the alias table: the server still stores the pre-Board vocabulary
       ("needs-you", "now", "waiting"), and a saved landing view that no longer
       names a tab must land on the view that absorbed it rather than be
       silently discarded. */
    const landing = landingView(body.settings && body.settings.defaultView);
    if (!state.settingsLoaded && landing) state.view = landing;
    state.settingsLoaded = true;
    state.settingsError = "";
  } catch (err) {
    /* The scan window falls back to a hard-coded 36, and the filter chip printed
       that as fact. A snapshot carries the real value and overrides it, so this
       only bites before the first snapshot or when one omits the field — which
       is exactly when the operator has no other way to notice. */
    state.settingsError = err && err.message ? err.message : "Settings unavailable";
  }
  renderFilterBar();
}

/* One writer for every server-side setting.

   The server validates by rejecting rather than clamping — telling an operator
   their setting took effect when a different one did is the failure this whole
   contract is about — so the message it returns IS the answer, and it is shown
   verbatim rather than replaced with a generic failure. */
async function postSettings(patch) {
  state.settingsPending = true;
  state.settingsSaveError = "";
  renderFilterBar();
  try {
    const res = await apiFetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(patch),
    }, API_WRITE_TIMEOUT_MS);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error((body.error && body.error.message) || ("settings " + res.status));
    state.settings = body.settings || state.settings;
    const hours = Number(body.scanWindowHours);
    if (Number.isFinite(hours)) state.scanWindowHours = hours;
    /* Say so. A save that posted, persisted and re-classified the whole board in
       silence is indistinguishable from a button that does nothing, which is
       exactly how it was reported. The stamp is what the panel confirms
       against, so it survives the re-render that follows. */
    state.settingsSavedAt = Date.now();
    state.settingsError = "";
    /* A settings change re-classifies the board, so the numbers an operator is
       looking at have to be the ones their new thresholds produced. */
    await fetchSnapshot();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    /* Kept on the panel as well as in the toast. The server rejects rather than
       clamps, so the message IS the answer — and a toast that has faded leaves
       an operator staring at a value they think they saved. */
    state.settingsSaveError = message;
    state.settingsSavedAt = 0;
    toast(message, "err");
    return false;
  } finally {
    state.settingsPending = false;
    render();
  }
}

function loadOverrides() {
  try {
    const raw = localStorage.getItem("mtn3-programs");
    if (raw) state.programOverrides = new Map(Object.entries(JSON.parse(raw)));
  } catch { /* first run or blocked storage */ }
}

function saveOverrides() {
  try {
    localStorage.setItem("mtn3-programs", JSON.stringify(Object.fromEntries(state.programOverrides)));
  } catch { /* storage unavailable */ }
}

/* Repository collapse, on the programOverrides pattern exactly. Both modes are
   written, because a repo's default is COMPUTED (open when it holds a session
   the active view would admit) rather than fixed — so "closed" is a real choice
   the operator made and not the absence of one. */
function loadRepoOverrides() {
  try {
    const raw = localStorage.getItem("mtn3-repos");
    if (raw) state.repoOverrides = new Map(Object.entries(JSON.parse(raw)));
  } catch { /* first run or blocked storage */ }
}

function saveRepoOverrides() {
  try {
    localStorage.setItem("mtn3-repos", JSON.stringify(Object.fromEntries(state.repoOverrides)));
  } catch { /* storage unavailable */ }
}

/* Swarm expansion, on the programOverrides pattern exactly — same shape, same
   failure handling, its own key. Only "open" is ever written: collapsed is the
   default, so storing it would be storing the absence of a choice. */
function loadSwarmOverrides() {
  try {
    const raw = localStorage.getItem("mtn3-swarms");
    if (!raw) return;
    const entries = Object.entries(JSON.parse(raw)).filter(([, mode]) => mode === "open");
    state.swarmOverrides = new Map(entries);
  } catch { /* first run or blocked storage */ }
}

function saveSwarmOverrides() {
  try {
    localStorage.setItem("mtn3-swarms", JSON.stringify(Object.fromEntries(state.swarmOverrides)));
  } catch { /* storage unavailable */ }
}

/* Finished shelves, on the swarmOverrides pattern exactly: collapsed is the
   default, so only "open" is ever stored — writing "closed" would be storing
   the absence of a choice. */
function loadShelfOverrides() {
  try {
    const raw = localStorage.getItem("mtn3-shelves");
    if (!raw) return;
    state.shelfOverrides = new Map(Object.entries(JSON.parse(raw)).filter(([, mode]) => mode === "open"));
  } catch { /* first run or blocked storage */ }
}

function saveShelfOverrides() {
  try {
    localStorage.setItem("mtn3-shelves", JSON.stringify(Object.fromEntries(state.shelfOverrides)));
  } catch { /* storage unavailable */ }
}

function loadWidgetPreferences() {
  try {
    state.widgetIds = parseWidgetPreference(localStorage.getItem(WIDGET_STORAGE_KEY));
  } catch {
    state.widgetIds = defaultWidgetIds();
  }
}

function saveWidgetPreferences() {
  try { localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(state.widgetIds)); } catch { /* storage unavailable */ }
}

function loadTldrView() {
  try {
    const raw = localStorage.getItem(TLDR_VIEW_KEY);
    state.tldrView = raw && raw !== "ALL" ? String(raw) : "ALL";
  } catch {
    state.tldrView = "ALL";
  }
}

function saveTldrView() {
  try { localStorage.setItem(TLDR_VIEW_KEY, state.tldrView || "ALL"); } catch { /* storage unavailable */ }
}

/* The header disclosure preference. Strict on purpose: collapsing hides the
   TL;DR and the readings stack, so only an explicitly stored literal "true"
   may do it — a malformed value, an old JSON blob, or a blocked store all
   resolve to the expanded default rather than to a hidden summary. */
function parseHeaderCollapsed(raw) {
  return raw === "true";
}

function loadHeaderCollapsed() {
  try {
    state.headerCollapsed = parseHeaderCollapsed(localStorage.getItem(HEADER_COLLAPSED_STORAGE_KEY));
  } catch {
    state.headerCollapsed = false;
  }
}

function saveHeaderCollapsed() {
  try { localStorage.setItem(HEADER_COLLAPSED_STORAGE_KEY, state.headerCollapsed === true ? "true" : "false"); } catch { /* storage unavailable */ }
}

/* The only writer of the preference: explicit operator toggles. The customizer
   closes on BOTH directions — collapsing removes its anchor from the layout,
   and expanding must return it closed rather than surprise-open. The static
   button is never rebuilt, so focus stays where the operator pressed. */
function toggleHeaderCollapsed() {
  state.widgetCustomizerOpen = false;
  state.headerCollapsed = !state.headerCollapsed;
  saveHeaderCollapsed();
  renderHealthRail();
}

/* One writer for every mode surface: hidden states, body class, toggle label,
   and aria-expanded move together or the header lies about itself. Runs AHEAD
   of the widgets paint guard in renderHealthRail — mode is not a widget value,
   and it must apply even when every signed reading is unchanged. */
function syncHeaderDisclosure() {
  const collapsed = state.headerCollapsed === true;
  const rail = $("health-rail");
  const compact = $("compact-summary");
  const toggle = $("header-summary-toggle");
  if (rail) rail.hidden = collapsed;
  if (compact) compact.hidden = !collapsed;
  if (document.body && document.body.classList) {
    document.body.classList.toggle("header-summary-collapsed", collapsed);
  }
  if (toggle) {
    const label = collapsed ? "Expand header" : "Collapse header";
    toggle.textContent = "";
    toggle.classList.add("masthead-icon");
    toggle.append(icon(collapsed ? "chevron-down" : "chevron-up"));
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
    toggle.setAttribute("aria-expanded", String(!collapsed));
  }
}

function repoScopedReadings(program) {
  if (!program) return null;
  const agents = Array.isArray(program.agents) ? program.agents : [];
  const working = agents.filter((a) => a.lifecycle === "working").length;
  const blocked = agents.filter((a) => a.outcome === "blocked").length;
  const needsYou = agents.filter((a) => a.attentionSignal && a.lifecycle !== "finished").length;
  const pcts = agents.map((a) => agentContextPct(a)).filter((n) => Number.isFinite(n));
  const avgCtx = pcts.length ? Math.round(pcts.reduce((sum, n) => sum + n, 0) / pcts.length) : null;
  const pressure = avgCtx == null ? "" : contextPressureOf(avgCtx);
  const hot = needsYou > 0 || blocked > 0;
  return {
    momentum: {
      value: String(working),
      unit: working === 1 ? "working" : "working",
      sublabel: "this repo",
      tone: hot ? "hot" : "ok",
    },
    burn: { value: "—", unit: "", sublabel: "fleet-wide only", tone: "missing" },
    "context-peak": avgCtx == null
      ? { value: "—", unit: "", sublabel: "this repo", tone: "missing" }
      : {
        value: String(avgCtx),
        unit: "%",
        sublabel: "this repo",
        tone: pressure === "hot" ? "hot" : "ok",
        meterPct: avgCtx,
        meterLabel: `${avgCtx}% avg in this repo`,
      },
    health: {
      value: hot ? "Needs you" : "Steady",
      unit: "",
      sublabel: "this repo",
      tone: hot ? "hot" : "ok",
      icon: hot ? "warning" : "check",
      remedy: null,
    },
  };
}

/* ---------- data flow ---------- */

/* The one apply path a validated snapshot takes into the UI: shape-guard, adopt
   it, sync the scan window, clear the failure flag, re-render. The GET poll
   (fetchSnapshot), the POST recollect and the SSE stream — which carries very
   nearly every snapshot the UI ever paints — all feed through here, so a guard
   added below actually applies to real traffic. */
function snapshotSequenceFrom(value) {
  if (value == null || value === "") return null;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
}

function applySnapshot(snap, sequence = null) {
  if (!snap || snap.schemaVersion !== 1 || !Array.isArray(snap.programs)) {
    throw new Error("unexpected snapshot shape");
  }
  state.snap = snap;
  maybeRefreshRepoColors(snap);
  state.snapshotSequence = snapshotSequenceFrom(sequence);
  if (Number.isFinite(Number(snap.scanWindowHours))) state.scanWindowHours = Number(snap.scanWindowHours);
  state.fetchFailed = false;
  /* Persisted TL;DR view → program facet once programs exist (reload desync fix). */
  applyTldrFacetSync(state.tldrView || "ALL");
  // Escalate before painting: the tab title and any notification are about the
  // snapshot being adopted, and this is the only place a snapshot is adopted.
  applyNotifications(snap);
  maybeRefreshHeldTranscript(snap);
  render();
}

async function fetchSnapshot() {
  try {
    const res = await apiFetch("/api/snapshot", { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const sequence = res.headers && res.headers.get
      ? res.headers.get("x-ant-hill-snapshot-sequence")
      : null;
    applySnapshot(await res.json(), sequence);
  } catch (err) {
    state.fetchFailed = true;
    if (!state.snap) {
      setConn("offline");
      render();
    }
    console.warn("snapshot fetch failed:", err);
  }
}

/* The Degraded verdict's Refresh forces a fresh server-side collection rather than
   re-serving cache: POST /api/recollect (no body, same-origin — the browser sends
   the Origin header the server guard requires). Apply the returned snapshot through
   the shared path; any non-OK envelope ({ ok:false, ... }, e.g. 500 RECOLLECT_FAILED)
   or a network error falls back to fetchSnapshot so Refresh is never a dead button. */
async function recollectSnapshot() {
  try {
    const res = await apiFetch("/api/recollect", { method: "POST", headers: { accept: "application/json" } }, API_WRITE_TIMEOUT_MS);
    if (!res.ok) { await fetchSnapshot(); return; }
    const sequence = res.headers && res.headers.get
      ? res.headers.get("x-ant-hill-snapshot-sequence")
      : null;
    applySnapshot(await res.json(), sequence);
  } catch {
    await fetchSnapshot();
  }
}

/* On-demand terminal evidence for a quarantined session. Read-only GET; the
   result is scoped to one agent id so a drawer switched mid-flight can never
   adopt the previous agent's evidence. */
async function loadIdentityEvidence(agentId) {
  state.identity = { agentId, loading: true, error: "", data: null };
  render();
  let next;
  try {
    const res = await apiFetch("/api/debug/identity?agent=" + encodeURIComponent(agentId), {
      headers: { accept: "application/json" },
    }, API_READ_TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok || !body || body.ok !== true) {
      const message = (body && body.error && body.error.message) || "HTTP " + res.status;
      throw new Error(message);
    }
    next = { agentId, loading: false, error: "", data: body };
  } catch (err) {
    next = { agentId, loading: false, error: err instanceof Error ? err.message : String(err), data: null };
  }
  // The operator moved on — do not paint stale evidence into another drawer.
  if (state.identity.agentId !== agentId) return;
  state.identity = next;
  render();
}

/* Close the Route card's terminal evidence.

   It clears the whole slot rather than setting an "open" flag, and that is the
   load-bearing detail: inspectorPaintSig signs identity as loading/error/data
   scoped to `identity.agentId === agent.id`, so a separate flag would leave
   that signature identical, paintUnchanged would short-circuit, and the drawer
   would never repaint — the exact symptom this fixes, wearing a different hat.
   Clearing agentId flips the whole fragment to "" and the repaint fires.

   The cost is that re-opening re-fetches. That is what switching agents already
   does, and the endpoint is a local read-only GET. */
function clearIdentityEvidence() {
  state.identity = { agentId: null, loading: false, error: "", data: null };
  render();
}

let refetchTimer = null;
function scheduleRefetch() {
  if (refetchTimer) return;
  refetchTimer = setTimeout(() => { refetchTimer = null; fetchSnapshot(); }, 400);
}

/* Both full-snapshot envelope shapes: a bare snapshot, or one wrapped in
   { snapshot }. Anything else is an unknown event kind, not a snapshot. */
function eventSnapshot(msg) {
  if (msg && msg.schemaVersion === 1) return msg;
  return msg && msg.snapshot ? msg.snapshot : null;
}

/* Rebuild a complete candidate without mutating the base. Program metadata and
   ordering are authoritative in every delta; agent records may come from the
   validated base only when the delta names their ids. A missing id is a broken
   delta, never permission to paint a partial board. */
function applySnapshotDelta(base, delta, currentSequence) {
  if (!base || base.schemaVersion !== 1 || !Array.isArray(base.programs)) {
    throw new Error("snapshot delta has no complete base");
  }
  if (!delta || delta.schemaVersion !== 1 ||
      !Number.isSafeInteger(delta.baseSequence) ||
      !Number.isSafeInteger(delta.sequence) ||
      delta.baseSequence !== currentSequence ||
      delta.sequence !== delta.baseSequence + 1 ||
      !delta.snapshot || delta.snapshot.schemaVersion !== 1 ||
      Object.prototype.hasOwnProperty.call(delta.snapshot, "programs") ||
      !Array.isArray(delta.programs)) {
    throw new Error("snapshot delta sequence or shape is invalid");
  }

  const basePrograms = new Map(base.programs.map((program) => [program.id, program]));
  const seenPrograms = new Set();
  const programs = delta.programs.map((wireProgram) => {
    if (!wireProgram || typeof wireProgram.id !== "string" ||
        seenPrograms.has(wireProgram.id) ||
        !Array.isArray(wireProgram.agentIds) ||
        !Array.isArray(wireProgram.agents)) {
      throw new Error("snapshot delta program is invalid");
    }
    seenPrograms.add(wireProgram.id);
    const baseAgents = new Map(
      (basePrograms.get(wireProgram.id)?.agents || []).map((item) => [item.id, item]),
    );
    const changedAgents = new Map();
    const allowedIds = new Set(wireProgram.agentIds);
    for (const item of wireProgram.agents) {
      if (!item || typeof item.id !== "string" ||
          changedAgents.has(item.id) || !allowedIds.has(item.id)) {
        throw new Error("snapshot delta agent is invalid");
      }
      changedAgents.set(item.id, item);
    }
    const seenAgents = new Set();
    const agents = wireProgram.agentIds.map((id) => {
      if (typeof id !== "string" || seenAgents.has(id)) {
        throw new Error("snapshot delta agent order is invalid");
      }
      seenAgents.add(id);
      const item = changedAgents.get(id) || baseAgents.get(id);
      if (!item) throw new Error("snapshot delta omitted an agent record");
      return item;
    });
    const { agentIds: _agentIds, agents: _agents, ...program } = wireProgram;
    return { ...program, agents };
  });

  const candidate = { ...delta.snapshot, programs };
  if (candidate.schemaVersion !== 1) throw new Error("snapshot delta produced an invalid snapshot");
  return candidate;
}

function handleEventPayload(raw, eventSequence = null) {
  state.lastEventAt = Date.now();
  let msg;
  try { msg = JSON.parse(raw); } catch { scheduleRefetch(); return; }
  const snap = eventSnapshot(msg);
  try {
    applySnapshot(snap, eventSequence);
  } catch {
    scheduleRefetch(); // unknown event kind or bad shape: refetch the truth
  }
  applyFreshnessVerdict();
}

let snapshotRecoveryInFlight = null;
function recoverFullSnapshot() {
  if (!snapshotRecoveryInFlight) {
    snapshotRecoveryInFlight = fetchSnapshot().finally(() => {
      snapshotRecoveryInFlight = null;
    });
  }
  return snapshotRecoveryInFlight;
}

async function handleDeltaPayload(raw, eventSequence = null) {
  state.lastEventAt = Date.now();
  try {
    const delta = JSON.parse(raw);
    const sequence = snapshotSequenceFrom(eventSequence);
    if (sequence === null || sequence !== delta.sequence) {
      throw new Error("snapshot delta event id does not match its sequence");
    }
    const next = applySnapshotDelta(state.snap, delta, state.snapshotSequence);
    applySnapshot(next, sequence);
  } catch {
    await recoverFullSnapshot();
  }
  applyFreshnessVerdict();
}

let es = null;
function connect() {
  es = new EventSource("/api/events");
  es.onopen = () => { state.lastEventAt = Date.now(); applyFreshnessVerdict(); };
  es.onerror = () => { setConn(state.snap ? "reconnecting" : "offline"); };
  es.onmessage = (e) => handleEventPayload(e.data, e.lastEventId);
  es.addEventListener("snapshot", (e) => handleEventPayload(e.data, e.lastEventId));
  es.addEventListener("snapshot-delta", (e) => void handleDeltaPayload(e.data, e.lastEventId));
  // Heartbeats only prove the pipe is open — no refetch, no snapshot re-render,
  // and crucially no verdict of their own: a 25s heartbeat under a 60s threshold
  // used to make setConn("stale") unreachable while the data sat frozen.
  es.addEventListener("heartbeat", () => {
    state.lastEventAt = Date.now();
    applyFreshnessVerdict();
  });
}

/* The connection verdict, recomputed from evidence rather than from whichever
   event happened to fire last. The socket owns the pessimistic states; once it
   is open the AGE OF THE DATA decides between live and stale. Heartbeats are
   deliberately not an input here — they are why a frozen board read as "Live".
   Pure, and returns null when the socket is not open, so the rule is testable
   without a live EventSource. */
function connVerdictFor({ open, lastEventAt, generatedAt, now = Date.now() }) {
  if (!open) return null; // onerror / the health poll own the pessimistic states
  const silent = lastEventAt > 0 && now - lastEventAt > STALE_AFTER_MS;
  return silent || snapshotFreshness(generatedAt, now).state === "stale" ? "stale" : "live";
}

function applyFreshnessVerdict() {
  const next = connVerdictFor({
    open: !!es && es.readyState === EventSource.OPEN,
    lastEventAt: state.lastEventAt,
    generatedAt: state.snap && state.snap.generatedAt,
  });
  if (next) setConn(next);
}

/* EventSource only auto-retries transport errors; a non-2xx status or a wrong
   content-type parks it in CLOSED for good, and nothing else in the client
   re-arms it (the manual retry button is hidden whenever any agent exists). This
   poll owns recovery — with backoff so a server that is genuinely down is not
   hammered — and falls back to polling /api/snapshot once the feed has been
   unhealthy for longer than STALE_AFTER_MS, so the board can never sit painting
   hours-old agent state under live-looking elapsed clocks. */
let reconnectAttempts = 0;
let nextReconnectAt = 0;
let nextFallbackPollAt = 0;
let connChangedAt = Date.now();

/* readyState as raw numbers so the rule stays testable without an EventSource:
   0 CONNECTING (a retry is already in flight, leave it), 1 OPEN (healthy, reset
   the backoff), 2 CLOSED (dead for good — re-arm once the window has passed). */
function reconnectPlan(readyState, now, attempts, dueAt) {
  if (readyState === 1) return { reconnect: false, attempts: 0, dueAt: 0 };
  if (readyState === 0 || now < dueAt) return { reconnect: false, attempts, dueAt };
  const next = attempts + 1;
  return { reconnect: true, attempts: next, dueAt: now + Math.min(30_000, 1_000 * 2 ** Math.min(next, 5)) };
}

/* Once the feed has been unhealthy for longer than one stale window, stop
   trusting the stream to come back on its own and re-poll the snapshot. */
function fallbackPollDue(conn, now, changedAt, dueAt) {
  return conn !== "live" && now - changedAt > STALE_AFTER_MS && now >= dueAt;
}

function pollConnectionHealth(now = Date.now()) {
  const plan = reconnectPlan(es ? es.readyState : 2, now, reconnectAttempts, nextReconnectAt);
  reconnectAttempts = plan.attempts;
  nextReconnectAt = plan.dueAt;
  if (plan.reconnect) {
    setConn(state.snap ? "reconnecting" : "offline");
    if (es) es.close();
    connect();
  }
  applyFreshnessVerdict();
  if (fallbackPollDue(state.conn, now, connChangedAt, nextFallbackPollAt)) {
    nextFallbackPollAt = now + 10_000;
    void fetchSnapshot();
  }
  renderConn(); // keep the snapshot-age suffix ticking while nothing else paints
}

/* Snapshot age can cross the stale threshold precisely while no snapshot is
   arriving. Repaint the alarm and any open control surfaces from the 5s clock,
   so silence itself can visibly hold stale routing controls. Their paint
   signatures keep healthy ticks as no-ops. */
function refreshStalenessSurfaces() {
  renderFeedAlarm();
  if (state.selected) renderInspector();
}

function tickFreshnessSurfaces() {
  tickClocks();
  refreshStalenessSurfaces();
}

function setConn(next) {
  if (state.conn === next) return;
  state.conn = next;
  connChangedAt = Date.now();
  renderConn();
}

/* ---------- connection + beacon ---------- */

const CONN_LABELS = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting…",
  stale: "Stale feed",
  offline: "Server unreachable",
};

/* The badge says how old the data is the moment it stops being fresh — a bare
   green "Live" beside a four-day-old snapshot is the trust failure this replaces. */
function connLabelText(conn, generatedAt, now = Date.now()) {
  const base = CONN_LABELS[conn] || conn;
  if (conn !== "live" && conn !== "stale") return base;
  const fresh = snapshotFreshness(generatedAt, now);
  if (fresh.state === "fresh" || fresh.state === "unknown") return base;
  return base + " · snapshot " + fmtElapsed(fresh.ageMs) + " ago";
}

function renderConn() {
  const badge = $("conn-badge");
  badge.className = "conn conn-" + state.conn;
  $("conn-label").textContent = connLabelText(state.conn, state.snap && state.snap.generatedAt);
  renderBeacon();
}

function renderBeacon() {
  const beacon = $("nest-beacon");
  beacon.classList.remove("calm", "flare");
  if (!state.snap || state.conn === "offline") return;
  beacon.classList.add(issuesOf(state.snap).length > 0 ? "flare" : "calm");
}

/* The alarm body. Split from the mount so the copy and the repair action can be
   asserted without a document. */
function feedAlarmNode(alarm) {
  return el("div", { class: "feed-alarm-inner" + (alarm.kind === "offline" ? " is-offline" : "") },
    icon(alarm.kind === "offline" ? "offline" : "warning", { label: "Alarm" }),
    el("div", { class: "feed-alarm-copy" },
      el("strong", { class: "feed-alarm-head", text: alarm.headline }),
      el("p", { class: "feed-alarm-detail", text: alarm.detail })),
    el("button", {
      type: "button",
      class: "btn feed-alarm-refresh",
      dataset: { fkey: "feed-alarm-refresh" },
      onclick: () => recollectSnapshot(),
    }, "Refresh now"));
}

/* Unmissable by position, not by animation: a full-width bar between the
   masthead and the summary, in the operator's reading path, carrying the age and
   the one action that can fix it. `feed-frozen` on <body> is what lets the rest
   of the board grey itself out in the same beat. */
/* ---------- server health probe (/api/health) ----------

   The connection badge reports what THIS browser sees over SSE; the feed alarm
   reports staleness the client computes from `snapshot.generatedAt`. Both are
   client-side readings. `/api/health` is the server's own verdict on its own
   snapshot, and it is the same signal scripts/anthill-deploy.sh gates a deploy
   on — so an operator watching the dashboard now sees exactly what the deploy
   health check sees.

   Deliberately quiet: while the server agrees it is healthy this renders
   nothing, because the two surfaces above already carry every healthy-state
   fact and a third green light would just be a third thing to read. It speaks
   only when the server disowns its own snapshot (verdict "stale") or stops
   answering at all — the two cases the client-side readings can disagree with
   or miss entirely (a wedged server can keep a socket open). */
const SERVER_HEALTH_POLL_MS = 15_000;

async function pollServerHealth(fetchImpl = typeof fetch === "function" ? apiFetch : null) {
  if (!fetchImpl) return null;
  let next;
  try {
    const res = await fetchImpl("/api/health", { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    if (!res || res.ok !== true) {
      next = { ok: false, verdict: "unreachable", detail: "Health check returned " + ((res && res.status) || "no response") + "." };
    } else {
      const body = await res.json();
      next = body && body.ok === true
        ? { ok: true, verdict: "healthy", detail: "" }
        : {
          ok: false,
          verdict: (body && body.verdict) || "stale",
          detail: "The server reports its own snapshot as "
            + ((body && body.verdict) || "stale")
            + (body && body.snapshot && Number.isFinite(body.snapshot.ageMs)
              ? " (" + fmtElapsed(body.snapshot.ageMs) + " old)." : "."),
        };
    }
  } catch {
    // A refused/aborted request is itself the finding: the server is not answering.
    next = { ok: false, verdict: "unreachable", detail: "The server did not answer its health check." };
  }
  state.serverHealth = next;
  renderServerHealth();
  return next;
}

function renderServerHealth() {
  const node = $("server-health");
  if (!node) return;
  const health = state.serverHealth;
  // Absent (not yet polled) and healthy both render nothing — see the note above.
  const speak = !!health && health.ok !== true;
  node.hidden = !speak;
  if (!speak) {
    node.className = "server-health";
    node.textContent = "";
    node.removeAttribute?.("title");
    return;
  }
  node.className = "server-health is-" + (health.verdict === "unreachable" ? "unreachable" : "stale");
  node.textContent = "";
  node.setAttribute("role", "img");
  node.setAttribute("title", "Server health: " + health.verdict + " — " + health.detail);
  node.setAttribute("aria-label", "Server health: " + health.verdict + ". " + health.detail);
}

function renderFeedAlarm() {
  const bar = $("feed-alarm");
  if (!bar) return;
  const alarm = feedAlarm(state.conn, state.snap && state.snap.generatedAt);
  if (document.body) document.body.classList.toggle("feed-frozen", !!alarm);
  // Visibility is set on EVERY paint, before the guard: the signature only
  // decides whether the subtree is worth rebuilding, and a guard that can also
  // suppress `hidden` is one seed-value collision away from a silent alarm.
  bar.hidden = !alarm;
  const sig = alarm ? alarm.kind + "\u001f" + alarm.headline : "";
  if (state.paintSig.alarm === sig) return;
  state.paintSig.alarm = sig;
  bar.textContent = "";
  bar.className = "feed-alarm";
  if (alarm) bar.append(feedAlarmNode(alarm));
}

/* ---------- rendering ---------- */

function paintUnchanged(key, signature) {
  if (state.paintSig[key] === signature) return true;
  state.paintSig[key] = signature;
  return false;
}

function findingPaintKey(finding) {
  return [
    finding.kind, finding.id, finding.work.key, finding.progress,
    finding.title, finding.summary, finding.impact, finding.pin ? "1" : "0",
    state.selected && state.selected.kind === finding.kind && state.selected.id === finding.id ? "1" : "0",
  ].join("\u001f");
}

function mobileDrawerBodyOwnsScroll() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(max-width: 860px)").matches;
}

/* Agent drawers moved their non-transcript scrolling out of the pane: Evidence
   owns it at desktop/tablet, while the single drawer body owns it on mobile.
   Other drawer kinds still scroll the pane itself. Keep that responsive choice
   in one place so capture and restore can never address different elements. */
function drawerScrollOwner(inspector, mobile = mobileDrawerBodyOwnsScroll()) {
  if (!inspector || !inspector.classList?.contains("dw-agent")) return inspector;
  const grid = [...(inspector.children || [])]
    .find((node) => node.classList?.contains("drawer-grid"));
  if (!grid) return inspector;
  if (mobile) return grid;
  return [...(grid.children || [])]
    .find((node) => node.classList?.contains("drawer-desk")) || inspector;
}

function captureDrawerScroll(inspector, mobile = mobileDrawerBodyOwnsScroll()) {
  const top = Number(drawerScrollOwner(inspector, mobile)?.scrollTop);
  return Number.isFinite(top) ? top : 0;
}

function restoreDrawerScroll(inspector, top, sameEntity, mobile = mobileDrawerBodyOwnsScroll()) {
  const owner = drawerScrollOwner(inspector, mobile);
  if (owner) owner.scrollTop = sameEntity ? top : 0;
}

function render() {
  const focusKey = document.activeElement && document.activeElement.dataset
    ? document.activeElement.dataset.fkey
    : null;
  const main = $("main");
  const listScroll = main.scrollTop;
  const inspector = $("inspector");
  const inspectorScroll = captureDrawerScroll(inspector);
  // Whether the operator was standing INSIDE the drawer, so the restore below can
  // tell "their control went away" from "they were never in here".
  const focusWasInDrawer = Boolean(document.activeElement && inspector.contains(document.activeElement));
  /* The same question about the attention panel, and it has to be asked
     separately: the drawer and the panel are disjoint subtrees, so the answer
     above says nothing about a keyboard operator standing on a notification row. */
  const focusWasInPanel = Boolean(document.activeElement
    && $("notifications-panel")?.contains(document.activeElement));
  // What the drawer is showing RIGHT NOW, read before renderInspector overwrites
  // the signature. state.selected is already the new entity by this point —
  // selectEntity sets it and then calls render — so the pane's own last paint is
  // the only record of which entity the captured responsive scroll belongs to.
  const inspectorShowed = paintedEntityKey(state.paintSig.inspector);

  renderConn();
  renderFeedAlarm();
  renderHealthRail();
  /* The toggle carries a snapshot-derived count, so it has to repaint with the
     board. It used to be painted once in boot() and on click, which was fine
     while the label was pure preference state — but boot() runs before the first
     snapshot, so the badge would have been stuck at zero forever.
     renderNotificationCenter paints it now, off the same feed the panel lists,
     so the button and the panel cannot disagree about who is waiting. */
  renderNotificationCenter();
  renderTabs();
  renderFilterBar();
  // Its own step, not a tail of the widget paint — see renderPulseStrip.
  renderSettingsPanel();
  renderPrograms();
  renderInspector();
  syncInspectorViewportHeight(inspector);
  renderSkeleton();
  renderEmpty();

  // Rebuilding the list momentarily collapses pane height, which clamps the
  // scroll position — restore it so live updates never yank the operator.
  main.scrollTop = listScroll;
  /* Same entity as before the paint: this was a live update under a drawer the
     operator is reading, so put them back where they were. Different entity:
     they flicked to another agent, and carrying the offset over lands them
     part-way down a stranger's drawer with its name scrolled off the top —
     measured at 291px on a 370px pane, with the <h2> 246px above the fold. A
     new selection starts at its own beginning. */
  restoreDrawerScroll(
    inspector,
    inspectorScroll,
    paintedEntityKey(state.paintSig.inspector) === inspectorShowed,
  );

  if (focusKey) {
    const node = document.querySelector(`[data-fkey="${CSS.escape(focusKey)}"]`);
    if (node) node.focus({ preventScroll: true });
    /* The control renamed itself under the repaint it triggered, so the lookup
       above finds nothing and focus falls to <body> — the top of the document,
       from inside the panel the operator was working in. The Evidence disclosure
       does exactly this: it is `shelf:evidence:open` before the click and
       `shelf:evidence:close` after. Measured with a real Enter keypress on the
       rail: activeElement === body.

       The drawer's own lead is the fallback, deliberately and not something
       cleverer. Matching the fkey's prefix would have found the renamed control
       itself, but `act:<id>:interrupt` and `act:<id>:archive` share a prefix too,
       and landing a keyboard operator on Archive because Interrupt went away is a
       worse failure than the one being fixed. Only while the drawer is still
       open: closeInspector runs its own return after its render, and stealing
       focus back into a pane on its way out would fight it. */
    else if (focusWasInDrawer && !inspector.hidden) focusDrawerLead();
    /* The panel's own lead, for the failure the comment above describes arriving
       from the other surface: here the fkey is gone because the ROW is gone.

       That is the ordinary event on this board rather than an edge case — an
       agent answered in its terminal stops asking, and the next snapshot drops
       its row. Measured on the live board: focus on a row's Reply, the agent
       stops asking, repaint — activeElement === body, with the panel still open
       and the operator thrown to the top of the document from inside it.

       Deliberately the same query toggleNotificationsPanel uses on open, so the
       panel has ONE first control however you arrive at it; two queries here
       would mean the answer depended on whether you opened the panel or had a
       row vanish under you. Only while it is still open, for the reason the
       drawer's branch carries !inspector.hidden: pulling focus back into a
       surface the operator just dismissed is a worse failure than the one being
       fixed. The toggle is the floor — a panel whose every control has just left
       still has the button that opened it. */
    else if (focusWasInPanel && state.notifyPanelOpen) {
      const lead = $("notifications-panel")?.querySelector("button:not([disabled])");
      (lead || $("notify-toggle"))?.focus({ preventScroll: true });
    }
  }
}

/* On a full-height desktop viewport, the drawer begins below the masthead and
   health rail. As the document scrolls, sticky positioning moves that top edge
   toward its 20px inset. Measure the pane's visible top so the freed header
   space becomes usable drawer height while its footer stays anchored.

   The 800px height floor preserves the compact-height layout's existing feed
   budget. Browser zoom changes the CSS viewport and fires resize, so this also
   stays correct at 100% on a 1080p display without hard-coding masthead pixels. */
function syncInspectorViewportHeight(pane = $("inspector")) {
  if (!pane || !pane.style) return;
  const desktopTall = typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(min-width: 1025px) and (min-height: 800px)").matches;
  if (pane.hidden || !document.body.classList.contains("inspector-open") || !desktopTall
      || typeof pane.getBoundingClientRect !== "function") {
    pane.style.removeProperty("--inspector-visible-top");
    return;
  }
  const visibleTop = pane.getBoundingClientRect().top;
  if (!Number.isFinite(visibleTop)) return;
  pane.style.setProperty("--inspector-visible-top", Math.max(0, visibleTop) + "px");
}

let inspectorViewportHeightFrame = null;
function scheduleInspectorViewportHeight() {
  if (inspectorViewportHeightFrame !== null) return;
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    syncInspectorViewportHeight();
    return;
  }
  inspectorViewportHeightFrame = window.requestAnimationFrame(() => {
    inspectorViewportHeightFrame = null;
    syncInspectorViewportHeight();
  });
}

/* Highest live context-window usage across reporting sessions — answers
   "is any agent close to filling its window?" honestly, or null if unknown. */
function peakContext(snap) {
  let peak = null;
  for (const { agent } of snapshotAgents(snap)) {
    if (deriveActivity(agent) === "ended") continue;
    const ctx = contextUsage(agent.tokens);
    if (ctx && (peak == null || ctx.pct > peak.pct)) peak = { pct: ctx.pct, agent };
  }
  return peak;
}

function reading(label, valueNode, subNode, extraClass, attrs = {}) {
  const labelNode = label && label.nodeType
    ? label
    : el("span", { class: "reading-label", text: label });
  return el("div", { class: "reading" + (extraClass ? " " + extraClass : ""), ...attrs },
    labelNode,
    valueNode,
    subNode || null);
}

function toggleMomentumMagnify(event) {
  if (event && event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
  if (event && event.type === "keydown") event.preventDefault();
  state.momentumMagnify = !state.momentumMagnify;
  render();
}

/* Who Momentum is counting — and therefore who it magnifies. Defaults to the
   strip population so a future CTA number can reuse the same set. */
function momentumPopulation(agent, snap = state.snap) {
  return stripAlerting(agent, snap);
}

function toggleContextDisplay() {
  state.contextDisplay = state.contextDisplay === "tokens" ? "percent" : "tokens";
  render();
}

function widgetLabelNode(id, label, interactive = true) {
  if (id !== "context-peak" || !interactive) return el("span", { class: "reading-label", text: label });
  return el("button", {
    type: "button",
    class: "reading-label context-toggle",
    "aria-label": state.contextDisplay === "percent" ? "Show Context tokens" : "Show Context %",
    "aria-pressed": String(state.contextDisplay === "tokens"),
    title: "Toggle context display",
    dataset: { fkey: "context-toggle" },
    onclick: toggleContextDisplay,
  }, label);
}

/* Compact verdict chip — the health cell's OK form (trailing micro-chip on
   both the stressed grid and the calm line). */
/* S6-T3 · the Clean up action, and the one thing that may move while it runs.

   It lives on the instrument-trust chip because debris is what degrades the
   INSTRUMENTS — the chip repairing itself — where Refresh acts on a finding and
   went to the notification center with it in S2-T2.

   Minimal by contract: a rotating indicator on the chip and nothing else. No
   banner, no progress bar. The indicator states that A PROCESS IS UNDERWAY and
   must never imply the fault is fixed, which is why the chip's own verdict word
   is untouched while it spins and why the label reads "Examining…" rather than
   anything in the past tense.

   The tooltip names three things the operator cannot otherwise know: what is
   running, what it is examining, and that nothing will be deleted without
   approval. That last clause is not reassurance — it is the contract, and a
   button labelled "Clean up" that did not say it would be read as destructive.

   prefers-reduced-motion: the rotation is switched off in CSS by a media query.
   That media feature CANNOT be emulated in this project's browser harness, so
   the static variant is asserted at rule level only and is NOT verified live —
   recorded here rather than implied, the way the a11y sweep records its own
   NOT RUN row. */
function cleanupAction() {
  /* Two things can be in flight and they are different facts: the propose sweep
     the board runs itself, and the Cleaner LANE it launched. `examining` is the
     first; every other state is read from the second's session — see cleaner.js,
     where the whole derivation lives and is testable without a DOM. */
  const examining = state.cleanup.running;
  const view = cleanerView(state.snap, state.cleaner);
  const busy = examining || CLEANER_IN_FLIGHT.has(view.state);
  const label = examining ? "Examining…" : CLEANER_LABELS[view.state] || "Clean up";
  /* A stated failure, never a spinner that outlives its cause. The route names
     which step refused and that sentence is what the operator reads. */
  const failed = !examining && view.state === "failed";
  const asking = !examining && view.state === "needs-you";
  /* S5: the ring lands on an OBSERVED edge — the paint where the lane the board
     asked for first appears on it. cleanerLastState is the previous derived
     answer, so this cannot re-fire on a repaint, and it cannot fire at all
     without a session having actually shown up. */
  const landing = cleanerLands(cleanerLastState, view.state);
  cleanerLastState = view.state;
  const running = busy;
  return el("button", {
    type: "button",
    class: "verdict-cleanup"
      /* Spin only while genuinely waiting with nothing to show; land once when
         the lane appears; then hold the landed ring while it works. A ring that
         resumed spinning after landing would un-terminate its own motion, and
         once the Cleaner is on the board the board's ROW is where progress
         lives — this chip has handed off to it. */
      + (landing ? " is-landing"
        : examining || view.state === "launching" ? " is-running"
          : view.state === "watching" ? " is-alive" : "")
      + (failed ? " is-failed" : "")
      + (asking ? " is-asking" : ""),
    /* aria-disabled, NOT disabled. A disabled element leaves the tab order, and
       this button is rebuilt on the same paint that disables it — so render()'s
       fkey restore found the new node, called focus() on something disabled,
       and the call did nothing. Measured: activeElement === body the instant a
       keyboard operator activated Clean up, and it never came back, because the
       next paint read its focusKey off <body> and had nothing to restore.
       aria-disabled says the same thing to assistive tech while keeping the
       control focusable; requestCleanupProposal already refuses re-entry. */
    "aria-disabled": running ? "true" : null,
    "aria-busy": running ? "true" : null,
    title: examining
      ? "Enumerating worktrees, branches and the process table. Nothing will be deleted without your approval."
      : view.message
        || "Launch a Cleaner: it proposes first, asks you here, and only removes what you approve. Nothing is deleted without your answer.",
    dataset: { fkey: "cleanup-propose" },
    /* R2′: the board LAUNCHES a lane; it still never deletes. The gate did not
       disappear, it moved onto the board — the Cleaner asks as an ordinary agent
       and the operator answers it the way they answer every other one. */
    onclick: (e) => { e.stopPropagation(); void runCleanupFlow(); },
  },
    el("span", { class: "verdict-cleanup-mark", "aria-hidden": "true" }),
    label);
}

/* Whether the sweep is worth offering.

   THE ORIGINAL RULE IS KEPT, because it is still half the answer: a permanent
   Clean up button on a tidy board is a standing suggestion that something is
   wrong, which is the scold this program removes. That is why this still returns
   false whenever the chip reads healthy, and why there is no second entry point
   anywhere else — one control, one home.

   WIDENED 2026-08-06, because the old gate made the control unfindable. It was
   offered only when debris had already been COUNTED (`remedy.tidy &&
   remedy.paneCount`, from controlHealth), which is absent on most boards. So the
   button was correct and invisible: an operator went looking for Clean up,
   could not find it, and reasonably guessed it was the drawer's archive control.
   A control you cannot find is a control you cannot trust, and an action nobody
   can reach is not a quieter UI — it is a missing one.

   The new gate is the chip's own verdict: offer it whenever the chip is DEGRADED
   for ANY reason — stale source, collector error, debris, anything that makes it
   say something other than healthy. The operator is already being told something
   is wrong, and this is the one action they have; offering it there is help, not
   nagging. The scold case — a healthy board — is untouched.

   Still propose-only, always. R2 stands: the board never deletes. */
function cleanupOffered() {
  if (state.cleanup.running || state.cleanup.view || state.cleanup.error) return true;
  const remedy = healthRemedy(state.snap);
  if (remedy && remedy.tidy && remedy.paneCount) return true;
  /* The same predicate renderInstrumentBlock calls `degraded`, so the button and
     the sentence explaining why it is there can never disagree about whether the
     instruments are in trouble. */
  return systemStatus(state.snap, state.conn).key !== "operational";
}

function healthMicroChip(data) {
  /* An advisory rides at micro too, so this chip is the ONLY place its
     consequence sentence can still be read — carry it, or shrinking the cell
     would silently delete the explanation along with the alarm. */
  /* A clear board rides at micro, so this chip is where pending tidy-up has to
     survive: the instruction rides on the tooltip rather than being promoted
     into a cell it has not earned. Quiet, but not lost. */
  const detail = [data.severityDetail, data.sublabel, data.remedy && data.remedy.instruction]
    .filter(Boolean).join(" ");
  return el("span", { class: "verdict-chip verdict-" + data.tone, title: detail || data.sublabel },
    icon(data.icon), data.value,
    cleanupOffered() ? cleanupAction() : null);
}

/* Which repair control, if any, the health cell should offer.

   It used to offer "Refresh" for every degraded and advisory state. Measured on
   the live board: the cell said "4 live sessions can't take commands … until one
   is closed" and then rendered a button that re-pulls the snapshot — naming the
   correct action and offering a different one, with the only affordance present
   being the one that cannot help.

   A control is offered only when re-pulling evidence could change the answer:
   the fetch itself failed, the feed is not live, or the fault is repaired OUTSIDE
   this app (cmux is down; the operator starts it, then confirms). An
   evidence-based advisory — two sessions sharing a pane — is fixed by closing one
   and the collector rescans on its own, so there is nothing to offer. */
function healthRefreshAction(ui = state) {
  if (ui.fetchFailed || ui.conn !== "live") {
    return { label: "Retry snapshot", title: "Re-pull the latest snapshot evidence" };
  }
  const control = ui.snap && ui.snap.controlHealth;
  if (control && control.cmuxReachable !== true) {
    return { label: "Verify repair", title: "Re-probe cmux after starting it" };
  }
  return null;
}

function renderSummaryWidget(id, weight = "normal", data = summaryWidgetData(id, state.snap, state.conn, state.contextDisplay), compact = false) {
  const meta = WIDGET_CATALOG.find((widget) => widget.id === id);
  const cellClass = "reading-widget widget-" + id
    + (weight === "hot" ? " cell-hot" : weight === "micro" ? " cell-micro" : "");
  // A healthy control plane stays a trailing micro-chip; any degradation
  // promotes the cell back to full width below.
  if (id === "health" && weight === "micro") {
    return el("div", { class: "reading " + cellClass }, healthMicroChip(data));
  }
  const valueClass = ["reading-value", data.tone === "hot" ? "is-hot" : "", data.tone === "ok" ? "is-ok" : "", data.tone === "missing" ? "reading-no-data" : ""]
    .filter(Boolean).join(" ");
  let valueNode;
  if (id === "health") {
    /* The Clean up control USED to sit here, appended to the verdict.
       S6 of the Cleaner plan moved it to the end of the detail line below. Three
       reasons, and the third is the cause: at verdict type size, immediately
       after "Readings degraded", it parsed as a BADGE on the heading — and
       badges do not get pressed; it had no anchor, so its x moved with the
       length of the verdict word; and it acts on the sentence BELOW it, since
       the fault is named in the detail line. It was a control one line above
       its own subject. */
    valueNode = el("span", { class: valueClass },
      el("span", { class: "verdict-chip verdict-" + data.tone }, icon(data.icon), data.value));
  } else if (id === "mix" && Array.isArray(data.mixProviders) && data.mixProviders.length) {
    valueNode = el("span", { class: "mix-row " + valueClass },
      ...data.mixProviders.map(({ prov, n }) => el("span", { class: "mix-seg" },
        el("span", { class: "prov-dot is-" + String(prov || "prime").toLowerCase() }),
        el("span", { class: "prov-name", text: providerLabel(prov) }),
        String(n),
      )));
  } else {
    valueNode = el("span", { class: valueClass }, data.value,
      data.unit ? el("span", { class: "unit", text: data.unit }) : null);
  }
  const subNode = el("span", { class: "reading-sub" });
  if (data.meterPct != null) {
    subNode.append(svgGauge(data.meterPct, "ctx-gauge", {
      fillClass: "gauge-fill",
      trackClass: "gauge-track",
      marks: data.gaugeMarks,
      /* The accessible name carries every reading the dial draws. A gauge whose
         label names only the needle hides the ticks from anyone not looking at
         it, which is most of the point of drawing them.

         It leads with `meterLabel` rather than a hardcoded "Peak context": S3
         moved the peak off the headline, and a label that still announced it
         first would have kept the demoted reading in the most prominent place
         for exactly the users who cannot see the arc. */
      label: [data.meterLabel || `${data.meterPct}%`, ...(data.gaugeMarks ?? []).map((mark) => mark.label)].join(", "),
    }));
    /* The toggle only appears when there are two readings to choose between —
       offering it with one is a control that does nothing, which this codebase
       treats as a lie about capability everywhere else. */
    if (data.spreadToggleable) {
      subNode.append(el("button", {
        type: "button",
        class: "spread-toggle",
        dataset: { fkey: "context-spread" },
        /* Inverted by S3: this used to swap the sublabel's wording under a fixed
           peak headline. It now swaps which reading LEADS. */
        title: "Switch the headline between the average and the median",
        "aria-label": `Context headline is the ${data.spreadMode}. Switch to the ${data.spreadMode === "average" ? "median" : "average"}.`,
        onclick: () => {
          state.contextSpread = state.contextSpread === "average" ? "median" : "average";
          try { localStorage.setItem(CONTEXT_SPREAD_KEY, state.contextSpread); } catch { /* private mode */ }
          render();
        },
      }, data.spreadMode === "average" ? "avg" : "med"));
    }
  }
  /* S2-T2. The card no longer names the top finding, offers a remedy, lists
     leftover panes or carries Refresh. It is a QUALIFIER: it says whether the
     instruments behind every other reading can be trusted, and stops. All four
     of those moved to the notification center, where the fault is an item with
     evidence, an impact and a route — see the instrument block in
     renderNotificationCenter. What stays here is the since-note and the
     snapshot age, because those qualify the reading itself. */
  const degraded = id === "health" && (data.tone === "degraded" || data.tone === "advisory");
  const reason = null;
  const sinceNote = degraded ? degradedSinceText(state.snap) : "";
  const snapNote = id === "health" && state.snap?.generatedAt ? ` · snapshot ${agoText(state.snap.generatedAt)}` : "";
  /* The severity badge used to lead this line because the headline was the bare
     word "Degraded" and could not answer "am I blocked?". The headline is the
     severity itself now, so repeating it here just printed ADVISORY under
     Advisory. The consequence sentence is the part that was carrying the
     information, and it stays. */
  /* Three answers in the order an operator asks for them: what is wrong, what
     to do about it, then the controls to do it. The finding's title used to
     occupy this first line, which spent the card's most-read sentence on the
     collector's name for the problem ("CMUX identity conflicts") instead of its
     consequence for the operator. The title is still reachable — it labels the
     Refresh control — but it no longer stands in for an explanation. */
  const remedy = data.remedy;
  /* The generic severity blurb and a specific problem sentence contradict each
     other when both print: "The board is usable; evidence needs tidying. 3 live
     sessions can't take commands." is the same self-disagreement the headline
     used to have with its own badge. The specific sentence wins outright.
     (That advisory string now reads "some evidence is incomplete" — it stopped
     prescribing a remedy that may not fit the fault. The rule here is unchanged:
     a specific sentence still beats any generic one.) */
  /* The severity's own detail already IS the consequence sentence, so printing
     the generic sublabel after it says cmux is unreachable twice in one line.
     Seen on the live board: "cmux unreachable — Focus and Send cannot route.
     cmux unreachable — terminal titles and Focus/Send stay offline." */
  /* THE SPECIFIC SENTENCE WINS — which is what the comment above always said,
     applied the right way round. This used to blank problemText whenever a
     severityDetail existed, so the specific line lost to the generic one on every
     degraded board. Emilio read the result as "it just says Whoops": the chip
     printed "The board is usable; evidence needs tidying" and swallowed "Cursor
     is not reporting cleanly — the collector's own words are in Notifications."

     The duplication that rule was written for is still handled, and better: the
     cmux case printed severityDetail AND sublabel saying the same thing twice.
     Now exactly one sentence prints, and it is the more specific one. The generic
     severity blurb is the fallback for a state with nothing better to say. */
  /* ADVISORY is the one severity whose detail is a constant. blocking and stale
     both override theirs with a sentence derived from the actual fault ("cmux
     unreachable — Focus and Send cannot route", "Last refresh failed — showing
     the previous good snapshot"), and those beat any sublabel. Advisory's is a
     fixed string that describes the class and never the cause, so there it is
     the sublabel that carries the information and the constant that should give
     way. Blanking problemText whenever ANY severityDetail existed made the
     generic case win too, which is what Emilio read as "it just says Whoops". */
  const genericSeverity = data.severityKey === "advisory";
  const problemText = (remedy && remedy.problem)
    || (reason ? reason.title
      : genericSeverity
        ? (data.sublabel || data.severityDetail)
        : (data.severityDetail || data.sublabel));
  const lead = "";
  /* The finding-link branch stood here — two buttons routing into the inspector,
     landed at 4bcbd84 by a concurrent lane. It is removed with the card that
     carried it, and the reason is the seam rather than the code: THE HEADER
     NEVER LINKS. A reading that routes somewhere is a to-do wearing a metric's
     clothes, and the moment one exists an operator has two places to look for
     the same thing. Both of those findings are in the notification center now,
     each with its evidence sentence, its impact and its route. */
  subNode.append(el("span", { class: "reading-sub-text", text: lead + problemText + sinceNote + snapNote }));
  /* The action, with the sentence it acts on, anchored to the card's right edge.
     The fault is described on THIS line; the control belongs beside its subject
     rather than beside the verdict, and the edge gives it a fixed x instead of
     one that drifts with the copy.

     The row takes a class of its own rather than being styled off `.widget-health`:
     the widget class is built as "widget-" + id and never appears literally in
     the source, so the orphan-CSS guard cannot see it — and scoping by what the
     row IS (a detail line carrying an action) beats scoping by which reading it
     happens to belong to. */
  if (id === "health" && cleanupOffered()) {
    subNode.classList.add("reading-sub-action");
    /* A launch refusal SAYS WHAT HAPPENED, on the line, not just in a title.
       The server answers with a code and a sentence and the chip used to collapse
       both to the word "failed" — a fact on the wire, a category on the screen,
       which is the defect this program has been pulling out of every surface it
       touches. The code is carried too, in mono, so a bug report is greppable. */
    const failure = cleanerView(state.snap, state.cleaner);
    if (failure.state === "failed") {
      subNode.append(el("span", { class: "cleanup-failure" },
        failure.code ? el("code", { class: "mono cleanup-failure-code", text: failure.code }) : null,
        el("span", { class: "cleanup-failure-said", text: failure.message }),
        /* …and what it MEANS, which is a different question from what refused.
           "cursor-agent create-chat timed out" is a fact; "this board cannot
           spawn Cursor sessions right now, cleanup is not broken" is the thing
           the operator needed to know. */
        failure.meaning ? el("span", { class: "cleanup-failure-means", text: failure.meaning }) : null));
    }
    subNode.append(cleanupAction());
  }
  if (remedy && remedy.instruction) {
    subNode.append(el("p", { class: "reading-remedy", text: remedy.instruction }));
  }
  /* The pane disclosure and the Refresh button stood here. Both are controls,
     and a control in the confidence header is the header doing attention's job
     — the same rule that retired the finding links. They are in the
     notification center's instrument block now, together, next to the sentence
     that says what is wrong. */
  const momentumAttrs = id === "momentum"
    ? {
      role: "button",
      tabindex: "0",
      "aria-pressed": String(Boolean(state.momentumMagnify)),
      "aria-label": state.momentumMagnify
        ? "Stop magnifying needs-you rows"
        : "Magnify needs-you rows",
      title: "Lift sessions that need you; the rest of the Board recedes",
      dataset: { fkey: "momentum-magnify" },
      onclick: toggleMomentumMagnify,
      onkeydown: toggleMomentumMagnify,
    }
    : {};
  const momentumClass = id === "momentum"
    ? " momentum-cta" + (state.momentumMagnify ? " is-momentum-armed" : "")
    : "";
  return reading(widgetLabelNode(id, meta.label, !compact), valueNode, subNode, cellClass + momentumClass, momentumAttrs);
}

function setWidgetEnabled(id, enabled) {
  const meta = WIDGET_CATALOG.find((widget) => widget.id === id);
  if (!meta || meta.required) return;
  const next = state.widgetIds.filter((widgetId) => widgetId !== id);
  if (enabled) next.push(id);
  state.widgetIds = normalizeWidgetIds(next);
  saveWidgetPreferences();
  renderHealthRail();
}

function moveWidget(id, direction) {
  const next = reorderWidgetIds(state.widgetIds, id, direction);
  if (next.join("|") === state.widgetIds.join("|")) return;
  state.widgetIds = next;
  saveWidgetPreferences();
  renderHealthRail();
}


/* ---------- the notification center ----------

   Attention's one home. The model is notification-center.js; what lives here is
   the paint, because the row's controls have to reuse the board's OWN capability
   gate (`capability` + `renderDockTool` + `sendControl`) and its own router
   (`selectEntity`), and those are private to this file. A second send path
   beside them is exactly the drift this program exists to remove. */

function closeNotificationsPanel(returnFocus = true) {
  if (!state.notifyPanelOpen) return;
  state.notifyPanelOpen = false;
  render();
  if (returnFocus) $("notify-toggle")?.focus();
}

function toggleNotificationsPanel() {
  state.notifyPanelOpen = !state.notifyPanelOpen;
  render();
  if (state.notifyPanelOpen) {
    // Into the panel, not left on the button: a disclosure the operator opened
    // is a place they meant to go.
    const first = $("notifications-panel")?.querySelector("button:not([disabled])");
    if (first) first.focus();
  } else {
    $("notify-toggle")?.focus();
  }
}

/* The panel's OWN signature, deliberately not hung off the widgets guard.
   That guard covers the summary rail; a panel that shared it repainted when the
   rail happened to change and froze when it did not — the settings panel's bug,
   and the reason renderSettingsPanel got a signature of its own. */
function notifyPanelPaintSig(model, open) {
  return [
    open ? "1" : "0",
    model.tone,
    String(model.count),
    model.lede + "|" + model.rest + "|" + model.incomplete,
    // Row identity AND the sentence each row is showing: an agent that changes
    // what it is asking must repaint even though the roster did not move.
    [...model.groups.flatMap((g) => g.items), ...model.watching, ...model.investigations]
      .map((item) => item.id + "~" + item.since + "~" + item.evidence + "~" + item.lifecycle).join(","),
    state.notify.enabled ? "on" : "off",
    state.notify.permission,
    /* The instrument block lives in this panel, so its inputs belong in this
       signature — otherwise a control plane that goes down while the panel is
       open would never repaint the one place that now says so. */
    systemStatus(state.snap, state.conn).key,
    String((healthRemedy(state.snap) || {}).paneCount ?? ""),
    healthPanesOpen ? "panes" : "",
    /* The sweep's own state, or the panel would freeze mid-run: the indicator
       starts and the plan arrives without any snapshot value changing. */
    state.cleanup.running ? "sweeping" : "",
    String(state.cleanup.at),
    state.cleanup.error,
    /* The Cleaner lane's binding, for the same reason the sweep's state is here:
       the chip follows a SESSION, and its state changes when that session
       changes without any signed widget value moving. Omitting this is exactly
       the CLEAN-1 defect — the header simply never repainted during a sweep and
       the whole running state was unreachable from the control that starts it. */
    state.cleaner.sessionId,
    /* …and the DERIVED state, not just the binding. The chip's words change when
       the Cleaner's session changes — working to asking, asking to ended — and
       none of that moves a widget value either. Signing only the session id
       would repaint on adoption and then freeze for the rest of the run, which
       is CLEAN-1 again one level down. */
    cleanerView(state.snap, state.cleaner).state,
    state.cleaner.error,
    feedFrozen() ? "held" : "",
    /* SYNC-NF. The unread terminal set is NOT in `model` — that model is the
       board's own attention derivation over sessions, and these are cmux's own
       notifications — so without this a cleared notification would sit on
       screen until something unrelated moved the signature. */
    unreadCmuxNotifications(state.snap).map((note) => note.id).join(","),
  ].join("\u001f");
}

/* Focus reuses the dock's tool verbatim — same capability gate, same confirm
   strip, same busy state, same disabled reason — with an fkey prefix so focus
   restore binds to the instance that was clicked rather than to the drawer's
   twin. Reply does NOT: its gate is the command dock's composer, which cannot
   be reused inside a dropdown without building a second send path. So Reply
   takes the documented degradation and SAYS SO on the control: it opens the
   session's inspector, where the reply box already is. */
function notifyRowActions(item) {
  const acts = el("span", { class: "notify-row-acts" });
  if (item.route && item.route.kind === "unbound-waiting") {
    const noteId = item.route.id;
    const verb = (action, label) => el("button", {
      type: "button",
      class: "notify-act",
      disabled: syncPending.has("notify:" + noteId) ? "" : null,
      "aria-label": label + ": " + (item.impact || "no session bound"),
      dataset: { fkey: "sync-notify:" + action + ":" + noteId },
      onclick: () => { void clearCmuxNotification(noteId, action); },
    }, label);
    acts.append(verb("mark_read", "Mark read"), verb("dismiss", "Dismiss"));
    return acts;
  }
  const found = agentsById(state.snap).get(item.source.agentId);
  if (!found) return acts;
  const focusCap = capability(found.agent, "focus");
  if (focusCap) {
    acts.append(renderDockTool(found.agent, focusCap, "focus", {
      fkeyPrefix: "notify:",
      /* Named for the list it sits in, not for the dock it borrows: several
         agents' Focus buttons coexist here and "Focus" alone told a screen
         reader nothing about which one.

         The agent's name and nothing else. The first draft appended
         focusDestinationHint and was measured reading aloud as "Focus Execute
         lane F-1 — Jump to COOPER DRAFT · F1 pane · Claude bare ·… ·
         /Users/…/cooper-scheduler.worktrees/draft-f1" — a home path spoken one
         segment at a time, on every row. The name has to disambiguate, which
         the agent's name already does; the destination stays on `title`, where
         it is a description an operator can ask for rather than one they must
         sit through. */
      ariaLabel: "Focus " + agentName(found.agent),
    }));
  }
  acts.append(el("button", {
    type: "button", class: "notify-act",
    dataset: { fkey: "notify:reply:" + found.agent.id },
    title: "Opens this session's inspector, where the reply box is.",
    "aria-label": "Reply to " + agentName(found.agent) + " — opens its inspector, where the reply box is",
    onclick: () => { closeNotificationsPanel(false); selectEntity({ kind: "agent", id: found.agent.id }); },
  }, "Reply in inspector"));
  return acts;
}

function notifyRow(item) {
  const unbound = item.route && item.route.kind === "unbound-waiting";
  const trace = unbound
    ? "no session bound"
    : [item.source.agentName, (agentsById(state.snap).get(item.source.agentId) || {}).agent?.provider]
      .filter(Boolean).join(" · ");
  return el("div", { class: "notify-row is-blocking" },
    el("div", { class: "notify-row-top" },
      /* The title line is the ROUTE. A whole-row button would have to contain
         the Focus and Reply buttons, and a button inside a button is not a
         thing a browser or a screen reader can make sense of. */
      el("button", {
        type: "button", class: "notify-row-open",
        dataset: { fkey: "notify:open:" + item.id },
        "aria-label": unbound
          ? item.impact
          : item.impact + " In " + (item.source.programName || "an unnamed program") + ". Opens the session.",
        onclick: () => { closeNotificationsPanel(false); selectEntity(item.route); },
      }, item.impact),
      /* A handoff row carries no age: `since` is permanently null for one, per
         S0-T1. The node is omitted rather than rendered empty — an empty slot
         beside three rows reads as a missing reading, and there is no reading
         missing. */
      notifyWaitText(item) ? el("span", { class: "notify-row-time", text: notifyWaitText(item) }) : null),
    el("div", { class: "notify-row-meta" },
      el("span", { class: "notify-row-trace", text: trace }),
      notifyRowActions(item)),
    item.evidence
      ? el("p", { class: "notify-peek" }, el("q", { text: item.evidence }))
      : null);
}

/* How long this RECORD has stood — a finding's openedAt, an investigation's
   createdAt. Both are durable server facts about a row in a store.

   Never a person's dead time: S0-T1 measured that no source can say when a
   block began, so a handoff item's `since` is null and this returns nothing for
   one. Never "0m" either — a zero here would be read as "just now", which is
   the opposite of what an unmeasurable age means. */
function notifyWaitText(item) {
  if (!item.since) return "";
  const ms = Date.now() - Date.parse(item.since);
  return Number.isFinite(ms) && ms >= 0 ? fmtElapsed(ms) : "";
}

/* The accessible name OVERRIDES the visible text, so it has to contain it.

   This row shows "<program> · <impact>" and named itself "<impact> <evidence>",
   dropping the program the operator can see — WCAG 2.5.3 Label in Name. A voice
   operator reading "the-ant-hill · …" off the screen and saying it got no match,
   and a screen-reader operator heard an agent with no program on a board where
   the same lane name recurs across several. The blocking row above already puts
   the program in its name ("… In <program>. Opens the session."); this is the
   same rule applied to the row that was missing it. Evidence stays on the end:
   it is the sentence read INSTEAD of opening the drawer, and it is not visible
   on this row, so it extends the name rather than contradicting it. */
function notifyQuietRow(item) {
  /* Evidence earns its own line only when it is not a restatement of the impact
     the row already shows. Compared on content rather than on kind, so a future
     item type gets the right treatment without this function learning about it. */
  const showsFault = Boolean(item.evidence) && item.evidence.trim() !== item.impact.trim();
  const visible = (item.source.programName ? item.source.programName + " · " : "") + item.impact;
  return el("button", {
    type: "button", class: "notify-quiet",
    dataset: { fkey: "notify:open:" + item.id },
    "aria-label": item.evidence ? visible + " " + item.evidence : visible,
    onclick: () => { closeNotificationsPanel(false); selectEntity(item.route); },
  },
    el("span", { class: "notify-quiet-name" },
      el("span", { class: "notify-quiet-line" },
        item.source.programName ? el("span", { class: "notify-quiet-prog", text: item.source.programName }) : null,
        item.source.programName ? " · " : null,
        item.impact),
      /* THE FACT, on screen. A quiet row used to put evidence in the accessible
         name only, so a dataflow item — which always lands in Watching — could
         carry "cursor GUI conversations: unable to open database file" and show
         the operator nothing but a consequence sentence. That is the surface
         saying Whoops: three layers of category rendered, the one line with a
         fault in it withheld.

         Only when it ADDS something. When evidence and impact say the same thing
         — which is every handoff row, where both derive from the same signal —
         a second line would be the row repeating itself. A span, not a <p>:
         this is inside a <button>, which may hold phrasing content only. */
      showsFault ? el("span", { class: "notify-quiet-fault" }, el("q", { text: item.evidence })) : null),
    el("span", { class: "notify-quiet-time", text: notifyWaitText(item) }));
}

/* ---------- SYNC-NF · the terminal's own notifications, in the panel ----------

   Minimal by instruction: this is one more section in the list the panel
   already draws, in the same section furniture (.notify-sect / .notify-eyebrow)
   as Watching and Running on its own. The notification center's own shape is
   unsettled and two competing mockups for it are unpicked — adjudicating that
   from inside this lane would be the redesign the kickoff forbids.

   It is here and not only on the rows because the clear verbs need a SINGLE
   notification to act on. A row's badge can stand for several, and a control
   that fans out over an unknown number of terminal alerts is a control whose
   effect the operator cannot predict before pressing it. */
function cmuxNotifyRow(note) {
  const name = [note.title, note.subtitle].filter((part) => typeof part === "string" && part.trim()).join(" — ")
    || "Untitled terminal notification";
  const verb = (action, label) => el("button", {
    type: "button",
    class: "cmux-notify-act",
    disabled: syncPending.has("notify:" + note.id) ? "" : null,
    /* Named for the notification, not for the verb. Several of these coexist in
       one panel, and "Mark read" alone tells a screen reader nothing about
       which terminal alert it is about to answer. */
    "aria-label": label + ": " + name,
    dataset: { fkey: "sync-notify:" + action + ":" + note.id },
    onclick: () => { void clearCmuxNotification(note.id, action); },
  }, label);
  return el("div", { class: "cmux-notify-row" },
    el("span", { class: "cmux-notify-name", text: name }),
    /* The body, which only this surface has: the event stream redacts it, so
       the server re-listed it. Bounded by the same helper the peek lines use. */
    note.body ? el("q", { class: "cmux-notify-body", text: conciseText(note.body, 140) }) : null,
    el("span", { class: "cmux-notify-acts" }, verb("mark_read", "Mark read"), verb("dismiss", "Dismiss")));
}

function renderCmuxNotifySection(snap = state.snap) {
  const unread = unreadCmuxNotifications(snap);
  if (!unread.length) return null;
  const section = el("section", { class: "cmux-notify", "aria-label": "Terminal notifications" },
    el("div", { class: "notify-sect" },
      el("span", { class: "notify-eyebrow", text: "Terminal" }),
      /* Says whose list this is. These are cmux's own notifications, not the
         board's readings about sessions — the two are different populations and
         a reader who conflates them will go looking for an agent that is fine. */
      el("span", { class: "notify-sect-hint", text: unread.length + " unread in cmux" })));
  for (const note of unread) section.append(cmuxNotifyRow(note));
  return section;
}

function renderNotificationCenter() {
  const panel = $("notifications-panel");
  const toggle = $("notify-toggle");
  if (!panel || !toggle) return;
  const open = Boolean(state.notifyPanelOpen);
  /* queueError rides in with the resolvers because the panel has to disclose a
     short list, and only the app knows the fetch failed. */
  const model = notificationPanelModel(state.snap, state.queueItems, Date.now(),
    { ...NOTIFY_DEPS, queueError: state.queueError });
  // One derivation, two surfaces: the badge is a reading off the same list the
  // panel renders, so the button can never disagree with what it opens.
  /* The badge's digit stays `model.count` — blocking only, per DESIGN-LANGUAGE.
     The SPOKEN name carries two more facts the digit cannot: how many sessions
     are asking (the strip's population, fleet-wide) and how many the watcher is
     merely keeping an eye on. Without the first, the bell could say "nobody
     waiting on you" over a strip with four rows in it. */
  const waiting = fleetStripAlerting(state.snap);
  renderNotifyToggle(model.count, model.tone, open, waiting, model.watching.length);
  panel.hidden = !open;
  if (paintUnchanged("notifyPanel", notifyPanelPaintSig(model, open))) return;
  panel.textContent = "";
  if (!open) return;

  /* No standby hero. The rev-2 mockup put a fleet dead-time total in the
     largest type here and S0-T1 measured that every candidate source for it is
     a write clock, a mid-wait repeat, or a journal that rolls away — so the
     number is not obtainable and the slot is gone rather than apologised for.
     The count leads, which it already did. */
  panel.append(el("div", { class: "notify-panel-head" },
    el("div", {},
      el("span", { class: "notify-eyebrow", text: model.verdict }),
      el("h2", { id: "notify-panel-title", class: "notify-lede", text: model.lede }),
      model.rest ? el("p", { class: "notify-rest", text: model.rest }) : null)));

  /* role=status, not a decoration: the list below is knowingly short and the
     operator has to be told before they read it as complete. */
  if (model.incomplete) {
    panel.append(el("p", { class: "notify-incomplete", role: "status", text: model.incomplete }));
  }

  for (const group of model.groups) {
    panel.append(el("div", { class: "notify-group" },
      el("span", { class: "notify-group-name mono", text: group.programName }),
      el("span", { class: "notify-group-count", text: group.items.length + " stopped" })));
    for (const item of group.items) panel.append(notifyRow(item));
  }

  panel.append(...renderInstrumentBlock());

  if (model.watching.length) {
    panel.append(el("div", { class: "notify-sect" },
      el("span", { class: "notify-eyebrow", text: "Watching" }),
      el("span", { class: "notify-sect-hint", text: "nothing is waiting on you" })));
    for (const item of model.watching) panel.append(notifyQuietRow(item));
  }

  if (model.investigations.length) {
    panel.append(el("div", { class: "notify-sect" },
      el("span", { class: "notify-eyebrow", text: "Running on its own" })));
    for (const item of model.investigations) panel.append(notifyQuietRow(item));
  }

  // SYNC-NF. Last of the lists, above the proof line: a terminal notification
  // is the least urgent thing on this panel — nobody is stopped by one — and it
  // is the only one carrying controls, so it goes where a scan ends.
  const terminalNotifications = renderCmuxNotifySection(state.snap);
  if (terminalNotifications) panel.append(terminalNotifications);

  /* All clear does not go blank. "Watching, found nothing" and "not watching"
     are the two states an empty panel is otherwise ambiguous between, and the
     collectors' own numbers are evidence a stalled client cannot produce. */
  if (model.proof) {
    const proof = [
      model.proof.working != null ? model.proof.working + " agents working" : "",
      model.proof.programs != null ? model.proof.programs + " programs watched" : "",
      model.proof.scanAgo ? "last scan " + model.proof.scanAgo + " ago" : "",
    ].filter(Boolean).join(" · ");
    panel.append(el("p", { class: "notify-proof mono", text: proof || "No collector has reported yet." }));
  }

  panel.append(renderNotifyDeliverySwitch());
}

/* S6-T2 · PROPOSE ONLY. The board never deletes.

   One POST to /api/cleanup/propose, which enumerates git state and the process
   table and writes a plan artifact. Deletion is a terminal paste of the plan's
   own confirmCommand — there is no confirm route, and wiring one to a click is
   explicitly out of bounds. The precedent is in this repo's history: the last
   manual pass pre-recorded a rollback SHA for every branch, used `git branch -d`
   and never -D, and verified each tree was clean and unoccupied first. A live
   agent process inside a worktree is a hard stop regardless of approval.

   Absent, not partial. A 503 carries no `plan` field at all, because a cleanup
   plan missing a refusal is a plan that proposes deleting something it should
   not — so an incomplete enumeration is reported as incomplete and no removable
   is shown from it. */
/* The sweep's non-visual signal, written to the static region in the rail header
   rather than to the button. The button is rebuilt on every paint, and a live
   region that is destroyed and recreated announces nothing — so the announcement
   it used to carry could never fire. A spinner says nothing to a screen reader,
   which left a non-sighted operator with no signal that anything had started. */
function announceCleanup(text) {
  const region = $("cleanup-status");
  if (region) region.textContent = text;
}

/* One press, two steps, in the order §2's state machine names them: `examining`
   is the board's own propose sweep, `launching` is the lane it then starts.

   The sweep runs FIRST because it is the only thing that produces counts,
   refusals with their reasons, and per-item rollback SHAs — the Cleaner reports
   its own progress through the ordinary session machinery and there is no
   channel that returns a manifest. Skipping it would leave S4 with nothing to
   render but an adjective.

   An incomplete enumeration stops the flow. A plan missing a refusal is a plan
   that proposes removing something it should not, and launching an agent to act
   on one would be worse than not launching at all. */
async function runCleanupFlow() {
  if (state.cleanup.running || state.cleaner.launching) return;
  await requestCleanupProposal();
  if (state.cleanup.error) return;
  await requestCleanerLaunch();
}

/* Launch one Cleaner lane and bind the chip to it.

   R2′ of the Cleaner plan: the board may start the agent, and still may not
   delete. `/api/cleanup/launch` is a spawn route with no confirm counterpart —
   the Cleaner proposes, asks the operator in its own session, and only then
   removes.

   No second-launch guard beyond the binding, deliberately. A double click is
   answered by the SERVER with `CLEANER_ALREADY_RUNNING` carrying the running
   lane's id, and cleanerFromResponse adopts it. Debouncing the button here would
   be the client guessing at server state, which is the same class of mistake as
   a timer-driven progress bar. */
async function requestCleanerLaunch() {
  if (state.cleaner.launching) return;
  state.cleaner = { sessionId: "", code: "", error: "", launching: true };
  announceCleanup("Starting a Cleaner lane. It will propose first and ask you before removing anything.");
  render();
  let body = null;
  let httpOk = false;
  try {
    const res = await apiFetch("/api/cleanup/launch", {
      method: "POST",
      headers: { accept: "application/json" },
    }, 90_000);
    httpOk = res.ok;
    body = await res.json().catch(() => null);
  } catch {
    /* Left null on purpose: cleanerFromResponse turns a dead transport into a
       STATED failure. The one thing this may never do is leave the chip mid
       spin with nothing said. */
  }
  state.cleaner = { ...cleanerFromResponse(body, httpOk), launching: false };
  announceCleanup(state.cleaner.error
    || "A Cleaner lane is running. It appears on the board like any other agent, and it will ask you before it removes anything.");
  render();
}

async function requestCleanupProposal() {
  if (state.cleanup.running) return;              // overlapping calls share one run server-side
  state.cleanup = { running: true, error: "", view: null, at: Date.now() };
  announceCleanup("Cleanup sweep running. Enumerating worktrees, branches and the process table. Nothing will be deleted without your approval.");
  render();
  try {
    const res = await apiFetch("/api/cleanup/propose", {
      method: "POST",
      headers: { accept: "application/json" },
    }, 60_000);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.ok !== true || body.complete !== true || !body.plan) {
      const why = (body && (body.error?.message || body.error?.code)) || `HTTP ${res.status}`;
      /* Named, not swallowed. "Enumeration incomplete" is a different fact from
         "nothing to clean up", and the operator must not read one as the other. */
      state.cleanup = { running: false, error: "Enumeration incomplete — " + why, view: null, at: Date.now() };
    } else {
      state.cleanup = { running: false, error: "", view: body.plan, at: Date.now() };
    }
  } catch (err) {
    state.cleanup = {
      running: false,
      error: "Enumeration incomplete — " + (err instanceof Error ? err.message : String(err)),
      view: null, at: Date.now(),
    };
  }
  /* The outcome, in the same region. "Incomplete" and "ready" are different
     facts and the operator must not read one as the other — the same rule the
     error string above already follows. */
  announceCleanup(state.cleanup.error
    || "Cleanup proposal ready. Open Notifications to read it; nothing has been deleted.");
  render();
}

/* The remedy an operator should actually be given, severity-corrected.

   healthRemedy() answers "what debris is there"; this answers "what should you
   do FIRST". A blocking fault outranks any tidy-up: telling someone to close
   panes while Focus and Send cannot route at all points them at the wrong
   problem, and it was caught on the live board reading "3 live sessions can't
   take commands" directly above "Close 17 cmux panes … this is tidying, not a
   fault". Suppressing the wrong instruction must not leave none, so each
   severity names its own next step, and the panes go with the tidy-up they
   belong to rather than being offered as a fix for something else. */
function instrumentRemedy(snap = state.snap, conn = state.conn, fetchFailed = state.fetchFailed) {
  const status = systemStatus(snap, conn, fetchFailed);
  const severity = status.key === "degraded" ? degradedSeverity(snap, conn, fetchFailed) : null;
  const control = snap && snap.controlHealth;
  const derived = healthRemedy(snap);
  const blockingStep = !snap || conn === "offline"
    ? "Check the hub is running, then Refresh."
    : control && control.cmuxReachable !== true
      ? "Start cmux, then Refresh — Focus and Send come back on their own."
      : "";
  /* Offline is its own status key rather than a `degraded` severity, so it needs
     naming here too — it is the one state where the operator is most stranded
     and least able to guess the next move. */
  const severityStep = (severity && severity.key === "blocking") || status.key === "offline"
    ? blockingStep
    : severity && severity.key === "stale" ? "Refresh to re-pull the evidence."
      : "";
  if (!severityStep) return derived;
  return {
    ...(derived || { problem: "", paneCount: 0, blockedCount: 0, panes: [], tidy: false }),
    instruction: severityStep,
    panes: [],
  };
}

/* Instrument trouble, and what to do about it — S2-T2's other half.

   The header keeps a chip saying whether the readings can be trusted, because a
   confidence header whose instruments are broken must admit it or every number
   beside it is unqualified. What the chip may NOT keep is the acting: the top
   finding's title, the remedy sentence, the leftover panes and Refresh were all
   controls sitting inside a metric, which is the same defect as the finding
   links. They live here, next to the sentence that says what is wrong.

   Silent on a healthy board. This block speaks only when the instruments are
   actually in trouble or there is real debris to clear — a permanent tidy-up
   offer is a permanent scold, and an operator who learns a line is always there
   stops reading it. */
function renderInstrumentBlock() {
  const status = systemStatus(state.snap, state.conn);
  const degraded = status.key !== "operational";
  const remedy = instrumentRemedy();
  const refresh = degraded ? healthRefreshAction() : null;
  const panes = (remedy && remedy.panes) || [];
  /* Also speaks when a sweep has produced something to read. A plan that
     arrived on a board whose instruments have since recovered is still the
     operator's to act on, and dropping it because the chip went quiet would
     discard the result of a run they asked for. */
  const sweep = state.cleanup.running || state.cleanup.view || state.cleanup.error;
  if (!degraded && !sweep && !(remedy && remedy.tidy && panes.length)) return [];

  const top = degraded ? topSourceIssue(state.snap) : null;
  const block = el("div", { class: "notify-instrument", role: "group", "aria-label": "Instrument trust" });
  block.append(el("span", { class: "notify-eyebrow", text: degraded ? "Readings degraded" : "Tidy-up available" }));
  /* The finding's TITLE, which the card deliberately stopped printing as its
     explanation — here it labels the trouble rather than standing in for the
     consequence, which is what it is actually good at. */
  const problem = (remedy && remedy.problem) || (top && top.title) || status.label;
  if (problem) block.append(el("p", { class: "notify-instrument-problem", text: problem }));
  if (remedy && remedy.instruction) {
    block.append(el("p", { class: "notify-instrument-remedy", text: remedy.instruction }));
  }
  const controls = el("div", { class: "notify-instrument-acts" });
  if (panes.length) {
    controls.append(el("button", {
      type: "button", class: "notify-act",
      "aria-expanded": String(healthPanesOpen),
      "aria-label": (healthPanesOpen ? "Hide" : "Show") + " the " + panes.length + " leftover cmux panes",
      dataset: { fkey: "health-panes" },
      onclick: toggleHealthPanes,
    }, healthPanesOpen ? "Hide panes" : "Show " + panes.length + " panes"));
  }
  if (refresh) {
    controls.append(el("button", {
      type: "button", class: "notify-act",
      title: refresh.title,
      "aria-label": top ? refresh.label + " — " + top.title : refresh.label,
      dataset: { fkey: "degraded-refresh" },
      onclick: () => recollectSnapshot(),
    }, refresh.label));
  }
  if (controls.childNodes.length) block.append(controls);
  block.append(...renderCleanupPlan());
  if (healthPanesOpen && panes.length) {
    block.append(el("ul", { class: "health-pane-list" },
      ...panes.slice(0, 12).map((pane) => el("li", {},
        el("span", { class: "health-pane-name", text: pane.name }),
        el("span", { class: "health-pane-age", text: pane.updatedAt ? "quiet " + agoText(pane.updatedAt) : "" }))),
      panes.length > 12
        ? el("li", { class: "health-pane-more", text: "+" + (panes.length - 12) + " more" })
        : null));
  }
  return [block];
}

/* S6-T4 · the sweep's result, in the notification center.

   A dataflow item in every respect that matters: it names its collector, it
   carries evidence and impact, it is severity "warning" and never ember —
   a tidy-up is not a person waiting on you — and it lands in the panel rather
   than the header, because the header states no count of problems.

   It is rendered here inside the instrument block rather than minted as a
   NotificationItem with a route. §4.2 requires every item's `route.kind` to be a
   key of DRAWER_RENDERERS, and a sweep result has no server-published id to
   route to: issuesOf's own rule is that the client may SHAPE what the server
   sent and never mint an id the server has not published, because an invented id
   resolves to no drawer. So the plan is shown where it is complete rather than
   given a route that would dead-end.

   Every removable carries its rollback SHA and every refusal carries its reason,
   because those two are what make the plan reviewable rather than trusted. The
   confirm command is rendered as text to paste — there is no confirm route and
   no click that deletes anything. */
function renderCleanupPlan() {
  const { running, error, view } = state.cleanup;
  if (running) return [];                    // the chip's indicator is the whole in-progress UX
  if (error) {
    /* Absent, not partial. A plan missing a refusal is a plan that proposes
       deleting something it should not, so an incomplete enumeration shows the
       failure and NO removables — never a subset wearing a complete answer. */
    return [el("p", { class: "notify-instrument-remedy", role: "status", text: error + ". No plan was produced." })];
  }
  if (!view) return [];

  const removable = Array.isArray(view.removable) ? view.removable : [];
  const worktrees = (view.refused && view.refused.worktrees) || [];
  const branches = (view.refused && view.refused.branches) || [];
  const out = [];
  /* A sweep that finds nothing is a REAL ANSWER and has to read as one — not as
     a failure, and not as silence. Same rule the all-clear panel follows:
     "watching, found nothing" and "not watching" must not render identically, so
     this says what was examined rather than just what was absent. `refused` is
     exactly the set the sweep looked at and chose to keep, and the reasons are
     listed below, so the count is evidence rather than reassurance. */
  const examined = worktrees.length + branches.length;
  /* S4's verdict line: a COUNT, split by kind, never an adjective. "2 worktrees,
     1 branch proposed, 1 refused" is a fact an operator can act on; "Cleanup
     complete!" is a mood. countsSentence also refuses the word "removed" — the
     board observes that a sweep proposed things and that a session ended; it
     never observes a removal, because nothing reports one. */
  const counts = cleanupCounts(view);
  out.push(el("p", { class: "notify-instrument-problem", text: countsSentence(counts) }));
  out.push(el("p", { class: "notify-instrument-remedy", text:
    removable.length
      ? "A Cleaner will ask you here before it removes any of them. Each carries the rollback SHA that undoes it."
      : examined
        ? `Nothing to sweep. ${examined} item${examined === 1 ? " was" : "s were"} examined and every one was kept — the reasons are below.`
        : "Nothing to sweep. No worktrees or branches were eligible for removal." }));

  if (removable.length) {
    out.push(el("ul", { class: "cleanup-list", "aria-label": "Removable, with rollback" },
      ...removable.slice(0, 12).map((item) => el("li", {},
        el("span", { class: "cleanup-kind", text: item.kind }),
        el("span", { class: "cleanup-target", text: item.target }),
        /* The rollback SHA is the whole reason this is reviewable: it is what
           lets the operator put back anything the sweep proposed wrongly. */
        el("span", { class: "cleanup-sha mono", text: String(item.rollbackSha || "").slice(0, 10) }))),
      removable.length > 12
        ? el("li", { class: "cleanup-more", text: `+${removable.length - 12} more in the plan file` })
        : null));
  }

  const refused = [...worktrees, ...branches];
  if (refused.length) {
    out.push(el("p", { class: "notify-instrument-remedy", text:
      `${refused.length} refused — each one is a stop the sweep will not cross:` }));
    out.push(el("ul", { class: "cleanup-list cleanup-refused", "aria-label": "Refused, with reasons" },
      ...refused.slice(0, 8).map((item) => el("li", {},
        el("span", { class: "cleanup-target", text: item.path || item.name }),
        el("span", { class: "cleanup-reason", text: (item.reasons || []).join(" · ") })))));
  }

  /* Only when there is something to remove. A confirm command shown against an
     empty plan invites the operator to run a removal that would remove nothing,
     on the one surface whose entire contract is that removal is deliberate. */
  if (removable.length) {
    out.push(el("p", { class: "cleanup-confirm" },
      el("span", { class: "cleanup-confirm-lead", text: "Paste this to remove them:" }),
      el("code", { class: "mono", text: view.confirmCommand || "" })));
  }
  if (view.planPath) {
    out.push(el("p", { class: "cleanup-plan-path mono", text: "plan: " + view.planPath }));
  }
  return out;
}

/* Delivery's own control, and the ONLY place permission is requested — from
   this click and never on load. toggleNotifications is untouched; this is the
   button that calls it, moved off the masthead where its words read as a
   verdict about the backlog beside it. */
function renderNotifyDeliverySwitch() {
  const view = notifyToggleView(state.notify, undefined, 0, "clear");
  return el("div", { class: "notify-foot" },
    el("button", {
      type: "button",
      class: "notify-switch" + (view.pressed ? " is-on" : ""),
      "aria-pressed": view.pressed ? "true" : "false",
      disabled: view.disabled ? "" : null,
      title: view.title,
      dataset: { fkey: "notify:delivery" },
      onclick: () => { toggleNotifications().then(render); },
    },
      el("span", { class: "notify-switch-track", "aria-hidden": "true" }),
      "Notify me when an agent stops"),
    el("span", { class: "notify-foot-state", text: view.label }));
}

/* Settings paint lives in settings-panel.js. The local name stays so source
   tests that slice this file up to `function renderSettingsPanel` still close. */
function renderSettingsPanel() {
  paintSettingsForm();
}

/* TINT-F. Which repository wears which colour, and the override.

   A repository the operator picks a colour for stops being "auto" and frees its
   palette slot server-side, so the next repository to appear takes a real hue
   instead of overflow clay — which is why a second click on a yours-swatch
   clears the override rather than only offering a global wipe.

   Assignment keys are origin/band names (`the-ant-hill`). Rows with no live
   session stay pickable and are marked not on the board. The list paints into
   `#repo-colors-host` so a colour GET cannot rebuild the Settings form. */
function paintRepoColorSettings() {
  const host = $("repo-colors-host");
  if (!host) return;
  const sig = JSON.stringify(state.repoColorSettings) + "\u001f" + (state.liveRepoKeys || []).join(",");
  /* An empty host after a form rebuild must still fill, even when the colour
     payload has not moved — otherwise Save-pending would leave the list blank. */
  if (paintUnchanged("repo-colors", sig) && host.childElementCount) return;
  host.textContent = "";
  host.append(renderRepoColorSettings());
}

function renderRepoColorSettings(settings = state.repoColorSettings) {
  const assignments = (settings && settings.assignments) || {};
  const live = new Set((state.liveRepoKeys || []).map((key) => String(key).toLowerCase()));
  const keys = Object.keys(assignments);
  const ranked = keys.sort((left, right) => {
    const leftLive = live.has(left.toLowerCase()) ? 0 : 1;
    const rightLive = live.has(right.toLowerCase()) ? 0 : 1;
    return leftLive - rightLive || left.localeCompare(right);
  });
  if (!ranked.length) {
    return el("div", { class: "repos" },
      el("p", {
        class: "repo-colors-empty",
        text: "No repository has a colour assigned yet.",
      }));
  }
  return el("div", { class: "repos" }, ...ranked.map((key) => {
    const assignment = assignments[key] || {};
    const hex = normalizeRepoHex(assignment.hex) || "";
    const onBoard = live.has(key.toLowerCase());
    const user = assignment.source === "user";
    const picker = el("input", {
      type: "color",
      class: "visually-hidden",
      tabindex: "-1",
      value: hex || "#888888",
      "aria-label": "Colour for " + key + (onBoard ? "" : ", not on the board"),
      dataset: { fkey: "repo-color:" + key },
      onchange: (event) => { void putRepoColor(key, event.currentTarget.value); },
    });
    const repo = el("button", {
      type: "button",
      class: "repo" + (user ? " is-yours" : "") + (onBoard ? "" : " is-absent"),
      onclick: () => {
        if (user) return putRepoColor(key, null);
        if (typeof picker.click === "function") picker.click();
      },
    },
      el("span", { class: "swatch" }),
      el("b", { text: key }));
    return el("div", {}, paintRepoTint(repo, hex, "has-repo-tint"), picker);
  }));
}

/* One write, both verbs: a hex sets an override, null clears it. Re-fetches
   rather than patching local state, because the server's answer also carries
   whatever the clear re-assigned the repository to. */
async function putRepoColor(repoKey, hex) {
  const normalized = hex === null ? null : normalizeRepoHex(hex);
  if (hex !== null && !normalized) {
    toast("That is not a colour this board can store", "warn");
    return;
  }
  try {
    const res = await apiFetch("/api/repo-colors/" + encodeURIComponent(repoKey), normalized
      ? {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hex: normalized }),
      }
      : { method: "DELETE" }, API_WRITE_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.ok !== true) {
      throw new Error(body && body.error && body.error.message ? body.error.message : "Save failed (HTTP " + res.status + ")");
    }
    state.liveRepoKeys = Array.isArray(body.liveKeys) ? body.liveKeys.map(String) : [];
    state.repoColorSettings = body.settings;
    setRepoColors(body.repoNames, body.settings);
    render();
    renderSettingsPanel();
  } catch (err) {
    toast(err && err.message ? err.message : "Colour save failed", "warn");
  }
}

async function putTeamColor(groupId, hex) {
  const normalized = normalizeRepoHex(hex);
  if (!normalized) {
    toast("That is not a colour this board can store", "warn");
    return;
  }
  try {
    const res = await apiFetch("/api/team-colors/" + encodeURIComponent(groupId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hex: normalized }),
    }, API_WRITE_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      throw new Error(body && body.error ? body.error : "Save failed (HTTP " + res.status + ")");
    }
    const stored = body.settings && body.settings.assignments && body.settings.assignments[groupId];
    if (Array.isArray(body.teams)) state.teamColors = body.teams;
    paintLiveTeamHex(groupId, normalizeRepoHex(stored && stored.hex) || normalized);
    render();
    paintTeamColorSettings();
  } catch (err) {
    toast(err && err.message ? err.message : "Colour save failed", "warn");
  }
}

const GROUP_N_NAME = /^Group \d+$/;
const TEAM_PALETTE = ["#5f7f2a", "#2e66a8", "#b05f3a", "#0e9494", "#9e3355", "#8a4fc0"];

function groupingIdSet() {
  if (!state.groupingIds || typeof state.groupingIds.has !== "function") {
    state.groupingIds = new Set();
  }
  return state.groupingIds;
}

function groupableWorkspaceId(agent) {
  const id = agent && agent.target && agent.target.workspaceId;
  return typeof id === "string" && id.trim() ? id.trim() : "";
}

function findAgentById(agentId) {
  for (const program of (state.snap && state.snap.programs) || []) {
    for (const agent of program.agents || []) {
      if (agent && agent.id === agentId) return agent;
    }
  }
  return null;
}

function groupingPicks() {
  const wanted = groupingIdSet();
  if (!wanted.size) return [];
  const picks = [];
  for (const program of (state.snap && state.snap.programs) || []) {
    for (const agent of program.agents || []) {
      if (wanted.has(agent.id)) picks.push({ agent, program });
    }
  }
  return picks;
}

function groupingWorkspaceIds() {
  const ids = [];
  const seen = new Set();
  for (const { agent } of groupingPicks()) {
    const id = groupableWorkspaceId(agent);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function defaultGroupingName() {
  for (const { program } of groupingPicks()) {
    const name = programName(program);
    if (name && !GROUP_N_NAME.test(name.trim())) return name;
  }
  return "Team";
}

function nextGroupingHex() {
  const taken = new Set((state.teamColors || []).map((team) => normalizeRepoHex(team.hex)));
  return TEAM_PALETTE.find((hex) => !taken.has(hex)) || "#64707c";
}

function groupingSharedWindowId() {
  const picks = groupingPicks().filter((pick) => groupableWorkspaceId(pick.agent));
  if (!picks.length) return "";
  const first = picks[0].agent.team && picks[0].agent.team.windowId;
  if (!first) return "";
  return picks.every((pick) => pick.agent.team && pick.agent.team.windowId === first) ? first : "";
}

function setGrouping(agentId, on) {
  const ids = groupingIdSet();
  if (!on) {
    ids.delete(agentId);
    if (!ids.size) state.groupingName = "";
    return;
  }
  const agent = findAgentById(agentId);
  if (agent && !groupableWorkspaceId(agent)) return;
  ids.add(agentId);
  state.lastGroupingId = agentId;
  if (!state.groupingName) state.groupingName = defaultGroupingName();
  if (!state.groupingHex) state.groupingHex = nextGroupingHex();
}

function toggleSelectMode() {
  state.selectMode = !state.selectMode;
  if (!state.selectMode) {
    state.groupingIds = new Set();
    state.groupingName = "";
  }
  render();
}

function rangeGroupTo(agentId) {
  const rows = typeof document !== "undefined" && document.getElementById
    ? navigableRows()
    : [];
  const ids = rows.map((row) => String(row.id || "").replace(/^agent-/, ""));
  const from = state.lastGroupingId ? ids.indexOf(state.lastGroupingId) : -1;
  const to = ids.indexOf(agentId);
  if (from < 0 || to < 0) {
    setGrouping(agentId, true);
    return;
  }
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  for (let index = start; index <= end; index++) setGrouping(ids[index], true);
}

function groupingCheckNode(agent, displayName) {
  if (!state.selectMode) return null;
  const workspaceId = groupableWorkspaceId(agent);
  const picked = groupingIdSet().has(agent.id);
  return el("input", {
    type: "checkbox",
    class: "grouping-check",
    checked: picked ? "" : null,
    disabled: workspaceId ? null : "",
    title: workspaceId ? "Include in the new team" : "No cmux workspace — cannot join a team",
    "aria-label": workspaceId
      ? "Select " + displayName + " for a team"
      : displayName + " has no cmux workspace",
    dataset: { fkey: "group-pick:" + agent.id },
    onclick: (event) => event.stopPropagation(),
    onchange: (event) => {
      setGrouping(agent.id, Boolean(event.currentTarget.checked));
      render();
    },
  });
}

function renderGroupingChip() {
  const count = groupingWorkspaceIds().length || groupingIdSet().size;
  const noun = count === 1 ? "terminal" : "terminals";
  const hex = normalizeRepoHex(state.groupingHex) || nextGroupingHex();
  const name = el("input", {
    type: "text",
    value: state.groupingName || defaultGroupingName(),
    maxlength: "80",
    "aria-label": "Team name",
    dataset: { fkey: "grouping-name" },
    oninput: (event) => { state.groupingName = event.target.value; },
    onclick: (event) => event.stopPropagation(),
  });
  const picker = el("input", {
    type: "color",
    class: "visually-hidden",
    tabindex: "-1",
    value: hex,
    "aria-label": "Team colour",
    dataset: { fkey: "grouping-color" },
    onchange: (event) => { state.groupingHex = event.currentTarget.value; },
  });
  const swatch = el("button", {
    type: "button",
    class: "repo-tint-picker swatch",
    "aria-label": "Team colour",
    onclick: (event) => {
      event.stopPropagation();
      if (typeof picker.click === "function") picker.click();
    },
  });
  return el("span", { class: "filter-chip grouping-chip", dataset: { fkey: "grouping-chip" } },
    el("span", { class: "grouping-chip-label", text: "Group " + count + " " + noun }),
    name,
    el("span", {}, paintRepoTint(swatch, hex, "has-repo-tint"), picker),
    el("button", {
      type: "button",
      class: "btn primary",
      disabled: state.groupingPending ? "" : null,
      dataset: { fkey: "grouping-create" },
      onclick: (event) => { event.stopPropagation(); void createGroupingTeam(); },
    }, state.groupingPending ? "Grouping…" : "Group"));
}

async function createGroupingTeam() {
  const workspaceIds = groupingWorkspaceIds();
  if (!workspaceIds.length) {
    toast("Pick at least one mapped terminal", "warn");
    return;
  }
  const name = String(state.groupingName || defaultGroupingName()).trim();
  if (!name || GROUP_N_NAME.test(name)) {
    toast("Name the team something other than Group N", "warn");
    return;
  }
  const hex = normalizeRepoHex(state.groupingHex) || nextGroupingHex();
  const windowId = groupingSharedWindowId();
  const payload = { workspaceIds, name, hex };
  if (windowId) payload.windowId = windowId;
  if (state.groupingPending) return;
  state.groupingPending = true;
  try {
    const res = await apiFetch("/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, API_WRITE_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !body.team) {
      throw new Error(body && body.error ? body.error : "Group failed (HTTP " + res.status + ")");
    }
    state.groupingIds = new Set();
    state.groupingName = "";
    state.selectMode = false;
    toast("Grouped as " + body.team.name, "ok");
    void fetchSnapshot();
    void fetchTeamColors();
  } catch (err) {
    toast(err && err.message ? err.message : "Group failed", "warn");
  } finally {
    state.groupingPending = false;
    render();
  }
}

function startTeamRename(group) {
  state.teamRenaming = group.key;
  state.teamRenameDraft = group.name;
  state.teamRenameError = "";
  render();
}

async function submitTeamRename(groupId) {
  const name = String(state.teamRenameDraft || "").trim();
  if (!name || GROUP_N_NAME.test(name)) {
    state.teamRenameError = "Name the team something other than Group N";
    render();
    return;
  }
  if (state.teamRenamePending) return;
  state.teamRenamePending = true;
  try {
    const res = await apiFetch("/api/teams/" + encodeURIComponent(groupId), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }, API_WRITE_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body && body.error ? body.error : "Rename failed (HTTP " + res.status + ")");
    }
    state.teamRenaming = null;
    toast("Team renamed to " + name, "ok");
    void fetchSnapshot();
    void fetchTeamColors();
  } catch (err) {
    state.teamRenameError = err && err.message ? err.message : "Rename failed";
    toast(state.teamRenameError, "warn");
  } finally {
    state.teamRenamePending = false;
    render();
  }
}

async function ungroupTeam(groupId, name) {
  const ask = (typeof globalThis !== "undefined" && globalThis.confirm)
    || (typeof window !== "undefined" && window.confirm);
  if (typeof ask === "function" && !ask("Ungroup " + (name || "this team") + "? Terminals stay open.")) {
    return;
  }
  try {
    const res = await apiFetch("/api/teams/" + encodeURIComponent(groupId), {
      method: "DELETE",
    }, API_WRITE_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body && body.error ? body.error : "Ungroup failed (HTTP " + res.status + ")");
    }
    toast("Ungrouped " + (name || "team"), "ok");
    void fetchSnapshot();
    void fetchTeamColors();
  } catch (err) {
    toast(err && err.message ? err.message : "Ungroup failed", "warn");
  } finally {
    render();
  }
}

function paintLiveTeamHex(groupId, hex) {
  const snap = state.snap;
  if (!snap || !Array.isArray(snap.programs)) return;
  for (const program of snap.programs) {
    for (const agent of program.agents || []) {
      if (agent.team && agent.team.id === groupId) agent.team = { ...agent.team, hex };
    }
  }
}

function paintTeamColorSettings() {
  if (typeof document === "undefined") return;
  const host = $("team-colors-host");
  if (!host) return;
  const sig = JSON.stringify(state.teamColors || []);
  if (paintUnchanged("team-colors", sig) && host.childElementCount) return;
  host.textContent = "";
  host.append(renderTeamColorSettings());
}

function renderTeamColorSettings(teams = state.teamColors) {
  const list = Array.isArray(teams) ? teams.slice() : [];
  if (!list.length) {
    return el("div", { class: "repos" },
      el("p", {
        class: "repo-colors-empty",
        text: "No operator groups.",
      }));
  }
  list.sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id)));
  return el("div", { class: "repos" }, ...list.map((team) => {
    const id = String(team.id || "");
    const name = String(team.name || id);
    const hex = normalizeRepoHex(team.hex) || "";
    const picker = el("input", {
      type: "color",
      class: "visually-hidden",
      tabindex: "-1",
      value: hex || "#888888",
      "aria-label": "Colour for " + name,
      dataset: { fkey: "team-color:" + id },
      onchange: (event) => putTeamColor(id, event.currentTarget.value),
    });
    const row = el("button", {
      type: "button",
      class: "repo",
      onclick: () => {
        if (typeof picker.click === "function") picker.click();
      },
    },
      el("span", { class: "swatch" }),
      el("b", { text: name }));
    return el("div", {}, paintRepoTint(row, hex, "has-repo-tint"), picker);
  }));
}

async function fetchTeamColors() {
  const generation = bootGeneration;
  try {
    const res = await apiFetch("/api/team-colors", { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    const body = await res.json();
    if (!res.ok || !body || !Array.isArray(body.teams)) throw new Error("bad team-colour response");
    if (generation !== bootGeneration) return;
    state.teamColors = body.teams;
    paintTeamColorSettings();
  } catch (err) {
    console.warn("team colour fetch failed:", err);
  }
}

function renderWidgetCustomizer() {
  const panel = $("widget-customizer");
  const toggle = $("customize-summary");
  const options = $("widget-options");
  if (!panel || !toggle || !options) return;
  panel.hidden = !state.widgetCustomizerOpen;
  toggle.setAttribute("aria-expanded", String(state.widgetCustomizerOpen));
  if (!state.widgetCustomizerOpen) return;

  const focusKey = document.activeElement?.dataset?.fkey;
  options.textContent = "";
  const orderedCatalog = [
    ...state.widgetIds.map((id) => WIDGET_CATALOG.find((widget) => widget.id === id)),
    ...WIDGET_CATALOG.filter((widget) => !state.widgetIds.includes(widget.id)),
  ];
  for (const widget of orderedCatalog) {
    const selected = state.widgetIds.includes(widget.id);
    const position = state.widgetIds.indexOf(widget.id);
    const row = el("div", { class: "widget-option" + (selected ? " is-selected" : ""), role: "listitem" });
    const input = el("input", {
      type: "checkbox",
      id: "widget-option-" + widget.id,
      checked: selected ? "" : null,
      disabled: widget.required ? "" : null,
      "aria-label": widget.required ? `${widget.label} is always shown` : `Show ${widget.label}`,
      dataset: { fkey: "widget-toggle:" + widget.id },
      onchange: (event) => setWidgetEnabled(widget.id, event.currentTarget.checked),
    });
    const label = el("label", { class: "widget-option-label", for: "widget-option-" + widget.id },
      input, el("span", { text: widget.label }), widget.required ? el("span", { class: "widget-required", text: "always shown" }) : null);
    const controls = el("span", { class: "widget-reorder", "aria-label": `Reorder ${widget.label}` },
      el("button", {
        type: "button", class: "widget-move", disabled: !selected || widget.required || position <= 1 ? "" : null,
        "aria-label": `Move ${widget.label} up`, title: "Move up", dataset: { fkey: `widget-move:${widget.id}:up` },
        onclick: () => moveWidget(widget.id, -1),
      }, "↑"),
      el("button", {
        type: "button", class: "widget-move", disabled: !selected || widget.required || position < 0 || position >= state.widgetIds.length - 1 ? "" : null,
        "aria-label": `Move ${widget.label} down`, title: "Move down", dataset: { fkey: `widget-move:${widget.id}:down` },
        onclick: () => moveWidget(widget.id, 1),
      }, "↓"));
    row.append(label, controls);
    options.append(row);
  }
  if (focusKey) {
    const node = document.querySelector(`[data-fkey="${CSS.escape(focusKey)}"]`);
    if (node) node.focus({ preventScroll: true });
  }
}

/* Calm collapse — the whole strip is one moss line: verdict, shipping count,
   pulse numbers when the server reports them (graceful without them), a small
   activity sparkline, and the trailing health micro-chip. */
/* Spend for the collapsed line. The band's collapse carried the token RATE and
   dropped money entirely, and for an orchestrator running hundreds of sessions a
   rate is not a substitute for cost — recovering it meant leaving the board for
   Usage → Custom 1h. Same wording as the BURN card on purpose: one number should
   not have two phrasings depending on whether the band happens to be collapsed.
   Absent when BurnBar priced nothing, never a fabricated $0. */
function calmSpendText(burn) {
  if (!burn || burn.costProvenance === "unavailable") return "";
  const cost = burn.costLastHourUsd;
  return typeof cost === "number" ? "$" + cost.toFixed(2) + " last hour" : "";
}

/* What the activity sparkline is actually showing. Five-minute buckets, so the
   window is a function of how many exist — a freshly restarted tracker holds two
   of them and must not call that an hour. */
function sparklineLabel(buckets) {
  const n = Array.isArray(buckets) ? buckets.length : 0;
  const span = n * 5 * 60_000;
  return "Active sessions per 5-minute bucket"
    + (span > 0 ? ", last " + fmtElapsed(span) : ", no window observed yet");
}

function renderPulseCalm(healthData, watch = watchClauses(state.snap)) {
  const snap = state.snap;
  const totals = totalsOf(snap);
  const pulse = snap && snap.pulse;
  /* The health micro-chip at the end of this line already says "All clear", so
     leading with it printed the same verdict twice in one sentence — the purest
     form of the noise this band exists to remove. */
  /* Nothing tracked means no fleet to describe. "0 shipping" over an empty board
     is a fleet aggregate about a fleet that does not exist, and it restates the
     emptiness the board below already states — the exact defect this band exists
     to remove, in the one state nobody had ever looked at. The trailing health
     chip still speaks, so the line stays an affirmative verdict rather than
     vanishing. (Day-one review.) */
  const parts = totals.tracked > 0 ? [totals.working + " shipping"] : [];
  if (pulse && totals.tracked > 0) {
    const windowText = pulse.momentum && pulse.momentum.completionsProvenance === "not-observable"
      ? ""
      : completionWindowText(pulse.momentum);
    if (windowText) parts.push(windowText);
    if (pulse.burn.tokensPerMin != null) parts.push(fmtTok(pulse.burn.tokensPerMin) + " tok/min");
    const spend = calmSpendText(pulse.burn);
    if (spend) parts.push(spend);
  }
  /* The mark is punctuation for the copy, so it goes when the copy does.

     Suppressing "0 shipping" at zero tracked (day-one review) left this bullet
     rendering alone: measured on the rebuilt n=0 fixture at aba5551, the calm
     line was mark "●", copy "", chip "All clear" — an orphaned dot floating
     before the verdict, which reads as a bullet whose text failed to load on the
     one screen that exists to look deliberate. aria-hidden already says it
     carries no meaning of its own; it should not survive the sentence it was
     decorating. */
  const copy = parts.join(" · ");
  const line = el("div", { class: "pulse-calm" + (watch.length ? " is-watching" : ""), role: "status" },
    copy ? el("span", { class: "pulse-calm-mark", "aria-hidden": "true", text: "●" }) : null,
    copy ? el("span", { class: "pulse-calm-copy", text: copy }) : null);
  /* The murmur. Appended to the same line rather than promoted into a cell,
     because these signals are worth mentioning and not worth rearranging the
     board around — a volume knob instead of a switch. */
  for (const clause of watch) {
    line.append(el("span", { class: "pulse-watch", text: clause }));
  }
  const spark = pulse
    /* The label used to claim "last hour" while the tracker held 12.7 minutes of
       buckets — a 4.7x window overstatement, in an accessibility label no sighted
       reader ever sees, which is why it took an audit to find. It now says the
       window it actually has. (Magnitude audit §5.) */
    ? svgSparkline(pulse.activity.buckets.map((b) => b.activeSessions), { label: sparklineLabel(pulse.activity.buckets) })
    : null;
  if (spark) line.append(spark);
  /* Once anything is being watched the trailing verdict cannot read "All clear":
     that was a claim about the whole board computed from a predicate that never
     read stall, debris or context occupancy. The words narrow to what is known. */
  line.append(healthMicroChip(watch.length
    /* Tone and glyph move with the word. Overriding only the text left a green
       check sitting beside "Watch" — the chip contradicting itself in three
       characters, which is the same self-disagreement the health headline had
       with its own badge. */
    ? { ...healthData, value: calmVerdict(watch), tone: "advisory", icon: "warning" }
    : healthData));
  return line;
}

// Last painted needs-you count — detects the >0 → 0 clear so the strip can
// fire its one-shot moss transition (CSS transition only, no keyframe loops).
let pulseNeedsYouWas = 0;

/* The Pulse strip — one verdict-first surface. Calm collapses to a single
   line; anything urgent re-weights the fixed-order cells instead of
   reordering them. */
/* S2-T3. The board's scan window, stated once.

   Every reading in this rail is an aggregate over the sessions the collectors
   harvested, so the window that decides which sessions exist AT ALL qualifies
   all of them at once. It used to ride as a per-card tag on the one card that
   remembered to carry it, which is how an aggregate ends up with an unstated
   population everywhere else.

   Two different kinds of window, and only one of them belongs here. The SCAN
   window is how far back sources are harvested — a fact about the board's
   reach, identical for every card, so it is said once. Each reading's OWN
   measurement window (Burn's "10m average", Cost's "last hour") stays on the
   reading, because it qualifies that number and no other.

   Withheld, not guessed, when the server has not confirmed it: `state
   .scanWindowHours` carries a client-side default of 36, and printing that as
   though a server had said it is the exact overclaim this program removes. */
function renderScanWindow() {
  const node = $("scan-window");
  if (!node) return;
  const reported = state.snap && Number(state.snap.scanWindowHours);
  const hours = Number.isFinite(reported) && reported > 0 ? reported : null;
  node.hidden = hours == null;
  node.textContent = hours == null ? "" : `sessions seen in the last ${hours}h`;
}

/* The one target-population writer both header faces share. The MODEL decides
   what speaks; this only chooses the branch (calm line, repo-scoped tuples,
   stressed cells) and orders it — so the expanded grid and the compact face
   cannot disagree without disagreeing with the same derivation. It never
   re-derives: renderHealthRail computes model/dataById/scoped once per paint
   and passes them in. */
function renderReadingsInto(target, { model, dataById, scoped, compact = false }) {
  target.textContent = "";
  if (model.calm && !scoped) {
    target.append(renderPulseCalm(dataById.get("health"), model.watch));
  } else if (scoped) {
    for (const id of ["health", "momentum", "burn", "context-peak"]) {
      const data = scoped[id];
      if (!data) continue;
      target.append(renderSummaryWidget(id, data.tone === "hot" ? "hot" : "normal", data, compact));
    }
  } else {
    /* This loop only orders what the model kept. It used to walk state.widgetIds
       and fall back to summaryWidgetData for any id the model had omitted —
       which meant every suppression decided in pulseStripModel (a cell with
       nothing to report, a health cell already narrated by NEEDS YOU) rendered
       anyway. The omissions were real in the model and invisible on screen;
       caught by counting .reading-widget nodes in the browser against the
       model's own cell list. */
    for (const id of state.widgetIds) {
      const cell = model.cells.find((c) => c.id === id);
      if (!cell) continue;
      target.append(renderSummaryWidget(id, cell.weight, cell.data, compact));
    }
  }
}

function renderHealthRail() {
  const widgets = $("health-widgets");
  const grid = $("readings-grid");
  if (!widgets || !grid) return;
  if (state.tldrView == null) state.tldrView = "ALL";
  const model = pulseStripModel(state.snap, state.conn, state.queueItems, state.contextDisplay, state.queueError);
  // One derivation per widget per paint. The signature, the cell and the calm
  // line all read this map; each used to call summaryWidgetData again, and each
  // of those calls re-derived the whole findings list underneath.
  const dataById = new Map(model.allCells.map((cell) => [cell.id, cell.data]));
  const attention = attentionSummary(state.snap);
  const needsYou = attention ? attention.count : 0;
  const tldrCount = tldrAttentionCount(state.snap, state.tldrView || "ALL");
  const buckets = state.snap && state.snap.pulse ? state.snap.pulse.activity.buckets : [];
  const hbAgent = heartbeatTldrAgent(state.snap);
  const envelopeRaw = hbAgent && typeof hbAgent.transcriptTail === "string" ? hbAgent.transcriptTail : "";
  const staleBucket = heartbeatStaleBucket(hbAgent);
  const sig = [
    state.conn,
    model.calm ? "calm:" + (model.watch || []).join("|") : "stressed",
    state.widgetIds.join(","),
    state.widgetCustomizerOpen ? "1" : "0",
    buckets.map((b) => b.activeSessions).join(","),
    model.findings.map(findingPaintKey).join("|"),
    tldrCount,
    // The calm line renders momentum/burn/health regardless of which widgets
    // are enabled, so sign its actual inputs — not the customized cell list.
    (model.calm
      ? ["momentum", "burn", "health"]
      : state.widgetIds.filter((id) => dataById.has(id))
    ).map((id) => {
      const data = dataById.get(id);
      return [id, data.value, data.unit, data.sublabel, data.tone].join(":");
    }).join("|"),
    /* The sweep's own state. The notification panel's signature already signs
       this — "or the panel would freeze mid-run" — but the rail is where the
       Clean up BUTTON lives, and it never got the same treatment. Measured on
       the live board: with a sweep running, the header button stayed "Clean up",
       stayed enabled and never showed its indicator, because not one signed
       input moves while a sweep is in flight. The entire running state was
       unreachable from the control that starts it. */
    state.cleanup.running ? "sweeping" : "",
    String(state.cleanup.at),
    state.cleanup.error,
    /* The Cleaner lane's binding, for the same reason the sweep's state is here:
       the chip follows a SESSION, and its state changes when that session
       changes without any signed widget value moving. Omitting this is exactly
       the CLEAN-1 defect — the header simply never repainted during a sweep and
       the whole running state was unreachable from the control that starts it. */
    state.cleaner.sessionId,
    /* …and the DERIVED state, not just the binding. The chip's words change when
       the Cleaner's session changes — working to asking, asking to ended — and
       none of that moves a widget value either. Signing only the session id
       would repaint on adoption and then freeze for the rest of the run, which
       is CLEAN-1 again one level down. */
    cleanerView(state.snap, state.cleaner).state,
    state.cleaner.error,
    envelopeRaw,
    state.tldrView || "ALL",
    state.facetProgram || "",
    staleBucket,
    /* The disclosure mode. Without it, a toggle on a quiet fleet would sync
       the hidden states below and then hit an unchanged signature — leaving
       the newly shown face empty until the next snapshot moved a number. */
    state.headerCollapsed ? "collapsed" : "expanded",
    state.momentumMagnify ? "mom-on" : "mom-off",
  ].join("\u001f");
  /* AHEAD of the widgets guard, deliberately. The scan window is not a widget
     and does not belong behind a widget signature: it changes when Settings
     change, which can leave every card's value identical while the population
     underneath them moves. Hanging it off that guard is the bug the settings
     panel had — a surface that repaints when something unrelated changes and
     freezes when its own input does. It is one text assignment, so running it
     every paint costs nothing. */
  renderScanWindow();
  /* Also ahead of the guard: mode is not a widget value. Hidden states, body
     class, label and aria-expanded must be current even when every signed
     reading is unchanged. */
  syncHeaderDisclosure();
  if (paintUnchanged("widgets", sig)) return;

  const rail = $("health-rail");
  if (rail) {
    if (needsYou === 0 && pulseNeedsYouWas > 0) {
      rail.classList.add("pulse-cleared");
      setTimeout(() => rail.classList.remove("pulse-cleared"), 1400);
    }
    rail.classList.toggle("is-calm", model.calm);
  }
  pulseNeedsYouWas = needsYou;

  /* Empty ONLY the readings grid — never the two-child ribbon shells, and never
     #cleanup-status (static in stack-head; destroying an aria-live region
     silences announcements). */
  const view = state.tldrView || "ALL";
  const scopedProgram = view !== "ALL" ? programForTldrRepo(state.snap, view) : null;
  const scoped = scopedProgram ? repoScopedReadings(scopedProgram) : null;
  updateReadingsScopePill(view !== "ALL" && scopedProgram ? view : "");
  /* One derivation, one writer, whichever face is exposed. The inactive face
     is emptied rather than left holding the previous mode's readings: it is
     already `hidden`, and stale content in a hidden face is the two-truths
     defect waiting for the next CSS regression to show it. */
  const compact = $("compact-summary");
  if (state.headerCollapsed) {
    grid.textContent = "";
    if (compact) renderReadingsInto(compact, { model, dataById, scoped, compact: true });
  } else {
    if (compact) compact.textContent = "";
    renderReadingsInto(grid, { model, dataById, scoped });
  }
  renderWidgetCustomizer();
  renderHealthTldrLane();
  /* renderSettingsPanel used to be called here, and it was the "settings do not
     stick" bug. This function returns early whenever the WIDGET paint signature
     is unchanged — a quiet fleet, most of the time — and the settings panel sat
     downstream of that guard. So a save posted, the server persisted it, the
     board reclassified, and the panel never repainted: no confirmation, and the
     fields still showing the values from before the save. Both symptoms of one
     cause, and neither reproducible on a board whose numbers happened to move.

     It is a sibling of the widgets now, not a tail of them, and it keeps its own
     signature below. */
}

/* ---------- heartbeat TL;DR — always from prime:ant-heartbeat-monitor (out-of-view) ---------- */
function heartbeatTldrAgent(snap) {
  if (!snap || !snap.programs) return null;
  for (const program of snap.programs) {
    for (const agent of program.agents || []) {
      if (agent.id === "prime:ant-heartbeat-monitor" && typeof agent.transcriptTail === "string" && agent.transcriptTail.includes("[TL;DR")) {
        return agent;
      }
    }
  }
  // fallback: any prime with [TL;DR] if monitor not yet present (first boot before monitor file exists)
  for (const program of snap.programs) {
    for (const agent of program.agents || []) {
      if (typeof agent.transcriptTail === "string" && agent.transcriptTail.includes("[TL;DR")) return agent;
    }
  }
  return null;
}

/* ---------- v3 structured TL;DR — deterministic repo bar + per-card linking ---------- */

function parseHeartbeatStructured(raw) {
  // raw is transcriptTail trim, e.g. "[TL;DR 17:33] {\"v\":3,\"repos\":[...]}" or legacy pipe string
  const m = raw.match(/^\[TL;DR\s+(\d{1,2}:\d{2})\]\s*/);
  const time = m ? m[1] : "";
  const body = m ? raw.slice(m[0].length).trim() : raw.trim();
  if (!body) return { time, fleet: "", repos: [], raw, body, legacy: true };
  // Try structured JSON envelope v3/v4
  if (body.startsWith("{") && body.includes("\"repos\"")) {
    try {
      const envelope = JSON.parse(body);
      if (envelope && typeof envelope.v === "number" && Array.isArray(envelope.repos)) {
        const repos = envelope.repos.filter((r) => r && typeof r.repo === "string" && typeof r.summary === "string").map((r) => ({
          repo: String(r.repo),
          summary: String(r.summary),
          blocker: String(r.blocker || "none reported"),
          signal: String(r.signal || "ok").toLowerCase(),
        }));
        const fleet = typeof envelope.fleet === "string" ? envelope.fleet : "";
        if (repos.length) return { time, fleet, repos, raw, body, legacy: false, v: envelope.v };
      }
    } catch {}
  }
  // Legacy fallback: pipe-joined "repo: summary | repo: summary"
  const parts = body.split(/\s*\|\s*/).filter(Boolean);
  const repos = parts.map((line) => {
    const trimmed = line.trim();
    const colon = trimmed.indexOf(":");
    const repo = colon > 0 ? trimmed.slice(0, colon).trim() : "repo";
    // derive blocker from tail after last "·" or "blocker" keyword
    const lower = trimmed.toLowerCase();
    let blocker = "none reported";
    if (lower.includes("all-clear")) blocker = "all-clear";
    else if (lower.includes("question pending")) blocker = "question pending";
    else if (lower.includes("blocker") || lower.includes("blocking")) {
      const blk = trimmed.split("·").pop() || "";
      if (blk.trim()) blocker = blk.trim().slice(0, 48);
    }
    let signal = "ok";
    const isClear = lower.includes("all-clear") || lower.includes("none reported") || lower.includes("no blockers") || lower.includes("0 blockers");
    if (lower.includes("failed")) signal = "failed";
    else if (lower.includes("blocked") && !isClear) signal = "blocked";
    else if (!isClear && (lower.includes("question pending") || lower.includes("needs you") || (lower.includes("blocker") && !isClear))) signal = "needs-you";
    else if (lower.includes("working")) signal = "working";
    return { repo, summary: trimmed, blocker, signal };
  });
  return { time, fleet: "", repos, raw, body, legacy: true, v: 2 };
}

/* Distinct repositories with LIVE agents. The denominator the operator means
   by "repos": program groups are worktrees — five checkouts of one repo are
   one repo, and a dormant directory is not part of the live fleet story. */
function liveRepoNames(snap) {
  const names = new Set();
  for (const p of (Array.isArray(snap?.programs) ? snap.programs : [])) {
    const agents = Array.isArray(p.agents) ? p.agents : [];
    if (!agents.some((a) => a && (a.lifecycle === "working" || a.lifecycle === "waiting"))) continue;
    const repo = repoOf(p);
    const name = String((repo && repo.repoName) || p.name || p.id || "").toLowerCase();
    if (name) names.add(name);
  }
  return names;
}

/** Strip "Repo: " and a restated "Repo " subject so bullets don't read "Home: Home has…". */
function stripTldrRepoPrefix(summary, repoName) {
  const name = String(repoName || "").trim();
  let body = String(summary || "").trim();
  if (!name || !body) return body;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  body = body.replace(new RegExp("^" + esc + ":\\s*", "i"), "").trim();
  body = body.replace(new RegExp("^" + esc + "(?:\\s*:\\s*|\\s+)", "i"), "").trim();
  return body;
}

/** One-line priority brief when Luna omits fleet — not a joined inventory. */
function fleetPriorityBrief(snap, repos) {
  const sorted = tldrRepoOrder(Array.isArray(repos) ? repos : []);
  const hot = sorted.filter((r) => tldrSignalRank(r.signal) === 0);
  const primary = hot[0] || sorted[0];
  if (!primary) {
    const live = snap?.totals?.live ?? 0;
    return `All quiet — ${live} live across ${liveRepoNames(snap).size} repos.`;
  }
  const name = String(primary.repo || "repo");
  const task = tldrRepoBulletTask(primary, 52);
  let line = `Act on *${name}* first`;
  if (task) line += ` — ${task}`;
  line += ".";
  const restHot = hot.slice(1).map((r) => r.repo).filter(Boolean);
  if (restHot.length) line += ` Then ${restHot.join(", ")}.`;
  else {
    const defer = sorted.find((r) => r.repo !== name && tldrSignalRank(r.signal) > 0);
    if (defer) line += ` ${defer.repo} can wait.`;
  }
  return clipTldrBullet(line, 220);
}

function fleetFallbackLine(snap, repos) {
  /* Prefer priority brief for empty-fleet story; keep inventory join only for
     callers that still want the old aggregate (tests). */
  return fleetPriorityBrief(snap, repos);
}

function tldrQuietStatus(repo) {
  const sig = String(repo?.signal || "").toLowerCase();
  const blocker = String(repo?.blocker || "").toLowerCase();
  if (sig === "failed") return "failed";
  if (sig === "blocked") return "blocked";
  if (sig === "needs-you") {
    if (blocker.includes("input") || blocker.includes("question") || blocker.includes("permission")) return "input";
    if (blocker && blocker !== "all-clear" && blocker !== "none reported") return blocker.split(/\s+/)[0].slice(0, 12);
    return "needs you";
  }
  if (sig === "working") return "working";
  if (sig === "idle") return "idle";
  if (sig === "all-clear") return "ok";
  return "ok";
}

const HEARTBEAT_STALE_MS = 7 * 60 * 1000;

function heartbeatStaleBucket(agent) {
  if (!agent || !agent.updatedAt) return "0";
  const age = Date.now() - Date.parse(agent.updatedAt);
  return Number.isFinite(age) && age > HEARTBEAT_STALE_MS ? "1" : "0";
}

function tldrSignalRank(signal) {
  const s = String(signal || "").toLowerCase();
  if (s === "needs-you" || s === "blocked" || s === "failed") return 0;
  if (s === "working" || s === "ok") return 2;
  if (s === "idle" || s === "all-clear") return 3;
  return 2;
}

function tldrRepoOrder(repos) {
  return [...(Array.isArray(repos) ? repos : [])].sort((a, b) => {
    const bySignal = tldrSignalRank(a.signal) - tldrSignalRank(b.signal);
    if (bySignal) return bySignal;
    return (b.live ?? 0) - (a.live ?? 0);
  });
}

/** Derive program facet from a paged TL;DR view (repo name → program id).
 *  ALL is the fleet header and does not own the board filter — snapshot ticks
 *  must not wipe a chip/proof-row facet. setTldrView("ALL") clears explicitly. */
function applyTldrFacetSync(view = state.tldrView) {
  const next = view || "ALL";
  if (next === "ALL") return;
  const program = programForTldrRepo(state.snap, next);
  state.facetProgram = program ? program.id : "";
}

/** Board scope and the fleet TL;DR are independent. Setting a program filter
 *  must not rebuild the masthead into a repo dossier. Clearing the filter
 *  restores ALL if a chevron had paged the rail. */
function applyFacetTldrSync(programId) {
  if (!programId) {
    if (state.tldrView !== "ALL") {
      state.tldrView = "ALL";
      saveTldrView();
      state.paintSig.widgets = "";
    }
  }
}

/** Proof rows and chips filter the tree. They do not page the TL;DR. */
function filterBoardToTldrRepo(repoName) {
  const program = programForTldrRepo(state.snap, repoName);
  if (!program) return;
  setFacetProgram(program.id);
}

function tldrRepoBoardActive(repoName) {
  if (state.tldrView === repoName) return true;
  const program = programForTldrRepo(state.snap, repoName);
  return !!(program && state.facetProgram === program.id);
}

function setTldrView(view) {
  const next = view || "ALL";
  state.tldrView = next;
  saveTldrView();
  state.paintSig.widgets = "";
  if (next === "ALL") state.facetProgram = "";
  else applyTldrFacetSync(next);
  /* Full board paint so the tree/filter bar follow the chevron; rail-only harnesses
     (unit tests) leave uiReady unset and only repaint the health rail. */
  if (state.uiReady) render();
  else renderHealthRail();
}

function clipTldrBullet(text, cap) {
  const s = String(text || "").trim();
  if (s.length <= cap) return s;
  const c = s.slice(0, cap);
  const sp = c.lastIndexOf(" ");
  return (sp > Math.floor(cap * 0.45) ? c.slice(0, sp) : c).trimEnd() + "…";
}

function tldrRepoBulletTask(repo, cap) {
  const bodyFleet = stripTldrRepoPrefix(repo.summary, repo.repo);
  let fleetTask = bodyFleet;
  if (bodyFleet.includes(" · ")) {
    const parts = bodyFleet.split(" · ");
    if (parts.length >= 3) fleetTask = parts[1].trim();
    else if (parts.length === 2) {
      const last = parts[1].trim().toLowerCase();
      if (last === "all clear" || last.includes("need you") || last === "no action") fleetTask = parts[0].trim();
      else fleetTask = parts[1].trim();
    }
  }
  return clipTldrBullet(fleetTask || bodyFleet || repo.summary || "", cap);
}

function programForTldrRepo(snap, repoName) {
  if (!snap || !snap.programs) return null;
  const lower = String(repoName).toLowerCase();
  if (lower === "all-clear") return null;
  // exact name match first
  for (const p of snap.programs) {
    if (String(p.name).toLowerCase() === lower) return p;
    if (String(p.id).toLowerCase().includes(lower.replace(/\s+/g, "-"))) return p;
  }
  // path basename or name includes
  for (const p of snap.programs) {
    const n = String(p.name).toLowerCase();
    const id = String(p.id).toLowerCase();
    if (n.includes(lower) || lower.includes(n) || id.includes(lower)) return p;
  }
  // fallback: repoKey match via groupPath not exposed — use snapshot rollup by path basename
  for (const p of snap.programs) {
    if (p.path && String(p.path).toLowerCase().includes(lower)) return p;
  }
  return null;
}

/* Every "N need you" on this client, counting one population.

   `snap` is a parameter rather than a read of module state so the count stays
   testable, and so the caller cannot accidentally count one snapshot's rows
   against another's acks. */
function deterministicRepoStats(program, snap = state.snap) {
  if (!program) return null;
  const agents = Array.isArray(program.agents) ? program.agents : [];
  const live = agents.filter((a) => a.lifecycle === "working" || a.lifecycle === "waiting").length;
  const working = agents.filter((a) => a.lifecycle === "working").length;
  const idle = agents.filter((a) => a.lifecycle === "waiting").length;
  /* stripAlerting, the same predicate as the strip, the rollup and Momentum.
     It used to be "has an attentionSignal and is not finished", which is a
     third population: it counts a row the operator has already acknowledged,
     and it misses every ask that arrives as an outcome rather than a signal. */
  const needsYou = agents.filter((a) => stripAlerting(a, snap)).length;
  const failed = agents.filter((a) => a.outcome === "failed").length;
  const blocked = agents.filter((a) => a.outcome === "blocked").length;
  // branch/dirty/PRs from first agent that has them, or from repo identity
  let branch;
  let dirty;
  let head;
  let prCount = 0;
  let headShort;
  for (const a of agents) {
    if (!branch && a.repo && a.repo.branch) branch = a.repo.branch;
    if (!branch && a.git && a.git.branch) branch = a.git.branch;
    if (dirty === undefined && a.git && typeof a.git.dirty === "boolean") dirty = a.git.dirty;
    if (!head && a.git && a.git.head) head = a.git.head;
    if (Array.isArray(a.pullRequestUrls)) prCount += a.pullRequestUrls.length;
  }
  // program-level repo branch fallback
  if (!branch && program.path) {
    // program.name often is repoName; branch lives on agent repo, not program — keep agent-derived
  }
  if (head) headShort = String(head).slice(0, 7);
  return { live, working, idle, needsYou, failed, blocked, branch, dirty, headShort, prCount, total: agents.length };
}

/* How many sessions across the whole snapshot are asking and unacknowledged.
   One expression, so no surface can quietly grow a second answer. */
function fleetStripAlerting(snap) {
  const programs = Array.isArray(snap?.programs) ? snap.programs : [];
  return programs.reduce(
    (count, program) => count + (program.agents || []).filter((a) => stripAlerting(a, snap)).length, 0);
}

function tldrAttentionCount(snap, repoName = "ALL") {
  if (repoName && repoName !== "ALL") {
    const stats = deterministicRepoStats(programForTldrRepo(snap, repoName), snap);
    return stats ? stats.needsYou : 0;
  }
  /* NOT `totals.attention`. That field is unread cmux toasts — a "PR merged"
     popup — and reading it here made the largest digit on the page count
     notifications while every other need-you digit counted asks.

     And NOT `totals.needsYou` either, which is the server's own mirror of this
     predicate. Preferring it looks like the drift-proof choice and is the
     opposite: measured on :4712 against the live fleet on 2026-08-17, with
     ZERO acks outstanding, `totals.needsYou` read 1 while this client's strip
     held 6 — the five rows between them are `attentionSignal.kind:
     "input-requested"`, which `taskStateWantsHuman` admits here and the server
     mirror does not. Reading the server field would have made the biggest digit
     on the page say 1 over a strip showing 6 and a Momentum reading 6: the same
     "one phrase, three meanings" defect this lane exists to remove, moved to a
     new pair of surfaces.

     So the CLIENT counts with the client's one predicate, and every digit it
     draws agrees with every other one it draws. Server/client agreement is a
     real requirement and a separate repair — it belongs where the two
     predicates are reconciled, not in a fallback chain that hides which one
     answered. */
  return fleetStripAlerting(snap);
}

function tldrCardSignalClass(signal) {
  const s = String(signal).toLowerCase().replace(/\s+/g, "-");
  if (s === "needs-you" || s === "blocked" || s === "failed") return "is-" + s;
  if (s === "working" || s === "ok" || s === "all-clear" || s === "idle") return "is-" + s;
  return "is-ok";
}

function updateReadingsScopePill(repoName) {
  const widgets = $("health-widgets");
  const stack = widgets && findChildClass(widgets, "readings-stack");
  const head = stack && findChildClass(stack, "stack-head");
  if (!head) return;
  let pill = findChildClass(head, "scope-pill");
  if (!repoName) {
    if (pill) pill.remove();
    return;
  }
  if (!pill) {
    pill = el("span", { class: "scope-pill", text: repoName });
    const scan = $("scan-window");
    const scanParent = scan && (scan.parentNode || scan.parent);
    if (scan && scanParent === head) head.insertBefore(pill, scan);
    else head.append(pill);
  } else {
    pill.textContent = repoName;
  }
}

function findChildClass(root, className) {
  for (const kid of root.children || []) {
    if (kid.classList?.contains?.(className) || String(kid.className || "").split(/\s+/).includes(className)) return kid;
  }
  return null;
}

/* Lane class vocabulary kept live for the orphan-CSS guard: repo view (Task 7)
   emits tldr-card-repo tldr-card-signal tldr-lane-det tldr-det-pill
   tldr-card-blocker scope-pill against the styles ported with this fold-in. */
function renderHealthTldrLane() {
  const lane = $("health-tldr-lane");
  const widgets = $("health-widgets");
  if (!lane) return;
  if (state.tldrView == null) state.tldrView = "ALL";
  lane.textContent = "";
  lane.classList.remove("is-needs-you", "is-stale", "is-break", "is-repo-scoped");

  const agent = heartbeatTldrAgent(state.snap);
  if (!agent || !agent.transcriptTail) {
    lane.hidden = true;
    if (widgets) widgets.classList.add("is-no-tldr");
    return;
  }
  const raw = agent.transcriptTail.trim();
  const parsed = parseHeartbeatStructured(raw);
  if (!parsed.repos || !parsed.repos.length) {
    lane.hidden = true;
    if (widgets) widgets.classList.add("is-no-tldr");
    return;
  }

  if (state.tldrView !== "ALL") {
    const stillThere = parsed.repos.some((r) => r.repo === state.tldrView)
      || programForTldrRepo(state.snap, state.tldrView);
    if (!stillThere) {
      state.tldrView = "ALL";
      saveTldrView();
    }
  }

  lane.hidden = false;
  if (widgets) widgets.classList.remove("is-no-tldr");
  lane.setAttribute("role", "group");
  lane.title = raw;

  const time = parsed.time || (agent.updatedAt
    ? new Date(agent.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "");
  const view = state.tldrView || "ALL";
  const attentionCount = tldrAttentionCount(state.snap, view);
  if (view !== "ALL") {
    renderTldrRepoLane(lane, parsed, agent, time, view, attentionCount);
  } else {
    renderTldrAllLane(lane, parsed, time, attentionCount);
  }

  if (heartbeatStaleBucket(agent) === "1") {
    lane.classList.add("is-stale");
    const timeEl = findChildClass(findChildClass(lane, "tldr-lane-head") || lane, "heartbeat-tldr-time");
    if (timeEl) timeEl.classList.add("is-frozen");
  }

  if (typeof globalThis !== "undefined" && globalThis.TheAntHill) {
    globalThis.TheAntHill.parseHeartbeatStructured = parseHeartbeatStructured;
    globalThis.TheAntHill.programForTldrRepo = programForTldrRepo;
    globalThis.TheAntHill.deterministicRepoStats = deterministicRepoStats;
    globalThis.TheAntHill.tldrAttentionCount = tldrAttentionCount;
    globalThis.TheAntHill.fleetFallbackLine = fleetFallbackLine;
    globalThis.TheAntHill.fleetPriorityBrief = fleetPriorityBrief;
    globalThis.TheAntHill.stripTldrRepoPrefix = stripTldrRepoPrefix;
    globalThis.TheAntHill.setTldrView = setTldrView;
    globalThis.TheAntHill.applyTldrFacetSync = applyTldrFacetSync;
    globalThis.TheAntHill.applyFacetTldrSync = applyFacetTldrSync;
    globalThis.TheAntHill.filterBoardToTldrRepo = filterBoardToTldrRepo;
    globalThis.TheAntHill.setFacetProgram = setFacetProgram;
    globalThis.TheAntHill.repoScopedReadings = repoScopedReadings;
    globalThis.TheAntHill.tldrRepoOrder = tldrRepoOrder;
    globalThis.TheAntHill.renderHealthTldrLane = renderHealthTldrLane;
    globalThis.TheAntHill.renderHealthRail = renderHealthRail;
  }
}

function renderTldrAllLane(lane, parsed, time, attentionCount) {
  lane.setAttribute("aria-label", "Cluster TL;DR — all repos");
  lane.classList.add("is-masthead");
  const totals = (state.snap && state.snap.totals) || {};
  const live = totals.live ?? 0;
  const attention = Number.isFinite(attentionCount) ? attentionCount : tldrAttentionCount(state.snap);
  const attentionText = attention > 0 ? `${attention} need you` : "all clear";
  const repoCount = parsed.repos.length;
  const ordered = tldrRepoOrder(parsed.repos);
  const hasBreak = ordered.some((r) => {
    const s = String(r.signal || "").toLowerCase();
    return s === "blocked" || s === "failed";
  });
  const hot = ordered.some((r) => tldrSignalRank(r.signal) === 0);
  if (hasBreak) lane.classList.add("is-break");
  else if (hot || attention > 0) lane.classList.add("is-needs-you");
  const first = ordered[0];

  const prev = el("button", { type: "button", class: "chev", "aria-label": "Previous view", disabled: "", text: "‹" });
  const next = el("button", {
    type: "button",
    class: "chev",
    "aria-label": first ? `Filter board to ${first.repo}` : "Next repo view",
    text: "›",
    onclick: () => { if (first) setTldrView(first.repo); },
  });
  if (!first) next.setAttribute("disabled", "");

  lane.append(el("div", { class: "tldr-lane-head" },
    el("span", { class: "heartbeat-tldr-label", "aria-hidden": "true", text: "TL;DR" }),
    el("span", {
      class: "tldr-attention-count" + (attention > 0 ? "" : " is-clear"),
      "aria-live": "polite",
      text: attentionText,
    }),
    el("span", { class: "heartbeat-tldr-time", text: time }),
    el("span", {
      class: "tldr-lane-meta",
      title: "Luna summarizes agents active in the last hour; the board tree still uses the 36h lookback. Chevrons page the TL;DR and filter the tree.",
      text: `${repoCount} repos · ${live} live · 1h`,
    }),
    el("div", { class: "lane-pager" }, prev, el("span", { class: "lane-pos", "aria-live": "polite", text: "ALL" }), next),
  ));

  const fleetText = (parsed.fleet && parsed.fleet.trim())
    || (parsed.repos.length ? fleetPriorityBrief(state.snap, parsed.repos) : "");
  const hasFleet = !!fleetText;
  if (hasFleet) {
    lane.append(el("p", {
      class: "tldr-lane-prose is-fleet" + (parsed.repos.length ? " has-bullets" : ""),
    }, ...tldrMarkupNodes(fleetText)));
  }

  const fleetBuckets = ordered.slice(0, 3);
  if (fleetBuckets.length) {
    const proof = el("div", {
      class: "tldr-proof",
      role: "list",
      "aria-label": "Per-repo proof — click filters the board",
    });
    const bulletCap = hasFleet ? 72 : 88;
    for (const repo of fleetBuckets) {
      const task = tldrRepoBulletTask(repo, bulletCap);
      const sigClass = tldrCardSignalClass(repo.signal);
      const row = el("button", {
        type: "button",
        class: "tldr-proof-row " + sigClass,
        role: "listitem",
        title: (repo.summary || "") + " — click to filter board",
        onclick: () => filterBoardToTldrRepo(repo.repo),
      },
        el("span", { class: "tldr-proof-rail", "aria-hidden": "true" }),
        el("span", { class: "tldr-proof-name", text: repo.repo }),
        el("span", { class: "tldr-proof-body" }, ...tldrMarkupNodes(task)),
        el("span", { class: "tldr-proof-tag", text: tldrQuietStatus(repo) }),
      );
      proof.append(row);
    }
    if (parsed.repos.length > 3) {
      proof.append(el("div", { class: "tldr-proof-more", text: `+${parsed.repos.length - 3} more` }));
    }
    lane.append(proof);
  }

  const strip = el("div", { class: "tldr-chip-strip", role: "list", "aria-label": "Repo status — filters the board" });
  const mentioned = new Set(parsed.repos.map((r) => String(r.repo).toLowerCase()));
  for (const repo of ordered) {
    const name = repo.repo;
    const active = tldrRepoBoardActive(name);
    strip.append(el("button", {
      type: "button",
      class: "tldr-chip " + tldrCardSignalClass(repo.signal) + (active ? " is-active" : ""),
      role: "listitem",
      title: `Filter board to ${name}`,
      onclick: () => filterBoardToTldrRepo(name),
    }, el("span", { class: "dot" }), name));
  }
  const quiet = [...liveRepoNames(state.snap)].filter((name) => !mentioned.has(name)).length;
  if (quiet > 0) {
    strip.append(el("span", { class: "tldr-chip is-more", role: "listitem", text: `+${quiet} quiet` }));
  }
  lane.append(strip);
}

function renderTldrRepoLane(lane, parsed, agent, time, repoName, attentionCount) {
  const ordered = tldrRepoOrder(parsed.repos);
  const repo = ordered.find((r) => r.repo === repoName)
    || parsed.repos.find((r) => r.repo === repoName)
    || { repo: repoName, summary: "", blocker: "none reported", signal: "ok" };
  const program = programForTldrRepo(state.snap, repoName);
  const stats = deterministicRepoStats(program, state.snap);
  const resolvedAttention = Number.isFinite(attentionCount) ? attentionCount : (stats ? stats.needsYou : 0);
  const attentionText = resolvedAttention > 0 ? `${resolvedAttention} need you` : "all clear";
  const sigClass = tldrCardSignalClass(repo.signal);
  lane.setAttribute("aria-label", "Cluster TL;DR — " + repoName + " (board filtered)");
  lane.classList.add("is-masthead", "is-repo-scoped");
  if (sigClass === "is-blocked" || sigClass === "is-failed") lane.classList.add("is-break");
  else if (sigClass === "is-needs-you") lane.classList.add("is-needs-you");

  const idx = Math.max(0, ordered.findIndex((r) => r.repo === repoName));
  const pos = idx + 1;
  const prevRepo = idx <= 0 ? null : ordered[idx - 1];
  const nextRepo = ordered[idx + 1] || null;

  const prev = el("button", {
    type: "button",
    class: "chev",
    "aria-label": idx === 0 ? "Back to ALL — show every program" : `Filter board to ${prevRepo.repo}`,
    text: "‹",
    onclick: () => setTldrView(idx === 0 ? "ALL" : prevRepo.repo),
  });
  const next = el("button", {
    type: "button",
    class: "chev",
    "aria-label": nextRepo ? `Filter board to ${nextRepo.repo}` : "Next repo view",
    text: "›",
    onclick: () => { if (nextRepo) setTldrView(nextRepo.repo); },
  });
  if (!nextRepo) next.setAttribute("disabled", "");

  const metaBits = [];
  if (stats) metaBits.push(stats.total + " agents");
  if (time) metaBits.push(time);
  metaBits.push("last 1h");
  metaBits.push("board filtered");

  lane.append(el("div", { class: "tldr-lane-head" },
    el("span", { class: "heartbeat-tldr-label", "aria-hidden": "true", text: "TL;DR" }),
    el("span", { class: "tldr-card-repo", text: repoName }),
    el("span", { class: "tldr-card-signal " + sigClass, text: repo.signal }),
    el("span", {
      class: "tldr-attention-count" + (resolvedAttention > 0 ? "" : " is-clear"),
      "aria-live": "polite",
      text: attentionText,
    }),
    el("span", {
      class: "tldr-lane-meta",
      title: "Board tree is filtered to this program. Clear via Filters chip or ‹ to ALL.",
      text: metaBits.join(" · "),
    }),
    el("div", { class: "lane-pager" },
      prev,
      el("span", { class: "lane-pos", "aria-live": "polite", text: `${pos} / ${ordered.length}` }),
      next,
    ),
  ));

  const repoBody = stripTldrRepoPrefix(repo.summary, repoName);
  if (repoBody) {
    lane.append(el("p", {
      class: "tldr-lane-prose is-fleet has-bullets",
    }, ...tldrMarkupNodes(clipTldrBullet(repoBody, 220))));
  }

  const programAgents = program ? (program.agents || []) : [];
  const agentBuckets = [...programAgents].sort((a, b) => {
    const rank = (x) => x.attentionSignal ? 0 : x.lifecycle === "working" ? 1 : x.lifecycle === "waiting" ? 2 : 3;
    return rank(a) - rank(b);
  }).slice(0, 4);
  if (agentBuckets.length) {
    const proof = el("div", {
      class: "tldr-proof is-under-fleet",
      role: "list",
      "aria-label": `${repoName} agents`,
    });
    for (const ag of agentBuckets) {
      const isWaiting = !!ag.attentionSignal || ag.lifecycle === "waiting";
      const sig = isWaiting ? "needs-you" : ag.lifecycle === "working" ? "working" : "ok";
      const cls = tldrCardSignalClass(sig);
      const sourceTask = String(ag.task || ag.lastHumanMessage || ag.displayName || "").trim().split("\n")[0].trim();
      let cleanTask = sourceTask;
      const low = cleanTask.toLowerCase();
      if (low.startsWith("handoff:")) cleanTask = "handoff";
      else if (low.includes("chrome tabs") && low.includes("chrome extension")) cleanTask = "Chrome tab check";
      else if (low.startsWith("the following is the codex agent") || low.startsWith("this session is being continued")) cleanTask = "Codex history review";
      else if (low.startsWith("#")) {
        cleanTask = cleanTask.replace(/^#{1,6}\s*/, "").replace(/^[-*]\s*/, "");
        if (cleanTask.toLowerCase().includes("chrome tab")) cleanTask = "Chrome tab check";
      }
      cleanTask = clipTldrBullet(cleanTask, 64);
      if (!cleanTask) cleanTask = ag.displayName || "working";
      const blockerText = isWaiting ? (ag.attentionSignal?.kind || "needs you") : "";
      const label = blockerText && blockerText !== "all clear" ? `${cleanTask} → ${blockerText}` : cleanTask;
      proof.append(el("div", { class: "tldr-proof-row " + cls, role: "listitem", title: sourceTask },
        el("span", { class: "tldr-proof-rail", "aria-hidden": "true" }),
        el("span", { class: "tldr-proof-name", text: isWaiting ? "waiting" : "working" }),
        el("span", { class: "tldr-proof-body" }, ...tldrMarkupNodes(label)),
      ));
    }
    if (programAgents.length > 4) {
      proof.append(el("div", { class: "tldr-proof-more", text: `+${programAgents.length - 4} more agents` }));
    }
    lane.append(proof);
  }

  const det = el("div", { class: "tldr-lane-det", "aria-label": repoName + " repo facts" });
  const blockerKind = String(repo.blocker || "").toLowerCase();
  const isAlert = blockerKind !== "all-clear" && blockerKind !== "none reported" && blockerKind !== "no blockers reported" && blockerKind !== "all clear";
  if (isAlert) {
    const age = agent?.updatedAt ? agoText(agent.updatedAt) : "";
    det.append(el("span", {
      class: "tldr-card-blocker is-alert",
      text: "⏸ " + repo.blocker + (age ? " · " + age : ""),
    }));
  }
  if (stats) {
    if (stats.branch) det.append(el("span", { class: "tldr-det-pill is-branch", text: stats.branch }));
    if (stats.headShort) det.append(el("span", { class: "tldr-det-pill is-branch is-secondary", text: stats.headShort }));
    if (stats.dirty === true) det.append(el("span", { class: "tldr-det-pill is-dirty", text: "dirty" }));
    if (stats.prCount) det.append(el("span", { class: "tldr-det-pill is-pr", text: stats.prCount + " PR" + (stats.prCount === 1 ? "" : "s") }));
    const roster = `${stats.working} working · ${stats.blocked} blocked`;
    det.append(el("span", { class: "tldr-det-pill is-working is-secondary", text: roster }));
  }
  lane.append(det);
}

/* ---------- issues ---------- */

const ISSUE_STATE_LABELS = {
  open: "Open",
  verifying: "Verifying",
  resolved: "Resolved",
  blocked: "Blocked",
};


function issueStateLabel(issue) {
  return ISSUE_STATE_LABELS[issueLifecycle(issue).state] || "Open";
}




async function fetchTriageQueue() {
  try {
    const res = await apiFetch("/api/triage/queue", { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    const body = await res.json();
    if (!res.ok || !body || body.ok !== true || !Array.isArray(body.items)) throw new Error("queue response was invalid");
    state.queueItems = body.items;
    state.queueError = "";
    renderHealthRail();
  } catch (err) {
    /* This used to be console.warn and nothing else. queueItems then stayed [],
       which yields zero queue findings — the same output a genuinely empty queue
       gives — so the strip collapsed to CALM while triage work sat unseen on the
       server. The last known items are kept rather than cleared (dropping them
       would lose real information); the error is what stops them being read as
       the whole truth. */
    state.queueError = err && err.message ? err.message : "Triage queue unavailable";
    console.warn("triage queue fetch failed:", err);
    renderHealthRail();
  }
}

async function triageIssue(issueId, action) {
  const key = action + ":" + issueId;
  if (state.triagePending.has(key)) return;
  state.triagePending.add(key);
  state.triageErrors.delete(issueId);
  renderHealthRail();
  try {
    const res = await apiFetch("/api/triage/" + action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issueId }),
    }, API_WRITE_TIMEOUT_MS);
    const body = await res.json();
    if (!res.ok || !body || body.ok !== true) {
      throw new Error(body && body.error && body.error.message ? body.error.message : "HTTP " + res.status);
    }
    const recommendation = body.recommendation || body.item;
    if (recommendation) state.triage.set(issueId, recommendation);
    if (body.item) {
      const withoutIssue = state.queueItems.filter((item) => item.issueId !== issueId);
      state.queueItems = [body.item, ...withoutIssue];
      toast(action === "run" ? "Investigation launched" : "Investigation queued", "ok");
    }
    if (action === "queue" || action === "run") {
      await fetchSnapshot();
      await fetchTriageQueue();
    }
    // Compress Triage→Queue into one beat when the plan is investigation-shaped:
    // queueing is bounded and persistent, and launch stays a separate explicit
    // operator action, so the extra click was a dead stop, not a safety gate.
    if (action === "generate" && recommendation && recommendation.queueRecommended
      && !state.queueItems.some((item) => item.issueId === issueId)) {
      await triageIssue(issueId, "queue");
    }
  } catch (err) {
    state.triageErrors.set(issueId, err && err.message ? err.message : "Triage request failed");
  } finally {
    state.triagePending.delete(key);
    render();
  }
}

/* Cancel a running investigation, or drop a queued/finished record.

   Both are the same route (DELETE /api/triage/queue?issueId=…) because they are
   the same server operation; `intent` only decides what the operator is told.
   A cancel has to visibly STOP the run, not grey out a button, so success is
   read from the server's own `cancelled` flag and the queue + snapshot are
   re-read before anything is claimed. The server refuses to cancel a run it has
   no safe handle for (409) — that refusal is surfaced, never swallowed, because
   a "cancelled" that left the process running is worse than no button. */
async function removeTriageItem(issueId, intent = "remove") {
  const key = intent + ":" + issueId;
  if (state.triagePending.has(key)) return;
  state.triagePending.add(key);
  state.triageErrors.delete(issueId);
  render();
  try {
    const res = await apiFetch("/api/triage/queue?issueId=" + encodeURIComponent(issueId), { method: "DELETE" }, API_WRITE_TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { /* a build without the route answers HTML */ }
    if (!res.ok || !body || body.ok !== true) {
      throw new Error(body && body.error && body.error.message ? body.error.message : "HTTP " + res.status);
    }
    // The plan itself is deliberately KEPT: removing a run must not also erase
    // the recommendation the operator is about to re-queue. A TriageQueueItem
    // IS a recommendation, so on a page that never generated one locally (a
    // reload mid-investigation) the removed item is what the plan has to come
    // from — otherwise cancelling drops the operator back to "Triage this
    // finding" and the analysis has to be paid for twice.
    const removed = state.queueItems.find((item) => item.issueId === issueId);
    if (removed && !state.triage.has(issueId)) state.triage.set(issueId, removed);
    state.queueItems = state.queueItems.filter((item) => item.issueId !== issueId);
    toast(body.cancelled ? "Investigation cancelled" : "Investigation record removed", "ok");
    await fetchSnapshot();
    await fetchTriageQueue();
  } catch (err) {
    state.triageErrors.set(issueId, err && err.message ? err.message : "Could not update the investigation queue");
  } finally {
    state.triagePending.delete(key);
    render();
  }
}

/* Parse freeform investigation result text into a brief-friendly shape.
   Luna may emit markdown headings, labeled lines, bullets, or a one-liner.
   Display-only — never mutates triage state. Graceful on unstructured text. */
function parseInvestigationResult(text) {
  const raw = String(text ?? "").trim();
  const empty = { headline: "", summary: "", findings: [], actions: [], blockers: [], structured: false, raw };
  if (!raw) return empty;

  const ACTION_RE = /^(?:next(?:\s+(?:steps?|actions?))?|action(?:s)?|what to do(?: next)?|recommended?(?:\s+path)?|follow[- ]?up|repair|fix)\s*[:—-]\s*(.+)$/i;
  const BLOCKER_RE = /^(?:blocker|blocked(?:\s+by)?|blocking|external blocker)\s*[:—-]\s*(.+)$/i;
  const FINDING_RE = /^(?:finding(?:s)?|root cause|cause|summary|result|outcome|what happened)\s*[:—-]\s*(.+)$/i;
  const HEADING_RE = /^#{1,3}\s+(.+)$/;
  const BULLET_RE = /^(?:[-*•]|\d+[.)])\s+(.+)$/;
  const LABEL_ONLY_RE = /^(?:findings?|root cause|cause|summary|result|outcome|what happened|next(?:\s+(?:steps?|actions?))?|action(?:s)?|what to do(?: next)?|recommended?(?:\s+path)?|follow[- ]?up|repair|fix|blocker|blocked(?:\s+by)?|blocking|verification|evidence)\s*[:—-]?\s*$/i;

  const findings = [];
  const actions = [];
  const blockers = [];
  const paragraphs = [];
  let bucket = "body";
  let headlineSource = "";

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const heading = trimmed.match(HEADING_RE);
    if (heading) {
      const title = heading[1].trim();
      if (/block/i.test(title)) bucket = "blockers";
      else if (/next|action|repair|fix|recommend|follow/i.test(title)) bucket = "actions";
      else if (/find|cause|root|evidence|verif|summary|result|outcome/i.test(title)) bucket = "findings";
      else bucket = "body";
      continue;
    }

    if (LABEL_ONLY_RE.test(trimmed)) {
      if (/block/i.test(trimmed)) bucket = "blockers";
      else if (/next|action|repair|fix|recommend|follow/i.test(trimmed)) bucket = "actions";
      else bucket = "findings";
      continue;
    }

    const actionMatch = trimmed.match(ACTION_RE);
    if (actionMatch) {
      actions.push(actionMatch[1].trim());
      bucket = "actions";
      continue;
    }
    const blockerMatch = trimmed.match(BLOCKER_RE);
    if (blockerMatch) {
      const value = blockerMatch[1].trim();
      if (!/^(none|n\/a|no\b|—|-)\b/i.test(value)) blockers.push(value);
      bucket = "blockers";
      continue;
    }
    const findingMatch = trimmed.match(FINDING_RE);
    if (findingMatch) {
      const value = findingMatch[1].trim();
      findings.push(value);
      if (!headlineSource) headlineSource = value;
      bucket = "findings";
      continue;
    }

    const bulletMatch = trimmed.match(BULLET_RE);
    if (bulletMatch) {
      const item = bulletMatch[1].trim();
      if (bucket === "actions") actions.push(item);
      else if (bucket === "blockers") blockers.push(item);
      else findings.push(item);
      continue;
    }

    if (bucket === "actions") actions.push(trimmed);
    else if (bucket === "blockers") blockers.push(trimmed);
    else if (bucket === "findings") {
      findings.push(trimmed);
      if (!headlineSource) headlineSource = trimmed;
    } else {
      paragraphs.push(trimmed);
      if (!headlineSource) headlineSource = trimmed;
    }
  }

  function firstSentence(value) {
    const source = String(value || "").trim();
    if (!source) return "";
    const match = source.match(/^(.+?[.!?])(?:\s|$)/);
    const sentence = (match ? match[1] : source).trim();
    if (sentence.length <= 160) return sentence;
    return sentence.slice(0, 157).replace(/\s+\S*$/, "") + "…";
  }

  const headline = firstSentence(headlineSource || findings[0] || blockers[0] || actions[0] || raw);
  let summary = "";
  const extraParagraphs = paragraphs.filter((p) => p !== headlineSource);
  if (extraParagraphs.length) summary = extraParagraphs.join(" ");
  else if (paragraphs.length === 1 && paragraphs[0].length > headline.length + 8) {
    summary = paragraphs[0].slice(headline.length).trim().replace(/^[\s.]+/, "");
  }

  const structured = findings.length > 0 || actions.length > 0 || blockers.length > 0 || paragraphs.length > 1;
  return { headline, summary, findings, actions, blockers, structured, raw };
}

function investigationResultNextSteps(parsed, outcome) {
  if (parsed.actions.length) return parsed.actions.slice();

  const lower = parsed.raw.toLowerCase();
  if (outcome === "blocked") {
    if (lower.includes("requeue")) {
      return ["Requeue from the current issue evidence, then launch a fresh read-only investigation."];
    }
    if (lower.includes("10-minute") || lower.includes("runtime limit") || lower.includes("timed out")) {
      return ["Retry with a narrower investigation scope, or act on the evidence already on the finding."];
    }
    if (parsed.blockers.length) {
      return ["Address the blocker above, or requeue once the external condition changes."];
    }
    return ["Review the blocker, then requeue or take one precise follow-up from current evidence."];
  }
  return ["Wait for the next source snapshot — this finding clears when evidence is gone."];
}

/* One primary, wired action for a finished investigation. Blocked results
   regenerate a fresh plan from the current issue evidence (the server queue
   holds one item per finding, so a true requeue is not available); verifying
   results re-pull the source snapshot that clears the finding. */
function investigationResultCta(outcome, issueId) {
  if (!issueId) return null;
  if (outcome === "blocked") {
    const busy = state.triagePending.has("generate:" + issueId);
    return el("button", {
      type: "button",
      class: "btn primary triage-briefing-cta",
      disabled: busy ? "" : null,
      "aria-busy": busy ? "true" : null,
      dataset: { fkey: "briefing-cta:" + issueId },
      onclick: () => triageIssue(issueId, "generate"),
    }, busy ? "Retriaging…" : "Retriage from evidence");
  }
  return el("button", {
    type: "button",
    class: "btn primary triage-briefing-cta",
    dataset: { fkey: "briefing-cta:" + issueId },
    onclick: () => { void fetchSnapshot(); void fetchTriageQueue(); },
  }, "Check source now");
}

// Fix briefing for investigation results — headline, what happened, what to do,
// with raw output collapsed. Used by intervention/advisory triage and the
// investigation drawer. `outcome` is "completed" or "blocked"; `opts.issueId`
// wires the one primary follow-up action; `opts.startedAt`/`opts.completedAt`
// feed the mono timestamps in the action row.
const BRIEFING_MAX_BULLETS = 3;

/* A bullet shaped like "`542577F9…` → `ttys003`" is evidence routing, not
   prose — the result card renders those as a route table (mockup C1). Only a
   clear single arrow with short endpoints qualifies; anything else stays a
   plain bullet. Pure, exported for tests. */
function routeFromBullet(text) {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 120) return null;
  // Endpoints are identifiers (session ids, ttys, paths) — never words with
  // spaces, never chained arrows. Prose with an arrow mid-sentence stays prose.
  const match = raw.match(/^`?([^\s`→>]{1,60})`?\s*(?:→|->)\s*`?([^\s`→>]{1,60})`?$/);
  if (!match) return null;
  const from = match[1].trim();
  const to = match[2].trim();
  if (!from || !to) return null;
  return { from, to };
}

function renderInvestigationResult(resultText, outcome, opts = {}) {
  const blocked = outcome === "blocked";
  const parsed = parseInvestigationResult(resultText);
  const headline = parsed.headline || (blocked ? "Investigation blocked" : "Investigation complete");
  const nextSteps = investigationResultNextSteps(parsed, blocked ? "blocked" : "completed");
  const seen = new Set([headline, parsed.headline].filter(Boolean));
  // Body cap: blockers first, then findings, at most three bullets total —
  // everything else stays in the collapsed Raw output. Route-shaped bullets
  // render as an evidence table and do not count against the cap.
  const blockers = parsed.blockers.filter((item) => !seen.has(item)).slice(0, BRIEFING_MAX_BULLETS);
  const routes = parsed.findings.map(routeFromBullet).filter(Boolean);
  const findings = parsed.findings.filter((item) => !seen.has(item) && !routeFromBullet(item))
    .slice(0, Math.max(0, BRIEFING_MAX_BULLETS - blockers.length));
  const summary = parsed.summary && parsed.summary !== headline ? parsed.summary : "";
  let bodyShown = false;

  // Verdict head (mockup C1): outcome glyph ring + plain-language verdict,
  // state chip and note on the right. The glyph is the image; no banner fill.
  const briefing = el("section", {
    class: "triage-result triage-briefing" + (blocked ? " triage-briefing--blocked" : " triage-briefing--ok"),
    "aria-label": blocked ? "Blocked investigation result" : "Investigation result",
  },
    el("div", { class: "brf-head" },
      el("span", { class: "brf-glyph", "aria-hidden": "true" }, icon(blocked ? "warning" : "check")),
      el("div", { class: "brf-lede" },
        el("p", { class: "triage-briefing-headline", text: headline })),
      el("div", { class: "brf-state" },
        el("span", { class: "triage-briefing-status", text: blocked ? "Blocked" : "Complete" }),
        el("span", { class: "triage-briefing-kicker-note", text: blocked
          ? "Operator review needed"
          : "Waiting for fresh data" }))));

  if (summary && !blockers.length && !findings.length) {
    briefing.append(el("p", { class: "triage-briefing-summary", text: summary }));
    bodyShown = true;
  } else if (findings.length === 0 && blockers.length === 0 && !parsed.structured && parsed.raw && parsed.raw !== headline) {
    const rest = parsed.raw.slice(headline.length).trim().replace(/^[\s.]+/, "");
    if (rest) {
      briefing.append(el("p", { class: "triage-briefing-summary", text: rest }));
      bodyShown = true;
    }
  }

  if (routes.length) {
    briefing.append(el("div", { class: "brf-routes", role: "table", "aria-label": "Evidence routes" },
      el("div", { class: "brf-routes-head", text: "Evidence" }),
      routes.map((route) => el("div", { class: "brf-route", role: "row" },
        el("span", { class: "brf-route-from", text: route.from }),
        el("span", { class: "brf-route-arr", "aria-hidden": "true", text: "→" }),
        el("span", { class: "brf-route-to", text: route.to })))));
    bodyShown = true;
  }

  if (blockers.length) {
    briefing.append(el("div", { class: "triage-briefing-section" },
      el("h4", { class: "triage-briefing-label", text: "What's blocking" }),
      el("ul", { class: "triage-briefing-list" }, blockers.map((item) => el("li", { text: item })))));
    bodyShown = true;
  }

  if (findings.length) {
    briefing.append(el("div", { class: "triage-briefing-section" },
      el("h4", { class: "triage-briefing-label", text: "What happened" }),
      el("ul", { class: "triage-briefing-list" }, findings.map((item) => el("li", { text: item })))));
    bodyShown = true;
  }

  if (!bodyShown) {
    briefing.append(el("p", { class: "triage-briefing-summary triage-briefing-summary--quiet", text: blocked
      ? "The investigation could not finish a safe repair path."
      : "The investigation finished and is waiting on fresh source evidence." }));
  }

  // One primary button first; short supporting prose after (never prose-only).
  // Mono timestamps ride the right edge of the action row when the queue item
  // reported them — never synthesized.
  const cta = investigationResultCta(blocked ? "blocked" : "completed", opts.issueId);
  const times = [];
  if (opts.completedAt && Number.isFinite(Date.parse(opts.completedAt))) {
    times.push((blocked ? "blocked " : "completed ") + issueTimestamp(opts.completedAt));
  }
  if (opts.startedAt && Number.isFinite(Date.parse(opts.startedAt))) {
    times.push("started " + issueTimestamp(opts.startedAt));
  }
  briefing.append(el("div", { class: "triage-briefing-section triage-briefing-next" },
    el("h4", { class: "triage-briefing-label", text: "What to do next" }),
    el("div", { class: "brf-actions" },
      cta,
      times.length ? el("span", { class: "brf-times" }, times.map((t) => el("i", { text: t }))) : null),
    el("ul", { class: "triage-briefing-list triage-briefing-list--next" },
      nextSteps.slice(0, 2).map((item) => el("li", { text: item })))));

  briefing.append(el("details", { class: "triage-briefing-raw" },
    el("summary", { text: "Raw output" }),
    el("pre", { text: parsed.raw })));

  return briefing;
}

/* The lifecycle levers beside Queue/Launch. Returns an array so the caller can
   spread it — an empty array when there is no queue record at all, which keeps
   an untriaged finding's row exactly as it was.

     running            -> Cancel investigation (stops the process)
     queued             -> Remove from queue
     completed/blocked  -> Investigate again + Remove record

   "Investigate again" re-POSTs /api/triage/queue: the server replaces any item
   that is not queued or running, so the same call is both the first queue and
   the rerun. No second route, no second vocabulary. */
function triageLifecycleControls(issue, queueItem, queueing, ui = state) {
  if (!queueItem) return [];
  const id = issue.id;
  const cancelling = ui.triagePending.has("cancel:" + id);
  const removing = ui.triagePending.has("remove:" + id);
  const lever = (kind, cls, label, busy, onclick) => el("button", {
    type: "button",
    class: "btn sm " + cls,
    disabled: busy ? "" : null,
    "aria-busy": busy ? "true" : null,
    dataset: { fkey: "triage-" + kind + ":" + id },
    onclick,
  }, label);

  if (queueItem.state === "running") {
    return [lever("cancel", "triage-cancel", cancelling ? "Cancelling…" : "Cancel investigation", cancelling,
      () => removeTriageItem(id, "cancel"))];
  }
  if (queueItem.state === "queued") {
    return [lever("remove", "triage-remove", removing ? "Removing…" : "Remove from queue", removing,
      () => removeTriageItem(id, "remove"))];
  }
  return [
    lever("rerun", "triage-rerun", queueing ? "Requeueing…" : "Investigate again", queueing,
      () => triageIssue(id, "queue")),
    lever("remove", "triage-remove", removing ? "Removing…" : "Remove record", removing,
      () => removeTriageItem(id, "remove")),
  ];
}

function renderTriage(issue, ui = state) {
  const queueItem = ui.queueItems.find((item) => item.issueId === issue.id);
  // A queue item IS a recommendation (TriageQueueItem extends it), so a page
  // reload mid-investigation still shows the plan — not a stale Triage button.
  const recommendation = ui.triage.get(issue.id) || queueItem;
  const queued = !!queueItem;
  const generating = ui.triagePending.has("generate:" + issue.id);
  const queueing = ui.triagePending.has("queue:" + issue.id);
  const launching = ui.triagePending.has("run:" + issue.id);
  const error = ui.triageErrors.get(issue.id);
  const wrap = el("div", { class: "triage-actions" });

  if (!recommendation) {
    wrap.append(el("button", {
      type: "button",
      class: "btn triage-generate",
      disabled: generating ? "" : null,
      "aria-busy": generating ? "true" : null,
      dataset: { fkey: "triage:" + issue.id },
      onclick: () => triageIssue(issue.id, "generate"),
    }, generating ? "Triaging…" : "Triage this finding"));
  } else {
    // Instrument brief (mockup B1): verdict head → vitals band → the plan as
    // an always-visible horizontal step spine → rationale foot. The band only
    // shows instruments we actually know (runModel splits into model/effort/
    // access when the launcher reported them; nothing is fabricated).
    const qState = queueItem ? queueItem.state : null;
    const live = qState ? investigationView(qState) : { label: "Plan ready", tone: "cool" };
    const inst = (value, label) => el("span", { class: "tri-inst" },
      el("span", { class: "tri-inst-v", text: value }),
      el("span", { class: "tri-inst-k", text: label }));
    const band = el("div", { class: "tri-band" });
    const modelParts = queueItem && queueItem.runModel
      ? String(queueItem.runModel).split(/\s*·\s*/).filter(Boolean) : [];
    if (modelParts[0]) band.append(inst(modelParts[0], "model"));
    if (modelParts[1]) band.append(inst(modelParts[1], "effort"));
    if (modelParts[2]) band.append(inst(modelParts[2], "access"));
    if (Number.isFinite(recommendation.affectedAgents) && Number.isFinite(recommendation.affectedPrograms)) {
      band.append(inst(recommendation.affectedAgents + " agents · " + recommendation.affectedPrograms + " programs", "scope"));
    }
    if (Array.isArray(recommendation.providers) && recommendation.providers.length) {
      band.append(inst(recommendation.providers.join(" · "), "evidence"));
    }
    const clockFrom = qState === "completed" || qState === "blocked"
      ? queueItem.startedAt : qState === "running" ? queueItem.startedAt : queueItem ? queueItem.createdAt : null;
    const clockTo = (qState === "completed" || qState === "blocked") && queueItem.completedAt
      ? Date.parse(queueItem.completedAt) : Date.now();
    if (clockFrom && Number.isFinite(Date.parse(clockFrom))) {
      band.append(inst(fmtElapsed(Math.max(0, clockTo - Date.parse(clockFrom))),
        qState === "completed" || qState === "blocked" ? "ran for" : qState === "running" ? "elapsed" : "queued"));
    }
    const plan = el("section", { class: "triage-plan tri-card", "aria-label": "Generated triage" },
      el("div", { class: "tri-head" },
        el("span", { class: "tri-kind tri-kind-" + recommendation.mode, text: recommendation.mode }),
        el("strong", { class: "triage-outcome", text: recommendation.headline }),
        el("span", { class: "tri-live tri-live-" + live.tone },
          el("i", { "aria-hidden": "true" }), live.label)),
      band.childElementCount ? band : null,
      el("ol", { class: "tri-spine" + (qState === "completed" ? " is-done" : "") },
        recommendation.steps.map((step, index) => el("li", { class: "tri-step" },
          el("span", { class: "tri-dot", "aria-hidden": "true", text: qState === "completed" ? "✓" : String(index + 1) }),
          el("strong", { text: step.title }),
          el("span", { text: step.detail })))),
      el("p", { class: "triage-rationale", text: recommendation.rationale }));

    if (recommendation.queueRecommended) {
      plan.append(el("div", { class: "triage-queue-row" },
        el("button", {
          type: "button",
          class: "btn triage-queue",
          disabled: queued || queueing ? "" : null,
          "aria-busy": queueing ? "true" : null,
          dataset: { fkey: "triage-queue:" + issue.id },
          onclick: () => triageIssue(issue.id, "queue"),
        }, queued
          ? investigationView(queueItem.state).button
          : queueing ? "Queueing…" : "Queue investigation"),
        queueItem && queueItem.state === "queued" ? el("button", {
          type: "button",
          class: "btn triage-run",
          disabled: launching ? "" : null,
          "aria-busy": launching ? "true" : null,
          dataset: { fkey: "triage-run:" + issue.id },
          onclick: () => triageIssue(issue.id, "run"),
        }, launching ? "Launching…" : "Launch read-only Luna") : null,
        // Lifecycle. A finding used to be investigable exactly once, ever: a run
        // that finished, or one launched by mistake, was a permanent record with
        // no way back. Cancel is offered only while a run is live, and it stops
        // the process rather than hiding the button; rerun re-queues from the
        // same plan; remove clears a finished record.
        ...triageLifecycleControls(issue, queueItem, queueing, ui),
        el("span", { class: "triage-queue-note", text: queueItem
          ? investigationView(queueItem.state).note
            + (queueItem.state === "running" ? " · " + (queueItem.runModel || "native Luna") : "")
          : "Queues a bounded investigation. Launch remains a separate operator action." })));
      if (queueItem && queueItem.result) {
        plan.append(renderInvestigationResult(queueItem.result, queueItem.state === "blocked" ? "blocked" : "completed",
          { issueId: issue.id, startedAt: queueItem.startedAt, completedAt: queueItem.completedAt }));
      }
    }
    wrap.append(plan);
  }
  if (error) wrap.append(el("p", { class: "triage-error", role: "alert", text: error + " — retry the triage action." }));
  return wrap;
}

/* Work-state for a finding — answers "is anyone on this?" so the board does not
   feel like purgatory. Live optimistic signals (in-flight triage, queue, local
   plan, lifecycle) win first so the UI reacts before the next snapshot; when
   none apply we defer to the server-owned issue.workState, then a severity
   default. Source clearance (lifecycle resolved) outranks a stale queue row. */
function issueWorkState(issue, queueItems = state.queueItems) {
  if (!issue) return { key: "watching", label: "Watching", tone: "info" };
  const id = issue.id;
  if (state.triagePending.has("generate:" + id) || state.triagePending.has("queue:" + id) || state.triagePending.has("run:" + id)) {
    return { key: "triaging", label: "Triaging", tone: "warn" };
  }
  const life = issueLifecycle(issue);
  if (life.state === "resolved") return { key: "cleared", label: "Cleared", tone: "moss" };
  const items = Array.isArray(queueItems) ? queueItems : [];
  const queueItem = items.find((item) => item.issueId === id);
  if (queueItem) {
    if (queueItem.state === "running") return { key: "investigating", label: "Investigating", tone: "info" };
    if (queueItem.state === "queued") return { key: "queued", label: "Queued", tone: "info" };
    if (queueItem.state === "completed") return { key: "verifying", label: "Verifying", tone: "warn" };
    if (queueItem.state === "blocked") return { key: "blocked", label: "Blocked", tone: "error" };
  }
  if (state.triage.has(id)) return { key: "planned", label: "Plan ready", tone: "info" };
  if (life.state === "verifying") return { key: "verifying", label: "Verifying", tone: "warn" };
  if (life.state === "blocked") return { key: "blocked", label: "Blocked", tone: "error" };
  if (issue.workState && WORK_STATE_VIEW[issue.workState]) return WORK_STATE_VIEW[issue.workState];
  if (issue.severity === "error") return { key: "needs", label: "Needs triage", tone: "error" };
  return { key: "watching", label: "Watching", tone: "warn" };
}

/* Discrete stage index 1–4 for the finding rail (Watch → Triage → Verify → Cleared). */
function issueStage(workKeyOrIssue) {
  const key = typeof workKeyOrIssue === "string"
    ? workKeyOrIssue
    : issueWorkState(workKeyOrIssue).key;
  return STAGE_BY_WORK[key] ?? 1;
}

/* Progress 0–100 for a finding's rail — server-owned issue.progress wins;
   otherwise derived from the work state. */
function issueProgress(issue) {
  if (issue && typeof issue.progress === "number" && Number.isFinite(issue.progress)) {
    return Math.max(0, Math.min(100, issue.progress));
  }
  return PROGRESS_BY_WORK[issueWorkState(issue).key] ?? 0;
}

/* Plain-language impact line for a row — server-owned issue.impactSummary wins;
   otherwise the local affectedImpact rollup sentence. Never "Affects (N)". */
function issueImpactLine(issue, snap = state.snap) {
  if (issue && typeof issue.impactSummary === "string" && issue.impactSummary.trim()) {
    return issue.impactSummary.trim();
  }
  return affectedImpact(issue, snap).plain;
}

/* The two resolvers notification-center.js cannot import for itself, since this
   file is the entry point and exports almost nothing. programName applies the
   operator's own aliases out of state.aliases; issueImpactLine prefers the
   server's impactSummary over the local rollup. Passed rather than re-derived,
   so the impact sentence in the notification center and the one in the drawer
   are the same sentence by construction. */
const NOTIFY_DEPS = { programNameFor: programName, impactFor: issueImpactLine };

const IN_MOTION_KEYS = new Set(["triaging", "planned", "queued", "investigating", "verifying"]);

/* Ordered, flattened finding list for the pulse strip's inline expansion — the
   same set the old lanes rendered, minus resolved (those live in the drawer
   and History): interventions that still need a human first, then advisories,
   in-motion work, and orphan queue rows whose issue has left the snapshot. */
function pulseFindings(snap, queueItems = state.queueItems) {
  const issues = issuesOf(snap);
  const issueFindings = issues.map((issue) =>
    findingFromIssue(issue, issue.severity === "error" ? "intervention" : "advisory", snap));
  const issueIds = new Set(issues.map((issue) => issue.id));
  const resolvedIds = new Set(recentlyResolvedOf(snap).map((issue) => issue.id));
  const items = Array.isArray(queueItems) ? queueItems : [];
  const orphanQueueFindings = items
    .filter((item) => !issueIds.has(item.issueId) && !resolvedIds.has(item.issueId))
    .map(findingFromQueueItem);
  return [
    ...issueFindings.filter((f) => f.kind === "intervention" && !IN_MOTION_KEYS.has(f.work.key)),
    ...issueFindings.filter((f) => f.kind === "advisory" && !IN_MOTION_KEYS.has(f.work.key)),
    ...issueFindings.filter((f) => IN_MOTION_KEYS.has(f.work.key)),
    ...orphanQueueFindings,
  ];
}

/* Pure strip model — the renderer and tests share one derivation. calm means
   nothing needs the operator: zero live findings, an operational system, and
   no session near its context ceiling. cells carry the fixed-order weighting
   (urgency changes weight via cell-hot/cell-micro, never order); findings is
   the ordered inline-expansion list. */
const fetchFailedNow = () => Boolean(state && state.fetchFailed);

const CONTEXT_WATCH_PCT = 60;
/* The BAND's alarm, distinct from the drawer's CONTEXT_ALARM_PCT: the drawer
   speaks about one agent's own window, this is the fleet peak that flips the
   whole summary out of its calm line. Named so the calm predicate and the watch
   clause below read the same number — they were the two ends of the 1-point
   cliff the critique measured, and a drift between them would reopen it. */
const CONTEXT_BAND_ALARM_PCT = 85;

/* The watch tier: signals real enough to mention and not urgent enough to
   rearrange the board around.

   The calm/alarmed response used to be a boolean. Driving pulseStripModel up an
   escalation ladder, a board where every live agent was stalled rendered
   pixel-identical to a perfectly healthy one, and the only graded input was a
   one-point cliff — 84% context calm, 85% a full three-cell grid. The cockpit was
   silent until it screamed.

   These clauses are the murmur. They ride the same one line, so the layout does
   not move; escalation to the stressed grid still requires a finding with a
   remedy. Stall in particular is NOT promoted to an alarm on purpose: on this
   fleet many quiet sessions are waiting by design, so the honest treatment is to
   say the number and let the operator judge it. */
/* The one context reading the BAND reasons about.

   The calm predicate walked per-agent tokens (peakContext) while the CONTEXT PEAK
   card and the watch clause read snap.contextPeak, which the server derives from
   the same per-agent contextPct the CTX column shows. Two derivations of one
   quantity, sitting at the two ends of the calm cliff: the board could display
   12% and refuse to go calm because the client walk found 89% — or the reverse.
   The card was moved onto the server's number for exactly this reason; the
   predicate was left behind. */
function bandContextPct(snap) {
  if (snap && Number.isFinite(snap.contextPeak)) return snap.contextPeak;
  const walked = peakContext(snap);
  return walked ? walked.pct : null;
}

/* Sessions the tracker has watched go 15 minutes without moving. Neither working
   nor done, and computed by pulse.ts long before anything rendered it. */
function stalledCount(snap) {
  const momentum = snap && snap.pulse && snap.pulse.momentum;
  return momentum && momentum.stalled > 0 ? momentum.stalled : 0;
}

/* "18 quiet 15m+", with the 15 coming off the wire.

   pulse.ts ships stallThresholdMs and the client hardcoded "15m+" in three
   separate places — the momentum card, the watch clause and the resting vitals.
   Three copies of a server-owned constant: change the threshold to 10 minutes
   and every one of them keeps saying 15, confidently and wrongly, on a count
   that is now measuring something else. (GPT day review §2.) */
function stallText(snap, count = stalledCount(snap)) {
  if (!count) return "";
  const momentum = snap && snap.pulse && snap.pulse.momentum;
  const ms = momentum && Number.isFinite(momentum.stallThresholdMs) ? momentum.stallThresholdMs : null;
  return `${count} quiet ${ms ? fmtElapsed(ms) : "15m"}+`;
}

function watchClauses(snap) {
  const clauses = [];
  const stalled = stalledCount(snap);
  if (stalled) clauses.push(stallText(snap, stalled));
  /* Context peak is an EARLY warning, which means the range that matters is
     below the alarm — above 85% it is no longer early, and the stressed grid
     gives it a cell of its own, so the murmur stands down rather than saying the
     same number twice. */
  const peak = bandContextPct(snap);
  if (peak != null && peak >= CONTEXT_WATCH_PCT && peak < CONTEXT_BAND_ALARM_PCT) {
    clauses.push(`peak ctx ${peak}%`);
  }
  /* Sessions the board can watch but not type into.

     Routed by the docs lane, and their guide is the evidence: writing up the
     fail-closed gate, they had to tell the reader twice that the board "looks
     healthy" and "reads perfectly healthy" while Send is greyed out. A document
     apologising for an interface is the interface failing to say something.

     It is a real capability loss — the operator believes they can send to these
     rows and cannot — and it is invisible, because nothing else on a calm board
     counts it: controlHealth reports cmux reachability and collector faults, not
     rows whose identity is merely unproven.

     The WATCH tier, not an alert. Nothing is broken, Focus still works, and it
     clears itself the moment cmux attests the session, so it belongs in the
     murmur beside stall and context — worth mentioning, not worth rearranging
     the board around. */
  const unproven = unaddressableCount(snap);
  if (unproven) clauses.push(`${unproven} can't take commands`);
  return clauses;
}

/* Live sessions the board may watch but not type into. One derivation, read by
   the health card and the calm murmur alike, so the two can never disagree about
   how many there are.

   D6: `quarantined` counts too. It used to count `unproven` only, which made the
   sentence "N can't take commands" undercount by exactly the rows an operator is
   most likely to try — a quarantined row is the one with a red mark on it, and
   Send is off there for the same reason and with the same consequence. On the
   live board that was 9–11 quarantined Grok sessions the count could not see.
   `observed-only` is deliberately still excluded: it is the resting state of
   every session with no cmux surface at all (all of Grok Build), so counting it
   would report most of a healthy board as a shortfall. */
function unaddressableCount(snap) {
  return snapshotAgents(snap)
    .filter(({ agent }) => {
      if (deriveActivity(agent) === "ended") return false;
      const control = deriveControlState(agent);
      return control === "unproven" || control === "quarantined";
    })
    .length;
}

/* "All clear" was a claim about the whole board computed from a four-input
   predicate that never read stall, debris or context occupancy. Rather than
   widen the predicate to match the words, the words narrow to what is actually
   known: once anything is being watched, the verdict is Watch. */
function calmVerdict(clauses) {
  return clauses.length ? "Watch" : "All clear";
}

function pulseStripModel(snap, conn = "live", queueItems = [], display = "percent", queueError = "") {
  const attention = attentionSummary(snap);
  const status = systemStatus(snap, conn);
  const bandPct = bandContextPct(snap);
  /* Calm is a claim about the WHOLE board, so it cannot be made while one of the
     board's inputs is missing. An unreachable triage queue contributes zero
     findings exactly like an empty one; without this the strip would fold into
     its calm line and hide the fact that it is reasoning on partial evidence. */
  const calm = !!snap && !!attention && attention.count === 0
    && status.key === "operational" && !(bandPct != null && bandPct >= CONTEXT_BAND_ALARM_PCT) && !queueError;
  // `display` is threaded so renderHealthRail can compute each widget's data
  // ONCE and reuse it for the paint signature, the cell and the calm line —
  // it used to derive the same three from scratch on every paint.
  /* A cell that has nothing to report does not render. This is the single
     convention behind audit §5, §11, §14 and §20: four findings that were all
     the same bug — widgets rendering their EMPTY state instead of not rendering.
     Four cells reporting absence around one cell reporting a fault is how a band
     that always renders loses the ability to signal by rendering.

     "Nothing needs you" in particular was asserted by three separate widgets at
     once, and an operator who learns that a counter always reads 0 stops reading
     it — which is exactly when it turns 1. */
  const speaks = (id, data) => {
    if (id === "health") return data.tone !== "ok";
    // The rest are instruments: they speak when they have a reading.
    return data.tone !== "missing" && data.value !== "No data";
  };
  const cells = DEFAULT_WIDGET_IDS.map((id) => {
    const data = summaryWidgetData(id, snap, conn, display, queueItems, undefined, queueError);
    /* Weight follows actionability, not tone. An advisory used to ride at micro
       on the reasoning that there was "nothing for the operator to do right
       now" — true when the card could only name a symptom, false now that a
       non-clear verdict carries a remedy. Micro renders the headline alone, so
       collapsing an advisory deletes the very answer the card exists to give:
       the board would say something needs tidying and hide what to do about it.

       A clear verdict still rides at micro. Nothing is wrong, so the card makes
       no claim to justify, and a cockpit that stays quiet when quiet is the
       truth is the point. Pending tidy-up is carried on the chip's tooltip
       rather than promoted into a cell it does not deserve. */
    const weight = id === "health"
      ? (data.tone === "ok" ? "micro" : "normal")
      : data.tone === "hot" ? "hot" : "normal";
    return { id, weight, data, speaks: speaks(id, data) };
  });
  /* Audit §6's overlap suppression stood here. When the board's top finding WAS
     the system fault, NEEDS YOU and HEALTH said the same sentence at two
     altitudes, so HEALTH was suppressed and handed its remedy to the cell that
     survived. Both halves are moot: NEEDS YOU is retired, so there is no second
     altitude to collide with, and nothing is left to hand a remedy to.

     The collision cannot recur, because it was never really about two cards. It
     was one fact — a system fault — being counted in the header and described in
     the header at the same time. The header now describes and never counts. */
  const kept = cells.filter((cell) => cell.speaks);
  return {
    calm,
    watch: calm ? watchClauses(snap) : [],
    cells: kept,
    allCells: cells,
    findings: pulseFindings(snap, queueItems),
    queueError,
  };
}

function findingFromIssue(issue, kind, snap = state.snap) {
  const work = issueWorkState(issue);
  const rollup = affectedImpact(issue, snap);
  const life = issue.lifecycle;
  return {
    kind,
    id: issue.id,
    title: issue.title,
    work,
    impact: issueImpactLine(issue, snap),
    summary: issue.summary || issueImpactLine(issue, snap),
    evidence: rollup.programs.map((program) => program.name + " · " + program.count),
    since: life && (life.verificationStartedAt || life.openedAt) || null,
    progress: issueProgress(issue),
    pin: kind === "intervention" && work.key === "needs",
  };
}

function findingFromQueueItem(item) {
  const view = investigationView(item.state);
  const work = WORK_STATE_VIEW[view.work] || WORK_STATE_VIEW.queued;
  const scope = Number.isFinite(item.affectedAgents) && Number.isFinite(item.affectedPrograms)
    ? item.affectedAgents + " agents · " + item.affectedPrograms + " programs" : "";
  return {
    kind: "investigation",
    id: item.issueId,
    title: item.headline,
    work,
    impact: "Investigation " + view.label.toLowerCase(),
    summary: "Investigation " + view.label.toLowerCase(),
    evidence: [scope, item.runModel || ""].filter(Boolean),
    since: item.startedAt || item.createdAt || null,
    progress: PROGRESS_BY_WORK[work.key] ?? 50,
    pin: false,
  };
}

/* ---------- toolbar ---------- */

/* One raw snapshot, two consumers:

     raw snapshot ──> health / heartbeat TL;DR / usage / debug
              └────> dashboardPrograms() ──> rows / shelves / counts / drawers

   `system` names infrastructure the operator observes, not work they navigate.
   Filter shallow presentation copies so operational evidence remains complete
   and no counter can accidentally read a different population from its rows. */
function dashboardVisible(agent) {
  return sessionKindOf(agent) !== "system";
}

function dashboardPrograms(snap) {
  if (!snap || !Array.isArray(snap.programs)) return [];
  return snap.programs
    .map((program) => ({
      ...program,
      agents: (program.agents || []).filter(dashboardVisible),
    }))
    .filter((program) => program.agents.length > 0);
}

/* Board is the operator's work view, not a denial of what the collector saw.
   Review workers are hidden only when they are routine and non-attention; a
   review that needs a person remains pinned and visible. A search is an
   explicit request, so a matching review worker is also admitted. History
   remains complete regardless of this Board-only presentation choice.

   The gate reads `sessionKindOf`, not the regex directly: the kind is the
   server's verdict from launch evidence wherever it has one, and the prose
   patterns are now only the transition fallback beneath it. */
function passesReviewVisibility(agent, view, showReviewWorkers = state.showReviewWorkers, searchMatches = false) {
  return view !== "board"
    || showReviewWorkers
    || sessionKindOf(agent) !== "review"
    || alerting(agent)
    || searchMatches;
}

function reviewWorkerCount(ui = state) {
  if (!ui.snap || ui.view !== "board") return 0;
  return snapshotAgents(ui.snap)
    .map(({ agent }) => agent)
    .filter((agent) => dashboardVisible(agent)
      && sessionKindOf(agent) === "review"
      && viewMatches("board", agent)
      && passesLookback(agent, "board", ui.lookbackHours)
      && !alerting(agent))
    .length;
}

/* Optimistic: the chip flips on the click, and the POST follows.

   A rejected save puts it back, because nothing else would. `fetchSettings`
   runs once at boot, so there is no later read to correct an optimistic write —
   without this the chip would keep asserting a visibility the server refused,
   over a board still filtered the old way, until a reload. The guard yields to
   a second toggle that landed while this one was in flight: the operator's
   newer choice outranks this one's rollback. */
function setShowReviewWorkers(show) {
  const next = Boolean(show);
  if (next === state.showReviewWorkers) return;
  state.showReviewWorkers = next;
  render();
  void postSettings({ showReviewWorkers: next }).then((saved) => {
    if (saved || state.showReviewWorkers !== next) return;
    state.showReviewWorkers = !next;
    render();
  });
}

/* Session-scoped lenses, deliberately unlike the review toggle above them: that
   one is the fleet's shared default and goes to the server, these are "what am I
   looking at right now" and die with the tab.

   Every one is a SET. Toggling a member in or out is the whole operation, and an
   empty set is the lens off — the way out is the way in, as it was when these
   were chips, except that now picking a second value ADDS to the first instead
   of replacing it. "Working and waiting" is the question this shape exists to
   let an operator ask; the scalar form answered it with "waiting". */
function toggleFacet(stateKey, value) {
  const current = state[stateKey] || [];
  state[stateKey] = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  render();
}

/* Clear the axis. Separate from toggleFacet rather than folded into it as a
   sentinel value, because "" is a LEGAL MEMBER of the model axis (it is how a
   row with no reported model is stored) — overloading it as "clear everything"
   would make the Unreported item un-unselectable. */
function clearFacet(stateKey) {
  if (!(state[stateKey] || []).length) return;
  state[stateKey] = [];
  render();
}

function setFacetProvider(provider) {
  if (provider === "") { clearFacet("facetProviders"); return; }
  toggleFacet("facetProviders", provider);
}

function setFacetStatus(status) {
  if (status === "") { clearFacet("facetStatuses"); return; }
  toggleFacet("facetStatuses", status);
}

/* Does this agent pass one lens? Empty set = lens off = everything passes;
   otherwise the members UNION. The single place that rule is written. */
function passesLens(agent, values, matches) {
  if (!values || !values.length) return true;
  return values.some((value) => matches(agent, value));
}

/* Set from the program drawer ("Only this program"), cleared from the Filters
   bar, or driven by the TL;DR proof rows/chips (board scope only — the fleet
   story stays). Chevrons call setTldrView so they page the masthead and the
   board together. Programs are unbounded, so there is no always-on chip list for them
   — the bar carries one clear-chip while the lens is active, which is the whole
   disclosure obligation: a narrowing is always one visible control from off. */
function setFacetProgram(programId) {
  const next = state.facetProgram === programId ? "" : programId;
  if (next === state.facetProgram) return;
  state.facetProgram = next;
  applyFacetTldrSync(next);
  if (state.uiReady) render();
  else {
    state.paintSig.widgets = "";
    renderHealthRail();
  }
}

/* The lookback is a recency window over `updatedAt`, and `updatedAt` is
   heartbeats — so the rows it drops FIRST are the ones quiet longest, which on
   this board is precisely the blocked-on-a-human population it exists to
   surface. A lane that asked a question eight hours ago and has been sitting at
   its prompt ever since is the most important row on the fleet and the first
   casualty of a 6h window.

   The exemption is `stripAlerting`, not `alerting`: an ACKED ask goes back
   under the window's authority, because the operator has already answered it
   and it is no longer the thing they are being kept from seeing.

   It lives at the call sites rather than inside passesLookback, which stays
   pure: that helper is shared with History and the shelf, and teaching it
   presentation state would make one window mean two things depending on who
   asked. */
function withinWindowOrAsking(agent, view, lookbackHours, snap = state.snap) {
  return stripAlerting(agent, snap) || passesLookback(agent, view, lookbackHours);
}

function currentFilter() {
  return (agent, program) =>
    dashboardVisible(agent) &&
    viewMatches(state.view, agent) &&
    withinWindowOrAsking(agent, state.view, state.lookbackHours) &&
    matchesQuery(agent, program, state.query) &&
    passesReviewVisibility(
      agent,
      state.view,
      state.showReviewWorkers,
      Boolean(state.query) && sessionKindOf(agent) === "review" && matchesQuery(agent, program, state.query),
    ) &&
    (!state.facetProgram || program.id === state.facetProgram) &&
    passesEveryLens(agent, state);
}

/* Every lens axis, ANDed. Within an axis the members union (passesLens); across
   axes they intersect, which is the rule that was already true when there were
   two scalars and is now written once for five sets. */
function passesEveryLens(agent, ui = state) {
  return LENS_AXES.every((axis) => passesLens(agent, ui[axis.stateKey], axis.matches));
}

/* The lifecycle lens, reusing the sections the board already draws. "working"
   is the one name that does not match its section key — the section is `active`
   — so the translation lives here rather than in four call sites. */
function matchesStatusLens(agent, facetStatus) {
  if (!facetStatus) return true;
  return lifecycleSection(agent) === (facetStatus === "working" ? "active" : facetStatus);
}

/* The finished sessions a LIVE view has excluded — the Finished shelf's
   population. Every filter the board is currently wearing except the view's own
   lifecycle test, which is the one this deliberately recovers.

   It answers a question the board was leaving open: a worktree whose header
   rolls up 4 agents while its body draws 2 has not said where the other two
   went, and "they finished" is a different sentence from "they are hidden by
   your search". So the shelf keeps the search, the facets and the lookback —
   a filtered board must not grow a shelf of rows that do not match it.

   History is exempt and that is not a detail: there, finished IS the
   population, and a shelf holding every row would be a collapsed view. */
function shelfFilter() {
  if (state.view === "history") return () => false;
  /* A lifecycle lens and a shelf of finished rows are contradictory claims: the
     operator asked to see only what is waiting, and every row on this shelf is
     over. Rather than show a shelf the lens excludes row by row, the shelf goes
     away whole while a lens is on. Same rule in set form — NON-EMPTY suppresses,
     so turning every status back off (the empty set) brings the shelf back, and
     "both off" and "never touched" are correctly the same board. */
  if (state.facetStatuses.length) return () => false;
  return (agent, program) =>
    /* Two ways to be finished, and the shelf holds both. `isTerminal` is the
       PROCESS ending. `declaredDone` is the WORK ending — a lane that reported
       DONE and stayed at its prompt, which is the normal shape of a lane
       waiting to be told what is next. Its controls are still live and its
       lifecycle still says `waiting`; what changed is that it is no longer work
       in flight, and the shelf is the surface that answers "where did the row I
       was looking at go". */
    dashboardVisible(agent) &&
    (isTerminal(agent) || declaredDone(agent)) &&
    !viewMatches(state.view, agent) &&
    withinWindowOrAsking(agent, state.view, state.lookbackHours) &&
    matchesQuery(agent, program, state.query) &&
    passesReviewVisibility(
      agent,
      state.view,
      state.showReviewWorkers,
      Boolean(state.query) && sessionKindOf(agent) === "review" && matchesQuery(agent, program, state.query),
    ) &&
    (!state.facetProgram || program.id === state.facetProgram) &&
    /* Every lens EXCEPT status, which the early return above has already
       answered for the whole shelf. Filtering a shelf by a lifecycle when the
       shelf's entire population is finished would empty it row by row and say
       nothing about why. */
    LENS_AXES.filter((axis) => axis.key !== "status")
      .every((axis) => passesLens(agent, state[axis.stateKey], axis.matches));
}

/* Where an arrow key inside the tab strip lands. Pure so the wrap rules are
   testable without a browser: Left/Right WRAP (a six-item strip is small enough
   that wrapping is faster than reversing, and it is what the tablist pattern
   specifies), Home/End jump to the ends. */
function nextViewIndex(current, key, count) {
  if (count <= 0) return -1;
  switch (key) {
    case "ArrowRight": return (current + 1 + count) % count;
    case "ArrowLeft": return (current - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return -1;
  }
}

/* Is the operator typing? A shortcut that steals a keystroke from a text field
   is worse than no shortcut. */
function isTypingTarget(target) {
  if (!target || !target.tagName) return false;
  const tag = String(target.tagName).toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

/* Board-level keys. `/` is the search shortcut every list-shaped tool has had
   for thirty years, and its absence is why search was eleven stops away. */
function handleCockpitKeys(e, ui = state) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.key === "/" && !isTypingTarget(e.target)) {
    const box = $("search");
    if (!box) return false;
    e.preventDefault();
    box.focus();
    if (typeof box.select === "function") box.select();
    return true;
  }
  const inStrip = e.target && e.target.closest && e.target.closest("#views");
  if (!inStrip) return false;
  const next = nextViewIndex(VIEWS.indexOf(ui.view), e.key, VIEWS.length);
  if (next < 0) return false;
  e.preventDefault();
  setView(VIEWS[next]);
  const btn = document.querySelector(`#views .view-tab[data-view="${VIEWS[next]}"]`);
  if (btn) btn.focus();
  return true;
}

/* ---------- the working set ----------

   view × time × review policy, and deliberately nothing else.

   This is the two-layer model in one function. The WORKING SET is what the board
   is looking at: which view, how far back, and whether the fleet's shared review
   policy admits the routine reviewers. The LENSES — provider, status, program —
   and the search query narrow INSIDE it and are absent here on purpose.

   Every number that claims to describe the board is taken over this population:
   the tab count, the per-item counts in the provider and status menus, and the
   "of 21" the sentence reconciles against. One helper, so those three can never
   drift into counting three different things and calling them all the total. */
function workingSet(ui = state, view = ui.view) {
  if (!ui.snap) return [];
  return snapshotAgents(ui.snap)
    .map(({ agent }) => agent)
    .filter((agent) =>
      dashboardVisible(agent)
      && viewMatches(view, agent)
      // Same exemption as currentFilter, and it has to be the same or the
      // "showing N of M" sentence disagrees with the list right under it.
      && withinWindowOrAsking(agent, view, ui.lookbackHours, ui.snap)
      && passesReviewVisibility(agent, view, ui.showReviewWorkers));
}

function renderTabs() {
  const agents = snapshotAgents(state.snap).map((x) => x.agent).filter(dashboardVisible);
  for (const view of OPS_VIEWS) {
    const countNode = $("count-" + view);
    if (!countNode) continue;
    const count = state.snap ? workingSet(state, view).length : null;
    const unverified = count != null && view === "board"
      ? agents.filter((a) => passesReviewVisibility(a, view, state.showReviewWorkers) && isUnverified(a)).length
      : 0;
    const unverifiedNote = unverified > 0 ? " · " + unverified + " unverified" : "";
    /* Tabs are navigation and counts. The active time window belongs to the
       single filter bar below, so a tab never repeats it as a second toggle. */
    countNode.textContent = count == null ? "" : String(count) + unverifiedNote;
    /* Zero counts go quiet rather than disappearing.

       At n=3 the navigation reads "Needs you 0 | Now 3 | Working 3 | Idle 0 |
       History 0" — three of five tabs at zero, and a row of zero counters is a
       new operator's first impression of the interface. The audit asked for
       Idle and History to be HIDDEN at zero, matching the summary band.

       I disagree, for the reason I gave when rejecting the same proposal for the
       Needs-you tab: a band cell is an instrument and a tab is a destination. A
       tab that appears only once it has content never gets learned, the nav
       changes shape underneath the operator as the fleet grows, and on the quiet
       board — the one case this is meant to serve — it would teach a newcomer
       that the board has three views when it has five.

       Weight is the honest lever, and it is the counter-proposal I offered that
       lane at the time: the tab keeps its place and its label, the zero recedes.
       Nothing is hidden and nothing shouts. */
    countNode.classList.toggle("is-zero", count === 0);
    /* Ember ink on the Board count when something on it is asking for a person.
       It used to ride the Needs-you tab, whose count WAS the alert count; Board
       counts the whole live fleet, so the ink has to key on the alerting
       population rather than on the number beside it — otherwise every board
       with a single working agent would glow. The strip below carries the
       names; this is the mark you can see from another tab.
       (C2's is-alerting modifier: ember ink, never a fill.) */
    if (view === "board") {
      countNode.classList.toggle("is-alerting", agents.some((a) => stripAlerting(a, state.snap)));
    }
  }
  for (const btn of document.querySelectorAll("#views .view-tab")) {
    const isCurrent = btn.dataset.view === state.view;
    btn.setAttribute("aria-pressed", String(isCurrent));
    btn.classList.toggle("is-current", isCurrent);
    /* Roving tabindex: the tab strip is ONE stop, not six. Measured before this
       change, search sat at the 11th tab stop with the six tabs occupying six of
       the ten ahead of it — reaching the board's primary filter meant tabbing
       through every view first. Arrows move within the strip, which is the
       standard tablist contract and what a screen-reader user already expects. */
    btn.tabIndex = isCurrent ? 0 : -1;
  }
  const search = $("search");
  const opsRow = $("ops-toolbar-row");
  if (opsRow) opsRow.hidden = state.view === "usage";
  if (search) search.disabled = state.view === "usage";
}

/* Every chip carries a data-fkey. renderFilterBar tears the whole bar down on
   each paint, so without one a keyboard operator's focus fell to <body> roughly
   fifteen times a minute — render()'s focus-restore contract keys on nothing
   else. The key is stable across paints (it names the control, not the label). */
function filterChip(label, active, onclick, opts = {}) {
  return el("button", {
    type: "button",
    class: "filter-chip" + (active ? " is-active" : ""),
    /* Every chip on this bar is a toggle now, so every one reports a pressed
       state. The exemption this used to carry — along with the icon, alert and
       className options — existed for the scan control, which opened an editor
       rather than toggling. That control is a read-only <span> here today and
       its editor lives in Settings, so the affordances retire with it. */
    "aria-pressed": String(Boolean(active)),
    disabled: opts.disabled ? "" : null,
    title: opts.title || null,
    dataset: opts.fkey ? { fkey: opts.fkey } : null,
    onclick,
  }, label);
}

/* Lookback + scan-window controls for Idle/History; Usage range for Usage. */
/* The class vocabulary, in the order the menu offers it, with the word each one
   wears on screen.

   Ordered by what the class MEANS rather than alphabetically: the fleet-shaped
   answers first (who is being reviewed, who runs the fleet), then the
   disciplines, then the remaining published roles, then the floor. The labels
   are spelled here rather than borrowed from ROLE_LABELS because half of these
   are not roles — `reviewer` is a session kind and `frontend`/`backend` are
   specialties — and the two that overlap read differently on this axis:
   "Frontend", not the roster caption "Frontend / designer".

   This list and agentClassOf's precedence are two statements of one vocabulary
   and nothing in the language keeps them together, so a test drives every branch
   of the precedence and requires each answer to come back as a labeled option —
   a class with no entry here would be dropped from the menu, which is a row
   hidden behind a filter with no item able to un-hide it. */
const AGENT_CLASSES = [
  ["reviewer", "Reviewer"],
  ["orchestrator", "Orchestrator"],
  ["frontend", "Frontend"],
  ["backend", "Backend"],
  ["automation", "Automation"],
  ["tester", "Tester"],
  ["verifier", "Verifier"],
  ["worker", "Worker"],
  ["monitor", "Monitor"],
  ["service", "Service"],
  ["human", "Human"],
  ["agent", "Agent"],
];

/* The lifecycle lens values, in the order the board stacks their sections. The
   value is the lens; the label SPELLS OUT what it encompasses, because "Waiting"
   alone was a word an operator had to already know the board's meaning of. */
const STATUS_LENSES = [
  ["working", "Working", "running right now"],
  ["waiting", "Waiting", "blocked on you or idle"],
  ["unverified", "Unverified", "liveness not established"],
];

/* Session length, bucketed over the SAME first-to-last-activity duration the
   SPAN cell prints (liveElapsedMs) — never a second clock. Half-open ranges so
   every measurable span lands in exactly one bucket and 8h is not counted twice. */
const SPAN_BUCKETS = [
  ["under-1h", "Under 1h", 0, 3_600_000],
  ["1-8h", "1–8h", 3_600_000, 8 * 3_600_000],
  ["8-24h", "8–24h", 8 * 3_600_000, 24 * 3_600_000],
  ["over-24h", "Over 24h", 24 * 3_600_000, Infinity],
];

/* Context-window occupancy, over contextUsage().pct. `unreported` is a member
   rather than a gap: contextUsage returns null for anything that is not an
   observed latest-turn reading, which on a real board is a large population, and
   an axis whose buckets silently exclude it would hide rows behind a filter with
   no item to un-hide them. Same reason the board names Unverified at all. */
const CONTEXT_BUCKETS = [
  ["under-25", "Under 25%", 0, 25],
  ["25-50", "25–50%", 25, 50],
  ["50-75", "50–75%", 50, 75],
  ["over-75", "Over 75%", 75, Infinity],
];

/* The value stored for "this row reports no model". The empty string is the
   honest key — it is what `agent.model || ""` already yields everywhere else in
   this client — and it is why clearFacet exists separately from toggleFacet:
   "" is a real member here, not a sentinel for "no selection". */
const UNREPORTED = "";

/* ---------- the lens axes ----------

   One table. The five menus, their counts, the filter predicate, the shelf's
   exemption and (next) the sentence's fragments all read it, so an axis cannot
   be filtered by one rule and described by another — which is exactly how the
   old bar ended up with chips that narrowed the list while the number beside
   them refused to move.

   Each axis declares: where its state lives, what values the CURRENT WORKING SET
   offers, how a value matches an agent, and how to say it in English. */
const LENS_AXES = [
  {
    /* Class leads, because it answers WHO the agent is — provider, model, span
       and context are all questions about the same agent once you know that. It
       also carries the fleet's review policy in its footer (see `footer`), which
       is the one thing on this bar that is not a lens. */
    key: "class",
    stateKey: "facetClasses",
    label: "Class",
    allLabel: "All classes",
    views: null,
    options: (agents) => {
      const present = new Set(agents.map((agent) => agentClassOf(agent)));
      return AGENT_CLASSES.filter(([value]) => present.has(value))
        .map(([value, label]) => ({ value, label, short: label.toLowerCase() }));
    },
    matches: (agent, value) => agentClassOf(agent) === value,
    footer: (ui) => reviewPolicyFooter(ui),
  },
  {
    key: "provider",
    stateKey: "facetProviders",
    label: "Harness",
    allLabel: "All harnesses",
    views: null,
    options: (agents) => {
      // Enumerate from the snapshot's healthy harnesses so Codex/Cursor/Factory appear even when 0 live in the current view
      // Fallback to agents present when snapshot not yet loaded (initial skeleton)
      const fromHealth = state.snap?.totals?.sourceHealth?.byProvider ? Object.keys(state.snap.totals.sourceHealth.byProvider) : [];
      const fromAgents = [...new Set(agents.map((a) => a.provider).filter(Boolean))];
      const all = [...new Set([...fromHealth, ...fromAgents])].sort();
      return all.map((provider) => {
        const hKey = provider.toLowerCase();
        const label = (HARNESS_MARK[hKey]?.label || providerLabel(provider) || provider);
        return { value: provider, label };
      });
    },
    matches: (agent, value) => agent.provider === value,
  },
  {
    key: "status",
    stateKey: "facetStatuses",
    label: "Status",
    allLabel: "All statuses",
    /* Board only: History is a view of finished work, where "still working" is
       not a question the rows can answer. */
    views: ["board"],
    options: () => STATUS_LENSES.map(([value, label, means]) => ({
      value, label: label + " — " + means,
      // The sentence wants the bare word, not the gloss.
      short: label.toLowerCase(),
    })),
    matches: (agent, value) => matchesStatusLens(agent, value),
  },
  {
    key: "model",
    stateKey: "facetModels",
    label: "Model",
    allLabel: "All models",
    views: null,
    options: (agents) => {
      /* modelShort() returns null for placeholder strings ("<synthetic>") that
         are nonetheless truthy on live rows — fall back to the raw value or the
         label is null and the menu render dies on .toLowerCase(). Measured
         live 2026-08-06: the board failed to paint on exactly this. */
      const named = [...new Set(agents.map((a) => a.model).filter(Boolean))].sort()
        .map((model) => ({ value: model, fkey: model, label: modelShort(model) || model }));
      return agents.some((a) => !a.model)
        ? [...named, { value: UNREPORTED, fkey: "unreported", label: "Unreported", short: "no reported model" }]
        : named;
    },
    matches: (agent, value) => (value === UNREPORTED ? !agent.model : agent.model === value),
  },
  {
    key: "span",
    stateKey: "facetSpans",
    label: "Span",
    allLabel: "Any length",
    /* History too: how long a finished session ran is one of the few questions
       History exists to answer. */
    views: null,
    options: (agents) => {
      const buckets = SPAN_BUCKETS.map(([value, label]) => ({ value, label, short: label.toLowerCase() }));
      return agents.some((a) => spanMsOf(a) == null)
        ? [...buckets, { value: UNREPORTED, fkey: "unreported", label: "Unreported", short: "no measured span" }]
        : buckets;
    },
    matches: (agent, value) => {
      const ms = spanMsOf(agent);
      if (value === UNREPORTED) return ms == null;
      const bucket = SPAN_BUCKETS.find(([key]) => key === value);
      return bucket != null && ms != null && ms >= bucket[2] && ms < bucket[3];
    },
  },
  {
    key: "context",
    stateKey: "facetContexts",
    label: "Context",
    allLabel: "Any context",
    views: null,
    options: (agents) => {
      const buckets = CONTEXT_BUCKETS.map(([value, label]) => ({ value, label, short: label.toLowerCase() + " context" }));
      return agents.some((a) => contextUsage(a.tokens) == null)
        ? [...buckets, { value: UNREPORTED, fkey: "unreported", label: "Unreported", short: "no context reading" }]
        : buckets;
    },
    matches: (agent, value) => {
      const usage = contextUsage(agent.tokens);
      if (value === UNREPORTED) return usage == null;
      const bucket = CONTEXT_BUCKETS.find(([key]) => key === value);
      return bucket != null && usage != null && usage.pct >= bucket[2] && usage.pct < bucket[3];
    },
  },
];

/* The row's own span number, drift-corrected exactly as the SPAN cell corrects
   it. One derivation for the cell and the lens — see liveElapsedMs. */
function spanMsOf(agent) {
  return liveElapsedMs(agent, state.snap && state.snap.generatedAt);
}

/* Which lenses are ON, and the English for each. The shared vocabulary: the
   empty-state sentence and the scope sentence both read this, so an operator who
   empties the board with one filter and then reads why is told the same words
   twice rather than two paraphrases of one fact.

   `short` where an option defines one — "working" rather than "Working — running
   right now", which is a menu label doing a menu's job and would read as a
   ransom note inside a sentence. */
function activeLenses(ui = state) {
  return LENS_AXES
    .map((axis) => {
      const selected = ui[axis.stateKey] || [];
      if (!selected.length) return null;
      const options = axis.options(workingSet(ui));
      return {
        axis,
        values: selected,
        words: selected.map((value) => {
          const option = options.find((o) => o.value === value);
          return (option && (option.short || option.label)) || value || "unreported";
        }),
      };
    })
    .filter(Boolean);
}

/* What one axis offers right now, each option carrying its WORKING-SET count —
   the same population the tab number counts, so an operator reading "codex (5)"
   beside a tab reading 21 is reading two true numbers about one board. The other
   lenses are deliberately not applied: an option that reported its count AFTER
   the other lenses would drop to zero as you narrowed, and a menu of zeroes
   cannot be used to widen back out. */
function lensOptions(axis, ui = state) {
  const agents = workingSet(ui);
  const selected = ui[axis.stateKey] || [];
  return axis.options(agents).map((option) => ({
    ...option,
    count: agents.filter((agent) => axis.matches(agent, option.value)).length,
    checked: selected.includes(option.value),
  }));
}

/* Does this axis get a menu? The rule the provider chips already followed,
   generalised: a filter whose only option is "everything" is furniture. Two or
   more options have to be POPULATED before an axis is worth a trigger — with one
   exception, an axis the operator has already narrowed always keeps its control,
   because a lens with no visible way off is the one thing this bar may never
   ship. */
function lensApplies(axis, ui = state) {
  if ((ui[axis.stateKey] || []).length) return true;
  /* An axis whose menu carries something OTHER than its own options renders
     whenever that something has to be reachable. The Class menu holds the
     fleet's review policy, and an axis that declined to render would take the
     policy down with it — reviewers hidden with no control anywhere able to
     show them, which is the one thing this bar may never ship. */
  if (axis.footer && axis.footer(ui)) return true;
  if (axis.views && !axis.views.includes(ui.view)) return false;
  return lensOptions(axis, ui).filter((option) => option.count > 0).length >= 2;
}

/* ---------- filter menus ----------

   Which trigger each open menu belongs to. `state.openFilterMenu` names the MENU
   ("time"), the trigger carries the fkey the rest of the client addresses it by
   ("lookback:menu") — the fkey namespaces are the ones operators' focus restore
   and muscle memory were already built on, so they are kept rather than renamed
   to match a new state field.

   A lens menu's trigger is always `<axis key>:menu`, so it is DERIVED from the
   axis table rather than listed here. This was a hand-kept map of three when the
   bar had five lens menus, and Escape out of Model, Span or Context therefore
   looked up nothing and dropped a keyboard operator on <body> — the one failure
   the whole fkey contract exists to prevent. Adding Class would have made it
   four names short of six; deriving it makes a new axis impossible to forget. */
const FILTER_MENU_TRIGGERS = { time: "lookback:menu" };

function filterMenuTriggerKey(menu) {
  if (FILTER_MENU_TRIGGERS[menu]) return FILTER_MENU_TRIGGERS[menu];
  return LENS_AXES.some((axis) => axis.key === menu) ? menu + ":menu" : "";
}

/* Put a keyboard operator back on the control they opened the menu from.

   By fkey, never by node reference: the render() that closes the menu detaches
   every node this handler was built on, and calling focus() on a detached
   element is a silent no-op that lands the operator on <body> — the same failure
   the whole data-fkey contract exists to prevent. */
function focusFilterTrigger(triggerKey) {
  if (!triggerKey || typeof document.querySelector !== "function") return;
  const trigger = document.querySelector(`[data-fkey="${CSS.escape(triggerKey)}"]`);
  if (trigger && typeof trigger.focus === "function") trigger.focus({ preventScroll: true });
}

/* The trigger was clicked. One menu open at a time, deliberately: two dropdowns
   hanging off the same 40px bar would overlap, and a click landing in the overlap
   belongs to neither. Clicking the open trigger closes it, so the way out is the
   way in — the same rule the lens setters follow. */
function setOpenFilterMenu(menu) {
  state.openFilterMenu = state.openFilterMenu === menu ? "" : menu;
  render();
}

function closeFilterMenu() {
  if (!state.openFilterMenu) return;
  const triggerKey = filterMenuTriggerKey(state.openFilterMenu);
  state.openFilterMenu = "";
  render();
  focusFilterTrigger(triggerKey);
}

/* An item was chosen.

   A RADIO menu closes: the operator picked the one value the setting can hold
   and there is nothing left to do in it. A CHECKBOX menu stays open, because the
   operator is assembling a set and a menu that slams shut after each toggle
   makes picking two things cost two round trips through the trigger.

   The close happens BEFORE the setter so that a setter which decides nothing
   changed — "All providers" picked while every provider is already showing —
   still puts the menu away; and the render() is unconditional for the same
   reason, since those setters early-return without painting and would leave the
   operator staring at a menu their click had already closed in state. */
function chooseFilterMenuItem(triggerKey, item) {
  const staysOpen = item.role === "menuitemcheckbox";
  if (!staysOpen) state.openFilterMenu = "";
  item.apply();
  render();
  /* Radio hands focus back to the trigger; checkbox hands it back to the ITEM,
     which the repaint has just replaced with a new node carrying the same fkey.
     Landing a keyboard operator on the trigger after every toggle would walk
     them out of the menu they are still working in. */
  focusFilterTrigger(staysOpen ? item.fkey : triggerKey);
}

function filterMenuItem(triggerKey, item) {
  /* menuitemradio for a setting that holds ONE value (time), menuitemcheckbox
     for a lens that holds a SET (provider, status, model, span, context). Both
     carry aria-checked; what differs is the promise each makes about the others,
     and picking the wrong one tells a screen-reader operator that choosing
     "waiting" just unchose "working" when it did not. */
  const role = item.role || "menuitemradio";
  return el("button", {
    type: "button",
    class: "filter-menu-item" + (item.class ? " " + item.class : "") + (item.checked ? " is-active" : ""),
    role,
    /* A plain `menuitem` is an ACTION and has no checked state to report. Giving
       the review policy an aria-checked="false" would announce it as an unpicked
       member of the class group it sits under — which is exactly the "it is a
       lens" reading this whole control was moved to stop making. */
    "aria-checked": role === "menuitem" ? null : String(Boolean(item.checked)),
    title: item.title || null,
    /* The count is a number sitting in its own column, which reads as "codex 5"
       when the accessible name is assembled from the text — a session count and
       a version number are indistinguishable said that way. Spelled out here
       instead, and the <span> stays in the tree rather than aria-hidden so the
       figure is never silently withheld from anyone. */
    "aria-label": item.count == null
      ? null
      : item.label + " — " + item.count + " session" + (item.count === 1 ? "" : "s"),
    dataset: { fkey: item.fkey },
    onclick: () => chooseFilterMenuItem(triggerKey, item),
  }, item.label, item.count == null
    ? null
    : el("span", { class: "filter-menu-count", text: String(item.count) }));
}

/* One dropdown: a `filter-chip`-styled trigger plus, while it is open, the menu
   under it. Nothing here is retained between paints — the bar is torn down every
   four seconds, so `open` is read from state and the DOM is rebuilt around it. */
function filterMenu(spec) {
  const wrap = el("div", { class: "filter-menu-wrap" + (spec.trailing ? " is-trailing" : "") });
  wrap.append(el("button", {
    type: "button",
    class: "filter-chip" + (spec.active ? " is-active" : ""),
    "aria-haspopup": "menu",
    "aria-expanded": String(Boolean(spec.open)),
    /* Still a pressed state, because it still reports whether this axis is
       narrowing the board. The label carries the VALUE when it is — an operator
       should not have to open a menu to find out what it is currently doing. */
    "aria-pressed": String(Boolean(spec.active)),
    title: spec.title || null,
    dataset: { fkey: spec.fkey },
    onclick: () => setOpenFilterMenu(spec.menu),
  }, spec.label, el("span", { class: "filter-menu-caret", "aria-hidden": "true", text: "▾" })));
  if (!spec.open) return wrap;
  const menu = el("div", { class: "filter-menu", role: "menu", "aria-label": spec.menuLabel || spec.label });
  for (const section of spec.sections) {
    if (!section.label) {
      for (const item of section.items) menu.append(filterMenuItem(spec.fkey, item));
      continue;
    }
    const group = el("div", { class: "filter-menu-group", role: "group", "aria-label": section.label });
    /* The visual twin of the group's accessible name, hidden from the tree so a
       screen reader announces the group once rather than twice. */
    group.append(el("p", { class: "filter-menu-head", "aria-hidden": "true", text: section.label }));
    for (const item of section.items) group.append(filterMenuItem(spec.fkey, item));
    if (section.note) {
      /* Described, not merely printed. A caveat about what a group of options
         can actually reach is worthless to the operator who cannot see it, and a
         <p> loose inside role="menu" is content a screen reader in menu mode
         will walk straight past. */
      const noteId = "filter-menu-note-" + spec.menu;
      group.setAttribute("aria-describedby", noteId);
      group.append(el("p", { class: "filter-menu-note", id: noteId, text: section.note }));
    }
    menu.append(group);
  }
  wrap.append(menu);
  return wrap;
}

/* What the closed trigger says. The axis name alone when the lens is off; the
   VALUE when it is on, because an operator should not have to open a menu to
   learn what it is currently doing to their board.

   Two members still fit ("Status: working+waiting"); three stop fitting and stop
   being readable, so the trigger falls back to a count. The count is not a
   retreat — "Model (4)" is a true and legible statement, where four elided model
   strings would be neither. */
function lensTriggerLabel(axis, options, selected) {
  if (!selected.length) return axis.label;
  const words = selected.map((value) => {
    const option = options.find((o) => o.value === value);
    return (option && (option.short || option.label)) || value || "unreported";
  });
  return words.length > 2
    ? axis.label + " (" + words.length + ")"
    : axis.label + ": " + words.join("+");
}

/* One lens menu. Checkbox items, because the axis holds a set: a toggle adds or
   removes a member and the menu STAYS OPEN, so assembling "working and waiting"
   costs one visit rather than two. "All …" clears the axis and is checked
   exactly when nothing is selected — which is the same board as everything
   selected, and saying it one way keeps the two from looking like rival states. */
function lensFilterMenu(axis, ui) {
  const options = lensOptions(axis, ui);
  const selected = ui[axis.stateKey] || [];
  const footer = axis.footer ? axis.footer(ui) : null;
  const items = [
    {
      fkey: axis.key + ":all",
      label: axis.allLabel,
      role: "menuitemcheckbox",
      checked: selected.length === 0,
      title: "Stop narrowing by " + axis.label.toLowerCase(),
      apply: () => clearFacet(axis.stateKey),
    },
    ...options.map((option) => ({
      fkey: axis.key + ":" + (option.fkey ?? option.value),
      label: option.label,
      count: option.count,
      role: "menuitemcheckbox",
      checked: option.checked,
      title: option.checked
        ? "Stop showing " + option.label.toLowerCase() + " sessions"
        : "Add " + option.label.toLowerCase() + " sessions to what is shown",
      apply: () => toggleFacet(axis.stateKey, option.value),
    })),
  ];
  const title = selected.length
    ? "Narrowing by " + axis.label.toLowerCase() + ". Pick more to widen — within one filter the choices add up."
    : "Narrow by " + axis.label.toLowerCase() + ". Counts are of the whole window, so they do not move as you filter.";
  return filterMenu({
    menu: axis.key,
    fkey: axis.key + ":menu",
    /* The mark rides on the CLOSED trigger, because the population it is about
       is now one level deep. A menu that has to be opened before it will admit
       that rows are missing is a menu that does not admit it. */
    label: lensTriggerLabel(axis, options, selected) + (footer && footer.mark ? " " + footer.mark : ""),
    menuLabel: axis.label,
    active: selected.length > 0,
    open: ui.openFilterMenu === axis.key,
    title: footer && footer.markTitle ? title + " " + footer.markTitle : title,
    // The footer is its own section, so the divider above it is a boundary in
    // the markup and not only in the CSS.
    sections: footer ? [{ items }, { items: [footer.item] }] : [{ items }],
  });
}

/* How the active window reads on the trigger. Days are STORED as hours, so this
   is the only place that turns 48 back into the "2d" the operator picked — and
   it does it only for the offered day presets, so a hand-typed 36 stays "36h"
   rather than being rounded into a day count nobody chose. */
function lookbackValueLabel(hours) {
  if (hours == null) return "";
  const days = hours / 24;
  return LOOKBACK_DAY_PRESETS.includes(days) ? days + "d" : hours + "h";
}

function isOfferedLookback(hours) {
  return hours != null
    && (LOOKBACK_HOUR_PRESETS.includes(hours) || LOOKBACK_DAY_PRESETS.includes(hours / 24));
}

/* The caveat under the Days group: asking for 7 days does not reach 7 days back,
   because the collectors only hold what they scan.

   The number is stated when — and only when — a snapshot has carried it. It is
   read off `snap.scanWindowHours` and never off `state.scanWindowHours`, which
   is a client-side 36 that no server has confirmed; printing that as a boundary
   would be the same overclaim `renderScanWindow` was fixed to stop making, in
   the one place an operator is least able to check it. With no confirmed number
   the sentence still stands, just without a figure it cannot vouch for. */
function lookbackDaysNote(ui) {
  const scanned = ui.snap && Number(ui.snap.scanWindowHours);
  const bound = Number.isFinite(scanned) && scanned > 0
    ? " The collectors scan " + scanned + "h back, so a longer window here reaches no further."
    : "";
  return "Days reach only sessions still on the live wire — History reaches the archive." + bound;
}

/* The time menu. Hours for the shift you are working, Days for the week you are
   reconstructing, then the two escapes. It sits apart from the lens menus on the
   bar because it is not a lens: it decides the population every count is taken
   over, which is why moving it moves the tab number and moving a lens does not. */
function timeFilterMenu(ui) {
  const hourItems = LOOKBACK_HOUR_PRESETS.map((hours) => ({
    fkey: "lookback:" + hours,
    label: "Last " + hours + "h",
    checked: ui.lookbackHours === hours,
    title: `Hide sessions with no activity in the last ${hours} hours`,
    apply: () => setLookbackHours(hours),
  }));
  const dayItems = LOOKBACK_DAY_PRESETS.map((days) => ({
    fkey: "lookback:" + days * 24,
    label: "Last " + days + "d",
    checked: ui.lookbackHours === days * 24,
    title: `Hide sessions with no activity in the last ${days} days`,
    apply: () => setLookbackHours(days * 24),
  }));
  const sections = [
    { label: "Hours", items: hourItems },
    {
      label: "Days",
      /* Board only. On History the archive is the population, so the caveat
         would be false there — and a caveat that is false on one tab is one the
         operator stops believing on the other. */
      note: ui.view === "board" ? lookbackDaysNote(ui) : "",
      items: dayItems,
    },
    {
      items: [
        {
          fkey: "lookback:all",
          label: "Everything",
          checked: ui.lookbackHours == null,
          title: "Show every session the collectors hold, however old",
          apply: () => setLookbackHours(null),
        },
        {
          fkey: "lookback:custom",
          label: "Custom…",
          checked: !isOfferedLookback(ui.lookbackHours) && ui.lookbackHours != null,
          title: "Choose your own number of hours",
          apply: () => {
            const raw = window.prompt(
              "Show sessions active in the last how many hours?",
              String(state.lookbackHours || DEFAULT_LOOKBACK_HOURS),
            );
            if (raw == null) return;
            setLookbackHours(raw);
          },
        },
      ],
    },
  ];
  return filterMenu({
    menu: "time",
    fkey: "lookback:menu",
    /* "Time" when nothing is being hidden by it, the window itself when
       something is. Both are the honest reading: at "Everything" the time axis
       is not narrowing anything, so it has no value to report. */
    label: ui.lookbackHours == null ? "Time" : "Last " + lookbackValueLabel(ui.lookbackHours),
    menuLabel: "How far back to show sessions",
    active: ui.lookbackHours != null,
    open: ui.openFilterMenu === "time",
    title: "How far back the board reaches. This sets the working set every count on the page is taken over.",
    trailing: true,
    sections,
  });
}

/* The review-worker policy, and the one control on this bar that is NOT a lens.

   It has been a chip and then a standalone `⊘ N reviewers hidden` fragment, and
   in both shapes it stood in the row of things that narrow this board — which is
   false twice over. It is a SERVER setting shared by every browser looking at
   this fleet, so turning it on changes what a colleague sees; and it is a
   standing policy about which rows the Board is FOR, not a question about the
   sessions in front of you.

   So it moves inside the Class menu, where the population it governs is one of
   the classes, and it renders there as a separated ACTION rather than a member
   of the set above it. Two things keep it from simply disappearing at that
   depth: `lensApplies` renders the Class menu whenever this footer exists, and
   the closed trigger wears the ⊘ while anything is being withheld.

   Returns null when the control would change nothing to say — no reviewers in
   the window and the fleet already showing them. */
function reviewPolicyFooter(ui) {
  if (ui.view !== "board") return null;
  const showing = Boolean(ui.showReviewWorkers);
  const reviews = reviewWorkerCount(ui);
  if (!reviews && !showing) return null;
  // Guarded by the line above: not showing, here, always means some are hidden.
  const hidden = !showing;
  const noun = reviews + " reviewer" + (reviews === 1 ? "" : "s");
  return {
    mark: hidden ? "⊘" : "",
    markTitle: hidden
      ? "⊘ " + noun + " hidden from the Board by the fleet's review setting."
      : "",
    item: {
      /* The fkey it has always had. The control moved one level deep; that is no
         reason to make an operator's hands, or their focus restore, relearn it. */
      fkey: "session-kind:review",
      /* A `menuitem`, not a `menuitemcheckbox`. Everything above it in this menu
         is a member of the set the browser is narrowing by; this writes a
         setting on the server, and announcing it as a checkbox in that group
         would say the fleet's policy is a sixth class. */
      role: "menuitem",
      class: "filter-menu-policy",
      label: (hidden
        ? "⊘ Show " + reviews + " hidden reviewer" + (reviews === 1 ? "" : "s")
        : "⊘ Hide routine reviewers") + " — fleet-wide setting",
      title: "Routine review workers are hidden from the Board by default. This is a FLEET setting saved on the server and shared by every browser — changing it changes what your colleagues see. Reviews that need a person stay visible either way.",
      apply: () => setShowReviewWorkers(!state.showReviewWorkers),
    },
  };
}

/* Empty the bar around the one node that must SURVIVE the repaint.

   Every control here is rebuilt on every paint, but the sentence's live region
   (`#bar-scope-note`, declared in index.html) cannot be: an aria-live element
   that is destroyed and recreated announces nothing, because the region has to
   already be in the tree when its content changes. */
function clearFilterBar(bar, keep) {
  for (const child of [...(bar.childNodes || [])]) {
    if (child !== keep && typeof child.remove === "function") child.remove();
  }
}

function renderFilterBar(ui = state) {
  const bar = $("filter-bar");
  if (!bar) return;
  const note = $("bar-scope-note");
  clearFilterBar(bar, note);
  /* Everything that belongs in FRONT of the sentence goes in with insertBefore
     rather than append, or the one surviving node would keep the position it
     held before the rebuild and every control would land behind it. A document
     built without the note takes insertBefore(node, null), which appends —
     exactly the old behaviour. */
  const place = (node) => { if (node) bar.insertBefore(node, note); };
  if (ui.view === "usage") {
    bar.hidden = false;
    bar.setAttribute("aria-hidden", "false");
    place(el("span", { class: "filter-lead", text: "Range" }));
    for (const preset of USAGE_RANGE_PRESETS) {
      place(filterChip(preset.label, ui.usageRangeId === preset.id, () => {
        state.usageRangeId = preset.id;
        state.usageCustomHours = preset.hours;
        void loadUsageData(true);
        render();
      }, { fkey: "usage-range:" + preset.id }));
    }
    const customActive = ui.usageRangeId === "custom";
    place(filterChip(
      customActive ? ("Custom " + ui.usageCustomHours + "h") : "Custom",
      customActive,
      () => {
        const raw = window.prompt("Usage range hours", String(state.usageCustomHours || 24));
        if (raw == null) return;
        const hours = Math.max(1, Math.min(24 * 90, Math.round(Number(raw))));
        if (!Number.isFinite(hours)) return;
        state.usageRangeId = "custom";
        state.usageCustomHours = hours;
        void loadUsageData(true);
        render();
      },
      { fkey: "usage-range:custom" },
    ));
    return;
  }
  if (!lookbackApplies(ui.view)) {
    bar.hidden = true;
    bar.setAttribute("aria-hidden", "true");
    return;
  }
  bar.hidden = false;
  bar.setAttribute("aria-hidden", "false");
  /* The tab strip is navigation. This is the one filter surface: the lenses and
     the time control live together here, while the collector window below
     remains a server setting rather than a second filter. */
  place(el("span", { class: "filter-lead", text: "Filters" }));
  /* Select is a mutation mode, not a lens. The Group chip exists only while
     the pick-set is non-empty — the bar stays a filter bar the rest of the time. */
  if (ui.view === "board") {
    place(filterChip("Select", Boolean(state.selectMode), () => toggleSelectMode(), {
      fkey: "select-mode",
      title: "Pick mapped terminals and form a team",
    }));
    if (groupingIdSet().size) place(renderGroupingChip());
  }
  /* The lenses: Class · Provider · Status · Model · Span · Context, in that
     order and in one flat row. Class leads because it answers who the agent is,
     and everything after it is a question about that same agent. Six closed
     triggers stand where fifteen open chips used to, which is why this stays
     flat instead of nesting the tail behind a "More" — a filter you have to go
     looking for is one operators stop knowing they have.

     Each renders only where it has something to say: two or more populated
     options, or a selection the operator still needs a way to switch off. */
  for (const axis of LENS_AXES) {
    if (lensApplies(axis, ui)) place(lensFilterMenu(axis, ui));
  }
  /* No always-on program chips — programs are unbounded and the bar would grow
     without limit. The lens is SET from the drawer and CLEARED here, so an
     active narrowing is still one visible control away from off. */
  if (ui.facetProgram) {
    const scoped = ((ui.snap && ui.snap.programs) || []).find((p) => p.id === ui.facetProgram);
    place(filterChip(
      "Only " + (scoped ? programName(scoped) : "one program"),
      true,
      () => setFacetProgram(state.facetProgram),
      {
        fkey: "program:clear",
        title: "Show every program again — also resets TL;DR to ALL",
      },
    ));
  }
  /* The sentence stands here, between the lenses it summarises and the control
     that decides the population it counts against — which is also what it says.
     It is already a child of the bar in the markup; this only has work to do in
     a document that was built without it. */
  if (note && ![...(bar.childNodes || [])].includes(note)) bar.append(note);
  /* Time goes LAST and hard right, separated from everything before it.
     Everything to its left narrows within the population; this control decides
     what the population is. The gap is the two-layer boundary drawn in space —
     it is the one thing on this bar that moves the tab number, and standing it
     shoulder to shoulder with the lenses is what taught operators the lenses
     ought to move it too.

     (Contract preference was the tab-strip row. It is here instead: `#views`
     owns arrow-key roving tabindex over its tabs, and a dropdown inside it would
     have to fight `handleCockpitKeys` for Left/Right — see LANE-FE2-STATUS.md.) */
  bar.append(timeFilterMenu(ui));
  /* Nothing else. The collection window is the server's reach, not a lens —
     it lives in Settings (editor) and the summary rail (reading), never here.
     And no "your view only" disclaimer: since D7 the review toggle is a shared
     server setting, so the disclaimer was false for the first chip on the bar. */
}

/* What an Ack is holding back, in the sentence's own voice: what was hidden,
   and — the half that matters — what is still true of the sessions it hid. */
function acknowledgedClause(count) {
  return el("span", {
    class: "scope-acked",
    title: "You acknowledged these requests. Alert treatment stays muted until an agent makes a new request; session state is unchanged.",
    text: count + " acknowledged — muted until a new request",
  });
}

/* Two slots, one line at a time.

   D4: the board's sentence moved INTO the filter bar row, between the lenses and
   the working-set control — it reconciles those two layers, so it stands between
   them, and it fills the gap that made the right-aligned Time trigger read as
   stranded. Usage keeps the old line below the search box: it has no lenses and
   no working set, only a range, so there is no two-layer gap there to stand in.

   Whichever slot is not speaking is emptied AND hidden. Both halves matter: a
   leftover sentence in the other slot would be a second, stale answer to the
   same question, and a slot left carrying the hidden flag it picked up on the
   other view is how a quiet board followed by a switch to Usage produced a range
   line that was written and never shown. */
function renderScopeNote(shown) {
  const usage = state.view === "usage";
  const note = usage ? $("scope-note") : $("bar-scope-note");
  const idle = usage ? $("bar-scope-note") : $("scope-note");
  if (idle) {
    idle.textContent = "";
    idle.hidden = true;
  }
  if (!note) return;
  if (usage) {
    const range = usageRangeHours();
    note.hidden = false;
    note.textContent = state.usageLoading
      ? "Loading BurnBar usage…"
      : `Usage range ${range}h · source BurnBar` + (state.usageSummary && state.usageSummary.available === false
        ? " · unavailable"
        : "");
    return;
  }
  note.textContent = "";
  if (!state.snap) { note.hidden = true; return; }
  /* D5. The sentence that reconciles the two numbers on this page.

     Audit §8: this line read "12 shown · 31 live · 280 tracked" beside a tab bar
     already showing Now 12 / Idle 19 / History 44 — twelve numeric occurrences
     carrying nine distinct values, with the three 12s being one set. Worse,
     `shown` counts the list AFTER every lens and the query while the tab counts
     omit them, so the two silently disagreed the moment a filter went on.

     They still disagree, because they are measuring different things and always
     were — that IS the two-layer model. What changed is that the disagreement is
     now stated instead of left for the operator to discover: "8 of 21" says the
     working set holds 21 (which is the tab number, from the same helper) and
     your lenses have left 8 of them. The line speaks only when something is
     narrowing or the data went stale; on an unfiltered board the tabs have
     already said everything there is to say. */
  const active = activeLenses(state);
  const narrowing = Boolean(state.query) || Boolean(state.facetProgram) || active.length > 0;
  /* SYNC-NF. An Ack takes a row out of the alert list, which is a narrowing the
     operator did on purpose — and the ONE thing this region exists to prevent
     is a board that is quietly showing less than it appears to. It speaks here
     rather than in a mark on the strip because #bar-scope-note is the live
     region that survives the repaint: an aria-live element that is destroyed
     and recreated announces nothing, so a sentence built anywhere else would
     never reach a screen reader at all. */
  const acknowledged = acknowledgedCount(state.snap);
  if (!narrowing && !acknowledged && !state.fetchFailed) { note.hidden = true; return; }
  note.hidden = false;
  if (!narrowing) {
    if (acknowledged) note.append(acknowledgedClause(acknowledged));
    if (state.fetchFailed) {
      if (acknowledged) note.append(" · ");
      note.append(el("span", { class: "scope-stale", text: "last refresh failed" }));
    }
    return;
  }

  /* Each active lens is a real button, not a word. An operator reading "showing
     working codex sessions" and wanting to change it should be able to act on
     the sentence itself rather than hunt the bar for whichever trigger owns that
     word — the sentence is where they are already looking. */
  const line = el("span", { class: "scope-sentence" }, "Showing ");
  for (const lens of active) {
    line.append(el("button", {
      type: "button",
      class: "scope-lens",
      dataset: { fkey: "sentence:" + lens.axis.key },
      title: "Open the " + lens.axis.label + " filter",
      onclick: () => setOpenFilterMenu(lens.axis.key),
    }, lens.words.join(" or ")), " ");
  }
  line.append("sessions");
  if (state.query) {
    line.append(" matching ", el("button", {
      type: "button",
      class: "scope-lens",
      dataset: { fkey: "sentence:query" },
      title: "Edit the search",
      /* No menu to open — the query's control is the search box, so this puts
         the cursor in it. Selecting the text too: the operator clicked the word
         they want to change, and landing them at its end to backspace through it
         is a worse answer than handing them a replaceable selection. */
      onclick: () => {
        const box = $("search");
        if (!box) return;
        box.focus();
        if (typeof box.select === "function") box.select();
      },
    }, "“" + state.query + "”"));
  }
  if (state.facetProgram) {
    const scoped = ((state.snap && state.snap.programs) || []).find((p) => p.id === state.facetProgram);
    line.append(" in ", el("button", {
      type: "button",
      class: "scope-lens",
      dataset: { fkey: "sentence:program" },
      /* The program lens has no menu — it is set from a drawer — so its fragment
         is the way OFF rather than a way in. Said in the title, because a button
         that clears when its siblings open is a difference worth stating. */
      title: "Show every program again",
      onclick: () => setFacetProgram(state.facetProgram),
    }, scoped ? programName(scoped) : "one program"));
  }
  /* The reconciliation. `shown` is what the list actually rendered; the second
     number is the working-set count — the SAME helper renderTabs counts with, so
     the sentence can never quote a total the tab beside it disagrees with. */
  line.append(" — ", el("span", { class: "scope-count", text: shown + " of " + workingSet(state).length }));
  note.append(line);
  // SYNC-NF, after the reconciliation and before Clear: the acks are a fact
  // about the alert list rather than about this count, so they never join the
  // "N of M" arithmetic — they are stated beside it.
  if (acknowledged) note.append(" · ", acknowledgedClause(acknowledged));
  /* Clears the LENSES and the query, and deliberately not the two things that
     are not lenses: the review policy belongs to the fleet rather than to this
     browser, and the time window is the working set itself — a "clear filters"
     that silently widened the board's reach would change the number it is
     standing next to. */
  note.append(" · ", el("button", {
    type: "button",
    class: "scope-clear",
    dataset: { fkey: "sentence:clear" },
    title: "Clear every filter and the search. Leaves the time window and the fleet's review setting alone.",
    onclick: clearEveryLens,
  }, "Clear"));
  if (state.fetchFailed) {
    note.append(" · ", el("span", { class: "scope-stale", text: "last refresh failed" }));
  }
}

/* One repaint, not six. Assigning each axis through its own setter would render
   between every one, so a five-lens board would rebuild itself five times on a
   single click — and the intermediate boards are states the operator never asked
   to see. */
function clearEveryLens() {
  for (const axis of LENS_AXES) state[axis.stateKey] = [];
  state.facetProgram = "";
  state.query = "";
  if (state.tldrView !== "ALL") {
    state.tldrView = "ALL";
    saveTldrView();
    state.paintSig.widgets = "";
  }
  const box = $("search");
  if (box) box.value = "";
  render();
}

/* ---------- repo → worktree grouping ----------

   The server hands the client one program PER WORKTREE, tagged with
   `groupPath: [repoKey, worktreeKey]`. Five worktrees of one repository used to
   arrive as five sibling sections all printing the same name, with nothing on
   screen saying they were the same project — the exact smorgasbord the
   basename-hash grouping produced, one layer up.

   So the repository becomes the section and the worktrees become subsections
   inside it. Programs the server could NOT resolve a repo for are untouched:
   they keep today's flat program section, drawn by the same renderer through
   the same caches. That is deliberate. Everything here is additive, so a
   session whose cwd is not a git checkout reaches the DOM it always reached,
   and reverting this task cannot change what those rows look like. */

function repoOf(program) {
  const carrier = program && program.agents && program.agents.find((agent) => agent && agent.repo);
  return carrier ? carrier.repo : null;
}

/* ---------- TINT-F: repo-identity colour ----------

   One hex per repository, six fixed hues and clay for the seventh, assigned and
   persisted by the server (`/api/repo-colors`) so the board, the cmux
   workspaces and the sidebar groups can never disagree about what colour
   `cooper-scheduler` is.

   The client joins on the repository NAME it already prints, lowercased,
   because the canonical key is the basename of the git common dir and a browser
   cannot run `git rev-parse` to derive it. `repoNames` in the endpoint's
   response is that join table, built server-side from the same walk that made
   the assignments.

   Two treatments, from the approved design (artifact a902d450):

     Whisper — the grouped repo bands. A 2px spine at 45% down the card, a dot
       beside the name, a 4% wash on the rows inside it and 7% on hover.
     Signal — the flat Needs-you strip, where rows from every repository are
       interleaved. A 3px tick at 55% down each row, the same 4% wash, and a
       quiet repo pill on the group heading, which is the surface's stand-in for
       the band name it does not have.

   Status outranks identity in every pixel (authority rule 5): a row wearing any
   attention treatment drops the repo wash and the repo tick entirely rather
   than blending with them, and the stylesheet says so with :not() rather than
   by relying on rule order. Text never wears repo colour (rule 6) — the marks
   are the spine, the dot, the tick and the pill border, and nothing else.

   Carried into the DOM with `style.setProperty`, not a `style` attribute: the
   board ships a strict CSP with no 'unsafe-inline', which kills `style="…"`
   silently, while CSSOM property writes are untouched by it (the inspector's
   --inspector-visible-top already rides this path). */
const repoColors = new Map();   // lowercased repo name -> "#rrggbb"
let repoColorsVersion = 0;      // bumped on every load; paint signatures read it

/* The join is TWO hops, and collapsing it to one is how this shipped broken
   once: `repoNames` maps a printed name to a canonical repoKey, and
   `assignments` maps that key to a hex. They are different tables and the
   middle value is not a colour — feeding `repoNames` straight in left every
   entry failing normalizeRepoHex, so the map stayed empty and the board never
   tinted while every test stayed green.

   The two names genuinely differ on this very checkout: the repository's origin
   is `…/the-ant-hill.git`, so RepoIdentity.repoName — what the band prints — is
   `the-ant-hill`, while repoKeyForCwd reads the git common dir and answers
   `the-mountain`. The table exists precisely for that split, which is why
   `name === key` is never a safe shortcut. */
function setRepoColors(repoNames, settings) {
  repoColors.clear();
  const assignments = (settings && settings.assignments) || {};
  for (const [name, repoKey] of Object.entries(repoNames || {})) {
    const assignment = assignments[repoKey];
    const hex = normalizeRepoHex(assignment && assignment.hex);
    if (hex) repoColors.set(String(name).toLowerCase(), hex);
  }
  repoColorsVersion += 1;
}

/* Same normalization the server applies, for the same reason: `#2E66A8` and
   `#2e66a8` are one colour, and two spellings of it in two places is how a
   comparison starts reporting drift that is only spelling. */
function normalizeRepoHex(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1];
    return ("#" + r + r + g + g + b + b).toLowerCase();
  }
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** The hex a repository wears, or "" when the server has not assigned it one.
 *  Empty rather than a fallback colour: a repository with no assignment is a
 *  repository the endpoint has not seen, and painting it a default hue would
 *  claim an identity the fan-out to cmux is not backing up. */
function repoTintFor(repoName) {
  const key = String(repoName || "").trim().toLowerCase();
  return (key && repoColors.get(key)) || "";
}

/** Put a tint on a node, CSP-safely, and mark it so the stylesheet can find it. */
function paintRepoTint(node, hex, className) {
  if (!node || !hex) return node;
  node.classList.add(className);
  node.style?.setProperty?.("--repo-tint", hex);
  return node;
}

/* The repo colour a PROGRAM's rows should wear. Reads the same RepoIdentity the
   band head prints, so the strip row and the band it was pinned out of can
   never show two different colours for one repository. */
function repoTintOfProgram(program) {
  const repo = repoOf(program);
  return repoTintFor(repo && repo.repoName);
}

/* Team overlay: if every agent that carries a team shares one hex, that hex
   is the program's colour. Mixed hexes (or none) fall back to the repo —
   never an average. Case is spelling: `#5F7F2A` and `#5f7f2a` are one colour. */
function tintOfProgram(program) {
  const agents = (program && program.agents) || [];
  const teams = agents.map((a) => a && a.team).filter((t) => t && t.hex);
  if (!teams.length) return repoTintOfProgram(program);
  const first = normalizeRepoHex(teams[0].hex) || teams[0].hex;
  if (teams.every((t) => (normalizeRepoHex(t.hex) || t.hex) === first)) return first;
  return repoTintOfProgram(program);
}

/* Same unanimous-id rule teamGroups uses: one team id on the program's
   agents, or none. Mixed programs have no single band to jump to. */
function teamIdOfProgram(program) {
  const agents = (program && program.agents) || [];
  const ids = [...new Set(agents.map((a) => a && a.team && a.team.id).filter(Boolean))];
  return ids.length === 1 ? ids[0] : "";
}

function baseName(path) {
  const trimmed = String(path || "").replace(/\/+$/, "");
  return trimmed ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : "";
}

function parentName(path) {
  const trimmed = String(path || "").replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut > 0 ? baseName(trimmed.slice(0, cut)) : "";
}

/* B3 sets `groupPath[1] = "run:<runId>"` when a manifest or ANTHILL_RUN
   declared one, so the second axis is either a worktree hash or a named run.
   Empty after the marker is not a run — that would name a subsection "". */
const RUN_GROUP_PREFIX = "run:";
/* B2.1's collapsed leaf: every undeclared disposable checkout of one repo,
   gathered under one key so 179 automation runs stop being 179 sections. */
const EPHEMERAL_GROUP_KEY = "ephemeral";

function worktreeGroupKey(program) {
  return program && Array.isArray(program.groupPath) ? String(program.groupPath[1] || "") : "";
}

function declaredRunId(program) {
  const key = worktreeGroupKey(program);
  return key.startsWith(RUN_GROUP_PREFIX) ? key.slice(RUN_GROUP_PREFIX.length) : "";
}

/* What a worktree subsection is CALLED. The repository name is printed by the
   band above it, so repeating it here would spend the widest line on the board
   saying nothing; what distinguishes two checkouts of one repo is the branch
   and the directory.

   A DECLARED RUN outranks both, because a run spans worktrees: the live atlas
   run holds four lanes in four different checkouts, and `branch@basename` there
   reads whichever lane's agent happened to sort first — a name that is false
   about the other three. The runId is declared at spawn rather than derived
   from a path, which is the entire point of the spawn contract. */
function worktreeLabel(program) {
  const runId = declaredRunId(program);
  if (runId) return runId;
  /* The collapsed ephemeral leaf spans checkouts — 4, 8 and 9 distinct
     worktrees in the three live ones — so reading a path off whichever agent
     sorted first names it after one of nine. The server already gave it the
     only true name it has ("disposable checkouts", the words ARCHITECTURE
     uses), so take that instead of deriving a wrong one.

     Same rule as the declared run above, one leaf over: a subsection that spans
     checkouts cannot wear one checkout's name. */
  if (worktreeGroupKey(program) === EPHEMERAL_GROUP_KEY) return program.name || "";
  const repo = repoOf(program);
  const path = (repo && repo.worktreePath) || (program && program.path) || "";
  const branch = (repo && repo.branch) || "";
  const repoName = (repo && repo.repoName) || "";
  let base = baseName(path);
  /* A checkout whose folder is NAMED after the repository tells the operator
     nothing the band above has not said — and `~/.codex/worktrees/<hash>/<repo>`
     is exactly that shape, with no branch either, so eight live disposable
     checkouts of one repo all rendered as its name. What separates them is the
     directory above, which is the run that minted them.

     Only when there is no branch: a branch already distinguishes the checkout,
     and `main@the-mountain` must not become `main@Developer`. */
  if (!branch && base && base === repoName) base = parentName(path) || base;
  /* `feat/ev2-g1@ev2-g1` said its one distinguishing token twice — a checkout
     directory is routinely named after the branch tail — and `branch@repoName`
     repeats the band head directly above. Either way the suffix separates
     nothing, and the widest line on the board was spending half its width on
     it, in a face where I/l/1 collide. */
  if (branch && base && (base === branch.split("/").pop() || base === repoName)) return branch;
  if (branch && base) return branch + "@" + base;
  return base || branch || (program ? program.name : "");
}

/* What a strip row's chip SAYS. A flat program's name is its whole identity,
   but a worktree program's server name is the repository — one word shared by
   every checkout of it, which is exactly the ambiguity the strip suffered
   from. So the chip speaks both axes: the repo, then the same branch@directory
   words the group header below says, so the operator can match the two
   surfaces by reading either one. */
function stripChipLabel(program) {
  if (!program) return "";
  if (!Array.isArray(program.groupPath)) return programName(program);
  const repo = repoOf(program);
  const repoName = (repo && repo.repoName) || "";
  const label = worktreeLabel(program);
  if (repoName && label && label !== repoName) return repoName + " · " + label;
  return repoName || label || programName(program);
}

/* The board's sections, in server order: a repo group takes the position of its
   first worktree, and everything without a groupPath stays exactly where it
   was as its own program entry. Pure — it reads the visible list and nothing
   else, so the whole grouping is testable without a DOM. */
function repoGroups(visible) {
  const sections = [];
  const byRepo = new Map();
  for (const entry of visible) {
    const path = entry.program && entry.program.groupPath;
    const repoKey = Array.isArray(path) ? path[0] : "";
    const worktreeKey = Array.isArray(path) ? path[1] : "";
    if (!repoKey || !worktreeKey) {
      sections.push({ kind: "program", program: entry.program, agents: entry.agents, finished: entry.finished });
      continue;
    }
    let group = byRepo.get(repoKey);
    if (!group) {
      group = { kind: "repo", key: repoKey, name: "", pullRequestUrls: [], worktrees: [] };
      byRepo.set(repoKey, group);
      sections.push(group);
    }
    group.worktrees.push({
      program: entry.program,
      agents: entry.agents,
      finished: entry.finished,
      worktreeKey,
      label: worktreeLabel(entry.program),
    });
  }
  for (const group of byRepo.values()) {
    const first = group.worktrees[0];
    const repo = repoOf(first.program);
    group.name = (repo && repo.repoName) || first.program.name || "";
    /* A band's only checkout needs no disambiguator: `@directory` earns its
       place by separating siblings, and there are none — while on the live
       board the directory half actively contradicted the band name above it
       (`…@the-mountain-main` under "the-ant-hill"). Multi-worktree bands keep
       both halves; uniqueness within the band is what the suffix is FOR. */
    if (group.worktrees.length === 1) {
      const branch = (repo && repo.branch) || "";
      if (branch && first.label.startsWith(branch + "@")) first.label = branch;
    }
    const urls = new Set();
    for (const { program } of group.worktrees) {
      for (const agent of program.agents || []) for (const url of agent.pullRequestUrls || []) urls.add(url);
    }
    group.pullRequestUrls = [...urls];
  }
  return sections;
}

/* Team axis in front of today's repo groups. An entry whose agents (live or
   finished) share one team joins a `{ kind: "team" }` band labeled with the
   group name and wearing `team.hex`. Mixed-team programs split — one slice
   per team, leftover ungrouped agents go through `repoGroups`. Never average. */
function teamWorktree(entry, agents, finished) {
  const path = entry.program && entry.program.groupPath;
  const worktreeKey = Array.isArray(path) ? String(path[1] || "") : "";
  return {
    program: entry.program,
    agents,
    finished,
    worktreeKey,
    label: worktreeLabel(entry.program),
  };
}

function teamGroups(visible) {
  const teamSections = [];
  const byTeam = new Map();
  const remainder = [];
  for (const entry of visible) {
    const agents = [...(entry.agents || []), ...(entry.finished || [])];
    const ids = [...new Set(agents.map((a) => a && a.team && a.team.id).filter(Boolean))];
    if (ids.length === 0) {
      remainder.push(entry);
      continue;
    }
    if (ids.length === 1) {
      const team = agents.find((a) => a.team && a.team.id === ids[0]).team;
      let group = byTeam.get(team.id);
      if (!group) {
        group = { kind: "team", key: team.id, name: team.name, hex: team.hex, pullRequestUrls: [], worktrees: [] };
        byTeam.set(team.id, group);
        teamSections.push(group);
      }
      group.worktrees.push(teamWorktree(entry, entry.agents, entry.finished));
      continue;
    }
    // Split mixed-team programs by team; leftover agents (no team) go remainder.
    for (const id of ids) {
      const sample = agents.find((a) => a.team && a.team.id === id).team;
      const sliceAgents = (entry.agents || []).filter((a) => a.team && a.team.id === id);
      const sliceFinished = (entry.finished || []).filter((a) => a.team && a.team.id === id);
      const slice = teamWorktree(
        { ...entry, program: { ...entry.program, agents: sliceAgents } },
        sliceAgents,
        sliceFinished,
      );
      let group = byTeam.get(id);
      if (!group) {
        group = { kind: "team", key: id, name: sample.name, hex: sample.hex, pullRequestUrls: [], worktrees: [] };
        byTeam.set(id, group);
        teamSections.push(group);
      }
      group.worktrees.push(slice);
    }
    const leftoverAgents = (entry.agents || []).filter((a) => !(a && a.team && a.team.id));
    const leftoverFinished = (entry.finished || []).filter((a) => !(a && a.team && a.team.id));
    if (leftoverAgents.length || leftoverFinished.length) {
      remainder.push({
        program: { ...entry.program, agents: leftoverAgents },
        agents: leftoverAgents,
        finished: leftoverFinished,
      });
    }
  }
  return [...teamSections, ...repoGroups(remainder)];
}

/* Paint keys for the two new axes. programId keyed every paint cache before
   this, so a new grouping level without its own key would serve one repo's
   rows out of another's cache entry — and a row rebuilt every 4s takes the
   operator's text selection, hover and keyboard focus with it.

   Namespaced rather than bare so they cannot collide with a program id inside
   the section cache they share: `repo\u001f<key>` can never be an id the
   server minted, and the row key carries BOTH the repo and the worktree,
   because two repos routinely hold a worktree of the same name. */
const REPO_KEY_PREFIX = "repo\u001f";
const repoSectionKey = (repoKey) => REPO_KEY_PREFIX + repoKey;
const worktreeSectionKey = (repoKey, worktreeKey) => REPO_KEY_PREFIX + repoKey + "\u001f" + worktreeKey;

/* Open when the repository holds a session the ACTIVE VIEW would admit — the
   same question programOpen asks, for the same reason: any second opinion about
   the filter can contradict it, and a contradicting gate collapses a group over
   rows that already cleared the filter. */
function repoOpen(group, ui = state) {
  const override = ui.repoOverrides && ui.repoOverrides.get(group.key);
  if (override) return override === "open";
  if (ui.view === "history") return false;
  return group.worktrees.some(({ program }) => program.agents.some((agent) => viewMatches(ui.view, agent)));
}

function toggleRepo(group) {
  state.repoOverrides.set(group.key, repoOpen(group) ? "closed" : "open");
  saveRepoOverrides();
  render();
}

/* The strip chip's destination: put the parent group on screen. Explicit
   "closed" overrides are REMOVED rather than overwritten — open is already the
   computed default for a group holding an alerting row, so deleting the fold
   restores it, and writing "open" would persist a choice the operator never
   made. The repaint runs synchronously so the scroll that follows it owns the
   final position: render() saves and restores main.scrollTop inside the call,
   and the next paint re-saves whatever scrollIntoView left. Focus lands on the
   group's own caret, whose `prog:` focus key is what render()'s restore
   preserves across later repaints. Optional calls, because the test harness's
   nodes have neither scrollIntoView nor focus. */
function jumpToProgramGroup(program) {
  if (!program) return;
  const teamId = teamIdOfProgram(program);
  const repoKey = teamId ? "" : (Array.isArray(program.groupPath) ? String(program.groupPath[0] || "") : "");
  const bandKey = teamId || repoKey;
  if (bandKey && state.repoOverrides.get(bandKey) === "closed") {
    state.repoOverrides.delete(bandKey);
    saveRepoOverrides();
  }
  if (state.programOverrides.get(program.id) === "closed") {
    state.programOverrides.delete(program.id);
    saveOverrides();
  }
  render();
  /* A group whose every session is pinned draws no shell, so its own caret may
     not be in the DOM — fall back to the team band, or the repo band when
     there is no team. */
  const head = document.querySelector(`[data-fkey="${CSS.escape("prog:" + program.id)}"]`)
    || (bandKey ? document.querySelector(`[data-fkey="${CSS.escape("repo:" + bandKey)}"]`) : null);
  if (!head) return;
  head.scrollIntoView?.({ block: "center" });
  head.focus?.({ preventScroll: true });
}

/* The band's whole population — every worktree's FULL program.agents, the
   same convention the worktree rollups use, so the band and the heads under
   it can never disagree about a count. */
function bandAgents(group) {
  const agents = [];
  for (const { program } of group.worktrees) agents.push(...program.agents);
  return agents;
}

/* Everything the repo BAND paints, and nothing its worktrees paint: the name,
   the caret, the worktree count, the PR links and the rollup. A row ticking
   inside one of its worktrees must leave this node alone, or the band rebuild
   would take every subsection under it with it. */
function repoShellSig(group, ui) {
  return [
    group.key,
    // The band head's rollup and column header are view-shaped (see
    // programShellSig): a view switch must rebuild the shell.
    ui.view,
    group.name,
    /* The band's repo colour. It arrives on its own clock — one fetch after
       boot, and again whenever an operator picks a colour — with nothing else
       in this signature moving, so without it the first paint's untinted card
       is the card forever. */
    group.hex || repoTintFor(group.name),
    repoOpen(group, ui) ? "open" : "shut",
    String(group.worktrees.length),
    group.pullRequestUrls.join(","),
    /* The head's rollup cells. Derived by the SAME programRollupCells the
       worktree heads use — two derivations of one number is the seam every
       token defect on this board came through — and a cell moving must
       repaint this head or it freezes: nothing else in this signature moves
       when a session starts or stops asking. */
    programRollupCells(bandAgents(group), null, ui.snap).map((c) => c.value + " " + c.label + (c.alert ? "!" : "")).join(","),
    ui.teamRenaming === group.key ? "renaming" : "",
    ui.teamRenamePending ? "1" : "0",
    ui.teamRenameError || "",
  ].join("\u001f");
}

/* "PR 412" from …/pull/412. The number is what an operator says out loud; the
   bare word is the honest fallback for a URL shaped some other way. */
function pullRequestLabel(url) {
  const number = /\/(\d+)(?:[/?#].*)?$/.exec(String(url || ""))?.[1];
  return number ? "PR " + number : "PR";
}

function teamBandPicker(group, tint) {
  const picker = el("input", {
    type: "color",
    class: "visually-hidden",
    tabindex: "-1",
    value: tint || "#888888",
    "aria-label": "Colour for " + group.name,
    dataset: { fkey: "team-color:" + group.key },
    onchange: (event) => { void putTeamColor(group.key, event.currentTarget.value); },
  });
  const swatch = el("button", {
    type: "button",
    class: "repo-tint-picker swatch",
    "aria-label": "Colour for " + group.name,
    onclick: () => {
      if (typeof picker.click === "function") picker.click();
    },
  });
  return el("span", {}, paintRepoTint(swatch, tint, "has-repo-tint"), picker);
}

function renderRepoSection(group, ui = state) {
  const open = repoOpen(group, ui);
  const bodyId = "repo-body-" + group.key;
  const count = group.worktrees.length;
  const tint = group.hex || repoTintFor(group.name);
  /* The band is the program tier, so it carries the program-tier facts: the
     fold, the name, the PRs, and the rollup over its WHOLE population —
     before this the unit the operator buckets attention by was the only unit
     on the board with no numbers on it, and "how is cooper doing" meant
     mentally summing eight worktree stats lines. The rollup's alerts cell is
     also what says a shut fold is hiding a session that is asking. */
  const head = el("div", { class: "repo-head" },
    el("button", {
      type: "button",
      class: "repo-caret",
      "aria-expanded": String(open),
      "aria-controls": bodyId,
      "aria-label": (open ? "Collapse " : "Expand ") + group.name,
      dataset: { fkey: "repo:" + group.key },
      onclick: () => toggleRepo(group),
    }, icon("caret")),
    /* Whisper's mark on the head. A repo band keeps the decorative 7px dot.
       A team band uses the Settings swatch so the operator can retint the
       group — same PUT as the Teams plate, never the repo-colour endpoint. */
    ...(group.kind === "team" ? [teamBandPicker(group, tint)] : [
      tint ? el("span", { class: "repo-dot", "aria-hidden": "true" }) : null,
    ]),
    group.kind === "team"
      ? el("button", {
        type: "button",
        class: "program-label repo-name",
        "aria-label": "Rename " + group.name,
        dataset: { fkey: "team-rename:" + group.key },
        onclick: () => startTeamRename(group),
      }, el("span", { class: "program-name", text: group.name }))
      : el("span", { class: "repo-name", text: group.name }),
    group.kind === "team"
      ? el("button", {
        type: "button",
        class: "team-ungroup",
        "aria-label": "Ungroup " + group.name,
        title: "Ungroup — terminals stay open",
        dataset: { fkey: "team-ungroup:" + group.key },
        onclick: () => { void ungroupTeam(group.key, group.name); },
      }, "Ungroup")
      : null,
    el("span", {
      class: "repo-worktree-count",
      text: count === 1 ? "1 worktree" : count + " worktrees",
    }),
    ...group.pullRequestUrls.map((url) => el("a", {
      class: "repo-pr",
      href: url,
      target: "_blank",
      rel: "noreferrer",
      text: pullRequestLabel(url),
    })),
    programHeadRollup(bandAgents(group), null, { view: ui.view, snap: ui.snap }));

  const section = paintRepoTint(el("section", {
    class: "repo-section" + (open ? " open" : ""),
    "aria-label": group.name,
  },
    el("h2", { class: "visually-hidden", text: group.name }),
    head), tint, "has-repo-tint");
  /* One column header for the whole band, not one per worktree: five labels
     that never change were painted once per checkout — ten copies over
     fifteen rows on the measured board, the strongest repeating rhythm on the
     page — and they labeled the worktree grain, which is exactly why eleven
     checkouts read as eleven unrelated sections. Only while open: a shut fold
     has no columns to label. */
  if (open) section.append(renderAgentColumnHeader());
  if (group.kind === "team" && state.teamRenaming === group.key) {
    section.append(el("form", {
      class: "rename-form",
      onsubmit: (event) => { event.preventDefault(); void submitTeamRename(group.key); },
    },
      el("input", {
        type: "text",
        value: state.teamRenameDraft,
        maxlength: "80",
        placeholder: "Team name",
        "aria-label": "New name for " + group.name,
        disabled: state.teamRenamePending ? "" : null,
        dataset: { fkey: "team-rename-input:" + group.key },
        oninput: (event) => { state.teamRenameDraft = event.target.value; },
        onkeydown: (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            state.teamRenaming = null;
            render();
          }
        },
      }),
      el("button", {
        type: "submit",
        class: "btn primary",
        disabled: state.teamRenamePending ? "" : null,
        dataset: { fkey: "team-rename-save:" + group.key },
      }, state.teamRenamePending ? "Saving…" : "Save"),
      el("button", {
        type: "button",
        class: "btn",
        disabled: state.teamRenamePending ? "" : null,
        dataset: { fkey: "team-rename-cancel:" + group.key },
        onclick: () => { state.teamRenaming = null; render(); },
      }, "Cancel"),
      state.teamRenameError ? el("p", { class: "rename-error", role: "alert", text: state.teamRenameError }) : null));
  }
  // Left empty on purpose, exactly as renderProgram leaves its body: the
  // worktree subsections are reconciled in by key, so a band rebuild never
  // destroys a subsection — or a row — that has not moved.
  const body = el("div", { class: "repo-worktrees", id: bodyId });
  programBodies.set(repoSectionKey(group.key), body);
  section.append(body);
  return section;
}

/* ---------- program list ---------- */

function programOpen(program, ui = state) {
  const override = ui.programOverrides.get(program.id);
  if (override) return override === "open";
  if (ui.view === "history") return false;
  /* The rollup cannot decide this AT ALL, and an earlier fix here only got half
     of it. programRollup prefers the SERVER's rollup, which is a different
     derivation over a different population than the client's own viewMatches():
     its needsYou counts non-ended agents only, and its working can read 0 for an
     agent the client derives as working (a stopped transcript whose process is
     still up). Either disagreement collapsed the program, and the collapsed
     program then dropped rows that had already cleared the filter — so Now paints
     one row on a fleet with ten.

     So ask the filter's own question, not a second opinion about it: a program
     is open when it holds an agent THE ACTIVE VIEW would admit. The gate is now
     incapable of contradicting the filter, which is the invariant that was
     actually broken. History stays collapsed above; ended-and-healthy programs
     still fail this predicate, so a board of 60 finished programs stays quiet.

     It used to ask viewMatches("now", …) — the right question while Now was the
     only live tab, and the wrong one the moment Board absorbed Waiting: a
     program holding nothing but waiting sessions would have rendered as a
     header with no rows under it, on the single view that exists so nothing
     live is a click away. */
  return program.agents.some((agent) => viewMatches(ui.view, agent));
}

function toggleProgram(program) {
  state.programOverrides.set(program.id, programOpen(program) ? "closed" : "open");
  saveOverrides();
  render();
}

/* ---------- keyed reconciliation ----------
   The list guard used to be all-or-nothing: any visible agent's status, token
   count or summary moving invalidated one signature for the WHOLE list, and the
   next paint ran `root.textContent = ""` and rebuilt every program and every
   row — ~27 elements per row, so ~5,400 destroyed and recreated at 200 visible
   rows, every 4s, taking the operator's text selection and hover with them.

   `plan` is [{ key, sig, build }]. A key whose signature is unchanged keeps its
   existing DOM node, in place; only changed, added, removed and reordered keys
   are touched. `cache` is a Map key -> { sig, node } that OUTLIVES its parent,
   so even a rebuilt program section re-adopts its row nodes rather than
   constructing them again. Returns the set of keys the plan claimed, so the
   caller can prune the cache. */
function reconcileKeyed(parent, plan, cache) {
  const seen = new Set();
  let cursor = parent.firstChild;
  for (const item of plan) {
    let entry = cache.get(item.key);
    if (!entry || entry.sig !== item.sig) {
      entry = { sig: item.sig, node: item.build() };
      cache.set(item.key, entry);
    }
    seen.add(item.key);
    if (cursor === entry.node) cursor = entry.node.nextSibling;
    else parent.insertBefore(entry.node, cursor);
  }
  // Anything the plan did not claim has drifted to the tail by now.
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
  return seen;
}

const programSectionCache = new Map(); // programId -> { sig, node }
const programBodies = new Map();       // programId -> the .program-agents node
const agentRowCache = new Map();       // "<programId>\u001f<rowKey>" -> { sig, node }

/* ---------- SYNC-NF · cmux notifications and the board-local Ack ----------

   Two snapshot fields, rendered verbatim and derived nowhere else:
   `cmuxNotifications` — the unread TERMINAL alerts cmux is holding, listed
   server-side because the event stream redacts their bodies — and `acks`, the
   operator's own judgments.

   Ack is the operator's "I'm done with this row". The server writes the
   Formic ack and then mark_reads unread cmux notices on the attested
   surface. Clearing a notice from the panel is the other door into the
   same funnel: toast-only rows are acked, a live needsInput is not.
   This client still makes one request per verb.

   The Ack hides a row from the alert list and it changes NOTHING about the
   session: it does not answer the agent, and the fleet counters keep counting
   the agent because the agent really is still waiting. It self-revokes
   SERVER-side on a fresh alert fingerprint, which is why nothing in this
   client remembers an ack — the only reason a row is hidden is that this
   snapshot says so, so a revoked ack comes back on the next poll with no
   expiry timer here to get stuck. (An expiring record kept client-side is
   exactly the shape the attention snooze above has a scar for.) */

const cmuxNotifyCache = new WeakMap();  // snap -> Map<workspaceId, unread summaries>
const ackCache = new WeakMap();         // snap -> Set<agentId>

/* Unread only, indexed by workspace. Read notifications are not items: they are
   the record of an answered one, and counting them would make a badge that can
   never reach zero. */
function unreadCmuxByWorkspace(snap = state.snap) {
  if (!snap || typeof snap !== "object") return new Map();
  const cached = cmuxNotifyCache.get(snap);
  if (cached) return cached;
  const index = new Map();
  for (const note of Array.isArray(snap.cmuxNotifications) ? snap.cmuxNotifications : []) {
    if (!note || note.isRead) continue;
    const workspaceId = typeof note.workspaceId === "string" ? note.workspaceId : "";
    if (!workspaceId) continue;
    index.set(workspaceId, [...(index.get(workspaceId) || []), note]);
  }
  cmuxNotifyCache.set(snap, index);
  return index;
}

// Oldest first, so the dropdown reads in the order the terminal produced them.
function unreadCmuxNotifications(snap = state.snap) {
  return [...unreadCmuxByWorkspace(snap).values()].flat()
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id).localeCompare(String(b.id)));
}

/* WORKSPACE-scoped, not surface-scoped, because that is the question the badge
   answers: cmux notifies a workspace, and every session parked in it is one an
   operator would go to that terminal for. */
function agentUnreadCmux(agent, snap = state.snap) {
  const workspaceId = agent && agent.target && agent.target.workspaceId;
  if (!workspaceId) return [];
  return unreadCmuxByWorkspace(snap).get(workspaceId) || [];
}

function ackedIds(snap = state.snap) {
  if (!snap || typeof snap !== "object") return new Set();
  const cached = ackCache.get(snap);
  if (cached) return cached;
  const ids = new Set();
  for (const record of Array.isArray(snap.acks) ? snap.acks : []) {
    if (record && typeof record.agentId === "string" && record.agentId) ids.add(record.agentId);
  }
  ackCache.set(snap, ids);
  return ids;
}

function ackedAgent(agent, snap = state.snap) {
  return Boolean(agent) && ackedIds(snap).has(agent.id);
}

/* Alert-LIST membership, which is what an Ack governs — deliberately not a
   second opinion about alerting(). The row keeps every other consequence of
   asking for a human (its state word, its ink, its place in the rollup); what
   it loses is its seat in the strip. */
function stripAlerting(agent, snap = state.snap) {
  return (alerting(agent) || agent.attention === true) && !ackedAgent(agent, snap);
}

/* How many rows the operator's own judgment is holding out of the alert list.
   Counted over the snapshot rather than over the rendered strip, so a filtered
   board still reports it: an ack the current lens happens to hide is still an
   ack the operator made, and a count that silently dropped it would tell them
   nothing is hidden while something is. */
function acknowledgedCount(snap = state.snap) {
  let count = 0;
  for (const { agent } of agentsById(snap).values()) {
    if (ackedAgent(agent, snap) && alerting(agent)) count += 1;
  }
  return count;
}

/* ---------- the pinned Needs-you strip ----------

   Everything alerting(), across every program, in one block at the top of the
   board — the population the Needs-you TAB used to hold, kept as a place rather
   than a destination so it is on screen while the operator reads the rest of
   the fleet.

   It lives inside #programs, as the first section, and that is load-bearing in
   two ways: keyboard row navigation walks `.agent-row[tabindex="0"]` inside
   #programs in DOM order (so strip rows have to be in there to be reachable by
   arrow keys, and have to be FIRST to match what the eye sees), and the same
   two-level keyed reconciliation that owns program sections then owns this one
   — no second render path to keep in step.

   Its id starts with \u0000 so it can never collide with a real program id, and
   sorts nowhere near one in any accidental comparison. */
const STRIP_ID = "\u0000needs-you";

/* Who is in the strip, and which program each of them came from.

   Built from the ALREADY-FILTERED list, so a search or a facet narrows the
   strip exactly as it narrows the groups. An operator who filtered to one
   program is not shown another program's alert and told it needs them. */
function needsYouStrip(visible, ui = state) {
  const rows = [];
  for (const { program, agents } of visible) {
    for (const agent of agents) if (stripAlerting(agent, ui.snap)) rows.push({ agent, program });
  }
  /* One global queue, newest ask on top. The walk above is per program, so
     without this the strip's order is decided by which repo the server happened
     to list first — which ask a person sees first is then an accident of
     collection order. Recency is `alertSince`, first-seen of the current
     fingerprint; see alertRecent in agent-model.js for why no other clock on
     the record is allowed to rank it. Undated rows sort last, in the order the
     walk produced.

     The consequence, deliberate: a program's rows are NO LONGER contiguous, so
     the run-length grouping below can print the same repo's heading more than
     once. That is the honest rendering of an interleaved queue — the heading is
     a label on the run, not the thing that ordered it. */
  rows.sort((left, right) => {
    const a = Date.parse(left.agent.alertSince || "");
    const b = Date.parse(right.agent.alertSince || "");
    const aOk = Number.isFinite(a);
    const bOk = Number.isFinite(b);
    if (aOk && bOk) return b - a;
    if (aOk !== bOk) return aOk ? -1 : 1;
    return 0;
  });
  return rows;
}

/* The strip's membership as a signature fragment. It has to reach
   programsPaintSig: alerting() reads attentionSignal / outcome / lifecycle, and
   the per-agent projection in that signature carries none of them — so without
   this an agent could start or stop asking for a human and the strip would
   never repaint. That exact class of bug (state a list CONTROL writes, missing
   from the list's signature) is what the comment above programsPaintSig is
   about. */
function stripSig(rows) {
  return rows.map(({ agent, program }) => agent.id + "@" + program.id).join(",");
}

function renderNeedsYouStrip(rows) {
  /* The strip is here even when it is empty, and that is the point. The board
     used to LAND on an attention tab, so "nothing needs you" was said by the
     view being empty; one scrolling board has no such moment, and an operator
     scanning past a busy fleet has no way to tell "I checked and nothing is
     asking" from "I have not looked yet".

     It says it about SESSIONS and nothing else. "Nothing needs you" over an
     open collector fault is the false all-clear this codebase has a scar for —
     the rail beside it was counting the fault at the time — so the sentence
     names its own population and leaves the verdict on the fleet's health to
     the surface that computes it. */
  if (!rows.length) {
    // No body to reconcile rows into. Drop the stale one or the next paint
    // would reconcile strip rows into a node that is no longer in the document.
    programBodies.delete(STRIP_ID);
    return el("section", { class: "needs-strip is-clear", "aria-label": "Needs you" },
      el("div", { class: "needs-strip-head" },
        el("span", { class: "needs-strip-mark", "aria-hidden": "true" }, icon("check")),
        el("span", { class: "needs-strip-title", text: "No session is asking for you" }),
        el("span", { class: "needs-strip-note", text: "the whole live fleet is below" })));
  }
  const section = el("section", {
    class: "needs-strip",
    "aria-label": "Needs you",
  },
    el("div", { class: "needs-strip-head" },
      el("span", { class: "needs-strip-title", text: "Needs you" }),
      el("span", { class: "needs-strip-count mono", text: String(rows.length) }),
      /* Says why these rows are not in their program group below, so the two
         places an operator might look for the same session agree with each
         other instead of one of them silently omitting it. */
      el("span", {
        class: "needs-strip-note",
        text: rows.length === 1
          ? "pinned here instead of its program group"
          : "pinned here instead of their program groups",
      })));
  /* No caret, by design. This is the one block on the board that must be
     readable without a decision, so there is nothing to collapse it with and
     nothing to persist — a strip an operator can close is a strip that is
     closed on the morning it matters. */
  const body = el("div", { class: "needs-strip-agents" });
  programBodies.set(STRIP_ID, body);
  section.append(body);
  return section;
}

/* ---------- swarm collapse ----------

   Children are collapsed by default: a ten-child verifier fan is one
   workstream, and printing all eleven rows buries the nine other programs under
   it. `swarmOverrides` holds only the swarms the operator opened, on the exact
   programOverrides pattern (localStorage, an override map, a paint signature
   that carries it).

   There is deliberately no auto-expand. A collapsed child that starts alerting
   reaches the operator through the strip above — which is flat and
   cross-program precisely so nothing can hide inside a collapsed parent — and
   the parent's own swarm chip takes ember ink. Opening the swarm under them
   while they read it would move the rows they were looking at. */
/* Whether a group would draw NOTHING under its head: every admitted session is
   pinned in the strip, and the Finished shelf (already filtered by the shelf's
   own governor upstream) holds no records. Such a group used to render as a
   head plus a column bar over emptiness — the "empty shell" this board stopped
   drawing. Pane mode only: inline mode pins nothing, and History pins nothing,
   so everywhere else this is constant false and the path is untouched. */
function hollowInPane(agents, finished, ui) {
  if (ui.view !== "board" || needsYouDisplayOf(ui) !== "pane") return false;
  if (!agents.length) return false;
  /* stripAlerting, not alerting: an ACKED row is drawn in this group rather
     than pinned, so a group holding one is not hollow. Reading alerting() here
     would skip the section that is now the only place that row is drawn — the
     row would vanish off the board entirely, which is the one thing an Ack is
     forbidden to do. */
  if (!agents.every((agent) => stripAlerting(agent, ui.snap))) return false;
  return !(finished || []).length;
}

function swarmOpen(agent, ui = state) {
  return ui.swarmOverrides.get(agent.id) === "open";
}

function toggleSwarm(agent) {
  if (swarmOpen(agent)) state.swarmOverrides.delete(agent.id);
  else state.swarmOverrides.set(agent.id, "open");
  saveSwarmOverrides();
  render();
}

/* Everything the program SHELL paints — head label, caret state, rollup cells
   and the rename form. Deliberately NOT the rows: a rollup that has not moved
   must leave the section node alone so its rows stay attached. renameDraft stays
   out for the same reason it stays out of every other signature (live input);
   every external reset of it flips renamePending. */
function programShellSig(program, agents, ui, label = "") {
  const key = presentationLabelKey(programLabelTarget(program));
  return [
    program.id,
    /* The head now paints differently per view (Board drops ended/session
       tokens, slims a solo worktree, and prints "N of M shown" from the
       ADMITTED list) — so the view and the admitted count are painted state. */
    ui.view,
    String(agents.length),
    programName(program, label),
    ui.labels.has(key) ? "1" : "0",
    programOpen(program, ui) ? "open" : "shut",
    // Header counts the whole program, so the signature must watch the whole
    // program too — otherwise a change outside the active filter never repaints.
    programRollupCells(program.agents, program.rollup, ui.snap).map((c) => c.key + "=" + c.value + (c.alert ? "!" : "")).join(","),
    ui.renaming === key ? "1" : "0",
    ui.renamePending ? "1" : "0",
    ui.renameError || "",
  ].join("\u001f");
}

/* Everything ONE row paints. agentRecordSig is the same whole-record projection
   the drawer uses, so a snapshot field added later is covered automatically;
   the rest is the per-row slice of list state (whether this row is the open
   drawer, and its rename form) plus its position in the swarm tree. The live
   elapsed clock stays out — tickClocks rewrites it in place from
   data-elapsed-base — but the >10min staleness fact does not tick, so it is in. */
function agentRowSig(agent, ui, opts = {}) {
  const nowMs = Number.isFinite(Date.parse(ui.snap && ui.snap.generatedAt))
    ? Date.parse(ui.snap.generatedAt)
    : Date.now();
  const opState = operatorState(
    agent,
    nowMs,
    stallThresholdMs(ui.snap),
    ackedAgent(agent, ui.snap),
  );
  return [
    agentRecordSig(agent),
    rowStalenessText(agent),
    ui.labels.get(presentationLabelKey(agentLabelTarget(agent))) || "",
    ui.labels.get(presentationLabelKey(preferredRenameTarget(agent))) || "",
    ui.selectedId === agent.id ? "1" : "0",
    ui.selectMode ? "select" : "",
    ui.groupingIds && ui.groupingIds.has && ui.groupingIds.has(agent.id) ? "grouping" : "",
    ui.renaming === presentationLabelKey(preferredRenameTarget(agent)) ? "1" : "0",
    ui.renamePending ? "1" : "0",
    ui.renameError || "",
    /* Display name derives from the cmux workspace title when
       preferredRenameTarget is workspace. The title arrives from the terminal
       on the event stream, so a rename made on the other side moves NOTHING
       else in this signature — without it the row keeps its cached node and
       the new name never appears. */
    (agent.target && agent.target.workspaceTitle) || "",
    agent.target && ui.wsRenaming === agent.target.workspaceId ? "ws-editing" : "",
    ui.contextDisplay || "",
    String(opts.depth || 0),
    String(opts.childCount || 0),
    // The whole-board swarm size behind the chip's "of N" clause: a sibling
    // arriving in another program changes the label with nothing else moving.
    String(opts.fullChildCount || 0),
    // Whether this row is showing a session tag. Without it the row keeps its
    // cached node when a twin arrives or leaves, so the tag would never appear
    // and never go away. Both collision tests, matching renderAgentRow: the
    // resolved identity, and the name the row actually prints.
    opts.ambiguousNames && opts.ambiguousNames.has(agentName(agent)) ? "amb" : "",
    opts.sharedNames && opts.sharedNames.has(rowDisplayName(agent)) ? "twin" : "",
    // The swarm caret's own state, and the ember it takes when something folded
    // up under it is asking for a person. Both are painted on this row and
    // neither is derivable from the agent record, so both have to be in here or
    // the caret renders dead — the same failure programOverrides had.
    opts.swarmOpen ? "swarm-open" : "swarm-shut",
    opts.swarmAlerting ? "swarm-alert" : "",
    // The strip's copy of a row carries the program's words in its aria-label
    // (its group copy does not), so a relabel must rebuild the node.
    opts.programChip ? "chip:" + stripChipLabel(opts.programChip) : "",
    // Inline mode's membership mark. A hook can flip it with nothing else in
    // this signature moving, so it has to be in here or the row keeps its
    // cached, unmarked node.
    opts.alerting ? "alert-mark" : "",
    /* The recency stamp. A newer ask arriving on ANOTHER row re-ranks this one
       with nothing on its own record moving, so without this the row keeps its
       cached node, the stamp goes stale, and the float compares a rank the row
       no longer has — which is worse than not flying at all. */
    "rank:" + (opts.alertRank == null ? "" : opts.alertRank),
    opState || "",
    /* Quiet-row age is lastThreadAt. Working rows tick duration from
       workingSince in place; a later tool must not rebuild the row or the
       verb shimmer restarts. */
    opState === "working" ? "" : (agent.lastThreadAt || ""),
    ui.momentumMagnify
      ? (momentumPopulation(agent, ui.snap) ? "mom-hot" : "mom-recede")
      : "",
    /* Signal's tick. It arrives on the colour endpoint's clock rather than the
       snapshot's, so nothing else in this signature moves when it lands. */
    opts.repoTint || "",
    /* SYNC-NF. Both of this lane's row facts live on the SNAPSHOT rather than
       on the agent record, so agentRecordSig carries neither: a notification
       arriving, or an ack landing, moves nothing else in this string and the
       row would keep its cached, unchanged node. Documented failure class,
       same as opts.alerting directly above. */
    "cmux:" + agentUnreadCmux(agent, ui.snap).length,
    ackedAgent(agent, ui.snap) ? "acked" : "",
    swarmNote(agent, opts) || "",
  ].join("\u001f");
}

function swarmAnchorSig(agent, depth, activeChildren, ui, pinned = false, board = {}) {
  return [
    agent.id,
    /* The name the anchor PRINTS, not the resolved identity — the tag beside it
       comes and goes as a twin arrives on or leaves the board, and a signature
       that carried only the unique identity would keep the stale cached node. */
    displayNameWithTag(agent, board),
    agent.provider,
    agent.model || "",
    String(depth),
    String(activeChildren),
    // Why the parent is absent, which changes both the anchor's sentence and
    // its focus key. Without it a parent moving into or out of the strip keeps
    // its cached anchor node and the sentence goes stale.
    pinned ? "pinned" : "filtered",
    ui.labels.get(presentationLabelKey(agentLabelTarget(agent))) || "",
  ].join("\u001f");
}

/* Signature ignores live elapsed clocks — status/message/model/context drive
   paint. It must also carry the state the list CONTROLS write, or every one of
   them reads as dead: toggleProgram only mutates programOverrides, and both
   rename pencils only set renaming, so on a quiet fleet render() early-returned
   and the caret never moved / the rename form never appeared. renameDraft stays
   out on purpose — it is a live input, and every external reset of it flips
   renamePending, which is in here. */
function programsPaintSig(visible, ui) {
  return [
    ui.view,
    ui.query,
    ui.facetProgram,
    /* Every lens axis, in the table's order. A set is joined rather than
       stringified so [working, waiting] and [waiting, working] compare equal —
       they ARE the same board, and repainting because the operator ticked the
       two boxes in the other order would be a strobe with no cause. */
    LENS_AXES.map((axis) => axis.key + "=" + [...(ui[axis.stateKey] || [])].sort().join("+")).join(";"),
    ui.lookbackHours,
    ui.showReviewWorkers ? "1" : "0",
    /* Sixth instance of the mutates-only-itself failure class the note above
       names: the repo-colour fetch writes `repoColors` and nothing else, so
       without this the board would stay untinted until an unrelated repaint —
       and on a quiet fleet that is never. */
    String(repoColorsVersion),
    /* Fifth instance of the mutates-only-itself failure class: the settings
       radio writes needsYouDisplay and nothing else, so without this the strip
       would neither leave nor return until something unrelated repainted. */
    needsYouDisplayOf(ui),
    ui.momentumMagnify ? "mom-on" : "mom-off",
    ui.selected ? ui.selected.kind + ":" + ui.selected.id : "",
    [...ui.programOverrides].map(([id, mode]) => id + "=" + mode).join(","),
    /* Third instance of the same failure class: toggleRepo mutates nothing else
       either, so on a quiet fleet the early return would swallow the click and
       the repo caret would sit there dead. */
    [...(ui.repoOverrides || [])].map(([id, mode]) => id + "=" + mode).join(","),
    /* Same reason programOverrides is here: toggleSwarm mutates nothing else,
       so on a quiet fleet the early return would swallow the click and the
       caret would sit there dead. Documented failure class, second instance. */
    [...ui.swarmOverrides].map(([id, mode]) => id + "=" + mode).join(","),
    // Fourth instance. toggleShelf is the same shape of control as the other three.
    [...(ui.shelfOverrides || [])].map(([id, mode]) => id + "=" + mode).join(","),
    /* Strip membership. It decides which rows are pinned at the top AND which
       rows are therefore missing from their program group, so a change to it
       repaints two things at once — and neither of them is derivable from the
       per-agent projection below. */
    stripSig(needsYouStrip(visible)),
    ui.renaming || "",
    ui.renamePending ? "1" : "0",
    ui.renameError || "",
    visible.map(({ program, agents, finished }) =>
      program.id + "@" + (programOpen(program, ui) ? "open" : "shut")
      + "~" + programName(program)
      /* The shelf's population. A session finishing moves it OUT of `agents`
         and INTO here, and the two changes cancel in a signature that watches
         only the first — so the count on a collapsed shelf would go stale
         exactly when it changed. */
      + "#" + (finished || []).map((a) => a.id).join("+")
      + ">" + agents.map((a) => [
        a.id,
        a.status,
        /* The lifecycle and the scope, not just the legacy status word: they
           are what puts a row under Active rather than Waiting, and what makes
           it read "Retained history". `status` tracks them closely enough that
           they usually move together, and "usually" is how a section head goes
           stale for the one row that matters. */
        lifecycleOf(a),
        scopeOf(a),
        a.statusReason || "",
        a.model || "",
        contextDisplayValue(a.tokens) || "",
        rowSummary(a) || "",
        ui.labels.get(presentationLabelKey(agentLabelTarget(a))) || "",
      ].join(":")).join(","),
    ).join("|"),
    emptyStateSig(visible, ui),
    ui.selectMode ? "select" : "",
    String((ui.groupingIds && ui.groupingIds.size) || 0),
  ].join("\u001f");
}

/* Everything the empty state renders, and nothing when there is no empty state.

   When no rows are visible the row signature above is CONSTANT, so this whole
   paint was skipped and the block froze at its first render — permanently.
   Measured on the board: the client's findings collection said BETA while the
   DOM still named a finding from a snapshot minutes earlier, and the all-clear
   vitals ("37 live · 7 working · 30 idle") were frozen alongside it. Those
   numbers exist precisely so an operator can tell "nothing is wrong" from
   "nothing is loading", which a stale number cannot do.

   This predates the false-all-clear fix and was invisible while the block held
   only static prose. The open-findings line made it consequential. */
function emptyStateSig(visible, ui) {
  if (visible.length || !ui.snap) return "";
  const t = totalsOf(ui.snap);
  return [
    t.live, t.working, t.idle, t.tracked,
    stalledCount(ui.snap),
    /* id AND title: the line renders titles, and a finding can keep its id while
       its wording changes ("2 collector problems" becoming "3"). Keying on the
       id alone repainted once and then froze again — caught by driving two
       findings through the same id in the browser. A paint signature has to
       contain what is painted. */
    issuesOf(ui.snap).map((finding) => finding.id + "~" + finding.title).join("+"),
  ].join(":");
}

/* Two levels of keyed reconciliation instead of one wholesale rebuild: sections
   by id — the pinned Needs-you strip first, then programs — and rows by agent
   id inside each section body. Split out of renderPrograms so the whole path
   can be driven directly in a test without the module's state plumbing. Returns
   the visible agent count.

   `shown` counts what the FILTER admitted, not what was drawn. The strip moves
   rows between sections and a collapsed swarm hides them; neither changes how
   many sessions matched, which is the number the scope note reports. */
function syncProgramList(root, visible, ui = state) {
  // Once per paint, for the whole board: the strip and every program group ask
  // the same two questions (who is this agent's parent, is this name shared),
  // and both answers are fleet-wide rather than per-program.
  const board = boardIndex(ui);
  const strip = needsYouStrip(visible);
  const sections = [];
  /* Board only, and only over a board that has something on it: History is a
     record rather than a request, and an empty board says its own sentence
     below rather than pinning "no session is asking" over nothing. In inline
     mode there is no strip at all — not even the calm empty state, because a
     surface whose whole job the operator turned off has nothing true to say. */
  if (ui.view === "board" && visible.length && needsYouDisplayOf(ui) === "pane") {
    sections.push({
      key: STRIP_ID,
      sig: "strip\u001f" + (strip.length ? stripSig(strip) : "clear"),
      build: () => renderNeedsYouStrip(strip),
    });
  }
  /* Three levels now, not two: repo bands, the worktree subsections inside
     them, and the rows inside those — all through the SAME two cache maps,
     under keys that name their axis. A program the server could not resolve a
     repo for is still one flat section keyed by its id, drawn by the same
     renderer, so nothing about that path moved. */
  const groups = teamGroups(visible);
  /* Hollow groups plan no shell at all — not a head, not a column bar. Their
     rows are in the strip under a heading that says exactly where they belong,
     and `shown` still counts them below, because where a row is DRAWN never
     changes how many sessions matched. */
  const liveWorktrees = (group) =>
    group.worktrees.filter(({ agents, finished }) => !hollowInPane(agents, finished, ui));
  for (const group of groups) {
    if (group.kind === "repo" || group.kind === "team") {
      if (!liveWorktrees(group).length) continue;
      sections.push({
        key: repoSectionKey(group.key),
        sig: repoShellSig(group, ui),
        build: () => renderRepoSection(group, ui),
      });
      continue;
    }
    if (hollowInPane(group.agents, group.finished, ui)) continue;
    sections.push({
      key: group.program.id,
      sig: programShellSig(group.program, group.agents, ui),
      build: () => renderProgram(group.program, group.agents),
    });
  }
  const keptSections = new Set(reconcileKeyed(root, sections, programSectionCache));
  /* Worktree subsections are section-level nodes living one level down, so they
     share the section cache and are pruned with it — which means the prune has
     to wait until both levels have been reconciled. A collapsed band plans no
     subsections, exactly as a collapsed program plans no rows. */
  for (const group of groups) {
    if (group.kind !== "repo" && group.kind !== "team") continue;
    const band = programBodies.get(repoSectionKey(group.key));
    if (!band) continue;
    const plan = repoOpen(group, ui)
      ? liveWorktrees(group).map(({ program, agents, worktreeKey, label }) => {
        const key = worktreeSectionKey(group.key, worktreeKey);
        return {
          key,
          sig: programShellSig(program, agents, ui, label),
          build: () => renderProgram(program, agents, { label, bodyKey: key }),
        };
      })
      : [];
    for (const key of reconcileKeyed(band, plan, programSectionCache)) keptSections.add(key);
  }
  for (const key of [...programSectionCache.keys()]) {
    if (keptSections.has(key)) continue;
    programSectionCache.delete(key);
    programBodies.delete(key);
  }

  let shown = 0;
  const keptRows = new Set();
  const stripBody = strip.length && needsYouDisplayOf(ui) === "pane" ? programBodies.get(STRIP_ID) : null;
  if (stripBody) {
    /* Grouped by program, in first-appearance order: one heading per run of
       rows, so eight pinned sessions read as short sections under names
       instead of eight chips fighting eight titles for the same line.
       The strip is recency-ordered now (needsYouStrip), so a run is no longer
       the same thing as a program: one program can own two runs with another
       repo's newer ask between them. The run index is therefore part of both
       keys. Without it the reconcile cache hands the second run the FIRST
       run's node and merely MOVES it — the earlier heading disappears and its
       rows end up filed under the wrong repo — and two heading buttons sharing
       a focus key send restore-by-fkey to whichever came first. */
    const plan = [];
    let headFor = null;
    const runsSeen = new Map();
    let hotRank = 0;
    for (const { agent, program } of strip) {
      if (program.id !== headFor) {
        headFor = program.id;
        const run = runsSeen.get(program.id) || 0;
        runsSeen.set(program.id, run + 1);
        const label = stripChipLabel(program);
        plan.push({
          key: STRIP_ID + "\u001fhead:" + program.id + "\u001f" + run,
          // The pill's hex too, or the heading keeps its cached, pill-less
          // node when the colour endpoint answers.
          sig: "head\u001f" + label + "\u001f" + tintOfProgram(program),
          build: () => renderStripGroupHead(program, label, run),
        });
      }
      /* Every strip row is hot by construction, so its rank IS its index in the
         list needsYouStrip just sorted — the stamp the float compares across a
         paint to see that an already-hot row changed places. */
      const opts = stripRowOpts(program, board, hotRank);
      hotRank += 1;
      plan.push({
        key: STRIP_ID + "\u001frow:" + agent.id,
        sig: agentRowSig(agent, ui, opts),
        build: () => renderAgentRow(agent, program, opts),
      });
    }
    for (const key of reconcileKeyed(stripBody, plan, agentRowCache)) keptRows.add(key);
  }
  const rowsInto = (sectionKey, program, agents, finished, banded = false) => {
    const body = programBodies.get(sectionKey);
    if (!body) return;
    // A collapsed program keeps its section but drops its rows; the row cache
    // still holds them, so re-expanding costs a move rather than a rebuild.
    const plan = programOpen(program, ui)
      ? agentRowPlan(program, agents, ui, board, { finished, banded }).map((item) => ({ ...item, key: sectionKey + "\u001f" + item.key }))
      : [];
    for (const key of reconcileKeyed(body, plan, agentRowCache)) keptRows.add(key);
  };
  /* `shown` counts what the FILTER admitted, not what was drawn — a collapsed
     band hides rows without changing how many sessions matched, which is the
     number the scope note reports. */
  for (const group of groups) {
    if (group.kind === "repo" || group.kind === "team") {
      const open = repoOpen(group, ui);
      for (const { program, agents, finished, worktreeKey } of group.worktrees) {
        shown += agents.length;
        if (open) rowsInto(worktreeSectionKey(group.key, worktreeKey), program, agents, finished, true);
      }
      continue;
    }
    shown += group.agents.length;
    rowsInto(group.program.id, group.program, group.agents, group.finished);
  }
  for (const key of [...agentRowCache.keys()]) if (!keptRows.has(key)) agentRowCache.delete(key);
  return shown;
}

/* The pane's own group heading: the same "repo · branch@worktree" words the
   board section below says, as the jump control back to it. A heading rather
   than a per-row chip, because the chip stole the title's width on every line
   and repeated one fact per row that a run of rows shares. */
function renderStripGroupHead(program, label, run = 0) {
  const repo = repoOf(program);
  const repoName = (repo && repo.repoName) || "";
  const tint = tintOfProgram(program);
  /* Signal's quiet repo pill. The strip is the board's one surface with no band
     name above it, so this is where the repository is said — a bordered pill,
     never tinted text (rule 6). The word inside it is already the first half of
     `label`, so the pill is decoration over a fact the heading states in full;
     the button's aria-label carries the whole thing either way. */
  const pill = tint
    ? paintRepoTint(
      el("span", { class: "strip-repo-pill", "aria-hidden": "true", text: repoName }),
      tint,
      "has-repo-tint",
    )
    : null;
  return el("button", {
    class: "strip-group-head",
    title: "Jump to " + label,
    "aria-label": "Jump to program group: " + label,
    /* One key per RUN, not per program: recency can split a repo across two
       runs, and two focus stops answering to the same key send restore-by-fkey
       to whichever came first. The first run keeps the bare key, so a strip
       that never interleaves has the focus behaviour it always had. */
    dataset: { fkey: "strip-head:" + program.id + (run ? ":" + run : "") },
    onclick: () => jumpToProgramGroup(program),
  },
    pill,
    el("span", { class: "strip-group-name", text: label }),
    el("span", { class: "strip-group-go", "aria-hidden": "true", text: "↗" }));
}

/* A strip row is the same row renderAgentRow draws in a program group — same
   name, same aria-label, same controls — plus the one fact its group heading
   was carrying for it: which program it belongs to. Reusing the renderer is
   what stops the strip from becoming a second, quietly divergent copy of a row.

   Depth is flat and the swarm tree is not drawn here: the strip is a list of
   sessions asking for a person, and a child that is asking is asking whether or
   not its parent is on screen. Its nesting is still true, and still shown, in
   the group below and in the drawer's lineage spine. */
function stripRowOpts(program, board, alertRank = "") {
  return {
    depth: 0,
    childCount: 0,
    programChip: program,
    fullById: board.byId,
    ambiguousNames: board.ambiguous,
    sharedNames: board.sharedNames,
    /* Where this row sits in the one recency queue the strip is. Membership
       alone cannot see a swap of two rows that were both already hot, so the
       float reads this too — and it must come from the list that was just
       sorted, never recomputed from another one. */
    alertRank,
    /* The band tint, OFFERED — the reversal of authority rule 5 on this
       surface. Same hue the heading wears: team hex when the program is
       unanimous, repo otherwise.

       It used to be withheld here on purpose, and that was correct while rule 5
       said an attention row belongs to status outright: an offered tick would
       have painted a repo wash on an attention row, and the shape that made it
       unfixable in CSS is still true — a hook-needsInput agent is alerting with
       a HEALTHY outcome, so it wears none of the is-needs-you / is-blocked /
       is-failed classes a `:not()` could have caught it by.

       What changed is the rule, not the shape. Attention no longer evicts the
       wash; it adds an outline in a bolder version of the same hue
       (`.agent-row.is-alert-hot`). So the row that needs a person keeps its
       repository and gets louder on top of it, and the heading pill goes back
       to being what it reads as — a jump control — instead of the only place
       the repo is said.

       Still NOT `alerting: true`. That would give pane mode a second mark for
       something its strip already says ("inline mode marks every row the strip
       would have taken", tests/web-client.test.ts); is-alert-hot is the mark
       both modes share, and it is stamped from stripAlerting inside
       renderAgentRow rather than passed in here. */
    repoTint: tintOfProgram(program),
  };
}

/* How many sessions the LOOKBACK — and only the lookback — is holding back.

   Every other filter in currentFilter is applied, so this answers the one
   question the all-clear cannot answer for itself: "is the board empty, or is
   the window just short?" A bare "showing 6h" leaves an operator guessing
   whether that matters; a count tells them.

   It calls the filtering program's own predicates rather than re-deriving them.
   passesReviewVisibility and passesEveryLens are theirs, and a second copy of
   either would be a second answer to the same question — the defect this file
   has a scar for in three other places. */
function hiddenByLookback(ui = state) {
  if (!lookbackApplies(ui.view) || ui.lookbackHours == null || !ui.snap) return 0;
  let hidden = 0;
  for (const { agent, program } of snapshotAgents(ui.snap)) {
    if (!dashboardVisible(agent)) continue;
    // Inside the window, or exempt from it because it is an unacked ask — and
    // an exempt row is on screen, so counting it as hidden would send the
    // operator off to widen a window for a row they are looking at.
    if (withinWindowOrAsking(agent, ui.view, ui.lookbackHours, ui.snap)) continue;
    if (!viewMatches(ui.view, agent)) continue;
    if (!matchesQuery(agent, program, ui.query)) continue;
    if (!passesReviewVisibility(
      agent,
      ui.view,
      ui.showReviewWorkers,
      Boolean(ui.query) && sessionKindOf(agent) === "review" && matchesQuery(agent, program, ui.query),
    )) continue;
    if (ui.facetProgram && program.id !== ui.facetProgram) continue;
    if (!passesEveryLens(agent, ui)) continue;
    hidden += 1;
  }
  return hidden;
}

/* The constrained-empty sentence, pure so the harness can reach it: renderPrograms
   is below the seam and this copy was unreachable by test — the exact shape a
   sentence drifts in. Returns null when no constraint is active, and the caller
   falls through to the all-clear composite. */
function emptyListMessage(ui = state) {
  const lookbackHiding = lookbackApplies(ui.view) && ui.lookbackHours != null;
  const reviewsHidden = !ui.showReviewWorkers ? reviewWorkerCount(ui) : 0;
  const active = activeLenses(ui);
  /* THE LOOKBACK IS NOT A CONSTRAINT THE OPERATOR CHOSE.

     It was in this test, and because lookbackApplies("board") is true and no
     reachable preset is null, `lookbackHiding` was ALWAYS true on Board — so
     this returned a sentence every time and the rich all-clear below was dead
     code at every window an operator can pick. It was reachable only through
     the separate Everything control. Nothing covered it: `grep "Nothing is
     live" tests/` returned nothing at all, which is how it rotted unnoticed.

     Making the branch merely reachable would have been worse than leaving it.
     "Nothing is live" is FALSE under a 6h window: withinLookback filters on
     updatedAt recency, so a session whose process is alive and which has been
     waiting on a person for eight hours is live and outside it — and because
     the filter keys on quiet time, the rows it excludes first are the ones
     quiet longest, exactly the blocked-on-a-human population this board exists
     to surface. A thin-but-true line would have become a rich-but-false one.

     So the lookback stops forcing this sentence, and the rich state DISCLOSES
     the window instead, carrying how many sessions it is holding back. Both
     facts are true at once and both get said. The lookback still appears in the
     list below when some other constraint is also active — it is a real part of
     "why is this empty" then, just never the whole of it. */
  if (!ui.query && !ui.facetProgram && !active.length && !reviewsHidden) return null;
  /* One hidden reviewer is one review worker. The count is rendered into the
     sentence, so the noun and its verb have to agree with it or the disclosure
     reads as a bug in the very number it is disclosing. */
  const reviewers = reviewsHidden + " review worker" + (reviewsHidden === 1 ? "" : "s");
  const parts = [];
  if (ui.query || ui.facetProgram) parts.push("search and filters");
  /* The facets get NAMED rather than folded into "filters": an operator staring
     at an empty board needs to read which lens emptied it, not that some lens
     did. The control is one click away, but only if they know which one — and
     with five axes now, "some filter" is a worse answer than it ever was. The
     MEMBERS are named too: "status (working or waiting)" is a different and much
     more diagnosable claim than "status". */
  for (const lens of active) parts.push(lens.axis.key + " (" + lens.words.join(" or ") + ")");
  if (lookbackHiding) parts.push("lookback (" + lookbackLabel(ui.lookbackHours) + ")");
  if (reviewsHidden) parts.push(reviewers + " hidden");
  return reviewsHidden && parts.length === 1
    ? reviewers + (reviewsHidden === 1 ? " is" : " are") + " hidden from the Board. Show them from Filters."
    : "Nothing matches the current " + parts.join(" and ") + " in this view.";
}

/* ---------- the float: FLIP across one keyed reconcile ----------
   Capture BEFORE syncProgramList, play AFTER. Keys are dataset.fkey, not node
   identity, so a row that re-homes across containers — a group row pinned into
   the strip, or released from it — flies too, which is exactly when the
   operator most needs to follow it. Flights play only when some row's alert
   membership flipped in this paint: routine repaints (tokens ticking, summaries
   updating) must stay motionless. Spec §4 carries the tuned values verbatim. */
const ROW_FLIGHT_CURVE = "cubic-bezier(0.5, 0.05, 0.12, 1)";
const ROW_FLIGHT_TIMING = { duration: 900, delay: 40, fill: "backwards", easing: ROW_FLIGHT_CURVE };
const ROW_SLIDE_TIMING = { duration: 700, delay: 120, fill: "backwards", easing: ROW_FLIGHT_CURVE };
const ROW_LANDING_FADE_MS = 540;

/* Mover detection reads the data-hot stamp renderAgentRow writes from
   stripAlerting — the SAME predicate the sort reads — never the alert
   classes: is-alerting is inline-mode only, presentedOutcome mutes only
   needs-you, and a presented-ink flip without a membership change (a
   declaredQuiet row gaining a failed outcome) must not fly. */
function rowAlertMarked(row) {
  return Boolean(row.dataset) && row.dataset.hot === "true";
}

/* Position inside the alert list, "" for anything not in it. Read as a string
   on purpose — it is compared for CHANGE, never for magnitude, and a row that
   left the list must compare unequal to every rank it ever held. */
function rowAlertRank(row) {
  return (row.dataset && row.dataset.alertRank) || "";
}

function captureRowFlights(root) {
  /* Null is the no-motion answer, and it must be reachable from every guard:
     render correctness can never depend on the float running. */
  if (!root || typeof root.querySelectorAll !== "function") return null;
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const before = new Map();
  for (const row of root.querySelectorAll(".agent-row")) {
    if (typeof row.animate !== "function" || typeof row.getBoundingClientRect !== "function") return null;
    const key = row.dataset && row.dataset.fkey;
    if (!key) continue;
    before.set(key, {
      top: row.getBoundingClientRect().top,
      alerted: rowAlertMarked(row),
      rank: rowAlertRank(row),
    });
  }
  return before.size ? before : null;
}

/* The LATEST mover flight owns a row's lift classes (spec §4: one lift, one
   settle — the mover wears the lift for the whole flight). A re-fly cancels
   the previous animation synchronously, but the canceled flight's rejection
   handler is a microtask that runs AFTER the new lift is applied — and a
   landed flight's fade timer can fire mid-second-landing. Both are stale
   hands on a row a newer flight now owns: every handler checks ownership
   first and stands down when it lost the row. */
const rowFlightOwner = new WeakMap(); // row -> { flight, landingTimer }

function playRowFlights(root, before) {
  if (!before || !root || typeof root.querySelectorAll !== "function") return;
  /* Movers are decided from the marks alone, with NOTHING measured or
     canceled yet: a mover-less repaint must return through the gate below
     with every in-flight animation untouched. */
  const candidates = [];
  let hasMover = false;
  for (const row of root.querySelectorAll(".agent-row")) {
    const key = row.dataset && row.dataset.fkey;
    const prior = key ? before.get(key) : undefined;
    if (!prior || typeof row.animate !== "function") continue;
    /* Two ways a row's place in the alert list can change: it joined or left
       (membership), or it kept its seat and the queue re-ranked around it
       (recency). The second is only asked of rows that are STILL hot — a calm
       row's rank is "" in both captures, so it can never become a mover on
       geometry alone, which is what keeps a routine repaint motionless. */
    const mover = prior.alerted !== rowAlertMarked(row)
      || (rowAlertMarked(row) && prior.rank !== rowAlertRank(row));
    if (mover) hasMover = true;
    candidates.push({ row, prior, mover });
  }
  /* No membership flip → no flights: a paint that merely refreshed content
     does not move the operator's eye. */
  if (!hasMover) return;
  for (const { row, prior, mover } of candidates) {
    /* Cancel BEFORE measuring. getBoundingClientRect includes a superseded
       flight's transform, and a delta taken through that transform starts the
       new flight at the OLD flight's destination instead of where the eye
       currently sees the row. Canceling first also settles a membership-
       flipped row whose delta lands at 0: its stale flight ends now instead
       of playing out under a verdict that no longer holds. */
    if (typeof row.getAnimations === "function") for (const a of row.getAnimations()) a.cancel();
    const delta = prior.top - row.getBoundingClientRect().top;
    if (!delta) continue;
    if (mover) {
      const stale = rowFlightOwner.get(row);
      if (stale && stale.landingTimer !== undefined) clearTimeout(stale.landingTimer);
      // A re-lifting row is not landing: the fade state clears NOW, not when
      // a stale timer gets around to it.
      row.classList.remove("is-landing");
      row.classList.add("is-floating");
    }
    const flight = row.animate(
      [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
      mover ? ROW_FLIGHT_TIMING : ROW_SLIDE_TIMING);
    if (mover) {
      const owner = { flight };
      rowFlightOwner.set(row, owner);
      flight.finished.then(() => {
        if (rowFlightOwner.get(row) !== owner) return;
        row.classList.remove("is-floating");
        row.classList.add("is-landing");
        owner.landingTimer = setTimeout(() => {
          if (rowFlightOwner.get(row) !== owner) return;
          row.classList.remove("is-landing");
        }, ROW_LANDING_FADE_MS);
      }).catch(() => {
        if (rowFlightOwner.get(row) !== owner) return;
        row.classList.remove("is-floating");
        row.classList.remove("is-landing");
      });
    }
  }
}

function renderPrograms() {
  const root = $("programs");
  const usage = $("usage-panel");
  if (!root) return;
  if (state.view === "usage") {
    state.paintSig.programs = "usage:" + state.usageRangeId + ":" + state.usageFetchedAt;
    root.hidden = true;
    if (usage) usage.hidden = false;
    renderUsagePanel();
    renderScopeNote(0);
    return;
  }
  root.hidden = false;
  if (usage) {
    usage.hidden = true;
    usage.textContent = "";
  }
  if (!state.snap) {
    state.paintSig.programs = "empty";
    root.textContent = "";
    programSectionCache.clear();
    programBodies.clear();
    agentRowCache.clear();
    renderScopeNote(0);
    return;
  }

  const filter = currentFilter();
  const shelved = shelfFilter();
  const visible = [];
  const programs = dashboardPrograms(state.snap);
  const presentationState = {
    ...state,
    snap: { ...state.snap, programs },
  };
  for (const program of programs) {
    const agents = program.agents.filter((a) => filter(a, program));
    /* A program with nothing live is still absent from a live view — the shelf
       explains rows that LEFT a group the operator is looking at, and it has no
       business conjuring a section for a worktree whose work is entirely over. */
    if (!agents.length) continue;
    visible.push({ program, agents, finished: program.agents.filter((a) => shelved(a, program)) });
  }
  if (paintUnchanged("programs", programsPaintSig(visible, presentationState))) {
    renderScopeNote(visible.reduce((n, row) => n + row.agents.length, 0));
    return;
  }

  const flights = captureRowFlights(root);
  const shown = syncProgramList(root, visible, presentationState);
  playRowFlights(root, flights);
  renderScopeNote(shown);

  const tracked = programs.reduce((total, program) => total + program.agents.length, 0);
  if (shown || !tracked) return;

  const constrained = emptyListMessage(state);
  if (constrained) {
    root.append(el("p", { class: "no-match", text: constrained }));
  } else {
    /* Every empty state names the constraints that produced it, including the
       scan window — which nothing used to mention anywhere, so an operator
       looking at an empty History had no way to learn that collectors only read
       36 hours back and their session was outside it. */
    const scanNote = " · collectors scan " + (state.scanWindowHours ?? 36) + "h";
    const emptyByView = {
      /* One board means one empty state, and it has to say the whole thing an
         empty board means: not "nothing needs you" (true, but the smaller
         claim), and not "nothing is waiting" — nothing is LIVE, which the three
         tabs could each only say a third of. */
      board: "Nothing is live" + scanNote + " — every session the board can see has finished. Widen the scan window in Settings to reach older ones.",
      history: "Nothing has finished in the window shown" + scanNote + " — widen the lookback or the scan window in Settings.",
    };
    /* An operator glancing at an empty cockpit must be able to tell "nothing is
       wrong" from "nothing has loaded". Those look identical when the only
       difference is small grey text on a large white field — and on the board,
       empty is the GOOD state and the one they will see most.

       So the all-clear reads as a finding in its own right: a verdict mark, the
       headline at weight, and underneath it the fleet's vital signs with a
       ticking age. The numbers are the proof of life — a board that is still
       loading cannot say "18 live · 6 working" or count seconds since its last
       snapshot. History stays muted prose, because absence there is a filter
       result rather than an answer. */
    /* The all-clear may only render over an EMPTY findings collection, not over
       an empty row list. A board carrying a collector fault and no waiting
       agent rendered a check mark and the words "Nothing needs you" while the
       rail beside it counted the fault. Each surface was correct; the
       composition told the operator to go home.

       Zero live sessions is now said in those words, and the findings that do
       exist are named and pointed at rather than papered over. */
    /* How many sessions the window is holding back — the number that turns
       "showing 6h" from a fact the operator has to interpret into one they can
       act on. Computed once here and read by both the headline and the
       disclosure, so the two cannot disagree about it. */
    const hiddenNow = hiddenByLookback(state);
    const openFindings = state.view === "board" ? issuesOf(state.snap) : [];
    const allClear = state.view === "board" && openFindings.length === 0;
    const wrap = el("div", { class: "no-match" + (allClear ? " is-all-clear" : "") });
    if (state.view === "board") {
      const t = totalsOf(state.snap);
      /* "Nothing is live", not "nothing needs you". An empty Board is a bigger
         claim than an empty Needs-you tab was: this view holds working, waiting
         AND unverified sessions, so reaching it empty means the board can see
         nothing running at all — and saying only the attention half of that
         would leave the operator wondering where the fleet went.

         THE ONE-GLANCE RULE — a working session must be NAMED on the landing
         screen, not merely counted — used to need a roster of names here,
         because the board landed on Needs you and a clear Needs you hid three
         running sessions behind a number. Board cannot do that: a working
         session is a row on the view the operator lands on. The rule is kept by
         the layout now, so the roster it needed is gone rather than rendered
         over a state that by construction has no working sessions in it. */
      wrap.append(
        ...(allClear ? [el("p", { class: "all-clear-mark", "aria-hidden": "true" }, icon("check"))] : []),
        /* THE CLAIM IS QUALIFIED, NOT SOFTENED.

           "Nothing is live" is false whenever the window is shorter than the
           collectors' reach: withinLookback filters on updatedAt recency, so a
           session whose process is alive and which has been waiting on a person
           for eight hours is live and simply outside a 6h view. Saying it flatly
           would conceal exactly the sessions that have been quiet longest —
           which, because the filter keys on quiet time, are the blocked-on-a-
           human rows this board exists to surface.

           So the headline says what was actually measured: nothing is live IN
           THE WINDOW BEING SHOWN. Unqualified only when the window is hiding
           nothing, where the shorter sentence is the true one. */
        el("p", { class: "all-clear-head", text: hiddenNow
          ? "Nothing is live in the last " + lookbackLabel(state.lookbackHours)
          : "Nothing is live" }),
        el("p", { class: "all-clear-vitals" },
          el("span", { text: `${t.tracked} tracked · ${t.live} live` }),
          /* A stalled session is neither working nor done — it is the third
             state, and pulse.ts computes it while nothing rendered it. The
             earlier copy here went further and asserted "every tracked session is
             working or done", which was flatly false on two thirds of the live
             fleet. The claim is gone; this is the number that replaces it. */
          ...(stalledCount(state.snap) ? [
            el("span", { class: "all-clear-sep", "aria-hidden": "true", text: " · " }),
            el("span", { class: "all-clear-quiet", text: stallText(state.snap) }),
          ] : []),
          el("span", { class: "all-clear-sep", "aria-hidden": "true", text: " · " }),
          el("span", {
            dataset: { ago: state.snap.generatedAt },
            text: "checked " + agoText(state.snap.generatedAt),
          })),
        /* The window's own disclosure, and the escape from it.

           Both facts are true at once — the board is all-clear AND it is only
           looking back this far — so both are said. The COUNT is what makes it
           actionable: a bare "showing 6h" leaves the operator to guess whether
           that matters, where "8 sessions are outside it" tells them, and tells
           them the ones most likely to be there are the ones quiet longest.

           Silent when the window hides nothing, because then the headline above
           is unqualified and true, and a standing footnote about a window that
           is holding nothing back is the kind of permanent line that stops
           being read. */
        ...(hiddenNow ? [el("p", { class: "all-clear-window" },
          el("span", {
            text: `${hiddenNow} session${hiddenNow === 1 ? "" : "s"} `
              + `${hiddenNow === 1 ? "is" : "are"} outside this window.`,
          }),
          el("button", {
            type: "button", class: "all-clear-widen",
            dataset: { fkey: "all-clear-widen" },
            "aria-label": `Show everything the collectors have, not only the last ${lookbackLabel(state.lookbackHours)}`,
            onclick: () => setLookbackHours(null),
          }, "Show everything"))] : []),
        /* An all-clear may only render over an EMPTY findings collection, never
           over an empty row list alone. A board carrying a collector fault and
           no live agent used to render a check mark and the words "Nothing
           needs you" while the rail beside it counted the fault: each surface
           was correct, and the composition told the operator to go home. So the
           findings that do exist are named and pointed at instead. */
        ...(allClear ? [] : [el("p", { class: "empty-findings" },
          el("strong", {
            text: openFindings.length === 1 ? "1 open finding" : `${openFindings.length} open findings`,
          }),
          el("span", { text: " in Summary — " + openFindings.slice(0, 2).map((f) => f.title).join(" · ") }))]),
        el("p", { class: "all-clear-note", text: emptyByView.board }));
    } else {
      wrap.append(el("p", { text: emptyByView[state.view] || "Nothing here." }));
    }
    /* The escape hatch has to agree with the sentence above it: with nothing
       live, the only place left holding this operator's work is History. */
    if (state.view !== "history" && tracked) {
      wrap.append(el("button", {
        type: "button", class: "btn",
        dataset: { fkey: "goto-history" },
        onclick: () => setView("history"),
      }, "Open history"));
    }
    root.append(wrap);
  }
}

/* Left-tree program header rollup — the same at-a-glance data as the drawer head
   (programRollupCells is the single aggregation source), rendered as the mono
   .program-rollup cluster A4 established. The alert count takes ember ink
   (is-alerting → --ember) only when alerts exist; calm earns no color. The
   accessible name carries the data itself, extending the drawer's aria pattern. */
function programHeadRollup(agents, rollup = null, opts = {}) {
  let cells = programRollupCells(agents, rollup, opts.snap || state.snap);
  /* Board is the live lens: finished work belongs to the shelf and History,
     and the session-tokens aggregate belongs to Burn and Usage. On the
     measured board "554 ended" was the loudest number on its line, and the
     head's biggest figure was not summable with anything visible below it. */
  if (opts.view === "board") cells = cells.filter((c) => c.label !== "ended" && c.label !== "session tokens");
  const label = "Program rollup: " + cells.map((c) => c.value + " " + c.label).join(", ");
  return el("span", { class: "program-rollup", "aria-label": label },
    cells.map((c) => el("span", { class: "program-rollup-cell" + (c.alert ? " is-alerting" : "") + (c.key ? " program-rollup-cell--" + c.key : "") },
      el("span", { class: "program-rollup-value mono", text: c.value }),
      el("span", { class: "program-rollup-label", text: c.label }))));
}

/* `opts.label` renames the head for a worktree subsection (the repo band above
   it already prints the repository name); `opts.bodyKey` is the paint key its
   rows are reconciled under, which is the section's key rather than the program
   id once a program can appear inside a repo band. Both default to today's
   behavior, so a flat program section is drawn by the same code it always was. */
function renderProgram(program, agents, opts = {}) {
  const open = programOpen(program);
  const bodyId = "program-body-" + program.id;
  /* The header describes the PROGRAM; the body lists the agents the active
     filter kept. Rolling up the filtered list made the header disagree with its
     own drawer — "1 agent" above a program holding 32 — because a filter is a
     lens on the board, not a change to what the program contains. */
  /* An open single-session worktree on the Board carries no rollup at all:
     its one row IS the census, printed 30px below. */
  const soloOpen = opts.bodyKey && state.view === "board" && program.agents.length === 1 && open;
  const rollup = soloOpen ? null : programHeadRollup(program.agents, program.rollup, { view: state.view });
  /* The head counts the whole program while the body lists what the filter
     kept — say so when they differ, on the pattern the board-level scope
     note set, instead of leaving "5 live" over one drawn row unexplained. */
  const shownNote = state.view === "board" && agents.length < program.agents.length
    ? el("span", { class: "head-shown", text: agents.length + " of " + program.agents.length + " shown" })
    : null;

  const label = programName(program, opts.label);
  const aliased = state.aliases.has(presentationLabelKey(programLabelTarget(program)));
  const head = el("div", { class: "program-head" },
    el("button", {
      type: "button",
      class: "program-caret",
      "aria-expanded": String(open),
      "aria-controls": bodyId,
      "aria-label": (open ? "Collapse " : "Expand ") + label,
      dataset: { fkey: "prog:" + program.id },
      onclick: () => toggleProgram(program),
    }, icon("caret")),
    el("button", {
      type: "button",
      class: "program-label",
      "aria-label": "Edit label for " + label,
      dataset: { fkey: "prog-label:" + program.id },
      onclick: () => startRename(programLabelTarget(program)),
    },
      el("span", { class: "program-name", text: label }),
      aliased ? el("span", { class: "program-alias-tag", title: "Source program: " + program.name, text: "label" }) : null),
    el("button", {
      type: "button",
      class: "program-rename",
      "aria-label": "Edit label for " + label,
      dataset: { fkey: "prog-rename:" + program.id },
      onclick: () => startRename(programLabelTarget(program)),
    }, icon("rename")),
    el("button", {
      type: "button",
      class: "program-details",
      "aria-label": "Open program details for " + label,
      dataset: { fkey: "prog-details:" + program.id },
      onclick: () => selectEntity({ kind: "program", id: program.id }),
    }, "Details"),
    shownNote,
    rollup);

  /* Whole literal class strings, for the orphan lint — and a real distinction:
     a banded program is a subsection whose card chrome the band above now
     owns, while a flat program (no resolved repo) is still its own top-level
     section and keeps the card. Both are painted by this one renderer. */
  const section = el("section", {
    class: (opts.bodyKey ? "program is-banded" : "program is-flat") + (open ? " open" : ""),
    "aria-label": label,
  },
    el("h2", { class: "visually-hidden", text: label }),
    head);
  if (state.renaming === presentationLabelKey(programLabelTarget(program))) section.append(renderRenameForm(program));
  // The body is left empty on purpose: renderPrograms reconciles the rows into
  // it by agent id, so a shell rebuild never destroys a row that has not moved.
  const body = el("div", { class: "program-agents", id: bodyId });
  programBodies.set(opts.bodyKey || program.id, body);
  section.append(body);
  return section;
}

function renderRenameForm(program) {
  const target = programLabelTarget(program);
  return renderLabelForm(target, {
    inputKey: "rename-input:" + program.id,
    placeholder: "Display name for this program",
    ariaLabel: "New display name for " + program.name,
    source: "Source program: " + program.name + " · id stays " + program.id,
  });
}

function renderLabelForm(target, opts) {
  const key = presentationLabelKey(target);
  return el("form", {
    class: "rename-form",
    onsubmit: (e) => { e.preventDefault(); submitRename(target); },
  },
    el("input", {
      type: "text",
      value: state.renameDraft,
      maxlength: "80",
      placeholder: opts.placeholder,
      "aria-label": opts.ariaLabel,
      disabled: state.renamePending ? "" : null,
      dataset: { fkey: opts.inputKey || "label-input:" + key },
      oninput: (e) => { state.renameDraft = e.target.value; },
      onkeydown: (e) => { if (e.key === "Escape") { e.preventDefault(); cancelRename(); } },
    }),
    el("button", { type: "submit", class: "btn primary", disabled: state.renamePending ? "" : null, "aria-busy": state.renamePending ? "true" : null, dataset: { fkey: "label-save:" + key } }, state.renamePending ? "Saving…" : "Save"),
    el("button", { type: "button", class: "btn", disabled: state.renamePending ? "" : null, dataset: { fkey: "label-cancel:" + key }, onclick: () => cancelRename() }, "Cancel"),
    state.aliases.has(key) ? el("button", { type: "button", class: "btn", disabled: state.renamePending ? "" : null, dataset: { fkey: "label-reset:" + key }, onclick: () => { state.renameDraft = ""; submitRename(target); } }, "Reset") : null,
    el("span", { class: "rename-source", text: opts.source }),
    state.renameError ? el("p", { class: "rename-error", role: "alert", text: state.renameError }) : null);
}

/* What each lifecycle divider says, and what it is called.

   Two short labels and one sentence: Active and Waiting name a state the
   operator already knows, while Unverified names a gap in what the board can
   SEE, and a bare word there would read as a claim about the sessions rather
   than about the evidence. That sentence is not new copy — it is verbatim what
   the standalone Unverified group shipped with, because it is the honest half
   of the disclosure and the group is now simply one of three sections.

   Class names are whole literal strings rather than a prefix plus the key, so
   the styles.css orphan lint can see them: it reads this file as text, and a
   name assembled at runtime is invisible to it in both directions. */
const SECTION_HEADS = {
  active: { className: "lifecycle-section lifecycle-section--active", label: () => "Active" },
  waiting: { className: "lifecycle-section lifecycle-section--waiting", label: () => "Waiting" },
  unverified: {
    className: "lifecycle-section lifecycle-section--unverified",
    label: (n) => n + " unverified — quiet, with no process found to check",
  },
};

/* The ordered row PLAN for one program: the column header, an optional note for
   the rows that were pinned into the Needs-you strip, then the lifecycle
   sections, each holding its swarm trees. Each descriptor is keyed and carries
   its own signature, so reconcileKeyed rebuilds exactly the rows that moved.
   `build` is a closure — nothing is constructed for a row that has not changed.

   `board` is the once-per-paint fleet index; it is optional so the plan can be
   driven directly in a test with nothing but a program and a ui. */
function agentRowPlan(program, agents, ui = state, board = boardIndex(ui), opts = {}) {
  /* Signal, on the INTERLEAVED surface: a flat program section is not grouped
     by repository, so nothing above these rows says which one they belong to
     and each carries its own 3px tick. A banded row sits inside a tinted card
     that washes it by descent — a tick there would say the same thing twice on
     every line, which is the difference between Whisper and Signal.

     Read once here rather than per row: it is constant for the program, and
     inside the walk below `opts` is shadowed by each row's own options object,
     so reaching for the parameter there is a temporal-dead-zone error rather
     than the value it looks like. The stylesheet drops the tick again on any
     row wearing an attention class, so this is identity offered and status
     taking precedence, never the two mixed. */
  const rowRepoTint = opts.banded ? "" : tintOfProgram(program);
  const visibleIds = new Set(agents.map((agent) => agent.id));
  const programById = new Map(program.agents.map((agent) => [agent.id, agent]));
  const relevantIds = new Set(visibleIds);
  for (const agent of agents) {
    let parentId = agent.parentAgentId;
    const seen = new Set();
    while (parentId && programById.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      relevantIds.add(parentId);
      parentId = programById.get(parentId).parentAgentId;
    }
  }
  const { roots, children } = buildClusters(program.agents.filter((agent) => relevantIds.has(agent.id)));
  const fullById = board.byId;
  // Computed from the WHOLE board, not this program: two twins in different
  // programs are exactly as confusing as two in the same one.
  const ambiguous = board.ambiguous;
  const fullChildren = new Map();
  for (const a of fullById.values()) {
    if (a.parentAgentId) fullChildren.set(a.parentAgentId, [...(fullChildren.get(a.parentAgentId) || []), a.id]);
  }
  const descendantCount = (id, seen = new Set()) => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return (fullChildren.get(id) || []).reduce((total, childId) => total + 1 + descendantCount(childId, seen), 0);
  };
  /* What the caret will actually reveal: descendants this walk draws as rows —
     same program, filter-admitted, not pinned into the strip. `descendantCount`
     above spans the whole board; counting IT on the chip promised rows the
     expansion could not show, and the collapsed-swarm ember could point at a
     child no click here reaches. The chip counts the drawable set; when the
     full swarm is bigger, the label says so instead of lying. */
  const drawnDescendants = (id, seen = new Set()) => {
    if (seen.has(id)) return 0;
    seen.add(id);
    let total = 0;
    for (const child of children.get(id) || []) {
      if (visibleIds.has(child.id) && !pinnedIds.has(child.id)) total += 1;
      total += drawnDescendants(child.id, seen);
    }
    return total;
  };
  const hasDrawnAlertingDescendant = (id, seen = new Set()) => {
    if (seen.has(id)) return false;
    seen.add(id);
    for (const child of children.get(id) || []) {
      if (visibleIds.has(child.id) && !pinnedIds.has(child.id) && stripAlerting(child, ui.snap)) return true;
      if (hasDrawnAlertingDescendant(child.id, seen)) return true;
    }
    return false;
  };

  /* Rows that went to the strip. They are drawn there and NOT here: one row per
     session, so `agent:<id>` stays a unique focus key, arrow navigation visits
     each session once, and the operator can never act on the row they think is
     the other one. What stays behind is a count, below.

     Board only, and that is not a stylistic choice: the strip renders on Board,
     so on any other view this would remove a row from the only place it is
     drawn. A finished session whose process is somehow still running satisfies
     alerting(), and it would have silently disappeared out of History. Pane
     mode only, for the same reason: inline mode draws no strip, so pinning a
     row away here would remove it from the only place it is drawn. */
  const pinnedIds = ui.view === "board" && needsYouDisplayOf(ui) === "pane"
    ? new Set(agents.filter((agent) => stripAlerting(agent, ui.snap)).map((agent) => agent.id))
    : new Set();

  /* Inline mode's row-level signal. The strip used to BE the signal; with it
     off, membership itself must mark the row — outcome ink alone misses the
     hook-needsInput shape that dominates the live set, and six sessions asking
     for a person would render as six ordinary Waiting rows. Board only,
     exactly like pinnedIds and for the same reason. */
  const markAlerting = ui.view === "board" && needsYouDisplayOf(ui) === "inline";

  /* A banded worktree draws no column header of its own — the band above it
     draws the one copy for all its worktrees. The flat path keeps its own,
     because a flat program IS its own band. */
  // The view is in the sig: Board and History label the fifth column differently.
  const plan = opts.banded ? [] : [{ key: "columns", sig: "columns:" + ui.view, build: renderAgentColumnHeader }];

  const appendTree = (agent, depth) => {
    const visibleDescendants = (fullChildren.get(agent.id) || [])
      .filter((id) => relevantIds.has(id) && !pinnedIds.has(id)).length;
    const pinned = pinnedIds.has(agent.id);
    if (visibleIds.has(agent.id) && !pinned) {
      /* A swarm parent draws its own children only when the operator has opened
         it. `swarmOpen` is the whole gate: the plan simply does not walk the
         subtree otherwise, so collapsed children are absent from the DOM rather
         than hidden in it — which is what takes them out of `navigableRows` and
         out of Tab order at the same time, with no second rule to keep in step. */
      const childCount = drawnDescendants(agent.id);
      const open = childCount > 0 && swarmOpen(agent, ui);
      const opts = {
        depth,
        childCount,
        fullChildCount: descendantCount(agent.id),
        fullById,
        ambiguousNames: ambiguous,
        sharedNames: board.sharedNames,
        swarmOpen: open,
        /* Ember on the chip when something folded up inside is asking for a
           person — restricted to descendants this expansion can actually draw.
           A pinned alerting child is already in plain sight in the strip, and a
           filter-excluded one was excluded explicitly; an ember that promises
           "open me and see" must only fire when opening shows it. */
        swarmAlerting: !open && hasDrawnAlertingDescendant(agent.id),
        alerting: markAlerting && stripAlerting(agent, ui.snap),
        /* Rank inside this section's hot prefix, or "" for anything the sort
           did not rank — calm rows, and swarm children, which are drawn under
           their parent rather than in the queue. */
        alertRank: hotRanks.has(agent.id) ? hotRanks.get(agent.id) : "",
        repoTint: rowRepoTint,
      };
      plan.push({
        key: "row:" + agent.id,
        sig: agentRowSig(agent, ui, opts),
        build: () => renderAgentRow(agent, program, opts),
      });
      if (!open) return;
    } else if (visibleDescendants > 0) {
      /* The parent is not drawn as a row — it is pinned into the strip, or the
         filter never admitted it — but its children are. The anchor keeps the
         workstream attached to a name instead of leaving orphans indented under
         nothing. Its focus key is distinct from the row's, so a pinned parent
         with an anchor here does not give one session two `agent:<id>` keys and
         send focus restore to the wrong one.

         Children under an anchor are always drawn, collapsed or not, and that
         is not the auto-expand Stage 2 forbids: the caret lives on the parent's
         ROW, and there is no parent row in this group to carry one. Hiding them
         behind a control that is not on screen would strand them. */
      plan.push({
        key: "anchor:" + agent.id,
        sig: swarmAnchorSig(agent, depth, visibleDescendants, ui, pinned, board),
        build: () => renderSwarmAnchor(agent, depth, visibleDescendants, pinned, board),
      });
    } else {
      // Pinned, with nothing underneath it to hold together: the count above
      // already says it is in the strip, so it leaves no residue here.
      return;
    }
    for (const child of children.get(agent.id) || []) appendTree(child, depth + 1);
  };

  /* Stable lifecycle sections: Active, then Waiting, then Unverified, in that
     order every paint whether or not each one has rows. Empty sections are
     elided — a divider over nothing is a divider that teaches the operator to
     stop reading dividers — and the heads are labels, not controls: they add no
     focus stop and nothing about them can be toggled into a state that hides a
     session.

     Sections are assigned by a ROOT's own state, and its children stay under it
     wherever it lands. A swarm whose parent is working and whose verifier has
     gone quiet is one workstream, and splitting it across two headings to keep
     the headings pure tells the operator a story that is not happening.

     Roots that match no section — an ancestor the filter did not admit, pulled
     in to hold a tree together — lead, unlabelled. There is no honest heading
     for "not one of these three", so none is printed. */
  const buckets = new Map(LIFECYCLE_SECTIONS.map((key) => [key, []]));
  const unsectioned = [];
  for (const agent of roots) {
    const bucket = buckets.get(lifecycleSection(agent));
    if (bucket) bucket.push(agent);
    else unsectioned.push(agent);
  }

  /* The third level of the new hierarchy: inside a worktree, roots read in the
     order the roster established — whoever OWNS the work first, the unknown
     fallback last — instead of arriving in whatever order a rank over activity
     produced. It sorts WITHIN each lifecycle section, never across them: a
     section says what these rows are doing, and reordering across one would
     make the heading a lie.

     Applied only where the hierarchy is. `groupPath` is the server saying this
     program IS a worktree; a program it could not resolve a repo for keeps the
     server's agentSortRank order exactly, which is what makes that section a
     true regression gate rather than one that merely looks unchanged.
     Alert-first ordering (below) is the one licensed exception; calm rows
     still hold the server's order.

     A stable sort by role alone is the whole implementation — the server
     already sorted the program by agentSortRank, so ties keep that order and
     the client never re-derives a rank the server owns. */
  if (program.groupPath) {
    const byRole = (list) => list.sort((left, right) => roleRank(left) - roleRank(right));
    byRole(unsectioned);
    for (const bucket of buckets.values()) byRole(bucket);
  }

  /* Alert-first, stable, WITHIN each section — never across one: the heading
     states what its rows are doing, and an alerting Waiting row that climbed
     into Active would make that sentence a lie. Runs AFTER byRole so the later
     stable sort is the primary key: an alerting worker outranks a calm
     orchestrator. Applies to EVERY program, which means a non-worktree section
     no longer keeps the server's agentSortRank byte-for-byte when it contains
     an alerting row — that reordering is the feature: it does the deleted
     wash's findability job. Ties keep the server's order (stability), so alert
     order is the server's order, not recency. Membership is the PRESENTED
     membership — stripAlerting, the same predicate the strip and the row's
     is-alerting class read — so an acknowledged row never rises with a muted
     word.

     Then recency INSIDE that hot prefix, newest ask first, keyed on
     `alertSince` and on nothing else — see alertRecent. A section's calm rows
     are untouched by it, and no row crosses a section boundary: a Waiting alert
     that climbed into Active would still make the heading a lie however recent
     it is. */
  const sectionHot = (a) => stripAlerting(a, ui.snap);
  const sinceOf = (a) => a.alertSince;
  /* Where each hot row sits in the list it was just sorted into — the stamp the
     float compares across a paint. Recomputing it from any other list would let
     the sort and the flight disagree, which is the teleport this closes. Ranked
     per section, because that is the list the operator's eye follows. */
  const hotRanks = new Map();
  const rankHot = (list) => {
    for (let i = 0; i < list.length && sectionHot(list[i]); i += 1) hotRanks.set(list[i].id, i);
  };
  alertFirst(unsectioned, sectionHot);
  alertRecent(unsectioned, sectionHot, sinceOf);
  rankHot(unsectioned);
  for (const bucket of buckets.values()) {
    alertFirst(bucket, sectionHot);
    alertRecent(bucket, sectionHot, sinceOf);
    rankHot(bucket);
  }

  /* Exactly what appendTree will put on screen for this root: its own row, or
     an anchor holding children that are still drawn. Mirroring the walk rather
     than approximating it is what stops a heading rendering over nothing — a
     section whose only member was pinned into the strip, or whose only relevant
     descendant was, draws no rows and therefore prints no heading. */
  const draws = (agent) =>
    (visibleIds.has(agent.id) && !pinnedIds.has(agent.id))
    || (fullChildren.get(agent.id) || []).some((id) => relevantIds.has(id) && !pinnedIds.has(id));

  for (const agent of unsectioned) appendTree(agent, 0);
  /* A divider over the only populated section divides nothing: eight of the
     eleven dividers on the measured board sat alone over a single run of
     rows, each spending a line to restate what every row's own status cell
     already says. The unverified head is exempt — its sentence is a
     disclosure about what the board can SEE, not a state word the rows
     repeat — and any unsectioned rows above keep the divider too, because
     then it genuinely separates two populations. */
  const drawnSections = LIFECYCLE_SECTIONS.map((key) => [key, buckets.get(key).filter(draws)]);
  const populated = drawnSections.filter(([, drawn]) => drawn.length).length;
  const soloRoutine = populated === 1 && !unsectioned.filter(draws).length;
  for (const [key, drawn] of drawnSections) {
    if (!drawn.length) continue;
    if (!(soloRoutine && key !== "unverified")) {
      plan.push({
        key: "section:" + key,
        sig: "section:" + key + ":" + drawn.length,
        build: () => el("p", {
          class: SECTION_HEADS[key].className,
          // A label, not a heading: the rows below already carry their whole
          // state in their own aria-label, and a heading level here would put a
          // second, coarser navigation tree over the one the operator uses.
          role: "presentation",
        }, el("span", { text: SECTION_HEADS[key].label(drawn.length) })),
      });
    }
    for (const agent of drawn) appendTree(agent, 0);
  }

  /* The Finished shelf, last and folded up.

     These rows are NOT in `agents` — the active view excluded them, which is
     exactly why they need saying. A worktree header rolls up the whole program
     (4 agents) while its body drew the two that are still live, and nothing on
     screen distinguished "the other two finished" from "the other two are
     hidden by your search". One collapsed line with a count does.

     Collapsed by default and drawn at the bottom, because finished work is
     context rather than a call to action, and this board's whole diet is about
     not spending live space on it. Nothing can hide inside it that the operator
     needs: an alerting session is pinned to the strip above, and a session
     still asking for a person is by definition not finished. */
  const shelved = (opts.finished || []).filter((agent) => !pinnedIds.has(agent.id));
  if (shelved.length) {
    const open = shelfOpen(program, ui);
    plan.push({
      key: "shelf",
      sig: "shelf:" + shelved.length + ":" + (open ? "open" : "shut"),
      build: () => renderFinishedShelf(program, shelved.length, open),
    });
    if (open) {
      for (const agent of shelved) {
        const rowOpts = {
          depth: 0,
          childCount: 0,
          fullById,
          ambiguousNames: ambiguous,
          sharedNames: board.sharedNames,
        };
        plan.push({
          key: "row:" + agent.id,
          sig: agentRowSig(agent, ui, rowOpts),
          build: () => renderAgentRow(agent, program, rowOpts),
        });
      }
    }
  }
  return plan;
}

function shelfOpen(program, ui = state) {
  return Boolean(ui.shelfOverrides && ui.shelfOverrides.get(program.id) === "open");
}

function toggleShelf(program) {
  if (shelfOpen(program)) state.shelfOverrides.delete(program.id);
  else state.shelfOverrides.set(program.id, "open");
  saveShelfOverrides();
  render();
}

function renderFinishedShelf(program, count, open) {
  return el("button", {
    type: "button",
    class: "finished-shelf" + (open ? " is-open" : ""),
    "aria-expanded": String(open),
    "aria-label": (open ? "Collapse " : "Expand ")
      + count + (count === 1 ? " finished session in " : " finished sessions in ")
      + programName(program),
    dataset: { fkey: "shelf:" + program.id },
    onclick: () => toggleShelf(program),
  },
    el("span", { class: "finished-shelf-caret", "aria-hidden": "true" }, icon("caret")),
    el("span", { class: "finished-shelf-label", text: "Finished" }),
    el("span", { class: "finished-shelf-count mono", text: String(count) }));
}

/* Where a role sits in the reading order the drawer's roster established.
   Anything the catalog does not know — including a role a newer server sends
   that this client has not learned yet — sorts last rather than first, so an
   unknown word can never displace the orchestrator at the top of a worktree. */
function roleRank(agent) {
  const index = ROSTER_ROLE_ORDER.indexOf(roleView(agent.role).key);
  return index === -1 ? ROSTER_ROLE_ORDER.length : index;
}

function renderAgentColumnHeader() {
  // Identity on the left, the right-aligned instrument cluster on the right:
  // status, harness, model, ctx%, tokens, elapsed. Harness is text-labeled
  // (not icon-only) so the column is scannable and filterable.
  return el("div", {
    class: "agent-grid agent-column-header",
    "aria-label": "Agent list columns",
    "aria-colcount": "7",
  },
    el("span", { class: "agent-column-label", text: "Agent/message" }),
    el("span", { class: "agent-column-label ri-col-label", text: "Status" }),
    el("span", { class: "agent-column-label ri-col-label", title: "Where this session ran (harness \u2260 agent)", text: "Harness" }),
    el("span", { class: "agent-column-label ri-col-label", text: "Model" }),
    el("span", { class: "agent-column-label ri-col-label", text: "Ctx" }),
    el("span", { class: "agent-column-label ri-col-label", text: "Tokens" }),
    /* "Span", not "Elapsed". The value is updatedAt − startedAt: first touch to
       last touch, with every dormant hour inside it. One agent reads 87.1 days
       and the arithmetic is CORRECT — startedAt really is 2026-05-06 — but
       "Elapsed" beside a row invites "this has been grinding for three months",
       which overstates actual activity by roughly 204x. 19 agents exceed 36
       hours on this board and 8 exceed 30 days.

       This is the sessionTotal disease in a different column: a true number whose
       label claims something else. The number is not wrong, so the fix is the
       word, not the maths. */
    state.view === "board"
      /* Board: QUIET, the staleness fact the row used to whisper only into
         its aria-label while SPAN — a number whose own tooltip disclaims it —
         held the terminal scan position. Span stays on History, where a
         total duration is the point. */
      ? el("span", {
        class: "agent-column-label ri-col-label",
        title: "Time since the session last changed — blank means fresh",
        text: "Quiet",
      })
      : el("span", {
        class: "agent-column-label ri-col-label",
        title: "First activity to last activity, dormancy included — not time spent working",
        text: "Span",
      }),
    /* The docked roster's label (#158). With the inspector open the row's
       instruments collapse into a two-line stack in one 12.5rem track, so seven
       column labels no longer sit above seven columns — this one prints the two
       lines the rows actually draw. Always in the DOM, hidden by CSS until the
       inspector docks: `hidden` would be wrong here, because this file's
       [hidden] rule is deliberately !important so nothing can un-hide what the
       client hid. It carries the SAME Quiet/Span word the seventh column chose,
       because a label that disagrees with its own column is worse than none. */
    el("span", {
      class: "agent-column-label ri-col-label ri-col-stack",
      title: "Status and " + (state.view === "board" ? "quiet time" : "span") + " over model, context and tokens",
    },
      el("span", { text: "Status · " + (state.view === "board" ? "Quiet" : "Span") }),
      el("span", { text: "Model · Ctx · Tokens" })));
}

function renderSwarmAnchor(agent, depth, activeChildren, pinned = false, board = {}) {
  /* A pinned parent already owns `agent:<id>` on its strip row. Two nodes
     answering to one focus key means render()'s restore-by-fkey lands on
     whichever the document happens to hold first, so the anchor takes its own. */
  const fkey = (pinned ? "swarm-anchor:" : "agent:") + agent.id;
  const where = pinned
    ? "This session is pinned in Needs you, above."
    : "This session is outside the current filter.";
  return el("button", {
    type: "button",
    class: "swarm-anchor" + (depth > 0 ? " is-child depth-" + Math.min(depth, 4) : ""),
    dataset: { fkey, depth: String(depth) },
    onclick: () => selectAgent(agent.id),
    "aria-label": `${agentName(agent)} parent session. ${where} ${activeChildren} visible child sessions. Open parent details.`,
  },
    harnessAgentMarks(agent),
    /* The name its own row would print. The anchor stands in for a parent that
       is off screen, so it is frequently the ONLY place that name appears — and
       it was printing `identity.name`, hex and all, beside rows that print the
       words alone. */
    el("strong", { text: displayNameWithTag(agent, board) }),
    el("span", { text: `${activeChildren} active ${activeChildren === 1 ? "branch" : "branches"}` }),
    el("span", { class: "swarm-anchor-arrow", "aria-hidden": "true", text: "⌄" }));
}

function rowSummary(agent) {
  return rowSummaryParts(agent).primary;
}

/* Machine data that survived cleaning. Same pattern as the server's
   readableClosingText: a closing that is JSON / a diff hunk / a log line
   is not something the roster should quote. */
const ROW_MACHINE_TEXT = /\{"|"\}|":\s*"|\[\{|\}\]|^\s*[+-]{3}\s|\b[\w./-]+:\d+:\d+\b|\{\s*\w+\s*=|\w+="[^"]*"/;
/* Codex appends a citation trailer to an otherwise readable close. */
const ROW_CITATION_TRAILER = /<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gi;
const ROW_CITATION_LEFTOVER = /<\/?(?:oai-mem-citation|citation_entries|citation_entry|rollout_ids|rollout_id)\b[^>]*>/gi;

function stripRowMachineTrailer(value) {
  return String(value || "")
    .replace(ROW_CITATION_TRAILER, " ")
    .replace(ROW_CITATION_LEFTOVER, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.…\s]+/, "")
    .trim();
}

function humanReadableAgentText(value) {
  let text = stripRowMachineTrailer(value);
  /* End-anchored Codex closes often start INSIDE the citation trailer, so
     there is no opening tag to strip — only MEMORY.md:N|note=[…] residue. */
  const cite = text.search(/MEMORY\.md\b|\|note=\[|oai-mem-citation|citation_entries|rollout_ids/i);
  if (cite !== -1) text = text.slice(0, cite).replace(/[<\s\[\|]+$/, "").trim();
  if (!text) return "";
  if (ROW_MACHINE_TEXT.test(text)) return "";
  if (/<\/?\w/.test(text)) return "";
  if (/^[\w./-]+\.(md|ts|js|mjs|json|html)\)?\.?$/i.test(text)) return "";
  if (text.length < 28 && (/\]$/.test(text) || !/\s/.test(text))) return "";
  return text;
}

function rowClosingText(agent) {
  const closing = humanReadableAgentText(agent.lastAgentClosing);
  if (closing) return closing;
  const spoken = humanReadableAgentText(agent.lastAgentMessage);
  if (spoken) return spoken;
  return "";
}

function previewChatBody(value) {
  if (typeof value !== "string") return "";
  const text = value.replace(/^\n+|\n+$/g, "");
  return text.trim() ? text : "";
}

function previewAssistantText(agent) {
  return previewChatBody(agent.lastAgentChatBody) || rowClosingText(agent) || agent.lastAgentMessage;
}

function previewUserText(agent) {
  return previewChatBody(agent.lastUserChatBody) || agent.lastUserMessage;
}

function rowSummaryParts(agent) {
  const closing = rowClosingText(agent);
  if (closing) return { primary: conciseText(closing, 160), kickoff: "" };
  /* Kickoff is a fallback for the one line, never a second line. */
  const task = agent.task ? withoutSenderHeader(agent.task).trim() : "";
  if (task) return { primary: conciseText(task, 120), kickoff: "" };
  const message = formatLastHumanMessage(agent);
  if (message !== NO_READABLE_MESSAGE && !ROW_MACHINE_TEXT.test(message)) {
    return { primary: message, kickoff: "" };
  }
  if (agent.statusReason) {
    const reason = humanReadableAgentText(agent.statusReason);
    if (reason) return { primary: conciseText(reason, 120), kickoff: "" };
  }
  return { primary: NO_READABLE_MESSAGE, kickoff: "" };
}
/* Codex uses the official ChatGPT/Codex app mark (raster, own background);
   the others are single-color SVG marks that ride in the neutral badge. */
const PROVIDER_MARK = {
  openai: { src: "/icons/openai.svg" },
  claude: { src: "/icons/claude.svg" },
  spark: { src: "/icons/muse.svg" },
  gemini: { src: "/icons/gemini.svg" },
  grok: { src: "/icons/grok.svg" },
  xai: { src: "/icons/xai.svg" },
  cursor: { src: "/icons/cursor.svg" },
  prime: { src: "/icons/prime-orch.svg" },
  factory: { src: "/icons/factory.svg" },
  omp: { src: "/icons/omp.svg" },
  muse: { src: "/icons/muse.svg" },
  copilot: { src: "/icons/copilot.svg" },
  antigravity: { src: "/icons/antigravity.png", raster: true },
};

/* Harness vs Agent — two badges per row. Harness = where it ran (provider), Agent = what thought (model family).
   This keeps the harness visible even when the model overrides the icon (the old spark/grok swap hid the harness). */
const HARNESS_MARK = {
  codex: { src: "/icons/codex.webp", label: "Codex", raster: true },
  claude: { src: "/icons/claude-code.svg", label: "Claude Code" },
  cursor: { src: "/icons/cursor.svg", label: "Cursor" },
  factory: { src: "/icons/factory.svg", label: "Factory" },
  prime: { src: "/icons/prime-orch.svg", label: "Prime" },
  omp: { src: "/icons/omp.svg", label: "OMP" },
  grok: { src: "/icons/xai.svg", label: "Grok Build" },
  hermes: { src: "/icons/formic-mark.svg", label: "Hermes" },
  muse: { src: "/icons/muse.svg", label: "Muse Code" },
  antigravity: { src: "/icons/antigravity.png", label: "Antigravity", raster: true },
  copilot: { src: "/icons/copilot.svg", label: "Copilot CLI" },
  omni: { src: "/icons/omp.svg", label: "OMP" },
};
const AGENT_MARK = {
  spark: { src: "/icons/muse.svg", label: "Muse Spark" },
  grok: { src: "/icons/grok.svg", label: "Grok" },
  claude: { src: "/icons/claude.svg", label: "Claude" },
  openai: { src: "/icons/openai.svg", label: "OpenAI" },
  cursor: { src: "/icons/cursor.svg", label: "Cursor" },
  sol: { src: "/icons/openai.svg", label: "Sol" },
  luna: { src: "/icons/openai.svg", label: "Luna" },
  gemini: { src: "/icons/gemini.svg", label: "Gemini" },
};

function harnessKeyOf(agent) {
  const p = (agent.provider || "").toLowerCase();
  if (p === "codex") return "codex";
  if (p === "claude") return "claude";
  if (p === "cursor") return "cursor";
  if (p === "factory") return "factory";
  if (p === "prime") return "prime";
  if (p === "omp") return "omp";
  return p || "claude";
}
function agentKeyOf(agent) {
  const m = (agent.model || "").toLowerCase();
  if (/grok/i.test(m)) return "grok";
  if (/muse-spark|spark/i.test(m)) return "spark";
  if (/gemini/i.test(m)) return "gemini";
  if (/fable|opus|sonnet|haiku/i.test(m)) return "claude";
  if (/composer/i.test(m)) return "cursor";
  if (/sol|luna/i.test(m)) return "sol";
  if (/codex|openai/i.test(m)) return "openai";
  return "";
}
function harnessMark(agent) {
  const key = harnessKeyOf(agent);
  const meta = HARNESS_MARK[key];
  const label = meta?.label || providerLabel(agent.provider);
  const mark = meta;
  if (!mark || !mark.src) return el("span", { class: "provider-mark provider-mark-text harness-mark", title: label, "aria-label": "Harness " + label, text: label.slice(0, 1) });
  return el("img", { class: "provider-mark harness-mark" + (mark.raster ? " provider-mark-raster" : ""), src: mark.src, alt: label, title: "Harness " + label });
}
function agentMark(agent) {
  const key = agentKeyOf(agent);
  if (!key) return el("span", { class: "provider-mark provider-mark-text agent-mark is-empty", title: "no agent model", "aria-label": "Agent not reported", text: "?" });
  const meta = AGENT_MARK[key];
  const mark = PROVIDER_MARK[key] || meta;
  const label = meta?.label || key;
  if (!mark || !mark.src) return el("span", { class: "provider-mark provider-mark-text agent-mark", title: label, "aria-label": "Agent " + label, text: label.slice(0, 1) });
  return el("img", { class: "provider-mark agent-mark" + (mark.raster ? " provider-mark-raster" : ""), src: mark.src, alt: label, title: "Agent " + label });
}
function instanceHomeOf(agent) {
  return typeof agent.instanceLabel === "string" ? agent.instanceLabel.trim() : "";
}

function harnessAgentMarks(agent) {
  const h = harnessMark(agent);
  const a = agentMark(agent);
  const home = instanceHomeOf(agent);
  const harnessName = HARNESS_MARK[harnessKeyOf(agent)]?.label || providerLabel(agent.provider);
  return el("span", {
    class: "dual-marks" + (home ? " has-instance-home" : ""),
    role: "group",
    "aria-label": "Harness " + harnessName + (home ? " " + home : "") + ", Agent " + (modelShort(agent.model) || "not reported"),
  },
    h, a,
    home ? el("span", { class: "instance-home", title: "Agent home " + home, text: home }) : null);
}

function providerMark(agent) {
  // Legacy single-badge path — kept for old snapshots/tests. The row now uses harnessAgentMarks().
  const grok = /grok/i.test(agent.model || "");
  const spark = /muse-spark|spark/i.test(agent.model || "");
  const key = grok ? "grok" : spark ? "spark" : agent.provider === "codex" ? "openai" : agent.provider;
  const label = grok ? "Grok" : spark ? "Muse Spark" : agent.provider === "codex" ? "OpenAI Codex" : agent.provider === "claude" ? "Anthropic Claude" : providerLabel(agent.provider);
  const mark = PROVIDER_MARK[key];
  if (!mark) {
    return el("span", { class: "provider-mark provider-mark-text", title: label, "aria-label": label, text: label.slice(0, 1) });
  }
  return el("img", { class: "provider-mark" + (mark.raster ? " provider-mark-raster" : ""), src: mark.src, alt: label, title: label });
}

// Shared control vocabulary for row and control-surface state.
const CONTROL_ICONS = { linked: "linked", quarantined: "quarantine", "observed-only": "observed" };

/* What the Status cell should say, given the tab the operator is already in.

   Audit §7: with the Now tab active, all six in-viewport rows printed "Working"
   — a column where every cell carries the same word is not a signal, and it was
   consuming the roster's scarcest space to restate the choice the operator had
   just made. viewMatches pins working/idle/history to exactly one activity, so
   in those views the activity is guaranteed by the tab itself.

   The cell speaks what the tab does NOT guarantee: an exceptional outcome
   always, and the activity only where a view genuinely mixes them and the row is
   not the dominant case. Healthy working rows in Now say nothing. */
const ACTIVITY_PINNED_VIEWS = new Set(["waiting", "history"]);

function rowStateWords(activity, outcome, view, agent, alertMuted = false, nowMs = Date.now(), thresholdMs = DEFAULT_STALL_THRESHOLD_MS) {
  if (agent) {
    const words = [];
    const shown = operatorState(agent, nowMs, thresholdMs, alertMuted);
    if (shown === "needs-you") words.push(OPERATOR_STATE_LABELS["needs-you"]);
    else if (shown === "stalled") words.push(OPERATOR_STATE_LABELS.stalled);
    else if (shown === "done" && view !== "history") words.push(OPERATOR_STATE_LABELS.done);
    else if (shown === "working" && view !== "now" && view !== "working") words.push(OPERATOR_STATE_LABELS.working);
    else if (shown === "waiting" && view !== "waiting") words.push(OPERATOR_STATE_LABELS.waiting);
    if (outcome === "blocked") words.push(OUTCOME_LABELS.blocked);
    if (outcome === "failed") words.push(OUTCOME_LABELS.failed);
    return words;
  }
  const words = [];
  if (!ACTIVITY_PINNED_VIEWS.has(view) && activity !== "working") {
    words.push(ACTIVITY_LABELS[activity] || activity);
  }
  if (outcome !== "healthy" && !(alertMuted && outcome === "needs-you")) {
    words.push(OUTCOME_LABELS[outcome] || outcome);
  }
  return words;
}

/* The roster's copy of the name, with the program suffix removed.

   Audit §9: .agent-name renders at 15px/700 and on a real board four of six rows
   carried the identical string, because sourceAgentName ends in the working
   directory and every row in a program shares it — while the session tag, the
   only value that differs, sat below at 10.5px/400/muted. Scanning meant reading
   the faintest element on each row while the loudest repeated the program header
   directly above it.

   Stripped only when the name genuinely ends in " · <program>", so a cmux-titled
   session ("⠐ Deploy backend fixes via Codex") is untouched, and never below one
   remaining word. The full name stays in the row's title and aria-label. */
function rosterName(displayName, program) {
  const full = String(displayName || "");
  const suffix = " · " + programName(program);
  if (!program || !full.endsWith(suffix)) return full;
  const trimmed = full.slice(0, -suffix.length).trim();
  return trimmed || full;
}

/* The authoritative context percentage for ONE agent.

   The server computes contextPct per agent (392 of 432 carry it on the live
   board) and the client was recomputing its own from tokens.total via
   contextUsage. They agree today — measured, 0 disagreements — but that is the
   dangerous kind of agreement: two derivations that happen to match. The client
   walk also accepts ONLY latest-turn scope, so it can suppress a reading the
   server considers authoritative.

   It matters now rather than eventually: token accounting is being corrected
   server-side (a session reporting 391.4M when ~99% of that magnitude is cache
   re-reads), and tokens.total is exactly the input the client walk divides by. A
   corrected contextPct beside an uncorrected client recomputation is the same
   seam that produced the needsYou mess, one field over. Server first; the walk
   stays for the absolute figures it alone can build. */
function agentContextPct(agent) {
  if (agent && Number.isFinite(agent.contextPct)) return agent.contextPct;
  const walked = contextUsage(agent && agent.tokens);
  return walked ? walked.pct : null;
}

/* ---------- history provenance ----------

   Two different endings, and the board already knew the difference: `scope`
   says whether the board is still watching a session, and `provenance` says
   what ended it. Those two fields are the whole model, and this is them said on
   the row.

     Archived by you   — you made this decision. It is undoable (Un-archive in
                         the dock) and the record is complete.
     Retained history  — nobody decided anything. The source record aged out of
                         the scan window, so the board is holding a read-only
                         copy and will learn nothing more about it.

   Rendered wherever the fact is true rather than only on the History tab: an
   alerting session that alerting() rescues onto the board is still a retained
   record, and printing it there is how the operator learns why its controls are
   dead. Returns null on every live row, which is nearly all of them. */
/* Class names spelled out rather than composed, for the same reason the context
   pressure classes are: the styles.css orphan lint reads this file as text, and
   a name built by concatenation is invisible to it in both directions. */
function historyProvenance(agent) {
  if (scopeOf(agent) === "retained") {
    return {
      key: "retained",
      className: "history-chip history-chip--retained",
      label: "Retained history",
      title: "The source record for this session left the scan window, so the board holds a read-only copy of it. Nobody archived it, and nothing more will be learned about it.",
    };
  }
  if (lifecycleOf(agent) === "finished" && provenanceOf(agent) === "operator-archive") {
    return {
      key: "archived",
      className: "history-chip history-chip--archived",
      label: "Archived by you",
      title: "You archived this session. Un-archive in the command dock puts it back on the board.",
    };
  }
  return null;
}

/* Spread into the row's tag line — an array so "no chip" costs nothing rather
   than leaving a null in the child list. Dashed for retained (the board is not
   asserting an ending, only recording that it stopped watching), solid for the
   ending an operator actually chose. */
/* The declared task state, said on the row.

   Parking is a statement about the ASSIGNMENT, and deliberately not about the
   process — the contract keeps it out of lifecycle.ts entirely, so a parked lane
   is still `waiting`, still has live controls, and still reads "Waiting" in its
   status column. That leaves an operator looking at a row that went quiet with
   nothing on screen saying why, which is the same missing sentence the Finished
   shelf exists to supply one level up.

   Quiet on purpose: this is context, not a call to action. A parked lane is the
   one thing on this board that is quiet BECAUSE someone decided it should be.

   `done` is here too even though a done lane normally leaves for the shelf — it
   comes back the moment it asks a question, and a row returning from the shelf
   with no explanation is worse than one that says what it is.

   Whole class-name string literals, for the reason historyProvenance gives. */
const TASK_STATE_CHIPS = {
  parked: {
    label: "Parked",
    title: "This lane was stood down by whoever is running it. Its session is still live — parking is about the work, not the process — and it returns here the moment it asks a question.",
  },
  done: {
    label: "Done",
    title: "This lane reported its assignment complete. Its session is still live, so it can be given more work; it is off the live rows because it is not waiting on anything.",
  },
};

function taskStateChips(agent) {
  const chip = agent && agent.taskStateSource ? TASK_STATE_CHIPS[agent.taskState] : null;
  if (!chip) return [];
  return [el("span", {
    class: "task-state-chip",
    title: chip.title,
    text: chip.label,
  })];
}

function historyChips(agent) {
  const provenance = historyProvenance(agent);
  if (!provenance) return [];
  return [el("span", {
    class: provenance.className,
    title: provenance.title,
    text: provenance.label,
  })];
}

function renderRowTimeBand(agent, nowMs, thresholdMs, alertMuted) {
  const band = rowTimeBand(agent, nowMs, thresholdMs, alertMuted);
  if (!band) return null;
  if (band.kind === "doing") {
    return el("span", { class: "row-time-band is-working" },
      // Phase-offset copy of one artwork: same-URL <img>s share an animation
      // clock, so the phase in the URL is what keeps rows out of lockstep.
      el("img", {
        class: "row-time-relay",
        src: "/icons/forager-relay-" + band.phase + ".svg",
        alt: "",
        "aria-hidden": "true",
        width: "14",
        height: "14",
      }),
      el("span", { class: "row-time-band-verb", text: band.verb }),
      agent.workingSince
        ? el("span", {
          class: "row-time-band-clock",
          text: band.duration,
          dataset: { workingSince: agent.workingSince },
        })
        : null);
  }
  return el("span", { class: "row-time-band is-" + band.tone },
    el("span", {
      class: "row-time-band-clock",
      text: band.age,
      dataset: agent.lastThreadAt ? { compactAgo: agent.lastThreadAt } : undefined,
    }));
}

function renderAgentRow(agent, program, opts = {}) {
  const activity = deriveActivity(agent);
  const outcome = deriveOutcome(agent);
  const alertMuted = ackedAgent(agent, state.snap);
  const presentedOutcome = alertMuted && outcome === "needs-you" ? "healthy" : outcome;
  const nowMs = state.snap && Date.parse(state.snap.generatedAt);
  const thresholdMs = stallThresholdMs(state.snap);
  const opState = operatorState(agent, Number.isFinite(nowMs) ? nowMs : Date.now(), thresholdMs, alertMuted);
  const opLabel = opState ? OPERATOR_STATE_LABELS[opState] : null;
  const control = deriveControlState(agent);
  const watchOnly = watchOnlyMark(control, agent);
  const role = roleView(agent.role);
  const selected = state.selectedId === agent.id;
  const clusterNote = swarmNote(agent, opts);
  const summaryParts = rowSummaryParts(agent);
  const summary = summaryParts.primary;
  const description = [clusterNote, summary].filter(Boolean).join(" · ");
  // Status column shows the activity word colored by state (the color already
  // encodes working/idle/ended, so no separate dot), with any alert suffix on
  // its own red span. Full state stays in the tooltip + row aria-label.
  const stateText = (opLabel || ACTIVITY_LABELS[activity])
    + (presentedOutcome !== "healthy" && presentedOutcome !== "needs-you" ? " · " + OUTCOME_LABELS[presentedOutcome] : "");

  const nameTarget = preferredRenameTarget(agent);
  const nameKey = presentationLabelKey(nameTarget);
  const editing = state.renaming === nameKey;
  const displayName = agentName(agent);
  /* The server publishes `base` and `disambiguator` as separate fields, and the
     row is the reason they are separate. `identity.name` is the two already
     joined — correct as one unique string for search, logs and aria, and a wall
     of hex when 30 automation rows print it: "PR Automation Review & Fix
     #e5eba703". Split back apart here so the words stay loud and the hex goes
     quiet, in the muted style the tag already had.

     Both halves are decided by rowDisplayName / visibleSessionTag rather than
     here, because the drawer, the swarm anchor, the roster and the lineage
     spine all have to reach the same two answers — a session that reads one way
     on its row and another way in the drawer it opens is the defect, not the
     styling. `opts` carries boardIndex's collision sets; it is absent on the
     preview call paths, which is why no tag is the default there rather than
     one computed against nothing. */
  const visibleName = rowDisplayName(agent);
  const nameTag = visibleSessionTag(agent, opts);
  const terminal = terminalSourceName(agent);
  const terminalCrumb = terminalBreadcrumb(agent, displayName);
  const staleFact = rowStalenessText(agent);
  const sourceName = sourceAgentName(agent);
  // The terminal / source naming detail stays off the visible row.
  // Reuse the drawer's helper (never re-fork the naming logic) to fold the full
  // sentence into the row tooltip + aria-label; the drawer still carries it too.
  const sourceDetail = fullSourceDetail(agent);
  const liveness = livenessView(agent);
  /* T1's disagreement flag. Only `contradicted` is loud: `corroborated` is
     the kernel agreeing, and `unobserved` is the kernel not having looked —
     which on the live board is every row, so marking it would mark the whole
     fleet with a fact about the observer rather than about the session. */
  const lineageContradicted = agent.lineageAgreement === "contradicted";
  const history = historyProvenance(agent);
  const elapsed = liveElapsedText(agent, state.snap && state.snap.generatedAt);

  const activate = () => { selectAgent(agent.id); };

  const identity = el("span", { class: "row-identity has-dual-marks" },
    groupingCheckNode(agent, displayName),
    harnessAgentMarks(agent),
    el("span", { class: "agent-name-wrap" },
      el("span", { class: "agent-name", text: rosterName(visibleName, program) }),
      /* The disambiguator rides the loud line. It used to sit on the tag row
         below in the faintest style on the row, which put the only value that
         separates two rows furthest from the eye. */
      nameTag
        ? el("span", {
          class: "row-session-tag is-inline",
          title: "Session " + nameTag + " — this display name is shared by other rows.",
          text: "#" + nameTag,
        })
        : null,
      /* Watch-only / quarantine mark rides the name line. It used to sit in
         row-identity-tags, which is its own grid row under the title — so a
         row with no ack and no chips spent a whole line on an 8px ring. */
      watchOnly
        ? el("span", {
          class: "control-dot is-" + watchOnly.key,
          role: "img",
          "aria-label": watchOnly.label + ". " + watchOnly.hint,
          title: watchOnly.label + " — " + watchOnly.hint,
        })
        : null,
      el("button", {
        type: "button",
        class: "agent-rename",
        "aria-label": "Rename " + displayName,
        title: terminal
          ? "Edit display name (defaults from terminal: " + terminal + ")"
          : "Edit display name",
        dataset: { fkey: "agent-rename:" + agent.id },
        onclick: (e) => {
          e.stopPropagation();
          startRename(nameTarget, { draft: displayName });
        },
      }, icon("rename")),
      /* No provenance chip here anymore: in the strip, the row now sits under
         its own group heading (renderStripGroupHead) carrying the same words —
         the fact still reaches this row's aria-label below, because a screen
         reader arrowing row-to-row may never visit the heading between them. */
      null),
    renderRowTimeBand(agent, Number.isFinite(nowMs) ? nowMs : Date.now(), thresholdMs, alertMuted),
    el("span", { class: "row-identity-tags" },
      /* SYNC-NF. The ack mark leads the line — it is the reason this row is not
         in the strip where the operator last saw it, so it has to be the first
         thing read here rather than the last. */
      ackedMarkNode(agent, state.snap),
      /* ROW DIET. The role chip, the model-policy chip, the terminal breadcrumb
         and the staleness note used to sit here and are now in the drawer's
         Evidence shelf (renderRowFacts), reachable in one click from the row
         that owns them.

         What stayed is the test: does this pixel change what the operator can
         safely DO with this session? Watch-only means Send is off, so it is a
         control-safety mark rather than metadata, and GOAL.md keeps those on
         the row. The four that left are
         facts ABOUT the session, true and worth reading, and none of them
         changes whether an instruction is safe to send. All four are still in
         the row's aria-label, so nothing left the row for a screen reader. */
      // What its own operator declared this lane's work to be. Absent on every
      // undeclared session, which is nearly all of them.
      ...taskStateChips(agent),
      // History provenance: which of the two different endings this record has.
      // Only ever true of a terminal row, so a live board never sees them.
      ...historyChips(agent),
      // Process liveness. The ROW only marks the one state that changes what the
      // operator must do — a dead process — because a "Process live" chip on
      // every working row is noise that would bury it. Every other state (and
      // absence) leaves the row byte-identical to today; the drawer carries the
      // full four-state fact, so `unknown` still reads as unknown somewhere.
      /* D7. Gated on the LIFECYCLE, not on processState alone. `grok-build-plan`
         was the case: pid 18871 gone, a sibling had taken pane AAA12BA5, the
         transcript was still fresh — so lifecycle Row 4 held the session
         `working` for its 3-minute window while processStateFor said "died", and
         the row painted Working and Died at once. One row cannot report a
         session as both alive and dead; an operator reading that has to pick
         which half to believe, which is the same as reading neither.
         Row 4 is the more conservative claim (a fresh transcript is direct
         evidence of work) and it is the one the rest of the row is already
         built on, so the chip yields to it. Nothing is hidden: `processState`
         stays on the wire, the drawer states all four verdicts, and the row's
         aria-label still carries the process fact. */
      liveness && liveness.key === "died" && activity === "ended"
        ? el("span", { class: "row-died", title: liveness.detail }, icon("warning"), liveness.label)
        : null,
      /* Lineage the kernel contradicts. T1 walks pid→ppid from each hook-store
         process up to its cmux surface and, when the chain it observes conflicts
         with the one that was DECLARED, keeps the declared chain and says so
         rather than silently re-parenting. This is where it gets said.

         Loud, and on the row rather than only in the drawer, because a wrong
         parent is not a cosmetic error: the swarm tree is how an operator
         decides which session a piece of work belongs to, and a row nested under
         the wrong orchestrator is how an instruction reaches the wrong session.
         It passes the row's own test for what earns pixels — it changes what is
         safe to DO here. */
      lineageContradicted
        ? el("span", {
          class: "lineage-contradicted",
          title: "The parent this session declares is not the parent its process actually has. The declared chain is what the board is showing; treat this row's place in the tree as unproven.",
        }, icon("warning"), "Parent disputed")
        : null,
      /* The swarm chip became the caret. It was already the one element on the
         row that names the subtree, so putting the control on it costs no new
         pixels and puts the affordance on the thing it acts on.

         Its own fkey, because render() restores focus by fkey and the row's own
         `agent:<id>` belongs to the row: a keyboard operator who opened a swarm
         would otherwise be dropped onto the row underneath the caret they just
         pressed, on the very repaint their press caused. */
      (() => {
        /* Two chips, one honesty rule: the button's number is what the caret
           will reveal, and when the full swarm is bigger the label says so.
           A swarm whose every member is out of view here (pinned to the strip,
           filtered out, or in another program) keeps a non-expanding chip —
           the relationship is true even when the rows are elsewhere — but it
           gets no caret, because a caret that reveals nothing is the defect
           this branch exists to remove. */
        const fullCount = opts.fullChildCount || opts.childCount || 0;
        const elsewhere = Math.max(0, fullCount - (opts.childCount || 0));
        if (opts.childCount) {
          return el("button", {
            type: "button",
            class: "swarm-chip" + (opts.swarmOpen ? " is-open" : "") + (opts.swarmAlerting ? " is-alerting" : ""),
            "aria-expanded": String(Boolean(opts.swarmOpen)),
            "aria-label": (opts.swarmOpen ? "Collapse " : "Expand ") + opts.childCount
              + " subagents under " + displayName
              + (elsewhere ? ". " + elsewhere + " more are not in this group's view." : "")
              + (opts.swarmAlerting ? ". One of them is asking for you." : ""),
            title: (elsewhere
              ? fullCount + " subagents in this swarm — " + opts.childCount + " here; " + elsewhere + " pinned to Needs you, filtered out, or in another program"
              : opts.childCount + " subagents in this swarm")
              + (opts.swarmAlerting ? " — one of them is asking for you" : ""),
            dataset: { fkey: "swarm:" + agent.id },
            onclick: (e) => { e.stopPropagation(); toggleSwarm(agent); },
          },
            el("span", { class: "swarm-caret", "aria-hidden": "true", text: opts.swarmOpen ? "▾" : "▸" }),
            "swarm " + (elsewhere ? opts.childCount + " of " + fullCount : opts.childCount));
        }
        if (fullCount) {
          const where = fullCount + " subagents in this swarm — none are in this group's view (pinned to Needs you, filtered out, or in another program)";
          return el("span", { class: "swarm-chip", title: where, "aria-label": where }, "swarm " + fullCount);
        }
        return null;
      })(),
      /* SYNC-NF, at the tail: the terminal's own unread count, then the one
         control this row offers over the alert list. Both pass the row diet's
         test — the badge says a terminal is holding something the operator has
         to go and read, and the button is the only way to answer the strip
         without lying about the session. */
      cmuxBadgeNode(agent, state.snap),
      syncAckButton(agent, state.snap)),
    description
      ? el("span", { class: "row-copy" },
        el("span", { class: "row-identity-tags row-summary row-description", title: "Last thing this session said or asked. Select for full details.", text: description }))
      : null);

  // Right-side instrument cluster: status word · outcome, model + ctx%, tokens,
  // elapsed. Values ride --font-mono with tabular-nums; each cell is omitted
  // honestly when its number is unknown (never fabricated), matching the
  // vitals-band precedent. Access + the naming detail fold into the aria-label.
  const ctxUsage = contextUsage(agent.tokens);
  const modelText = modelShort(agent.model) || "not reported";
  const ctxPct = agentContextPct(agent);
  const harnessLabel = (HARNESS_MARK[harnessKeyOf(agent)]?.label || providerLabel(agent.provider) || "");
  const harnessUnknown = !agent.provider || !harnessLabel;
  const harnessText = harnessUnknown ? "\u2014" : harnessLabel;
  const tokens = tokenSummary(agent.tokens);

  const instruments = el("span", { class: "row-instruments" },
    /* Silent when the tab already guarantees the answer. The full state stays in
       the title and the row's aria-label, so nothing is lost to a reader who
       asks — it just stops being printed 275 times. */
    (() => {
      const words = rowStateWords(activity, outcome, state.view, agent, alertMuted, Number.isFinite(nowMs) ? nowMs : Date.now(), thresholdMs);
      if (!words.length) return null;
      return el("span", {
        class: "row-state state-" + activity + (presentedOutcome !== "healthy" ? " outcome-" + presentedOutcome : "")
          + (opState === "stalled" ? " is-stalled" : "")
          + (opState === "done" ? " is-done" : ""),
        title: stateText,
        "aria-label": "Status: " + stateText,
      }, el("span", {
        // The ink follows the operator state: needs-you is amber, stalled is
        // the same graphite as waiting (dimmed on the row), working is blue.
        class: opState === "needs-you" ? "row-state-alert"
          : presentedOutcome === "blocked" ? "row-state-blocked"
            : presentedOutcome === "failed" ? "row-state-failed"
              : opState === "stalled" ? "act-idle is-stalled"
                : opState === "done" ? "act-ended is-done"
                  : opState === "working" ? "act-working"
                    : opState === "waiting" ? "act-idle"
                      : "act-" + activity,
        text: words.join(" · "),
      }));
    })(),
    el("span", {
      class: "ri-cell ri-harness" + (harnessUnknown ? " is-unknown" : ""),
      "aria-label": "Harness: " + (harnessUnknown ? "not reported" : harnessText),
      title: harnessUnknown ? "Provider not recorded for this session" : "Harness " + harnessText,
    },
      el("span", { class: "ri-value mono", text: harnessText })),
    el("span", {
      class: "ri-cell ri-model" + (modelText === "not reported" ? " is-unknown" : ""),
      "aria-label": "Model: " + modelText,
      title: agent.model || modelText,
    },
      el("span", { class: "ri-value mono", text: modelText })),
    el("span", {
      class: "ri-cell ri-ctx" + (ctxPct == null ? " is-unknown" : ""),
      "aria-label": contextDisplayLabel() + ": " + contextDisplayValue(agent.tokens),
      title: ctxUsage ? ctxUsage.text : "Context window not reported for this model",
    },
      el("span", { class: "ri-value mono", text: ctxPct != null ? ctxPct + "%" : "\u2014" })),
    tokens.known
      ? el("span", {
        class: "ri-cell ri-tokens",
        /* The screen reader still hears the whole qualification: the mark is a
           visual shorthand, and a shorthand nobody can see is a regression. */
        /* The QUALIFICATION survives; only its visual mark is gone (operator
           directive, 2026-08-05). The ⓘ that used to sit here was a superscript
           glyph on every latest-turn row, and a mark that appears on almost
           every row stops distinguishing anything while still costing the eye a
           stop. Screen readers and hover keep the whole sentence — this
           aria-label and the cell title below are the qualification's real
           carriers, and they are untouched. */
        "aria-label": "Tokens: " + tokens.text + (tokens.scopeMarked ? ", latest model call" : ""),
        title: tokens.title,
      },
        el("span", { class: "ri-value mono", text: tokens.text }))
      : null,
    (() => {
      if (state.view === "board") {
        const quiet = rowQuietText(agent);
        if (!quiet) return null;
        return el("span", {
          class: "ri-cell ri-elapsed is-quiet",
          "aria-label": "Quiet: " + rowStalenessText(agent),
          title: "No update for " + quiet + " — dormant, not necessarily stuck",
        },
          el("span", { class: "ri-value mono", text: quiet }));
      }
      return elapsed && elapsed !== "—"
        ? el("span", {
          class: "ri-cell ri-elapsed",
          "aria-label": "Span, first to last activity: " + elapsed,
          title: "First activity to last activity, dormancy included",
        },
          el("span", { class: "ri-value mono", dataset: elapsedDataset(agent, state.snap && state.snap.generatedAt), text: elapsed }))
        : null;
    })());

  const line1 = el("span", { class: "agent-grid" }, identity, instruments);

  const rowClass = "agent-row provider-" + agent.provider +
    " role-" + role.key +
    (opts.depth > 0 ? " is-child depth-" + Math.min(opts.depth, 4) : "") +
    (opts.childCount ? " is-parent" : "") +
    (selected ? " is-selected" : "") +
    (state.groupingIds && state.groupingIds.has && state.groupingIds.has(agent.id) ? " is-grouping" : "") +
    (presentedOutcome !== "healthy" ? " is-" + presentedOutcome : "") +
    /* Needs-you membership, not outcome: inline mode's stand-in for the strip.
       A row can be in the set with a healthy outcome (hook needsInput), so
       this mark and is-needs-you are two different facts. */
    (opts.alerting ? " is-alerting" : "") +
    /* The mark BOTH modes share, and the only one that means "needs a person"
       wherever the row is drawn: is-alerting is inline-only (pane's strip is
       that signal, and double-marking it was refused), presentedOutcome mutes
       only needs-you, and a hook-shaped ask has a HEALTHY outcome and so wears
       no ink class at all. Same predicate as data-hot and as the sort, from the
       same snapshot, so paint and order can never disagree. */
    (stripAlerting(agent, state.snap) ? " is-alert-hot" : "") +
    /* Strip rows already sit inside the needs-you pane — the strip IS the
       signal. Adding is-needs-you here would double-mark and let a healthy
       hook-shaped alert wear identity paint the :not() selectors cannot catch
       if we ever offered a tick. Board rows still take the class. */
    (opState === "needs-you" && !opts.programChip ? " is-needs-you" : "") +
    (opState === "working" ? " is-working" : "") +
    (opState === "waiting" ? " is-waiting" : "") +
    (opState === "stalled" ? " is-stalled" : "") +
    (opState === "done" ? " is-done" : "") +
    (state.momentumMagnify && state.view === "board"
      ? (momentumPopulation(agent) ? " is-momentum-hot" : " is-momentum-recede")
      : "") +
    // Same gate as the row-died pill above: this class is that pill's scannable
    // echo (a red border on the row), so painting it while the pill is withheld
    // would make the row assert in colour exactly what it declined to say in words.
    (liveness && liveness.key === "died" && activity === "ended" ? " is-died" : "") +
    (lineageContradicted ? " is-lineage-disputed" : "") +
    (activity === "ended" ? " is-ended" : "") +
    /* Context pressure, from the same thresholds the summary dial paints with,
       so a row can never read calm under a dial reading hot. Only on rows still
       doing something: a finished session at 96% is a fact about a window
       nobody is going to fill, and colouring it would spend the operator's
       attention on work that already stopped. */
    /* Spelled out rather than built from the pressure word, so the class names
       exist as literals in this file — the styles.css orphan guard reads the
       source, and a concatenated name is invisible to it in both directions. */
    ((() => {
      if (isTerminal(agent)) return "";
      const pressure = contextPressureOf(ctxPct);
      return pressure === "hot" ? " ctx-hot" : pressure === "warn" ? " ctx-warn" : "";
    })()) +
    (editing ? " is-renaming" : "");

  const row = el("div", {
    class: rowClass,
    id: "agent-" + agent.id,
    role: "button",
    tabindex: "0",
    // The de-noised naming detail rides the tooltip for sighted hover; screen
    // readers get it (plus tokens/elapsed/access) in the aria-label below.
    title: sourceDetail || null,
    "aria-current": selected ? "true" : null,
    /* Everything the row diet took off the visible line is still spoken here,
       and that is the condition the diet was allowed under: the row got quieter
       to LOOK at, not quieter to listen to. Program, role,
       terminal destination, staleness and the history provenance each get a
       clause, in the order a sighted operator would have read them. */
    "aria-label": `${displayName}.${nameTag ? ` Session ${nameTag}.` : ""}${opts.programChip ? ` Program: ${stripChipLabel(opts.programChip)}.` : ""} Status: ${stateText}.${liveness ? ` Process: ${liveness.label}.` : ""}${history ? ` ${history.label}.` : ""}${lineageContradicted ? " Parent disputed: the declared parent is contradicted by the observed process chain." : ""}${agent.taskState && agent.taskStateSource ? ` Declared ${agent.taskState}.` : ""} Agent/message: ${summary || "No message reported"}. Model: ${modelText}. Context: ${contextDisplayValue(agent.tokens)}. Tokens: ${tokens.text}. Span, first to last activity: ${elapsed !== "—" ? elapsed : "not reported"}. Access: ${CONTROL_STATE_TEXT[control] || "View only"}.${role.key !== "agent" ? ` Role: ${role.label}.` : ""}${terminalCrumb ? ` Terminal: ${terminalCrumb}.` : ""}${staleFact ? ` Quiet: ${staleFact}.` : ""} ${sourceDetail ? sourceDetail + ". " : ""}${opts.depth ? `Swarm depth ${opts.depth}. ` : ""}${opts.childCount ? `${opts.childCount} descendants, ${opts.swarmOpen ? "shown" : "collapsed"}. ` : ""} Select to open the full message and session details in the inspector.`,
    dataset: {
      fkey: "agent:" + agent.id,
      depth: String(opts.depth || 0),
      /* Alert-LIST membership, stamped for the float's mover detection. The
         sort reads stripAlerting, so the flight must read the SAME predicate
         or the two disagree and the row teleports: classes cannot carry it —
         is-alerting is inline-mode only, and presentedOutcome mutes only
         needs-you, so an acked blocked/failed row and a hook-shaped strip
         entry both flip membership with no class moving. Freshness is already
         guaranteed by agentRowSig: the record body covers every alerting()
         input and the "acked" fragment covers the veto, so a membership flip
         always rebuilds the node that carries this stamp. */
      hot: stripAlerting(agent, state.snap) ? "true" : "false",
      /* WHERE in that list, which membership cannot say. Two rows that were
         both already hot swapping places is a real move on the one surface
         whose job is "look here", and the pre-recency mover test — membership
         flipped or it did not — reports nothing for it, so both rows teleport
         between frames. Empty off the list: rank is meaningless for a calm row,
         and an empty stamp can never make one a mover. */
      alertRank: stripAlerting(agent, state.snap) && opts.alertRank !== "" && opts.alertRank != null
        ? String(opts.alertRank)
        : "",
    },
    onclick: (e) => {
      if (e.target.closest(".agent-rename, .rename-form, .swarm-chip, .grouping-check")) return;
      if (state.selectMode && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setGrouping(agent.id, !(state.groupingIds && state.groupingIds.has(agent.id)));
        render();
        return;
      }
      if (state.selectMode && e.shiftKey) {
        e.preventDefault();
        rangeGroupTo(agent.id);
        render();
        return;
      }
      activate();
    },
    onkeydown: (e) => {
      if (e.target.closest(".agent-rename, .rename-form, input, button")) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      activate();
    },
  }, line1);

  /* Signal's 3px tick, on the flat surfaces that pass one. The stylesheet
     decides whether it is actually drawn: a row already wearing an attention
     treatment keeps the ember rail and the repo tick is evicted, never blended
     (authority rule 5). Painted here rather than folded into rowClass because
     the hex is a value, and a value on a CSP-strict page travels as a custom
     property, not as a class. */
  paintRepoTint(row, opts.repoTint, "has-repo-tick");

  if (!editing) return row;

  const kind = nameTarget.kind;
  return el("div", { class: "agent-row-edit-wrap" },
    row,
    renderLabelForm(nameTarget, {
      inputKey: "label-input:" + nameKey,
      placeholder: kind === "workspace" ? "Name that matches the cmux terminal" : "Display name for this agent",
      ariaLabel: "New display name for " + displayName,
      source: kind === "workspace"
        ? (terminal
          ? "Terminal title: " + terminal + " · workspace id stays " + nameTarget.workspaceId
          : "Workspace id stays " + nameTarget.workspaceId)
        : "Source agent: " + sourceName + " · id stays " + agent.id,
    }));
}

/* ---------- SYNC-NF · the three row nodes ----------

   All three are omitted rather than rendered empty, which is why the row is
   byte-identical on the overwhelming majority of sessions: no unread terminal
   notification, no ack, nothing asking. */

/* The count, in QUIET ink. It is a fact about the terminal, not a verdict about
   the session — cmux holding an unread alert says nothing about whether the
   agent is stuck — so it takes --muted and leaves the status palette alone.
   Clicking it does nothing on purpose: a clear acts on ONE notification and
   this can stand for several, so the verbs live on the dropdown entries where
   each one has its own id and its own title to name. */
function cmuxBadgeNode(agent, snap = state.snap) {
  const unread = agentUnreadCmux(agent, snap);
  if (!unread.length) return null;
  const words = unread.length + " unread terminal notification" + (unread.length === 1 ? "" : "s");
  return el("span", {
    class: "cmux-badge",
    title: words + " in this cmux workspace. Clear them from the notifications panel.",
    "aria-label": words + " in this session's cmux workspace",
    text: String(unread.length),
  });
}

/* The operator's word, and only ever the operator's word. Every phrasing that
   suggested the SESSION had reached a state — done, resolved, cleared — is
   wrong here: the agent may be sitting at the same prompt it was sitting at
   before the click. So the mark says who judged, and says what did not change. */
function ackedMarkNode(agent, snap = state.snap) {
  if (!ackedAgent(agent, snap)) return null;
  const said = "You acknowledged this request. Alert treatment is muted until the agent makes a new request. "
    + "The session remains open and its state is unchanged.";
  return el("span", { class: "acked-mark", title: said, "aria-label": said, text: "acked ·" });
}

/* One control slot, two states. An Ack the operator cannot take back is a
   one-way door on a judgment they made from a one-line summary. */
function syncAckButton(agent, snap = state.snap) {
  if (!alerting(agent)) return null;
  const on = ackedAgent(agent, snap);
  const name = agentName(agent);
  return el("button", {
    type: "button",
    class: "sync-ack" + (on ? " is-acked" : ""),
    disabled: syncPending.has("ack:" + agent.id) ? "" : null,
    /* The accessible name OVERRIDES the visible text, so it has to CONTAIN it —
       WCAG 2.5.3, the rule notifyQuietRow above carries the scar of. A voice
       operator reads "Ack" off the screen and says it; a name that opened with
       "Acknowledge" would not match the word they can see. So the visible label
       leads, and the sentence that says what this does — and what it does NOT
       do — follows it. */
    "aria-label": on
      ? "Unack — undo the acknowledgement for " + name + ": restores alert treatment"
      : "Ack — Acknowledge " + name + ": mutes alert treatment until a new request; session remains open",
    title: on
      ? "Restore alert treatment for this request."
      : "Mute this request until the agent makes a new one. It does not answer the agent or change session state.",
    dataset: { fkey: "sync-ack:" + agent.id },
    onclick: (e) => { e.stopPropagation(); void applySyncAck(agent, !on); },
  }, on ? "Unack" : "Ack");
}

function swarmNote(agent, opts) {
  if ((opts.depth || 0) > 0 || !agent.parentAgentId) return null;
  const parent = opts.fullById && opts.fullById.get(agent.parentAgentId);
  return parent ? "↳ under " + agentName(parent) : "↳ parent session untracked";
}

/* ---------- row keyboard navigation ----------

   Rows are role="button" with tabindex 0, so Tab already reached them — but Tab
   walks EVERY focusable on the board (filter chips, program heads, rename
   pencils, per-row controls), so stepping from one row to the next could take a
   dozen presses on a board with 165 of them. Arrows walk rows and nothing else.

   The index math is kept separate from the DOM so the end-of-list rules are
   testable without a browser. Arrows CLAMP rather than wrap: wrapping from the
   last row to the first silently teleports the operator across a long board with
   no visual event to explain it. Home/End are the deliberate way to make that
   jump. */
const ROW_NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

function nextRowIndex(current, key, count) {
  if (count <= 0) return -1;
  switch (key) {
    // From nowhere, Down enters at the top and Up enters at the bottom.
    case "ArrowDown": return current < 0 ? 0 : Math.min(count - 1, current + 1);
    case "ArrowUp": return current < 0 ? count - 1 : Math.max(0, current - 1);
    case "Home": return 0;
    case "End": return count - 1;
    default: return -1;
  }
}

/* Only rows that are actually reachable — arrow nav must walk exactly what Tab
   walks, so it reads the same tabindex the rows carry rather than a second list. */
function navigableRows() {
  const root = $("programs");
  return root ? [...root.querySelectorAll('.agent-row[tabindex="0"]')] : [];
}

/* `rows` is injectable so the whole handler — not just the arithmetic — can be
   driven in a test against plain nodes. */
function handleRowNavigation(e, rows = navigableRows()) {
  if (!ROW_NAV_KEYS.has(e.key)) return false;
  // A modified arrow is a browser/OS gesture (word jump, history, scroll); never
  // take those. Same for a text field inside a row's rename form.
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  const target = e.target;
  if (!target || !target.closest) return false;
  if (target.closest("input, textarea, select")) return false;
  const row = target.closest(".agent-row");
  if (!row) return false;
  const next = nextRowIndex(rows.indexOf(row), e.key, rows.length);
  if (next < 0) return false;
  // Consume even when already at the end, or the board scrolls out from under a
  // held arrow key while focus visibly stays put.
  e.preventDefault();
  if (rows[next] && rows[next] !== row) rows[next].focus();
  return true;
}

/* ---------- selection + inspector ---------- */

function selectAgent(agentId) {
  selectEntity({ kind: "agent", id: agentId });
}

/* Only when it is not already held for this agent: a matching agentId —
   loaded, loading, OR errored — stands, so a background reopen costs nothing
   and a failed load retries only through the operator's own Try again. */
function shouldAutoLoadTranscript(sel, transcript) {
  return Boolean(sel && sel.kind === "agent" && (!transcript || transcript.agentId !== sel.id));
}

function maybeRefreshHeldTranscript(snap) {
  const sel = state.selected;
  const transcript = state.transcript;
  if (!sel || sel.kind !== "agent" || !transcript || transcript.agentId !== sel.id) return;
  const agent = (snap && Array.isArray(snap.programs) ? snap.programs : [])
    .flatMap((program) => program && Array.isArray(program.agents) ? program.agents : [])
    .find((item) => item && item.id === sel.id);
  if (!isGrokBotAgent(agent) || !shouldRefreshHeldTranscript(agent, transcript)) return;
  void loadTranscript(sel.id, transcript.limit, {
    quiet: true,
    threadStamp: transcriptThreadStamp(agent),
  });
}

// Unified entry point for every drawer kind. Agents keep populating the legacy
// state.selectedId so the row is-selected highlight, findSelected, and
// closeInspector focus-return all keep working untouched.
function selectEntity(sel) {
  /* Where the operator was standing when they opened this, captured before
     render() rebuilds the board out from under the focused node. Recorded for
     every kind, because closeInspector's `agent-<id>` route only ever worked for
     agents — see state.selectionOrigin.

     Only when focus is OUTSIDE the drawer. Flicking to another board row should
     move the return point to that row, but following a lineage link from inside
     an open drawer should not: that link is about to be destroyed by the very
     repaint it triggers, so adopting it as the way back would strand the
     operator on a node that no longer exists. The row that began the excursion
     stays the way out. */
  const origin = document.activeElement;
  const pane = $("inspector");
  if (!(origin && pane && pane.contains(origin))) {
    state.selectionOrigin = origin && origin.dataset ? origin.dataset.fkey || null : null;
  }
  /* Switching drawers is a click-out: commit the outgoing agent's feed
     position before the repaint destroys the node the events would have read. */
  if (state.selectedId && (!sel || sel.id !== state.selectedId)) {
    saveChatScrollFrom(document.getElementById("drawer-chat-feed"), state.selectedId);
  }
  state.selected = sel;
  state.selectedId = sel && sel.kind === "agent" ? sel.id : null;
  state.confirming = null;
  state.evidenceOpen = false;
  /* The drawer's feed is the transcript, so opening an agent fetches it — the
     same fetch the foot's buttons fire. loadTranscript sets its loading state
     synchronously, so the render() below paints the honest interim, and its
     own settle repaints the bubbles pinned to newest via the cleared memo. */
  if (shouldAutoLoadTranscript(sel, state.transcript)) void loadTranscript(sel.id);
  /* The repaint memo only protects an operator's place across repaints WITHIN
     one continuous viewing; a reopen falls through to the per-agent SAVED
     position (committed when they left the widget), then to the newest turn. */
  _chatScrollMemo.key = "";
  render();
  // On explicit open (not on background SSE re-renders), move focus to the
  // drawer's lead element per kind — the differentiator band, or the title.
  focusDrawerLead();
}

function focusDrawerLead() {
  const pane = $("inspector");
  if (!pane || pane.hidden) return;
  const lead = pane.querySelector(".dw-lead") || pane.querySelector(".inspector-title");
  if (!lead) return;
  if (!lead.hasAttribute("tabindex")) lead.setAttribute("tabindex", "-1");
  lead.focus({ preventScroll: true });
}

function closeInspector() {
  const id = state.selectedId;
  // Closing is the definitive click-out: commit the feed position on the way.
  if (id) saveChatScrollFrom(document.getElementById("drawer-chat-feed"), id);
  const origin = state.selectionOrigin;
  state.selected = null;
  state.selectedId = null;
  state.selectionOrigin = null;
  state.confirming = null;
  state.evidenceOpen = false;
  _chatScrollMemo.key = "";
  render();
  /* The agent row by id first — unchanged, and it survives a roster rebuild that
     a captured node reference would not. The recorded origin catches every other
     kind: a program or finding drawer left `id` null, so closing one destroyed
     the focused Close button and dropped the operator on <body>, with nothing
     between them and Tab-from-the-top. */
  const row = id ? document.getElementById("agent-" + id) : null;
  const back = row
    || (origin ? document.querySelector(`[data-fkey="${CSS.escape(origin)}"]`) : null);
  if (back) back.focus({ preventScroll: true });
}

function findSelected() {
  if (!state.selectedId || !state.snap) return null;
  for (const program of dashboardPrograms(state.snap)) {
    const agent = program.agents.find((a) => a.id === state.selectedId);
    if (agent) return { agent, program };
  }
  return null;
}

/* ---------- inspector paint signature ---------- */

/* Fields the live clocks own: tickClocks rewrites data-elapsed-base / data-ago
   nodes in place every 5s, so letting them into a paint signature would rebuild
   the drawer on every snapshot and defeat the guard. Their PRESENCE still
   matters (a tile appears when elapsedMs stops being null), so the projection
   keeps a presence marker for each.

   `identityTrace` itself is NOT in this set any more: the drawer now renders
   the tier trail and the quarantine reason, so a resolution that changes has to
   repaint. Only its one clock-like field (`confirmedAt`, the moment a persisted
   binding was last re-confirmed) is dropped, because that moves on its own
   without changing anything the operator reads. */
const AGENT_SIG_TICKED = new Set(["elapsedMs", "updatedAt", "lastCheckedAt", "confirmedAt", "lastThreadAt"]);

/* The agent drawer paints very nearly the whole agent record — status, gates,
   tokens, cwd, git, messages, artifacts, transcript tail, target
   routing and controls[] — so project the record itself rather than hand-listing
   fields that then rot. A field added to the snapshot is covered automatically. */
function agentRecordSig(agent) {
  if (!agent) return "";
  const body = JSON.stringify(agent, (key, value) => (AGENT_SIG_TICKED.has(key) ? undefined : value)) || "";
  return body + "|" + (agent.elapsedMs == null ? "" : "e") + (agent.updatedAt ? "u" : "");
}

/* The lineage spine paints ancestors and direct children, so their identity and
   activity are part of what this drawer shows — a subagent going idle must not
   leave a stale glyph on an open drawer. */
function lineagePaintSig(agent, snap) {
  const rawById = new Map(snapshotAgents(snap).map(({ agent: a }) => [a.id, a]));
  const byId = new Map([...rawById].filter(([, candidate]) => dashboardVisible(candidate)));
  const kin = (a) => a.id + ":" + a.status + ":" + (a.activity || "") + ":" + (a.role || "") + ":" + agentName(a);
  const parts = [];
  const seen = new Set([agent.id]);
  let parent = agent.parentAgentId ? byId.get(agent.parentAgentId) : null;
  if (agent.parentAgentId && !rawById.has(agent.parentAgentId)) parts.push("untracked:" + agent.parentAgentId);
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    parts.push(kin(parent));
    parent = parent.parentAgentId ? byId.get(parent.parentAgentId) : null;
  }
  for (const a of byId.values()) if (a.parentAgentId === agent.id) parts.push(kin(a));
  return parts.join(",");
}

/* Every piece of state a drawer body renders. The agent branch used to carry
   only the entity kind/id and evidenceOpen — queueItem/triage/issue are all
   undefined for an agent — so an open agent drawer never repainted: the
   Interrupt/Archive confirm strips were unreachable, Send never showed its busy
   state, and the body stayed frozen at the moment the drawer opened while the
   row beside it updated every snapshot.

   Live inputs are deliberately excluded (drafts, renameDraft): tearing a text
   box down while it is being typed into is the very bug this rule exists to
   stop. Both are only ever cleared externally alongside a flag that IS in the
   signature (sendControl clears drafts as it clears pending and sets feedback;
   submitRename flips renamePending), so exclusion cannot strand a stale value. */
function inspectorPaintSig(sel, view, ui) {
  const queueItem = ui.queueItems.find((item) => item.issueId === sel.id);
  const triage = ui.triage.get(sel.id);
  const triagePending = [...ui.triagePending].filter((key) => key.endsWith(":" + sel.id)).join(",");
  const issue = view && (view.issue || view.item);
  const agent = view && view.kind === "agent" ? view.agent : null;
  const feedback = agent ? ui.feedback.get(agent.id) : null;
  const identity = ui.identity || {};
  const transcript = ui.transcript || {};
  // The dock prints this agent's last journalled action, so a new entry landing
  // has to repaint the drawer or the fact stays wrong until something else moves.
  const lastAction = agent ? lastActionFor(ui.actions && ui.actions.items, agent.id) : null;
  return [
    sel.kind, sel.id,
    view ? view.kind : "missing",
    issue && issue.lifecycle ? issue.lifecycle.state : "",
    issue && issue.workState || "",
    issue && issue.progress != null ? String(issue.progress) : "",
    queueItem ? queueItem.state + ":" + (queueItem.result || "").slice(0, 80) : "",
    triage ? triage.generatedAt + ":" + triage.headline : "",
    triagePending,
    agent ? agentRecordSig(agent) : "",
    agent ? lineagePaintSig(agent, ui.snap) : "",
    agent && view.program ? programName(view.program) : "",
    // Interaction flags the drawer controls read on every paint.
    agent ? [...ui.pending].filter((key) => key.startsWith(agent.id + ":")).sort().join(",") : "",
    agent && feedback ? (feedback.ok ? "ok" : "err") + ":" + feedback.action + ":" + feedback.message : "",
    ui.confirming || "",
    /* SYNC-CF: the escalation dialog is a child of this drawer, so the drawer
       has to repaint when it opens, closes, or changes what it would kill. */
    ui.syncClose && agent && ui.syncClose.agentId === agent.id
      ? ui.syncClose.code + ":" + ui.syncClose.workspaceId + ":" + (ui.syncClose.siblingAgents || []).map((s) => s.id + "/" + s.name).join(",")
      : "",
    ui.renaming || "",
    ui.renamePending ? "1" : "0",
    ui.renameError || "",
    // SYNC-RF: same three flags for the workspace-rename editor, and the draft
    // excluded for the same reason renameDraft is.
    ui.wsRenaming || "",
    ui.wsRenamePending ? "1" : "0",
    ui.wsRenameError || "",
    ui.labelsLoading ? "1" : "0",
    ui.labelLoadError || "",
    // Narrow drawers switch the visible in-flow panel from Chat to Evidence.
    // This is also the only state changed by a cached "View Evidence" click,
    // so it must invalidate the drawer even when identity data is unchanged.
    ui.evidenceOpen ? "evidence" : "chat",
    // On-demand terminal evidence: nothing else in the drawer moves when it
    // lands, so without this the fetched surfaces would never reach the screen.
    agent && identity.agentId === agent.id
      ? [
        identity.loading ? "1" : "0",
        identity.error || "",
        identity.data ? JSON.stringify(surfaceCollisions(identity.data)) : "",
      ].join(":")
      : "",
    // Same reason as identity: nothing else in the drawer moves when a fetched
    // transcript lands, so without this it would never reach the screen. The
    // line COUNT and the source stand in for the payload — the text is immutable
    // once fetched, and hashing 1000 turns on every paint is not free.
    agent && transcript.agentId === agent.id
      ? [
        transcript.loading ? "1" : "0",
        transcript.error || "",
        String(transcript.limit || ""),
        transcript.data
          ? [
            transcript.data.lines.length,
            transcript.data.source || "",
            transcript.data.truncated ? "1" : "0",
            (transcript.data.lines.at(-1) && transcript.data.lines.at(-1).at) || "",
            String((transcript.data.lines.at(-1) && transcript.data.lines.at(-1).text) || "").slice(-48),
          ].join(":")
          : "",
        transcript.threadStamp || "",
      ].join(":")
      : "",
    /* Bot inspector only. lastThreadAt is in AGENT_SIG_TICKED, so an agent
       send-message would not rebuild this drawer; a user send would, because
       lastUserMessage is signed. Do not put this on the row signature. */
    agent && isGrokBotAgent(agent) ? (agent.lastThreadAt || "") : "",
    lastAction ? lastAction.id + ":" + lastAction.outcome : "",
    // Attention lives only on the client until the next snapshot lands, so
    // without it the acknowledge/dismiss/snooze block would never repaint —
    // the exact failure `state.identity` and `state.transcript` both had.
    agent
      ? [
        ui.attentionPending && ui.attentionPending.has(agent.id) ? "1" : "0",
        (ui.attentionErrors && ui.attentionErrors.get(agent.id)) || "",
        (() => {
          const record = attentionRecord(agent.id, ui);
          return record ? record.action + ":" + (record.snoozedUntil || record.updatedAt || "") : "";
        })(),
      ].join(":")
      : "",
    // A feed that freezes under an OPEN drawer changes nothing else the drawer
    // signs — generatedAt is not in here and the agent record is byte-identical
    // across a frozen refresh — so without this the dock would keep painting
    // live-looking Focus/Send/Interrupt/Archive over four-day-old routing.
    feedFrozen(ui) ? "held" : "",
    /* Sixth instance of the mutates-only-itself clock: setRepoColors bumps
       repoColorsVersion and nothing the agent record carries. Without this
       an open drawer keeps the first paint's untinted desk. */
    String(repoColorsVersion),
  ].join("\u001f");
}

/* Drawer router: one chassis, a distinct body per entity kind. selectEntity
   sets state.selected = {kind,id}; resolveSelection maps it to a live record and
   DRAWER_RENDERERS routes to the per-type body. Keeping this as renderInspector
   preserves every existing render() caller. */
function renderInspector() {
  const pane = $("inspector");
  let sel = state.selected;
  /* A presentation-only system source may still be selected in persisted/live
     client state from the snapshot before its classification landed. Close that
     stale route instead of turning the hidden infrastructure record into a
     "missing" agent drawer. Ordinary sources that truly disappear keep the
     existing missing-record explanation. */
  if (sel && sel.kind === "agent" && state.snap) {
    const raw = snapshotAgents(state.snap).find(({ agent }) => agent.id === sel.id);
    if (raw && !dashboardVisible(raw.agent)) {
      state.selected = null;
      state.selectedId = null;
      state.selectionOrigin = null;
      sel = null;
    }
  }
  document.body.classList.toggle("inspector-open", !!sel);
  if (!sel) {
    state.paintSig.inspector = "closed";
    pane.hidden = true;
    pane.textContent = "";
    pane.className = "pane-inspector";
    return;
  }

  const view = resolveSelection(sel);
  if (paintUnchanged("inspector", inspectorPaintSig(sel, view, state))) {
    pane.hidden = false;
    return;
  }

  pane.textContent = "";
  pane.className = "pane-inspector";
  pane.hidden = false;
  const renderer = view && DRAWER_RENDERERS[view.kind];
  if (!renderer) { pane.append(...missingDrawer()); return; }
  pane.setAttribute("role", "region");
  pane.setAttribute("aria-label", (DRAWER_ARIA_LABELS[view.kind] || "Detail") + " inspector");
  renderer(pane, view);
}

const DRAWER_ARIA_LABELS = {
  agent: "Agent", intervention: "Intervention", advisory: "Advisory",
  investigation: "Investigation", resolved: "Resolved finding", program: "Program",
  "unbound-waiting": "Unbound waiting notification",
};

const DRAWER_RENDERERS = {
  agent: renderAgentDrawer,
  intervention: renderInterventionDrawer,
  advisory: renderAdvisoryDrawer,
  investigation: renderInvestigationDrawer,
  resolved: renderResolvedDrawer,
  "unbound-waiting": renderUnboundWaitingDrawer,
  program: renderProgramDrawer,
};

function resolveSelection(sel) {
  if (!sel || !state.snap) return null;
  if (sel.kind === "agent") {
    const found = findSelected();
    return found ? { kind: "agent", agent: found.agent, program: found.program } : null;
  }
  if (sel.kind === "intervention" || sel.kind === "advisory") {
    const issue = issuesOf(state.snap).find((i) => i.id === sel.id);
    return issue ? { kind: sel.kind, issue } : null;
  }
  if (sel.kind === "investigation") {
    const item = state.queueItems.find((it) => it.issueId === sel.id || it.id === sel.id);
    return item ? { kind: "investigation", item } : null;
  }
  if (sel.kind === "resolved") {
    const pool = [...issuesOf(state.snap), ...recentlyResolvedOf(state.snap)];
    const issue = pool.find((i) => i.id === sel.id && issueLifecycle(i).state === "resolved");
    return issue ? { kind: "resolved", issue } : null;
  }
  if (sel.kind === "program") {
    const program = dashboardPrograms(state.snap).find((p) => p.id === sel.id);
    return program ? { kind: "program", program } : null;
  }
  if (sel.kind === "unbound-waiting") {
    const note = (Array.isArray(state.snap.unboundWaiting) ? state.snap.unboundWaiting : [])
      .find((item) => item && item.notificationId === sel.id);
    return note ? { kind: "unbound-waiting", note } : null;
  }
  return null;
}

function drawerAccent(pane, kind) {
  pane.append(el("div", { class: "dw-accent dw-accent--" + kind, "aria-hidden": "true" }));
}

function dwEyebrow(kindClass, iconName, text) {
  return el("span", { class: "dw-eyebrow dw-eyebrow--" + kindClass }, iconName ? icon(iconName) : null, text);
}

function missingDrawer() {
  return [
    el("div", { class: "inspector-head" },
      el("h2", { class: "inspector-title", text: "No longer in the snapshot" }),
      closeButton()),
    el("p", { class: "inspector-note", text: "This entity is no longer reported by any collector. It may reappear on the next snapshot." }),
  ];
}

function drawerVerdictHead({ eyebrow, title, sub, action }) {
  return el("div", { class: "inspector-head inspector-verdict" },
    el("div", { class: "inspector-id" },
      eyebrow || null,
      el("h2", { class: "inspector-title", text: title }),
      sub || null),
    el("div", { class: "verdict-side" },
      closeButton(),
      action ? el("div", { class: "verdict-action" }, action) : null));
}

/* Compact promoted lever for an issue drawer's head — the single most-relevant
   action, so an operator can act from the top without scrolling to the Fix
   block. Reuses the same triageIssue(...) calls the body controls use; the
   head: fkey prefix (B2 convention) keeps the key distinct from the body twin.
   A queued investigation → Launch; a not-yet-triaged finding → Triage; anything
   in flight → null (the Fix/Triage block owns the plan/queue story). */
function issueHeadAction(issue) {
  const id = issue.id;
  const queueItem = state.queueItems.find((it) => it.issueId === id);
  if (queueItem && queueItem.state === "queued") {
    const launching = state.triagePending.has("run:" + id);
    return el("button", {
      type: "button", class: "btn dw-head-action",
      disabled: launching ? "" : null,
      "aria-busy": launching ? "true" : null,
      dataset: { fkey: "head:run:" + id },
      onclick: () => triageIssue(id, "run"),
    }, launching ? "Launching…" : "Launch");
  }
  if (!state.triage.get(id)) {
    const generating = state.triagePending.has("generate:" + id);
    return el("button", {
      type: "button", class: "btn dw-head-action",
      disabled: generating ? "" : null,
      "aria-busy": generating ? "true" : null,
      dataset: { fkey: "head:triage:" + id },
      onclick: () => triageIssue(id, "generate"),
    }, generating ? "Triaging…" : "Triage");
  }
  return null;
}

/* The investigation head's promoted lever — the queued run's Launch button, the
   drawer's one existing primary control. Head: prefix keeps it distinct from the
   full-width Launch that stays in the body. Null unless the run is queued. */
function investigationHeadAction(item) {
  if (item.state !== "queued") return null;
  const launching = state.triagePending.has("run:" + item.issueId);
  return el("button", {
    type: "button", class: "btn dw-head-action",
    disabled: launching ? "" : null,
    "aria-busy": launching ? "true" : null,
    dataset: { fkey: "head:run:" + item.issueId },
    onclick: () => triageIssue(item.issueId, "run"),
  }, launching ? "Launching…" : "Launch");
}

/* Program head rollup — the swarm at a glance: agent count, working, alerts, and
   aggregate session tokens, aggregated client-side over the program's agents.
   Values ride the mono convention; unit words stay ui/--faint. The token cell is
   omitted when no agent on the client reports session usage — an aggregate we
   cannot derive is never faked to zero. */
function programRollupLine(program) {
  const cells = programRollupCells(program.agents || [], program.rollup, state.snap);
  return el("div", { class: "dw-rollup", "aria-label": "Program rollup" },
    cells.map((c) => el("span", { class: "dw-rollup-cell" + (c.alert ? " is-alert" : "") },
      el("span", { class: "dw-rollup-value mono", text: c.value }),
      el("span", { class: "dw-rollup-label", text: c.label }))));
}

/* Impact summary — never dump hundreds of anonymous chips as "Affects (160)".
   Plain language first, program rollup second, optional short sample third. */
function affectedImpact(issue, snap = state.snap) {
  const ids = issue.affectedAgentIds || [];
  const byId = agentsById(snap);
  const resolved = ids.map((id) => byId.get(id)).filter(Boolean);
  const byProgram = new Map();
  for (const row of resolved) {
    const key = programName(row.program);
    const bucket = byProgram.get(key) || { name: key, count: 0 };
    bucket.count += 1;
    byProgram.set(key, bucket);
  }
  const programs = [...byProgram.values()].sort((a, b) => b.count - a.count);
  const total = ids.length;
  let plain = "System-wide — not tied to a specific agent.";
  if (total === 1 && resolved[0]) {
    plain = `Touches 1 session: ${agentName(resolved[0].agent)} (${programName(resolved[0].program)}).`;
  } else if (total > 0) {
    const top = programs.slice(0, 2).map((p) => `${p.name} (${p.count})`).join(", ");
    plain = `Touches ${total} tracked session${total === 1 ? "" : "s"}`
      + (programs.length ? ` across ${programs.length} program${programs.length === 1 ? "" : "s"}` : "")
      + (top ? ` — mainly ${top}` : "")
      + ".";
  }
  return { total, resolved, programs, plain };
}

function workStateBanner(issue) {
  const work = issueWorkState(issue);
  return el("div", { class: "dw-work work-" + work.key, role: "status" },
    el("span", { class: "dw-work-mark", "aria-hidden": "true" }),
    el("span", { class: "dw-work-label", text: work.label }),
    el("span", { class: "dw-work-hint", text:
      work.key === "needs" ? "No triage started yet."
      : work.key === "triaging" ? "Triage request in flight…"
      : work.key === "planned" ? "A plan is ready — queue or launch from Fix below."
      : work.key === "queued" ? "Investigation queued — launch is a separate operator action."
      : work.key === "investigating" ? "Read-only investigation is running."
      : work.key === "verifying" ? "Waiting for a fresh source snapshot to clear the finding."
      : work.key === "blocked" ? "Blocked — review the investigation result."
      : work.key === "cleared" ? "Source confirmation cleared this finding."
      : "Advisory is visible; escalate only if it needs action." }));
}

function impactBlock(issue) {
  const impact = affectedImpact(issue);
  const wrap = el("div", { class: "dw-affects" },
    el("h3", { class: "section-title", text: "Impact" }),
    el("p", { class: "dw-impact-plain", text: impact.plain }));
  if (impact.programs.length > 1) {
    wrap.append(el("div", { class: "dw-impact-programs" },
      impact.programs.slice(0, 5).map((p) =>
        el("span", { class: "dw-impact-prog", text: `${p.name} · ${p.count}` }))));
  }
  if (impact.resolved.length) {
    const sample = impact.resolved.slice(0, AFFECTS_SAMPLE_LIMIT);
    const extra = impact.resolved.length - sample.length;
    wrap.append(el("details", { class: "dw-impact-sample" },
      el("summary", { text: extra > 0
        ? `Sample sessions (${sample.length} of ${impact.resolved.length})`
        : `Sessions (${impact.resolved.length})` }),
      el("div", { class: "dw-chips" }, sample.map(({ agent, program }) =>
        el("button", {
          type: "button", class: "dw-chip",
          dataset: { fkey: `issue:${issue.id}:${agent.id}` },
          onclick: () => selectEntity({ kind: "agent", id: agent.id }),
        }, agentName(agent), el("span", { class: "dw-chip-prog", text: " · " + programName(program) }))))));
  }
  return wrap;
}

// Intervention drawer — status first, consequence second, then the one Fix path.
function renderInterventionDrawer(pane, view) {
  const issue = view.issue;
  const note = issueLifecycleNote(issue);
  const work = issueWorkState(issue);
  drawerAccent(pane, "ember");
  pane.append(drawerVerdictHead({
    eyebrow: dwEyebrow("ember", "intervention", work.label),
    title: issue.title,
    action: issueHeadAction(issue),
  }));
  pane.append(workStateBanner(issue));
  pane.append(el("p", { class: "dw-lead", text: issue.summary || issue.title }));
  pane.append(impactBlock(issue));
  pane.append(el("div", { class: "dw-block dw-block--fix" },
    el("div", { class: "dw-block-label", text: "Fix" }),
    renderTriage(issue)));
  if (issue.technicalDetails && issue.technicalDetails.length) {
    pane.append(el("details", { class: "signal-tech" },
      el("summary", { text: "Technical" }),
      el("ul", {}, issue.technicalDetails.map((d) => el("li", { class: "mono", text: d })))));
  }
  if (note) pane.append(el("p", { class: "dw-impact", text: note }));
}

// Advisory drawer — quieter than an intervention; escalate only when watching.
function renderAdvisoryDrawer(pane, view) {
  const issue = view.issue;
  const note = issueLifecycleNote(issue);
  const work = issueWorkState(issue);
  drawerAccent(pane, "amber");
  pane.append(drawerVerdictHead({
    eyebrow: dwEyebrow("amber", "warning", "Advisory · " + work.label),
    title: issue.title,
    action: issueHeadAction(issue),
  }));
  pane.append(workStateBanner(issue));
  pane.append(el("p", { class: "dw-lead dw-lead--quiet", text: issue.summary || issue.title }));
  pane.append(impactBlock(issue));
  if (note) pane.append(el("p", { class: "dw-impact", text: note }));
  if (work.key === "watching" || work.key === "needs") {
    pane.append(el("div", { class: "controls-row" },
      el("button", {
        type: "button", class: "btn dw-ghost", dataset: { fkey: "escalate:" + issue.id },
        onclick: () => triageIssue(issue.id, "generate"),
      }, "Triage this advisory")));
  } else if (work.key === "planned" || work.key === "queued" || work.key === "investigating" || work.key === "verifying" || work.key === "blocked" || work.key === "triaging") {
    pane.append(el("div", { class: "dw-block dw-block--fix" },
      el("div", { class: "dw-block-label", text: "Triage" }),
      renderTriage(issue)));
  }
}

function renderUnboundWaitingDrawer(pane, view) {
  const note = view.note || {};
  const title = typeof note.workspaceTitle === "string" && note.workspaceTitle.trim()
    ? note.workspaceTitle.trim()
    : (typeof note.title === "string" && note.title.trim() ? note.title.trim() : "Waiting");
  drawerAccent(pane, "ember");
  pane.append(drawerVerdictHead({
    eyebrow: dwEyebrow("ember", "warning", "Waiting"),
    title,
    sub: el("p", { class: "inspector-sub", text: "no session bound" }),
  }));
  pane.append(el("p", { class: "dw-lead", text: note.body || "cmux reports it is waiting." }));
  pane.append(el("p", {
    class: "inspector-note",
    text: "No session is bound to this notification. Focus and Send stay off — the surface is not an attested write target.",
  }));
  if (note.notificationId) {
    pane.append(el("div", { class: "controls-row" },
      el("button", {
        type: "button", class: "btn",
        disabled: syncPending.has("notify:" + note.notificationId) ? "" : null,
        "aria-label": "Mark read: " + title + " — no session bound",
        dataset: { fkey: "sync-notify:mark_read:" + note.notificationId },
        onclick: () => { void clearCmuxNotification(note.notificationId, "mark_read"); },
      }, "Mark read"),
      el("button", {
        type: "button", class: "btn",
        disabled: syncPending.has("notify:" + note.notificationId) ? "" : null,
        "aria-label": "Dismiss: " + title + " — no session bound",
        dataset: { fkey: "sync-notify:dismiss:" + note.notificationId },
        onclick: () => { void clearCmuxNotification(note.notificationId, "dismiss"); },
      }, "Dismiss")));
  }
}

// Investigation drawer — the Luna run, live: status line + step timeline + result.
// Never ember (an investigation is not itself an alarm); slate accent + a moss
// pulse while running.
function renderInvestigationDrawer(pane, view) {
  const item = view.item;
  const running = item.state === "running";
  const stateView = investigationView(item.state);
  drawerAccent(pane, "slate");
  pane.append(drawerVerdictHead({
    eyebrow: dwEyebrow("slate", "broadcast", "Investigation · " + stateView.label),
    title: item.headline,
    action: investigationHeadAction(item),
  }));

  const status = el("div", { class: "dw-status" });
  if (running) status.append(el("span", { class: "dw-pulse", "aria-hidden": "true" }));
  status.append(el("span", { text:
    stateView.status + (running ? " · " + (item.runModel || "native Luna") : "") }));
  pane.append(status);

  if (item.steps && item.steps.length) {
    pane.append(el("div", {},
      el("h3", { class: "section-title", text: "Plan (" + item.steps.length + (item.steps.length === 1 ? " step)" : " steps)") }),
      el("ol", { class: "dw-steps", "aria-label": "Investigation plan" }, item.steps.map((step) =>
        el("li", {}, el("b", { text: step.title }), el("span", { text: step.detail }))))));
  }

  if (item.state === "queued") {
    const launching = state.triagePending.has("run:" + item.issueId);
    pane.append(el("div", { class: "controls-row" },
      el("button", {
        type: "button", class: "btn primary dw-full",
        disabled: launching ? "" : null,
        "aria-busy": launching ? "true" : null,
        dataset: { fkey: "run:" + item.issueId },
        onclick: () => triageIssue(item.issueId, "run"),
      }, launching ? "Launching…" : "Launch read-only Luna")));
  }

  if (item.result) {
    pane.append(renderInvestigationResult(item.result, item.state === "blocked" ? "blocked" : "completed",
      { issueId: item.issueId, startedAt: item.startedAt, completedAt: item.completedAt }));
  }

  const issue = issuesOf(state.snap).find((i) => i.id === item.issueId);
  if (issue) {
    const kind = issue.severity === "error" ? "intervention" : "advisory";
    pane.append(el("button", {
      type: "button", class: "dw-backlink",
      dataset: { fkey: "backlink:" + item.issueId },
      onclick: () => selectEntity({ kind, id: item.issueId }),
    }, "↖ From " + kind + ": ", el("b", { text: issue.title })));
  }
}

// Resolved drawer — the only past-tense, no-action state. Moss accent, reduced
// opacity, and a before/after trail of what cleared it.
function renderResolvedDrawer(pane, view) {
  const issue = view.issue;
  const lifecycle = issueLifecycle(issue);
  const result = lifecycle.result || "Source confirmation cleared the finding.";
  pane.classList.add("dw-past");
  drawerAccent(pane, "moss");
  // Resolved is the only past-tense drawer — no reopen/inspect control exists, so
  // the head renders verdict-only; no action is invented.
  pane.append(drawerVerdictHead({
    eyebrow: dwEyebrow("moss", "check", "Resolved"),
    title: issue.title,
  }));
  pane.append(el("p", { class: "dw-lead dw-lead--past", text: "Cleared " + issueTimestamp(lifecycle.resolvedAt) }));

  const grid = el("dl", { class: "detail-grid" });
  dtdd(grid, "was", issue.summary || issue.title);
  dtdd(grid, "now", result);
  pane.append(grid);

  const chips = affectedChips(issue, "Recovered");
  if (chips) pane.append(chips);
}

const ROSTER_ROLE_SHORT = {
  human: "Human", orchestrator: "Orchestrator", monitor: "Monitor",
  verifier: "Verifier", worker: "Worker", tester: "Tester",
  automation: "Automation", service: "Service", agent: "Agent",
};

/* Each agent falls in exactly one meter band so the segments sum to the roster
   count (alerts take priority over their working/idle activity). */
function programMeterSegments(agents) {
  let needs = 0, working = 0, idle = 0, ended = 0;
  for (const a of agents) {
    const act = deriveActivity(a);
    if (act === "ended") { ended++; continue; }
    if (deriveOutcome(a) !== "healthy") { needs++; continue; }
    if (act === "working") working++;
    else idle++;
  }
  return [
    { cls: "dw-seg-work", value: working },
    { cls: "dw-seg-idle", value: idle },
    { cls: "dw-seg-needs", value: needs },
    { cls: "dw-seg-end", value: ended },
  ];
}

/* The role, and how confident the board is that it IS the role. 1006 of the
   1174 sessions on the live board carry `inferred` against 4 `declared`, so a
   chip that draws a guess and a declaration identically states a certainty the
   server never claimed. Solid = declared at spawn, outline = observed through
   lineage, dashed = read off a title, with the reason in the tooltip. An absent
   roleSource takes no modifier — it asserts nothing rather than asserting
   certainty. */
function roleChip(agent, rv = roleView(agent.role)) {
  const source = roleSourceView(agent && agent.roleSource);
  return el("span", {
    class: "role-chip role-" + rv.key + (source ? " " + source.className : ""),
    title: source ? source.title : null,
    text: ROSTER_ROLE_SHORT[rv.key] || rv.label,
  });
}

/* Territory beside authority. B4 moved frontend/backend out of the role union
   because they described what a session works ON, not what it may decide — and
   nothing rendered the field it moved them to, so those sessions went from
   reading "Frontend / designer" to reading "Worker" with the fact still on the
   wire. */
function specialtyChip(agent) {
  const label = specialtyLabel(agent);
  return label ? el("span", { class: "specialty-chip", text: label }) : null;
}

function programRosterRow(agent, board) {
  const rv = roleView(agent.role);
  const act = deriveActivity(agent);
  const outcome = deriveOutcome(agent);
  const needs = outcome !== "healthy" && act !== "ended";
  const dotCls = needs ? "dw-dot--needs" : act === "working" ? "dw-dot--work" : act === "ended" ? "dw-dot--end" : "dw-dot--idle";
  const stateText = needs ? OUTCOME_LABELS[outcome] : ACTIVITY_LABELS[act];
  return el("button", {
    type: "button", class: "dw-roster-row",
    dataset: { fkey: "roster:" + agent.id },
    onclick: () => selectEntity({ kind: "agent", id: agent.id }),
    /* Spoken, not just drawn: the confidence is the whole point of the chip's
       styling, and a dashed border says nothing to a screen reader. */
    "aria-label": "Open " + agentName(agent)
      + " · " + (ROSTER_ROLE_SHORT[rv.key] || rv.label)
      + (agent.roleSource ? " (" + agent.roleSource + ")" : "")
      + (specialtyLabel(agent) ? " · " + specialtyLabel(agent) : "")
      + " · " + stateText,
  },
    roleChip(agent, rv),
    specialtyChip(agent),
    el("span", { class: "dw-roster-name", text: displayNameWithTag(agent, board) }),
    el("span", { class: "dw-roster-state" }, el("span", { class: "dw-dot " + dotCls, "aria-hidden": "true" }), stateText));
}

// Program drawer — the swarm at a glance. Neutral ink accent (a program isn't an
// alarm); a segmented health meter and a role-grouped roster are unique here.
function renderProgramDrawer(pane, view) {
  const program = view.program;
  const agents = program.agents;
  drawerAccent(pane, "ink");
  // Program head leads with the rollup glance (counts + aggregate tokens); the
  // segmented meter below stays as the visual breakdown, no longer restating the
  // same numbers in a caption.
  pane.append(drawerVerdictHead({
    eyebrow: dwEyebrow("ink", null, "Program"),
    title: programName(program),
    sub: programRollupLine(program),
  }));

  pane.append(el("div", { class: "dw-block" },
    el("div", { class: "dw-block-label", text: agents.length + (agents.length === 1 ? " agent" : " agents") }),
    svgSegmentMeter(programMeterSegments(agents), { label: "Program health rollup" })));

  if (program.purpose || program.path) {
    const grid = el("dl", { class: "detail-grid" });
    if (program.purpose) dtdd(grid, "purpose", program.purpose);
    if (program.path) dtdd(grid, "path", program.path, { code: true });
    pane.append(grid);
  }

  pane.append(el("div", { class: "controls-row" },
    /* Set here, cleared from the Filters bar — the drawer is where an operator
       is already looking at one program and decides they want only it. */
    el("button", {
      type: "button", class: "btn dw-full",
      dataset: { fkey: "facet-program:" + program.id },
      onclick: () => setFacetProgram(program.id),
    }, state.facetProgram === program.id ? "Show every program" : "Only this program")));

  // Once for the whole roster, not once per row: every name on it asks the same
  // fleet-wide question, and a program drawer can list thirty of them.
  const board = boardIndex(state);
  const roster = el("div", { class: "dw-roster" });
  const grouped = new Map();
  for (const a of agents) {
    const key = roleView(a.role).key;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(a);
  }
  for (const key of ROSTER_ROLE_ORDER) {
    for (const a of grouped.get(key) || []) roster.append(programRosterRow(a, board));
  }
  pane.append(el("div", {},
    el("h3", { class: "section-title", text: "Roster" }),
    roster));
}

/* Head de-noising (B2): the three-way naming ternaries collapse into one quiet
   line. quietSourceLine returns one short line of text — or null when the
   terminal name already matches the display name — and fullSourceDetail returns
   the complete sentence for the title tooltip (mismatch explanation included).
   B4 reuses both for the other drawer types' heads. */
function quietSourceLine(agent) {
  const terminal = terminalSourceName(agent);
  const directoriesDiffer = agent.target && agent.target.cwdRelation === "different";
  if (terminal) {
    // When directories differ, keep the terminal name as useful destination
    // context even if it happens to equal the displayed agent name.
    if (terminal === agentName(agent) && !directoriesDiffer) return null;
    return "Terminal: " + terminal;
  }
  const hasCustomName = state.aliases.has(presentationLabelKey(preferredRenameTarget(agent)))
    || state.aliases.has(presentationLabelKey(agentLabelTarget(agent)));
  return hasCustomName ? "Source agent: " + sourceAgentName(agent) : null;
}

function fullSourceDetail(agent) {
  return quietSourceLine(agent);
}

/* Ember-outline gate chip for the verdict head — names the blocker when the
   outcome is blocked. Indicator ink + outline, never a filled banner. */
function verdictGate(agent, outcome) {
  const hazards = [];
  for (const gate of agent.gates || []) {
    if (typeof gate === "string" && gate.trim()) hazards.push(conciseText(gate.trim(), 64));
  }
  const liveness = livenessView(agent);
  if (liveness?.key === "died") hazards.push("Process died");
  if (deriveControlState(agent) === "quarantined") hazards.push("Control quarantined");
  if (outcome !== "healthy" && hazards.length === 0) {
    hazards.push(OUTCOME_LABELS[outcome] || outcome);
  }
  const unique = [...new Set(hazards)];
  if (!unique.length) return null;
  const detail = unique.join(" · ");
  return el("span", {
    class: "drawer-session-hazard",
    title: detail,
    "aria-label": (unique.length === 1 ? "Hazard: " : `Hazards (${unique.length}): `) + detail,
    text: "!",
  });
}

/* ---------- attention: acknowledge / dismiss / snooze ----------

   The board could show that an agent wanted a human but gave the operator no
   way to answer it, so the same alert nagged forever and the signal stopped
   meaning anything. The server now persists the three verdicts and expires a
   snooze on its own (POST /api/attention {action, agentId[, until]}).

   The snapshot carries the EFFECT, not the record: an acknowledged, dismissed
   or snoozed agent simply stops being `status: "attention"`. So the client
   keeps the server's own returned record to say what it did — and drops a
   snooze the moment it runs out, which is exactly how an expired snooze
   visibly comes back: the record disappears here at the same time the agent
   returns to `attention` on the wire. */

const ATTENTION_SNOOZE_MS = 60 * 60_000;

const ATTENTION_ERRORS = {
  ATTENTION_NOT_FOUND: "The server has no unread notification recorded for this session, so there is nothing to clear.",
  UNSAFE_TARGET: "This session has no safely resolved terminal, so its attention state cannot be changed.",
  AGENT_NOT_FOUND: "This session is no longer in the current snapshot.",
  INVALID_SNOOZE_UNTIL: "The server rejected that snooze window.",
  ORIGIN_REJECTED: "The server refused the change as cross-origin. Reload this page from the address the server serves.",
};

function attentionErrorText(status, body) {
  const code = body && body.error && body.error.code;
  if (!status) return "Could not reach the server to change this attention state.";
  if (code && ATTENTION_ERRORS[code]) return ATTENTION_ERRORS[code];
  const message = body && body.error && body.error.message;
  return "Attention change failed"
    + (code ? " [" + code + "]" : "")
    + (message ? ": " + message : " (HTTP " + status + ")");
}

/* The live record for one agent, or null once a snooze has expired. Expiry is
   evaluated here rather than on a timer so the fact cannot get stuck. */
function attentionRecord(agentId, ui = state, now = Date.now()) {
  const record = ui.attention && ui.attention.get(agentId);
  if (!record) return null;
  if (record.action !== "snooze") return record;
  const until = Date.parse(record.snoozedUntil || "");
  if (!Number.isFinite(until) || until <= now) return null;
  return record;
}

function attentionStateText(record) {
  if (!record) return "";
  if (record.action === "acknowledge") return "Acknowledged — this alert will not ask again until the agent says something new.";
  if (record.action === "dismiss") return "Dismissed — cleared from the needs-a-human set.";
  return "Snoozed until " + issueTimestamp(record.snoozedUntil) + ".";
}

async function applyAttention(agentId, action, until) {
  if (state.attentionPending.has(agentId)) return;
  state.attentionPending.add(agentId);
  state.attentionErrors.delete(agentId);
  render();
  try {
    const res = await apiFetch("/api/attention", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action === "snooze" ? { action, agentId, until } : { action, agentId }),
    }, API_WRITE_TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { /* a build without the route answers HTML */ }
    if (!res.ok || !body || body.ok !== true || !body.state) {
      state.attentionErrors.set(agentId, attentionErrorText(res.status, body));
    } else {
      state.attention.set(agentId, body.state);
      // The server refreshes the snapshot before answering, so re-reading it is
      // what makes the agent visibly leave the needs-a-human set.
      await fetchSnapshot();
    }
  } catch {
    state.attentionErrors.set(agentId, attentionErrorText(0, null));
  } finally {
    state.attentionPending.delete(agentId);
    render();
  }
}

function attentionButton(agent, action, label, until) {
  return el("button", {
    type: "button",
    class: "btn sm attn-act",
    disabled: state.attentionPending.has(agent.id) ? "" : null,
    dataset: { fkey: "attn:" + agent.id + ":" + action },
    onclick: () => applyAttention(agent.id, action, until),
  }, label);
}

/* Null for an agent nobody is waiting on and with nothing recorded, so the
   drawer is unchanged for the overwhelming majority of sessions. */
function renderAttentionBlock(agent, ui = state, now = Date.now()) {
  const asking = agent.status === "attention";
  const record = attentionRecord(agent.id, ui, now);
  const stale = ui.attention && ui.attention.get(agent.id) && !record;
  const error = ui.attentionErrors && ui.attentionErrors.get(agent.id);
  if (!asking && !record && !error) return null;

  const block = el("section", { class: "attn-block" + (asking ? " is-asking" : ""), "aria-label": "Attention" });
  if (asking) {
    block.append(el("p", { class: "attn-reason", text: conciseText(agent.statusReason, 160) }));
    // A snooze that ran out while the drawer was open: say so, rather than
    // letting the alert quietly reappear as if it had never been answered.
    if (stale) block.append(el("p", { class: "attn-returned", role: "status", text: "The snooze has run out — this session is asking again." }));
    block.append(el("div", { class: "attn-actions" },
      attentionButton(agent, "acknowledge", "Acknowledge"),
      attentionButton(agent, "dismiss", "Dismiss"),
      attentionButton(agent, "snooze", "Snooze 1 hour", new Date(now + ATTENTION_SNOOZE_MS).toISOString())));
  } else if (record) {
    block.append(el("p", { class: "attn-state", role: "status", text: attentionStateText(record) }));
  }
  if (error) block.append(el("p", { class: "attn-error", role: "alert", text: error }));
  return block;
}


// Agent drawer — status line + scroll body + sticky command dock (Focus/Send/
// Interrupt/Archive). No status pills, no Danger footer.
/* The disambiguator for a drawer whose title is shared with other agents. The
   row's rule, run over the same fleet-wide index the row uses, so an operator
   who reads "#f263450b" on a row finds the same token at the top of the drawer
   it opens — and reads no token at all where the row shows none.

   It used to ask ambiguousNames alone, which counts RESOLVED identities. Those
   are unique by construction for a server-named session, so the question could
   only ever answer "no" and the hex an operator saw in the head was the one
   baked into `identity.name` — printed whether or not anything on the board
   needed separating. */
function drawerSessionTag(agent, ui = state) {
  return visibleSessionTag(agent, boardIndex(ui));
}

/* ---------- SYNC-RF: inline workspace rename ----------

   The one place on the board that writes a cmux WORKSPACE title. Three things
   make it different from the presentation-label rename beside it, and each one
   is why this path is its own machinery rather than a fourth `target.kind`:

     - It mutates another process. `/api/sync/rename` goes through the action
       funnel and can be REFUSED (an empty title, a group anchor); a board-local
       alias never can, so the alias path has no refusal vocabulary to reuse.
     - It renames an object this session SHARES. Sibling panes hang off one
       workspace, so the editor says which id it is about rather than leaving
       the operator to infer the scope from the session they opened.
     - The board is not the author of the result. On success this writes NOTHING
       locally: the title on screen is the snapshot's, so a rename someone else
       makes in cmux between our save and the next snapshot simply wins. That is
       the FE half of the never-re-assert rule — titles have no
       board-authoritative copy, unlike repo colors.

   Agent and session display names are board derivations and stay out: they are
   renamed, if at all, through the Names disclosure and `/api/program-aliases`. */

const SYNC_RENAME_ERRORS = {
  invalid_title: "cmux needs a workspace title with at least one visible character.",
  anchor: "This workspace anchors a cmux group, so its title is not ours to change.",
  invalid_state: "cmux refused the rename in this state.",
};

function syncRenameErrorText(status, body) {
  if (!status) return "Could not reach the server to rename this workspace.";
  const code = body && typeof body.code === "string" ? body.code : "";
  if (SYNC_RENAME_ERRORS[code]) return SYNC_RENAME_ERRORS[code];
  const detail = body && typeof body.detail === "string" ? body.detail : "";
  return "Rename failed"
    + (code ? " [" + code + "]" : "")
    + (detail ? ": " + detail : " (HTTP " + status + ")");
}

/* Which workspace this drawer may rename, or null.

   `exact` and `unique-cwd` are the same pair Focus routes on — cmux either
   attests the session is there, or it is the only pane in that directory. An
   ambiguous or missing link would put the operator's typing into a workspace
   the board only guessed at, and a rename lands on every sibling pane at once.

   No title, no affordance: the mission is a rename control WHERE THE TITLE
   RENDERS, and printing an empty field just to hang a pencil on it is the
   omit-empty rule broken for chrome. The title is used raw (trimmed only) —
   spinner-stripping it here would make "save unchanged" a real rename. */
function renameableWorkspace(agent) {
  const target = agent && agent.target;
  if (!target || !target.workspaceId) return null;
  if (target.resolution !== "exact" && target.resolution !== "unique-cwd") return null;
  const title = typeof target.workspaceTitle === "string" ? target.workspaceTitle.trim() : "";
  if (!title) return null;
  return { workspaceId: target.workspaceId, title };
}

const syncRenameFkey = (workspaceId) => "ws-rename:" + workspaceId;
const syncRenameInputFkey = (workspaceId) => "ws-rename-input:" + workspaceId;

/* Focus by fkey, the same handle render() restores through. Used on the way out
   of the editor: the control the operator opened it from is gone from the DOM
   by then, so the automatic restore in render() cannot find it and would drop
   a keyboard operator on the drawer lead. */
function focusByFkey(fkey, select = false) {
  if (typeof document === "undefined" || typeof CSS === "undefined") return;
  const node = document.querySelector(`[data-fkey="${CSS.escape(fkey)}"]`);
  if (!node) return;
  node.focus({ preventScroll: true });
  if (select && node.select) node.select();
}

function renderWorkspaceRename(agent) {
  const ws = renameableWorkspace(agent);
  if (!ws) return null;
  if (state.wsRenaming === ws.workspaceId) return renderWorkspaceRenameForm(ws);
  return el("div", { class: "drawer-workspace" },
    el("span", { class: "drawer-workspace-label", text: "Workspace" }),
    el("span", { class: "drawer-workspace-title", title: ws.title, text: ws.title }),
    el("button", {
      type: "button",
      class: "drawer-workspace-rename",
      "aria-label": "Rename workspace " + ws.title,
      dataset: { fkey: syncRenameFkey(ws.workspaceId) },
      onclick: () => startWorkspaceRename(ws),
    }, icon("rename")));
}

function renderWorkspaceRenameForm(ws) {
  return el("form", {
    class: "rename-form sync-rename-form",
    // Returns the promise: the browser ignores a listener's return value, and a
    // test that fires this handler can then await the write it started.
    onsubmit: (e) => { e.preventDefault(); return submitWorkspaceRename(ws); },
  },
    el("input", {
      type: "text",
      value: state.wsRenameDraft,
      maxlength: "80",
      placeholder: "Title for this cmux workspace",
      "aria-label": "New title for workspace " + ws.title,
      disabled: state.wsRenamePending ? "" : null,
      dataset: { fkey: syncRenameInputFkey(ws.workspaceId) },
      oninput: (e) => { state.wsRenameDraft = e.target.value; },
      onkeydown: (e) => { if (e.key === "Escape") { e.preventDefault(); cancelWorkspaceRename(ws.workspaceId); } },
    }),
    el("button", {
      type: "submit", class: "btn primary",
      disabled: state.wsRenamePending ? "" : null,
      "aria-busy": state.wsRenamePending ? "true" : null,
      dataset: { fkey: "ws-rename-save:" + ws.workspaceId },
    }, state.wsRenamePending ? "Saving…" : "Save"),
    el("button", {
      type: "button", class: "btn",
      disabled: state.wsRenamePending ? "" : null,
      dataset: { fkey: "ws-rename-cancel:" + ws.workspaceId },
      onclick: () => cancelWorkspaceRename(ws.workspaceId),
    }, "Cancel"),
    el("span", {
      class: "rename-source",
      text: "cmux workspace " + ws.workspaceId + " · every pane in it shares this title",
    }),
    state.wsRenameError ? el("p", { class: "rename-error", role: "alert", text: state.wsRenameError }) : null);
}

function startWorkspaceRename(ws) {
  state.wsRenaming = ws.workspaceId;
  // Seeded from cmux's title, not from the agent's display name: this box edits
  // the workspace, and the two are different strings on most linked sessions.
  state.wsRenameDraft = ws.title;
  state.wsRenameError = "";
  render();
  focusByFkey(syncRenameInputFkey(ws.workspaceId), true);
}

function cancelWorkspaceRename(workspaceId) {
  state.wsRenaming = null;
  state.wsRenameError = "";
  render();
  focusByFkey(syncRenameFkey(workspaceId));
}

async function submitWorkspaceRename(ws) {
  if (state.wsRenamePending) return;
  const title = state.wsRenameDraft.trim();
  state.wsRenamePending = true;
  state.wsRenameError = "";
  render();

  let status = 0;
  let body = null;
  try {
    const res = await apiFetch("/api/sync/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: ws.workspaceId, title }),
    }, API_WRITE_TIMEOUT_MS);
    status = res.status;
    body = await res.json().catch(() => null);
    /* An unreachable server leaves status 0, which syncRenameErrorText reads as
       "could not reach" — the one failure that is not cmux refusing anything. */
  } catch { /* handled below, by the absent ok */ }

  state.wsRenamePending = false;
  if (status >= 200 && status < 300 && body && body.ok === true) {
    state.wsRenaming = null;
    /* Deliberately no local write of `title`. The field re-reads the snapshot,
       which SYNC-RB patches from cmux's own `workspace.renamed` event, so a
       foreign rename that landed while this request was in flight is what the
       operator sees next — not what they typed. */
    toast("Renamed workspace to " + title, "ok");
    render();
    focusByFkey(syncRenameFkey(ws.workspaceId));
    return;
  }
  state.wsRenameError = syncRenameErrorText(status, body);
  // The refused draft is not left in the box pretending to be the title.
  state.wsRenameDraft = ws.title;
  render();
  focusByFkey(syncRenameInputFkey(ws.workspaceId));
}

function renderAgentDrawer(pane, view) {
  const { agent, program } = view;
  const outcome = deriveOutcome(agent);
  const control = deriveControlState(agent);

  // Provider channel: a 1px inset rail + the lineage current-node ring both read
  // from --prov, set CSP-safely by a class (never an inline style).
  pane.classList.add("dw-provider", "dw-provider--" + agent.provider, "dw-agent");
  const shellHead = el("div", { class: "drawer-shell-head" });
  pane.append(shellHead);

  /* Verdict head.

     The title used to be agentName alone, and on the live board that identified
     nothing: 19 of the 22 agents an operator is actively running all render
     "Claude · the-mountain-main". Opening four drawers in a row gave four
     identical headings. Two changes fix it without a semantic swap:

       - the session tag rides the title whenever the name is shared, reusing the
         same disambiguator the ROW already solved this with, so the two surfaces
         speak one language;
       - `task` — the standing objective, distinct on 8 of those 22 where the name
         managed 2 — is promoted out of the Operate panel to sit directly under
         the title. It is the line that says WHICH lane this is.

     The head no longer carries a primary action. headPrimaryAction rendered a
     literal copy of a dock tool, and the dock is position:sticky at the bottom of
     the pane — the same Focus button was on screen twice, with instance-scoped
     confirm keys existing only to stop the two copies stealing each other's
     focus. */
  const tag = drawerSessionTag(agent);
  /* The words only. The hex beside them is the `tag` above, printed under the
     row's rule — `agentName` here would have carried the server's durable
     disambiguator into the head whether or not the board had a twin to
     separate it from. */
  const title = rowDisplayName(agent);
  const sourceLine = quietSourceLine(agent);

  const role = roleView(agent.role);
  const eyebrow = [role.key !== "agent" ? role.label : "", programName(program), sourceLine]
    .filter(Boolean).join(" · ");
  const harnessLabel = (typeof HARNESS_MARK !== "undefined" && HARNESS_MARK[harnessKeyOf(agent)]?.label)
    || providerLabel(agent.provider) || "";
  const modelLabel = modelShort(agent.model);
  const tokens = agent.tokens || {};
  const contextPct = agentContextPct(agent);
  const contextMagnitude = Number.isFinite(tokens.total) && Number.isFinite(tokens.contextWindow)
    ? fmtTok(tokens.total) + " / " + fmtTok(tokens.contextWindow)
    : hasObservedTotal(tokens) ? fmtTok(tokens.total) + " tokens" : "";
  const sessionText = Number.isFinite(tokens.sessionTotal) ? fmtTok(tokens.sessionTotal) : "";
  const titleFacts = new Set(String(title).split("·").map((part) => part.trim().toLowerCase()).filter(Boolean));
  const runText = [harnessLabel, modelLabel]
    .filter((part) => part && !titleFacts.has(part.toLowerCase()))
    .join(" / ");
  const facts = el("dl", { class: "drawer-session-facts", "aria-label": "Session facts" });
  let hasFacts = false;
  const activity = deriveActivity(agent);
  const activityLabel = ACTIVITY_LABELS[activity] || activity;
  const liveness = livenessView(agent);
  const hazard = verdictGate(agent, outcome);
  const statusReason = typeof agent.statusReason === "string" ? agent.statusReason.trim() : "";
  if (activityLabel || agent.updatedAt || liveness || hazard) {
    hasFacts = true;
    const processValue = el("dd", {
      class: "drawer-session-process",
      role: "status",
      "aria-label": [activityLabel, statusReason].filter(Boolean).join(". "),
    });
    if (activityLabel) {
      processValue.append(el("span", {
        class: "drawer-session-activity act-" + activity,
        text: activityLabel,
      }));
    }
    if (liveness?.key === "running") {
      processValue.append(el("span", {
        class: "drawer-process-dot status-line-liveness liveness-running",
        title: liveness.detail,
        "aria-label": liveness.label,
      }));
    } else if (liveness) {
      processValue.append(el("span", {
        class: "drawer-process-state status-line-liveness liveness-" + liveness.key,
        title: liveness.detail,
        text: liveness.label,
      }));
    }
    if (agent.updatedAt) {
      processValue.append(el("span", {
        class: "drawer-session-age",
        dataset: { ago: agent.updatedAt },
        text: agoText(agent.updatedAt),
      }));
    }
    if (statusReason && outcome !== "healthy") {
      processValue.append(el("span", {
        class: "drawer-session-reason",
        title: statusReason,
        text: conciseText(statusReason, 72),
      }));
    }
    if (hazard) processValue.append(hazard);
    facts.append(el("div", { class: "drawer-session-fact drawer-session-status" },
      el("dt", { text: "Status" }), processValue));
  }
  if (runText) {
    hasFacts = true;
    facts.append(el("div", { class: "drawer-session-fact drawer-session-run-fact" },
      el("dt", { text: "Run" }),
      el("dd", { class: "drawer-session-run" },
        harnessAgentMarks(agent),
        el("span", { class: "drawer-session-run-label", text: runText }))));
  }
  if (contextPct != null || contextMagnitude) {
    hasFacts = true;
    const contextLabel = [
      contextPct != null ? (contextPct === 0 ? "<1%" : contextPct + "%") : "",
      contextMagnitude,
    ].filter(Boolean).join(" · ");
    const contextValue = el("dd", { class: "drawer-session-context-value", title: contextLabel },
      contextPct != null
        ? svgGauge(contextPct, "drawer-context-gauge", { label: `Context used: ${contextPct}%` })
        : null,
      el("span", { class: "drawer-session-context-reading" },
        contextPct != null
          ? el("span", { class: "drawer-session-context-pct", text: contextPct === 0 ? "<1%" : contextPct + "%" })
          : null,
        contextMagnitude
          ? el("span", { class: "drawer-session-context-capacity", text: contextMagnitude })
          : null));
    facts.append(el("div", { class: "drawer-session-fact drawer-session-context" },
      el("dt", { text: "Context" }),
      contextValue));
  }
  if (sessionText) {
    hasFacts = true;
    facts.append(el("div", { class: "drawer-session-fact drawer-session-usage" },
      el("dt", { text: "Session" }),
      el("dd", { text: sessionText })));
  }

  shellHead.append(el("header", { class: "inspector-head inspector-verdict drawer-session-header" },
    el("div", { class: "inspector-id drawer-session-main" },
      eyebrow ? el("p", { class: "drawer-session-eyebrow", text: eyebrow }) : null,
      el("h2", { class: "inspector-title" },
        /* Same value the subtraction below compares against — one call, so the
           two can never disagree about what the title said. */
        title,
        tag ? el("span", { class: "inspector-tag mono", text: "#" + tag }) : null),
      /* Under the name, because it is a different object: the cmux workspace
         this session sits in, and the only renameable thing in this header. */
      renderWorkspaceRename(agent)),
    el("div", { class: "verdict-side" }, closeButton()),
    hasFacts ? facts : null));

  const attentionBlock = renderAttentionBlock(agent);
  if (attentionBlock) shellHead.append(attentionBlock);

  /* `nextAction` is gone. It rendered on 100% of agents and looked like per-agent
     guidance, but across 243 live agents it held THREE distinct strings and 214
     of them read "Review this session in history." — a restatement of
     `activity === "ended"` dressed as advice. A directive that is the same
     sentence on nine agents out of ten is not a directive. */

  // Document (conversation) + Desk (evidence).
  const chatBody = renderChatFeedBody(agent, state);
  const chatLead = renderTranscriptFeedLead(agent, state, {
    hasPreviewSpeech: previewChatTurns(agent, state).length > 0,
  });
  const chatAlarm = feedAlarm(state.conn, state.snap && state.snap.generatedAt);
  const chatFreshness = chatAlarm
    ? chatFeedStateNode(
        chatAlarm.kind === "offline" ? "unavailable" : "stale",
        chatAlarm.kind === "offline" ? "offline" : "warning",
        chatAlarm.headline,
        chatAlarm.detail,
      )
    : null;
  /* Mini chat window. The feed IS the transcript: bubbles edge to edge, auto-loaded on open
     (selectEntity starts the fetch), with
     renderChat's preview standing in while the record is loading, errored,
     absent, or present-but-empty. An empty jsonl must not hide collector speech.
     Exceptional state and the manual older-history action lead the
     feed rather than consuming a separate footer row. The feed is the one
     deliberate inner scroller on the left.
     role="log" + tabindex make the feed itself a named, keyboard-reachable
     scroll region. */
  const chatScroll = el("div", { id: "drawer-chat-feed", class: "drawer-chat-scroll", role: "log", tabindex: "0", "aria-label": "Conversation" },
    chatFreshness,
    chatLead,
    chatBody);
  const jumpToLatest = el("button", {
    type: "button",
    class: "btn chat-jump-latest",
    dataset: { fkey: "chat-latest:" + agent.id },
  }, "Jump to latest");
  jumpToLatest.hidden = true;
  chatScroll.append(jumpToLatest);
  const chatBox = el("div", { class: "drawer-chat" }, chatScroll);
  /* role="region" is load-bearing: aria-label on a role-less <div> is dropped
     by every major AT — a generic element has no accessible name. */
  const doc = el("div", { class: "drawer-doc", role: "region", "aria-label": "Conversation" }, chatBox);
  doc.id = "drawer-chat-panel";

  /* The controls act on this conversation, so the complete dock belongs to the
     chat box: feed first, controls last, inside one visible boundary. */
  const dock = renderCommandDock(agent, control);
  dock.classList.add("drawer-controls-strip");
  const banner = renderControlBanner(agent, control);
  if (banner) dock.insertBefore(banner, dock.firstChild);
  chatBox.append(dock);
  /* Chat convention: open pinned to the newest turn; keep the operator's place
     across repaints only while they have deliberately scrolled up. The fake
     test document has no layout, so scrollHeight gates the whole behaviour. */
  const _chatKey = "chat:" + agent.id;
  const syncChatScroll = () => {
    const atBottom = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 8;
    _chatScrollMemo.key = _chatKey;
    _chatScrollMemo.top = chatScroll.scrollTop;
    _chatScrollMemo.atBottom = atBottom;
    jumpToLatest.hidden = atBottom;
  };
  chatScroll.onscroll = syncChatScroll;
  jumpToLatest.addEventListener("click", () => {
    chatScroll.scrollTop = chatScroll.scrollHeight;
    syncChatScroll();
  });
  /* Leaving the widget COMMITS the position (operator directive): pointer out
     or focus out writes this agent's place into the per-agent store, so a
     reopen resumes the read instead of re-pinning. An at-bottom reader saves
     nothing — their contract is "follow the newest", and a saved offset would
     freeze them mid-history as the feed grows. selectEntity/closeInspector
     also commit on the way out, covering click-outs the events cannot see. */
  const commitChatScroll = () => saveChatScrollFrom(chatScroll, agent.id);
  chatBox.onmouseleave = commitChatScroll;
  chatBox.onfocusout = commitChatScroll;

  // Evidence is a permanent desk only when the inspector itself is wide enough.
  // Narrow panes switch the same in-flow region between Chat and Evidence;
  // container queries choose from pane width without changing either scroll owner.
  const evidenceExpanded = Boolean(state.evidenceOpen);
  const desk = el("div", {
    class: "drawer-desk" + (evidenceExpanded ? " is-open" : ""),
    role: "region",
    "aria-label": "Evidence and lineage",
  });
  desk.id = "drawer-evidence-panel";
  desk.append(el("div", { id: "drawer-evidence-body", class: "drawer-evidence-body" },
    renderEvidence(agent),
    renderLineageSpine(agent)));
  const deskTint = tintOfProgram(program) || repoTintFor(agent.repo && agent.repo.repoName);
  paintRepoTint(desk, deskTint, "has-repo-tint");

  let grid = null;
  const setDrawerMode = (evidence, focus = true) => {
    state.evidenceOpen = evidence;
    grid.classList.toggle("is-evidence", evidence);
    desk.classList.toggle("is-open", evidence);
    chatMode.setAttribute("aria-selected", String(!evidence));
    evidenceMode.setAttribute("aria-selected", String(evidence));
    chatMode.setAttribute("tabindex", evidence ? "-1" : "0");
    evidenceMode.setAttribute("tabindex", evidence ? "0" : "-1");
    if (focus) (evidence ? evidenceMode : chatMode).focus?.();
  };
  const moveDrawerMode = (event, fromEvidence) => {
    let evidence = null;
    if (event.key === "Home") evidence = false;
    else if (event.key === "End") evidence = true;
    else if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) evidence = !fromEvidence;
    if (evidence == null) return;
    event.preventDefault();
    setDrawerMode(evidence);
  };
  const chatMode = el("button", {
    type: "button",
    role: "tab",
    class: "drawer-mode-tab",
    "aria-controls": doc.id,
    "aria-selected": String(!evidenceExpanded),
    tabindex: evidenceExpanded ? "-1" : "0",
    dataset: { fkey: "drawer-mode:" + agent.id + ":chat" },
    onclick: () => setDrawerMode(false),
    onkeydown: (event) => moveDrawerMode(event, false),
  }, "Chat");
  const evidenceMode = el("button", {
    type: "button",
    role: "tab",
    class: "drawer-mode-tab",
    "aria-controls": desk.id,
    "aria-selected": String(evidenceExpanded),
    tabindex: evidenceExpanded ? "0" : "-1",
    dataset: { fkey: "drawer-mode:" + agent.id + ":evidence" },
    onclick: () => setDrawerMode(true),
    onkeydown: (event) => moveDrawerMode(event, true),
  }, "Evidence");
  const modeSwitch = el("div", {
    class: "drawer-mode-switch",
    role: "tablist",
    "aria-label": "Drawer view",
  }, chatMode, evidenceMode);
  grid = el("div", { class: "drawer-grid" + (evidenceExpanded ? " is-evidence" : "") }, modeSwitch, doc, desk);
  pane.append(grid);

  /* SYNC-CF. Last child of the drawer so it overlays the pane it is about: the
     escalation names THIS agent's siblings, and a modal about one session
     hoisted to the page would have to re-state which session that was. */
  const closeDialog = renderSyncCloseDialog(agent);
  if (closeDialog) pane.append(closeDialog);

  if (typeof chatScroll.scrollHeight === "number") {
    const plan = chatScrollPlan(agent.id, _chatKey, _chatScrollMemo, _chatScrollSaved);
    chatScroll.scrollTop = plan.mode === "bottom" ? chatScroll.scrollHeight : plan.top;
    syncChatScroll();
  }
}

/* One slot, not a map: only one drawer is open at a time, and a stale entry for
   a different agent must lose to the saved-or-newest default, so keying the
   slot is the whole cleanup story. */
const _chatScrollMemo = { key: "", top: 0, atBottom: true };

/* The per-agent store the leave events write into: agentId -> scrollTop.
   Session-lifetime and unbounded on purpose — one number per agent an operator
   actually read mid-history is not a leak worth a cleanup policy. */
const _chatScrollSaved = new Map();

/* Where a freshly painted feed opens. Precedence: the live repaint memo (the
   operator is mid-read in THIS viewing — never yank them), then the position
   they committed by leaving the widget last time, then the newest turn. A
   memo or a save that was taken at the bottom resolves to bottom: "follow the
   newest" is a contract, not a coordinate. */
function chatScrollPlan(agentId, chatKey, memo = _chatScrollMemo, saved = _chatScrollSaved) {
  if (memo.key === chatKey && !memo.atBottom) return { mode: "memo", top: memo.top };
  if (memo.key !== chatKey && saved.has(agentId)) return { mode: "saved", top: saved.get(agentId) };
  return { mode: "bottom" };
}

/* Reads the live node and commits: a reader parked at the bottom clears any
   stale save (they chose "newest" again); anyone else keeps their place. */
function saveChatScrollFrom(chatScroll, agentId, saved = _chatScrollSaved) {
  if (!chatScroll || typeof chatScroll.scrollHeight !== "number") return;
  const atBottom = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight < 8;
  if (atBottom) saved.delete(agentId);
  else saved.set(agentId, chatScroll.scrollTop);
}

/* Bookshelf section — Operate/Chat stay open; Evidence uses the cog variant. */
function renderShelfSection({ key, title, open, body }) {
  const section = el("section", {
    class: "shelf-section" + (open ? " is-open" : ""),
    dataset: { shelf: key },
  });
  section.append(el("h3", { class: "shelf-title" }, title, el("span", { class: "rule", "aria-hidden": "true" })));
  const panel = el("div", {
    class: "shelf-body inspector-panel",
    id: "shelf-" + key,
  });
  if (body) {
    if (body.nodeType) panel.append(body);
    else for (const child of body) if (child) panel.append(child);
  }
  section.append(panel);
  return section;
}

/* What the collapsed rail is allowed to claim.

   Every section of renderEvidence is conditional, so the drawer's contents vary
   per agent and can legitimately be empty. Rather than keep a second copy of
   those conditions here — two lists that drift apart is how a label starts
   describing a panel it no longer matches — the sections tag themselves with
   `data-evidence-section` and this reads them back off a built panel. One
   source of truth: whatever renderEvidence actually emits is what the rail
   says. */
function evidenceInventory(agent) {
  let panel;
  try {
    panel = renderEvidence(agent);
  } catch {
    /* The rail must never be the thing that breaks the drawer. If evidence
       cannot be built, say nothing about its contents rather than guess. */
    return [];
  }
  /* Walked rather than queried: the client runs against a fake document in the
     harness, which builds real nodes through el() but implements no selector
     engine. querySelectorAll threw there and nowhere else. */
  const seen = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    const name = node.dataset && node.dataset.evidenceSection;
    if (name && !seen.includes(name)) seen.push(name);
    for (const child of node.children || []) walk(child);
  };
  walk(panel);
  return seen;
}

function renderEvidenceShelf(agent) {
  if (!state.evidenceOpen) {
    /* The collapsed rail is the ONLY route to everything the main view is
       deliberately not carrying, so it has to earn a click. It used to be a
       cog, four decorative beads and the word EVIDENCE rotated ninety degrees:
       nothing stated what was inside or whether opening it was worth it, and
       the beads were a fixed four regardless of content.

       The beads are gone rather than given a meaning they never had. In their
       place is the one number that answers "is this worth opening" — how many
       kinds of evidence this agent actually has — and the tooltip names them.

       The old tooltip also promised "vitals", which moved out to the vitals
       band under the verdict head. The rail was advertising a section the
       drawer no longer contains. */
    const sections = evidenceInventory(agent);
    const summary = sections.length
      ? "Open evidence — " + sections.join(", ")
      : "Open evidence — nothing reported for this session";
    const labelText = sections.length
      ? "Evidence — " + sections.length + " sections · " + sections.join(", ")
      : "Evidence — nothing reported for this session";
    return el("button", {
      type: "button",
      class: "shelf-evidence-rail",
      "aria-expanded": "false",
      "aria-controls": "shelf-evidence",
      title: summary,
      "aria-label": summary,
      dataset: { fkey: "shelf:evidence:open" },
      onclick: () => { state.evidenceOpen = true; render(); },
    },
      el("span", { class: "shelf-rail-label" }, icon("folder-open", { label: "" }), labelText),
      el("span", { class: "shelf-rail-tail" },
        el("span", {
          class: "shelf-rail-count" + (sections.length ? "" : " is-empty"),
          "aria-hidden": "true",
          text: sections.length ? String(sections.length) : "—",
        }),
        icon("chevron", { label: "" })) );
  }

  // Evidence holds paths, routing, and the transcript tail. Session facts live
  // in the command header, so Evidence no longer carries competing metrics.
  const body = renderEvidence(agent);
  const section = el("section", {
    class: "shelf-section shelf-evidence is-open",
    dataset: { shelf: "evidence" },
  });
  section.append(el("div", { class: "shelf-evidence-head" },
    el("h3", { class: "shelf-title" }, icon("folder-open", { label: "" }), "Evidence"),
    el("button", {
      type: "button",
      class: "shelf-cog is-active",
      "aria-expanded": "true",
      "aria-controls": "shelf-evidence",
      title: "Tuck evidence away",
      dataset: { fkey: "shelf:evidence:close" },
      onclick: () => { state.evidenceOpen = false; render(); },
    }, icon("chevron", { label: "Hide evidence" }))));
  body.id = "shelf-evidence";
  body.classList.add("shelf-body");
  section.append(body);
  return section;
}

/* Quarantine / observed-only: one banner, not a disabled Focus card. It names
   the reason resolution refused, in the resolver's own words, and the one thing
   the operator can do about it — the evidence was always in the payload; the
   banner used to throw it away and print a fixed sentence instead. All of
   `why` is agent-controlled text, so it rides textContent only. */
function renderControlBanner(agent, control) {
  const focusCap = capability(agent, "focus");
  const instructCap = capability(agent, "instruct");
  const locked = [focusCap, instructCap].some((c) => c && !c.enabled);
  if (!locked) return null;
  /* Wire `controlState: "linked"` can disagree with a disabled Send when the
     pane was matched by unique-cwd alone (Cursor rows, 2026-08-09). The brief
     for "linked" is null — reading .title threw and blanked the whole drawer
     after the head. Recover the honest refusal shape from the resolution, and
     never throw: absence of a brief means no banner, not a crash. */
  let briefControl = control;
  let brief = quarantineBrief(agent, briefControl);
  if (!brief) {
    const resolution = agent && agent.target && agent.target.resolution;
    briefControl = resolution === "unique-cwd" ? "unproven"
      : resolution === "ambiguous" ? "quarantined"
      : "observed-only";
    brief = quarantineBrief(agent, briefControl);
  }
  if (!brief) return null;

  /* Deliberately NOT the server's reason string, though it is right there on
     the capability. This chrome is pinned to plain operator language and to
     leaking no cmux identifiers, because resolver reasons carry raw evidence
     ("surface a1b2 is claimed by two sessions (lsof evidence conflicts)").
     My first pass rendered the served reason on the "render what the server
     sends" rule and a test caught it. That rule governs NUMBERS, where two
     derivations drift; this is an explanation, where the server's audience is
     an API client and the banner's audience is a person. */
  const copy = el("div", { class: "control-banner-copy" },
    el("strong", { text: brief.title }),
    " ",
    controlUnavailableText(briefControl, agent));
  /* `why` earns its line everywhere except one cause, and the exception is the
     common one. Measured on the live board: cause `missing` is 245 agents, and
     there the banner says a single fact three times before reaching the remedy —

       "Controls unavailable."                                        (title)
       "Controls are unavailable - no safe cmux target is linked..."  (summary)
       "No cmux terminal reports this session, so there is nothing
        to route Focus or Send to."                                   (why)

     Nothing is added by the third line: "no cmux target is linked" and "no cmux
     terminal reports this session" are the same sentence twice.

     Every other cause is left alone, and a first pass that dropped `why` for all
     of them was wrong. `contested-terminal` and `shared-folder` NAME which
     ambiguity — two sessions on one terminal, or two sharing a folder — where
     the summary only says "ambiguous"; a test caught that, correctly. Archived
     and died carry the risk of acting anyway, and `unproven` carries the reason
     a cwd match can reach the wrong agent. Those are the sentences that stop a
     retry, so they stay. */
  const details = el("details", { class: "control-banner-details" },
    el("summary", { class: "control-banner-why-toggle" }, "Why?"));
  if (brief.why && brief.cause !== "missing") {
    details.append(el("p", { class: "control-banner-why", text: brief.why }));
  }
  details.append(el("p", { class: "control-banner-next", text: brief.nextStep }));
  copy.append(details);
  copy.append(el("button", {
    type: "button",
    class: "control-banner-link",
    dataset: { fkey: "control-evidence:" + agent.id },
    onclick: () => {
      /* Load the terminal trace, select Evidence in a narrow pane, and take the
         operator to it; wide panes render the same node as a permanent column. */
      state.evidenceOpen = true;
      if (state.identity.agentId !== agent.id) void loadIdentityEvidence(agent.id);
      else render();
      /* Optionally called throughout: the test harness's fake document
         implements no selector engine and its nodes have no scrollIntoView.
         Worst case is "nothing moves" — the desk is already visible. */
      const desk = document.querySelector?.(".drawer-desk");
      desk?.classList?.add("is-open");
      desk?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      document.querySelector?.(`[data-fkey="drawer-mode:${agent.id}:evidence"]`)?.focus?.();
    },
  }, "View Evidence"));

  return el("div", { class: "control-banner", role: "status" },
    icon(briefControl === "quarantined" ? "quarantine" : "observed"),
    copy);
}

function closeButton() {
  return el("button", {
    type: "button", class: "btn inspector-close",
    "aria-label": "Close inspector",
    dataset: { fkey: "inspector-close" },
    onclick: () => closeInspector(),
  }, icon("close"));
}

/* ---------- inspector: command dock ---------- */

const NEEDS_CONFIRM = new Set(["interrupt", "archive"]);

function composerCanSend(routeReady, fresh, draft, busy) {
  return Boolean(routeReady && fresh && !busy && String(draft || "").trim());
}

function singleLineInstructionDraft(draft) {
  return String(draft || "").replace(/[\r\n]+/g, " ");
}

/* Keep the composer chat-sized until its content needs room, then grow it up to
   a bounded transcript-safe height. The CSS `field-sizing` declaration covers
   browsers that support it; this small DOM fallback keeps the same behavior in
   the rest without owning draft state or changing submit semantics. */
function resizeComposer(input) {
  if (!input || !input.style || !Number.isFinite(input.scrollHeight)) return;
  input.style.height = "auto";
  const height = Math.max(72, Math.min(input.scrollHeight, 128));
  input.style.height = height + "px";
  input.style.overflowY = input.scrollHeight > 128 ? "auto" : "hidden";
}

function capability(agent, action) {
  return (agent.controls || []).find((c) => c.action === action);
}

/* One labeled cluster of the dock. The dock used to be a single undifferentiated
   row, so an operator reaching for a verb had to recognise each button rather
   than read a heading — and "the destructive one" was told apart only by hue and
   position. Grouping by PURPOSE (talk to it / go to it / stop it / file it) is
   the fix, and it is a presentation change only: no cluster adds a control,
   removes one, or touches a capability.

   `role="group"` + `aria-label` is what carries the category to a screen reader,
   because visual proximity is not a grouping anyone can hear. The visible label
   repeats the same word and is hidden from assistive tech so the name is
   announced once rather than twice. It is a span with no fkey and no handler:
   a heading is not a control, and grouping must not add a focus stop.

   `extra` is written out at the call site instead of composed from `name`,
   because a class the client only ever assembles at runtime is invisible to the
   stylesheet's dead-rule lint — and that lint is worth more than the symmetry. */
function dockGroup(name) {
  return el("div", {
    class: "dock-group",
    role: "group",
    "aria-label": name,
  }, el("span", { class: "dock-group-label", "aria-hidden": "true", text: name }));
}

/* Sticky composer + quiet tools. Replaces the old Focus card and Danger zone.
   `alarm` is the feed-staleness verdict: on a frozen board every control here is
   held and says so, because the snapshot's routing evidence is as old as the
   rest of it. Defaulted (not passed by the caller) so the drawer call site stays
   `renderCommandDock(agent, control)` and the dock is still testable in isolation. */
function renderCommandDock(agent, control = deriveControlState(agent), alarm = feedAlarm(state.conn, state.snap && state.snap.generatedAt), actions = state.actions.items) {
  const focusCap = capability(agent, "focus");
  const instructCap = capability(agent, "instruct");
  const interruptCap = capability(agent, "interrupt");
  const archiveCap = capability(agent, "archive");
  const unarchiveCap = capability(agent, "unarchive");
  if (!focusCap && !instructCap && !interruptCap && !archiveCap && !unarchiveCap) {
    return el("span", { hidden: "" });
  }

  const safeLocked = [focusCap, instructCap].some((c) => c && !c.enabled);
  const held = Boolean(alarm);
  const linkedReady = !safeLocked && !held && control === "linked";
  const dock = el("div", {
    class: "command-dock" + (linkedReady ? " command-dock--linked" : "") + (held ? " is-held" : ""),
    /* Nested inside the Task-and-transcript region the composer needs its own
       announced boundary, or it reads as part of the transcript. Without a role
       the aria-label is dropped entirely (generic elements take no name). */
    role: "group",
    "aria-label": "Session controls",
  });
  if (held) {
    dock.append(el("p", { class: "command-dock-stale", role: "status", text: staleControlNote(alarm) }));
  }

  /* Focus and session management are supporting actions, not peers of Send.
     Keep them together for discoverability, then place the cluster in the
     quiet toolbar below the composer. Same tools, fkeys, capability gates and
     destructive-isolation disclosure; only the visual hierarchy changes. */
  const unarchivable = Boolean(unarchiveCap && unarchiveCap.enabled);
  /* SYNC-CF. Not a ControlCapability: closing is a cmux write on its own route
     with its own resolution rule, so it is built here rather than pulled out of
     `agent.controls`. It sits after Archive because it is the furthest-reaching
     verb in the group — filing a record, then destroying the terminal. */
  const closeTool = renderSyncCloseTool(agent, { held });
  let cluster = null;
  if (focusCap || interruptCap || archiveCap || unarchivable || closeTool) {
    cluster = el("div", { class: "command-dock-cluster", role: "group", "aria-label": "Session actions" });
    if (focusCap) cluster.append(renderDockTool(agent, focusCap, "focus", { held, iconOnly: true }));
    if (interruptCap) cluster.append(renderDockTool(agent, interruptCap, "interrupt", { held, iconOnly: true }));
    /* Archive is a peer tile. Hiding the only overflow item behind a three-dot
       <details> made a one-action menu that stole the click. Confirm still
       isolates the destructive step. */
    if (archiveCap) cluster.append(renderDockTool(agent, archiveCap, "archive", { held, iconOnly: true }));
    if (closeTool) cluster.append(closeTool);
    // The undo is not destructive and does not hide behind the lock.
    if (unarchivable) cluster.append(renderDockTool(agent, unarchiveCap, "unarchive", { held, iconOnly: true }));
  }

  const fb = state.feedback.get(agent.id);
  if (fb) {
    dock.append(el("p", {
      class: "control-feedback " + (fb.ok ? "ok" : "err"),
      role: "status",
      text: fb.message,
    }));
  }

  // "Did I already tell this lane to rebase?" — the journal's answer, next to
  // the button that would send it again. Silent until the log has actually
  // loaded: an unanswered endpoint must not read as "nothing was ever sent".
  const last = lastActionFor(actions, agent.id);
  if (last) {
    const outcome = actionOutcomeView(last.outcome);
    dock.append(el("p", { class: "command-dock-last", dataset: { tone: outcome.tone } },
      (ACTION_KIND_LABELS[last.kind] || last.kind)
      + (last.at ? " " + agoText(last.at) : "")
      + " · " + outcome.label));
  }

  // Communicate. The composer is the primary interaction and keeps the primary
  // position — Focus no longer sits above a dead input.
  if (instructCap) {
    const key = agent.id + ":instruct";
    const busy = state.pending.has(key);
    const routeReady = instructCap.enabled && control === "linked";
    const sendable = routeReady && !held;
    const savedDraft = state.drafts.get(agent.id) || "";
    const initialDraft = singleLineInstructionDraft(savedDraft);
    if (initialDraft !== savedDraft) state.drafts.set(agent.id, initialDraft);
    let sendButton = null;
    const syncSend = (draft) => {
      const ready = composerCanSend(routeReady, !held, draft, busy);
      if (!sendButton) return;
      if (ready) sendButton.removeAttribute("disabled");
      else sendButton.setAttribute("disabled", "");
      sendButton.classList.toggle("primary", ready);
    };
    const input = el("textarea", {
      rows: "3",
      placeholder: held
        ? "Waiting for a fresh snapshot…"
        : instructCap.enabled
          ? "Message this agent…"
          : (control === "quarantined"
            ? "Resolve routing in Evidence before messaging…"
            : "Messaging unavailable for this session"),
      disabled: sendable ? null : "",
      value: initialDraft,
      "aria-label": "Instruction for " + agentName(agent),
      dataset: { fkey: "draft:" + agent.id },
      oninput: (e) => {
        // The control API deliberately rejects CR/LF. Keep the wrapping,
        // auto-growing textarea without letting pasted text create a draft the
        // server cannot accept.
        const draft = singleLineInstructionDraft(e.target.value);
        if (draft !== e.target.value) e.target.value = draft;
        state.drafts.set(agent.id, draft);
        syncSend(draft);
        resizeComposer(e.target);
      },
      onkeydown: (e) => {
        if (e.isComposing || e.key !== "Enter") return;
        e.preventDefault();
        if (e.shiftKey) return;
        const text = (state.drafts.get(agent.id) || "").trim();
        if (!composerCanSend(routeReady, !held, text, busy)) return;
        return sendControl(agent, "instruct", text);
      },
    });
    sendButton = el("button", {
      type: "submit",
      class: "command-send" + (composerCanSend(routeReady, !held, initialDraft, busy) ? " primary" : ""),
      disabled: composerCanSend(routeReady, !held, initialDraft, busy) ? null : "",
      "aria-label": busy ? "Sending" : "Send",
      title: busy ? "Sending" : "Send",
      "aria-busy": busy ? "true" : null,
      dataset: { fkey: "act:" + key },
    }, icon("send"));
    const communicate = dockGroup("Communicate");
    const composer = el("form", {
      class: "command-composer",
      onsubmit: (e) => {
        e.preventDefault();
        const text = (state.drafts.get(agent.id) || "").trim();
        if (!composerCanSend(routeReady, !held, text, busy)) return;
        sendControl(agent, "instruct", text);
      },
    },
      input,
      /* Primary means actionable: safe route, fresh snapshot, non-empty draft,
         and no send already in flight. */
      sendButton);
    communicate.append(composer);
    dock.append(communicate);

    // The initial draft may already span lines. Measure again on the next frame,
    // after the drawer has attached the returned dock and layout is available.
    resizeComposer(input);
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resizeComposer(input));
    }
  }

  if (cluster) {
    const secondary = el("div", {
      class: "command-dock-secondary",
      role: "group",
      "aria-label": "Secondary session actions",
    });
    secondary.append(cluster);
    dock.append(secondary);
  }

  return dock;
}

function renderDockTool(agent, cap, action, opts = {}) {
  const key = agent.id + ":" + action;
  const busy = state.pending.has(key);
  const label = ACTION_LABELS[action] || action;
  const isArchive = action === "archive";
  // The head renders a copy of a dock tool without knowing about the feed, so a
  // caller that does not pass `held` still gets the module verdict rather than a
  // silently-live button on a frozen board.
  const held = opts.held === undefined ? feedFrozen() : Boolean(opts.held);
  // Instance-scoped keys: the verdict head renders a copy of a dock tool, so
  // focus restore and the confirm strip must bind to the clicked instance —
  // never both surfaces at once. Busy/sendControl state stays shared via key.
  const fkey = (opts.fkeyPrefix || "") + "act:" + key;
  const confirmKey = (opts.fkeyPrefix || "") + "confirm:" + key;
  const accessibleName = busy
    ? label + "…"
    : action === "focus"
      ? focusButtonLabel(agent, deriveControlState(agent))
      : label;

  if (state.confirming === fkey) {
    return el("span", { class: "confirm-strip command-confirm", role: "group",
      "aria-label": label + " " + agentName(agent) + "?" },
      el("span", { text: label + "?" }),
      el("button", {
        type: "button", class: "btn confirm-yes",
        dataset: { fkey: confirmKey },
        onclick: () => { state.confirming = null; sendControl(agent, action); },
      }, "Confirm"),
      el("button", {
        type: "button", class: "btn sm",
        dataset: { fkey: confirmKey + ":cancel" },
        onclick: () => { state.confirming = null; render(); },
      }, "Cancel"));
  }

  return el("button", {
    type: "button",
    class: "dock-tool" + (isArchive ? " dock-tool-warn" : "") + (held ? " is-held" : ""),
    disabled: cap.enabled && !busy && !held ? null : "",
    "aria-busy": busy ? "true" : null,
    title: held ? "Held — the board is not current" : cap.enabled ? (action === "focus" ? focusDestinationHint(agent) : label) : "Unavailable",
    /* OPT-IN, and null everywhere it is not passed, so every existing call site
       keeps the visible label as its accessible name.

       The dock is a one-agent surface where "Focus" is unambiguous. The
       notification panel is the one place several agents' tools sit in one list,
       and there it produced four buttons named exactly "Focus" — measured in the
       AX tree, indistinguishable in a rotor or under voice control. The title
       above carries the destination, but with text content present a title is
       the DESCRIPTION, not the name, and plenty of operators never hear it.
       Naming it at the call site that has the ambiguity beats forking this
       function, which exists to be the one capability gate. */
    "aria-label": opts.ariaLabel || (opts.iconOnly ? accessibleName : null),
    dataset: { fkey },
    onclick: () => {
      if (held) return;
      if (NEEDS_CONFIRM.has(action)) {
        state.confirming = fkey;
        render();
        const btn = document.querySelector(`[data-fkey="${CSS.escape(confirmKey)}"]`);
        if (btn) btn.focus();
        return;
      }
      sendControl(agent, action);
    },
  },
    icon(action === "focus" ? "focus" : action === "interrupt" ? "interrupt" : "archive"),
    /* Icon-only dock tiles name themselves via aria-label. Everywhere else the
       visible label remains the accessible name, so notification Focus stays
       "Focus <agent>" rather than a mute glyph. */
    opts.iconOnly
      ? null
      : accessibleName);
}

/* ---------- sync: closing the terminal ----------

   The board's half of `POST /api/sync/close`. cmux owns every rule about what
   may close; this renders what the route answers and decides nothing itself.
   There is one URL, no retry, and exactly two request shapes — the frozen
   surface envelope and the frozen workspace envelope. */

/* Why close is gated harder than the rest of the dock.

   Focus and Send accept `unique-cwd`: the board calls such a row `linked`,
   because looking at a pane and typing into one are recoverable if the folder
   match picked the wrong terminal. Closing is not recoverable, so it takes the
   strictest resolution the identity tiers can mint and nothing weaker. A gate
   written as "linked" would put a destructive button on a folder-strength
   guess.

   `isTerminal` is the other half: a finished session and a session that has
   left the scan window are both records rather than live terminals, and there
   is nothing behind them to close. Returns null for those (no control at all),
   a disabled view with a reason for everything short of exact. */
function syncCloseView(agent) {
  if (!agent || isTerminal(agent)) return null;
  const target = (agent && agent.target) || { resolution: "missing" };
  const surfaceId = target.surfaceId || "";
  if (target.resolution === "exact" && surfaceId) return { enabled: true, surfaceId, reason: "" };
  return { enabled: false, surfaceId, reason: syncCloseReason(surfaceId ? target.resolution : "missing") };
}

/* Operator language, deliberately NOT the resolver's `reason` string, for the
   same cause renderControlBanner states at length: served reasons carry raw
   cmux evidence ("surface a1b2 is claimed by two sessions"), and this sentence
   is read by a person deciding whether to destroy a terminal. */
function syncCloseReason(resolution) {
  if (resolution === "unique-cwd") return "This session is matched by folder only — closing needs an exact terminal match.";
  if (resolution === "ambiguous") return "More than one terminal claims this session, so closing could close the wrong one.";
  return "No cmux terminal is linked to this session.";
}

/* The dock's most destructive tile. Same shape, classes and held-behaviour as
   renderDockTool, but deliberately NOT routed through it: that function is the
   one gate over the server's ControlCapability list, and close is not on it —
   it is a cmux write with its own route and its own resolution rule. */
function renderSyncCloseTool(agent, opts = {}) {
  const view = syncCloseView(agent);
  if (!view) return null;
  const key = agent.id + ":sync-close";
  const busy = state.pending.has(key);
  const held = opts.held === undefined ? feedFrozen() : Boolean(opts.held);
  const blocked = !view.enabled || held || busy;
  const label = "Close terminal";
  return el("button", {
    type: "button",
    class: "dock-tool dock-tool-warn sync-close-tool" + (held ? " is-held" : ""),
    disabled: blocked ? "" : null,
    "aria-busy": busy ? "true" : null,
    title: held ? "Held — the board is not current" : view.enabled ? label : view.reason,
    /* Icon-only tile, so the reason has to travel with the accessible NAME: a
       title on an element with no text content is a description plenty of
       operators never hear, and "why is this off" is the whole point of
       rendering a disabled control instead of hiding it. */
    "aria-label": busy ? label + "…" : view.enabled ? label : label + " — unavailable: " + view.reason,
    dataset: { fkey: "sync-close:" + agent.id },
    onclick: () => {
      if (blocked) return;
      sendSyncClose(agent, { target: "surface", id: view.surfaceId });
    },
  }, icon("close"));
}

/* The escalation envelope, read strictly or not at all.

   `invalid_state` on the last surface in a workspace is the one refusal that
   turns into a question for a person, and the question is "these agents die
   too — still?". Answering it requires the workspace this is about and the
   full casualty list, so a payload missing either is not downgraded into a
   quieter dialog: it produces none.

   The `length` check is the important line. Dropping entries the client cannot
   name would render "No other agents share this workspace" over a list that
   holds two of them — a fixture-shaped reply buying a confident sentence about
   something nobody read. Partial understanding of the envelope is treated as
   no understanding. */
function syncCloseEscalation(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const workspaceId = typeof raw.workspaceId === "string" ? raw.workspaceId.trim() : "";
  if (!workspaceId || !Array.isArray(raw.siblingAgents)) return null;
  const siblingAgents = raw.siblingAgents
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      const name = (typeof entry.name === "string" ? entry.name.trim() : "") || id;
      return name ? { id, name } : null;
    })
    .filter(Boolean);
  if (siblingAgents.length !== raw.siblingAgents.length) return null;
  return { workspaceId, siblingAgents };
}

/* What a reply MEANS, separated from what is done about it so the classification
   is testable without a DOM and cannot drift between the two call sites. HTTP
   completion is never a close: only `ok === true` is. */
function syncCloseVerdict(reply) {
  const body = reply && reply.body && typeof reply.body === "object" ? reply.body : null;
  if (body && body.ok === true) return { kind: "ok", message: "Terminal closed." };
  if (body && body.ok === false) {
    const code = typeof body.code === "string" ? body.code : "";
    if (code === "invalid_state" || code === "confirm_required") {
      const escalation = syncCloseEscalation(body.escalation);
      if (escalation) return { kind: "escalate", code, escalation };
      return { kind: "failed", message: "Close refused (" + code + ") without naming the workspace it would take. Nothing was closed." };
    }
    const detail = typeof body.detail === "string" && body.detail ? ": " + body.detail : "";
    return { kind: "failed", message: "Close refused" + (code ? " (" + code + ")" : "") + detail };
  }
  return { kind: "failed", message: "Close failed: the server answered HTTP " + (reply && reply.status) + " with an unexpected response." };
}

/* The one writer. Both envelopes go through here, so the pending key, the
   feedback record and the escalation branch cannot disagree between the tile
   and the dialog's confirm. */
async function sendSyncClose(agent, body) {
  const key = agent.id + ":sync-close";
  if (state.pending.has(key)) return;
  state.pending.add(key);
  state.feedback.delete(agent.id);
  render();

  let verdict;
  try {
    const res = await apiFetch("/api/sync/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, API_WRITE_TIMEOUT_MS);
    let payload = null;
    try { payload = await res.json(); } catch { /* non-JSON body */ }
    verdict = syncCloseVerdict({ status: res.status, body: payload });
  } catch (err) {
    verdict = { kind: "failed", message: err && err.message ? err.message : "Close failed" };
  }

  state.pending.delete(key);
  if (verdict.kind === "escalate") {
    /* Not an error, and never retried: cmux refusing to strand a workspace is
       the signal that a bigger decision is due. No toast either — a failure
       affordance beside a dialog asking for a decision reads as "something went
       wrong", and nothing has. */
    state.syncClose = { agentId: agent.id, code: verdict.code, ...verdict.escalation };
    render();
    focusSyncCloseCancel(agent);
    return;
  }
  state.syncClose = null;
  state.feedback.set(agent.id, { ok: verdict.kind === "ok", action: "sync-close", message: verdict.message });
  render();
  toast(verdict.message.split("\n")[0], verdict.kind === "ok" ? "ok" : "err");
}

/* After the repaint, never before: the node this handler was built on is
   detached by then, and focusing a detached element is a silent no-op that
   lands the operator on <body>. */
function focusSyncCloseCancel(agent) {
  if (typeof document === "undefined" || !document.querySelector) return;
  const node = document.querySelector(`[data-fkey="sync-close-cancel:${CSS.escape(agent.id)}"]`);
  if (node && node.focus) node.focus();
}

function cancelSyncClose() {
  state.syncClose = null;
  render();
}

const SYNC_CLOSE_LEDE = {
  invalid_state: "This is the last terminal in its workspace, so cmux will not close it on its own. Closing the workspace closes everything in it.",
  confirm_required: "Closing a workspace closes every terminal in it.",
};

/* The escalation dialog. It exists to state a cost before it is paid, so every
   sentence in it is either the route's own data or a fact about what the
   confirm button does — no reassurance, no summary of what was attempted.

   Modal in the ARIA sense (role + aria-modal) and in the keyboard sense: Tab is
   trapped between the two buttons and Escape cancels. Escape stops here rather
   than bubbling, because the board's own Escape chain would otherwise carry on
   past a cancelled dialog and close the drawer behind it. */
function renderSyncCloseDialog(agent) {
  const record = state.syncClose;
  if (!agent || !record || record.agentId !== agent.id) return null;
  const siblings = record.siblingAgents || [];
  const busy = state.pending.has(agent.id + ":sync-close");
  const titleId = "sync-close-title-" + agent.id;

  const cancel = el("button", {
    type: "button",
    class: "btn sync-close-cancel",
    dataset: { fkey: "sync-close-cancel:" + agent.id },
    onclick: () => cancelSyncClose(),
  }, "Cancel");
  const confirm = el("button", {
    type: "button",
    class: "btn sync-close-confirm",
    disabled: busy ? "" : null,
    "aria-busy": busy ? "true" : null,
    dataset: { fkey: "sync-close-confirm:" + agent.id },
    onclick: () => sendSyncClose(agent, { target: "workspace", id: record.workspaceId, confirm: true }),
  }, busy ? "Closing…" : "Close workspace");
  const stops = [cancel, confirm];

  const roster = siblings.length
    ? el("div", { class: "sync-close-siblings" },
      el("p", { class: "sync-close-siblings-lead", text: siblings.length === 1
        ? "One other agent is working in this workspace and closes with it:"
        : siblings.length + " other agents are working in this workspace and close with it:" }),
      el("ul", { class: "sync-close-sibling-list" },
        ...siblings.map((sibling) => el("li", { class: "sync-close-sibling", text: sibling.name }))))
    : el("p", { class: "sync-close-siblings-empty", text: "No other agents share this workspace." });

  return el("div", {
    class: "sync-close-dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": titleId,
    onkeydown: (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelSyncClose();
        return;
      }
      if (event.key !== "Tab") return;
      event.preventDefault();
      /* The stops are the dialog's own nodes rather than a selector query: the
         trap must hold on the elements this paint built, and a query would also
         reach whatever the board left behind it. */
      const at = stops.indexOf(typeof document !== "undefined" ? document.activeElement : null);
      const next = event.shiftKey
        ? stops[(at <= 0 ? stops.length : at) - 1]
        : stops[(at + 1) % stops.length];
      if (next && next.focus) next.focus();
    },
  },
    el("div", { class: "sync-close-inner" },
      el("h2", { id: titleId, class: "sync-close-title", text: "Close " + agentName(agent) + "’s workspace?" }),
      el("p", { class: "sync-close-lede", text: SYNC_CLOSE_LEDE[record.code] || SYNC_CLOSE_LEDE.confirm_required }),
      roster,
      el("p", { class: "sync-close-warning", text: "Closing a workspace cannot be undone." }),
      el("div", { class: "sync-close-actions" }, cancel, confirm)));
}

function sourceWorkspaceLabel(target) {
  return target.workspaceTitle ? "terminal: " + target.workspaceTitle : "terminal workspace";
}

function sourceRoomLabel(target) {
  return target.workspaceTitle ? "terminal: " + target.workspaceTitle : "terminal";
}

function presentationLabelTargets(agent) {
  const targets = [];
  /* The agent goes FIRST because it is the only one of the three that names
     this session and nothing else. A workspace label names a cmux pane, and
     sibling panes share one — so renaming by workspace silently renames every
     sibling at once, which is the opposite of what an operator reaching for
     "give this agent a name" is asking for. It led the list purely because it
     was the first `if` written. */
  if (agentLabelEligible(agent)) {
    targets.push({
      target: agentLabelTarget(agent),
      kind: "agent",
      source: sourceAgentName(agent),
      sourceEvidence: "Source agent: " + sourceAgentName(agent) + " · id stays " + agent.id,
    });
  }
  if (agent.target && agent.target.workspaceId) {
    const terminal = terminalSourceName(agent) || sourceWorkspaceLabel(agent.target);
    targets.push({
      target: workspaceLabelTarget(agent.target.workspaceId),
      kind: "workspace",
      source: terminal.startsWith("terminal:") ? terminal : "terminal: " + terminal,
      sourceEvidence: "Terminal / workspace: " + terminal + " · id stays " + agent.target.workspaceId,
    });
  }
  if (agent.target && agent.target.surfaceId) {
    targets.push({
      target: roomLabelTarget(agent.target.surfaceId),
      kind: "room",
      source: sourceRoomLabel(agent.target),
      sourceEvidence: "Terminal surface id stays " + agent.target.surfaceId,
    });
  }
  return targets;
}

/* Names (presentation labels) stay collapsed — rare rename UI, not chrome. */
function renderNamesDisclosure(agent) {
  const targets = presentationLabelTargets(agent);
  if (!targets.length && !state.labelsLoading && !state.labelLoadError) return null;

  const body = el("div", { class: "presentation-labels" });
  if (state.labelsLoading) body.append(el("p", { class: "label-status", text: "Loading saved labels…" }));
  if (state.labelLoadError) {
    body.append(el("p", {
      class: "label-status err", role: "status",
      text: "Saved labels unavailable: " + state.labelLoadError,
    }));
  }
  for (const item of targets) {
    const key = presentationLabelKey(item.target);
    const label = state.aliases.get(key);
    const editing = state.renaming === key;
    const actionText = label ? "Edit" : item.kind === "agent" ? "Name agent" : "Name " + item.kind;
    const row = el("div", { class: "label-row" },
      el("div", { class: "label-copy" },
        el("span", { class: "label-value", text: label || item.source }),
        el("span", { class: "label-source", text: "Source: " + item.source })),
      editing ? null : el("button", {
        type: "button", class: "btn label-action",
        "aria-label": actionText + " " + item.kind + " label",
        dataset: { fkey: "label-edit:" + key },
        onclick: () => startRename(item.target),
      }, actionText));
    body.append(row);
    if (editing) {
      body.append(renderLabelForm(item.target, {
        inputKey: "label-input:" + key,
        placeholder: "Display label for this " + item.kind,
        ariaLabel: "New display label for " + item.kind,
        source: item.sourceEvidence,
      }));
    }
  }

  const editingHere = targets.some((item) => state.renaming === presentationLabelKey(item.target));
  const disclosure = el("details", {
    class: "names-disclosure",
    // Stay open while a rename form is live so re-render does not tuck it away.
    open: editingHere || state.labelsLoading || state.labelLoadError ? "" : null,
  },
    el("summary", {}, icon("shield", { label: "" }), " Names"),
    body);
  disclosure.dataset.evidenceSection = "names";
  return disclosure;
}

/* ---------- inspector: Operate · Chat · Evidence ---------- */

function dtdd(grid, label, value, opts = {}) {
  // Take C hard rule: if a value isn’t there, the field isn’t rendered.
  if (value == null || value === "") return;
  const hint = opts.hint ?? GLOSSARY[label];
  grid.append(hint
    ? el("dt", {}, el("span", {
        class: "term-hint", tabindex: "0",
        title: hint, "aria-label": `${label}: ${hint}`, text: label,
      }))
    : el("dt", { text: label }));
  const dd = el("dd", opts.wide ? { class: "is-wide" } : {});
  if (value.nodeType) dd.append(value);
  else dd.append(opts.code ? el("code", { text: String(value) }) : String(value));
  grid.append(dd);
}

/* The facts the row stopped printing, plus the one it never had room for.
   Null when the session has none of them, so a clean row's drawer gains nothing
   — the omit-empty rule the rest of Evidence follows.

   Every value here comes from the same helper the row used to call
   (`roleView`, `terminalBreadcrumb`, `rowStalenessText`,
   `historyProvenance`). Re-deriving any of them here is how two surfaces start
   disagreeing about one session, which is the failure this file has a comment
   about roughly every two hundred lines. */
function renderRowFacts(agent) {
  const role = roleView(agent.role);
  const provenance = historyProvenance(agent);
  const source = roleSourceView(agent.roleSource);
  const rows = [
    // Role removed here — rendered as badge in Evidence grid (content crit: ROLE as badge, not row)
    specialtyLabel(agent) ? ["specialty", specialtyLabel(agent), {}] : null,
    (() => {
      const crumb = terminalBreadcrumb(agent, agentName(agent));
      return crumb ? ["terminal", crumb, { hint: focusDestinationHint(agent) }] : null;
    })(),
    provenance ? ["history record", provenance.label, { hint: provenance.title }] : null,
  ].filter(Boolean);

  // Counted before building rather than read back off the node: `dtdd` skips an
  // absent value silently, and asking the built <dl> how many children it has
  // is a DOM question this helper does not need to ask to answer it.
  if (!rows.length) return null;
  const grid = el("dl", { class: "detail-grid" });
  for (const [label, value, opts] of rows) dtdd(grid, label, value, opts);
  return grid;
}

function normalizeCompareText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function transcriptArtifact(agent) {
  return (agent.artifacts || []).find((a) => a && (a.kind === "transcript" || /transcript/i.test(a.label || "")));
}

/* renderOperate and renderOperateMeta are deleted, not merged.

   Operate was never a tab; it was four fields from four different domains sharing
   a heading, and every one of them had a better home:

     "Last human message" -> deleted. Byte-identical to Thread's user turn on 37%
        of the board, and on active agents it was the ASSISTANT's prose printed
        under a label claiming a human wrote it.
     "Task"               -> the head, as the objective line. It is the only field
        that distinguishes one lane from another when 19 of 22 share a name.
     outcome note         -> the status line, which now speaks only on escalation.
     role + model chips   -> deleted. The row renders the role chip on exactly the
        same condition, and model is already in the head's provider chip. Both
        were third printings.

   With those redistributed the function returned an empty panel and its own
   "No operate digest yet" placeholder — a tab whose only remaining content was an
   apology for having none. */

/* Collector front windows are 240 characters, word-broken, then an ellipsis.
   Chat may paint that window while the transcript is missing — common on Grok
   rows. A chevron is only honest when there is more to show: an unknown or
   still-loading record might grow, but an empty loaded file is the whole
   window, no disclosure. Long loaded speech uses the same control to collapse
   to about six lines. Side and fill say who spoke; run ids stay in Evidence. */
const CHAT_COLLAPSE_LINES = 6;
const CHAT_COLLAPSE_CHARS = 240;
const expandedChatSpeech = new Map();

function isCollectorWindowText(text) {
  return /…$/.test(String(text || "").trim());
}

function transcriptOffersMoreSpeech(agent, ui) {
  const view = (ui && ui.transcript) || {};
  if (view.agentId !== agent.id) return true;
  if (view.loading) return true;
  if (view.data) return Array.isArray(view.data.lines) && view.data.lines.length > 0;
  return !view.error;
}

function chatSpeechNeedsCollapse(text, opts = {}) {
  const value = String(text || "");
  if (!value) return false;
  if (opts.preview && isCollectorWindowText(value) && opts.canRevealMore !== false) return true;
  if (value.split(/\r?\n/).length > CHAT_COLLAPSE_LINES) return true;
  return value.length > CHAT_COLLAPSE_CHARS;
}

function chatSpeakerName(role, sender) {
  if (sender && sender.name) return sender.name;
  if (role === "user" || role === "task") return "You";
  return "Agent";
}

function chatSpeechKey(agentId, role, text) {
  const value = String(text || "");
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return String(agentId || "") + ":" + String(role || "") + ":" + hash.toString(36);
}

function chatSpeechProse(line, ui) {
  if (line && line.sender) return String(line.text || "");
  const text = String((line && line.text) || "");
  return senderView(text, ui) ? withoutSenderHeader(text) : text;
}

function chatSpeechMoreLabel(expanded, preview, prose) {
  if (expanded) return "Show less";
  return preview && isCollectorWindowText(prose) ? "Open full turn" : "Show more";
}

function chatSpeechExpanded(agentId, role, prose) {
  const key = chatSpeechKey(agentId, role, prose);
  if (expandedChatSpeech.has(key)) return true;
  const prefix = String(agentId || "") + ":" + String(role || "") + ":";
  for (const [storedKey, stored] of expandedChatSpeech) {
    if (!String(storedKey).startsWith(prefix)) continue;
    if (isSameProse(String(stored || ""), String(prose || ""))) return true;
  }
  return false;
}

function matchingChatSpeechKeys(agentId, role, key, prose) {
  const keys = new Set([key]);
  const prefix = String(agentId || "") + ":" + String(role || "") + ":";
  for (const [storedKey, stored] of expandedChatSpeech) {
    if (storedKey !== key && !String(storedKey).startsWith(prefix)) continue;
    if (storedKey === key || isSameProse(String(stored || ""), String(prose || ""))) keys.add(storedKey);
  }
  return keys;
}

function revealChatSpeech(agent, key, opts = {}) {
  const prose = String(opts.prose || "");
  const matches = matchingChatSpeechKeys(agent.id, opts.role, key, prose);
  const open = [...matches].some((item) => expandedChatSpeech.has(item));
  if (open) {
    for (const item of matches) expandedChatSpeech.delete(item);
  } else {
    expandedChatSpeech.set(key, prose);
  }
  if (!opts.preview || !isCollectorWindowText(opts.prose)) return;
  const view = state.transcript || {};
  if (view.agentId === agent.id && (view.loading || view.error || view.data)) return;
  return loadTranscript(agent.id);
}

/* The sender as a NAME. `agent.id` is `provider:sourceSessionId` — durable, and
   unreadable — so it is resolved through the same fleet index every other
   cross-agent surface uses. A sender that is not on the board (filtered out,
   retired, or never collected) keeps its id: the honest answer is the id, not a
   blank where an attribution should be. */
function senderView(text, ui = state) {
  const parsed = parseSenderHeader(text);
  if (!parsed) return null;
  const known = agentsById(ui && ui.snap).get(parsed.agentId);
  return {
    agentId: parsed.agentId,
    runId: parsed.runId,
    name: known ? agentName(known.agent) : parsed.agentId,
  };
}

/* Drops any turn whose text repeats one already shown. This is the rule that
   makes "every surviving field appears exactly once" true by construction rather
   than by inspection: the three message fields overlap constantly on real data —
   lastHumanMessage was byte-identical to lastAgentMessage on 18 of 22 active
   agents — so any renderer that trusts the field NAMES prints the same prose
   twice under two labels. Compare the text, not the field. */
/* Two normalised strings that are the same prose. Either identical, or one is
   the server's truncation of the other — the collectors cut long text and append
   an ellipsis, so the short copy is a prefix of the long one and ends in "…". */
function isSameProse(a, b) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 24 || !long.startsWith(short.replace(/…$/, ""))) return false;
  return /…$/.test(short);
}

function dedupeTurns(candidates) {
  const seen = [];
  const kept = [];
  for (const turn of candidates) {
    const text = typeof turn.text === "string" ? turn.text.trim() : "";
    if (!text) continue;
    const norm = normalizeCompareText(text);
    /* Repetition, not containment. This used to drop a turn whenever either text
       contained the other, which is a much bigger net than it looks: an agent
       that quotes the operator's instruction back before answering — extremely
       common — was judged a repeat of the user turn and dropped WITH its answer
       attached, so the operator saw their own message and no reply from an agent
       that had replied.

       A turn is a repeat only if it says the same thing: identical after
       normalising, or the same text with one side truncated by the server (which
       appends an ellipsis, so the shorter copy is a prefix that ends in one). */
    if (!norm || seen.some((prev) => isSameProse(prev, norm))) continue;
    seen.push(norm);
    kept.push({ ...turn, text });
  }
  return kept;
}

/* Thread — the drawer's one reading surface. Preview collector windows and the
   loaded transcript share one bubble. The provider task is a fallback only when
   no real speech is on screen; once a user or assistant turn is present, kickoff
   stays out of the feed. `lastHumanMessage` is deliberately not a fallback:
   the server documents it as mixed assistant-or-user prose. */
function decorateChatTurn(turn, agent, ui) {
  const sender = senderView(turn.text, ui);
  if (!sender) return turn;
  /* The verdict belongs to ONE turn: the field the server actually checked.
     `senderClaimText` is the mirror of the server's own candidate choice, so
     marking any other headed turn — `task`, which keeps its kickoff envelope
     forever — would flag a message nobody verified. */
  const unconfirmed = agent.senderVerified === false && turn.text === senderClaimText(agent);
  return {
    ...turn,
    text: withoutSenderHeader(turn.text),
    sender: unconfirmed ? { ...sender, unconfirmed: true } : sender,
  };
}

function previewChatTurns(agent, ui = state) {
  const tldrTail = typeof agent.transcriptTail === "string" && agent.transcriptTail.includes("[TL;DR")
    ? agent.transcriptTail.trim()
    : "";
  /* The agent's reply leads. An operator opens this to find out what the AGENT
     said; their own message is the one thing in the drawer they already know.
     The envelope is stripped before dedupe so two addressed copies of the same
     prose collapse to one bubble. */
  const speech = dedupeTurns([
    { role: "assistant", text: previewAssistantText(agent) },
    { role: "assistant", text: tldrTail },
    { role: "user", text: previewUserText(agent) },
  ].map((turn) => decorateChatTurn(turn, agent, ui)));
  if (speech.length) return speech;
  return dedupeTurns([{ role: "task", text: agent.task }].map((turn) => decorateChatTurn(turn, agent, ui)));
}

function renderChat(agent, ui = state, opts = {}) {
  const feed = el("div", { class: "chat-feed" });
  for (const turn of previewChatTurns(agent, ui)) {
    feed.append(chatMessageGroupNode(
      [{ at: null, role: turn.role, text: turn.text, sender: turn.sender || null }],
      agent,
      ui,
      { preview: true },
    ));
  }
  if (!feed.childNodes.length && !opts.suppressEmptyState) {
    feed.append(chatFeedStateNode(
      "empty", "scroll-text", "No readable turns yet",
      "No readable turns recorded for this session yet.",
    ));
  }
  return feed;
}

/* Consecutive transcript speech from one role/sender as a chat bubble. Side and
   fill say who spoke; time can stay quiet. The sender-verdict mark states the
   server's finding on the ONE text it actually checked (senderClaimText), and
   an absent verdict marks nothing at all. */
function chatMessageGroupKey(line) {
  const sender = parseSenderHeader(line.text);
  return line.role + ":" + (sender ? sender.agentId + ":" + sender.runId : "direct");
}

function chatMessageGroupNode(lines, agent, ui = state, opts = {}) {
  const preview = opts.preview === true;
  const first = lines[0];
  const sender = first.sender || senderView(first.text, ui);
  const unconfirmed = Boolean(sender && (
    sender.unconfirmed
    || (agent.senderVerified === false && lines.some((line) => line.text === senderClaimText(agent)))
  ));
  const bubble = el("div", {
    class: "chat-msg",
    dataset: { role: first.role },
    role: "group",
    "aria-label": chatSpeakerName(first.role, sender),
  });
  if (unconfirmed) {
    bubble.append(el("div", {
      class: "sender-unconfirmed",
      title: "The claimed sender's own transcript does not contain this message. Treat the attribution as unproven and check the sender before acting on it.",
    }, icon("warning"), el("span", { text: "Sender unconfirmed" })));
  }
  for (const line of lines) {
    const prose = chatSpeechProse(line, ui);
    const key = chatSpeechKey(agent.id, line.role, prose);
    const canRevealMore = !preview || transcriptOffersMoreSpeech(agent, ui);
    const needs = chatSpeechNeedsCollapse(prose, { preview, canRevealMore });
    const expanded = chatSpeechExpanded(agent.id, line.role, prose);
    const body = el("p", {
      class: "chat-msg-body" + (needs && !expanded ? " is-collapsed" : ""),
      text: prose,
    });
    let more = null;
    if (needs) {
      more = el("button", {
        type: "button",
        class: "chat-msg-more" + (expanded ? " is-open" : ""),
        "aria-expanded": expanded ? "true" : "false",
        "aria-label": chatSpeechMoreLabel(expanded, preview, prose),
        dataset: { fkey: "chat-more:" + key },
        onclick: (event) => {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          if (event && typeof event.stopPropagation === "function") event.stopPropagation();
          const pending = revealChatSpeech(agent, key, { preview, prose, role: line.role });
          const open = chatSpeechExpanded(agent.id, line.role, prose);
          body.classList.toggle("is-collapsed", !open);
          more.classList.toggle("is-open", open);
          more.setAttribute("aria-expanded", String(open));
          more.setAttribute("aria-label", chatSpeechMoreLabel(open, preview, prose));
          return pending;
        },
      }, icon("chevron"));
    }
    const at = line.at
      ? el("time", { class: "chat-msg-at", datetime: line.at, title: line.at, text: agoText(line.at) })
      : null;
    const content = el("div", { class: "chat-msg-content" }, body);
    if (at || more) content.append(el("div", { class: "chat-msg-foot" }, at, more));
    bubble.append(content);
  }
  return bubble;
}

function chatBubbleNode(line, agent, ui = state) {
  return chatMessageGroupNode([line], agent, ui);
}

/* A loaded transcript object can survive many unrelated dashboard repaints.
   Remember which payload already entered so rebuilding the drawer never
   replays the conversation's entrance motion. */
const enteredTranscriptPayloads = new WeakSet();

/* The feed's one body. The transcript, when it is held for THIS agent, rendered
   as grouped speech bubbles and grouped tool activity; system and unknown turns
   stay quiet .tr-line rows between them. Otherwise the preview thread stands
   in: loading, errored, or a session with no record yet. Preview and loaded
   speech share chatMessageGroupNode, so the pane never swaps visual languages. */
function renderChatFeedBody(agent, ui = state, opts = {}) {
  const view = (ui && ui.transcript) || {};
  const held = view.agentId === agent.id;
  const lines = held && view.data && view.data.lines.length
    ? transcriptWindow(view.data.lines).shown
    : null;
  if (!lines) return renderChat(agent, ui, {
    ...opts,
    suppressEmptyState: held && Boolean(view.loading || view.error || view.data),
  });
  const shouldAnimateEntry = typeof view.data === "object"
    && view.data !== null
    && !enteredTranscriptPayloads.has(view.data);
  const body = el("div", { class: "chat-feed" });
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (line.role === "user" || line.role === "assistant") {
      const key = chatMessageGroupKey(line);
      const group = [line];
      while (i + group.length < lines.length) {
        const next = lines[i + group.length];
        if ((next.role !== "user" && next.role !== "assistant") || chatMessageGroupKey(next) !== key) break;
        group.push(next);
      }
      body.append(chatMessageGroupNode(group, agent, ui));
      i += group.length;
      continue;
    }
    /* Reasoning before tools: a thought is a `system` line by wire contract,
       so it must be claimed here or it falls through to the quiet row below
       and a thousand of them bury the answer. */
    if (thoughtText(line) !== null) {
      const group = [line];
      while (i + group.length < lines.length && thoughtText(lines[i + group.length]) !== null) {
        group.push(lines[i + group.length]);
      }
      body.append(thoughtGroupNode(group));
      i += group.length;
      continue;
    }
    if (line.role === "tool") {
      const group = [line];
      while (i + group.length < lines.length && lines[i + group.length].role === "tool") {
        group.push(lines[i + group.length]);
      }
      body.append(toolActivityNode(group));
      i += group.length;
      continue;
    }
    // System warnings and unknown provider events stay standalone.
    body.append(transcriptLineNode(line));
    i += 1;
  }
  /* Kickoff is not a fake last bubble. Once user or assistant speech is on
     screen, the provider task stays out of the feed. Tool-only or empty
     records can still use it as the one readable turn. */
  const hasSpeech = lines.some((line) => line.role === "user" || line.role === "assistant");
  if (!hasSpeech) {
    const taskFloor = dedupeTurns([
      ...lines.map((line) => ({ role: line.role, text: withoutSenderHeader(line.text) })),
      { role: "task", text: withoutSenderHeader(agent.task) },
    ]).at(-1);
    if (taskFloor?.role === "task") {
      const headed = decorateChatTurn({ role: "task", text: agent.task }, agent, ui);
      body.append(chatMessageGroupNode(
        [{ at: null, role: "task", text: headed.text, sender: headed.sender || null }],
        agent,
        ui,
      ));
    }
  }
  if (shouldAnimateEntry) {
    const entry = body.childNodes[body.childNodes.length - 1];
    entry?.classList?.add("chat-entry");
    enteredTranscriptPayloads.add(view.data);
  }
  return body;
}

/* Lineage spine — the signature nesting element. Ancestors climb a single thin
   rail to the current agent (a filled provider-colored ring); direct children
   fan out below. Depth is encoded by color, never by indentation, so it can
   never degrade into a repeated card stack. Deep chains (>4 ancestors) collapse
   the middle into a ⋯ breadcrumb crumb (plan §4). */
function lineageMeta(text) {
  return el("span", { class: "dw-lin-meta", text: " " + text });
}

function lineageNode(a, depthCls, board) {
  const rv = roleView(a.role);
  return el("div", { class: "dw-node " + depthCls },
    el("span", { class: "dw-rail" }, el("span", { class: "dw-glyph", "aria-hidden": "true" })),
    el("button", {
      type: "button", class: "dw-lin-name",
      dataset: { fkey: "lineage:" + a.id },
      onclick: () => selectEntity({ kind: "agent", id: a.id }),
    }, displayNameWithTag(a, board), rv.key !== "agent" ? lineageMeta("· " + rv.label) : null));
}

function lineageCrumb(text) {
  return el("div", { class: "dw-node" },
    el("span", { class: "dw-rail" }, el("span", { class: "dw-glyph", "aria-hidden": "true" })),
    el("span", { class: "dw-lin-crumb", text }));
}

function lineageKid(child, board) {
  const act = deriveActivity(child);
  const outcome = deriveOutcome(child);
  const needs = outcome !== "healthy" && act !== "ended";
  const dotCls = needs ? "dw-dot--needs" : act === "working" ? "dw-dot--work" : act === "ended" ? "dw-dot--end" : "dw-dot--idle";
  const stateText = needs ? OUTCOME_LABELS[outcome] : ACTIVITY_LABELS[act];
  return el("button", {
    type: "button", class: "dw-kid",
    dataset: { fkey: "lineage-kid:" + child.id },
    onclick: () => selectEntity({ kind: "agent", id: child.id }),
  }, el("span", { class: "dw-dot " + dotCls, "aria-hidden": "true" }), displayNameWithTag(child, board) + " — " + stateText);
}

function renderLineageSpine(agent) {
  /* Once for the whole spine, not once per node: every name on it asks the same
     fleet-wide question, and a chain plus a five-child fan would otherwise
     rebuild the board index seven times per drawer paint. */
  const board = boardIndex(state);
  const rawById = new Map(snapshotAgents(state.snap).map(({ agent: a }) => [a.id, a]));
  const fullById = new Map([...rawById].filter(([, candidate]) => dashboardVisible(candidate)));
  const children = [...fullById.values()].filter((a) => a.parentAgentId === agent.id);
  const ancestors = [];
  const seen = new Set([agent.id]);
  let p = agent.parentAgentId ? fullById.get(agent.parentAgentId) : null;
  while (p && !seen.has(p.id)) { seen.add(p.id); ancestors.push(p); p = p.parentAgentId ? fullById.get(p.parentAgentId) : null; }
  ancestors.reverse(); // root → immediate parent
  const untrackedParent = !!agent.parentAgentId && !rawById.has(agent.parentAgentId);

  if (!ancestors.length && !children.length && !untrackedParent) return el("span", { hidden: "" });

  const lin = el("div", { class: "dw-lin" });
  if (untrackedParent) {
    lin.append(lineageCrumb("Orchestrator not tracked"));
  } else if (ancestors.length > 4) {
    // Collapse the middle; keep the nearest ancestor next to the current node.
    lin.append(lineageCrumb("⋯ " + (ancestors.length - 1) + " earlier ancestors"));
    lin.append(lineageNode(ancestors[ancestors.length - 1], "dw-d2", board));
  } else {
    ancestors.forEach((a, i) => lin.append(lineageNode(a, "dw-d" + Math.min(i, 2), board)));
  }
  lin.append(el("div", { class: "dw-node dw-cur" },
    el("span", { class: "dw-rail" }, el("span", { class: "dw-glyph", "aria-hidden": "true" })),
    el("span", { class: "dw-lin-name dw-cur-name" }, displayNameWithTag(agent, board), lineageMeta("· this"))));

  const spine = el("div", { class: "dw-spine", "aria-label": "Lineage" },
    el("div", { class: "dw-spine-label" }, icon("git-merge", { label: "" }), "Lineage"),
    lin);

  if (children.length) {
    const fan = el("div", { class: "dw-child-fan" });
    for (const child of children.slice(0, 5)) fan.append(lineageKid(child, board));
    if (children.length > 5) fan.append(el("span", { class: "dw-more", text: "+" + (children.length - 5) + " more subagents" }));
    spine.append(fan);
  }
  return spine;
}

/* ---------- inspector: Evidence ---------- */

const EXHIBIT_MARK = {
  workspace: { src: "/icons/folder.svg", alt: "Workspace" },
  git: { src: "/icons/git.svg", alt: "Git" },
  pr: { src: "/icons/github.svg", alt: "GitHub" },
  route: { src: "/icons/route.svg", alt: "Route" },
  history: { src: "/icons/history.svg", alt: "History" },
};

const ROUTE_BIND_KICKERS = {
  recorded: "Recorded target",
  session: "Session ID",
  cwd: "Working folder",
};

const ROUTE_CHIPS = {
  exact: { text: "Exact", className: "route-chip route-chip--exact" },
  "unique-cwd": { text: "Unique folder", className: "route-chip" },
  ambiguous: { text: "Quarantined", className: "route-chip route-chip--lock" },
};

function exhibitHead({ mark, title, section, extra, markClass, markTitle }) {
  const head = el("div", { class: "exhibit-head" },
    el("span", {
      class: "exhibit-mark" + (markClass ? " " + markClass : ""),
      title: markTitle || undefined,
    }, el("img", { src: mark.src, alt: mark.alt, width: "16", height: "16" })),
    el("h3", { class: "section-title", dataset: { evidenceSection: section } }, title));
  for (const node of [].concat(extra || []).filter(Boolean)) head.append(node);
  return head;
}

function exhibitShell({ mark, title, section, extra, markClass, markTitle, wrapClass }) {
  const wrap = el("div", { class: wrapClass || "exhibit" });
  wrap.dataset.evidenceSection = section;
  wrap.append(exhibitHead({ mark, title, section, extra, markClass, markTitle }));
  const body = el("div", { class: "exhibit-body" });
  wrap.append(body);
  return { wrap, body };
}

function relativeArtifactPath(cwd, path, label) {
  const raw = typeof path === "string" ? path : "";
  const root = typeof cwd === "string" ? cwd.replace(/\/+$/, "") : "";
  if (root && raw.startsWith(root + "/")) {
    const rel = raw.slice(root.length + 1);
    if (rel) return rel;
  }
  return raw || label || "";
}

function absoluteArtifactPath(cwd, path, shown) {
  const raw = typeof path === "string" ? path.trim() : "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return raw;
  const root = typeof cwd === "string" ? cwd.replace(/\/+$/, "") : "";
  const rel = String(shown || raw).replace(/^\/+/, "");
  if (root && rel) return root + "/" + rel;
  return raw || shown || "";
}

function workspaceFiles(agent) {
  const foot = transcriptArtifact(agent);
  const footPath = foot && typeof foot.path === "string" ? foot.path : "";
  return (agent.artifacts || []).filter((item) => {
    if (!item) return false;
    if (item.kind === "transcript") return false;
    if (footPath && item.path === footPath) return false;
    if (/transcript/i.test(item.label || "") && (!item.kind || item.kind === "transcript")) return false;
    return true;
  });
}

function resolvedIdentityTrace(agent, ui) {
  const identity = ui && ui.identity;
  if (identity && identity.agentId === agent.id && identity.data && identity.data.agent && identity.data.agent.trace) {
    return identity.data.agent.trace;
  }
  return (agent && agent.identityTrace) || null;
}

function routeBindSteps(view) {
  return (view.steps || []).filter((step) => step.outcome !== "skipped");
}

function routeBindClass(outcome) {
  if (outcome === "quarantined" || outcome === "ambiguous") return "route-bind route-bind--lock";
  if (outcome === "no-match" || outcome === "rejected") return "route-bind route-bind--warn";
  return "route-bind";
}

function routeExhibitVisible(agent, view) {
  const resolution = view.resolution;
  if (resolution === "exact" || resolution === "unique-cwd" || resolution === "ambiguous") return true;
  if (deriveControlState(agent) === "quarantined") return true;
  if (quarantineBrief(agent, deriveControlState(agent))) return true;
  if ((view.steps || []).some((step) => step.outcome !== "skipped") || view.reason || view.bridge) return true;
  return false;
}

function gitPresent(git) {
  if (!git) return false;
  const branch = typeof git.branch === "string" ? git.branch.trim() : "";
  const head = typeof git.head === "string" ? git.head.trim() : "";
  return Boolean(branch || head);
}

function historyExhibitVisible(agent) {
  if (scopeOf(agent) === "retained") return true;
  const why = provenanceOf(agent);
  if (why === "process-died" || why === "operator-archive") return true;
  const end = agent && agent.endEvidence;
  return end === "worktree-deleted" || end === "superseded" || end === "turn-complete";
}

function historyExhibitSentence(agent) {
  const provenance = historyProvenance(agent);
  if (provenance) return provenance.label;
  const why = provenanceOf(agent);
  if (why === "process-died") return "Process died.";
  const end = agent && agent.endEvidence;
  if (end === "worktree-deleted") return "Worktree deleted.";
  if (end === "superseded") return "Superseded.";
  if (end === "turn-complete") return "Turn complete.";
  return "";
}

function markCopied(btn) {
  if (!btn || !btn.classList) return;
  btn.classList.add("is-copied");
  setTimeout(() => btn.classList.remove("is-copied"), 900);
}

function pathValue(agent, value, label) {
  return el("span", { class: "evidence-value" },
    el("code", { title: value, text: value }),
    el("button", {
      type: "button",
      class: "artifact-copy evidence-path-copy",
      title: "Copy " + label + " path",
      "aria-label": "Copy " + label + " path",
      dataset: { fkey: `copy-path:${agent.id}:${label}`, fullPath: value },
      onclick: (event) => {
        void copyText(value);
        markCopied(event && event.currentTarget);
      },
    }, icon("copy")));
}

function prShortLabel(url) {
  const raw = String(url || "");
  try {
    const parsed = new URL(raw);
    return (parsed.host + parsed.pathname).replace(/\/$/, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/\/$/, "") || raw;
  }
}

function identityHintLines(data) {
  const lines = [];
  const take = (list) => {
    for (const hint of list || []) {
      if (typeof hint === "string") {
        const text = hint.trim();
        if (text) lines.push(text);
        continue;
      }
      if (!hint || typeof hint !== "object") continue;
      const text = [hint.command, hint.value, hint.resolvedSessionId, hint.rejectionReason]
        .filter(Boolean).join(" · ");
      if (text) lines.push(text);
    }
  };
  take(data && data.commandHints);
  for (const surface of (data && data.relatedSurfaces) || []) {
    take(surface.commandHints);
    take(surface.identityTrace && surface.identityTrace.commandHints);
  }
  return lines;
}

function renderWorkspaceExhibit(agent) {
  const cwd = typeof agent.cwd === "string" ? agent.cwd.trim() : "";
  const repoPath = agent.repo && typeof agent.repo.worktreePath === "string" ? agent.repo.worktreePath.trim() : "";
  const repoName = agent.repo && typeof agent.repo.repoName === "string" ? agent.repo.repoName.trim() : "";
  const launchCwd = typeof agent.launchCwd === "string" ? agent.launchCwd.trim() : "";
  const surfaceCwd = agent.target && typeof agent.target.surfaceCwd === "string" ? agent.target.surfaceCwd.trim() : "";
  const files = workspaceFiles(agent);
  const specialty = specialtyLabel(agent);
  const succeededBy = typeof agent.succeededBy === "string" ? agent.succeededBy.trim() : "";
  const supersedes = typeof agent.supersedes === "string" ? agent.supersedes.trim() : "";
  const cwdNote = agent.target && agent.target.cwdRelation === "different";
  const sameRepo = Boolean(cwd && repoPath && cwd === repoPath);
  const showRepo = !sameRepo && Boolean(repoName || repoPath);
  const showLaunch = Boolean(launchCwd && launchCwd !== cwd);
  const showShell = Boolean(surfaceCwd && surfaceCwd !== cwd);
  if (!cwd && !showRepo && !showLaunch && !showShell && !files.length && !specialty && !succeededBy && !supersedes && !cwdNote) {
    return null;
  }

  const { wrap, body } = exhibitShell({ mark: EXHIBIT_MARK.workspace, title: "Workspace", section: "workspace" });

  const extras = [];
  if (showRepo) extras.push(["Repository", pathValue(agent, repoName || repoPath, "Repository")]);
  if (showLaunch) extras.push(["Launch folder", pathValue(agent, launchCwd, "Launch folder")]);
  if (showShell) extras.push(["Terminal shell folder", pathValue(agent, surfaceCwd, "Terminal shell folder")]);
  if (specialty) extras.push(["specialty", specialty]);
  if (succeededBy) extras.push(["succeeded by", succeededBy]);
  if (supersedes) extras.push(["supersedes", supersedes]);

  if (extras.length) {
    const grid = el("dl", { class: "detail-grid exhibit-readout" });
    if (cwd) dtdd(grid, "Workspace", pathValue(agent, cwd, "Workspace"));
    for (const [label, value] of extras) dtdd(grid, label, value);
    body.append(grid);
  } else if (cwd) {
    body.append(el("p", { class: "evidence-value exhibit-readout" },
      el("code", { title: cwd, text: cwd }),
      el("button", {
        type: "button",
        class: "artifact-copy evidence-path-copy",
        title: "Copy full path",
        "aria-label": "Copy Workspace path",
        dataset: { fkey: `copy-path:${agent.id}:Workspace`, fullPath: cwd },
        onclick: (event) => {
          void copyText(cwd);
          markCopied(event && event.currentTarget);
        },
      }, icon("copy"))));
  }

  if (cwdNote) {
    body.append(el("p", {
      class: "directory-relation-note",
      text: "Claude’s tool session and the terminal shell maintain separate working directories. This does not change the exact cmux link.",
    }));
  }

  if (files.length) {
    body.append(el("ul", { class: "artifact-list" },
      files.map((item) => {
        const shown = relativeArtifactPath(cwd, item.path, item.label);
        const copyValue = absoluteArtifactPath(cwd, item.path, shown);
        return el("li", {},
          el("span", { class: "artifact-label", text: item.label || shown }),
          el("span", { class: "artifact-path", title: copyValue, text: shown }),
          el("button", {
            type: "button",
            class: "artifact-copy",
            title: "Copy full path",
            "aria-label": "Copy full path",
            dataset: { fkey: `copy:${agent.id}:${copyValue}`, fullPath: copyValue },
            onclick: (event) => {
              void copyText(copyValue);
              markCopied(event && event.currentTarget);
            },
          }, icon("copy")));
      })));
  }
  return wrap;
}

function renderGitExhibit(agent) {
  if (!gitPresent(agent.git)) return null;
  const git = agent.git;
  const dirty = Boolean(git.dirty);
  const { wrap, body } = exhibitShell({
    mark: EXHIBIT_MARK.git,
    title: "Git",
    section: "git",
    markClass: dirty ? "git-dirty" : "",
    markTitle: dirty ? "Uncommitted changes" : "Clean working tree",
  });
  body.append(el("span", { class: "git-line exhibit-readout" },
    git.branch ? el("code", { text: git.branch }) : null,
    git.head ? el("code", { class: "git-rev", text: "@" + String(git.head).slice(0, 7) }) : null));
  return wrap;
}

function renderPullRequestExhibit(agent) {
  const urls = Array.isArray(agent.pullRequestUrls) ? agent.pullRequestUrls.filter(Boolean) : [];
  if (!urls.length) return null;
  const { wrap, body } = exhibitShell({ mark: EXHIBIT_MARK.pr, title: "Pull request", section: "pr" });
  body.append(el("ul", { class: "artifact-list" },
    urls.map((url) => {
      const label = prShortLabel(url);
      return el("li", {},
        el("span", { class: "artifact-label", text: label.split("/").slice(-2).join("/") || label }),
        el("a", { class: "artifact-path", href: url, text: label }),
        el("button", {
          type: "button",
          class: "artifact-copy",
          title: "Copy URL",
          "aria-label": "Copy URL",
          dataset: { fkey: `copy:${agent.id}:${url}`, fullPath: url },
          onclick: (event) => {
            void copyText(url);
            markCopied(event && event.currentTarget);
          },
        }, icon("copy")));
    })));
  return wrap;
}

function renderHistoryExhibit(agent) {
  if (!historyExhibitVisible(agent)) return null;
  const sentence = historyExhibitSentence(agent);
  if (!sentence) return null;
  const { wrap, body } = exhibitShell({ mark: EXHIBIT_MARK.history, title: "History", section: "history" });
  body.append(el("p", { class: "evidence-value exhibit-readout", text: sentence }));
  return wrap;
}

/* The routing story in full: which tier bound the session (or refused), the
   ordered evidence trail, and — on demand — the ps/lsof view of the terminals
   involved. Quarantined sessions always mount, even when identityTrace was
   stripped from the SSE payload. */
function renderIdentityBlock(agent, ui = state) {
  const view = identityTraceView(agent, resolvedIdentityTrace(agent, ui));
  if (!routeExhibitVisible(agent, view)) return null;

  const identity = ui.identity || { agentId: null, loading: false, error: "", data: null };
  const shown = identity.agentId === agent.id;
  const expanded = shown && !identity.loading && Boolean(identity.data || identity.error);
  const chipSpec = ROUTE_CHIPS[view.resolution]
    || (deriveControlState(agent) === "quarantined" ? ROUTE_CHIPS.ambiguous : null);
  const chip = chipSpec
    ? el("span", { class: chipSpec.className, text: chipSpec.text })
    : null;
  const expand = el("button", {
    type: "button",
    class: "identity-load identity-expand",
    "aria-expanded": expanded ? "true" : "false",
    "aria-busy": shown && identity.loading ? "true" : null,
    /* The label names what the NEXT activation does, like every other toggle in
       this drawer. It used to read "Show…" while the panel was open, which was
       the one-way loader underneath telling on itself. */
    "aria-label": shown && identity.loading
      ? "Reading terminals…"
      : expanded
        ? "Hide which terminals claim this session"
        : "Show which terminals claim this session",
    title: expanded
      ? "Hide which terminals claim this session"
      : "Show which terminals claim this session",
    dataset: { fkey: "identity-load:" + agent.id },
    onclick: () => {
      /* A toggle, not a loader. Clicking an open card used to re-enter the
         fetch, which flickered through loading and landed open again, so the
         evidence could be opened and never closed. */
      if (expanded) return void clearIdentityEvidence();
      void loadIdentityEvidence(agent.id);
    },
  }, icon("arrow-up-right"));

  const { wrap, body } = exhibitShell({
    mark: EXHIBIT_MARK.route,
    title: "Route",
    section: "route",
    extra: [chip, expand],
    wrapClass: "identity-block exhibit",
  });

  for (const step of routeBindSteps(view)) {
    body.append(el("div", { class: routeBindClass(step.outcome) },
      el("span", { class: "route-bind-kicker", text: ROUTE_BIND_KICKERS[step.tier] || step.tierLabel }),
      el("p", { text: step.detail })));
  }

  if (view.bridge) {
    body.append(el("p", { class: "identity-note", text:
      "A remembered binding to " + (view.bridge.surfaceId || "a terminal")
      + " carried this session through a scan with no live evidence"
      + (view.bridge.confirmedAt ? " (last confirmed " + agoText(view.bridge.confirmedAt) + ")" : "")
      + "." }));
  }

  const surfaces = renderSurfaceEvidence(agent, ui, expanded);
  if (surfaces) body.append(surfaces);
  return wrap;
}

/* The on-demand half. Only the debug endpoint knows the pids, commands and
   open session files behind a terminal, so this stays collapsed until ↗. */
function renderSurfaceEvidence(agent, ui = state, expanded = false) {
  const identity = ui.identity || { agentId: null, loading: false, error: "", data: null };
  const shown = identity.agentId === agent.id;
  if (!shown || !expanded) return null;
  const wrap = el("div", { class: "identity-surfaces" });

  if (identity.error) {
    wrap.append(el("p", { class: "identity-error", role: "alert",
      text: "Terminal evidence unavailable: " + identity.error }));
    wrap.append(el("button", {
      type: "button", class: "btn sm identity-load",
      dataset: { fkey: "identity-load:" + agent.id },
      onclick: () => void loadIdentityEvidence(agent.id),
    }, "Retry"));
    return wrap;
  }

  const collisions = surfaceCollisions(identity.data);
  if (!collisions.length) {
    wrap.append(el("p", { class: "identity-note", text: "No cmux terminal reports evidence for this session." }));
  } else {
    const list = el("ul", { class: "identity-surface-list", "aria-label": "Terminals claiming this session" });
    for (const collision of collisions) {
      const item = el("li", { class: "identity-surface" + (collision.claims.length > 1 ? " is-contested" : "") },
        el("span", { class: "identity-surface-line mono", text: collisionLine(collision) }));
      if (collision.conflict) {
        item.append(el("span", { class: "identity-surface-conflict", text: collision.conflict }));
      }
      list.append(item);
    }
    wrap.append(list);
  }

  const hints = identityHintLines(identity.data);
  if (hints.length) {
    wrap.append(el("ul", { class: "identity-hints" },
      hints.map((hint) => el("li", { class: "identity-hint", text: hint }))));
  }
  return wrap;
}

function renderEvidence(agent, ui = state) {
  const panel = el("div", { class: "inspector-panel", role: "tabpanel" });
  const sections = [
    renderWorkspaceExhibit(agent),
    renderGitExhibit(agent),
    renderPullRequestExhibit(agent),
    renderIdentityBlock(agent, ui),
    renderHistoryExhibit(agent),
  ].filter(Boolean);
  for (const section of sections) panel.append(section);
  if (!panel.childNodes.length) {
    panel.append(el("p", {
      class: "inspector-note",
      role: "status",
      text: "No evidence fields reported for this session.",
    }));
  }
  return panel;
}

/* Danger zone removed — Interrupt/Archive live in the command dock. */

/* ---------- control requests ---------- */

async function sendControl(agent, action, instruction) {
  const key = agent.id + ":" + action;
  if (state.pending.has(key)) return;
  state.pending.add(key);
  state.feedback.delete(agent.id);
  render();

  let result;
  try {
    const payload = { action, agentId: agent.id, instruction };
    if (action === "instruct") {
      let nonce = state.instructNonces.get(agent.id);
      if (!nonce) {
        nonce = (globalThis.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : `formic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        state.instructNonces.set(agent.id, nonce);
      }
      payload.clientNonce = nonce;
    }
    const res = await apiFetch("/api/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, API_WRITE_TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }
    result = controlOutcome(action, agentName(agent), { status: res.status, body });
    if (result.ok && action === "instruct") {
      state.drafts.delete(agent.id);
      state.instructNonces.delete(agent.id);
    }
  } catch (err) {
    result = controlOutcome(action, agentName(agent), { error: err });
  }

  state.pending.delete(key);
  state.feedback.set(agent.id, { ...result, action });
  render();
  toast(result.message.split("\n")[0], result.ok ? "ok" : "err");
  refreshActions(); // the server just journalled this attempt — success or not
}

/* ---------- SYNC-NF · the two writes ----------

   Ack is the operator's "I'm done with this row". The server writes the
   Formic ack and then mark_reads unread cmux notices on the attested
   surface. Clearing a notice from the panel is the other door into the
   same funnel: toast-only rows are acked, a live needsInput is not.
   This client still makes one request per verb.

   They share one request shape because they share one honesty rule: HTTP
   completion is not evidence. cmux answers a wrong parameter with exit code 0
   and does nothing, so the server surfaces its refusals as a typed
   `ActionResult` and this believes `ok` only when the envelope says so in a
   boolean. Anything else is a refusal with a name.

   In-flight keys live here rather than in client-state.js: they are this file's
   own bookkeeping, and the shared state object is contended by three lanes. */

const syncPending = new Set(); // "ack:<agentId>" | "notify:<notificationId>"

async function syncRequest(url, method, body) {
  try {
    const res = await apiFetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : { accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }, API_WRITE_TIMEOUT_MS);
    let envelope = null;
    try { envelope = await res.json(); } catch { /* a build without the route answers HTML */ }
    if (envelope && envelope.ok === true) {
      return {
        ok: true,
        cmuxWarnings: Array.isArray(envelope.cmuxWarnings) ? envelope.cmuxWarnings : [],
      };
    }
    return {
      ok: false,
      // The server's own refusal class when it named one ("invalid_state"), and
      // the status when it did not — never a bare "failed" with no handle on it.
      code: (envelope && typeof envelope.code === "string" && envelope.code) || "HTTP_" + res.status,
      detail: (envelope && typeof envelope.detail === "string" && envelope.detail) || "",
    };
  } catch (err) {
    return { ok: false, code: "unreachable", detail: err && err.message ? err.message : "network error" };
  }
}

function syncFailureText(what, result) {
  return what + " failed [" + result.code + "]" + (result.detail ? ": " + result.detail : "");
}

/* One notification, by its own id. The `all` / `all_read` / `tab_id` variants of
   cmux's vocabulary are deliberately unreachable from here: a board control
   that cleared every terminal notification on the machine is not a control an
   operator can take back. */
async function clearCmuxNotification(id, action) {
  const key = "notify:" + id;
  if (syncPending.has(key)) return { ok: false, code: "pending" };
  syncPending.add(key);
  render();
  const result = await syncRequest("/api/sync/notifications", "POST", { action, id });
  syncPending.delete(key);
  // The badge is a reading off the snapshot, so re-reading it is what makes the
  // count visibly drop — nothing here edits the client's copy of the list.
  if (result.ok) await fetchSnapshot();
  else toast(syncFailureText(action === "dismiss" ? "Dismiss" : "Mark read", result), "err");
  render();
  return result;
}

async function applySyncAck(agent, on) {
  const agentId = agent && agent.id;
  if (!agentId) return { ok: false, code: "no_agent" };
  const key = "ack:" + agentId;
  if (syncPending.has(key)) return { ok: false, code: "pending" };
  syncPending.add(key);
  render();
  const result = await syncRequest("/api/sync/ack/" + encodeURIComponent(agentId), on ? "PUT" : "DELETE");
  syncPending.delete(key);
  /* Same re-read, same reason, and here it is the WHOLE mechanism: the client
     keeps no ack of its own, so the row leaves (or rejoins) the strip only
     because the next snapshot's `acks` says so. A refused ack therefore moves
     nothing at all, which is exactly right — the operator's judgment did not
     land, so the board must not act as though it had. */
  if (result.ok) {
    const warnings = result.cmuxWarnings || [];
    if (on && warnings.length) {
      const first = warnings[0];
      toast(
        "Ack saved, but cmux did not clear [" + (first.code || "cmux_failed") + "]"
          + (first.detail ? ": " + first.detail : ""),
        "err",
      );
    }
    await fetchSnapshot();
  } else {
    toast(syncFailureText(on ? "Ack" : "Unack", result), "err");
  }
  render();
  return result;
}

/* ---------- presentation labels (source identities stay authoritative) ---------- */

async function fetchLabels() {
  state.labelsLoading = true;
  state.labelLoadError = "";
  try {
    const res = await apiFetch("/api/program-aliases", { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    const body = await res.json();
    if (!res.ok || !body || body.ok !== true || typeof body.labels !== "object") throw new Error("bad label response");
    state.labels = new Map(Object.entries(body.labels));
    state.aliases = state.labels;
    state.labelsLoaded = true;
    render();
  } catch (err) {
    state.labelLoadError = err && err.message ? err.message : "Label loading failed";
    console.warn("label fetch failed:", err);
  } finally {
    state.labelsLoading = false;
  }
}

/* TINT-F. One fetch at boot, one when Settings opens, one when the live origin
   roster on a later snapshot changes, and one after every colour an operator
   picks. There is deliberately no timer: an assignment only changes when a
   repository the board has never seen appears — which is a fresh GET's own
   doing, since this endpoint is what assigns it — or when somebody presses a
   swatch. A failure here costs the tint and nothing else, so it warns and
   leaves the board uncoloured rather than reaching for a fallback palette the
   cmux workspaces would not be wearing. */
function liveRepoSig(snap) {
  const keys = new Set();
  for (const program of (snap && snap.programs) || []) {
    for (const agent of program.agents || []) {
      const name = agent.repo && agent.repo.repoName;
      if (name && String(name).trim()) keys.add(String(name).trim().toLowerCase());
    }
  }
  return [...keys].sort().join(",");
}

let lastLiveRepoSig = null;
function maybeRefreshRepoColors(snap) {
  const sig = liveRepoSig(snap);
  if (lastLiveRepoSig === sig) return;
  const first = lastLiveRepoSig === null;
  lastLiveRepoSig = sig;
  if (!first) void fetchRepoColors();
}

async function fetchRepoColors() {
  const generation = bootGeneration;
  try {
    const res = await apiFetch("/api/repo-colors", { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    const body = await res.json();
    if (!res.ok || !body || body.ok !== true || !body.settings) throw new Error("bad repo-colour response");
    /* The board was frozen while this was in flight, so there is nothing left
       to paint into: applying it here repaints over whatever stopped the boot.
       The geometry gate froze the board on purpose, and a repaint arriving
       mid-measurement made it fail on a layout it never rendered. */
    if (generation !== bootGeneration) return;
    state.liveRepoKeys = Array.isArray(body.liveKeys) ? body.liveKeys.map(String) : [];
    state.repoColorSettings = body.settings;
    setRepoColors(body.repoNames, body.settings);
    render();
  } catch (err) {
    console.warn("repo colour fetch failed:", err);
  }
}

function startRename(target, opts = {}) {
  const key = presentationLabelKey(target);
  state.renaming = key;
  // Prefer a saved alias; otherwise seed from the live display name (often the
  // cmux terminal title) so edits feel like renaming what you already see.
  state.renameDraft = state.aliases.get(key) || (typeof opts.draft === "string" ? opts.draft : "") || "";
  state.renameError = "";
  render();
  const inputKey = target.kind === "program" ? "rename-input:" + target.programId : "label-input:" + key;
  const input = document.querySelector(`[data-fkey="${CSS.escape(inputKey)}"]`);
  if (input) { input.focus(); input.select(); }
}

function cancelRename() {
  state.renaming = null;
  state.renameError = "";
  render();
}

async function submitRename(target) {
  if (state.renamePending) return;
  const label = state.renameDraft.trim();
  if (label.length > 80) { state.renameError = "Keep the label under 80 characters."; render(); return; }
  state.renamePending = true;
  state.renameError = "";
  render();
  try {
    const res = await apiFetch("/api/program-aliases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, label }),
    }, API_WRITE_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.ok !== true) {
      throw new Error(body && body.error && body.error.message ? body.error.message : "Save failed (HTTP " + res.status + ")");
    }
    if (label) state.aliases.set(presentationLabelKey(target), label); else state.aliases.delete(presentationLabelKey(target));
    state.renaming = null;
    const labelName = target.kind === "program" ? "Program" : target.kind[0].toUpperCase() + target.kind.slice(1);
    toast(label ? labelName + " label saved as " + label : labelName + " label reset", "ok");
  } catch (err) {
    state.renameError = err && err.message ? err.message : "Save failed";
  } finally {
    state.renamePending = false;
    render();
  }
}

/* ---------- out-of-page notification ----------

   With ~200 sessions the operator is working in other windows. An agent that
   starts waiting produced no signal outside the tab, so "needs you" agents sat
   idle until someone happened to look — the unread-cmux signal the product
   already collects was never escalated past the in-page beacon.

   Two escalations, deliberately asymmetric in cost:
     - the tab title, which needs no permission and cannot annoy anyone;
     - a Notification, opt-in behind an explicit click, silent when denied.

   The firing rule is the whole feature. A notifier that cries wolf gets muted
   and then the feature is worthless, so this fires ONLY for an agent that has
   newly entered the needs-a-human set. Not on count changes, not on an agent
   leaving, not on the first paint (opening the page to six waiting agents is
   not six pieces of news), and never on routine churn. */






/* ---------- misc UI ---------- */

let toastTimer = null;
function toast(message, kind) {
  const node = $("toast");
  if (!node) return;
  node.textContent = message;
  node.className = "toast show" + (kind ? " " + kind : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = "toast"; }, 3500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied: " + text, "ok");
  } catch {
    toast("Copy failed — clipboard unavailable", "err");
  }
}

function firstLoadPending(ui = state) {
  return !ui.snap && !ui.fetchFailed;
}

function renderSkeleton() {
  const skeleton = $("board-skeleton");
  if (!skeleton) return;
  skeleton.hidden = !firstLoadPending();
}

function renderEmpty() {
  const empty = $("empty-state");
  const retry = $("empty-retry");
  /* Nothing has come back yet, so there is no finding to report. Any render()
     triggered before the first response — a view tab, a keystroke in search —
     used to fall through to "Can't reach the Ant Hill server", which is a guess
     dressed as a diagnosis. The skeleton holds the space instead. */
  if (firstLoadPending()) { empty.hidden = true; return; }
  const hasAgents = dashboardPrograms(state.snap).length > 0;
  if (hasAgents) { empty.hidden = true; return; }

  empty.hidden = false;
  if (!state.snap) {
    $("empty-message").textContent = "Can't reach the Formic server.";
    $("empty-hint").textContent = serverUnreachableHint(typeof location === "undefined" ? "" : location.host);
    retry.hidden = false;
  } else {
    /* Day one, and the least-exercised state in the product: every measurement
       this project has taken was at 380-441 agents, so the board had never been
       seen with nothing on it — which is exactly what a new operator meets.

       Rendered before this change it read "The ant hill is still — no tracked
       agents" beside a mound illustration, with no evidence anywhere that the
       collectors had run. An empty cockpit is ambiguous between two states that
       could not be more different — WATCHING AND FOUND NOTHING, and NOT
       WATCHING — and passive prose picks neither. A new operator reasonably
       reads it as broken.

       So it asserts the healthy case and proves it, the same way the Alerts
       all-clear does: a source count and a ticking snapshot age are evidence a
       stalled client cannot manufacture. And when a source really is degraded it
       says THAT instead, because an empty board with a blind collector is not an
       empty fleet — it is an unknown one, and claiming health there would be the
       false all-clear again on the day it matters most. */
    const verdict = emptyBoardVerdict(state.snap);
    $("empty-message").textContent = verdict.message;
    $("empty-hint").textContent = verdict.hint;
    const proof = $("empty-proof");
    if (proof) {
      proof.textContent = "";
      proof.hidden = !verdict.sources && !verdict.checkedAt;
      if (verdict.sources) proof.append(el("span", { text: verdict.sources }));
      if (verdict.checkedAt) {
        if (verdict.sources) proof.append(el("span", { "aria-hidden": "true", text: " · " }));
        proof.append(el("span", {
          dataset: { ago: verdict.checkedAt },
          text: "checked " + agoText(verdict.checkedAt),
        }));
      }
      proof.classList.toggle("is-degraded", verdict.degraded);
    }
    empty.classList.toggle("is-watching", !verdict.degraded);
    retry.hidden = true;
  }
}

/* What an empty board should say, decided separately from painting it — the
   pulseStripModel split, so the sentence can be tested without a DOM.

   Day one is the least-exercised state in this product: every measurement it has
   ever taken was at 380-441 agents, so the board had never been seen with
   nothing on it, which is precisely what a new operator meets. It read "The ant
   hill is still — no tracked agents" beside a mound illustration, with no
   evidence anywhere that a collector had ever run.

   An empty cockpit is ambiguous between two states that could not be more
   different — WATCHING AND FOUND NOTHING, and NOT WATCHING — and passive prose
   picks neither, so a new operator reasonably reads it as broken. This asserts
   the healthy case and proves it with a source count and a ticking snapshot
   age, which a stalled client cannot manufacture.

   When a collector IS degraded it says that instead. An empty board with a blind
   collector is not an empty fleet, it is an unknown one, and claiming health
   there would be the false all-clear again on the day it matters most. */
function emptyBoardVerdict(snap) {
  const sources = snap && snap.totals && snap.totals.sourceHealth;
  const total = sources && Number.isFinite(sources.total) ? sources.total : 0;
  /* A provider that is not installed is not a provider that is broken.

     The docs lane proved the first screen of a fresh install reads "No sessions
     found — and not every collector can see · 1 of 4 collectors degraded". That
     is a fault report, and it is wrong: a newcomer running Claude Code but not
     Cursor has an absent collector, not a degraded one. Nothing is broken,
     nothing needs fixing, and the very first thing the product says to them is
     that something is.

     byProvider carries lastHealthyAt, and it is the distinction the screen
     needs: a source that has NEVER been healthy has nothing to read yet, while
     one that WAS healthy and is not now has actually failed. Only the second is
     a fault. The backend is fixing the absent/degraded split at its source; this
     composes with that rather than competing, because a provider it marks
     absent will simply stop appearing as unhealthy here.

     Deliberately conservative: with no byProvider on the wire the old counting
     stands, so a real degradation is never silently downgraded to calm. */
  const byProvider = (sources && sources.byProvider) || null;
  const broken = byProvider
    ? Object.values(byProvider).filter((p) => p && p.healthy === false && p.lastHealthyAt).length
    : (sources && Number.isFinite(sources.degraded) ? sources.degraded : 0);
  const degraded = broken > 0;
  const healthy = sources && Number.isFinite(sources.healthy) ? sources.healthy : 0;
  // Collectors with nothing installed to read. Absent-first: a wire without the
  // field reports 0 rather than inventing absences.
  const absent = sources && Number.isFinite(sources.absent) ? sources.absent : 0;
  return {
    degraded,
    message: degraded
      ? "No sessions found — and not every collector can see."
      : "Watching. No sessions running yet.",
    hint: degraded
      ? "A degraded collector reports no sessions whether or not any are running, so this board is incomplete rather than empty."
      : "Claude Code, Codex, Cursor, Grok Build and Copilot CLI sessions appear here on their own, within seconds of starting.",
    /* The denominator stays. I first replaced it with an absolute count, on the
       theory that "3 of 4" reads as a shortfall to a newcomer — then read the
       docs lane's QUICKSTART, which pins "4 of 4 collectors healthy" and
       explains why it is right: the count is of collectors that can SEE, not of
       tools installed, and a directory that does not exist is a COMPLETE answer
       ("this tool never ran here") rather than a gap. The denominator is what
       makes "all four are fine" legible; an absolute count would have hidden
       the very reassurance the screen exists to give. Their reasoning is better
       than mine was and the string is documented, so it stands. */
    /* On a machine with none of the four installed the denominator went to
       zero and this returned null, so the day-one screen lost the very line
       QUICKSTART sends a newcomer to look for — the one it calls "the proof the
       board is working". Silence at exactly the moment someone needs a signal.

       So absence is stated rather than counted or hidden. A newcomer with no
       tools installed is told what would appear here; a newcomer with one is
       told their one collector is fine AND that three are simply not installed,
       which is the distinction 42d842e drew at the source. Degradation still
       outranks both: a blind collector is a fault and says so first. */
    sources: degraded
      ? `${broken} of ${total} collectors degraded`
      : total > 0
        ? (absent > 0
          ? `${healthy} of ${total} collectors healthy · ${absent} not installed`
          : `${healthy} of ${total} collectors healthy`)
        : absent > 0
          ? "No collectors installed yet — Claude Code, Codex, Cursor, Grok Build or Copilot CLI will appear here"
          : null,
    checkedAt: (snap && snap.generatedAt) || null,
  };
}

function tickClocks(frozen = feedFrozen(), now = Date.now()) {
  for (const node of document.querySelectorAll("[data-elapsed-base]")) {
    const text = elapsedTickText(node.dataset.elapsedBase, node.dataset.elapsedFrom, now, frozen);
    if (text != null) node.textContent = text;
    node.classList.toggle("is-frozen", frozen);
  }
  // data-ago is NOT frozen: "12m ago" measures the distance from a real past
  // moment to now, and that distance genuinely keeps growing while the feed is
  // stuck. Freezing it would replace one lie with another.
  for (const node of document.querySelectorAll("[data-ago]")) {
    node.textContent = agoText(node.dataset.ago);
  }
  for (const node of document.querySelectorAll("[data-working-since]")) {
    const start = Date.parse(node.dataset.workingSince);
    node.textContent = Number.isFinite(start) ? fmtWorkingDuration(now - start) : "";
  }
  for (const node of document.querySelectorAll("[data-compact-ago]")) {
    const at = Date.parse(node.dataset.compactAgo);
    node.textContent = Number.isFinite(at) ? fmtCompactAge(now - at) : "";
  }
}

function setView(view) {
  if (state.view === view || !VIEWS.includes(view)) return;
  state.view = view;
  if (view === "usage") void loadUsageData();
  render();
}

function usageRangeHours() {
  if (state.usageRangeId === "custom") return state.usageCustomHours || 24;
  const preset = USAGE_RANGE_PRESETS.find((item) => item.id === state.usageRangeId);
  return preset ? preset.hours : 24;
}

function usageRangeBounds() {
  const to = new Date();
  const from = new Date(to.getTime() - usageRangeHours() * 3_600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/* OpenBurnBar stores "yyyy-MM-dd HH:mm:ss.SSS" as UTC text with NO zone marker
   (burnbar.ts:421-429) and the endpoint passes it through unchanged. Date.parse
   reads a zone-less string as LOCAL time, so on this UTC+2 machine every row
   aged by exactly the offset. Verified on the wire: startTime
   "2026-08-02 11:15:48.670" read at 11:39:32Z is 24 minutes old and rendered
   "2.2h ago" — the freshest data in the table looking stale, which is the one
   thing that stops an operator trusting the tab at all.

   The real fix is at the API boundary and the audit routes it there. This is the
   render half and it is deliberately IDEMPOTENT with that fix: a string already
   carrying Z or a numeric offset is returned untouched, so when the boundary
   starts emitting proper ISO nothing here double-corrects. (Usage audit §2.) */
const ZONELESS_SQL_INSTANT = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;
function burnbarInstant(text) {
  if (typeof text !== "string") return text;
  const match = ZONELESS_SQL_INSTANT.exec(text.trim());
  return match ? `${match[1]}T${match[2]}Z` : text;
}

/* What the cost reading should say, given a summary that may be only partly
   priced.

   The rule this replaces: `costKnown ? value : "not reported"`. burnbar.ts:33
   sets costKnown false as soon as ANY invocation in the window lacks a price, so
   one unpriced provider suppressed the whole figure. Measured at 30 days: the
   headline read "not reported" while the same payload carried $11,939.92 of
   measured, provenance-tagged spend — Codex $4,752.32, Claude Code $6,949.58,
   Hermes $237.39, Factory $0.65 — with Cursor the only unpriced source at 45 of
   2,980 calls. The string "cost missing on some rows" was literally true and the
   belief it created, "we do not know what this cost", was false.

   costKnown now gates a QUALIFIER, never the value. "not reported" is reserved
   for a window with no priced rows at all, which is the only case where it is
   the whole truth. (Usage audit §1.)

   Server first, as everywhere else on this board: when the summary carries an
   authoritative total it is rendered untouched. The byProvider sum is a stated
   fallback for the payload as it stands today, and it should be DELETED the
   moment the server ships a measured total of its own — two derivations of one
   number is the seam that produced every attention and token defect here. */
/* The same floor-and-gap treatment for tokens, which is where this codebase set
   the precedent and then did not follow it on screen.

   tokensMissing has been on the wire all along — the contract comment even gives
   the intended sentence, "3,000 across 2 calls, 1 unmeasured" — but the card
   rendered `processedTokens || 0` and a flat "BurnBar observed", so an
   unmeasured invocation was indistinguishable from one that burned nothing and
   the total was labelled observed either way. That is the same defect the cost
   figure had, one reading to the left.

   The `|| 0` was its own small lie: a null total, meaning nothing was measured,
   printed as a measured zero. */
function usageTokenReading(summary) {
  if (!summary || !Number.isFinite(summary.processedTokens)) {
    return { value: "not reported", sub: "no token measurements in this range" };
  }
  const missing = Number.isFinite(summary.tokensMissing) ? summary.tokensMissing : 0;
  if (missing <= 0) return { value: fmtTok(summary.processedTokens), sub: "BurnBar observed" };
  return {
    value: "≥" + fmtTok(summary.processedTokens),
    sub: `measured floor · ${missing} ${missing === 1 ? "call" : "calls"} unmeasured`,
  };
}

function usageCostReading(summary) {
  if (!summary) return { value: "not reported", sub: "no cost data" };
  /* A complete total needs no qualifier and gets none. */
  if (summary.costKnown && Number.isFinite(summary.estimatedCostUsd)) {
    return { value: fmtUsd(summary.estimatedCostUsd), sub: "from BurnBar cost" };
  }
  const measured = Number.isFinite(summary.measuredCostUsd) ? summary.measuredCostUsd : null;
  if (measured == null) {
    /* Nothing priced because nothing happened is a different sentence from
       nothing priced because nothing could be priced, and an empty window is
       the day-one case. Neither invents $0.00. */
    return {
      value: "not reported",
      sub: summary.invocations === 0 ? "no activity in this range" : "no priced rows in this range",
    };
  }
  /* A measured-but-incomplete total is a FLOOR, and it is shown as one: the
     figure and the size of its gap in a single glance, never one without the
     other.

     This is the shape `processedTokens` has always had on the wire — a measured
     sum plus tokensMissing carrying the rest, on the rule that an understatement
     is not a fabrication. Cost had the opposite rule: estimatedCostUsd is null
     unless EVERY invocation is priced, which sent $11,934.61 of real money to
     the card as "not reported" because 42 of 2,973 calls could not be priced.
     The server now ships measuredCostUsd and costMissingInvocations beside it,
     so the qualifier sits next to the value instead of gating it.

     The `≥` is load-bearing rather than decorative. It travels with the number
     if the sublabel is skimmed, clipped or read aloud, and it is the one mark
     that stops a floor being banked as a total — the failure the server's own
     comment warns about. */
  const missing = Number.isFinite(summary.costMissingInvocations) ? summary.costMissingInvocations : 0;
  if (missing <= 0) return { value: fmtUsd(measured), sub: "measured" };
  const calls = Number.isFinite(summary.invocations) && summary.invocations > 0
    ? `${missing} of ${summary.invocations} calls unpriced`
    /* No denominator on the wire means no share is claimed. Naming the gap in
       absolute terms is still true; inventing a percentage to sit beside it
       would not be. */
    : `${missing} ${missing === 1 ? "call" : "calls"} unpriced`;
  return { value: "≥" + fmtUsd(measured), sub: "measured floor · " + calls };
}

/* The burn rate is processedTokens over the SELECTED window, not a current rate.
   Measured across the selector on one unchanged fleet: 45.1M/h at 1h, 5.7M/h at
   24h, 16.0M/h at 7d, 36.4M/h at 30d — same label, four answers, an 8x swing
   between adjacent positions. An operator clicking 1h after 24h sees the rate
   jump eightfold and concludes burn exploded. Nothing did. The window is the
   missing half of the sentence. (Usage audit §3.) */
function usageRateWindowText(summary) {
  if (!summary) return "tokens per hour";
  const from = Date.parse(summary.from);
  const to = Date.parse(summary.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return "tokens per hour";
  return fmtElapsed(to - from) + " average, not a current rate";
}

function fmtUsd(value) {
  if (value == null || !Number.isFinite(value)) return "not reported";
  /* Grouped above four figures. This is the one number on the board Emilio
     reads to decide spend, and "$11934.61" costs a beat to parse as eleven
     thousand rather than one hundred and nineteen. Sub-$10 amounts keep three
     decimals; nothing about their magnitude was ever in doubt.

     Grouped on the integer part only, with a global match. The first attempt
     used one non-global lookahead and produced "$1,234567.89" — a separator
     that appears once and then gives up is worse than none, because it looks
     like it worked. */
  const fixed = value.toFixed(value >= 10 ? 2 : 3);
  const [whole, fraction] = fixed.split(".");
  return "$" + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + fraction;
}

function agentIdForSession(sessionId) {
  if (!sessionId || !state.snap) return null;
  for (const { agent } of snapshotAgents(state.snap)) {
    if (agent.sourceSessionId === sessionId || agent.id.endsWith(":" + sessionId)) return agent.id;
  }
  return null;
}

async function loadUsageData(force = false) {
  if (state.usageLoading) return;
  if (!force && state.usageFetchedAt && Date.now() - state.usageFetchedAt < 15_000 && state.usageSummary) {
    return;
  }
  state.usageLoading = true;
  state.usageError = "";
  renderScopeNote(0);
  const { from, to } = usageRangeBounds();
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const bucket = usageRangeHours() > 48 ? "1d" : "1h";
  try {
    const [summaryRes, seriesRes, wardRes, invRes] = await Promise.all([
      apiFetch("/api/usage/summary?" + q, {}, API_READ_TIMEOUT_MS),
      apiFetch("/api/usage/series?" + q + "&bucket=" + bucket, {}, API_READ_TIMEOUT_MS),
      apiFetch("/api/usage/ward?" + q, {}, API_READ_TIMEOUT_MS),
      apiFetch("/api/usage/invocations?" + q + "&limit=40", {}, API_READ_TIMEOUT_MS),
    ]);
    state.usageSummary = await summaryRes.json();
    state.usageSeries = await seriesRes.json();
    state.usageWard = await wardRes.json();
    state.usageInvocations = await invRes.json();
    state.usageFetchedAt = Date.now();
    if (state.usageSummary && state.usageSummary.available === false) {
      state.usageError = state.usageSummary.error || "BurnBar usage unavailable.";
    }
  } catch (error) {
    state.usageError = error instanceof Error ? error.message : String(error);
    state.usageSummary = null;
    state.usageSeries = null;
    state.usageWard = null;
    state.usageInvocations = null;
  } finally {
    state.usageLoading = false;
    if (state.view === "usage") render();
  }
}

/* The one readable fact per bar: which bucket, how many tokens. */
function usageBarTitle(bucket, tokens) {
  return bucket + " · " + fmtTok(tokens) + " tokens";
}

/* Takes the whole series envelope, not just its points, because a failed
   BurnBar query answers with available:false AND points:[]. Drawing that as an
   empty chart tells the operator they spent nothing in this range when the
   truth is the database never answered. Unavailable is not zero. */
function renderUsageSeriesChart(series) {
  const wrap = el("div", { class: "usage-series" });
  if (series && series.available === false) {
    wrap.append(el("p", { class: "usage-empty", text: series.error || "Series data unavailable." }));
    return wrap;
  }
  const points = series && series.points;
  if (!points || !points.length) {
    wrap.append(el("p", { class: "usage-empty", text: "No series points in this range." }));
    return wrap;
  }
  const byBucket = new Map();
  for (const point of points) {
    const key = point.bucketStart;
    byBucket.set(key, (byBucket.get(key) || 0) + (point.tokens || 0));
  }
  const entries = [...byBucket.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-48);
  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  const width = Math.max(entries.length * 10, 120);
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} 64`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "usage-bars-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Tokens over time");
  entries.forEach(([bucket, tokens], index) => {
    const h = Math.max(2, Math.round((tokens / max) * 56));
    const rect = svgChild(["rect", {
      x: index * 10 + 1,
      y: 64 - h,
      width: 8,
      height: h,
      class: "usage-bar-rect",
    }]);
    rect.append(svgTitle(usageBarTitle(bucket, tokens)));
    svg.append(rect);
  });
  wrap.append(svg);
  const providers = [...new Set(points.map((point) => point.provider))].slice(0, 8);
  if (providers.length) {
    wrap.append(el("p", { class: "usage-series-legend", text: "Providers: " + providers.join(" · ") }));
  }
  return wrap;
}

function renderSpendSources(snap) {
  const sources = snap && Array.isArray(snap.spendSources) ? snap.spendSources : [];
  if (!sources.length) return null;
  const list = el("ul", { class: "usage-providers" });
  for (const source of sources) {
    const tokens = source.tokens && Number.isFinite(source.tokens.total)
      ? fmtTok(source.tokens.total) + " tokens"
      : "tokens not reported";
    const cost = Number.isFinite(source.costUsd) ? fmtUsd(source.costUsd) : "cost not reported";
    const ran = source.lastRunAt ? " · last ran " + agoText(source.lastRunAt) : "";
    list.append(el("li", { class: "usage-spend-source" },
      el("strong", { text: "Hermes · " + source.label }),
      `${ran} · ${tokens} · ${cost}`));
  }
  return el("section", { class: "usage-section" },
    el("h2", { class: "usage-title", text: "Scheduled spend" }),
    list);
}

function renderUsagePanel(ui = state) {
  const root = $("usage-panel");
  if (!root) return;
  root.textContent = "";
  if (ui.usageLoading && !ui.usageSummary) {
    root.append(el("p", { class: "usage-empty", text: "Loading BurnBar usage…" }));
    return;
  }
  const summary = ui.usageSummary;
  if (!summary || summary.available === false) {
    /* "BurnBar database could not be unlocked" was printed for BOTH a real read
       failure and a BurnBar that was simply never installed. On day one the
       second is the normal case, and a new operator reads a diagnosis about
       unlocking a database as a fault they have to go and fix. A reported error
       is a fault; its absence is an absence. (Day-one review.) */
    const fault = (summary && summary.error) || ui.usageError || null;
    root.append(el("div", { class: "usage-unavailable" },
      el("h2", { class: "usage-title", text: fault ? "Usage unavailable" : "No cost source connected" }),
      el("p", {
        text: fault
          || "Cost and usage come from OpenBurnBar, which is optional and is not connected. Everything else on the board works without it.",
      }),
      /* Retry only where retrying can change the answer. A fault may clear on a
         second read; an absent optional tool will not, and offering the button
         invites a new operator to click at a problem they do not have. */
      ...(fault
        ? [el("button", {
          type: "button", class: "btn",
          dataset: { fkey: "usage-retry" },
          onclick: () => void loadUsageData(true),
        }, "Retry")]
        : [])));
    // Still show quotas/ward soft data if present without inventing spend zeros.
    if (ui.usageWard && ui.usageWard.quotaPressure && ui.usageWard.quotaPressure.length) {
      root.append(renderUsageWard(ui.usageWard, true));
    }
    const spendSources = renderSpendSources(ui.snap);
    if (spendSources) root.append(spendSources);
    return;
  }

  root.append(el("div", { class: "usage-kpis" },
    reading("Processed tokens", el("span", { class: "reading-value", text: usageTokenReading(summary).value }),
      el("span", { class: "reading-sub", text: usageTokenReading(summary).sub })),
    /* "Cost", not "Estimated cost". Every figure this card can now show is
       MEASURED — the server's own costProvenance says so — and the only thing
       uncertain about a partial answer is its completeness, which the value's
       floor mark and the sublabel both state. Calling a measured floor an
       estimate blurs the one distinction the reading exists to make. */
    reading("Cost", el("span", { class: "reading-value", text: usageCostReading(summary).value }),
      el("span", { class: "reading-sub", text: usageCostReading(summary).sub })),
    reading("Invocations", el("span", { class: "reading-value", text: String(summary.invocations || 0) }),
      el("span", { class: "reading-sub", text: "in selected range" })),
    reading("Burn rate",
      el("span", {
        class: "reading-value",
        text: summary.burnRateTokensPerHour == null ? "—" : fmtTok(Math.round(summary.burnRateTokensPerHour)) + "/h",
      }),
      el("span", { class: "reading-sub", text: usageRateWindowText(summary) }))));

  const spendSources = renderSpendSources(ui.snap);
  if (spendSources) root.append(spendSources);

  if (summary.byProvider && summary.byProvider.length) {
    const list = el("ul", { class: "usage-providers" });
    for (const row of summary.byProvider.slice(0, 10)) {
      list.append(el("li", {},
        el("strong", { text: row.provider }),
        ` · ${fmtTok(row.tokens)} tokens · ${row.invocations} calls · ${row.costUsd == null ? "cost n/a" : fmtUsd(row.costUsd)}`));
    }
    root.append(el("section", { class: "usage-section" },
      el("h2", { class: "usage-title", text: "By provider" }),
      list));
  }

  if (summary.unmodelledProviders && summary.unmodelledProviders.length) {
    root.append(el("section", { class: "usage-section" },
      el("h2", { class: "usage-title", text: "Unmodelled billed providers" }),
      el("p", { class: "usage-empty", text: summary.unmodelledProviders.join(" · ") })));
  }

  root.append(el("section", { class: "usage-section" },
    el("h2", { class: "usage-title", text: "Series" }),
    renderUsageSeriesChart(ui.usageSeries)));

  root.append(renderUsageWard(ui.usageWard, false));

  const table = el("table", { class: "usage-table" });
  table.append(el("thead", {}, el("tr", {},
    el("th", { text: "When" }),
    el("th", { text: "Provider" }),
    el("th", { text: "Model" }),
    el("th", { text: "Tokens" }),
    el("th", { text: "Cost" }),
    el("th", { text: "Session" }))));
  const body = el("tbody");
  const invocations = ui.usageInvocations;
  const rows = (invocations && invocations.invocations) || [];
  // Same rule as the series: a query that failed is not a range that was quiet.
  if (invocations && invocations.available === false) {
    body.append(el("tr", {}, el("td", {
      colspan: "6",
      text: invocations.error || "Invocation data unavailable.",
    })));
  } else if (!rows.length) {
    body.append(el("tr", {}, el("td", { colspan: "6", text: "No invocations in this range." })));
  } else {
    for (const row of rows) {
      const agentId = agentIdForSession(row.sessionId);
      const sessionCell = agentId
        ? el("button", {
          type: "button", class: "linkish",
          dataset: { fkey: "usage-session:" + row.sessionId },
          onclick: () => {
            /* "now" has not been a view since the three live tabs collapsed into
               Board, and setView ignores a name that is not in VIEWS — so this
               link opened a drawer over the Usage table and left the operator
               standing on the wrong view, silently. */
            setView("board");
            selectEntity({ kind: "agent", id: agentId });
          },
        }, row.sessionId.slice(0, 8))
        : el("span", { text: (row.sessionId || "—").slice(0, 8) });
      body.append(el("tr", {},
        el("td", { text: row.startTime ? agoText(burnbarInstant(row.startTime)) : "—" }),
        el("td", { text: row.provider || "—" }),
        el("td", { text: modelShort(row.model) || "—" }),
        el("td", { class: "usage-val", text: row.tokens == null ? "—" : fmtTok(row.tokens) }),
        el("td", { class: "usage-val", text: row.costUsd == null ? "—" : fmtUsd(row.costUsd) }),
        el("td", { class: "usage-val" }, sessionCell)));
    }
  }
  table.append(body);
  root.append(el("section", { class: "usage-section" },
    el("h2", { class: "usage-title", text: "Recent invocations" }),
    table));
}

function renderUsageWard(ward, quotasOnly) {
  const section = el("section", { class: "usage-section" });
  section.append(el("h2", { class: "usage-title", text: quotasOnly ? "Quota pressure" : "Spike / quota ward" }));
  if (!ward || (ward.available === false && !(ward.quotaPressure && ward.quotaPressure.length))) {
    section.append(el("p", { class: "usage-empty", text: (ward && ward.error) || "Ward data unavailable." }));
    return section;
  }
  if (!quotasOnly) {
    /* A series with a zero baseline is not a spike, it is a first sighting.
       burnbar.ts fires any zero-baseline series over 1,000 tok/h and encodes the
       infinite ratio as sentinel 999, which rendered as "(new)" inside a ward
       headed "Spike". Measured: "Cursor / grok-4.5 · 3k/h vs baseline 0/h (new)"
       — a 24-hour average against a preceding 24-hour average in which that
       series simply did not appear. No acceleration happened.

       In a cockpit whose premise is silence unless a human is needed, an alert
       that fires on "something started" is a wolf-cry. Both populations still
       render — nothing is hidden — but under their own headings and their own
       words, because a first sighting and a rate jump are different events.
       Whether a first sighting should alert at all is the server's threshold
       question and the audit routes it there. (Usage audit §4.) */
    const all = ward.spikes || [];
    const spikes = all.filter((spike) => spike.ratio !== 999);
    const firstSeen = all.filter((spike) => spike.ratio === 999);
    if (!spikes.length) {
      section.append(el("p", { class: "usage-empty", text: "No abrupt rate jumps vs the trailing baseline." }));
    } else {
      const list = el("ul", { class: "usage-ward-list" });
      for (const spike of spikes.slice(0, 8)) {
        list.append(el("li", {},
          el("strong", { text: spike.provider + " / " + spike.model }),
          ` · ${fmtTok(Math.round(spike.currentTokensPerHour))}/h vs baseline ${fmtTok(Math.round(spike.baselineTokensPerHour))}/h (${spike.ratio.toFixed(1)}×)`));
      }
      section.append(list);
    }
    if (firstSeen.length) {
      const list = el("ul", { class: "usage-ward-list" });
      for (const item of firstSeen.slice(0, 8)) {
        list.append(el("li", {},
          el("strong", { text: item.provider + " / " + item.model }),
          ` · ${fmtTok(Math.round(item.currentTokensPerHour))}/h · absent from the previous window`));
      }
      section.append(
        el("h3", { class: "usage-subtitle", text: "First seen this window" }),
        list);
    }
  }
  const pressure = ward.quotaPressure || [];
  if (pressure.length) {
    const list = el("ul", { class: "usage-ward-list" });
    for (const item of pressure.slice(0, 8)) {
      list.append(el("li", {},
        el("strong", { text: item.provider }),
        ` · ${item.label} · ${Math.round(item.usedPercent)}% used` + (item.resetsAt ? " · resets " + agoText(item.resetsAt) : "")));
    }
    section.append(el("h3", { class: "usage-subtitle", text: "Quota pressure" }), list);
  } else if (quotasOnly) {
    section.append(el("p", { class: "usage-empty", text: "No quota buckets above 75%." }));
  }
  return section;
}

/* ---------- boot ----------

   boot() is exported and its timers are tracked so a test can drive the real
   startup path instead of asserting against the source text of this file. The
   guarded call at the bottom of the module still runs it exactly once in a
   browser; nothing about page behaviour changes. stopBoot() exists purely so a
   test can leave no interval running behind it. */

const bootIntervals = [];

/* Bumped every time the board is frozen. Work boot STARTED can still be in
   flight when it stops, and a response landing afterwards must not repaint over
   whatever froze it — see fetchRepoColors. A counter rather than a boolean, so
   a fetch started AFTER a stop is still legitimate: what is stale is a response
   whose generation no longer matches, not every response from then on. */
let bootGeneration = 0;

function stopBoot() {
  bootGeneration += 1;
  lastLiveRepoSig = null;
  while (bootIntervals.length) clearInterval(bootIntervals.pop());
  // The stream is part of boot: leaving it open kept a live EventSource (and a
  // stale readyState read) alive after stopBoot() claimed to have stopped.
  if (es) {
    try { es.close(); } catch { /* already closed */ }
    es = null;
  }
}

function boot() {
  // Register the painter for every module that was extracted off the render hub.
  setRepaint(render);
  loadOverrides();
  loadRepoOverrides();
  loadSwarmOverrides();
  loadShelfOverrides();
  loadWidgetPreferences();
  loadTldrView();
  loadHeaderCollapsed();
  loadLookback();
  loadContextSpread();
  loadNeedsYouDisplay();
  state.notify.baseTitle = document.title;
  loadNotifyPreference();
  state.uiReady = true;
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("resize", scheduleInspectorViewportHeight);
    window.addEventListener("scroll", scheduleInspectorViewportHeight, { passive: true });
  }
  renderNotificationCenter();
  void fetchSettings();

  /* The masthead control opens the attention panel; DELIVERY is toggled by the
     switch in that panel's footer, which is where toggleNotifications — and the
     one requestPermission call in this client — is now reached. Still from a
     click, still never on load. */
  $("notify-toggle").addEventListener("click", toggleNotificationsPanel);

  /* Outside-click closes, on the same guard the settings dialog uses: only a
     press that BEGAN outside. A drag that starts on the evidence quote and ends
     on the board is a selection, not a dismissal. */
  document.addEventListener("mousedown", (e) => {
    if (!state.notifyPanelOpen) return;
    const panel = $("notifications-panel");
    const toggle = $("notify-toggle");
    if (panel?.contains(e.target) || toggle?.contains(e.target)) return;
    closeNotificationsPanel(false);
  });

  /* A press anywhere else closes the open filter menu — the dismissal every
     dropdown has — on the same mousedown guard the panels above use, and with
     every menu wrapper exempt: the trigger's own click already toggles, so
     closing here first would make it reopen on the same press, and clicking a
     SECOND trigger should switch menus rather than merely shut the first.

     Closing repaints, which is why the open menu is deliberately NOT part of
     programsPaintSig: with it in the signature, this mousedown would rebuild the
     board's rows and the click that followed would land on a detached node —
     dismissing the menu would silently eat the operator's next action. */
  document.addEventListener("mousedown", (e) => {
    if (!state.openFilterMenu) return;
    if (e.target?.closest?.(".filter-menu-wrap")) return;
    state.openFilterMenu = "";
    render();
  });

  $("search").addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    render();
  });

  $("views").addEventListener("click", (e) => {
    const btn = e.target.closest(".view-tab");
    if (btn && btn.dataset.view) setView(btn.dataset.view);
  });

  $("settings-toggle").addEventListener("click", () => {
    if (!state.settingsPanelOpen) openSettingsPanel();
    else closeSettingsPanel();
  });

  $("customize-summary").addEventListener("click", () => {
    state.widgetCustomizerOpen = !state.widgetCustomizerOpen;
    renderHealthRail();
  });

  /* The header disclosure. Applied once here too, ahead of the first snapshot:
     a stored collapsed preference must not wait for /api/snapshot to resolve
     before the header stops spending its 156px. */
  $("header-summary-toggle").addEventListener("click", toggleHeaderCollapsed);
  syncHeaderDisclosure();
  paintSettingsToggle();

  $("widget-reset").addEventListener("click", () => {
    state.widgetIds = defaultWidgetIds();
    saveWidgetPreferences();
    renderHealthRail();
  });

  $("empty-retry").addEventListener("click", () => {
    setConn("connecting");
    fetchSnapshot();
    if (es) es.close();
    connect();
  });

  document.addEventListener("keydown", (e) => { handleRowNavigation(e); });
  document.addEventListener("keydown", (e) => { handleCockpitKeys(e); });

  /* Up/Down walk the panel's rows while it is open. Scoped to the panel — a
     dropdown that swallowed the board's own row navigation would be worse than
     one that has none. */
  document.addEventListener("keydown", (e) => {
    if (!state.notifyPanelOpen) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const panel = $("notifications-panel");
    if (!panel || !panel.contains(document.activeElement)) return;
    const stops = [...panel.querySelectorAll("button:not([disabled])")];
    if (!stops.length) return;
    e.preventDefault();
    const at = stops.indexOf(document.activeElement);
    const next = e.key === "ArrowDown"
      ? stops[(at + 1) % stops.length]
      : stops[(at <= 0 ? stops.length : at) - 1];
    next?.focus();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    /* Ahead of the rest: it is a modal, and a modal that ignores Escape is the
       one dismissal every operator tries first. */
    if (state.settingsPanelOpen) {
      requestCloseSettingsPanel();
      return;
    }
    /* Same rule for the attention panel, and it returns focus to the control
       that opened it — a dismissal that strands focus on <body> loses a keyboard
       operator their place on the board entirely. */
    if (state.notifyPanelOpen) {
      closeNotificationsPanel();
      return;
    }
    /* The filter dropdown, ahead of the board's own chain: it is the most
       recently opened thing on the screen and the smallest, so Escape means it.
       Closes WITHOUT selecting — that is the whole point of the key — and hands
       focus back to the trigger, as a selection does. */
    if (state.openFilterMenu) {
      closeFilterMenu();
      return;
    }
    if (state.confirming) {
      // state.confirming holds the full instance fkey ("[head:]act:<id>:<action>"),
      // so Escape restores focus to the exact instance that opened the strip.
      const key = state.confirming;
      state.confirming = null;
      render();
      const origin = document.querySelector(`[data-fkey="${CSS.escape(key)}"]`);
      if (origin) origin.focus();
    } else if (state.renaming) {
      cancelRename();
    } else if (state.widgetCustomizerOpen) {
      state.widgetCustomizerOpen = false;
      renderHealthRail();
    } else if (state.selectedId) {
      closeInspector();
    }
  });

  bootIntervals.push(setInterval(() => {
    pollConnectionHealth();
    tickFreshnessSurfaces();
    void fetchTriageQueue();
  }, 5000));

  fetchSnapshot();
  fetchLabels();
  void fetchRepoColors();
  fetchTriageQueue();
  // One attempt at boot. It populates the drawer's "last action" fact, and on a
  // build without the route it latches available=false so nothing retries it.
  void loadActions();
  // The server's own health verdict, on its own slower clock: it is a whole
  // extra request, and a wedged server is not a sub-15s event.
  void pollServerHealth();
  bootIntervals.push(setInterval(() => { void pollServerHealth(); }, SERVER_HEALTH_POLL_MS));
  connect();
}

/* ---------- test seam ----------

   The hoisted block near the top of this file can only export function
   declarations: `state` and the module's `const`s are declared below it, so
   naming them there is a TDZ error. Everything that needed to be reached but
   could not is exported HERE, after the whole module has evaluated.

   Why it exists: twenty-two tests asserted that substrings appear in the raw
   text of this file. Those tests gate the deploy and cannot fail when the
   behaviour breaks — `sendControl` could stop requiring confirmation, or start
   calling HTTP 200 a success, and every one of them would still pass. The
   request/confirmation logic was private, so there was nothing else to assert.

   The surface is deliberately narrow and honest: the request functions, the
   module state they mutate, and the pure helpers behind the new surfaces. It is
   NOT a general escape hatch, and `boot()` / `render()` never read it. Tests
   that write `state` are responsible for restoring what they touched. */
Object.assign(globalThis.TheAntHill, {
  // Declared below the first export block, so they would be a TDZ error there —
  // same reason CONN_LABELS and the transcript limits live down here.
  settingsPreview, settingsPreviewText, SETTINGS_PRESETS, renderSettingsPanel,
  requestCloseSettingsPanel,
  // TINT-F: the repo-colour region and its one write.
  renderRepoColorSettings, paintRepoColorSettings, putRepoColor, putTeamColor,
  fetchTeamColors, renderTeamColorSettings, paintTeamColorSettings,
  passesLookback, isUnverified,
  // `const`s, so they would be a TDZ error in the hoisted block above.
  STRIP_ID, SECTION_HEADS,
  /* The lens axis table and its two derivations. Exported because the axes are
     now DATA — five menus, the filter predicate, the counts and the sentence all
     read this one list — so "every axis filters by the same rule it counts by"
     is assertable against the table rather than against five copied-out tests. */
  LENS_AXES, lensOptions, lensApplies,
  // The exact resolver pair app.js hands the notification center, so a test can
  // drive the wired derivation rather than its unwired defaults.
  NOTIFY_DEPS,
  /* The drawer table's own keys, so "every route resolves to a real drawer" is
     asserted against the router rather than against a list kept by hand — a new
     notification kind cannot ship without a drawer to open. Keys only: the
     renderers themselves are not test surface. */
  DRAWER_KINDS: Object.keys(DRAWER_RENDERERS),
  // The module's real state object. Exported because the confirmation strip,
  // the pending set, the feedback map and the attention/triage records are all
  // written by the request functions and read by the render functions — there
  // is no way to assert the behaviour without both ends.
  state,
  // Request/confirmation logic. Each one is driven in tests with a fake fetch.
  apiFetch, sendControl, sendSyncClose, recollectSnapshot, fetchSnapshot,
  applySnapshot, applySnapshotDelta, handleEventPayload, handleDeltaPayload, tickFreshnessSurfaces,
  syncInspectorViewportHeight,
  triageIssue, removeTriageItem, fetchTriageQueue,
  fetchLabels, submitRename, startRename,
  setGrouping, toggleSelectMode, defaultGroupingName, groupingWorkspaceIds,
  groupingSharedWindowId, createGroupingTeam, startTeamRename, submitTeamRename, ungroupTeam,
  // SYNC-RF: the cmux workspace rename path, driven end to end against a fake
  // fetch — the gate, the editor, the POST, and the refusal vocabulary.
  renameableWorkspace, renderWorkspaceRename,
  startWorkspaceRename, cancelWorkspaceRename, submitWorkspaceRename, syncRenameErrorText,
  loadTranscript, loadActions, applyAttention,
  // Surfaces added this wave, plus the const limits FE-C had to leave out.
  // Startup path + the server-health probe, driven for real by tests.
  boot, stopBoot, pollServerHealth, renderServerHealth, SERVER_HEALTH_POLL_MS,
  livenessState, livenessView,
  attentionRecord, attentionStateText, attentionErrorText, renderAttentionBlock,
  triageLifecycleControls, readEndpointOriginNote,
  TRANSCRIPT_DEFAULT_LIMIT, TRANSCRIPT_MAX_LIMIT, TRANSCRIPT_RENDER_CAP,
  ACTIONS_DEFAULT_LIMIT, ACTIONS_MAX_LIMIT,
  ATTENTION_SNOOZE_MS, API_READ_TIMEOUT_MS, API_TRANSCRIPT_TIMEOUT_MS, API_WRITE_TIMEOUT_MS,
  /* SYNC-NF. The snapshot readers, the two writes and the surfaces they paint.
     `syncPending` is here for the same reason `state` is: the request functions
     write it and the renderers read it, so a disabled control mid-flight is not
     assertable without both ends. `notifyPanelPaintSig` joins the surface it
     signs — the unread set is not in the panel model, so the guard against a
     cleared notification staying on screen has to be exercised directly. */
  unreadCmuxByWorkspace, unreadCmuxNotifications, agentUnreadCmux,
  ackedIds, ackedAgent, stripAlerting, acknowledgedCount,
  momentumPopulation, toggleMomentumMagnify,
  cmuxBadgeNode, ackedMarkNode, syncAckButton, acknowledgedClause,
  renderCmuxNotifySection, cmuxNotifyRow, notifyPanelPaintSig,
  renderNotificationCenter,
  clearCmuxNotification, applySyncAck, syncRequest, syncFailureText, syncPending,
  HARNESS_MARK, AGENT_MARK, harnessKeyOf, agentKeyOf,
});

if (typeof document !== "undefined" && typeof window !== "undefined") {
  boot();
}
