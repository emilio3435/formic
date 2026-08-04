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

/* Attention first, deliberately. The board used to open on "now" — every routine
   working agent — with the attention tab reading 0 beside it. A cockpit whose
   landing state is "show me all routine work" cannot also claim to stay silent
   about what does not need a human. */
/* Five, not six. "Working" was Now minus alerts — a whole tab for a subtraction
   the operator can do by eye — and every tab costs a glance on every visit.
   Provider and program facets cover the case it served. */
export const OPS_VIEWS = ["needs-you", "now", "waiting", "history"];
export const VIEWS = [...OPS_VIEWS, "usage"];
export const LOOKBACK_STORAGE_KEY = "mtn3-lookbackHours";
export const LOOKBACK_PRESETS = [1, 6, 24, 36];
export const DEFAULT_LOOKBACK_HOURS = 6;
export const USAGE_RANGE_PRESETS = [
  { id: "1h", hours: 1, label: "1h" },
  { id: "24h", hours: 24, label: "24h" },
  { id: "7d", hours: 24 * 7, label: "7d" },
  { id: "30d", hours: 24 * 30, label: "30d" },
];

export const MODEL_POLICY_LABELS = {
  compliant: "Compliant",
  mismatch: "Model mismatch",
  violation: "Model mismatch",
  unreported: "Model unreported",
  unverified: "Model unreported",
};

export const WIDGET_STORAGE_KEY = "mtn3-summary-widgets";
export const DEFAULT_WIDGET_IDS = Object.freeze([
  "needs-you", "momentum", "burn", "context-peak", "health",
]);
export const WIDGET_CATALOG = Object.freeze([
  /* "Findings", not "Needs you". This card counts the whole findings collection
     — collector faults, policy drift, and agents waiting — while the tab counts
     agents waiting alone. Sharing one phrase across two populations is what let
     the rail read "NEEDS YOU 1 finding" beside a tab reading "Needs you 0" and
     a headline reading "Nothing needs you". Two populations, two words; the id
     stays so saved layouts survive. (Render-first audit §1.) */
  { id: "needs-you", label: "Findings", required: true },
  { id: "momentum", label: "Momentum" },
  { id: "burn", label: "Burn" },
  { id: "context-peak", label: "Context peak" },
  { id: "health", label: "Health" },
]);
export const WIDGET_IDS = new Set(WIDGET_CATALOG.map((widget) => widget.id));
