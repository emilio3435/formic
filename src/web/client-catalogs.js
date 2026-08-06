/* Static client catalogs. They intentionally do not depend on application state. */

export const ACTIVITY_LABELS = { working: "Working", idle: "Waiting", ended: "Ended", unknown: "Unverified" };

/* The four states a session can be in, and the sentence each one means. This
   copy ships — it is the tooltip and the row explanation, not documentation.

   "Waiting" replaces "Idle" because idle blamed the agent for a silence that is
   usually the operator's move. "Unverified" is the honest name for the state
   the board used to call ended: not a claim about the session, a statement
   about what the board can see. "Quiet" was the alternative and was rejected —
   it already means the momentum stall on this board, and a second meaning would
   collide on the same screen. */
export const LIFECYCLE_LABELS = {
  working: "Working",
  waiting: "Waiting",
  unverified: "Unverified",
  finished: "Finished",
};

export const LIFECYCLE_MEANINGS = {
  working: "Actively producing — source activity in the last few minutes.",
  waiting: "Open but not producing: it finished a turn and is waiting on you, or it has gone quiet while its process is still live.",
  unverified: "Silent for a while and no matching process found — Ant Hill cannot tell whether this session is still alive.",
  finished: "Ended with evidence: the source recorded a session exit, you archived it, or its process is confirmed gone.",
};

/* Why a session is where it is. Four of these are the facts the single word
   "archived" used to collapse. */
export const PROVENANCE_LABELS = {
  "provider-exit": "Session exit recorded",
  "operator-archive": "You archived this",
  "process-died": "Process gone without a clean end",
  "process-absent": "No running process claims it",
  "aged-out": "No longer watched",
  "turn-complete": "Turn done — waiting on you",
  "turn-complete-aged": "Turn done, no reply since",
  "process-live-quiet": "Quiet, process live",
  "no-evidence": "No process evidence",
  recency: "",
};
export const OUTCOME_LABELS = { healthy: "Healthy", "needs-you": "Alert", blocked: "Blocked", failed: "Failed" };
/* "Unverified pane" sits between Linked and Observed only: cmux can route a
   Focus there, but cannot attest which session is on it, so nothing may be typed
   into it. Its own word, because it is its own state — see deriveControlState. */
export const CONTROL_LABELS = {
  linked: "Linked",
  unproven: "Unverified pane",
  "observed-only": "Observed only",
  quarantined: "Quarantined",
};

/* The operator-facing verb for each control action. It lives here rather than in
   app.js because controlOutcome() turns a control response into the sentence the
   operator reads, and api-client.js must never import from app.js — that would
   be the first import cycle in src/web. */
export const ACTION_LABELS = { focus: "Focus", instruct: "Send", interrupt: "Interrupt", archive: "Archive", unarchive: "Un-archive" };

export const ROLE_LABELS = {
  human: "Human",
  orchestrator: "Orchestrator",
  worker: "Worker",
  verifier: "Verifier",
  tester: "Tester",
  monitor: "Monitor",
  automation: "Automation",
  service: "Service",
  agent: "Agent",
  /* Old snapshot/free-form values remain readable during the wire transition.
     They are presentation fallbacks, not members of AgentRole. */
  frontend: "Frontend / designer",
  backend: "Backend implementer",
};

export const ROLE_ALIASES = {
  human: "human",
  operator: "human",
  "human operator": "human",
  orchestrator: "orchestrator",
  orchestration: "orchestrator",
  coordinator: "orchestrator",
  "swarm owner": "orchestrator",
  worker: "worker",
  verifier: "verifier",
  reviewer: "verifier",
  auditor: "verifier",
  gatekeeper: "verifier",
  validator: "verifier",
  tester: "tester",
  testing: "tester",
  test: "tester",
  qa: "tester",
  "test lane": "tester",
  monitor: "monitor",
  watcher: "monitor",
  automation: "automation",
  autopilot: "automation",
  automated: "automation",
  service: "service",
  "dev server": "service",
  tail: "service",
  agent: "agent",
  frontend: "frontend",
  "front end": "frontend",
  designer: "frontend",
  design: "frontend",
  ui: "frontend",
  ux: "frontend",
  "frontend / designer": "frontend",
  backend: "backend",
  "back end": "backend",
  server: "backend",
  engine: "backend",
  implementer: "backend",
  "backend implementer": "backend",
};

export const ROSTER_ROLE_ORDER = [
  "human",
  "orchestrator",
  "monitor",
  "verifier",
  "worker",
  "tester",
  "automation",
  "service",
  "agent",
];

/* Attention first, deliberately. The board used to open on "now" — every routine
   working agent — with the attention tab reading 0 beside it. A cockpit whose
   landing state is "show me all routine work" cannot also claim to stay silent
   about what does not need a human. */
/* Three, not five. Needs you / Now / Waiting were three lenses on ONE live
   fleet, and the split cost the operator the thing the board exists to give
   them: reaching a waiting session meant leaving the tab showing the working
   ones, and an alerting agent was counted in two places at once.

   Board is that fleet in one scroll. Attention is still first — it is a pinned
   strip at the top rather than a tab you have to select — and the Waiting and
   Unverified distinctions the tabs encoded are lifecycle dividers inside each
   program group, so nothing the tabs said has gone quiet; it has stopped being
   a tab flip away. History and Usage keep their own tabs because neither is
   live work. */
export const OPS_VIEWS = ["board", "history"];
export const VIEWS = [...OPS_VIEWS, "usage"];

/* The tabs Board replaced. A landing view saved server-side (`defaultView`)
   still names one of them, and dropping the operator's stored choice on the
   floor because the vocabulary moved is the kind of silent ignore this project
   does not do — it lands on the view that now contains what they asked for. */
export const LEGACY_VIEW_ALIASES = {
  "needs-you": "board",
  now: "board",
  waiting: "board",
  working: "board",
  idle: "board",
};
export const LOOKBACK_STORAGE_KEY = "mtn3-lookbackHours";
export const LOOKBACK_PRESETS = [1, 6, 24, 36];
export const DEFAULT_LOOKBACK_HOURS = 6;
export const USAGE_RANGE_PRESETS = [
  { id: "1h", hours: 1, label: "1h" },
  { id: "24h", hours: 24, label: "24h" },
  { id: "7d", hours: 24 * 7, label: "7d" },
  { id: "30d", hours: 24 * 30, label: "30d" },
];

/* Which secondary context reading the gauge spells out. Per-browser like the
   lookback, because it is a display preference rather than a fact about the
   fleet — nothing on the server changes when it flips. */
export const CONTEXT_SPREAD_KEY = "mtn3-contextSpread";

export const WIDGET_STORAGE_KEY = "mtn3-summary-widgets";
export const DEFAULT_WIDGET_IDS = Object.freeze([
  "momentum", "burn", "context-peak", "health",
]);
export const WIDGET_CATALOG = Object.freeze([
  /* The "Findings" card stood first here and is gone.
     The header is CONFIDENCE — continuous measured quantities about the fleet,
     each carrying its own provenance — and a count of to-dos is not one of
     those. It belonged to attention, which now has a home of its own, and the
     header's rule is the seam: it never links and it states no count of
     problems. See RETIRED_WIDGET_IDS below for what happens to a saved layout
     that still names it. */
  { id: "momentum", label: "Momentum" },
  { id: "burn", label: "Burn" },
  /* Label "Context", id `context-peak`. S3 moved the peak off the headline —
     the card reads the fleet's typical occupancy now, because one session's
     extremum was standing in for a reading about the whole fleet. The id does
     not move with the label: it is a storage key that saved layouts and the
     CONTEXT_SPREAD_KEY preference are written against. Ids are storage keys,
     labels are copy — the same precedent the retired Findings card was named
     under. */
  { id: "context-peak", label: "Context" },
  { id: "health", label: "Health" },
]);
/* Ids that were real once and are not offered any more. A stored layout naming
   one is a preference from an older build, not corruption, so it is migrated by
   dropping the retired entry and keeping the operator's ordering of the rest —
   the LEGACY_VIEW_ALIASES treatment above, where a saved landing view whose
   vocabulary moved lands on the view that now contains what it asked for. */
export const RETIRED_WIDGET_IDS = Object.freeze(["needs-you"]);
export const WIDGET_IDS = new Set(WIDGET_CATALOG.map((widget) => widget.id));
